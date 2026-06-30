// Worker that consumes compute-backfill jobs: page through every record of an
// object and recompute its formula + rollup fields. Each page runs in its own
// RLS-scoped transaction (short lock holds on big objects), mirroring the
// sf-import worker's per-phase transaction pattern.

import { logger } from '@northbeam/core';
import {
  type Database,
  createDb,
  getObjectByKey,
  recomputeObjectPage,
  withOrgContext,
} from '@northbeam/db';
import { Worker } from 'bullmq';
import { env } from '../lib/env.js';
import { COMPUTE_QUEUE, type ComputeJobData } from '../queue/compute.js';
import { redis } from '../queue/connection.js';

const PAGE = 200;

let cachedDb: Database | undefined;
function db(): Database {
  if (!cachedDb) cachedDb = createDb(env().DATABASE_URL);
  return cachedDb;
}

export function startComputeWorker(): Worker<ComputeJobData> {
  const worker = new Worker<ComputeJobData>(
    COMPUTE_QUEUE,
    async (job) => {
      const { orgId, objectKey, reason } = job.data;
      logger.info({ orgId, objectKey, reason }, 'compute.backfill.start');
      const owf = await withOrgContext(db(), orgId, (tx) => getObjectByKey(tx, orgId, objectKey));
      if (!owf) {
        logger.warn({ orgId, objectKey }, 'compute.backfill.object_missing');
        return;
      }
      // A single clock for the whole backfill so TODAY/NOW are consistent.
      const now = new Date();
      let offset = 0;
      let processed = 0;
      for (;;) {
        const n = await withOrgContext(db(), orgId, (tx) =>
          recomputeObjectPage(tx, {
            orgId,
            object: owf.object,
            fields: owf.fields,
            now,
            limit: PAGE,
            offset,
          }),
        );
        processed += n;
        offset += PAGE;
        if (n < PAGE) break;
      }
      logger.info({ orgId, objectKey, processed }, 'compute.backfill.complete');
    },
    { connection: redis(), concurrency: 1 },
  );

  worker.on('failed', (job, err) => {
    logger.error({ orgId: job?.data.orgId, objectKey: job?.data.objectKey, err }, 'compute.failed');
  });

  return worker;
}
