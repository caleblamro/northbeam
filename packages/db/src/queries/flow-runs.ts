// Flow run lifecycle — the durable-job side of the automation engine.
//
// Concurrency model: runs are inserted `queued` inside the triggering
// transaction (outbox pattern) and enqueued post-commit. Workers, delayed
// resume jobs, and the sweeper can all race to execute the same run; the
// status-guarded claimRun UPDATE is the SINGLE idempotency gate — whoever
// gets the row back owns the run, everyone else gets null and drops the job.
// flowRun.updatedAt doubles as the worker heartbeat.
//
// The sweeper queries are cross-org by design: they must run on a connection
// where RLS is not enforced (the worker's owner-role connection) — under the
// enforced app role with no app.org_id GUC they return nothing.

import { and, asc, desc, eq, inArray, isNotNull, lt, lte, sql } from 'drizzle-orm';
import type { DbExecutor } from '../client.js';
import {
  type FlowRunContext,
  type FlowRunStatus,
  type FlowRunStepStatus,
  type FlowRunTriggerType,
  flowRun,
  flowRunStep,
} from '../schema.js';

export type FlowRunRow = typeof flowRun.$inferSelect;
export type FlowRunStepRow = typeof flowRunStep.$inferSelect;

export type NewFlowRunInput = {
  organizationId: string;
  flowId: string;
  flowVersionId: string;
  triggerType: FlowRunTriggerType;
  objectId?: string | null;
  recordId?: string | null;
  context?: FlowRunContext;
  depth?: number;
  triggeredByRunId?: string | null;
};

/** Bulk-insert queued runs (one dispatch can match many flows). Call inside
 *  the triggering transaction so the outbox rows commit atomically with the
 *  record write. Empty input is a no-op. */
export async function createRuns(db: DbExecutor, runs: NewFlowRunInput[]): Promise<FlowRunRow[]> {
  if (runs.length === 0) return [];
  return db.insert(flowRun).values(runs).returning();
}

/** Claim a run for execution — the idempotency gate. Only `queued`/`waiting`
 *  rows can be claimed; pass `resumeToken` when resuming a wait so a stale
 *  delayed job (superseded by a re-park or the sweeper) loses the race.
 *  startedAt is preserved across park/resume cycles; the resume slots clear
 *  so the sweeper never double-fires a claimed run. */
export async function claimRun(
  db: DbExecutor,
  orgId: string,
  id: string,
  opts: { resumeToken?: string } = {},
): Promise<FlowRunRow | null> {
  const conditions = [
    eq(flowRun.organizationId, orgId),
    eq(flowRun.id, id),
    inArray(flowRun.status, ['queued', 'waiting']),
  ];
  if (opts.resumeToken !== undefined) conditions.push(eq(flowRun.resumeToken, opts.resumeToken));
  const [row] = await db
    .update(flowRun)
    .set({
      status: 'running',
      startedAt: sql`coalesce(${flowRun.startedAt}, now())`,
      resumeAt: null,
      resumeToken: null,
      updatedAt: new Date(),
    })
    .where(and(...conditions))
    .returning();
  return row ?? null;
}

/** Park a running run at a wait node: persist the walker state and arm the
 *  resume slots. `resumeToken` must be fresh per park — resume claims match
 *  on it. `resumeAt` null means a delayed job exclusively owns the wake-up
 *  (the sweeper's overdue-waiting scan skips the row). */
export async function parkRun(
  db: DbExecutor,
  orgId: string,
  id: string,
  input: {
    context: FlowRunContext;
    resumeAt: Date | null;
    resumeToken: string;
    stepCount?: number;
  },
): Promise<FlowRunRow | null> {
  const [row] = await db
    .update(flowRun)
    .set({
      status: 'waiting',
      context: input.context,
      resumeAt: input.resumeAt,
      resumeToken: input.resumeToken,
      ...(input.stepCount !== undefined ? { stepCount: input.stepCount } : {}),
      updatedAt: new Date(),
    })
    .where(
      and(eq(flowRun.organizationId, orgId), eq(flowRun.id, id), eq(flowRun.status, 'running')),
    )
    .returning();
  return row ?? null;
}

export async function completeRun(
  db: DbExecutor,
  orgId: string,
  id: string,
  patch: { context?: FlowRunContext; stepCount?: number } = {},
): Promise<FlowRunRow | null> {
  const [row] = await db
    .update(flowRun)
    .set({
      status: 'completed',
      completedAt: new Date(),
      ...(patch.context !== undefined ? { context: patch.context } : {}),
      ...(patch.stepCount !== undefined ? { stepCount: patch.stepCount } : {}),
      updatedAt: new Date(),
    })
    .where(
      and(eq(flowRun.organizationId, orgId), eq(flowRun.id, id), eq(flowRun.status, 'running')),
    )
    .returning();
  return row ?? null;
}

/** Terminal failure — engine fail-fast or sweeper stale-heartbeat kill.
 *  Guarded to non-terminal statuses so a late failure can't clobber a
 *  completed/cancelled run. */
export async function failRun(
  db: DbExecutor,
  orgId: string,
  id: string,
  error: string,
  patch: { context?: FlowRunContext; stepCount?: number } = {},
): Promise<FlowRunRow | null> {
  const [row] = await db
    .update(flowRun)
    .set({
      status: 'failed',
      error,
      completedAt: new Date(),
      ...(patch.context !== undefined ? { context: patch.context } : {}),
      ...(patch.stepCount !== undefined ? { stepCount: patch.stepCount } : {}),
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(flowRun.organizationId, orgId),
        eq(flowRun.id, id),
        inArray(flowRun.status, ['queued', 'running', 'waiting']),
      ),
    )
    .returning();
  return row ?? null;
}

/** Cancel a run that has not been claimed (queued) or is parked (waiting).
 *  Running runs are owned by a worker mid-flight — cancelling them races the
 *  engine, so they are excluded by default; the sweeper handles ones that die.
 *  `includeRunning` is reserved for the claim OWNER (the engine cancelling its
 *  own claimed run when a wait resume finds the record gone / entry unmet) —
 *  external callers must never pass it. */
export async function cancelRun(
  db: DbExecutor,
  orgId: string,
  id: string,
  reason?: string,
  opts: { includeRunning?: boolean } = {},
): Promise<FlowRunRow | null> {
  const [row] = await db
    .update(flowRun)
    .set({
      status: 'cancelled',
      ...(reason !== undefined ? { error: reason } : {}),
      completedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(flowRun.organizationId, orgId),
        eq(flowRun.id, id),
        inArray(
          flowRun.status,
          opts.includeRunning ? ['queued', 'waiting', 'running'] : ['queued', 'waiting'],
        ),
      ),
    )
    .returning();
  return row ?? null;
}

/** Touch updatedAt so the sweeper's stale-heartbeat scan keeps its hands off
 *  a long-but-alive run. Only meaningful while running. */
export async function heartbeatRun(db: DbExecutor, orgId: string, id: string): Promise<void> {
  await db
    .update(flowRun)
    .set({ updatedAt: new Date() })
    .where(
      and(eq(flowRun.organizationId, orgId), eq(flowRun.id, id), eq(flowRun.status, 'running')),
    );
}

/** Append a step to the run's trace. Increments flowRun.stepCount and uses
 *  the pre-increment value as stepIndex (deterministic ordering — startedAt
 *  can tie), and bumps updatedAt so every step doubles as a heartbeat. Safe
 *  without a wrapping tx: a claimed run has exactly one executor. */
export async function insertStep(
  db: DbExecutor,
  input: {
    organizationId: string;
    runId: string;
    nodeId: string;
    nodeType: string;
    status: FlowRunStepStatus;
    summary?: Record<string, unknown>;
    error?: string | null;
    startedAt?: Date;
    durationMs?: number;
  },
): Promise<FlowRunStepRow> {
  const [run] = await db
    .update(flowRun)
    .set({ stepCount: sql`${flowRun.stepCount} + 1`, updatedAt: new Date() })
    .where(and(eq(flowRun.organizationId, input.organizationId), eq(flowRun.id, input.runId)))
    .returning({ stepCount: flowRun.stepCount });
  if (!run) throw new Error('flow run step insert: run not found');
  const [row] = await db
    .insert(flowRunStep)
    .values({
      organizationId: input.organizationId,
      runId: input.runId,
      stepIndex: run.stepCount - 1,
      nodeId: input.nodeId,
      nodeType: input.nodeType,
      status: input.status,
      summary: input.summary ?? {},
      error: input.error ?? null,
      ...(input.startedAt !== undefined ? { startedAt: input.startedAt } : {}),
      durationMs: input.durationMs ?? 0,
    })
    .returning();
  if (!row) throw new Error('flow run step insert returned no row');
  return row;
}

/** Page of runs, newest first — org-wide or narrowed to one flow. */
export async function listRuns(
  db: DbExecutor,
  orgId: string,
  opts: {
    flowId?: string;
    status?: FlowRunStatus;
    limit?: number;
    offset?: number;
  } = {},
): Promise<FlowRunRow[]> {
  const conditions = [eq(flowRun.organizationId, orgId)];
  if (opts.flowId !== undefined) conditions.push(eq(flowRun.flowId, opts.flowId));
  if (opts.status !== undefined) conditions.push(eq(flowRun.status, opts.status));
  return db
    .select()
    .from(flowRun)
    .where(and(...conditions))
    .orderBy(desc(flowRun.createdAt))
    .limit(opts.limit ?? 50)
    .offset(opts.offset ?? 0);
}

export async function getRunWithSteps(
  db: DbExecutor,
  orgId: string,
  id: string,
): Promise<{ run: FlowRunRow; steps: FlowRunStepRow[] } | null> {
  const [run] = await db
    .select()
    .from(flowRun)
    .where(and(eq(flowRun.organizationId, orgId), eq(flowRun.id, id)))
    .limit(1);
  if (!run) return null;
  const steps = await db
    .select()
    .from(flowRunStep)
    .where(and(eq(flowRunStep.organizationId, orgId), eq(flowRunStep.runId, id)))
    .orderBy(asc(flowRunStep.stepIndex));
  return { run, steps };
}

/** Slim cross-org row the sweeper re-enqueues from. */
export type SweeperRunRef = {
  id: string;
  organizationId: string;
  flowId: string;
  resumeToken: string | null;
};

const sweeperColumns = {
  id: flowRun.id,
  organizationId: flowRun.organizationId,
  flowId: flowRun.flowId,
  resumeToken: flowRun.resumeToken,
};

/** `queued` runs whose post-commit enqueue evidently never landed (process
 *  died between commit and enqueue) — re-enqueue them. */
export async function staleQueuedRuns(
  db: DbExecutor,
  olderThan: Date,
  limit = 100,
): Promise<SweeperRunRef[]> {
  return db
    .select(sweeperColumns)
    .from(flowRun)
    .where(and(eq(flowRun.status, 'queued'), lt(flowRun.createdAt, olderThan)))
    .orderBy(asc(flowRun.createdAt))
    .limit(limit);
}

/** `waiting` runs past their resumeAt — the delayed resume job was lost or
 *  is late. Rows with NULL resumeAt are exclusively job-owned and skipped. */
export async function overdueWaitingRuns(
  db: DbExecutor,
  now: Date,
  limit = 100,
): Promise<SweeperRunRef[]> {
  return db
    .select(sweeperColumns)
    .from(flowRun)
    .where(
      and(eq(flowRun.status, 'waiting'), isNotNull(flowRun.resumeAt), lte(flowRun.resumeAt, now)),
    )
    .orderBy(asc(flowRun.resumeAt))
    .limit(limit);
}

/** `running` runs whose heartbeat (updatedAt) has gone stale — the worker
 *  died mid-run. The sweeper fails them (writes aren't idempotent, so no
 *  automatic retry). */
export async function staleRunningRuns(
  db: DbExecutor,
  heartbeatOlderThan: Date,
  limit = 100,
): Promise<SweeperRunRef[]> {
  return db
    .select(sweeperColumns)
    .from(flowRun)
    .where(and(eq(flowRun.status, 'running'), lt(flowRun.updatedAt, heartbeatOlderThan)))
    .orderBy(asc(flowRun.updatedAt))
    .limit(limit);
}
