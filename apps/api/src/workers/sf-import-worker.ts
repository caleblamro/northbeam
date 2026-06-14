// Worker that consumes sf-import jobs. Lives in its own process so a CPU- or
// memory-intensive import (very large org, many references to resolve) can't
// take down the API.
//
// Wiring is intentionally thin: pull job data → build a SalesforceClient →
// hand off to executeRun. executeRun manages its own RLS contexts and writes
// progress to migration_run.stats; the UI polls that, no need for BullMQ
// progress events.

import { logger } from '@northbeam/core';
import { type Database, createDb } from '@northbeam/db';
import { Worker } from 'bullmq';
import { env } from '../lib/env.js';
import { redis } from '../queue/connection.js';
import { SF_IMPORT_QUEUE, type SfImportJobData } from '../queue/sf-import.js';
import { clientForOrg } from '../salesforce/client.js';
import { executeRun } from '../salesforce/import.js';

let cachedDb: Database | undefined;
function db(): Database {
  if (!cachedDb) cachedDb = createDb(env().DATABASE_URL);
  return cachedDb;
}

export function startSfImportWorker(): Worker<SfImportJobData> {
  const worker = new Worker<SfImportJobData>(
    SF_IMPORT_QUEUE,
    async (job) => {
      const { orgId, runId } = job.data;
      logger.info({ orgId, runId }, 'sf-import.start');
      const client = await clientForOrg(db(), orgId);
      await executeRun(db(), client, orgId, runId);
      logger.info({ orgId, runId }, 'sf-import.complete');
    },
    {
      connection: redis(),
      // One in-flight import per worker process — the importer streams from SF
      // and is mostly I/O-bound on Postgres, so multiple imports in parallel
      // would contend for the same Postgres pool. Horizontal scaling is via
      // additional worker processes, not concurrency within one.
      concurrency: 1,
    },
  );

  worker.on('failed', (job, err) => {
    logger.error(
      { orgId: job?.data.orgId, runId: job?.data.runId, err },
      'sf-import.failed',
    );
  });

  return worker;
}
