'use client';

// Run history — a docked right drawer (AiComposer motion pattern): runs list
// → per-run step timeline with error callouts, cancel/resume for parked runs,
// and "Show on canvas" feeding the same overlay the test-run panel uses.
// FlowStepTimeline is shared with the test-run panel.

import { EmptyState } from '@/components/northbeam/empty-state';
import { Badge, type BadgeTone } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Callout } from '@/components/ui/callout';
import { LoadingScreen } from '@/components/ui/loading-screen';
import {
  Timeline,
  TimelineConnector,
  TimelineContent,
  TimelineDot,
  TimelineItem,
} from '@/components/ui/timeline';
import { trpc } from '@/lib/api';
import { timeAgo } from '@/lib/time';
import type { FlowGraph, FlowNodeType } from '@northbeam/core/flow';
import { AnimatePresence, motion } from 'framer-motion';
import { AlertCircle, ArrowLeft, Check, History, Minus, Route, X } from 'lucide-react';
import { useState } from 'react';
import { NODE_CATALOG, nodeTitle } from './node-catalog';
import type { FlowTraceStepLike } from './run-overlay';

const DRAWER_WIDTH = 460;

/* ── Status badges ──────────────────────────────────────────────────────── */

const RUN_STATUS_TONE: Record<string, { tone: BadgeTone; label: string }> = {
  queued: { tone: 'neutral', label: 'Queued' },
  running: { tone: 'accent', label: 'Running' },
  waiting: { tone: 'warning', label: 'Waiting' },
  completed: { tone: 'success', label: 'Completed' },
  failed: { tone: 'danger', label: 'Failed' },
  cancelled: { tone: 'neutral', label: 'Cancelled' },
};

export function RunStatusBadge({ status }: { status: string }) {
  const meta = RUN_STATUS_TONE[status] ?? { tone: 'neutral' as BadgeTone, label: status };
  return (
    <Badge size="sm" tone={meta.tone}>
      {meta.label}
    </Badge>
  );
}

const TRIGGER_TYPE_LABEL: Record<string, string> = {
  record_created: 'Record created',
  record_updated: 'Record updated',
  record_deleted: 'Record deleted',
  scheduled: 'Scheduled',
  webhook: 'Webhook',
  test: 'Test',
};

/* ── Step timeline (shared with the test-run panel) ─────────────────────── */

export type FlowStep = FlowTraceStepLike & {
  nodeType: string;
  error?: string | null;
  durationMs?: number | null;
};

function stepLabel(step: FlowStep, graph: FlowGraph | null): string {
  const node = graph?.nodes.find((n) => n.id === step.nodeId);
  if (node) return nodeTitle(node);
  // Synthetic forensics rows (max-depth notes) aren't graph nodes.
  if (step.nodeType === 'dispatch') return 'Dispatch';
  const entry = NODE_CATALOG[step.nodeType as FlowNodeType];
  return entry?.label ?? step.nodeType;
}

function summaryLines(summary: unknown): string[] {
  if (typeof summary !== 'object' || summary === null) return [];
  return Object.entries(summary as Record<string, unknown>)
    .filter(([key, v]) => key !== 'simulated' && (typeof v !== 'object' || v === null))
    .slice(0, 4)
    .map(([key, v]) => `${key}: ${v === null ? '—' : String(v)}`);
}

const STEP_DOT: Record<string, { icon: typeof Check; color: string }> = {
  completed: { icon: Check, color: 'var(--success)' },
  failed: { icon: X, color: 'var(--danger)' },
  skipped: { icon: Minus, color: 'var(--ink-muted)' },
};

export function FlowStepTimeline({
  steps,
  graph,
  onFocusNode,
}: {
  steps: FlowStep[];
  graph: FlowGraph | null;
  /** Pan the canvas to the step's node ("click-to-center"). */
  onFocusNode?: (nodeId: string) => void;
}) {
  if (steps.length === 0) {
    return <p className="text-muted-foreground text-xs">No steps recorded.</p>;
  }
  return (
    <Timeline>
      {steps.map((step, i) => {
        const dot = STEP_DOT[step.status] ?? STEP_DOT.completed;
        const Icon = (dot ?? { icon: Check }).icon;
        const simulated =
          typeof step.summary === 'object' &&
          step.summary !== null &&
          (step.summary as Record<string, unknown>).simulated === true;
        return (
          // biome-ignore lint/suspicious/noArrayIndexKey: trace steps are append-only and never reorder
          <TimelineItem key={i}>
            <TimelineDot>
              <Icon className="size-3.5" style={{ color: dot?.color }} />
            </TimelineDot>
            {i < steps.length - 1 && <TimelineConnector />}
            <TimelineContent className="pb-4">
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  className="truncate font-medium text-foreground text-sm hover:underline"
                  onClick={() => onFocusNode?.(step.nodeId)}
                >
                  {stepLabel(step, graph)}
                </button>
                {simulated && (
                  <Badge size="sm" variant="outline">
                    Simulated
                  </Badge>
                )}
                {typeof step.durationMs === 'number' && (
                  <span className="ml-auto shrink-0 text-muted-foreground text-xs tabular-nums">
                    {step.durationMs}ms
                  </span>
                )}
              </div>
              {summaryLines(step.summary).map((line) => (
                <div key={line} className="truncate font-mono text-muted-foreground text-xs">
                  {line}
                </div>
              ))}
              {step.error && (
                <div
                  className="mt-1 flex items-start gap-1.5 text-xs"
                  style={{ color: 'var(--danger)' }}
                >
                  <AlertCircle className="mt-px size-3.5 shrink-0" />
                  {step.error}
                </div>
              )}
            </TimelineContent>
          </TimelineItem>
        );
      })}
    </Timeline>
  );
}

/* ── Run detail ─────────────────────────────────────────────────────────── */

function RunDetail({
  runId,
  graph,
  onBack,
  onShowOnCanvas,
  onFocusNode,
}: {
  runId: string;
  graph: FlowGraph | null;
  onBack: () => void;
  onShowOnCanvas: (steps: FlowTraceStepLike[]) => void;
  onFocusNode?: (nodeId: string) => void;
}) {
  const utils = trpc.useUtils();
  const q = trpc.automation.runs.get.useQuery({ id: runId }, { refetchInterval: 5_000 });
  const cancel = trpc.automation.runs.cancel.useMutation({
    meta: { context: "Couldn't cancel the run" },
    onSuccess: () => utils.automation.runs.invalidate(),
  });
  const resume = trpc.automation.runs.resume.useMutation({
    meta: { context: "Couldn't resume the run" },
    onSuccess: () => utils.automation.runs.invalidate(),
  });

  if (q.isLoading) return <LoadingScreen size="sm" />;
  if (!q.data) return <p className="px-4 text-muted-foreground text-sm">Run not found.</p>;

  const { run, steps } = q.data;

  return (
    <div className="flex flex-col gap-3 px-4 pb-4">
      <div className="flex items-center gap-2">
        <Button variant="ghost" size="icon-sm" aria-label="Back to runs" onClick={onBack}>
          <ArrowLeft />
        </Button>
        <RunStatusBadge status={run.status} />
        <span className="text-muted-foreground text-xs">
          {TRIGGER_TYPE_LABEL[run.triggerType] ?? run.triggerType} · {timeAgo(run.createdAt)}
        </span>
        <div className="ml-auto flex items-center gap-1.5">
          {run.status === 'waiting' && (
            <Button
              variant="outline"
              size="sm"
              disabled={resume.isPending}
              onClick={() => resume.mutate({ id: run.id })}
            >
              Resume now
            </Button>
          )}
          {(run.status === 'queued' || run.status === 'waiting') && (
            <Button
              variant="ghost"
              size="sm"
              disabled={cancel.isPending}
              onClick={() => cancel.mutate({ id: run.id })}
            >
              Cancel
            </Button>
          )}
        </div>
      </div>

      {run.error && (
        <Callout variant="danger" icon={AlertCircle}>
          {run.error}
        </Callout>
      )}
      {run.status === 'waiting' && run.resumeAt && (
        <p className="text-muted-foreground text-xs">Resumes {timeAgo(run.resumeAt)}.</p>
      )}

      <div>
        <Button variant="outline" size="sm" onClick={() => onShowOnCanvas(steps)}>
          <Route />
          Show on canvas
        </Button>
      </div>

      <FlowStepTimeline steps={steps} graph={graph} onFocusNode={onFocusNode} />
    </div>
  );
}

/* ── Drawer ─────────────────────────────────────────────────────────────── */

export function RunHistoryDrawer({
  flowId,
  graph,
  open,
  onClose,
  onShowOnCanvas,
  onFocusNode,
}: {
  flowId: string;
  graph: FlowGraph | null;
  open: boolean;
  onClose: () => void;
  /** Paint a run's trace onto the canvas overlay (also closes the drawer). */
  onShowOnCanvas: (steps: FlowTraceStepLike[]) => void;
  onFocusNode?: (nodeId: string) => void;
}) {
  const [runId, setRunId] = useState<string | null>(null);
  const q = trpc.automation.runs.list.useQuery(
    { flowId, limit: 50, offset: 0 },
    { enabled: open, refetchInterval: open ? 10_000 : false },
  );

  return (
    <AnimatePresence>
      {open && (
        <motion.aside
          initial={{ x: DRAWER_WIDTH }}
          animate={{ x: 0 }}
          exit={{ x: DRAWER_WIDTH }}
          transition={{ duration: 0.28, ease: [0.16, 1, 0.3, 1] }}
          className="fixed inset-y-0 right-0 z-40 flex flex-col border-l bg-background shadow-xl"
          style={{ width: DRAWER_WIDTH }}
          aria-label="Run history"
        >
          <div className="flex items-center gap-2 border-b px-4 py-3">
            <History className="size-4 text-muted-foreground" />
            <span className="font-medium text-sm">Run history</span>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="Close run history"
              className="ml-auto"
              onClick={onClose}
            >
              <X />
            </Button>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto py-3">
            {runId ? (
              <RunDetail
                runId={runId}
                graph={graph}
                onBack={() => setRunId(null)}
                onShowOnCanvas={(steps) => {
                  onShowOnCanvas(steps);
                  onClose();
                }}
                onFocusNode={onFocusNode}
              />
            ) : q.isLoading ? (
              <LoadingScreen size="sm" />
            ) : (q.data ?? []).length === 0 ? (
              <EmptyState
                icon={History}
                title="No runs yet"
                body="Activate the flow (or use Test) and runs will land here with a full step trace."
                size="sm"
              />
            ) : (
              <ul className="flex flex-col">
                {(q.data ?? []).map((run) => {
                  const duration =
                    run.startedAt && run.completedAt
                      ? Math.max(
                          0,
                          new Date(run.completedAt).getTime() - new Date(run.startedAt).getTime(),
                        )
                      : null;
                  return (
                    <li key={run.id}>
                      <button
                        type="button"
                        className="flex w-full items-center gap-2.5 px-4 py-2.5 text-left transition-colors hover:bg-muted/60"
                        onClick={() => setRunId(run.id)}
                      >
                        <RunStatusBadge status={run.status} />
                        <span className="min-w-0 flex-1 truncate text-sm">
                          {TRIGGER_TYPE_LABEL[run.triggerType] ?? run.triggerType}
                        </span>
                        <span className="shrink-0 text-muted-foreground text-xs tabular-nums">
                          {run.stepCount} steps
                          {duration !== null && ` · ${(duration / 1000).toFixed(1)}s`}
                        </span>
                        <span className="shrink-0 text-muted-foreground text-xs">
                          {timeAgo(run.createdAt)}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </motion.aside>
      )}
    </AnimatePresence>
  );
}
