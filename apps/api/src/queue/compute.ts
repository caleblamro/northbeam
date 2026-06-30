// The compute backfill queue. The synchronous write path keeps a record's own
// computed fields correct in-transaction; this queue handles *bulk* recompute —
// the post-import pass (populate formulas/rollups across a freshly-imported
// object) and (future) re-backfilling every row when a formula/rollup
// definition is added or edited. The worker pages through the object's records.
//
// One job per (org, object); the job id dedupes concurrent backfills of the
// same object.

import { type JobsOptions, Queue } from 'bullmq';
import { redis } from './connection.js';

export const COMPUTE_QUEUE = 'compute';

export type ComputeJobData = {
  orgId: string;
  objectKey: string;
  /** free-form provenance for logs (e.g. 'import', 'field-change'). */
  reason?: string;
};

const DEFAULT_OPTS: JobsOptions = {
  attempts: 3,
  backoff: { type: 'exponential', delay: 2000 },
  removeOnComplete: { count: 50, age: 7 * 24 * 60 * 60 },
  removeOnFail: { count: 100, age: 30 * 24 * 60 * 60 },
};

let cached: Queue<ComputeJobData> | undefined;

export function computeQueue(): Queue<ComputeJobData> {
  if (cached) return cached;
  cached = new Queue<ComputeJobData>(COMPUTE_QUEUE, {
    connection: redis(),
    defaultJobOptions: DEFAULT_OPTS,
  });
  return cached;
}

/** Enqueue a bulk recompute of every record of an object. Job id = org:object
 *  so overlapping requests collapse to one in-flight backfill. */
export async function enqueueCompute(data: ComputeJobData): Promise<void> {
  await computeQueue().add('backfill', data, { jobId: `${data.orgId}:${data.objectKey}` });
}
