// Recompute every formula + rollup field on a record and return the
// {fieldKey: value} map to persist (via updateRecord with includeComputed).
//
// Ordering: a dependency DAG over the object's computed fields (a formula that
// reads another computed field's key depends on it). Topologically sorted so a
// single pass resolves formula-on-formula and formula-on-rollup; a cycle throws
// (Salesforce likewise forbids circular formula references). Rollups read child
// rows, not same-record fields, so they sort first.

import type { DbExecutor } from '../client.js';
import { getRecord, listChildrenByRef, listRecords, updateRecord } from '../dynamic/records.js';
import { aggregateChildField } from '../dynamic/rollups.js';
import { type RollupFn, narrowFieldConfig } from '../field-types.js';
import { collectFieldKeys, evaluateAst, evaluateFormula, parseFormula } from '../formula/index.js';
import {
  type FieldRow,
  type ObjectRow,
  type ObjectWithFields,
  getObjectById,
  getObjectByKey,
  listRollupFields,
} from '../queries/crm.js';
import { buildComputeContext } from './context.js';

export class ComputeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ComputeError';
  }
}

/** A computed field has a non-empty formula, or a rollup descriptor. */
function isComputed(f: FieldRow): boolean {
  if (f.type === 'formula') return Boolean(narrowFieldConfig('formula', f.config).formula);
  if (f.type === 'rollup') return Boolean(narrowFieldConfig('rollup', f.config).rollup);
  return false;
}

/** Topologically order computed fields so each is evaluated after the
 *  same-record computed fields it reads. Throws ComputeError on a cycle.
 *  Exported for unit testing. */
export function topoOrder(computed: FieldRow[]): FieldRow[] {
  const byKey = new Map(computed.map((f) => [f.key, f]));
  // deps[key] = set of computed-field keys this field reads (same-record only).
  const deps = new Map<string, Set<string>>();
  for (const f of computed) {
    const set = new Set<string>();
    if (f.type === 'formula') {
      const cfg = narrowFieldConfig('formula', f.config);
      if (cfg.formula) {
        try {
          for (const ref of collectFieldKeys(parseFormula(cfg.formula))) {
            // Only single-token refs to OTHER computed fields create an edge;
            // dotted (cross-object) refs and plain data fields don't.
            if (!ref.includes('.') && ref !== f.key && byKey.has(ref)) set.add(ref);
          }
        } catch {
          // malformed formula — rejected at field-save; treat as no deps.
        }
      }
    }
    // Rollups read child rows, never same-record fields → no deps.
    deps.set(f.key, set);
  }

  const order: FieldRow[] = [];
  const state = new Map<string, 'visiting' | 'done'>();
  const visit = (key: string, stack: string[]) => {
    const st = state.get(key);
    if (st === 'done') return;
    if (st === 'visiting') {
      throw new ComputeError(`circular formula reference: ${[...stack, key].join(' → ')}`);
    }
    state.set(key, 'visiting');
    for (const dep of deps.get(key) ?? []) visit(dep, [...stack, key]);
    state.set(key, 'done');
    const field = byKey.get(key);
    if (field) order.push(field);
  };
  for (const f of computed) visit(f.key, []);
  return order;
}

const isTruthy = (v: unknown): boolean =>
  v === true || (v != null && v !== false && v !== '' && v !== 0);

/** Compute one rollup value. No filter → set-based SQL aggregate. Filter → load
 *  children (bounded), keep those whose filter formula is truthy, aggregate in
 *  app code. */
async function computeRollup(
  db: DbExecutor,
  orgId: string,
  parentId: string,
  cfg: { childObject: string; via: string; childField?: string; fn: RollupFn; filter?: string },
  now?: Date,
): Promise<number | null> {
  const child = await getObjectByKey(db, orgId, cfg.childObject);
  if (!child) return null;
  const refField = child.fields.find((f) => f.key === cfg.via);
  if (!refField) return null;
  const valueField = cfg.childField
    ? child.fields.find((f) => f.key === cfg.childField)
    : undefined;

  if (!cfg.filter) {
    return aggregateChildField(db, {
      orgId,
      childObject: child.object,
      refColumn: refField.columnName,
      parentId,
      fn: cfg.fn,
      valueColumn: valueField?.columnName,
    });
  }

  // Filtered path — bounded in-app aggregation.
  const rows = await listChildrenByRef(db, {
    orgId,
    object: child.object,
    fields: child.fields,
    refColumn: refField.columnName,
    parentId,
  });
  const kept = rows.filter((r) => {
    try {
      return isTruthy(evaluateFormula(cfg.filter as string, r.data, { now }));
    } catch {
      return false;
    }
  });
  if (cfg.fn === 'count') return kept.length;
  if (!cfg.childField) return cfg.fn === 'sum' ? 0 : null;
  const nums = kept
    .map((r) => Number(r.data[cfg.childField as string]))
    .filter((n) => Number.isFinite(n));
  if (nums.length === 0) return cfg.fn === 'sum' ? 0 : null;
  switch (cfg.fn) {
    case 'sum':
      return nums.reduce((a, b) => a + b, 0);
    case 'avg':
      return nums.reduce((a, b) => a + b, 0) / nums.length;
    case 'min':
      return Math.min(...nums);
    case 'max':
      return Math.max(...nums);
    default:
      return null;
  }
}

/** Recompute every formula + rollup field on a record. Returns the
 *  {fieldKey: value} map of computed values to persist (pass to updateRecord
 *  with includeComputed:true). Pass `now` for deterministic TODAY/NOW; the
 *  caller (write path / worker) supplies `new Date()`. */
export async function recomputeRecord(
  db: DbExecutor,
  opts: {
    orgId: string;
    object: ObjectRow;
    fields: FieldRow[];
    record: { id: string; data: Record<string, unknown> };
    now?: Date;
  },
): Promise<Record<string, unknown>> {
  const computed = opts.fields.filter(isComputed);
  if (computed.length === 0) return {};

  const order = topoOrder(computed); // throws ComputeError on a cycle
  const ctxData = await buildComputeContext(db, {
    orgId: opts.orgId,
    object: opts.object,
    fields: opts.fields,
    record: opts.record,
  });

  const result: Record<string, unknown> = {};
  for (const f of order) {
    if (f.type === 'rollup') {
      const cfg = narrowFieldConfig('rollup', f.config).rollup;
      const v = cfg ? await computeRollup(db, opts.orgId, opts.record.id, cfg, opts.now) : null;
      result[f.key] = v;
      ctxData[f.key] = v;
      continue;
    }
    // formula
    const cfg = narrowFieldConfig('formula', f.config);
    if (!cfg.formula) continue;
    try {
      const v = evaluateAst(parseFormula(cfg.formula), { data: ctxData, now: opts.now });
      result[f.key] = v;
      ctxData[f.key] = v;
    } catch {
      // A single bad formula yields null rather than failing the whole record.
      result[f.key] = null;
      ctxData[f.key] = null;
    }
  }
  return result;
}

/** Recompute a record's computed fields and persist them in place. Returns the
 *  values written ({} when the object has no computed fields). Runs inside the
 *  caller's transaction, so on the write path the record is never observably
 *  stale. */
export async function recomputeAndPersist(
  db: DbExecutor,
  opts: { orgId: string; object: ObjectRow; fields: FieldRow[]; recordId: string; now?: Date },
): Promise<Record<string, unknown>> {
  const row = await getRecord(db, {
    orgId: opts.orgId,
    object: opts.object,
    fields: opts.fields,
    id: opts.recordId,
  });
  if (!row) return {};
  const values = await recomputeRecord(db, {
    orgId: opts.orgId,
    object: opts.object,
    fields: opts.fields,
    record: row,
    now: opts.now,
  });
  if (Object.keys(values).length === 0) return {};
  await updateRecord(db, {
    orgId: opts.orgId,
    object: opts.object,
    fields: opts.fields,
    id: opts.recordId,
    data: { ...row.data, ...values },
    includeComputed: true,
  });
  return values;
}

/** Recompute one page of an object's records (used by the compute worker for
 *  bulk backfill — post-import, or after a formula/rollup definition changes).
 *  Returns the number of rows processed; the worker pages until a short page. */
export async function recomputeObjectPage(
  db: DbExecutor,
  opts: {
    orgId: string;
    object: ObjectRow;
    fields: FieldRow[];
    now?: Date;
    limit?: number;
    offset?: number;
  },
): Promise<number> {
  const rows = await listRecords(db, {
    orgId: opts.orgId,
    object: opts.object,
    fields: opts.fields,
    limit: opts.limit ?? 200,
    offset: opts.offset ?? 0,
  });
  for (const row of rows) {
    const values = await recomputeRecord(db, {
      orgId: opts.orgId,
      object: opts.object,
      fields: opts.fields,
      record: row,
      now: opts.now,
    });
    if (Object.keys(values).length > 0) {
      await updateRecord(db, {
        orgId: opts.orgId,
        object: opts.object,
        fields: opts.fields,
        id: row.id,
        data: { ...row.data, ...values },
        includeComputed: true,
      });
    }
  }
  return rows.length;
}

/** A child write (create/update/delete) can change parent roll-ups. Find every
 *  rollup that aggregates `childObjectKey`, resolve the affected parent via the
 *  child's `via` reference value, and recompute that parent. One level deep and
 *  bounded; deeper cascades are handled by the compute worker. */
export async function recomputeParentRollups(
  db: DbExecutor,
  opts: { orgId: string; childObjectKey: string; childData: Record<string, unknown>; now?: Date },
): Promise<void> {
  const rollups = (await listRollupFields(db, opts.orgId)).filter(
    (f) => narrowFieldConfig('rollup', f.config).rollup?.childObject === opts.childObjectKey,
  );
  if (rollups.length === 0) return;

  const seen = new Set<string>();
  const objCache = new Map<string, ObjectWithFields | null>();
  for (const rf of rollups) {
    const cfg = narrowFieldConfig('rollup', rf.config).rollup;
    if (!cfg) continue;
    const parentId = opts.childData[cfg.via];
    if (typeof parentId !== 'string' || !parentId) continue;
    const dedupe = `${rf.objectId}:${parentId}`;
    if (seen.has(dedupe)) continue;
    seen.add(dedupe);

    if (!objCache.has(rf.objectId)) {
      objCache.set(rf.objectId, await getObjectById(db, opts.orgId, rf.objectId));
    }
    const owf = objCache.get(rf.objectId);
    if (!owf) continue;
    await recomputeAndPersist(db, {
      orgId: opts.orgId,
      object: owf.object,
      fields: owf.fields,
      recordId: parentId,
      now: opts.now,
    });
  }
}
