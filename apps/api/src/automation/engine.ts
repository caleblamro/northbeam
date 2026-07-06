// The flow engine: claim → load version → drive the pure walker, executing
// one node per iteration → terminal persist. Two hosts share the same drive
// loop:
//   runFlow      — durable worker path. claimRun is the SINGLE idempotency
//                  gate (queue jobs, delayed resumes, and the sweeper all
//                  race; whoever wins the guarded UPDATE owns the run).
//                  Every executor runs in its own RLS-scoped transaction and
//                  every persisted step doubles as a heartbeat (insertStep
//                  bumps flowRun.updatedAt), so the sweeper can distinguish
//                  a slow run from a dead one.
//   dryRunGraph  — automation.testRun. Real reads, simulated side effects,
//                  waits short-circuit, NOTHING persists; the ordered step
//                  trace is the return value.
//
// Counter contract: flowRun.stepCount is owned by insertStep (one bump per
// persisted step, including dispatch forensics on this run as a parent);
// WalkState.stepCount seeds from that column at claim and advances in memory.
// The two drift by at most one around a wait — the walker budget is a cap,
// not an exact ledger — and neither is ever written back over the other, so
// stepIndex values never repeat within a run.

import { randomUUID } from 'node:crypto';
import {
  type FlowGraph,
  FlowGraphSchema,
  type FlowNode,
  type FlowTrigger,
  FlowTriggerSchema,
  logger,
} from '@northbeam/core';
import {
  type Database,
  type DbExecutor,
  type FlowRunContext,
  cancelRun,
  claimRun,
  completeRun,
  failRun,
  getFlow,
  getFlowVersion,
  getObjectById,
  insertStep,
  parkRun,
  withOrgContext,
} from '@northbeam/db';
import { enqueueFlowResume } from '../queue/flows.js';
import { type ConditionField, evaluateFlowCondition } from './condition.js';
import { type RunContext, buildScope, getVar } from './context.js';
import {
  type ExecResult,
  type ExecServices,
  type FlowFacts,
  executeNode,
  executeWaitResume,
} from './executors/index.js';
import { type WalkInput, type WalkState, advance, triggerNodeOf } from './walker.js';

/** One entry of the run trace — persisted as a flow_run_step row in durable
 *  mode, returned in-order by dryRunGraph. nodeType can also be the synthetic
 *  'dispatch' (max-depth forensics) in persisted traces. */
export type FlowTraceStep = {
  nodeId: string;
  nodeType: string;
  status: 'completed' | 'failed' | 'skipped';
  summary: Record<string, unknown>;
  error?: string;
  durationMs: number;
};

type DriveOutcome =
  | { kind: 'completed' }
  | { kind: 'ended'; reason: string }
  | { kind: 'failed'; error: string; nodeId: string }
  | { kind: 'parked'; nodeId: string; resumeAt: Date };

type DriveHost = {
  services: ExecServices;
  emitStep: (step: FlowTraceStep) => Promise<void>;
};

/** Evaluate a decision node's outcomes in order; null = take the default
 *  edge. Broken conditions skip their outcome with a warning (fail policy:
 *  never route on a guess). */
function evaluateDecision(
  node: Extract<FlowNode, { type: 'decision' }>,
  ctx: RunContext,
  services: ExecServices,
): { outcomeId: string | null; warnings: string[] } {
  const data = ctx.record ?? {};
  const warnings: string[] = [];
  const scopes = buildScope(ctx, {
    now: services.now(),
    ...(services.user !== undefined && services.user !== null ? { user: services.user } : {}),
  });
  for (const outcome of node.config.outcomes) {
    const result = evaluateFlowCondition(outcome.condition, {
      data,
      ...(ctx.oldRecord !== undefined ? { oldData: ctx.oldRecord } : {}),
      scopes,
      fields: services.fields,
      now: services.now(),
    });
    if (result.warning) warnings.push(`outcome '${outcome.id}': ${result.warning}`);
    if (result.matched) return { outcomeId: outcome.id, warnings };
  }
  return { outcomeId: null, warnings };
}

/** Drive the graph from `startAt` until it completes, fails, or parks.
 *  Mutates ctx (executors write vars/record) and keeps ctx.loopFrames in
 *  lockstep with the walker state so persisted context is always resumable. */
async function drive(
  graph: FlowGraph,
  ctx: RunContext,
  state: WalkState,
  startAt: string,
  resuming: boolean,
  host: DriveHost,
): Promise<DriveOutcome> {
  const { services, emitStep } = host;
  let at = startAt;
  let resumingHere = resuming;
  let current = state;

  for (;;) {
    const node = graph.nodes.find((n) => n.id === at);
    if (!node) return { kind: 'failed', error: `unknown node '${at}'`, nodeId: at };
    const startedMs = Date.now();
    const done = (
      status: FlowTraceStep['status'],
      summary: Record<string, unknown>,
      error?: string,
    ) =>
      emitStep({
        nodeId: node.id,
        nodeType: node.type,
        status,
        summary,
        ...(error !== undefined ? { error } : {}),
        durationMs: Date.now() - startedMs,
      });

    let input: WalkInput;

    if (node.type === 'decision') {
      const { outcomeId, warnings } = evaluateDecision(node, ctx, services);
      await done('completed', {
        outcome: outcomeId ?? 'default',
        ...(warnings.length ? { warnings } : {}),
      });
      input = { kind: 'decision', outcomeId };
    } else if (node.type === 'loop') {
      const items = getVar(ctx, node.config.sourceVar);
      const itemCount = Array.isArray(items) ? items.length : 0;
      const top = current.loopFrames[current.loopFrames.length - 1];
      const isReturn = top !== undefined && top.loopNodeId === node.id;
      // One trace step per loop ENTRY, not per iteration — a 200-item loop
      // must not write 200 identical rows.
      if (!isReturn) {
        await done('completed', { sourceVar: node.config.sourceVar, items: itemCount });
      }
      input = { kind: 'loop', itemCount };
    } else {
      let result: ExecResult;
      if (node.type === 'wait' && resumingHere && !services.dryRun) {
        result = await executeWaitResume(node, ctx, services);
      } else {
        result = await executeNode(node, ctx, services);
      }
      if (result.kind === 'fail') {
        await done('failed', result.summary ?? {}, result.error);
        return { kind: 'failed', error: result.error, nodeId: node.id };
      }
      if (result.kind === 'end') {
        await done('skipped', { ...result.summary, reason: result.reason });
        return { kind: 'ended', reason: result.reason };
      }
      if (result.kind === 'park') {
        await done('completed', result.summary);
        return { kind: 'parked', nodeId: node.id, resumeAt: result.resumeAt };
      }
      await done('completed', result.summary);
      input = { kind: 'linear' };
    }

    const step = advance(graph, current, at, input);
    if (step.kind === 'error') {
      return { kind: 'failed', error: step.message, nodeId: step.nodeId ?? at };
    }
    current = step.state;
    // The walker owns the frame stack; the context mirrors it so buildScope
    // (loopItem) and persistence stay coherent.
    ctx.loopFrames = current.loopFrames;
    if (step.kind === 'done') return { kind: 'completed' };
    at = step.nodeId;
    resumingHere = false;
  }
}

/* ── Durable path ────────────────────────────────────────────────────────── */

/** Sanitize the working context for persistence (cursor handled per-call). */
function persistableContext(ctx: RunContext, cursorNodeId?: string): FlowRunContext {
  const { cursorNodeId: _stale, ...rest } = ctx;
  return { ...rest, ...(cursorNodeId !== undefined ? { cursorNodeId } : {}) };
}

async function conditionFields(
  db: Database,
  orgId: string,
  objectId: string | null,
): Promise<ConditionField[]> {
  if (!objectId) return [];
  const owf = await withOrg(db, orgId, (tx) => getObjectById(tx, orgId, objectId));
  return owf ? owf.fields.map((f) => ({ key: f.key, type: f.type })) : [];
}

async function withOrg<T>(
  db: Database,
  orgId: string,
  fn: (tx: DbExecutor) => Promise<T>,
): Promise<T> {
  return withOrgContext(db, orgId, fn);
}

export type RunFlowJob = { orgId: string; runId: string; resumeToken?: string };

/** Execute (or resume) one flow run end-to-end. Safe to call concurrently
 *  from racing jobs — losers of the claim exit as no-ops. Never throws for
 *  run-level failures (they land on the run row); only infrastructure
 *  failures (db down) propagate to the worker. */
export async function runFlow(db: Database, job: RunFlowJob): Promise<void> {
  const { orgId, runId } = job;
  const run = await withOrg(db, orgId, (tx) =>
    claimRun(
      tx,
      orgId,
      runId,
      job.resumeToken !== undefined ? { resumeToken: job.resumeToken } : {},
    ),
  );
  if (!run) {
    logger.debug({ orgId, runId }, 'flow.run.claim_lost');
    return;
  }

  const fatal = async (error: string) => {
    await withOrg(db, orgId, (tx) => failRun(tx, orgId, runId, error));
    logger.warn({ orgId, runId, error }, 'flow.run.failed');
  };

  const loaded = await withOrg(db, orgId, async (tx) => ({
    flow: await getFlow(tx, orgId, run.flowId),
    version: await getFlowVersion(tx, orgId, run.flowVersionId),
  }));
  if (!loaded.flow || !loaded.version) {
    await fatal('flow or version no longer exists');
    return;
  }
  const graphParsed = FlowGraphSchema.safeParse(loaded.version.graph);
  const triggerParsed = FlowTriggerSchema.safeParse(loaded.version.trigger);
  if (!graphParsed.success) {
    await fatal('active version graph failed to parse');
    return;
  }
  const graph = graphParsed.data;
  const trigger: FlowTrigger | null = triggerParsed.success ? triggerParsed.data : null;

  const ctx: RunContext = { vars: {}, ...((run.context ?? {}) as RunContext) };
  if (ctx.vars === undefined) ctx.vars = {};
  const state: WalkState = { loopFrames: ctx.loopFrames ?? [], stepCount: run.stepCount };
  const resuming = ctx.cursorNodeId !== undefined && ctx.cursorNodeId !== null;
  const triggerNode = triggerNodeOf(graph);
  const startAt = resuming ? (ctx.cursorNodeId as string) : triggerNode?.id;
  if (!startAt) {
    await fatal('graph has no trigger node');
    return;
  }

  const flowFacts: FlowFacts = {
    id: loaded.flow.id,
    name: loaded.flow.name,
    objectId: loaded.flow.objectId,
  };
  const services: ExecServices = {
    orgId,
    flow: flowFacts,
    trigger,
    runId,
    recordId: run.recordId,
    depth: run.depth,
    dryRun: false,
    now: () => new Date(),
    user: ctx.actorUserId ? { id: ctx.actorUserId } : null,
    fields: await conditionFields(db, orgId, loaded.flow.objectId),
    tx: (fn) => withOrg(db, orgId, fn),
  };

  const emitStep = async (step: FlowTraceStep) => {
    await withOrg(db, orgId, (tx) =>
      insertStep(tx, {
        organizationId: orgId,
        runId,
        nodeId: step.nodeId,
        nodeType: step.nodeType,
        status: step.status,
        summary: step.summary,
        error: step.error ?? null,
        durationMs: step.durationMs,
      }),
    );
  };

  let outcome: DriveOutcome;
  try {
    outcome = await drive(graph, ctx, state, startAt, resuming, { services, emitStep });
  } catch (err) {
    // Executor throws are already converted to fail results; reaching here
    // means infrastructure broke mid-run. Record what we can and rethrow so
    // the worker's failed-handler logs it too.
    const message = err instanceof Error ? err.message : String(err);
    await fatal(`engine error: ${message}`);
    throw err;
  }

  if (outcome.kind === 'completed') {
    await withOrg(db, orgId, (tx) =>
      completeRun(tx, orgId, runId, { context: persistableContext(ctx) }),
    );
    logger.info({ orgId, runId, flowId: run.flowId, outcome: outcome.kind }, 'flow.run.completed');
    return;
  }
  if (outcome.kind === 'ended') {
    // Wait-node self-cancellation (record gone / entry unmet at fire time) —
    // SF scheduled-path parity: the run is cancelled, not completed. Safe on a
    // running row here because this worker owns the claim.
    await withOrg(db, orgId, (tx) =>
      cancelRun(tx, orgId, runId, outcome.reason, { includeRunning: true }),
    );
    logger.info({ orgId, runId, flowId: run.flowId, reason: outcome.reason }, 'flow.run.cancelled');
    return;
  }
  if (outcome.kind === 'failed') {
    await withOrg(db, orgId, (tx) =>
      failRun(tx, orgId, runId, outcome.error, { context: persistableContext(ctx) }),
    );
    logger.warn(
      { orgId, runId, flowId: run.flowId, nodeId: outcome.nodeId, error: outcome.error },
      'flow.run.failed',
    );
    return;
  }

  // Parked: persist state + a fresh resume token, then arm the delayed job.
  // The token pins the wake-up — a re-park or sweeper claim invalidates any
  // older delayed job (claimRun's token match fails, it exits as a no-op).
  const resumeToken = randomUUID();
  const parked = await withOrg(db, orgId, (tx) =>
    parkRun(tx, orgId, runId, {
      context: persistableContext(ctx, outcome.nodeId),
      resumeAt: outcome.resumeAt,
      resumeToken,
    }),
  );
  if (!parked) {
    logger.warn({ orgId, runId }, 'flow.run.park_lost');
    return;
  }
  await enqueueFlowResume({ orgId, runId, resumeToken }, outcome.resumeAt.getTime() - Date.now());
  logger.info(
    { orgId, runId, flowId: run.flowId, resumeAt: outcome.resumeAt.toISOString() },
    'flow.run.parked',
  );
}

/* ── Dry-run path (automation.testRun) ───────────────────────────────────── */

export type DryRunOptions = {
  orgId: string;
  flow: FlowFacts;
  graph: FlowGraph;
  /** Seed context — record/oldRecord/vars/webhookBody as the caller wants
   *  the simulated trigger to look. */
  context: RunContext;
  /** Trigger record id, for target resolution previews. */
  recordId?: string | null;
  /** Reads run through here — testRun passes its own RLS-scoped tx. */
  tx: <T>(fn: (tx: DbExecutor) => Promise<T>) => Promise<T>;
  /** `{{user}}` scope (the caller's snapshot). */
  user?: unknown;
  fields?: ConditionField[];
  now?: () => Date;
};

export type DryRunResult = {
  status: 'completed' | 'failed';
  steps: FlowTraceStep[];
  error?: string;
  errorNodeId?: string;
  /** Reason when the run ended early but successfully (wait cancel). */
  endedReason?: string;
  vars: Record<string, unknown>;
};

/** Synchronous dry-run: real reads, simulated side effects, waits
 *  short-circuit, nothing persists. The trace is the product. */
export async function dryRunGraph(opts: DryRunOptions): Promise<DryRunResult> {
  const graph = opts.graph;
  const triggerNode = triggerNodeOf(graph);
  if (!triggerNode) {
    return { status: 'failed', error: 'graph has no trigger node', steps: [], vars: {} };
  }
  const ctx: RunContext = { vars: {}, ...opts.context };
  if (ctx.vars === undefined) ctx.vars = {};
  const trigger = FlowTriggerSchema.safeParse(triggerNode);
  const services: ExecServices = {
    orgId: opts.orgId,
    flow: opts.flow,
    trigger: trigger.success ? trigger.data : null,
    runId: null,
    recordId: opts.recordId ?? null,
    depth: 0,
    dryRun: true,
    now: opts.now ?? (() => new Date()),
    user: opts.user ?? null,
    fields: opts.fields ?? [],
    tx: opts.tx,
  };
  const steps: FlowTraceStep[] = [];
  const outcome = await drive(
    graph,
    ctx,
    { loopFrames: ctx.loopFrames ?? [], stepCount: 0 },
    triggerNode.id,
    false,
    {
      services,
      emitStep: async (step) => {
        steps.push(step);
      },
    },
  );
  const vars = ctx.vars ?? {};
  if (outcome.kind === 'failed') {
    return {
      status: 'failed',
      steps,
      error: outcome.error,
      errorNodeId: outcome.nodeId,
      vars,
    };
  }
  if (outcome.kind === 'parked') {
    // Unreachable — dry-run waits never park; keep the trace honest anyway.
    return { status: 'completed', steps, endedReason: 'parked (unexpected in dry-run)', vars };
  }
  return {
    status: 'completed',
    steps,
    ...(outcome.kind === 'ended' ? { endedReason: outcome.reason } : {}),
    vars,
  };
}
