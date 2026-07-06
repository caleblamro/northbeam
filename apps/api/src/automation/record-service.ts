// System-context record writes for flow executors — a faithful sibling of the
// record.ts create/update/remove pipeline, minus the per-user ACL (flows run
// as the system, SF semantics). Everything else is identical and MUST stay in
// lockstep with record.ts: hydrate picklists → sanitize → required + rule
// checks (ruleIssues ENFORCED — an automation write is not allowed to corrupt
// data a human write would be blocked from) → write → same-record recompute →
// parent rollups (old + new parents) → audit (meta.source 'automation',
// userId null) → dispatchRecordEvent at depth + 1 so flows retrigger flows,
// bounded by FLOW_LIMITS.maxDepth.
//
// Deliberately NOT a refactor of record.ts — converging the two pipelines is
// a follow-up ticket; duplicating the sequence keeps this change reviewable.
//
// Call inside the executor's withOrgContext transaction; run the returned
// `enqueue` AFTER that transaction resolves (it is dispatch's post-commit
// half — invoking it inside the tx would let a worker claim an invisible run).

import { ValidationFailedError } from '@northbeam/core';
import {
  type DbExecutor,
  type FieldRow,
  type ObjectRow,
  createRecord,
  deleteRecord,
  displayName,
  getObjectByKey,
  getRecord,
  hydratePicklistOptions,
  listValidationRules,
  recomputeAndPersist,
  recomputeParentRollups,
  requiredIssues,
  ruleIssues,
  sanitizeData,
  updateRecord,
  writeAuditEvent,
} from '@northbeam/db';
import { dispatchRecordEvent } from './dispatch.js';

/** Who/what is performing the write, and at which recursion depth its
 *  dispatches land. `depth` is parentRun.depth + 1 — the executor computes it
 *  once so this module can't accidentally dispatch at the parent's depth. */
export type PipelineActor = {
  tx: DbExecutor;
  orgId: string;
  now: Date;
  depth: number;
  triggeredByRunId: string | null;
  /** Extra audit context (flow id/name) — merged into meta. */
  flowId?: string;
};

export type PipelineWriteResult = {
  id: string;
  objectKey: string;
  /** Stored data merged with freshly computed formula/rollup values. */
  data: Record<string, unknown>;
  created: boolean;
  changedKeys: string[];
  /** Post-commit hook: enqueues the child flow runs this write dispatched. */
  enqueue: () => Promise<void>;
};

async function requireWritableObject(
  actor: PipelineActor,
  objectKey: string,
): Promise<{ object: ObjectRow; fields: FieldRow[] }> {
  const result = await getObjectByKey(actor.tx, actor.orgId, objectKey);
  if (!result) throw new Error(`object '${objectKey}' not found`);
  if (result.object.archivedAt) throw new Error(`object '${objectKey}' is archived`);
  const fields = await hydratePicklistOptions(actor.tx, actor.orgId, result.fields);
  return { object: result.object, fields };
}

function auditMeta(actor: PipelineActor, extra: Record<string, unknown>): Record<string, unknown> {
  return {
    source: 'automation',
    ...(actor.flowId !== undefined ? { flowId: actor.flowId } : {}),
    ...(actor.triggeredByRunId !== null ? { runId: actor.triggeredByRunId } : {}),
    ...extra,
  };
}

/** Create (no `recordId`) or update (with `recordId`) a record through the
 *  full pipeline. Throws ValidationFailedError when required/rule checks
 *  fail and plain Error for missing/archived objects or missing records —
 *  the executor surfaces either as a failed node. */
export async function writeRecordViaPipeline(
  actor: PipelineActor,
  input: {
    objectKey: string;
    recordId?: string;
    fields: Record<string, unknown>;
    /** Creates only. Flows have no session user; null is the norm. */
    ownerId?: string | null;
  },
): Promise<PipelineWriteResult> {
  const { tx, orgId, now } = actor;
  const { object, fields } = await requireWritableObject(actor, input.objectKey);
  const patch = sanitizeData(fields, input.fields);
  const rules = await listValidationRules(tx, orgId, object.id);

  if (input.recordId === undefined) {
    const issues = [...requiredIssues(fields, patch), ...ruleIssues(rules, patch, now)];
    if (issues.length) throw new ValidationFailedError(issues);
    const created = await createRecord(tx, {
      orgId,
      object,
      fields,
      data: patch,
      ownerId: input.ownerId ?? null,
    });
    const computed = await recomputeAndPersist(tx, {
      orgId,
      object,
      fields,
      recordId: created.id,
      now,
    });
    await recomputeParentRollups(tx, {
      orgId,
      childObjectKey: object.key,
      childData: created.data,
      now,
    });
    await writeAuditEvent(tx, {
      organizationId: orgId,
      userId: null,
      action: 'record.created',
      targetType: 'record',
      targetId: created.id,
      meta: auditMeta(actor, {
        objectKey: object.key,
        name: displayName(fields, created.data, object.nameExpression),
      }),
    });
    const newData = { ...created.data, ...computed };
    const dispatched = await dispatchRecordEvent(tx, {
      organizationId: orgId,
      objectId: object.id,
      objectKey: object.key,
      recordId: created.id,
      kind: 'created',
      record: newData,
      fields,
      actorUserId: null,
      depth: actor.depth,
      triggeredByRunId: actor.triggeredByRunId,
      now,
    });
    return {
      id: created.id,
      objectKey: object.key,
      data: newData,
      created: true,
      changedKeys: Object.keys(patch),
      enqueue: dispatched.enqueue,
    };
  }

  const existing = await getRecord(tx, { orgId, object, fields, id: input.recordId });
  if (!existing) throw new Error(`record '${input.recordId}' not found on '${object.key}'`);
  const merged = { ...existing.data, ...patch };
  // Same posture as record.ts: checks run on the MERGED record so a patch
  // can't clear a required field or move one field into a forbidden state.
  const issues = [...requiredIssues(fields, merged), ...ruleIssues(rules, merged, now)];
  if (issues.length) throw new ValidationFailedError(issues);
  const row = await updateRecord(tx, { orgId, object, fields, id: input.recordId, data: merged });
  if (!row) throw new Error(`record '${input.recordId}' vanished mid-update on '${object.key}'`);
  const computed = await recomputeAndPersist(tx, {
    orgId,
    object,
    fields,
    recordId: input.recordId,
    now,
  });
  // Both old and new parents: a re-parented child must refresh both rollups.
  for (const childData of [existing.data, merged]) {
    await recomputeParentRollups(tx, { orgId, childObjectKey: object.key, childData, now });
  }
  const changedKeys = Object.keys(patch).filter(
    (k) => JSON.stringify(existing.data[k] ?? null) !== JSON.stringify(patch[k] ?? null),
  );
  await writeAuditEvent(tx, {
    organizationId: orgId,
    userId: null,
    action: 'record.updated',
    targetType: 'record',
    targetId: input.recordId,
    meta: auditMeta(actor, {
      objectKey: object.key,
      name: displayName(fields, merged, object.nameExpression),
      changed: changedKeys,
    }),
  });
  const newData = { ...merged, ...computed };
  const dispatched = await dispatchRecordEvent(tx, {
    organizationId: orgId,
    objectId: object.id,
    objectKey: object.key,
    recordId: input.recordId,
    kind: 'updated',
    record: newData,
    oldRecord: existing.data,
    changedKeys,
    fields,
    actorUserId: null,
    depth: actor.depth,
    triggeredByRunId: actor.triggeredByRunId,
    now,
  });
  return {
    id: input.recordId,
    objectKey: object.key,
    data: newData,
    created: false,
    changedKeys,
    enqueue: dispatched.enqueue,
  };
}

export async function deleteRecordViaPipeline(
  actor: PipelineActor,
  input: { objectKey: string; recordId: string },
): Promise<{ enqueue: () => Promise<void> }> {
  const { tx, orgId, now } = actor;
  const { object, fields } = await requireWritableObject(actor, input.objectKey);
  const existing = await getRecord(tx, { orgId, object, fields, id: input.recordId });
  if (!existing) throw new Error(`record '${input.recordId}' not found on '${object.key}'`);
  await deleteRecord(tx, { orgId, object, id: input.recordId });
  await recomputeParentRollups(tx, {
    orgId,
    childObjectKey: object.key,
    childData: existing.data,
    now,
  });
  await writeAuditEvent(tx, {
    organizationId: orgId,
    userId: null,
    action: 'record.deleted',
    targetType: 'record',
    targetId: input.recordId,
    meta: auditMeta(actor, {
      objectKey: object.key,
      name: displayName(fields, existing.data, object.nameExpression),
    }),
  });
  const dispatched = await dispatchRecordEvent(tx, {
    organizationId: orgId,
    objectId: object.id,
    objectKey: object.key,
    recordId: input.recordId,
    kind: 'deleted',
    oldRecord: existing.data,
    fields,
    actorUserId: null,
    depth: actor.depth,
    triggeredByRunId: actor.triggeredByRunId,
    now,
  });
  return { enqueue: dispatched.enqueue };
}
