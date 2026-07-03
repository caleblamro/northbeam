// Worker process entrypoint. Run with `pnpm --filter @northbeam/api dev:worker`
// (or `start:worker` in prod). Loads env, validates it, then spins up every
// background worker we have. Currently just sf-import; future workers (compute
// engine, AI fields, etc.) register here too.

import { logger } from '@northbeam/core';
import { assertRlsEnforced, createDb } from '@northbeam/db';
import { env } from '../lib/env.js';
import { startComputeWorker } from './compute-worker.js';
import { startSfImportWorker } from './sf-import-worker.js';

// Fail-fast on missing env, and refuse an RLS-bypassing DB connection —
// workers write org data and must be subject to the same isolation as the API.
const e = env();
await assertRlsEnforced(createDb(e.DATABASE_URL));

const sfImport = startSfImportWorker();
logger.info({ worker: 'sf-import' }, 'worker.started');

const compute = startComputeWorker();
logger.info({ worker: 'compute' }, 'worker.started');

async function shutdown(signal: NodeJS.Signals) {
  logger.info({ signal }, 'worker.shutting_down');
  await Promise.all([sfImport.close(), compute.close()]);
  process.exit(0);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
