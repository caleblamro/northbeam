// Two-way Salesforce sync queue: write-back pushes + the repeatable poll tick.
//
// Write-back jobs are keyed org:objectKey:recordId with a short delay so a
// burst of edits to one record coalesces into a single push (the outbox row
// carries the unioned dirty keys; the job merely names the record). A job
// arriving while its twin is still delayed is dropped by BullMQ — harmless,
// the existing job reads current state at run time.
//
// The poll tick is a per-org repeatable job (added/removed when the admin
// toggles pollEnabled) — deliberately gentle: one id+modstamp probe per
// imported object per tick.

import { type JobsOptions, Queue } from 'bullmq';
import { redis } from './connection.js';

export const SF_SYNC_QUEUE = 'sf-sync';

export type SfSyncJobData =
  | { kind: 'writeback'; orgId: string; objectKey: string; recordId: string }
  | { kind: 'poll'; orgId: string };

const WRITEBACK_COALESCE_MS = 3_000;
export const POLL_EVERY_MS = 15 * 60_000;

const DEFAULT_OPTS: JobsOptions = {
  attempts: 3,
  backoff: { type: 'exponential', delay: 10_000 },
  removeOnComplete: { count: 200, age: 24 * 60 * 60 },
  removeOnFail: { count: 500, age: 7 * 24 * 60 * 60 },
};

let cached: Queue<SfSyncJobData> | undefined;

export function sfSyncQueue(): Queue<SfSyncJobData> {
  if (cached) return cached;
  cached = new Queue<SfSyncJobData>(SF_SYNC_QUEUE, {
    connection: redis(),
    defaultJobOptions: DEFAULT_OPTS,
  });
  return cached;
}

export async function enqueueWriteback(data: {
  orgId: string;
  objectKey: string;
  recordId: string;
}): Promise<void> {
  await sfSyncQueue().add(
    'writeback',
    { kind: 'writeback', ...data },
    {
      jobId: `wb:${data.orgId}:${data.objectKey}:${data.recordId}`,
      delay: WRITEBACK_COALESCE_MS,
    },
  );
}

export async function schedulePoll(orgId: string): Promise<void> {
  await sfSyncQueue().add(
    'poll',
    { kind: 'poll', orgId },
    { repeat: { every: POLL_EVERY_MS }, jobId: `poll:${orgId}` },
  );
}

export async function cancelPoll(orgId: string): Promise<void> {
  await sfSyncQueue().removeRepeatable('poll', { every: POLL_EVERY_MS, jobId: `poll:${orgId}` });
}
