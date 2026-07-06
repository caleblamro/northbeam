'use client';

// AiChatSurface — the full-page /ai/chat workspace. Left: the conversation
// (text bubbles, tool chips, artifact markers) + input. Right: a large canvas
// rendering the latest artifact through the same walker every saved dashboard
// uses. Header: agent picker, model switcher (only when the agent resolves
// more than one model), session sharing, and Save as view.
//
// Streaming state lives in useAiChat (lib/use-ai-chat.ts); persistence is
// server-side — ai.chat saves the thread after every turn and returns the
// session id, which this surface writes into the URL without a navigation.

import { SaveViewDialog } from '@/components/northbeam/save-view-dialog';
import { ToolCallChip, sessionToolRow } from '@/components/northbeam/tool-call-chip';
import { ArtifactView } from '@/components/northbeam/views/artifact-walker';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Chip } from '@/components/ui/chip';
import { Kbd } from '@/components/ui/kbd';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Textarea } from '@/components/ui/textarea';
import { type RouterOutputs, trpc } from '@/lib/api';
import { useCan } from '@/lib/can';
import { cn } from '@/lib/cn';
import { type ChatTurn, useAiChat } from '@/lib/use-ai-chat';
import { useSaveArtifactAsView } from '@/lib/use-save-artifact';
import { AVAILABLE_AI_MODELS } from '@northbeam/core/ai-tools';
import type { ShareTarget, ViewIcon } from '@northbeam/db/views';
import {
  ArrowLeft,
  ArrowUp,
  BookmarkPlus,
  Bot,
  LayoutDashboard,
  Share2,
  Sparkles,
  Square,
} from 'lucide-react';
import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';

type AgentRow = RouterOutputs['agent']['list'][number];

export function AiChatSurface({
  sessionId,
  initialAgentId,
}: {
  /** Resume this stored thread; omit for a fresh chat. */
  sessionId?: string;
  /** Preselect an agent on a fresh chat (?agent=<id>). */
  initialAgentId?: string;
}) {
  const utils = trpc.useUtils();
  const canSave = useCan('view.write');
  const agents = trpc.agent.list.useQuery();
  const boot = trpc.me.bootstrap.useQuery();
  const session = trpc.ai.sessionGet.useQuery(
    { id: sessionId ?? '' },
    { enabled: Boolean(sessionId) },
  );

  const [agentId, setAgentId] = useState<string | null>(initialAgentId ?? null);
  const [model, setModel] = useState<string | null>(null);
  const [input, setInput] = useState('');
  const [saveOpen, setSaveOpen] = useState(false);
  const [sharedWith, setSharedWith] = useState<ShareTarget[]>([]);

  const chat = useAiChat({ agentId, model, sessionId: sessionId ?? null });
  const { hydrate } = chat;

  // Hydrate once from the stored session (thread, artifact, agent, model).
  const hydratedRef = useRef(false);
  useEffect(() => {
    const row = session.data;
    if (!row || hydratedRef.current) return;
    hydratedRef.current = true;
    hydrate({ id: row.id, messages: row.messages, artifact: row.artifact });
    // The stored agent/model win over the default-agent effect (which may
    // have already run if agent.list resolved first). If the stored agent is
    // no longer visible, that effect falls back to the first listed agent.
    if (row.agentId) setAgentId(row.agentId);
    if (row.model) setModel(row.model);
    setSharedWith(row.sharedWith ?? []);
  }, [session.data, hydrate]);

  // Default agent: the requested one when visible, else the first listed
  // (system agents sort first). Re-validates after hydrate sets a stored
  // agentId — a no-longer-visible agent falls back to the first listed.
  // biome-ignore lint/correctness/useExhaustiveDependencies: agentId re-runs the validation after hydrate
  useEffect(() => {
    const rows = agents.data;
    if (!rows || rows.length === 0) return;
    setAgentId((a) => (a && rows.some((r) => r.id === a) ? a : (rows[0]?.id ?? null)));
  }, [agents.data, agentId]);

  const agent = agents.data?.find((a) => a.id === agentId) ?? null;

  // Keep the model inside the agent's resolved list when the agent changes.
  useEffect(() => {
    if (!agent) return;
    setModel((m) =>
      m && agent.resolvedModels.includes(m) ? m : (agent.resolvedModels[0] ?? null),
    );
  }, [agent]);

  // A fresh chat gets its id from the first chat-done — reflect it in the URL
  // without remounting the page (history only; no navigation).
  useEffect(() => {
    if (!sessionId && chat.sessionId) {
      window.history.replaceState(null, '', `/ai/chat/${chat.sessionId}`);
      utils.ai.sessionList.invalidate();
    }
  }, [sessionId, chat.sessionId, utils.ai.sessionList]);

  const scrollRef = useRef<HTMLDivElement>(null);
  // biome-ignore lint/correctness/useExhaustiveDependencies: scroll reacts to thread changes
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [chat.messages, chat.toolCalls, chat.isGenerating]);

  const send = () => {
    if (!input.trim() || chat.isGenerating || !agentId) return;
    chat.send(input);
    setInput('');
  };

  const userId = boot.data?.session?.userId;
  const isOwnSession = sessionId ? session.data?.userId === userId : true;

  const saver = useSaveArtifactAsView();
  const userPrompts = chat.messages.flatMap((m) =>
    m.kind === 'text' && m.role === 'user' && m.content ? [m.content] : [],
  );
  const firstPrompt = userPrompts[0] ?? '';

  const saveAsView = async (opts: { label: string; sharedWith: ShareTarget[]; icon: ViewIcon }) => {
    if (!chat.artifact) return;
    await saver.save({ artifact: chat.artifact, ...opts, prompts: userPrompts, model });
    setSaveOpen(false);
  };

  return (
    <div className="flex h-[calc(100dvh-140px)] min-h-[480px] flex-col gap-4">
      {/* ── Header ── */}
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="ghost" size="icon-sm" aria-label="Back to Build" asChild>
          <Link href="/ai">
            <ArrowLeft />
          </Link>
        </Button>
        <div
          className="grid size-7 shrink-0 place-items-center rounded-md"
          style={{
            background: 'linear-gradient(135deg, var(--accent), var(--accent-active))',
            boxShadow: '0 1px 2px var(--accent-ring)',
          }}
        >
          <Sparkles className="size-3.5" style={{ color: 'var(--ink-onfill)' }} />
        </div>
        <p className="min-w-0 truncate font-medium text-sm">{session.data?.title ?? 'New chat'}</p>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <AgentPicker
            agents={agents.data ?? []}
            value={agentId}
            onChange={setAgentId}
            loading={agents.isLoading}
          />
          {agent && agent.resolvedModels.length > 1 && (
            <ModelPicker models={agent.resolvedModels} value={model} onChange={setModel} />
          )}
          {chat.sessionId && isOwnSession && (
            <SessionSharePopover
              sessionId={chat.sessionId}
              sharedWith={sharedWith}
              onChanged={setSharedWith}
              currentUserId={userId}
            />
          )}
          {canSave && chat.artifact && (
            <Button size="sm" onClick={() => setSaveOpen(true)} disabled={chat.isGenerating}>
              <BookmarkPlus />
              Save as view
            </Button>
          )}
        </div>
      </div>

      {/* ── Body: thread | canvas ── */}
      <div className="grid min-h-0 flex-1 gap-4 lg:grid-cols-[380px_minmax(0,1fr)]">
        <div className="flex min-h-0 flex-col rounded-lg border bg-background">
          <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
            {chat.messages.length === 0 ? (
              <ChatEmptyState agent={agent} />
            ) : (
              <div className="flex flex-col gap-4">
                {chat.messages.map((m, i) => (
                  // biome-ignore lint/suspicious/noArrayIndexKey: append-only thread
                  <ChatTurnRow key={i} turn={m} index={i} />
                ))}
                {chat.toolCalls.length > 0 && (
                  <div className="mr-6 ml-6 flex flex-col gap-1.5">
                    {chat.toolCalls.map((call) => (
                      <ToolCallChip key={call.callId} call={call} />
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
          <div className="flex flex-col gap-2 border-t px-3 py-3">
            {chat.error && (
              <p className="px-1 text-destructive text-xs" role="alert">
                {chat.error}
              </p>
            )}
            <div
              className={cn(
                'rounded-lg border bg-background transition-shadow',
                'focus-within:shadow-[0_0_0_2px_var(--bg),0_0_0_4px_var(--accent-ring)]',
              )}
            >
              <Textarea
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    send();
                  }
                }}
                placeholder={
                  chat.artifact ? 'Refine, ask, or compose something new…' : 'Ask anything…'
                }
                rows={2}
                className="min-h-0 resize-none rounded-none border-0 px-3 pt-2.5 pb-1 text-sm shadow-none focus-visible:ring-0"
              />
              <div className="flex items-center justify-between px-2 pb-2">
                <span className="flex items-center gap-1 text-[10px] text-muted-foreground">
                  <Kbd>↵</Kbd> send
                  <span className="px-0.5">·</span>
                  <Kbd>⇧↵</Kbd> newline
                </span>
                {chat.isGenerating ? (
                  <Button variant="outline" size="icon-xs" aria-label="Stop" onClick={chat.cancel}>
                    <Square className="size-2.5 fill-current" />
                  </Button>
                ) : (
                  <Button
                    size="icon-xs"
                    aria-label="Send"
                    disabled={!input.trim() || !agentId}
                    onClick={send}
                  >
                    <ArrowUp />
                  </Button>
                )}
              </div>
            </div>
          </div>
        </div>

        <div className="min-h-0 overflow-y-auto rounded-lg border bg-card/40 p-4">
          {chat.artifact ? (
            <div
              className={cn('transition-opacity duration-300', chat.isGenerating && 'opacity-70')}
            >
              <ArtifactView artifact={chat.artifact} />
            </div>
          ) : (
            <div className="grid h-full place-items-center py-16 text-center">
              <div className="flex max-w-xs flex-col items-center gap-3">
                <LayoutDashboard className="size-6 text-muted-foreground" />
                <p className="font-medium text-sm">Nothing composed yet</p>
                <p className="text-muted-foreground text-xs leading-relaxed">
                  Ask for a dashboard or report and it will render here, live against your data.
                </p>
              </div>
            </div>
          )}
        </div>
      </div>

      <SaveViewDialog
        open={saveOpen}
        onOpenChange={setSaveOpen}
        defaultLabel={firstPrompt.slice(0, 60) || 'Dashboard'}
        defaultIcon="chart"
        isSaving={saver.isSaving}
        onSave={saveAsView}
      />
    </div>
  );
}

/* ── Thread rows ────────────────────────────────────────────────────────── */

function ChatTurnRow({ turn, index }: { turn: ChatTurn; index: number }) {
  if (turn.kind === 'tool') {
    return (
      <div className="mr-6 ml-6">
        <ToolCallChip call={sessionToolRow(turn, `s-${index}`)} />
      </div>
    );
  }
  if (turn.kind === 'artifact') {
    return (
      <div className="mr-6 ml-6 flex items-center gap-2 rounded-md border border-dashed px-2.5 py-1.5 text-muted-foreground text-xs">
        <LayoutDashboard className="size-3.5 shrink-0 text-link" />
        Composed a dashboard{turn.note ? ` — ${turn.note}` : ''}
      </div>
    );
  }
  if (turn.role === 'user') {
    return (
      <div className="ml-10 self-end rounded-lg rounded-br-sm border bg-muted px-3 py-2 text-sm leading-relaxed">
        {turn.content}
      </div>
    );
  }
  return (
    <div className="mr-6 flex gap-2.5 text-sm">
      <Sparkles className="mt-1 size-3.5 shrink-0 text-link" />
      <div className="min-w-0 space-y-2">
        <p className="whitespace-pre-wrap leading-relaxed">
          {turn.content || (turn.pending ? 'Thinking' : '')}
          {turn.pending && (
            <span
              className="ml-1 inline-block h-3.5 w-[7px] translate-y-0.5 rounded-[1px]"
              style={{
                background: 'var(--accent)',
                animation: 'composer-caret 1s steps(2, start) infinite',
              }}
            />
          )}
        </p>
        {turn.repairs && turn.repairs.length > 0 && (
          <ul className="space-y-1 rounded-md border border-dashed px-2.5 py-2 text-muted-foreground text-xs">
            {turn.repairs.map((r) => (
              <li key={r}>{r}</li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function ChatEmptyState({ agent }: { agent: AgentRow | null }) {
  return (
    <div className="flex flex-col items-center gap-4 px-2 pt-12 text-center">
      <div className="grid size-12 place-items-center rounded-full border">
        <Bot className="size-5 text-link" />
      </div>
      <div className="space-y-1">
        <p className="font-medium text-sm">{agent ? agent.name : 'Pick an agent'}</p>
        <p className="text-muted-foreground text-xs leading-relaxed">
          {agent?.description ||
            'Chat with your workspace: ask about your data, run analyses, and compose live dashboards.'}
        </p>
      </div>
    </div>
  );
}

/* ── Header controls ────────────────────────────────────────────────────── */

function AgentPicker({
  agents,
  value,
  onChange,
  loading,
}: {
  agents: AgentRow[];
  value: string | null;
  onChange: (id: string) => void;
  loading: boolean;
}) {
  if (loading) return <Skeleton className="h-8 w-36" />;
  if (agents.length === 0) return null;
  return (
    <Select value={value ?? undefined} onValueChange={onChange}>
      <SelectTrigger size="sm" className="w-44" aria-label="Agent">
        <Bot className="size-3.5 shrink-0 text-link" />
        <SelectValue placeholder="Agent" />
      </SelectTrigger>
      <SelectContent>
        {agents.map((a) => (
          <SelectItem key={a.id} value={a.id}>
            {a.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function ModelPicker({
  models,
  value,
  onChange,
}: {
  models: string[];
  value: string | null;
  onChange: (id: string) => void;
}) {
  const labelFor = (id: string) => AVAILABLE_AI_MODELS.find((m) => m.id === id)?.label ?? id;
  return (
    <Select value={value ?? undefined} onValueChange={onChange}>
      <SelectTrigger size="sm" className="w-44" aria-label="Model">
        <SelectValue placeholder="Model" />
      </SelectTrigger>
      <SelectContent>
        {models.map((id) => (
          <SelectItem key={id} value={id}>
            {labelFor(id)}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

/* ── Session sharing ─────────────────────────────────────────────────────────
   Same three-mode popover as saved views (views-library.tsx ShareControl),
   pointed at ai.sessionShare. Owner-only — the server rejects anyone else. */

function SessionSharePopover({
  sessionId,
  sharedWith,
  onChanged,
  currentUserId,
}: {
  sessionId: string;
  sharedWith: ShareTarget[];
  onChanged: (next: ShareTarget[]) => void;
  currentUserId?: string;
}) {
  const [open, setOpen] = useState(false);
  const members = trpc.org.members.useQuery(undefined, { enabled: open });
  const share = trpc.ai.sessionShare.useMutation({
    meta: { context: "Couldn't update sharing" },
  });

  const isPublic = sharedWith.some((s) => s.kind === 'org');
  const sharedUserIds = new Set(sharedWith.flatMap((s) => (s.kind === 'user' ? [s.userId] : [])));
  const isShared = isPublic || sharedUserIds.size > 0 || sharedWith.some((s) => s.kind === 'role');

  const apply = (next: ShareTarget[]) =>
    share.mutate({ id: sessionId, sharedWith: next }, { onSuccess: () => onChanged(next) });

  const toggleUser = (userId: string, on: boolean) => {
    const next = new Set(sharedUserIds);
    if (on) next.add(userId);
    else next.delete(userId);
    apply([...next].map((id) => ({ kind: 'user', userId: id })));
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          aria-label="Share chat"
          className={cn(isShared && 'text-link')}
        >
          <Share2 />
          Share
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-72 p-3">
        <p className="font-medium text-sm">Share this chat</p>
        <p className="mt-0.5 text-muted-foreground text-xs">
          {isPublic
            ? 'Everyone in the workspace can read this thread.'
            : isShared
              ? 'Shared read-only with specific people.'
              : 'Only you can see this thread.'}
        </p>
        <div className="mt-3 flex gap-1.5">
          <Chip selected={!isShared} onClick={() => apply([])}>
            Personal
          </Chip>
          <Chip selected={isPublic} onClick={() => apply([{ kind: 'org' }])}>
            Public
          </Chip>
        </div>
        <p className="mt-3 font-medium text-muted-foreground text-xs uppercase tracking-[0.08em]">
          Specific people
        </p>
        <div className="mt-1.5 flex max-h-48 flex-col gap-1 overflow-y-auto">
          {members.isLoading && <Skeleton className="h-8" />}
          {(members.data?.members ?? [])
            .filter((m) => m.userId !== currentUserId)
            .map((m) => (
              <label
                key={m.userId}
                className="flex cursor-pointer items-center gap-2 rounded-md px-1.5 py-1 text-sm hover:bg-muted"
              >
                <Checkbox
                  checked={!isPublic && sharedUserIds.has(m.userId)}
                  disabled={isPublic || share.isPending}
                  onCheckedChange={(on) => toggleUser(m.userId, on === true)}
                />
                <span className="min-w-0 flex-1 truncate">{m.name || m.email}</span>
              </label>
            ))}
          {members.data && members.data.members.length <= 1 && (
            <p className="px-1.5 py-1 text-muted-foreground text-xs">
              No teammates yet — invite people from Settings.
            </p>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
