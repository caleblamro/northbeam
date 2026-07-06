// Record-target resolution shared by the write-shaped executors
// (update_records / delete_record / assign_owner / post_timeline). Every
// target flavor resolves to concrete { objectKey, recordId } refs; anything
// unresolvable throws — the registry turns the throw into a failed node.
//
// Items stored in flow vars by get_records / create_record carry `id` and
// `objectKey` alongside the field data precisely so loop_item / var targets
// can resolve without re-querying.

import {
  FLOW_LIMITS,
  type FlowFilter,
  type FlowRecordTarget,
  type FlowUpdateTarget,
  type TemplateScopes,
  interpolate,
} from '@northbeam/core';
import {
  type DbExecutor,
  type FilterEntry,
  getObjectById,
  getObjectByKey,
  listRecords,
  schema,
} from '@northbeam/db';
import { and, eq, inArray } from 'drizzle-orm';
import { type RunContext, getVar } from '../context.js';
import type { ExecServices } from './types.js';

export type RecordRef = { objectKey: string; recordId: string };

/** Interpolated filter values must collapse to the wire-safe FilterValue
 *  union before hitting the SQL builder. */
export function coerceFilterValue(v: unknown): string | number | boolean | null {
  if (v === null || v === undefined) return null;
  if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') return v;
  if (v instanceof Date) return v.toISOString();
  return String(v);
}

/** FlowFilter[] + logic → the db FilterEntry[] shape ('or' wraps the leaves
 *  in a single { any } group; 'and' is the flat list). Values interpolate
 *  through the run scope first so `{{record.stage}}`-style bounds work. */
export function toFilterEntries(
  filters: readonly FlowFilter[],
  logic: 'and' | 'or' | undefined,
  scopes: TemplateScopes,
): FilterEntry[] {
  const leaves = filters.map((f) => ({
    fieldKey: f.fieldKey,
    op: f.op,
    value: coerceFilterValue(
      typeof f.value === 'string' ? interpolate(f.value, scopes) : (f.value ?? null),
    ),
  }));
  return logic === 'or' && leaves.length > 1 ? [{ any: leaves }] : leaves;
}

function refFromItem(item: unknown): RecordRef | null {
  if (item === null || typeof item !== 'object') return null;
  const rec = item as Record<string, unknown>;
  if (typeof rec.id !== 'string' || typeof rec.objectKey !== 'string') return null;
  return { objectKey: rec.objectKey, recordId: rec.id };
}

async function triggerRecordRef(tx: DbExecutor, services: ExecServices): Promise<RecordRef> {
  if (!services.flow.objectId || !services.recordId) {
    throw new Error('this run has no trigger record to target');
  }
  const owf = await getObjectById(tx, services.orgId, services.flow.objectId);
  if (!owf) throw new Error("the flow's object no longer exists");
  return { objectKey: owf.object.key, recordId: services.recordId };
}

/** Resolve a target to concrete refs inside the executor's transaction.
 *  Query targets are bounded by their own limit (schema-capped at
 *  FLOW_LIMITS.maxGetRecords). */
export async function resolveRecordTargets(
  tx: DbExecutor,
  target: FlowRecordTarget | FlowUpdateTarget,
  ctx: RunContext,
  services: ExecServices,
  scopes: TemplateScopes,
): Promise<RecordRef[]> {
  switch (target.kind) {
    case 'trigger_record':
      return [await triggerRecordRef(tx, services)];
    case 'loop_item': {
      const frame = ctx.loopFrames?.[ctx.loopFrames.length - 1];
      if (!frame) throw new Error('loop_item target used outside a loop body');
      const items = getVar(ctx, frame.sourceVar);
      const item = Array.isArray(items) ? items[frame.index] : null;
      const ref = refFromItem(item);
      if (!ref) throw new Error('the current loop item is not a record');
      return [ref];
    }
    case 'var': {
      const value = getVar(ctx, target.name);
      const items = Array.isArray(value) ? value : [value];
      const refs = items.map(refFromItem).filter((r): r is RecordRef => r !== null);
      if (refs.length === 0) throw new Error(`var '${target.name}' holds no records`);
      if (refs.length > FLOW_LIMITS.maxGetRecords) {
        throw new Error(
          `var '${target.name}' holds ${refs.length} records — the cap is ${FLOW_LIMITS.maxGetRecords}`,
        );
      }
      return refs;
    }
    case 'query': {
      const owf = await getObjectByKey(tx, services.orgId, target.objectKey);
      if (!owf) throw new Error(`object '${target.objectKey}' not found`);
      const rows = await listRecords(tx, {
        orgId: services.orgId,
        object: owf.object,
        fields: owf.fields,
        filters: toFilterEntries(target.filters, target.logic, scopes),
        limit: Math.min(target.limit, FLOW_LIMITS.maxGetRecords),
      });
      return rows.map((r) => ({ objectKey: target.objectKey, recordId: r.id }));
    }
  }
}

/** Filter candidate user ids down to actual org members — a `{{merge}}` that
 *  resolved to garbage must not FK-abort the executor's transaction. */
export async function memberUserIds(
  tx: DbExecutor,
  orgId: string,
  candidates: string[],
): Promise<Set<string>> {
  const unique = [...new Set(candidates.filter((c) => c.length > 0))];
  if (unique.length === 0) return new Set();
  const rows = await tx
    .select({ userId: schema.member.userId })
    .from(schema.member)
    .where(and(eq(schema.member.organizationId, orgId), inArray(schema.member.userId, unique)));
  return new Set(rows.map((r) => r.userId));
}
