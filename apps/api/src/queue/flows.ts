// The flow-run queue — the post-commit half of the run-row outbox. Dispatch
// inserts `queued` flow_run rows inside the mutation transaction; after commit
// a postCommit hook enqueues one job per run here. Delivery is at-least-once
// by design: the worker's claimRun UPDATE (status queued/waiting → running) is
// the sole idempotency gate, and the sweeper re-enqueues anything that slipped
// between commit and enqueue.

import { type JobsOptions, Queue } from 'bullmq';
import { redis } from './connection.js';

export const FLOW_RUN_QUEUE = 'flow-runs';

export type FlowRunJobData = {
  orgId: string;
  runId: string;
  /** Present on resume jobs — the worker passes it to claimRun so a stale
   *  delayed job (superseded by a re-park or the sweeper) loses the race. */
  resumeToken?: string;
};

/** Everything the flow-runs queue carries: run/resume jobs, scheduled-flow
 *  fires ('scheduled-fire'), and the payload-less maintenance jobs ('sweep',
 *  'reconcile-schedules'). The worker discriminates on job NAME and validates
 *  each payload with zod at the boundary. */
export type FlowQueueJobData =
  | FlowRunJobData
  | { orgId: string; flowId: string }
  | Record<string, never>;

const DEFAULT_OPTS: JobsOptions = {
  // attempts: 1 — a run's writes are not idempotent; retry semantics belong to
  // the claim gate + sweeper, never to BullMQ redelivery.
  attempts: 1,
  removeOnComplete: { count: 200, age: 24 * 60 * 60 },
  removeOnFail: { count: 500, age: 7 * 24 * 60 * 60 },
};

let cached: Queue<FlowQueueJobData> | undefined;

export function flowRunQueue(): Queue<FlowQueueJobData> {
  if (cached) return cached;
  cached = new Queue<FlowQueueJobData>(FLOW_RUN_QUEUE, {
    connection: redis(),
    defaultJobOptions: DEFAULT_OPTS,
  });
  return cached;
}

/** Enqueue execution of a queued run. Called from postCommit hooks and the
 *  sweeper — never inside the transaction that created the run row. Pass
 *  `delayMs` to back off (the worker re-delays when an org is at its
 *  running-runs cap; a fresh unkeyed job is used because a resume job's id is
 *  pinned to its token and BullMQ ignores re-adds of a completed job id). */
export async function enqueueFlowRun(
  data: FlowRunJobData,
  opts: { delayMs?: number } = {},
): Promise<void> {
  await flowRunQueue().add(
    'run',
    data,
    opts.delayMs !== undefined ? { delay: Math.max(0, opts.delayMs) } : {},
  );
}

/** Delayed wake-up for a parked (`waiting`) run. The job id pins the resume
 *  token, so re-parking with a fresh token strands the old delayed job — it
 *  fires, claimRun's token match fails, and it exits as a no-op. */
export async function enqueueFlowResume(
  data: { orgId: string; runId: string; resumeToken: string },
  delayMs: number,
): Promise<void> {
  await flowRunQueue().add('resume', data, {
    delay: Math.max(0, delayMs),
    jobId: `resume:${data.runId}:${data.resumeToken}`,
  });
}
