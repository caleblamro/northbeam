// Flow-run worker: executes claimed runs, fires scheduled flows, and hosts
// the sweeper + schedule reconciler as repeatable jobs on the same queue.
//
// Concurrency model: 5 in-flight jobs per process; a per-org running-runs cap
// of 25 enforced BEFORE the claim — over-cap jobs re-enqueue with a delay
// (unkeyed, so a completed resume-job id can't swallow the retry; claimRun
// stays the idempotency gate either way).
//
// The sweeper and reconciler read CROSS-ORG (staleQueuedRuns /
// overdueWaitingRuns / staleRunningRuns / listActiveScheduledFlows) and
// therefore run on the DATABASE_ADMIN_URL connection — under the RLS-enforced
// app role with no org GUC those queries return zero rows and the safety net
// silently disappears. Without DATABASE_ADMIN_URL both are disabled loudly.

import { logger } from '@northbeam/core';
import {
  type Database,
  createDb,
  failRun,
  listRuns,
  overdueWaitingRuns,
  staleQueuedRuns,
  staleRunningRuns,
  withOrgContext,
} from '@northbeam/db';
import { Worker } from 'bullmq';
import { z } from 'zod';
import { runFlow } from '../automation/engine.js';
import { fireScheduledFlow, reconcileFlowSchedules } from '../automation/schedules.js';
import { env } from '../lib/env.js';
import { redis } from '../queue/connection.js';
import { FLOW_RUN_QUEUE, enqueueFlowRun, flowRunQueue } from '../queue/flows.js';

const CONCURRENCY = 5;
const MAX_RUNNING_PER_ORG = 25;
const OVER_CAP_RETRY_MS = 5_000;
const SWEEP_EVERY_MS = 30_000;
const RECONCILE_EVERY_MS = 3_600_000;
const QUEUED_STALE_MS = 15_000;
const HEARTBEAT_STALE_MS = 10 * 60_000;

const RunJobSchema = z.object({
  orgId: z.string().min(1),
  runId: z.string().uuid(),
  resumeToken: z.string().optional(),
});
const ScheduleFireSchema = z.object({ orgId: z.string().min(1), flowId: z.string().uuid() });

let cachedDb: Database | undefined;
function db(): Database {
  if (!cachedDb) cachedDb = createDb(env().DATABASE_URL);
  return cachedDb;
}

let cachedAdminDb: Database | null | undefined;
function adminDb(): Database | null {
  if (cachedAdminDb !== undefined) return cachedAdminDb;
  const url = env().DATABASE_ADMIN_URL;
  if (!url) {
    logger.error(
      {},
      'flow-worker: DATABASE_ADMIN_URL is not set — sweeper and schedule reconciliation are DISABLED (lost runs will not be recovered)',
    );
    cachedAdminDb = null;
    return null;
  }
  cachedAdminDb = createDb(url);
  return cachedAdminDb;
}

async function handleRun(data: unknown): Promise<void> {
  const job = RunJobSchema.parse(data);
  // Per-org running cap — RLS-scoped count via listRuns (bounded read).
  const running = await withOrgContext(db(), job.orgId, (tx) =>
    listRuns(tx, job.orgId, { status: 'running', limit: MAX_RUNNING_PER_ORG }),
  );
  if (running.length >= MAX_RUNNING_PER_ORG) {
    logger.warn({ orgId: job.orgId, runId: job.runId }, 'flow-worker.org_cap_redelay');
    await enqueueFlowRun(
      {
        orgId: job.orgId,
        runId: job.runId,
        ...(job.resumeToken !== undefined ? { resumeToken: job.resumeToken } : {}),
      },
      { delayMs: OVER_CAP_RETRY_MS },
    );
    return;
  }
  await runFlow(db(), job);
}

async function sweep(): Promise<void> {
  const admin = adminDb();
  if (!admin) return;
  const now = Date.now();

  const queued = await staleQueuedRuns(admin, new Date(now - QUEUED_STALE_MS));
  for (const ref of queued) {
    await enqueueFlowRun({ orgId: ref.organizationId, runId: ref.id });
  }

  const overdue = await overdueWaitingRuns(admin, new Date(now));
  for (const ref of overdue) {
    await enqueueFlowRun({
      orgId: ref.organizationId,
      runId: ref.id,
      ...(ref.resumeToken !== null ? { resumeToken: ref.resumeToken } : {}),
    });
  }

  const dead = await staleRunningRuns(admin, new Date(now - HEARTBEAT_STALE_MS));
  for (const ref of dead) {
    // Writes aren't idempotent — a run whose worker died mid-flight is
    // failed, never silently retried. The operator replays from the trace.
    await failRun(
      admin,
      ref.organizationId,
      ref.id,
      'worker heartbeat lost — run failed by sweeper',
    );
    logger.error({ orgId: ref.organizationId, runId: ref.id }, 'flow-worker.sweeper_failed_run');
  }

  if (queued.length + overdue.length + dead.length > 0) {
    logger.info(
      { requeued: queued.length, resumed: overdue.length, failed: dead.length },
      'flow-worker.sweep',
    );
  }
}

async function registerMaintenance(): Promise<void> {
  const queue = flowRunQueue();
  await queue.upsertJobScheduler(
    'flow-maintenance:sweep',
    { every: SWEEP_EVERY_MS },
    { name: 'sweep', data: {} },
  );
  await queue.upsertJobScheduler(
    'flow-maintenance:reconcile',
    { every: RECONCILE_EVERY_MS },
    { name: 'reconcile-schedules', data: {} },
  );
  // Boot-time reconcile so activations that happened while no worker was
  // alive get their schedulers before the first hourly tick.
  const admin = adminDb();
  if (admin) await reconcileFlowSchedules(admin);
}

export function startFlowWorker(): Worker {
  const worker = new Worker(
    FLOW_RUN_QUEUE,
    async (job) => {
      switch (job.name) {
        case 'run':
        case 'resume':
          await handleRun(job.data);
          return;
        case 'scheduled-fire':
          await fireScheduledFlow(db(), ScheduleFireSchema.parse(job.data));
          return;
        case 'sweep':
          await sweep();
          return;
        case 'reconcile-schedules': {
          const admin = adminDb();
          if (admin) await reconcileFlowSchedules(admin);
          return;
        }
        default:
          logger.warn({ name: job.name }, 'flow-worker.unknown_job');
      }
    },
    { connection: redis(), concurrency: CONCURRENCY },
  );

  worker.on('failed', (job, err) => {
    logger.error({ name: job?.name, data: job?.data, err }, 'flow-worker.job_failed');
  });

  registerMaintenance().catch((err) => {
    logger.error({ err }, 'flow-worker.maintenance_registration_failed');
  });

  return worker;
}
