// Group-by aggregation over a dynamic per-object table — powers `report`
// views and dashboard Chart nodes. One query per report: bucket by an optional
// group column, aggregate one measure, honor the SAME visibility + filter
// predicates as listRecords so a report never shows rows a list would hide.
//
// Identifiers go through qid()/qualified(); every value is bound via Drizzle's
// sql template (filters via buildFilterPredicates, ACL via aclPredicate).

import { type SQL, sql } from 'drizzle-orm';
import type { DbExecutor } from '../client.js';
import type { FieldType } from '../field-types.js';
import type { FieldRow, ObjectRow } from '../queries/crm.js';
import type { Filter } from '../views.js';
import { buildFilterPredicates } from './filters-sql.js';
import { qid, qualified } from './identifiers.js';
import { aclPredicate } from './records.js';

export type AggregateFn = 'count' | 'sum' | 'avg';

export type AggregateBucket = {
  group: string | number | boolean | null;
  value: number;
  count: number;
};

/** Field types a report can bucket by — raw column GROUP BY only.
 *  multipicklist (needs array explosion) and date grains (day/week/month
 *  bucketing) are deferred; they want per-grain SQL, not a bare column. */
export const GROUPABLE_TYPES: ReadonlySet<FieldType> = new Set<FieldType>([
  'picklist',
  'reference',
  'checkbox',
  'text',
]);

const col = (name: string): SQL => sql.raw(qid(name));

export type AggregateOpts = {
  orgId: string;
  object: ObjectRow;
  fields: FieldRow[];
  /** Bucket column. Caller pre-validates the type against GROUPABLE_TYPES.
   *  Omit/null for single-row totals (no GROUP BY). */
  groupBy?: FieldRow | null;
  /** `field` is required unless fn is 'count'; caller pre-validates it against
   *  NUMERIC_TYPES (filters-sql.ts). */
  measure: { fn: AggregateFn; field?: FieldRow };
  filters: Filter[];
  /** Same shape + semantics as listRecords.acl — shared via aclPredicate. */
  acl?: { userId: string; sharedRecordIds: string[]; isAdminish: boolean };
  /** Bucket cap. Default 50, clamped to 200. */
  limit?: number;
};

/** Pure query builder — exported so tests can assert the SQL shape without a
 *  live database (same contract-guarding idea as the filters-sql parity test). */
export function buildAggregateQuery(opts: AggregateOpts): SQL {
  if (opts.measure.fn !== 'count' && !opts.measure.field) {
    throw new Error(`aggregate fn '${opts.measure.fn}' requires a measure field`);
  }
  const tbl = sql.raw(qualified(opts.orgId, opts.object.tableName));
  const groupCol = opts.groupBy ? col(opts.groupBy.columnName) : sql`null`;
  const value =
    opts.measure.fn === 'count' || !opts.measure.field
      ? sql`count(*)::numeric`
      : opts.measure.fn === 'sum'
        ? sql`coalesce(sum(${col(opts.measure.field.columnName)}), 0)::numeric`
        : sql`avg(${col(opts.measure.field.columnName)})::numeric`;

  const clauses: SQL[] = [];
  const vis = aclPredicate(opts.object, opts.acl);
  if (vis) clauses.push(vis);
  clauses.push(...buildFilterPredicates(opts.fields, opts.filters));
  const where = clauses.length ? sql`where ${sql.join(clauses, sql` and `)}` : sql``;

  const limit = Math.min(Math.max(opts.limit ?? 50, 1), 200);
  const tail = opts.groupBy ? sql`group by 1 order by v desc nulls last limit ${limit}` : sql``;
  return sql`select ${groupCol} as g, ${value} as v, count(*)::int as n from ${tbl} ${where} ${tail}`;
}

export async function aggregateRecords(
  db: DbExecutor,
  opts: AggregateOpts,
): Promise<AggregateBucket[]> {
  const res = await db.execute(buildAggregateQuery(opts));
  return (res as unknown as Array<Record<string, unknown>>).map((row) => ({
    group: (row.g ?? null) as string | number | boolean | null,
    // numeric comes back from postgres-js as a string — normalize to number.
    value: Number(row.v ?? 0),
    count: Number(row.n ?? 0),
  }));
}
