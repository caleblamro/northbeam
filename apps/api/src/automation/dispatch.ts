// Record-event → flow-run dispatch (the outbox writer). Called INSIDE the
// mutating transaction so run rows commit atomically with the record write;
// the returned `enqueue` closure is the post-commit half — register it on
// ctx.postCommit (tRPC) or run it after the engine's own transaction commits.
// A crash between commit and enqueue is survivable: the sweeper re-enqueues
// stale `queued` rows, and claimRun makes double-enqueue harmless.
//
// Dispatchers: the record.ts create/update/remove procedures (depth 0) and
// the engine's record-service writes (parent depth + 1 — flows retrigger
// flows, bounded by FLOW_LIMITS.maxDepth, SF parity). The SF importer and the
// compute worker deliberately do NOT dispatch.

import { FLOW_LIMITS, type FlowNodeOfType, FlowTriggerSchema, logger } from '@northbeam/core';
import {
  type DbExecutor,
  type FlowRunContext,
  type FlowRunTriggerType,
  type NewFlowRunInput,
  createRuns,
  insertStep,
  listActiveFlowsForObject,
} from '@northbeam/db';
import { type ConditionField, evaluateFlowCondition } from './condition.js';
import { buildScope } from './context.js';

export type RecordEventKind = 'created' | 'updated' | 'deleted';

export type RecordEvent = {
  organizationId: string;
  objectId: string;
  objectKey: string;
  recordId: string;
  kind: RecordEventKind;
  /** New/merged data, computed values included. Absent on delete. */
  record?: Record<string, unknown>;
  /** Stored data before the write. Absent on create. */
  oldRecord?: Record<string, unknown>;
  /** Keys whose stored value actually changed (update only). */
  changedKeys?: string[];
  /** key+type of the object's fields — exact filter-op semantics for entry
   *  conditions. Omitting it degrades to value-shape heuristics. */
  fields?: ConditionField[];
  actorUserId?: string | null;
  /** Recursion depth of the write performing the dispatch: 0 for user writes,
   *  parentRun.depth + 1 for engine writes. */
  depth?: number;
  /** Engine writes: the run whose executor performed the write — the
   *  depth-cap skip note lands on it, and child runs link back to it. */
  triggeredByRunId?: string | null;
  now?: Date;
};

export type DispatchResult = {
  runIds: string[];
  /** Post-commit hook: enqueues one flow-runs job per created run (no-op when
   *  none matched). NEVER call inside the transaction — a worker could claim
   *  the run before its row is visible. */
  enqueue: () => Promise<void>;
};

const TRIGGER_TYPE: Record<RecordEventKind, FlowRunTriggerType> = {
  created: 'record_created',
  updated: 'record_updated',
  deleted: 'record_deleted',
};

/** Pure trigger match: event kind, watchedFieldKeys ∩ changedKeys (update
 *  events only — creates always pass, SF semantics), then the entry
 *  condition. A condition that fails to evaluate skips the flow with a
 *  warning (ruleIssues policy) — never runs it on a guess. */
export function matchesRecordTrigger(
  trigger: FlowNodeOfType<'trigger_record'>,
  evt: Pick<RecordEvent, 'kind' | 'record' | 'oldRecord' | 'changedKeys' | 'fields' | 'now'>,
): { matched: boolean; warning?: string } {
  const cfg = trigger.config;
  const eventOk =
    evt.kind === 'deleted'
      ? cfg.event === 'deleted'
      : evt.kind === 'created'
        ? cfg.event === 'created' || cfg.event === 'created_or_updated'
        : cfg.event === 'updated' || cfg.event === 'created_or_updated';
  if (!eventOk) return { matched: false };

  if (evt.kind === 'updated' && cfg.watchedFieldKeys && cfg.watchedFieldKeys.length > 0) {
    const changed = new Set(evt.changedKeys ?? []);
    if (!cfg.watchedFieldKeys.some((key) => changed.has(key))) return { matched: false };
  }

  if (!cfg.entryCondition) return { matched: true };
  // Delete events evaluate against the record as it was.
  const data = evt.record ?? evt.oldRecord ?? {};
  const result = evaluateFlowCondition(cfg.entryCondition, {
    data,
    ...(evt.oldRecord !== undefined ? { oldData: evt.oldRecord } : {}),
    scopes: buildScope(
      {
        record: data,
        ...(evt.oldRecord !== undefined ? { oldRecord: evt.oldRecord } : {}),
        vars: {},
      },
      evt.now !== undefined ? { now: evt.now } : {},
    ),
    ...(evt.fields !== undefined ? { fields: evt.fields } : {}),
    ...(evt.now !== undefined ? { now: evt.now } : {}),
  });
  return result;
}

/** Match active flows and insert queued run rows. Call inside the mutating
 *  transaction; push the returned `enqueue` onto ctx.postCommit. */
export async function dispatchRecordEvent(
  tx: DbExecutor,
  evt: RecordEvent,
): Promise<DispatchResult> {
  const depth = evt.depth ?? 0;
  if (depth >= FLOW_LIMITS.maxDepth) {
    // Forensics on the parent run: the cascade stopped here, silently dropping
    // it would look like a matching flow simply never fired.
    if (evt.triggeredByRunId) {
      await insertStep(tx, {
        organizationId: evt.organizationId,
        runId: evt.triggeredByRunId,
        nodeId: 'dispatch',
        // Not a graph node — a synthetic dispatcher note in the step trace.
        nodeType: 'dispatch',
        status: 'skipped',
        summary: {
          reason: 'max_depth',
          depth,
          maxDepth: FLOW_LIMITS.maxDepth,
          objectKey: evt.objectKey,
          recordId: evt.recordId,
          event: evt.kind,
        },
      });
    }
    return { runIds: [], enqueue: async () => {} };
  }

  const flows = await listActiveFlowsForObject(tx, evt.organizationId, evt.objectId);
  const inputs: NewFlowRunInput[] = [];
  for (const flow of flows) {
    if (!flow.activeVersionId || !flow.activeTrigger) continue;
    if (flow.activeTriggerType !== 'trigger_record') continue;
    const parsed = FlowTriggerSchema.safeParse(flow.activeTrigger);
    if (!parsed.success || parsed.data.type !== 'trigger_record') {
      logger.warn({ flowId: flow.id }, 'flow.dispatch.invalid_active_trigger');
      continue;
    }
    const match = matchesRecordTrigger(parsed.data, evt);
    if (match.warning) {
      logger.warn({ flowId: flow.id, warning: match.warning }, 'flow.dispatch.condition_skipped');
    }
    if (!match.matched) continue;

    const context: FlowRunContext = {
      ...(evt.record !== undefined ? { record: evt.record } : {}),
      ...(evt.oldRecord !== undefined ? { oldRecord: evt.oldRecord } : {}),
      ...(evt.changedKeys !== undefined ? { changedKeys: evt.changedKeys } : {}),
      vars: {},
      actorUserId: evt.actorUserId ?? null,
    };
    inputs.push({
      organizationId: evt.organizationId,
      flowId: flow.id,
      flowVersionId: flow.activeVersionId,
      triggerType: TRIGGER_TYPE[evt.kind],
      objectId: evt.objectId,
      recordId: evt.recordId,
      context,
      depth,
      triggeredByRunId: evt.triggeredByRunId ?? null,
    });
  }

  const rows = inputs.length > 0 ? await createRuns(tx, inputs) : [];
  const runIds = rows.map((r) => r.id);
  const orgId = evt.organizationId;
  return {
    runIds,
    enqueue: async () => {
      if (runIds.length === 0) return;
      // Lazy import: the queue module opens a Redis connection on first use;
      // pure callers (tests, dry-runs) that never invoke the hook never load it.
      const { enqueueFlowRun } = await import('../queue/flows.js');
      await Promise.all(runIds.map((runId) => enqueueFlowRun({ orgId, runId })));
    },
  };
}
