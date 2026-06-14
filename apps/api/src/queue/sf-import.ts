// The Salesforce-import job queue. The `salesforce.execute` mutation enqueues a
// job per run; the worker (apps/api/src/workers/sf-import-worker.ts) consumes
// them off-thread so the HTTP request returns instantly and a large org doesn't
// block the API event loop.
//
// Job naming: one queue ('sf-import'), one job per migration run, keyed by
// runId so a double-click on Execute is idempotent at the queue layer too.

import { Queue, type JobsOptions } from 'bullmq';
import { redis } from './connection.js';

export const SF_IMPORT_QUEUE = 'sf-import';

export type SfImportJobData = {
  orgId: string;
  runId: string;
};

const DEFAULT_OPTS: JobsOptions = {
  attempts: 1, // executeRun is its own state machine; we don't retry whole imports
  removeOnComplete: { count: 50, age: 7 * 24 * 60 * 60 }, // keep 7 days for audit
  removeOnFail: { count: 100, age: 30 * 24 * 60 * 60 }, // keep 30 days on failure
};

let cached: Queue<SfImportJobData> | undefined;

export function sfImportQueue(): Queue<SfImportJobData> {
  if (cached) return cached;
  cached = new Queue<SfImportJobData>(SF_IMPORT_QUEUE, {
    connection: redis(),
    defaultJobOptions: DEFAULT_OPTS,
  });
  return cached;
}

/** Enqueue an import run. Job id = runId so a duplicate Execute click is a
 *  no-op (BullMQ rejects duplicate ids by default). */
export async function enqueueImport(data: SfImportJobData): Promise<void> {
  await sfImportQueue().add('run', data, { jobId: data.runId });
}
