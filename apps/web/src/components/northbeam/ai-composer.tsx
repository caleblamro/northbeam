'use client';

// AiComposer — the AI door for the whole app. A docked right-hand drawer with
// a chat thread; the composed dashboard previews IN THE PAGE the user is on
// (the shell swaps the page body for the preview while one exists), so the
// conversation and the result are visible side by side.
//
// Three pieces, one context:
//   - AiComposerScope: provider owning all state (mounted once in AppShell)
//   - AiComposerDrawer: the fixed right panel (chat thread + input)
//   - AiComposerSurface: wraps page children; renders the live preview
//     instead while one exists
// Pages/renderers open it via useAiComposer().open({ objectKey?, prompt?,
// artifact? }) — passing an artifact starts in refinement mode against it.
//
// Generation streams over ai.preview: the model's conversational `note`
// fills the assistant bubble first, then partial artifact snapshots paint
// into the page preview, then the final validated + metadata-repaired
// artifact lands. Nothing persists until "Save as view" (view.create).
//
// Visual language: the drawer is a quiet instrument docked into the chrome.
// Chroma follows the system's one-accent rule — indigo appears only as the
// identity glyph, the header activity beam (sweeps while streaming), the
// caret, and focus rings; everything else is ink on hairlines. Keyframes
// live in globals.css under "AI composer".

import { SaveViewDialog } from '@/components/northbeam/save-view-dialog';
import {
  type Artifact,
  type ArtifactNode,
  ArtifactView,
} from '@/components/northbeam/views/artifact-walker';
import { Button } from '@/components/ui/button';
import { Kbd } from '@/components/ui/kbd';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { type RouterOutputs, trpc } from '@/lib/api';
import { formatError } from '@/lib/api/errors';
import { cn } from '@/lib/cn';
import { timeAgo } from '@/lib/time';
import type { ShareTarget, ViewIcon } from '@northbeam/db/views';
import { AnimatePresence, motion } from 'framer-motion';
import { ArrowUp, BookmarkPlus, History, Plus, Sparkles, Square, Trash2, X } from 'lucide-react';
import { usePathname, useRouter } from 'next/navigation';
import {
  type ReactNode,
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from 'react';

export const COMPOSER_WIDTH = 400;

// The shell's page-transition curve — reused so the drawer feels native.
const EASE = [0.16, 1, 0.3, 1] as const;

const SUGGESTIONS = [
  {
    tag: 'Snapshot',
    text: 'A workspace snapshot: total records, top industries, and the top 5 accounts by revenue.',
  },
  {
    tag: 'Pipeline',
    text: 'A pipeline dashboard: open deal count, total value, deals by stage, and the biggest open deals.',
  },
  {
    tag: 'Digest',
    text: 'A weekly digest: new records added, top stages by count, and recent highlights.',
  },
];

type ComposerMessage = {
  role: 'user' | 'assistant';
  content: string;
  /** Assistant message still streaming in. */
  pending?: boolean;
  /** Repair-pass notes attached to the final assistant message. */
  repairs?: string[];
};

type SessionRow = RouterOutputs['ai']['sessionList'][number];

/** Sentinel objectKey for WORKSPACE scope (the Home page) — the composer
 *  targets the whole workspace instead of one object; ai.preview is called
 *  without an objectKey and saving writes the caller's `home` view. */
export const WORKSPACE_KEY = '__workspace__';

type OpenOpts = {
  objectKey?: string;
  /** Prefill the input (no artifact) or record provenance (with artifact). */
  prompt?: string;
  /** Start in refinement mode against this artifact — it becomes the page
   *  preview immediately. */
  artifact?: Artifact;
  /** Home mode: workspace scope + saving updates the given home view in
   *  place (or creates the caller's `home` view when viewId is null). */
  home?: { viewId?: string | null };
};

type ComposerState = {
  isOpen: boolean;
  preview: Artifact | null;
  open: (opts?: OpenOpts) => void;
  close: () => void;
};

const AiComposerContext = createContext<ComposerState | null>(null);

export function useAiComposer(): ComposerState {
  const ctx = useContext(AiComposerContext);
  if (!ctx) throw new Error('useAiComposer must be used inside AiComposerScope');
  return ctx;
}

/** A mid-stream partial → something the walker can render: needs a components
 *  array; nodes (and one level of children) without a `component` string yet
 *  are dropped instead of rendering as "Unsupported component: undefined". */
function toPreviewArtifact(partial: unknown): Artifact | null {
  if (!partial || typeof partial !== 'object') return null;
  const components = (partial as { components?: unknown }).components;
  if (!Array.isArray(components)) return null;
  const isNode = (n: unknown): n is ArtifactNode =>
    !!n && typeof n === 'object' && typeof (n as { component?: unknown }).component === 'string';
  const nodes = components.filter(isNode).map((n) => ({
    ...n,
    children: Array.isArray(n.children) ? n.children.filter(isNode) : undefined,
  }));
  if (nodes.length === 0) return null;
  return { version: '1', components: nodes };
}

/* ── Internal full state (provider-private) ─────────────────────────────── */

type InternalState = ComposerState & {
  objectKey: string;
  setObjectKey: (k: string) => void;
  objects: { id: string; key: string; labelPlural: string }[];
  messages: ComposerMessage[];
  input: string;
  setInput: (v: string) => void;
  isGenerating: boolean;
  error: string | null;
  send: () => void;
  cancel: () => void;
  saveOpen: boolean;
  setSaveOpen: (v: boolean) => void;
  save: (opts: { label: string; sharedWith: ShareTarget[]; icon: ViewIcon }) => Promise<void>;
  /** True when composing the Home page (workspace scope) — Save writes the
   *  home view directly instead of opening the save-as-view dialog. */
  isHome: boolean;
  isSaving: boolean;
  sessionId: string | null;
  loadSession: (row: SessionRow) => void;
  newThread: () => void;
};

const InternalContext = createContext<InternalState | null>(null);

function useInternal(): InternalState {
  const ctx = useContext(InternalContext);
  if (!ctx) throw new Error('AiComposer components must be used inside AiComposerScope');
  return ctx;
}

export function AiComposerScope({ children }: { children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const utils = trpc.useUtils();
  const [isOpen, setIsOpen] = useState(false);
  const [objectKey, setObjectKey] = useState('');
  const [messages, setMessages] = useState<ComposerMessage[]>([]);
  const [input, setInput] = useState('');
  const [preview, setPreview] = useState<Artifact | null>(null);
  const [model, setModel] = useState<string | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saveOpen, setSaveOpen] = useState(false);
  const [sessionId, setSessionId] = useState<string | null>(null);
  // Home mode's save target — the existing home view to update in place.
  const [homeViewId, setHomeViewId] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const seedRef = useRef<OpenOpts | null>(null);
  // send() needs the thread as it was BEFORE the turn (for the session
  // autosave snapshot) without re-creating the callback per message.
  const messagesRef = useRef<ComposerMessage[]>([]);
  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  const objects = trpc.object.list.useQuery(undefined, { enabled: isOpen });
  const sessionSave = trpc.ai.sessionSave.useMutation({ meta: { silent: true } });

  const reset = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setMessages([]);
    setInput('');
    setPreview(null);
    setModel(null);
    setIsGenerating(false);
    setError(null);
    setSaveOpen(false);
    setSessionId(null);
    setHomeViewId(null);
    seedRef.current = null;
  }, []);

  const open = useCallback(
    (opts: OpenOpts = {}) => {
      reset();
      seedRef.current = opts;
      if (opts.home) {
        setHomeViewId(opts.home.viewId ?? null);
        setObjectKey(WORKSPACE_KEY);
      } else if (opts.objectKey) setObjectKey(opts.objectKey);
      if (opts.artifact) {
        setPreview(opts.artifact);
        setMessages([
          ...(opts.prompt ? [{ role: 'user' as const, content: opts.prompt }] : []),
          {
            role: 'assistant' as const,
            content: 'This dashboard is in the preview — tell me what to change.',
          },
        ]);
      } else if (opts.prompt) {
        setInput(opts.prompt);
      }
      setIsOpen(true);
    },
    [reset],
  );

  const close = useCallback(() => {
    setIsOpen(false);
    reset();
  }, [reset]);

  // Resolve the target object once the list arrives: explicit seed > the
  // object page the user is on > first object. Object routes come in two
  // shapes — /<key> (the dynamic [object] page) and the plural static pages
  // (/deals → 'deal', /activities → 'Activities'.toLowerCase()) — so match
  // the segment against key, key+'s', and the slugged plural label.
  useEffect(() => {
    if (!isOpen || objectKey || !objects.data || objects.data.length === 0) return;
    const seeded = seedRef.current?.objectKey;
    const segment = (pathname.split('/')[1] ?? '').toLowerCase();
    const routeMatch = objects.data.find(
      (o) =>
        o.key === segment ||
        `${o.key}s` === segment ||
        o.labelPlural.toLowerCase().replace(/\s+/g, '-') === segment,
    );
    const preferred =
      (seeded && objects.data.some((o) => o.key === seeded) && seeded) ||
      routeMatch?.key ||
      objects.data[0]?.key ||
      '';
    setObjectKey(preferred);
  }, [isOpen, objectKey, objects.data, pathname]);

  const send = useCallback(async () => {
    const instruction = input.trim();
    if (!instruction || !objectKey || isGenerating) return;
    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;
    // Refining edits the current preview; a stream that dies midway (error
    // OR cancel) restores this base instead of stranding a half-formed tree.
    const base = preview;
    const baseMessages = messagesRef.current;
    setError(null);
    setIsGenerating(true);
    setInput('');
    setMessages((m) => [
      ...m,
      { role: 'user', content: instruction },
      { role: 'assistant', content: '', pending: true },
    ]);
    const patchAssistant = (patch: Partial<ComposerMessage>) =>
      setMessages((m) => {
        const next = [...m];
        const last = next[next.length - 1];
        if (last?.role === 'assistant') next[next.length - 1] = { ...last, ...patch };
        return next;
      });
    try {
      const stream = await utils.client.ai.preview.mutate(
        {
          // Workspace scope (home) has no single target object.
          objectKey: objectKey === WORKSPACE_KEY ? undefined : objectKey,
          prompt: instruction,
          currentArtifact: base ?? undefined,
        },
        { signal: ac.signal },
      );
      for await (const event of stream) {
        if (event.type === 'partial') {
          if (event.note) patchAssistant({ content: event.note });
          const partial = toPreviewArtifact(event.artifact);
          if (partial) setPreview(partial);
        } else {
          setPreview(event.artifact);
          setModel(event.model);
          patchAssistant({
            content: event.note,
            pending: false,
            repairs: event.repairs.length > 0 ? event.repairs : undefined,
          });
          // Autosave the thread as a resumable session. Fire-and-forget —
          // a failed draft save should never disturb the conversation.
          const finalMessages: ComposerMessage[] = [
            ...baseMessages,
            { role: 'user', content: instruction },
            {
              role: 'assistant',
              content: event.note,
              repairs: event.repairs.length > 0 ? event.repairs : undefined,
            },
          ];
          const title =
            finalMessages.find((m) => m.role === 'user')?.content.slice(0, 120) ?? 'Untitled';
          sessionSave
            .mutateAsync({
              id: sessionId ?? undefined,
              objectKey,
              title,
              messages: finalMessages.map(({ pending: _p, ...m }) => m),
              artifact: event.artifact,
            })
            .then((r) => {
              setSessionId(r.id);
              utils.ai.sessionList.invalidate();
            })
            .catch(() => {});
        }
      }
    } catch (err) {
      setPreview(base);
      if (ac.signal.aborted) {
        patchAssistant({ content: 'Canceled.', pending: false });
      } else {
        const f = formatError(err);
        setError(f.body ?? f.title);
        // Drop the empty pending bubble; the inline error row explains.
        setMessages((m) =>
          m.filter((msg) => !(msg.role === 'assistant' && msg.pending && !msg.content)),
        );
        patchAssistant({ pending: false });
        setInput(instruction); // let the user retry / edit
      }
    } finally {
      if (abortRef.current === ac) {
        abortRef.current = null;
        setIsGenerating(false);
      }
    }
  }, [
    input,
    objectKey,
    isGenerating,
    preview,
    sessionId,
    utils.client,
    utils.ai.sessionList,
    sessionSave.mutateAsync,
  ]);

  const cancel = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  /** Resume a saved thread: messages, latest artifact, target object. */
  const loadSession = useCallback((row: SessionRow) => {
    abortRef.current?.abort();
    abortRef.current = null;
    setIsGenerating(false);
    setError(null);
    setInput('');
    setObjectKey(row.objectKey);
    setMessages((row.messages as ComposerMessage[]) ?? []);
    setPreview(toPreviewArtifact(row.artifact));
    setModel(null);
    setSessionId(row.id);
  }, []);

  /** Fresh thread, same drawer/object — the header's "+". */
  const newThread = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setIsGenerating(false);
    setError(null);
    setInput('');
    setMessages([]);
    setPreview(null);
    setModel(null);
    setSessionId(null);
  }, []);

  const createView = trpc.view.create.useMutation({
    meta: { context: "Couldn't save the dashboard" },
  });
  const updateView = trpc.view.update.useMutation({
    meta: { context: "Couldn't save your home page" },
  });

  const isHome = objectKey === WORKSPACE_KEY;

  const save = useCallback(
    async ({
      label,
      sharedWith,
      icon,
    }: { label: string; sharedWith: ShareTarget[]; icon: ViewIcon }) => {
      if (!preview) return;
      const prompts = messages.filter((m) => m.role === 'user').map((m) => m.content);

      if (isHome) {
        const config = {
          artifact: preview,
          prompt: prompts[0] ?? '',
          prompts,
          model: model ?? undefined,
          generatedAt: new Date().toISOString(),
        };
        // Update in place when we know (or can find) the caller's existing
        // home view — otherwise this save IS the home view's creation.
        const existingId = homeViewId ?? (await utils.view.home.fetch())?.id ?? null;
        if (existingId) {
          await updateView.mutateAsync({ id: existingId, config });
        } else {
          await createView.mutateAsync({
            objectId: null,
            key: 'home',
            label: 'Home',
            type: 'dashboard',
            icon: 'star',
            filters: [],
            sort: [],
            columns: [],
            sharedWith: [],
            config,
          });
        }
        await utils.view.home.invalidate();
        close();
        router.push('/');
        return;
      }

      const objectId = objects.data?.find((o) => o.key === objectKey)?.id;
      if (!objectId) return;
      const slug =
        label
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, '-')
          .replace(/^-+|-+$/g, '')
          .slice(0, 48) || 'dashboard';
      const created = await createView.mutateAsync({
        objectId,
        key: `${slug}-${Date.now().toString(36)}`,
        label,
        type: 'dashboard',
        icon,
        filters: [],
        sort: [],
        columns: [],
        sharedWith,
        // The artifact is the dashboard. Provenance: `prompt` is the original
        // instruction (seeds refinement on reopen), `prompts` the full
        // thread, `model` what generated the final tree.
        config: {
          artifact: preview,
          prompt: prompts[0] ?? '',
          prompts,
          model: model ?? undefined,
          generatedAt: new Date().toISOString(),
        },
      });
      await utils.view.list.invalidate({ objectId });
      const key = objectKey;
      close();
      router.push(`/${key}?view=${created?.id ?? ''}`);
    },
    [
      objects.data,
      objectKey,
      isHome,
      homeViewId,
      preview,
      messages,
      model,
      createView,
      updateView,
      utils.view.list,
      utils.view.home,
      close,
      router,
    ],
  );

  const state: ComposerState = { isOpen, preview: isOpen ? preview : null, open, close };
  const internal: InternalState = {
    ...state,
    objectKey,
    setObjectKey: (k) => {
      setObjectKey(k);
      setPreview(null);
      setMessages([]);
      setError(null);
    },
    objects: objects.data ?? [],
    messages,
    input,
    setInput,
    isGenerating,
    error,
    send,
    cancel,
    saveOpen,
    setSaveOpen,
    save,
    isHome,
    isSaving: createView.isPending || updateView.isPending,
    sessionId,
    loadSession,
    newThread,
  };

  return (
    <AiComposerContext.Provider value={state}>
      <InternalContext.Provider value={internal}>{children}</InternalContext.Provider>
    </AiComposerContext.Provider>
  );
}

/* ── In-page preview surface ────────────────────────────────────────────── */

/** Wraps the page body. While a preview exists, the page's own content hides
 *  (stays mounted, keeps its state) and the composed dashboard renders in its
 *  place under a slim status bar. */
export function AiComposerSurface({ children }: { children: ReactNode }) {
  const { preview } = useAiComposer();
  const { setSaveOpen, close, isGenerating, isHome, isSaving, save } = useInternal();
  return (
    <>
      <div className={cn(preview && 'hidden')}>{children}</div>
      {preview && (
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.35, ease: EASE }}
          className="flex flex-col gap-4"
        >
          <div
            className="flex items-center justify-between rounded-lg border py-1.5 pr-1.5 pl-3.5"
            style={{
              borderColor: 'var(--accent-soft)',
              background: 'linear-gradient(90deg, var(--accent-soft), transparent 55%)',
            }}
          >
            <span className="flex items-center gap-2 text-xs">
              <Sparkles className="size-3.5 text-link" />
              <span className="font-medium">AI preview</span>
              <span className="text-muted-foreground">
                {isGenerating ? (
                  <span className="inline-flex items-center gap-1.5">
                    <span
                      className="inline-block size-1.5 rounded-full"
                      style={{
                        background: 'var(--accent)',
                        animation: 'composer-dot 1.1s ease-in-out infinite',
                      }}
                    />
                    composing…
                  </span>
                ) : (
                  'not saved yet'
                )}
              </span>
            </span>
            <span className="flex items-center gap-1.5">
              <Button variant="ghost" size="xs" onClick={close}>
                Discard
              </Button>
              <Button
                size="xs"
                onClick={() =>
                  // Home saves in place — no name/share/icon to pick.
                  isHome ? save({ label: 'Home', sharedWith: [], icon: 'star' }) : setSaveOpen(true)
                }
                disabled={isGenerating || isSaving}
              >
                <BookmarkPlus />
                {isHome ? 'Save home' : 'Save as view'}
              </Button>
            </span>
          </div>
          <div className={cn('transition-opacity duration-300', isGenerating && 'opacity-70')}>
            <ArtifactView artifact={preview} />
          </div>
        </motion.div>
      )}
    </>
  );
}

/* ── The drawer ─────────────────────────────────────────────────────────── */

export function AiComposerDrawer() {
  const {
    isOpen,
    close,
    preview,
    objectKey,
    setObjectKey,
    objects,
    messages,
    input,
    setInput,
    isGenerating,
    error,
    send,
    cancel,
    saveOpen,
    setSaveOpen,
    save,
    isSaving,
    sessionId,
    loadSession,
    newThread,
  } = useInternal();
  const [showHistory, setShowHistory] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Keep the newest message in view as the thread grows / streams.
  // biome-ignore lint/correctness/useExhaustiveDependencies: scroll reacts to thread changes
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, isGenerating]);

  const firstPrompt = messages.find((m) => m.role === 'user')?.content ?? '';
  const objectLabel =
    objects.find((o) => o.key === objectKey)?.labelPlural.toLowerCase() ?? 'workspace';

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.aside
          initial={{ x: COMPOSER_WIDTH }}
          animate={{ x: 0 }}
          exit={{ x: COMPOSER_WIDTH }}
          transition={{ duration: 0.32, ease: EASE }}
          className="fixed inset-y-0 right-0 z-40 flex flex-col border-l bg-background shadow-xl"
          style={{ width: COMPOSER_WIDTH }}
          aria-label="AI composer"
        >
          {/* Header — identity glyph + quiet controls. The hairline under it
              becomes an accent "activity beam" while a generation streams. */}
          <div className="relative flex items-center gap-2.5 px-4 py-3">
            <div
              className="grid size-7 shrink-0 place-items-center rounded-md"
              style={{
                background: 'linear-gradient(135deg, var(--accent), var(--accent-active))',
                boxShadow: '0 1px 2px var(--accent-ring)',
              }}
            >
              <Sparkles className="size-3.5" style={{ color: 'var(--ink-onfill)' }} />
            </div>
            <div className="min-w-0">
              <p className="font-medium text-sm leading-tight">Compose</p>
            </div>
            <div className="ml-auto flex shrink-0 items-center gap-1">
              <Select value={objectKey} onValueChange={setObjectKey}>
                <SelectTrigger
                  className="h-7 w-auto gap-1 border-0 bg-transparent px-2 text-muted-foreground text-xs shadow-none hover:text-foreground"
                  aria-label="Target object"
                >
                  <SelectValue placeholder="Object" />
                </SelectTrigger>
                <SelectContent align="end">
                  {objectKey === WORKSPACE_KEY && (
                    <SelectItem value={WORKSPACE_KEY}>Workspace (home)</SelectItem>
                  )}
                  {objects.map((o) => (
                    <SelectItem key={o.id} value={o.key}>
                      {o.labelPlural}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label="New thread"
                onClick={() => {
                  setShowHistory(false);
                  newThread();
                }}
              >
                <Plus />
              </Button>
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label="Past sessions"
                aria-pressed={showHistory}
                className={cn(showHistory && 'bg-muted text-foreground')}
                onClick={() => setShowHistory((v) => !v)}
              >
                <History />
              </Button>
              <Button variant="ghost" size="icon-sm" aria-label="Close composer" onClick={close}>
                <X />
              </Button>
            </div>
            <div className="absolute inset-x-0 bottom-0 h-px bg-border">
              {isGenerating && (
                <div className="h-full overflow-hidden">
                  <div
                    className="h-full w-1/3"
                    style={{
                      background: 'linear-gradient(90deg, transparent, var(--accent), transparent)',
                      animation: 'composer-beam 1.3s ease-in-out infinite',
                    }}
                  />
                </div>
              )}
            </div>
          </div>

          {/* Thread / history */}
          <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-4">
            {showHistory ? (
              <SessionHistory
                open={showHistory}
                activeId={sessionId}
                onPick={(row) => {
                  loadSession(row);
                  setShowHistory(false);
                }}
              />
            ) : messages.length === 0 ? (
              <div className="flex flex-col items-center gap-6 px-1 pt-8 text-center">
                <div className="relative grid size-16 place-items-center">
                  <div
                    className="absolute inset-0 rounded-full border"
                    style={{ animation: 'composer-ring 3.2s ease-in-out infinite' }}
                  />
                  <div
                    className="absolute inset-2.5 rounded-full border"
                    style={{
                      borderColor: 'var(--accent-soft)',
                      animation: 'composer-ring 3.2s ease-in-out 0.4s infinite',
                    }}
                  />
                  <Sparkles className="size-5 text-link" />
                </div>
                <div className="space-y-1">
                  <p className="font-medium text-sm">Describe a dashboard</p>
                  <p className="text-muted-foreground text-xs leading-relaxed">
                    It composes against your live {objectLabel} data and previews on the page behind
                    this panel.
                  </p>
                </div>
                <div className="flex w-full flex-col gap-2">
                  {SUGGESTIONS.map((s, i) => (
                    <motion.button
                      key={s.tag}
                      type="button"
                      initial={{ opacity: 0, y: 8 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ duration: 0.35, ease: EASE, delay: 0.12 + i * 0.07 }}
                      onClick={() => setInput(s.text)}
                      className="group rounded-lg border bg-background px-3.5 py-2.5 text-left transition-all hover:border-[var(--accent-ring)] hover:shadow-xs"
                    >
                      <span className="font-medium text-[10px] text-muted-foreground uppercase tracking-[0.08em] transition-colors group-hover:text-link">
                        {s.tag}
                      </span>
                      <span className="mt-0.5 block text-foreground/80 text-xs leading-relaxed">
                        {s.text}
                      </span>
                    </motion.button>
                  ))}
                </div>
              </div>
            ) : (
              <div className="flex flex-col gap-4">
                {messages.map((m, i) =>
                  m.role === 'user' ? (
                    <motion.div
                      // biome-ignore lint/suspicious/noArrayIndexKey: append-only thread
                      key={`${i}-u`}
                      initial={{ opacity: 0, y: 6 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ duration: 0.3, ease: EASE }}
                      className="ml-10 self-end rounded-lg rounded-br-sm border bg-muted px-3 py-2 text-sm leading-relaxed"
                    >
                      {m.content}
                    </motion.div>
                  ) : (
                    <motion.div
                      // biome-ignore lint/suspicious/noArrayIndexKey: append-only thread
                      key={`${i}-a`}
                      initial={{ opacity: 0, y: 6 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ duration: 0.3, ease: EASE }}
                      className="mr-6 flex gap-2.5 text-sm"
                    >
                      <Sparkles className="mt-1 size-3.5 shrink-0 text-link" />
                      <div className="min-w-0 space-y-2">
                        <p className="leading-relaxed">
                          {m.content || (m.pending ? 'Composing' : '')}
                          {m.pending && (
                            <span
                              className="ml-1 inline-block h-3.5 w-[7px] translate-y-0.5 rounded-[1px]"
                              style={{
                                background: 'var(--accent)',
                                animation: 'composer-caret 1s steps(2, start) infinite',
                              }}
                            />
                          )}
                        </p>
                        {m.repairs && (
                          <ul className="space-y-1 rounded-md border border-dashed px-2.5 py-2 text-muted-foreground text-xs">
                            {m.repairs.map((r) => (
                              <li key={r}>{r}</li>
                            ))}
                          </ul>
                        )}
                      </div>
                    </motion.div>
                  ),
                )}
              </div>
            )}
          </div>

          {/* Footer — status, error, composer card */}
          <div className="flex flex-col gap-2 border-t px-3 py-3">
            {error && (
              <div className="flex items-center gap-2 px-1" role="alert">
                <p className="min-w-0 flex-1 text-destructive text-xs">{error}</p>
                <Button variant="outline" size="xs" onClick={send} disabled={isGenerating}>
                  Try again
                </Button>
              </div>
            )}
            {preview && !isGenerating && (
              <div className="flex items-center justify-between rounded-md bg-[var(--accent-soft)] py-1 pr-1 pl-2.5">
                <span className="flex items-center gap-1.5 text-link text-xs">
                  <span className="inline-block size-1.5 rounded-full bg-[var(--accent)]" />
                  Preview ready
                </span>
                <Button
                  variant="ghost"
                  size="xs"
                  className="text-link"
                  onClick={() => setSaveOpen(true)}
                >
                  <BookmarkPlus />
                  Save as view
                </Button>
              </div>
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
                  preview ? 'Refine — e.g. "make the chart a donut"' : 'Describe a dashboard…'
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
                {isGenerating ? (
                  <Button variant="outline" size="icon-xs" aria-label="Stop" onClick={cancel}>
                    <Square className="size-2.5 fill-current" />
                  </Button>
                ) : (
                  <Button
                    size="icon-xs"
                    aria-label="Send"
                    disabled={!input.trim() || !objectKey}
                    onClick={send}
                  >
                    <ArrowUp />
                  </Button>
                )}
              </div>
            </div>
          </div>

          <SaveViewDialog
            open={saveOpen}
            onOpenChange={setSaveOpen}
            defaultLabel={firstPrompt.slice(0, 60) || 'Dashboard'}
            defaultIcon="chart"
            isSaving={isSaving}
            onSave={save}
          />
        </motion.aside>
      )}
    </AnimatePresence>
  );
}

/* ── Past sessions ──────────────────────────────────────────────────────── */

function SessionHistory({
  open,
  activeId,
  onPick,
}: {
  open: boolean;
  activeId: string | null;
  onPick: (row: SessionRow) => void;
}) {
  const utils = trpc.useUtils();
  const sessions = trpc.ai.sessionList.useQuery(undefined, { enabled: open });
  const remove = trpc.ai.sessionDelete.useMutation({
    meta: { silent: true },
    onSuccess: () => utils.ai.sessionList.invalidate(),
  });

  if (sessions.isLoading) {
    return (
      <div className="flex flex-col gap-2">
        {[0, 1, 2].map((i) => (
          <div key={i} className="h-14 animate-pulse rounded-lg bg-muted/60" />
        ))}
      </div>
    );
  }
  const rows = sessions.data ?? [];
  if (rows.length === 0) {
    return (
      <div className="pt-10 text-center">
        <p className="font-medium text-sm">No past sessions</p>
        <p className="mt-1 text-muted-foreground text-xs">
          Threads save automatically after each generation.
        </p>
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-1.5">
      <p className="px-1 pb-1 font-medium text-[10px] text-muted-foreground uppercase tracking-[0.08em]">
        Past sessions
      </p>
      {rows.map((row, i) => (
        <motion.div
          key={row.id}
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3, ease: EASE, delay: Math.min(i * 0.04, 0.3) }}
          className={cn(
            'group relative rounded-lg border transition-colors hover:border-[var(--accent-ring)]',
            activeId === row.id && 'border-[var(--accent-ring)] bg-[var(--accent-soft)]',
          )}
        >
          <button
            type="button"
            onClick={() => onPick(row)}
            className="block w-full px-3 py-2.5 pr-9 text-left"
          >
            <span className="block truncate font-medium text-sm">{row.title}</span>
            <span className="mt-0.5 flex items-center gap-1.5 text-muted-foreground text-xs">
              <span className="capitalize">
                {row.objectKey === WORKSPACE_KEY ? 'workspace' : row.objectKey}
              </span>
              <span>·</span>
              <span>{row.messages.length} messages</span>
              <span>·</span>
              <span>{timeAgo(row.updatedAt)}</span>
            </span>
          </button>
          <Button
            variant="ghost"
            size="icon-xs"
            aria-label="Delete session"
            className="absolute top-2 right-2 opacity-0 transition-opacity focus-visible:opacity-100 group-hover:opacity-100"
            onClick={() => remove.mutate({ id: row.id })}
          >
            <Trash2 />
          </Button>
        </motion.div>
      ))}
    </div>
  );
}
