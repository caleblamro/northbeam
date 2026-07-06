'use client';

// FlowEditor — the full automation editor surface. Slim header (back, inline
// name, object chip, status, dirty dot, View runs / Test / Save / Activate),
// the controlled canvas from one useFlowEditor instance, and a docked right
// column that swaps between the node config panel and the test-run panel.
// The run-history drawer + test traces feed the same canvas overlay.
//
// Draft persistence is lenient: automation.update accepts config-incomplete
// graphs (FlowDraftGraphSchema — shape only), so in-progress work always
// saves. Strict FlowGraphSchema still runs client-side to badge incomplete
// nodes ("incomplete"), and activation is the hard gate server-side.

import { EmptyState } from '@/components/northbeam/empty-state';
import { Badge, type BadgeTone } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Callout } from '@/components/ui/callout';
import { LoadingScreen } from '@/components/ui/loading-screen';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { type RouterOutputs, trpc } from '@/lib/api';
import {
  FlowDraftGraphSchema,
  type FlowGraph,
  FlowGraphSchema,
  type FlowIssue,
  type FlowTrigger,
  isFlowTriggerNode,
} from '@northbeam/core/flow';
import {
  AlertCircle,
  AlertTriangle,
  ArrowLeft,
  Database,
  FlaskConical,
  History,
  Loader2,
  Pause,
  Play,
  Save,
} from 'lucide-react';
import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { FlowCanvas, type FlowCanvasFocus } from './flow-canvas';
import type { MergeFieldPath } from './merge-field-input';
import { ConfigPanel } from './panels/config-panel';
import type { FlowPanelMeta } from './panels/shared';
import { TestRunPanel } from './panels/test-run-panel';
import { RunHistoryDrawer } from './run-history';
import { type FlowTraceStepLike, buildRunOverlay } from './run-overlay';
import { useFlowEditor } from './use-flow-editor';

type FlowDetail = RouterOutputs['automation']['get']['flow'];

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8000';

const STATUS_BADGE: Record<string, { tone: BadgeTone; label: string }> = {
  draft: { tone: 'neutral', label: 'Draft' },
  active: { tone: 'success', label: 'Active' },
  paused: { tone: 'warning', label: 'Paused' },
  needs_rebuild: { tone: 'danger', label: 'Rebuild manually' },
};

function fallbackGraph(objectId: string | null): FlowGraph {
  const trigger: FlowTrigger = objectId
    ? { id: 'trigger', type: 'trigger_record', config: { event: 'created_or_updated' } }
    : { id: 'trigger', type: 'trigger_webhook', config: {} };
  return { nodes: [trigger], edges: [] };
}

/** Map zod parse failures onto the offending nodes as error issues. */
function configIssuesFrom(
  parsed: ReturnType<typeof FlowGraphSchema.safeParse>,
  graph: FlowGraph,
): FlowIssue[] {
  if (parsed.success) return [];
  const out: FlowIssue[] = [];
  const seen = new Set<string>();
  for (const issue of parsed.error.issues.slice(0, 30)) {
    const [head, index, ...rest] = issue.path;
    const nodeId =
      head === 'nodes' && typeof index === 'number' ? graph.nodes[index]?.id : undefined;
    const at = rest
      .map(String)
      .filter((p) => p !== 'config')
      .join('.');
    const message = at ? `${at}: ${issue.message}` : issue.message;
    const key = `${nodeId ?? ''}|${message}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ ...(nodeId ? { nodeId } : {}), severity: 'error', message });
  }
  return out;
}

export function FlowEditor({ flowId }: { flowId: string }) {
  const q = trpc.automation.get.useQuery({ id: flowId });
  if (q.isLoading) return <LoadingScreen size="md" />;
  if (!q.data) {
    return (
      <EmptyState
        icon={AlertCircle}
        title="Flow not found"
        body="It may have been deleted, or you may not have automation access."
        action={
          <Button variant="outline" size="sm" asChild>
            <Link href="/setup/automations">Back to automations</Link>
          </Button>
        }
      />
    );
  }
  return <FlowEditorInner key={q.data.flow.id} flow={q.data.flow} />;
}

const NO_FIELDS: never[] = [];

function FlowEditorInner({ flow }: { flow: FlowDetail }) {
  const utils = trpc.useUtils();

  // Seed once per mount (Inner is keyed by flow id) — later server refetches
  // must not clobber in-progress edits. SF references land with no graph;
  // they get a fresh trigger to start rebuilding from. Strict parse first
  // (fully-typed configs), then the lenient draft shape so config-incomplete
  // saves round-trip — panels wrote those configs, so the cast is safe.
  const [initialGraph] = useState<FlowGraph>(() => {
    const strict = FlowGraphSchema.safeParse(flow.draftGraph);
    if (strict.success) return strict.data;
    const draft = FlowDraftGraphSchema.safeParse(flow.draftGraph);
    return draft.success ? (draft.data as FlowGraph) : fallbackGraph(flow.objectId);
  });
  const editor = useFlowEditor(initialGraph);

  const [name, setName] = useState(flow.name);
  const [serverIssues, setServerIssues] = useState<FlowIssue[]>([]);
  const [traceSteps, setTraceSteps] = useState<FlowTraceStepLike[] | null>(null);
  const [focus, setFocus] = useState<FlowCanvasFocus | null>(null);
  const [testOpen, setTestOpen] = useState(false);
  const [runsOpen, setRunsOpen] = useState(false);

  // Any edit invalidates stale server verdicts and run traces.
  // biome-ignore lint/correctness/useExhaustiveDependencies: reset ON graph change is the point
  useEffect(() => {
    setServerIssues([]);
    setTraceSteps(null);
  }, [editor.graph]);

  /* ── Org metadata for panels + summaries ─────────────────────────────── */

  const boot = trpc.me.bootstrap.useQuery();
  const orgId = boot.data?.activeOrg?.id ?? null;
  const objectsQ = trpc.object.list.useQuery();
  const objects = useMemo(
    () => (objectsQ.data ?? []).map((o) => ({ id: o.id, key: o.key, label: o.label })),
    [objectsQ.data],
  );
  const object = objects.find((o) => o.id === flow.objectId) ?? null;
  const fieldsQ = trpc.object.get.useQuery(
    { key: object?.key ?? '' },
    { enabled: object !== null },
  );
  const fields = (object ? fieldsQ.data?.fields : undefined) ?? NO_FIELDS;
  const membersQ = trpc.org.members.useQuery();
  const members = useMemo(
    () =>
      (membersQ.data?.members ?? []).map((m) => ({
        userId: m.userId,
        name: m.name,
        email: m.email,
      })),
    [membersQ.data],
  );

  const trigger = useMemo(
    () => editor.graph.nodes.find(isFlowTriggerNode) ?? null,
    [editor.graph.nodes],
  );

  const mergePaths = useMemo<MergeFieldPath[]>(() => {
    const paths: MergeFieldPath[] = [];
    for (const f of fields)
      paths.push({ path: `record.${f.key}`, label: f.label, group: 'Record' });
    if (trigger?.type === 'trigger_record' && trigger.config.event !== 'created') {
      for (const f of fields)
        paths.push({ path: `oldRecord.${f.key}`, label: f.label, group: 'Previous values' });
    }
    const vars = new Set<string>();
    for (const node of editor.graph.nodes) {
      if (node.type === 'get_records') vars.add(node.config.assignTo);
      if (node.type === 'create_record' && node.config.assignTo) vars.add(node.config.assignTo);
      if (node.type === 'ai_step' && node.config.output.scope === 'vars')
        vars.add(node.config.output.name);
      if (node.type === 'assignment')
        for (const a of node.config.assignments)
          if (a.target.scope === 'vars') vars.add(a.target.name);
    }
    for (const name of [...vars].sort())
      paths.push({ path: `vars.${name}`, label: name, group: 'Variables' });
    if (editor.graph.nodes.some((n) => n.type === 'loop'))
      paths.push({ path: 'loopItem.id', label: 'Loop item id', group: 'Loop' });
    if (trigger?.type === 'trigger_webhook')
      paths.push({ path: 'webhook', label: 'Webhook body', group: 'Webhook' });
    paths.push({ path: 'now', label: 'Current time', group: 'System' });
    paths.push({ path: 'user.email', label: 'Acting user email', group: 'System' });
    return paths;
  }, [fields, trigger, editor.graph.nodes]);

  const collectionVars = useMemo(
    () =>
      [
        ...new Set(
          editor.graph.nodes.flatMap((n) => (n.type === 'get_records' ? [n.config.assignTo] : [])),
        ),
      ].sort(),
    [editor.graph.nodes],
  );

  const meta = useMemo<FlowPanelMeta>(
    () => ({
      flowId: flow.id,
      objectKey: object?.key ?? null,
      objects,
      fields,
      members,
      mergePaths,
      trigger,
      webhookSecret: flow.webhookSecret,
      webhookUrl: orgId ? `${API_URL}/api/hooks/flows/${orgId}/${flow.id}` : null,
    }),
    [flow.id, flow.webhookSecret, object, objects, fields, members, mergePaths, trigger, orgId],
  );

  const summaryCtx = useMemo(() => {
    const fieldByKey = new Map(fields.map((f) => [f.key, f.label]));
    const objectByKey = new Map(objects.map((o) => [o.key, o.label]));
    return {
      fieldLabel: (key: string) => fieldByKey.get(key) ?? key,
      objectLabel: (key: string) => objectByKey.get(key) ?? key,
    };
  }, [fields, objects]);

  /* ── Issues (client structural + zod config + server verdict) ────────── */

  const parsed = useMemo(() => FlowGraphSchema.safeParse(editor.graph), [editor.graph]);
  const issues = useMemo(() => {
    const merged = [...editor.issues, ...configIssuesFrom(parsed, editor.graph)];
    const seen = new Set(merged.map((i) => `${i.nodeId ?? ''}|${i.message}`));
    for (const issue of serverIssues) {
      const key = `${issue.nodeId ?? ''}|${issue.message}`;
      if (!seen.has(key)) {
        seen.add(key);
        merged.push(issue);
      }
    }
    return merged;
  }, [editor.issues, parsed, editor.graph, serverIssues]);
  const errorCount = issues.filter((i) => i.severity === 'error').length;

  /* ── Persistence ─────────────────────────────────────────────────────── */

  const update = trpc.automation.update.useMutation({
    meta: { context: "Couldn't save the flow" },
  });
  const activateM = trpc.automation.activate.useMutation({
    meta: { context: "Couldn't activate the flow" },
  });
  const pauseM = trpc.automation.pause.useMutation({
    meta: { context: "Couldn't pause the flow" },
  });

  const nameDirty = name.trim() !== flow.name && name.trim().length > 0;
  const dirty = editor.dirty || nameDirty;

  const saveDraft = async (): Promise<boolean> => {
    // Drafts save even when configs are incomplete (the server accepts the
    // lenient draft shape); incomplete nodes stay badged and gate ACTIVATE.
    const draftTrigger = editor.graph.nodes.find(isFlowTriggerNode);
    await update.mutateAsync({
      id: flow.id,
      ...(nameDirty ? { name: name.trim() } : {}),
      ...(draftTrigger ? { draftTrigger } : {}),
      draftGraph: editor.graph,
    });
    editor.actions.markSaved();
    await utils.automation.get.invalidate({ id: flow.id });
    utils.automation.list.invalidate();
    return true;
  };

  const ensureSaved = async (): Promise<boolean> => (dirty ? saveDraft() : true);

  const onActivate = async () => {
    if (!(await ensureSaved())) return;
    const res = await activateM.mutateAsync({ id: flow.id });
    setServerIssues(res.issues);
    if (res.ok) {
      toast.success('Flow activated');
      utils.automation.get.invalidate({ id: flow.id });
      utils.automation.list.invalidate();
    } else {
      toast.error(
        res.issues.find((i) => i.severity === 'error')?.message ?? 'Fix the issues to activate',
      );
    }
  };

  const onPause = async () => {
    await pauseM.mutateAsync({ id: flow.id });
    toast.success('Flow paused');
    utils.automation.get.invalidate({ id: flow.id });
    utils.automation.list.invalidate();
  };

  /* ── Overlay + focus ─────────────────────────────────────────────────── */

  const overlay = useMemo(
    () => (traceSteps ? buildRunOverlay(editor.graph, traceSteps) : null),
    [traceSteps, editor.graph],
  );

  /** Center a node; `select` also opens its config panel (issues popover) —
   *  step-timeline clicks only pan so the test/run panels stay docked. */
  const focusNode = (nodeId: string, select = false) => {
    if (select) editor.actions.select(nodeId);
    setFocus((prev) => ({ nodeId, nonce: (prev?.nonce ?? 0) + 1 }));
  };

  const status = STATUS_BADGE[flow.status] ?? { tone: 'neutral' as BadgeTone, label: flow.status };
  const pending = update.isPending || activateM.isPending || pauseM.isPending;

  return (
    <div className="flex h-full flex-col bg-background">
      {/* ── Slim header ── */}
      <header className="flex h-12 shrink-0 items-center gap-2.5 border-b bg-card px-3">
        <Button variant="ghost" size="icon-sm" aria-label="Back to automations" asChild>
          <Link href="/setup/automations">
            <ArrowLeft />
          </Link>
        </Button>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={120}
          aria-label="Flow name"
          className="w-64 truncate rounded-md bg-transparent px-1.5 py-1 font-medium text-sm outline-none transition-colors hover:bg-muted/60 focus-visible:bg-muted/60"
        />
        {object && (
          <Badge variant="outline" size="sm">
            <Database />
            {object.label}
          </Badge>
        )}
        <Badge size="sm" tone={status.tone}>
          {status.label}
        </Badge>
        {dirty && (
          <span className="flex items-center gap-1.5 text-muted-foreground text-xs">
            <span className="size-1.5 rounded-full" style={{ background: 'var(--warning)' }} />
            Unsaved
          </span>
        )}

        <div className="ml-auto flex items-center gap-1.5">
          {issues.length > 0 && (
            <Popover>
              <PopoverTrigger asChild>
                <Button variant="ghost" size="sm" aria-label="Validation issues">
                  {errorCount > 0 ? (
                    <AlertCircle className="text-[var(--danger)]" />
                  ) : (
                    <AlertTriangle className="text-[var(--warning)]" />
                  )}
                  <span className="tabular-nums">{issues.length}</span>
                </Button>
              </PopoverTrigger>
              <PopoverContent align="end" className="w-96 p-1.5">
                <ul className="flex max-h-80 flex-col gap-0.5 overflow-y-auto">
                  {issues.map((issue) => (
                    <li key={`${issue.nodeId ?? ''}|${issue.message}`}>
                      <button
                        type="button"
                        disabled={!issue.nodeId}
                        className="flex w-full items-start gap-2 rounded-md px-2 py-1.5 text-left text-xs transition-colors enabled:hover:bg-muted"
                        onClick={() => issue.nodeId && focusNode(issue.nodeId, true)}
                      >
                        {issue.severity === 'error' ? (
                          <AlertCircle className="mt-px size-3.5 shrink-0 text-[var(--danger)]" />
                        ) : (
                          <AlertTriangle className="mt-px size-3.5 shrink-0 text-[var(--warning)]" />
                        )}
                        {issue.message}
                      </button>
                    </li>
                  ))}
                </ul>
              </PopoverContent>
            </Popover>
          )}

          <Button variant="ghost" size="sm" onClick={() => setRunsOpen(true)}>
            <History />
            View runs
          </Button>
          <Button
            variant="ghost"
            size="sm"
            aria-pressed={testOpen}
            onClick={() => {
              setTestOpen((v) => !v);
              editor.actions.select(null);
            }}
          >
            <FlaskConical />
            Test
          </Button>
          <Button
            variant="outline"
            size="sm"
            disabled={!dirty || pending}
            onClick={() => void saveDraft()}
          >
            {update.isPending ? <Loader2 className="animate-spin" /> : <Save />}
            Save
          </Button>
          {flow.status === 'active' && !dirty ? (
            <Button size="sm" variant="outline" disabled={pending} onClick={() => void onPause()}>
              <Pause />
              Pause
            </Button>
          ) : (
            <Button
              size="sm"
              disabled={pending || !parsed.success}
              title={parsed.success ? undefined : 'Complete the highlighted steps to activate'}
              onClick={() => void onActivate()}
            >
              {activateM.isPending ? <Loader2 className="animate-spin" /> : <Play />}
              Activate
            </Button>
          )}
        </div>
      </header>

      {flow.status === 'needs_rebuild' && flow.referenceMeta && (
        <Callout
          variant="warning"
          icon={AlertTriangle}
          className="rounded-none border-x-0 border-t-0"
        >
          Imported from Salesforce as a reference ({flow.referenceMeta.apiName ?? flow.salesforceId}
          ) — {flow.referenceMeta.reason ?? 'rebuild it manually'}. Build the steps below and
          activate when ready.
        </Callout>
      )}

      {/* ── Canvas + right column ── */}
      <div className="flex min-h-0 flex-1">
        <div className="min-w-0 flex-1">
          <FlowCanvas
            graph={editor.graph}
            issues={issues}
            selectedNodeId={editor.selectedNodeId}
            onSelectNode={editor.actions.select}
            onInsertNode={editor.actions.insertNode}
            onAppendNode={editor.actions.appendNode}
            summaryCtx={summaryCtx}
            overlay={overlay}
            focus={focus}
          />
        </div>

        {(editor.selectedNode || testOpen) && (
          <aside className="w-[380px] shrink-0 border-l bg-card">
            {editor.selectedNode ? (
              <ConfigPanel
                node={editor.selectedNode}
                meta={meta}
                actions={editor.actions}
                issues={issues}
                collectionVars={collectionVars}
                onClose={() => editor.actions.select(null)}
              />
            ) : (
              <TestRunPanel
                meta={meta}
                graph={editor.graph}
                onTrace={setTraceSteps}
                onFocusNode={focusNode}
                onEnsureSaved={ensureSaved}
                onClose={() => {
                  setTestOpen(false);
                  setTraceSteps(null);
                }}
              />
            )}
          </aside>
        )}
      </div>

      <RunHistoryDrawer
        flowId={flow.id}
        graph={editor.graph}
        open={runsOpen}
        onClose={() => setRunsOpen(false)}
        onShowOnCanvas={setTraceSteps}
        onFocusNode={focusNode}
      />
    </div>
  );
}
