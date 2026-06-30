// Roll-up aggregation over a child object's physical table. The no-filter path
// aggregates in SQL (fast, scales to any child count). Filtered roll-ups load
// the children and aggregate in app code (see compute/recompute.ts) — this
// module owns only the set-based SQL primitive.

import { type SQL, sql } from 'drizzle-orm';
import type { DbExecutor } from '../client.js';
import type { RollupFn } from '../field-types.js';
import type { ObjectRow } from '../queries/crm.js';
import { qid, qualified } from './identifiers.js';

/** Aggregate a child field across every child row whose `refColumn` points at
 *  `parentId`. COUNT → row count; SUM → 0 when empty; AVG/MIN/MAX → null when
 *  empty (matching SQL). `valueColumn` is required for everything but COUNT. */
export async function aggregateChildField(
  db: DbExecutor,
  opts: {
    orgId: string;
    childObject: ObjectRow;
    /** physical column on the child table that references the parent (`f_<via>`). */
    refColumn: string;
    parentId: string;
    fn: RollupFn;
    /** physical column to aggregate (`f_<childField>`); omit for COUNT. */
    valueColumn?: string;
  },
): Promise<number | null> {
  const tbl = sql.raw(qualified(opts.orgId, opts.childObject.tableName));
  const ref = sql.raw(qid(opts.refColumn));

  let expr: SQL;
  if (opts.fn === 'count') {
    expr = sql`count(*)::int`;
  } else {
    if (!opts.valueColumn) return opts.fn === 'sum' ? 0 : null;
    const valCol = sql.raw(qid(opts.valueColumn));
    switch (opts.fn) {
      case 'sum':
        expr = sql`coalesce(sum(${valCol}), 0)::numeric`;
        break;
      case 'avg':
        expr = sql`avg(${valCol})::numeric`;
        break;
      case 'min':
        expr = sql`min(${valCol})`;
        break;
      case 'max':
        expr = sql`max(${valCol})`;
        break;
    }
  }

  const res = await db.execute(
    sql`select ${expr} as v from ${tbl} where ${ref} = ${opts.parentId}::uuid`,
  );
  const row = (res as Array<Record<string, unknown>>)[0];
  const v = row?.v;
  return v == null ? null : Number(v);
}
