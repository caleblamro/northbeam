// Scheduled-flow wiring on BullMQ Job Schedulers.
//   - activate/pause (tRPC postCommit) → syncFlowSchedule / removeFlowSchedule
//   - the worker fires 'scheduled-fire' jobs → fireScheduledFlow creates the
//     queued run rows (one per matching record for object-scoped flows,
//     capped at FLOW_LIMITS.maxScheduledFanout with an audit marker)
//   - boot + hourly 'reconcile-schedules' → reconcileFlowSchedules diffs the
//     live scheduler set against listActiveScheduledFlows (cross-org — MUST
//     run on the admin/BypassRLS connection; under the app role it sees zero
//     rows and would tear every schedule down)
//
// Scheduler ids are 'flow-schedule:<flowId>' so reconcile can prune by
// prefix without touching the maintenance schedulers ('flow-maintenance:*').

import { FLOW_LIMITS, type FlowSchedule, FlowTriggerSchema, logger } from '@northbeam/core';
import {
  type Database,
  type FlowRow,
  createRuns,
  getFlow,
  getObjectById,
  listActiveScheduledFlows,
  listRecords,
  withOrgContext,
  writeAuditEvent,
} from '@northbeam/db';
import { enqueueFlowRun, flowRunQueue } from '../queue/flows.js';
import { evaluateFlowCondition } from './condition.js';

const SCHEDULER_PREFIX = 'flow-schedule:';

export function schedulerIdFor(flowId: string): string {
  return `${SCHEDULER_PREFIX}${flowId}`;
}

export type ScheduleFireJobData = { orgId: string; flowId: string };

/** Cron pattern for a repeating schedule; null for 'once' (a single delayed
 *  job, not a scheduler). Exported for tests. */
export function cronPatternFor(schedule: FlowSchedule): string | null {
  switch (schedule.frequency) {
    case 'once':
      return null;
    case 'daily': {
      const [h, m] = schedule.time.split(':');
      return `${Number(m)} ${Number(h)} * * *`;
    }
    case 'weekly': {
      const [h, m] = schedule.time.split(':');
      return `${Number(m)} ${Number(h)} * * ${schedule.weekday}`;
    }
    case 'cron':
      return schedule.expression;
  }
}

/** Idempotently align the queue with one flow's schedule. Removes the
 *  scheduler when the flow is not an active scheduled flow. */
export async function syncFlowSchedule(flow: FlowRow): Promise<void> {
  const queue = flowRunQueue();
  const active =
    flow.status === 'active' && flow.activeTriggerType === 'trigger_scheduled'
      ? FlowTriggerSchema.safeParse(flow.activeTrigger)
      : null;
  if (!active || !active.success || active.data.type !== 'trigger_scheduled') {
    await queue.removeJobScheduler(schedulerIdFor(flow.id));
    return;
  }
  const { schedule, timezone } = active.data.config;
  const data: ScheduleFireJobData = { orgId: flow.organizationId, flowId: flow.id };
  const pattern = cronPatternFor(schedule);
  if (pattern === null) {
    await queue.removeJobScheduler(schedulerIdFor(flow.id));
    const at = new Date((schedule as Extract<FlowSchedule, { frequency: 'once' }>).at);
    const delay = at.getTime() - Date.now();
    if (delay < 0) {
      logger.warn({ flowId: flow.id, at: at.toISOString() }, 'flow.schedule.once_in_past');
      return;
    }
    // jobId dedupes re-activations targeting the same instant.
    await queue.add('scheduled-fire', data, {
      delay,
      jobId: `flow-once:${flow.id}:${at.getTime()}`,
    });
    return;
  }
  await queue.upsertJobScheduler(
    schedulerIdFor(flow.id),
    { pattern, tz: timezone },
    { name: 'scheduled-fire', data },
  );
}

export async function removeFlowSchedule(flowId: string): Promise<void> {
  await flowRunQueue().removeJobScheduler(schedulerIdFor(flowId));
}

/** Boot + hourly sweep: upsert every active scheduled flow, prune schedulers
 *  whose flow is gone/paused. `adminDb` must bypass RLS (cross-org read). */
export async function reconcileFlowSchedules(adminDb: Database): Promise<void> {
  const flows = await listActiveScheduledFlows(adminDb);
  const keep = new Set(flows.map((f) => schedulerIdFor(f.id)));
  for (const flow of flows) {
    try {
      await syncFlowSchedule(flow);
    } catch (err) {
      logger.error({ flowId: flow.id, err }, 'flow.schedule.sync_failed');
    }
  }
  const queue = flowRunQueue();
  const schedulers = await queue.getJobSchedulers(0, 999);
  for (const scheduler of schedulers) {
    const id = scheduler.key;
    if (typeof id !== 'string' || !id.startsWith(SCHEDULER_PREFIX)) continue;
    if (!keep.has(id)) {
      await queue.removeJobScheduler(id);
      logger.info({ schedulerId: id }, 'flow.schedule.pruned');
    }
  }
  logger.info({ active: flows.length }, 'flow.schedule.reconciled');
}

/** Handle one 'scheduled-fire' tick: verify the flow is still live, create
 *  queued run rows (outbox), then enqueue them. Object-scoped flows fan out
 *  one run per matching record, capped at maxScheduledFanout. */
export async function fireScheduledFlow(db: Database, job: ScheduleFireJobData): Promise<void> {
  const { orgId, flowId } = job;
  const now = new Date();
  const runIds = await withOrgContext(db, orgId, async (tx) => {
    const flow = await getFlow(tx, orgId, flowId);
    if (
      !flow ||
      flow.status !== 'active' ||
      flow.activeTriggerType !== 'trigger_scheduled' ||
      !flow.activeVersionId
    ) {
      logger.warn({ orgId, flowId }, 'flow.schedule.fire_skipped_inactive');
      return [] as string[];
    }
    const trigger = FlowTriggerSchema.safeParse(flow.activeTrigger);
    if (!trigger.success || trigger.data.type !== 'trigger_scheduled') {
      logger.warn({ orgId, flowId }, 'flow.schedule.fire_invalid_trigger');
      return [] as string[];
    }
    const entry = trigger.data.config.entryCondition;

    if (!flow.objectId) {
      const rows = await createRuns(tx, [
        {
          organizationId: orgId,
          flowId,
          flowVersionId: flow.activeVersionId,
          triggerType: 'scheduled',
          context: { vars: {}, actorUserId: null },
        },
      ]);
      return rows.map((r) => r.id);
    }

    const owf = await getObjectById(tx, orgId, flow.objectId);
    if (!owf) {
      logger.warn({ orgId, flowId }, 'flow.schedule.fire_object_missing');
      return [] as string[];
    }
    const fields = owf.fields.map((f) => ({ key: f.key, type: f.type }));
    const cap = FLOW_LIMITS.maxScheduledFanout;
    const page = 200;
    const inputs: Parameters<typeof createRuns>[1] = [];
    let offset = 0;
    let truncated = false;
    for (;;) {
      const rows = await listRecords(tx, {
        orgId,
        object: owf.object,
        fields: owf.fields,
        limit: page,
        offset,
      });
      for (const row of rows) {
        if (entry) {
          const match = evaluateFlowCondition(entry, { data: row.data, fields, now });
          if (match.warning) {
            logger.warn(
              { orgId, flowId, warning: match.warning },
              'flow.schedule.condition_skipped',
            );
          }
          if (!match.matched) continue;
        }
        if (inputs.length >= cap) {
          truncated = true;
          break;
        }
        inputs.push({
          organizationId: orgId,
          flowId,
          flowVersionId: flow.activeVersionId,
          triggerType: 'scheduled',
          objectId: flow.objectId,
          recordId: row.id,
          context: { record: row.data, vars: {}, actorUserId: null },
        });
      }
      if (truncated || rows.length < page) break;
      offset += page;
    }
    if (truncated) {
      // A hard truncation marker in the audit log — the operator must know
      // the fan-out was clipped, not guess from a suspicious round count.
      await writeAuditEvent(tx, {
        organizationId: orgId,
        userId: null,
        action: 'flow.scheduled_fanout_truncated',
        targetType: 'flow',
        targetId: flowId,
        meta: { cap, objectKey: owf.object.key },
      });
      logger.warn({ orgId, flowId, cap }, 'flow.schedule.fanout_truncated');
    }
    const rows = inputs.length > 0 ? await createRuns(tx, inputs) : [];
    return rows.map((r) => r.id);
  });
  // Post-commit half — the withOrgContext transaction has resolved.
  for (const runId of runIds) {
    await enqueueFlowRun({ orgId, runId });
  }
  logger.info({ orgId, flowId, runs: runIds.length }, 'flow.schedule.fired');
}
