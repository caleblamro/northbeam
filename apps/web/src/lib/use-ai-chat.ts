'use client';

// useAiChat — the streaming state machine behind the full-page /ai chat
// surface. Owns the thread (text turns + persisted-shape tool/artifact
// entries), the current turn's live tool chips, the latest artifact, and one
// in-flight ai.chat stream. The event-folding semantics mirror the proven
// composer drawer (ai-composer.tsx send()) — the drawer itself stays on
// ai.preview and does NOT use this hook.
//
// After each turn the server persists the session; `chat-done` hands back the
// session id so the client can resume without a follow-up save. The hook
// appends this turn's tool/artifact/text entries to `messages` in exactly the
// shape the server persisted, so the next send() replays a thread identical
// to the stored row.

import type { ToolCallRow } from '@/components/northbeam/tool-call-chip';
import { trpc } from '@/lib/api';
import { formatError } from '@/lib/api/errors';
import { coerceArtifact } from '@/lib/artifact-info';
import type { ArtifactLike } from '@northbeam/core/artifact';
import { useCallback, useRef, useState } from 'react';

/** Persisted session turn (matches the API's SessionMessageSchema — legacy
 *  text rows may omit `kind`). */
export type ServerChatTurn =
  | { kind?: 'text'; role: 'user' | 'assistant'; content: string; repairs?: string[] }
  | {
      kind: 'tool';
      toolId: string;
      title: string;
      status: 'done' | 'denied' | 'error';
      inputSummary?: string;
      resultSummary?: string;
    }
  | { kind: 'artifact'; note?: string };

/** Client thread turn — the persisted shape plus a streaming flag on text. */
export type ChatTurn =
  | {
      kind: 'text';
      role: 'user' | 'assistant';
      content: string;
      repairs?: string[];
      /** Assistant turn still streaming in. */
      pending?: boolean;
    }
  | Extract<ServerChatTurn, { kind: 'tool' } | { kind: 'artifact' }>;

function clip(s: string, max: number): string {
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

/** The thread as the server expects it back: pending/empty turns dropped,
 *  capped to the last 40 entries (the ai.chat input bound). */
function toServerThread(turns: ChatTurn[]): ServerChatTurn[] {
  return turns
    .filter((t) => t.kind !== 'text' || (!t.pending && t.content.trim().length > 0))
    .map((t) =>
      t.kind === 'text'
        ? {
            kind: 'text' as const,
            role: t.role,
            content: clip(t.content, 4000),
            ...(t.repairs?.length ? { repairs: t.repairs } : {}),
          }
        : t,
    )
    .slice(-40);
}

export type UseAiChatOptions = {
  /** Agent preset each send() runs as. Null while the picker loads. */
  agentId: string | null;
  /** Model override — honored server-side only when the agent allows it. */
  model?: string | null;
  /** Resume target; new threads get their id from the first chat-done. */
  sessionId?: string | null;
  objectKey?: string;
  mode?: 'dashboard' | 'detail';
};

export function useAiChat(options: UseAiChatOptions) {
  const utils = trpc.useUtils();
  const [messages, setMessages] = useState<ChatTurn[]>([]);
  const [toolCalls, setToolCalls] = useState<ToolCallRow[]>([]);
  const [artifact, setArtifact] = useState<ArtifactLike | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(options.sessionId ?? null);
  const abortRef = useRef<AbortController | null>(null);

  // send() reads the LATEST options/thread without re-creating per render.
  const optionsRef = useRef(options);
  optionsRef.current = options;
  const messagesRef = useRef<ChatTurn[]>(messages);
  messagesRef.current = messages;
  const artifactRef = useRef<ArtifactLike | null>(artifact);
  artifactRef.current = artifact;
  const sessionIdRef = useRef<string | null>(sessionId);
  sessionIdRef.current = sessionId;

  /** Resume a stored session: thread, latest artifact, id. */
  const hydrate = useCallback(
    (row: { id: string; messages: ServerChatTurn[]; artifact?: unknown }) => {
      abortRef.current?.abort();
      abortRef.current = null;
      setIsGenerating(false);
      setError(null);
      setToolCalls([]);
      setMessages(
        row.messages.map((m) =>
          m.kind === 'tool' || m.kind === 'artifact' ? m : { ...m, kind: 'text' },
        ),
      );
      setArtifact(coerceArtifact(row.artifact));
      setSessionId(row.id);
    },
    [],
  );

  const reset = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setIsGenerating(false);
    setError(null);
    setToolCalls([]);
    setMessages([]);
    setArtifact(null);
    setSessionId(null);
  }, []);

  const cancel = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  const send = useCallback(
    async (rawPrompt: string) => {
      const prompt = rawPrompt.trim();
      const opts = optionsRef.current;
      if (!prompt || !opts.agentId || abortRef.current) return;
      const ac = new AbortController();
      abortRef.current = ac;

      const base = artifactRef.current;
      const priorThread = toServerThread(messagesRef.current);
      setError(null);
      setIsGenerating(true);
      setToolCalls([]);
      setMessages((m) => [
        ...m,
        { kind: 'text', role: 'user', content: prompt },
        { kind: 'text', role: 'assistant', content: '', pending: true },
      ]);
      const patchAssistant = (patch: { content?: (prev: string) => string } & Partial<ChatTurn>) =>
        setMessages((m) => {
          const next = [...m];
          const last = next[next.length - 1];
          if (last && last.kind === 'text' && last.role === 'assistant' && last.pending) {
            const { content, ...rest } = patch;
            next[next.length - 1] = {
              ...last,
              ...(rest as Partial<typeof last>),
              content: content ? content(last.content) : last.content,
            };
          }
          return next;
        });

      // Mirrors the server's persisted turn recording (routers/ai.ts): the
      // start event's input/title, the end event's status/summary.
      const startedCalls = new Map<string, { input: unknown; title: string }>();
      const toolTurns: Extract<ChatTurn, { kind: 'tool' }>[] = [];

      try {
        const stream = await utils.client.ai.chat.mutate(
          {
            agentId: opts.agentId,
            prompt,
            ...(sessionIdRef.current ? { sessionId: sessionIdRef.current } : {}),
            ...(opts.model ? { model: opts.model } : {}),
            ...(opts.objectKey ? { objectKey: opts.objectKey } : {}),
            mode: opts.mode ?? 'dashboard',
            ...(base ? { currentArtifact: base } : {}),
            messages: priorThread,
          },
          { signal: ac.signal },
        );
        for await (const event of stream) {
          if (event.type === 'tool-approval') {
            startedCalls.set(event.callId, { input: event.input, title: event.title });
            setToolCalls((t) => [
              ...t,
              {
                callId: event.callId,
                toolId: event.toolId,
                title: event.title,
                input: event.input,
                status: 'awaiting',
              },
            ]);
          } else if (event.type === 'tool-start') {
            startedCalls.set(event.callId, { input: event.input, title: event.title });
            setToolCalls((t) => {
              const exists = t.some((c) => c.callId === event.callId);
              if (exists) {
                return t.map((c) => (c.callId === event.callId ? { ...c, status: 'running' } : c));
              }
              return [
                ...t,
                {
                  callId: event.callId,
                  toolId: event.toolId,
                  title: event.title,
                  input: event.input,
                  status: 'running',
                },
              ];
            });
          } else if (event.type === 'tool-end') {
            const started = startedCalls.get(event.callId);
            toolTurns.push({
              kind: 'tool',
              toolId: event.toolId,
              title: started?.title ?? event.toolId,
              status: event.status,
              ...(started ? { inputSummary: clip(JSON.stringify(started.input), 2000) } : {}),
              ...(event.summary ? { resultSummary: clip(event.summary, 2000) } : {}),
            });
            setToolCalls((t) =>
              t.map((c) =>
                c.callId === event.callId
                  ? { ...c, status: event.status, summary: event.summary }
                  : c,
              ),
            );
          } else if (event.type === 'text-delta') {
            patchAssistant({ content: (prev) => prev + event.delta });
          } else if (event.type === 'artifact') {
            setArtifact(event.artifact);
          } else if (event.type === 'chat-done') {
            if (event.artifact) setArtifact(event.artifact);
            if (event.sessionId) setSessionId(event.sessionId);
            // Fold the turn into the thread in exactly the persisted shape;
            // the live chips are absorbed as static tool entries.
            setToolCalls([]);
            setMessages((m) => {
              const withoutPending = m.filter(
                (t) => !(t.kind === 'text' && t.role === 'assistant' && t.pending),
              );
              return [
                ...withoutPending,
                ...toolTurns,
                ...(event.artifact
                  ? [
                      {
                        kind: 'artifact' as const,
                        note: `${event.artifact.components.length} components`,
                      },
                    ]
                  : []),
                ...(event.text
                  ? [
                      {
                        kind: 'text' as const,
                        role: 'assistant' as const,
                        content: clip(event.text, 4000),
                        ...(event.repairs.length ? { repairs: event.repairs } : {}),
                      },
                    ]
                  : []),
              ];
            });
          }
        }
      } catch (err) {
        setArtifact(base);
        if (ac.signal.aborted) {
          patchAssistant({ content: () => 'Canceled.', pending: false });
        } else {
          const f = formatError(err);
          setError(f.body ?? f.title);
          // Drop the empty pending bubble; the inline error row explains.
          setMessages((m) =>
            m.filter((t) => !(t.kind === 'text' && t.role === 'assistant' && t.pending)),
          );
        }
      } finally {
        if (abortRef.current === ac) {
          abortRef.current = null;
          setIsGenerating(false);
        }
      }
    },
    [utils.client],
  );

  return {
    messages,
    toolCalls,
    artifact,
    isGenerating,
    error,
    sessionId,
    send,
    cancel,
    hydrate,
    reset,
  };
}
