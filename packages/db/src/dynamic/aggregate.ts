// Group-by aggregation over a dynamic per-object table — powers `report`
// views and dashboard Chart nodes. One query per report, all native Postgres:
// up to two GROUP BY levels in a single pass, date bucketing via date_trunc,
// multipicklist explosion via LATERAL unnest, and the SAME visibility + filter
// predicates as listRecords so a report never shows rows a list would hide.
//
// Identifiers go through qid()/qualified(); every value is bound via Drizzle's
// sql template (filters via buildFilterPredicates, ACL via aclPredicate). The
// one sql.raw'd non-identifier is the date_trunc grain, which passes a
// whitelist lookup first.

import { type SQL, sql } from 'drizzle-orm';
import type { DbExecutor } from '../client.js';
import type { FieldType } from '../field-types.js';
import type { FieldRow, ObjectRow } from '../queries/crm.js';
import type { DateGrain, Filter } from '../views.js';
import { buildFilterPredicates } from './filters-sql.js';
import { qid, qualified } from './identifiers.js';
import { aclPredicate } from './records.js';

export type { DateGrain } from '../views.js';

export type AggregateFn = 'count' | 'sum' | 'avg' | 'min' | 'max';

export type AggregateBucket = {
  group: string | number | boolean | null;
  /** Present only when two groupings were requested. */
  group2?: string | number | boolean | null;
  value: number;
  count: number;
};

/** Field types a report can bucket by with a raw column GROUP BY. */
export const GROUPABLE_TYPES: ReadonlySet<FieldType> = new Set<FieldType>([
  'picklist',
  'reference',
  'checkbox',
  'text',
]);

/** Date-backed types — groupable with a date_trunc grain (default 'month'). */
export const DATE_GROUPABLE_TYPES: ReadonlySet<FieldType> = new Set<FieldType>([
  'date',
  'datetime',
]);

/** Whitelist for the date_trunc grain. The grain string is interpolated with
 *  sql.raw, so it MUST come out of this lookup — never from caller input. */
const GRAIN_SQL: Record<DateGrain, string> = {
  day: 'day',
  week: 'week',
  month: 'month',
  quarter: 'quarter',
  year: 'year',
};

const col = (name: string): SQL => sql.raw(qid(name));

export type AggregateGrouping = {
  /** Caller pre-validates the type: GROUPABLE_TYPES ∪ DATE_GROUPABLE_TYPES,
   *  plus multipicklist in the primary position only. */
  field: FieldRow;
  /** date/datetime fields only; defaults to 'month'. Ignored otherwise. */
  grain?: DateGrain;
};

export type AggregateOpts = {
  orgId: string;
  object: ObjectRow;
  fields: FieldRow[];
  /** 0–2 groupings; [0] is the primary bucket, [1] the sub-group (series /
   *  matrix column). Omit or [] for single-row totals (no GROUP BY). */
  groups?: AggregateGrouping[];
  /** `field` is required unless fn is 'count'; caller pre-validates it against
   *  NUMERIC_TYPES (filters-sql.ts) — min/max included (date min/max would
   *  change the bucket value type; deferred). */
  measure: { fn: AggregateFn; field?: FieldRow };
  filters: Filter[];
  /** Same shape + semantics as listRecords.acl — shared via aclPredicate. */
  acl?: { userId: string; sharedRecordIds: string[]; isAdminish: boolean };
  /** Bucket cap. One grouping: default 50, clamped to 200. Two groupings the
   *  rows are (group, group2) PAIRS: default 500, clamped to 1000. */
  limit?: number;
};

/** GROUP BY expression for one grouping: raw column for categorical types,
 *  date_trunc for date/datetime. Date buckets come back as ISO 'YYYY-MM-DD'
 *  strings (::date::text) so ordering and client parsing are stable. Note:
 *  timestamptz truncates in the session timezone (UTC on the server) —
 *  org-local bucketing is out of scope. */
function groupExpr(g: AggregateGrouping): SQL {
  const c = col(g.field.columnName);
  if (DATE_GROUPABLE_TYPES.has(g.field.type)) {
    const grain = GRAIN_SQL[g.grain ?? 'month'];
    if (!grain) throw new Error(`unknown date grain '${String(g.grain)}'`);
    return sql`(date_trunc(${sql.raw(`'${grain}'`)}, ${c}))::date::text`;
  }
  return c;
}

/** Pure query builder — exported so tests can assert the SQL shape without a
 *  live database (same contract-guarding idea as the filters-sql parity test). */
export function buildAggregateQuery(opts: AggregateOpts): SQL {
  const groups = opts.groups ?? [];
  if (groups.length > 2) throw new Error('aggregate supports at most two groupings');
  if (opts.measure.fn !== 'count' && !opts.measure.field) {
    throw new Error(`aggregate fn '${opts.measure.fn}' requires a measure field`);
  }
  const primary = groups[0];
  const secondary = groups[1];
  if (secondary?.field.type === 'multipicklist') {
    throw new Error('multipicklist can only be the primary grouping');
  }

  const tbl = sql.raw(qualified(opts.orgId, opts.object.tableName));
  // Multipicklist primary: explode the array with a LATERAL unnest so each
  // record counts toward every selected option; the LEFT JOIN keeps rows with
  // an empty/NULL array as a NULL ("None") bucket. The lateral only exposes
  // one column (mp0.e), so all other unqualified refs still bind to the table.
  const isMulti = primary?.field.type === 'multipicklist';
  const from =
    isMulti && primary
      ? sql`${tbl} left join lateral unnest(coalesce(${col(primary.field.columnName)}, '{}')) as mp0(e) on true`
      : tbl;
  const g1 = primary ? (isMulti ? sql`mp0.e` : groupExpr(primary)) : sql`null`;
  const g2 = secondary ? groupExpr(secondary) : null;

  const value =
    opts.measure.fn === 'count' || !opts.measure.field
      ? sql`count(*)::numeric`
      : opts.measure.fn === 'sum'
        ? sql`coalesce(sum(${col(opts.measure.field.columnName)}), 0)::numeric`
        : opts.measure.fn === 'avg'
          ? sql`avg(${col(opts.measure.field.columnName)})::numeric`
          : opts.measure.fn === 'min'
            ? sql`min(${col(opts.measure.field.columnName)})::numeric`
            : sql`max(${col(opts.measure.field.columnName)})::numeric`;

  const clauses: SQL[] = [];
  const vis = aclPredicate(opts.object, opts.acl);
  if (vis) clauses.push(vis);
  clauses.push(...buildFilterPredicates(opts.fields, opts.filters));
  const where = clauses.length ? sql`where ${sql.join(clauses, sql` and `)}` : sql``;

  const two = groups.length === 2;
  const limit = Math.min(Math.max(opts.limit ?? (two ? 500 : 50), 1), two ? 1000 : 200);
  const chrono = primary ? DATE_GROUPABLE_TYPES.has(primary.field.type) : false;

  let tail: SQL;
  if (!primary) {
    tail = sql``;
  } else if (!two) {
    // Date grains order chronologically; categorical buckets rank by value.
    tail = chrono
      ? sql`group by 1 order by 1 asc nulls last limit ${limit}`
      : sql`group by 1 order by v desc nulls last limit ${limit}`;
  } else if (chrono) {
    tail = sql`group by 1, 2 order by 1 asc nulls last, v desc nulls last limit ${limit}`;
  } else {
    // Rank whole primary groups by their total so the LIMIT trims trailing
    // groups, not arbitrary (group, group2) pairs. sum(<agg>) OVER is a window
    // over the grouped result — the partition must repeat the group EXPRESSION
    // (an ordinal would be a constant). Fallback if this ever misbehaves:
    // `order by 1, v desc` and rank primaries client-side.
    tail = sql`group by 1, 2 order by sum(${value}) over (partition by ${g1}) desc nulls last, 1 asc nulls last, v desc nulls last limit ${limit}`;
  }

  const selectG2 = g2 ? sql`, ${g2} as g2` : sql``;
  return sql`select ${g1} as g${selectG2}, ${value} as v, count(*)::int as n from ${from} ${where} ${tail}`;
}

export async function aggregateRecords(
  db: DbExecutor,
  opts: AggregateOpts,
): Promise<AggregateBucket[]> {
  const two = (opts.groups ?? []).length === 2;
  const res = await db.execute(buildAggregateQuery(opts));
  return (res as unknown as Array<Record<string, unknown>>).map((row) => {
    const bucket: AggregateBucket = {
      group: (row.g ?? null) as string | number | boolean | null,
      // numeric comes back from postgres-js as a string — normalize to number.
      value: Number(row.v ?? 0),
      count: Number(row.n ?? 0),
    };
    if (two) bucket.group2 = (row.g2 ?? null) as string | number | boolean | null;
    return bucket;
  });
}
