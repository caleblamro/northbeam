// One-hop reference traversal ("dot paths") for the aggregate engine: a
// grouping or filter key like 'account.industry' reads a field on the record
// the base row's reference field points to. Executed as one LEFT JOIN LATERAL
// per DISTINCT reference field — a PK probe on the target table per row.
//
// Alias discipline (the whole trick): the laterals expose ONLY generated
// names (r0…, p0…), and the base table is aliased `b` solely so the lateral
// can correlate (`t."id" = b."f_account"`). Base columns keep resolving
// unqualified because nothing else in scope can collide with f_*/system
// names — the same reasoning as the multipicklist `mp0` lateral. Everything
// still passes qid() (defense-in-depth, these are generated).
//
// ACL note, deliberate v1 semantics: joined target rows are NOT subject to
// the TARGET object's own record visibility — the base object's aclPredicate
// applies unchanged. This is consistent with resolveRefLabels exposing target
// record names today; tightening to per-target ACL would need per-user share
// lists for a second object on every query. Revisit alongside the granular
// permission work.
//
// Performance note: a dot-path FILTER can't use base-table indexes (full base
// scan + PK probes). Fine at current scale; flagged here so it's a known
// trade, not a surprise.

import { type SQL, sql } from 'drizzle-orm';
import type { FieldRow, ObjectRow } from '../queries/crm.js';
import type { FilterField } from './filters-sql.js';
import { qid, qualified } from './identifiers.js';

export type ResolvedRefPath = {
  /** The wire key, e.g. 'account.industry'. */
  key: string;
  /** The reference field on the BASE object ('account'). */
  refField: FieldRow;
  /** The object the reference points at (same org schema). */
  targetObject: ObjectRow;
  /** The remote field on the target ('industry'). */
  targetField: FieldRow;
};

export type RefJoinPlan = {
  /** ` left join lateral (…) r0 on true …` — empty SQL when no paths. */
  joins: SQL;
  /** Synthetic FilterField entries (aliased) — append to the base fields
   *  before buildFilterPredicates so dot-path filters reuse the whole
   *  operator table. */
  filterFields: FilterField[];
  /** Qualified column expression for a path key (e.g. r0."p1"). */
  exprFor(key: string): SQL | null;
};

/** Split 'ref.remote' — exactly one dot, both segments non-empty. */
export function splitRefPath(key: string): { ref: string; remote: string } | null {
  const idx = key.indexOf('.');
  if (idx <= 0 || idx !== key.lastIndexOf('.') || idx === key.length - 1) return null;
  return { ref: key.slice(0, idx), remote: key.slice(idx + 1) };
}

export function planRefJoins(orgId: string, paths: ResolvedRefPath[]): RefJoinPlan {
  if (paths.length === 0) {
    return { joins: sql``, filterFields: [], exprFor: () => null };
  }

  // One lateral per distinct reference field, in first-use order.
  const lateralByRef = new Map<
    string,
    { alias: string; targetObject: ObjectRow; refField: FieldRow; cols: Map<string, string> }
  >();
  const exprByKey = new Map<string, { lateral: string; col: string }>();
  const filterFields: FilterField[] = [];
  let colSeq = 0;

  for (const p of paths) {
    let lateral = lateralByRef.get(p.refField.columnName);
    if (!lateral) {
      lateral = {
        alias: `r${lateralByRef.size}`,
        targetObject: p.targetObject,
        refField: p.refField,
        cols: new Map(),
      };
      lateralByRef.set(p.refField.columnName, lateral);
    }
    let exposed = lateral.cols.get(p.targetField.columnName);
    if (!exposed) {
      exposed = `p${colSeq++}`;
      lateral.cols.set(p.targetField.columnName, exposed);
    }
    if (!exprByKey.has(p.key)) {
      exprByKey.set(p.key, { lateral: lateral.alias, col: exposed });
      filterFields.push({
        key: p.key,
        columnName: exposed,
        type: p.targetField.type,
        tableAlias: lateral.alias,
      });
    }
  }

  const joinParts: SQL[] = [];
  for (const lateral of lateralByRef.values()) {
    const cols = [...lateral.cols.entries()].map(([targetCol, exposed]) =>
      sql.raw(`t.${qid(targetCol)} as ${qid(exposed)}`),
    );
    joinParts.push(
      sql` left join lateral (select ${sql.join(cols, sql`, `)} from ${sql.raw(
        qualified(orgId, lateral.targetObject.tableName),
      )} t where t.${sql.raw(qid('id'))} = b.${sql.raw(qid(lateral.refField.columnName))}) ${sql.raw(
        qid(lateral.alias),
      )} on true`,
    );
  }

  return {
    joins: sql.join(joinParts, sql``),
    filterFields,
    exprFor: (key: string) => {
      const hit = exprByKey.get(key);
      return hit ? sql.raw(`${qid(hit.lateral)}.${qid(hit.col)}`) : null;
    },
  };
}
