// QuerySpec compiler — the execution half of the "almost raw SQL" query
// language (@northbeam/core/query-spec holds the zod schema; this file holds
// a structural mirror because core depends on db, not the reverse).
//
// THE COMPILER IS THE SECURITY BOUNDARY. Every spec:
//   - resolves against live metadata first (resolveQuerySpec — unknown
//     objects/fields/paths are typed errors, never SQL),
//   - compiles through the same qid()/parameterization machinery as every
//     other dynamic query (identifiers generated or quoted, values bound),
//   - ALWAYS carries the caller's aclPredicate — not optional in this path,
//   - inlines expression measures from their operand AGGREGATE expressions
//     (PG can't reference select aliases in the same list), `/` guarded with
//     nullif so a zero denominator yields NULL, not an error.
//
// Deliberate ceilings (mirroring the schema's): ≤2 groupings, ≤5 measures,
// one expression level, exists non-nested. No arbitrary functions, no
// subselects beyond EXISTS, no unions.

import { type SQL, sql } from 'drizzle-orm';
import type { DbExecutor } from '../client.js';
import type { ObjectWithFields } from '../queries/crm.js';
import type { FieldRow } from '../queries/crm.js';
import type { DateGrain, Filter } from '../views.js';
import {
  type AggregateFn,
  type AggregateGrouping,
  DATE_GROUPABLE_TYPES,
  GROUPABLE_TYPES,
  groupExpr,
  measureExpr,
} from './aggregate.js';
import { NUMERIC_TYPES, buildFilterPredicates } from './filters-sql.js';
import { qid, qualified } from './identifiers.js';
import { aclPredicate } from './records.js';
import { type ResolvedRefPath, planRefJoins, splitRefPath } from './ref-joins.js';

/* ── Structural mirror of @northbeam/core's QuerySpec ───────────────────── */

export type QueryConditionLike =
  | Filter
  | { all: QueryConditionLike[] }
  | { any: QueryConditionLike[] }
  | {
      exists: { objectKey: string; refFieldKey: string; where?: QueryConditionLike };
      negate?: boolean;
    };

export type QueryMeasureLike = {
  id: string;
  fn?: AggregateFn;
  fieldKey?: string;
  expr?: {
    op: '+' | '-' | '*' | '/';
    left: { ref: string } | { value: number };
    right: { ref: string } | { value: number };
  };
};

export type QuerySpecLike = {
  objectKey: string;
  where?: QueryConditionLike;
  groupBy?: { fieldKey: string; grain?: DateGrain }[];
  measures: QueryMeasureLike[];
  having?: { measure: string; op: 'gt' | 'gte' | 'lt' | 'lte'; value: number }[];
  orderBy?: { ref: string; direction: 'asc' | 'desc' };
  limit?: number;
};

/* ── Resolution ─────────────────────────────────────────────────────────── */

type ResolvedExists = {
  child: ObjectWithFields;
  refField: FieldRow;
  where?: QueryConditionLike;
  negate: boolean;
};

export type ResolvedQueryPlan = {
  base: ObjectWithFields;
  groups: AggregateGrouping[];
  measures: { id: string; fn?: AggregateFn; field?: FieldRow; expr?: QueryMeasureLike['expr'] }[];
  where?: QueryConditionLike;
  /** exists keyed by a synthetic marker used during condition compilation. */
  existsByMarker: Map<QueryConditionLike, ResolvedExists>;
  having: { measure: string; op: 'gt' | 'gte' | 'lt' | 'lte'; value: number }[];
  orderBy?: { ref: string; direction: 'asc' | 'desc' };
  limit: number;
  refPaths: ResolvedRefPath[];
};

const HAVING_OPS: Record<string, SQL> = {
  gt: sql`>`,
  gte: sql`>=`,
  lt: sql`<`,
  lte: sql`<=`,
};

function isExists(c: QueryConditionLike): c is Extract<QueryConditionLike, { exists: unknown }> {
  return typeof c === 'object' && c !== null && 'exists' in c;
}
function isAll(c: QueryConditionLike): c is { all: QueryConditionLike[] } {
  return typeof c === 'object' && c !== null && 'all' in c;
}
function isAny(c: QueryConditionLike): c is { any: QueryConditionLike[] } {
  return typeof c === 'object' && c !== null && 'any' in c;
}

function resolveDotPath(
  base: ObjectWithFields,
  targets: Map<string, ObjectWithFields>,
  key: string,
): ResolvedRefPath | null {
  const split = splitRefPath(key);
  if (!split) return null;
  const refField = base.fields.find((f) => f.key === split.ref);
  if (!refField || refField.type !== 'reference') return null;
  const targetKey = (refField.config as { targetObject?: string } | null)?.targetObject;
  const target = targetKey ? targets.get(targetKey) : undefined;
  const targetField = target?.fields.find((f) => f.key === split.remote);
  if (!target || !targetField) return null;
  return { key, refField, targetObject: target.object, targetField };
}

/** Object KEYS a spec needs loaded: exists children + dot-path targets. */
export function collectQueryTargetKeys(base: ObjectWithFields, spec: QuerySpecLike): string[] {
  const out = new Set<string>();
  const baseByKey = new Map(base.fields.map((f) => [f.key, f]));
  const considerDot = (key: string) => {
    const split = splitRefPath(key);
    if (!split) return;
    const ref = baseByKey.get(split.ref);
    if (ref?.type !== 'reference') return;
    const target = (ref.config as { targetObject?: string } | null)?.targetObject;
    if (target) out.add(target);
  };
  const walk = (c: QueryConditionLike | undefined, depth: number) => {
    if (!c || depth > 4) return;
    if (isExists(c)) {
      out.add(c.exists.objectKey);
      return;
    }
    if (isAll(c)) for (const x of c.all) walk(x, depth + 1);
    else if (isAny(c)) for (const x of c.any) walk(x, depth + 1);
    else considerDot((c as Filter).fieldKey);
  };
  walk(spec.where, 0);
  for (const g of spec.groupBy ?? []) considerDot(g.fieldKey);
  return [...out];
}

/** Resolve a spec against loaded metadata, or explain why it can't run. It
 *  either fully resolves or fails — no partial mutation (repair drops the
 *  whole block on failure; a silently-narrowed query would lie). */
export function resolveQuerySpec(
  base: ObjectWithFields,
  targets: Map<string, ObjectWithFields>,
  spec: QuerySpecLike,
): { ok: true; plan: ResolvedQueryPlan } | { ok: false; message: string } {
  const byKey = new Map(base.fields.map((f) => [f.key, f]));

  // Groupings — base fields or dot paths, groupable types only.
  const groups: AggregateGrouping[] = [];
  for (const g of spec.groupBy ?? []) {
    if (g.fieldKey.includes('.')) {
      const via = resolveDotPath(base, targets, g.fieldKey);
      if (
        !via ||
        !(
          GROUPABLE_TYPES.has(via.targetField.type) ||
          DATE_GROUPABLE_TYPES.has(via.targetField.type)
        )
      ) {
        return { ok: false, message: `'${g.fieldKey}' is not a groupable reference path` };
      }
      groups.push(
        DATE_GROUPABLE_TYPES.has(via.targetField.type)
          ? { field: via.targetField, grain: g.grain ?? 'month', via }
          : { field: via.targetField, via },
      );
      continue;
    }
    const f = byKey.get(g.fieldKey);
    if (!f || !(GROUPABLE_TYPES.has(f.type) || DATE_GROUPABLE_TYPES.has(f.type))) {
      return { ok: false, message: `'${g.fieldKey}' is not groupable` };
    }
    groups.push(
      DATE_GROUPABLE_TYPES.has(f.type) ? { field: f, grain: g.grain ?? 'month' } : { field: f },
    );
  }

  // Measures — same field gates as resolveReportSpec.
  const measures: ResolvedQueryPlan['measures'] = [];
  for (const m of spec.measures) {
    if (m.expr) {
      measures.push({ id: m.id, expr: m.expr });
      continue;
    }
    const fn = m.fn ?? 'count';
    if (fn === 'count') {
      measures.push({ id: m.id, fn });
      continue;
    }
    const f = m.fieldKey ? byKey.get(m.fieldKey) : undefined;
    const ok =
      fn === 'countDistinct' ? f && f.type !== 'multipicklist' : f && NUMERIC_TYPES.has(f.type);
    if (!ok) {
      return { ok: false, message: `measure '${m.id}': '${m.fieldKey ?? ''}' can't be ${fn}'d` };
    }
    measures.push({ id: m.id, fn, field: f });
  }
  const measureIds = new Set(measures.map((m) => m.id));

  // Having refs must exist.
  for (const h of spec.having ?? []) {
    if (h.measure !== 'count' && !measureIds.has(h.measure)) {
      return { ok: false, message: `having references unknown measure '${h.measure}'` };
    }
  }
  if (spec.orderBy && spec.orderBy.ref !== 'group' && !measureIds.has(spec.orderBy.ref)) {
    return { ok: false, message: `orderBy references unknown measure '${spec.orderBy.ref}'` };
  }

  // Conditions — exists children must resolve; dot-path leaves collect.
  const existsByMarker = new Map<QueryConditionLike, ResolvedExists>();
  const refPaths: ResolvedRefPath[] = [];
  const seenPaths = new Set<string>();
  const walk = (c: QueryConditionLike | undefined, depth: number): string | null => {
    if (!c) return null;
    if (depth > 3) return 'condition tree too deep';
    if (isExists(c)) {
      const child = targets.get(c.exists.objectKey);
      const refField = child?.fields.find((f) => f.key === c.exists.refFieldKey);
      const pointsBack =
        refField?.type === 'reference' &&
        (refField.config as { targetObject?: string } | null)?.targetObject === base.object.key;
      if (!child || !refField || !pointsBack) {
        return `exists: '${c.exists.objectKey}.${c.exists.refFieldKey}' doesn't reference '${base.object.key}'`;
      }
      // Inner where: leaves + one all/any level, base-field keys of the CHILD.
      const inner = c.exists.where;
      const innerLeaves = inner
        ? isAll(inner)
          ? inner.all
          : isAny(inner)
            ? inner.any
            : [inner]
        : [];
      for (const leaf of innerLeaves) {
        if (isExists(leaf) || isAll(leaf) || isAny(leaf)) return 'exists conditions nest too deep';
      }
      existsByMarker.set(c, { child, refField, where: inner, negate: c.negate === true });
      return null;
    }
    if (isAll(c) || isAny(c)) {
      for (const x of (isAll(c) ? c.all : c.any) as QueryConditionLike[]) {
        const err = walk(x, depth + 1);
        if (err) return err;
      }
      return null;
    }
    const leaf = c as Filter;
    if (leaf.fieldKey.includes('.')) {
      if (!seenPaths.has(leaf.fieldKey)) {
        const path = resolveDotPath(base, targets, leaf.fieldKey);
        if (!path) return `unknown reference path '${leaf.fieldKey}'`;
        seenPaths.add(leaf.fieldKey);
        refPaths.push(path);
      }
    } else if (!byKey.has(leaf.fieldKey)) {
      return `unknown filter field '${leaf.fieldKey}'`;
    }
    return null;
  };
  const err = walk(spec.where, 0);
  if (err) return { ok: false, message: err };

  return {
    ok: true,
    plan: {
      base,
      groups,
      measures,
      where: spec.where,
      existsByMarker,
      having: spec.having ?? [],
      orderBy: spec.orderBy,
      limit: Math.min(Math.max(spec.limit ?? (groups.length > 0 ? 50 : 1), 1), 1000),
      refPaths,
    },
  };
}

/* ── Compilation ────────────────────────────────────────────────────────── */

export type QueryRow = {
  group: string | number | boolean | null;
  group2?: string | number | boolean | null;
  values: Record<string, number | null>;
  count: number;
};

export type QueryAcl = { userId: string; sharedRecordIds: string[]; isAdminish: boolean };

/** Compile the resolved plan to ONE SQL statement. `acl` is required by
 *  signature — this path never runs unscoped. */
export function buildQuery(orgId: string, plan: ResolvedQueryPlan, acl: QueryAcl): SQL {
  const { base, groups } = plan;
  const allPaths = [...groups.flatMap((g) => (g.via ? [g.via] : [])), ...plan.refPaths];
  const refPlan = planRefJoins(orgId, allPaths);
  // The base is ALWAYS aliased here (exists correlation needs it) — this is a
  // new statement shape with no byte-compat constraint.
  const from = sql`${sql.raw(qualified(orgId, base.object.tableName))} b${refPlan.joins}`;

  const filterFields = [...base.fields, ...refPlan.filterFields];

  // One leaf filter → predicate (or null → the leaf drops, same semantics as
  // buildFilterPredicates).
  const leafPredicate = (leaf: Filter): SQL | null => {
    const [p] = buildFilterPredicates(filterFields, [leaf]);
    return p ?? null;
  };

  const compileCondition = (c: QueryConditionLike): SQL | null => {
    if (isExists(c)) {
      const resolved = plan.existsByMarker.get(c);
      if (!resolved) return null;
      const childTbl = sql.raw(qualified(orgId, resolved.child.object.tableName));
      // Child predicates compile against alias 'c' via tableAlias'd fields.
      const childFields = resolved.child.fields.map((f) => ({
        key: f.key,
        columnName: f.columnName,
        type: f.type,
        tableAlias: 'c',
      }));
      const inner = resolved.where;
      const innerLeaves = inner
        ? isAll(inner)
          ? inner.all
          : isAny(inner)
            ? inner.any
            : [inner]
        : [];
      const innerPreds = innerLeaves
        .map((leaf) => buildFilterPredicates(childFields, [leaf as Filter])[0])
        .filter((p): p is SQL => p !== undefined);
      const joiner = inner && isAny(inner) ? sql` or ` : sql` and `;
      const innerWhere =
        innerPreds.length > 0 ? sql` and (${sql.join(innerPreds, joiner)})` : sql``;
      const existsSql = sql`exists (select 1 from ${childTbl} c where c.${sql.raw(
        qid(resolved.refField.columnName),
      )} = b.${sql.raw(qid('id'))}${innerWhere})`;
      return resolved.negate ? sql`not ${existsSql}` : existsSql;
    }
    if (isAll(c) || isAny(c)) {
      const parts = (isAll(c) ? c.all : c.any)
        .map((x) => compileCondition(x))
        .filter((p): p is SQL => p !== null);
      if (parts.length === 0) return null;
      if (parts.length === 1) return parts[0] ?? null;
      return sql`(${sql.join(parts, isAll(c) ? sql` and ` : sql` or `)})`;
    }
    return leafPredicate(c as Filter);
  };

  const clauses: SQL[] = [];
  const vis = aclPredicate(base.object, acl);
  if (vis) clauses.push(vis);
  if (plan.where) {
    const wherePred = compileCondition(plan.where);
    if (wherePred) clauses.push(wherePred);
  }
  const where = clauses.length ? sql` where ${sql.join(clauses, sql` and `)}` : sql``;

  // Measure expressions by id. Expression measures inline their operands'
  // aggregate SQL (PG can't reference select aliases in the same list).
  const aggById = new Map<string, SQL>();
  for (const m of plan.measures) {
    if (m.expr) continue;
    const c = m.field ? sql.raw(qid(m.field.columnName)) : sql``;
    aggById.set(m.id, m.field ? measureExpr(m.fn ?? 'count', c) : sql`count(*)::numeric`);
  }
  const operandSql = (o: { ref: string } | { value: number }): SQL =>
    'ref' in o ? (aggById.get(o.ref) ?? sql`null`) : sql`${o.value}::numeric`;
  const exprById = new Map<string, SQL>(aggById);
  for (const m of plan.measures) {
    if (!m.expr) continue;
    const left = operandSql(m.expr.left);
    const right = operandSql(m.expr.right);
    const body =
      m.expr.op === '/'
        ? sql`(${left} / nullif(${right}, 0))`
        : sql`(${left} ${sql.raw(m.expr.op)} ${right})`;
    exprById.set(m.id, body);
  }

  // Select list: groups g/g2, measures by POSITIONAL alias (m0, m1 — measure
  // ids never reach SQL as identifiers), plus the bucket count.
  const g1 = groups[0]
    ? groupExpr(groups[0], groups[0].via ? refPlan.exprFor(groups[0].via.key) : null)
    : null;
  const g2 = groups[1]
    ? groupExpr(groups[1], groups[1].via ? refPlan.exprFor(groups[1].via.key) : null)
    : null;
  const selects: SQL[] = [];
  if (g1) selects.push(sql`${g1} as g`);
  if (g2) selects.push(sql`${g2} as g2`);
  plan.measures.forEach((m, i) => {
    const expr = exprById.get(m.id) ?? sql`null`;
    selects.push(sql`${expr} as ${sql.raw(qid(`m${i}`))}`);
  });
  selects.push(sql`count(*)::int as n`);

  // HAVING — measure refs inline their aggregate expr; 'count' → count(*).
  const havingParts = plan.having
    .map((h) => {
      const op = HAVING_OPS[h.op];
      const target = h.measure === 'count' ? sql`count(*)` : exprById.get(h.measure);
      if (!op || !target || !Number.isFinite(h.value)) return null;
      return sql`${target} ${op} ${h.value}`;
    })
    .filter((p): p is SQL => p !== null);
  const having =
    groups.length > 0 && havingParts.length > 0
      ? sql` having ${sql.join(havingParts, sql` and `)}`
      : sql``;

  const groupBy =
    groups.length === 2 ? sql` group by 1, 2` : groups.length === 1 ? sql` group by 1` : sql``;

  let orderBy = sql``;
  if (groups.length > 0) {
    const dir = plan.orderBy?.direction === 'asc' ? sql`asc` : sql`desc`;
    const target =
      !plan.orderBy || plan.orderBy.ref === 'group'
        ? sql`1 ${plan.orderBy ? dir : sql`asc`}`
        : sql`${exprById.get(plan.orderBy.ref) ?? sql`1`} ${dir}`;
    orderBy = sql` order by ${target} nulls last`;
  }

  return sql`select ${sql.join(selects, sql`, `)} from ${from}${where}${groupBy}${having}${orderBy} limit ${plan.limit}`;
}

export async function runQuery(
  db: DbExecutor,
  orgId: string,
  plan: ResolvedQueryPlan,
  acl: QueryAcl,
): Promise<QueryRow[]> {
  const res = await db.execute(buildQuery(orgId, plan, acl));
  const two = plan.groups.length === 2;
  return (res as unknown as Array<Record<string, unknown>>).map((row) => {
    const values: Record<string, number | null> = {};
    plan.measures.forEach((m, i) => {
      const v = row[`m${i}`];
      values[m.id] = v == null ? null : Number(v);
    });
    const out: QueryRow = {
      group: (row.g ?? null) as QueryRow['group'],
      values,
      count: Number(row.n ?? 0),
    };
    if (two) out.group2 = (row.g2 ?? null) as QueryRow['group2'];
    return out;
  });
}
