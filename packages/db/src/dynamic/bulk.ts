// Bulk-load helpers for the Salesforce importer. Multi-row INSERTs keyed by
// salesforce_id (idempotent re-runs via ON CONFLICT DO NOTHING against the
// partial unique index), plus set-based reference resolution that joins
// salesforce_ids entirely in the database — no in-memory id map.

import { type SQL, sql } from 'drizzle-orm';
import type { DbExecutor } from '../client.js';
import type { FieldRow, ObjectRow } from '../queries/crm.js';
import { SYS, qid, qualified } from './identifiers.js';
import { toDb } from './pgtypes.js';

export type ImportRow = {
  salesforceId: string;
  name: string;
  ownerId?: string | null;
  recordTypeId?: string | null;
  createdAt?: string | Date | null;
  /** field key → app-shaped value. Reference fields are resolved separately. */
  data: Record<string, unknown>;
};

const col = (name: string): SQL => sql.raw(qid(name));

function bind(field: FieldRow, value: unknown): SQL {
  const dv = toDb(field.type, value);
  if (dv === null) return sql`null`;
  if (field.type === 'reference') return sql`${dv}::uuid`;
  if (field.type === 'multipicklist') return sql`${dv}::text[]`;
  return sql`${dv}`;
}

/** Insert rows in parameter-budget-sized chunks. Returns rows actually inserted
 *  (conflicts on salesforce_id are skipped). `fields` must exclude reference
 *  fields — those are resolved afterwards via resolveReferencesBySfid. */
export async function bulkInsertRecords(
  db: DbExecutor,
  opts: { orgId: string; object: ObjectRow; fields: FieldRow[]; rows: ImportRow[] },
): Promise<number> {
  const { orgId, object, fields, rows } = opts;
  if (!rows.length) return 0;
  const tbl = sql.raw(qualified(orgId, object.tableName));

  const colNames: SQL[] = [
    col(SYS.salesforceId),
    col(SYS.name),
    col(SYS.ownerId),
    col(SYS.recordTypeId),
    col(SYS.createdAt),
    ...fields.map((f) => col(f.columnName)),
  ];
  const paramsPerRow = 5 + fields.length;
  const chunkSize = Math.max(1, Math.min(500, Math.floor(40_000 / paramsPerRow)));

  let inserted = 0;
  for (let i = 0; i < rows.length; i += chunkSize) {
    const chunk = rows.slice(i, i + chunkSize);
    const tuples = chunk.map((r) => {
      const vals: SQL[] = [
        sql`${r.salesforceId}`,
        sql`${r.name}`,
        r.ownerId == null ? sql`null` : sql`${r.ownerId}`,
        r.recordTypeId == null ? sql`null` : sql`${r.recordTypeId}::uuid`,
        r.createdAt == null ? sql`now()` : sql`${r.createdAt}::timestamptz`,
        ...fields.map((f) => bind(f, r.data[f.key])),
      ];
      return sql`(${sql.join(vals, sql`, `)})`;
    });
    const res = await db.execute(
      sql`insert into ${tbl} (${sql.join(colNames, sql`, `)})
          values ${sql.join(tuples, sql`, `)}
          on conflict (${col(SYS.salesforceId)}) where ${col(SYS.salesforceId)} is not null
          do nothing
          returning ${col(SYS.id)}`,
    );
    inserted += rowsInResult(res);
  }
  return inserted;
}

/** postgres-js's RETURNING result is array-like (`.length` works) but not typed
 *  as such by Drizzle. Centralise the unsafe access here so call sites aren't
 *  riddled with `as unknown as unknown[]` casts. */
function rowsInResult(res: unknown): number {
  if (Array.isArray(res)) return res.length;
  if (res && typeof res === 'object' && 'length' in res) {
    const n = (res as { length: unknown }).length;
    return typeof n === 'number' ? n : 0;
  }
  return 0;
}

/** Resolve a reference column from raw Salesforce ids: for each (sfId, refSfId)
 *  pair, set child.col = target.id where the salesforce_ids match. Pure SQL join —
 *  works across everything ever imported, not just this run. */
export async function resolveReferencesBySfid(
  db: DbExecutor,
  opts: {
    orgId: string;
    object: ObjectRow;
    field: FieldRow;
    targetObject: ObjectRow;
    pairs: Array<{ sfId: string; refSfId: string }>;
  },
): Promise<number> {
  const { orgId, object, field, targetObject, pairs } = opts;
  if (!pairs.length) return 0;
  const tbl = sql.raw(qualified(orgId, object.tableName));
  const tgt = sql.raw(qualified(orgId, targetObject.tableName));

  const CHUNK = 5000;
  let updated = 0;
  for (let i = 0; i < pairs.length; i += CHUNK) {
    const chunk = pairs.slice(i, i + CHUNK);
    const tuples = chunk.map((p) => sql`(${p.sfId}, ${p.refSfId})`);
    const res = await db.execute(
      sql`update ${tbl} set ${col(field.columnName)} = t.${col(SYS.id)}
          from (values ${sql.join(tuples, sql`, `)}) as v(sfid, refsfid)
          join ${tgt} t on t.${col(SYS.salesforceId)} = v.refsfid
          where ${tbl}.${col(SYS.salesforceId)} = v.sfid
          returning ${tbl}.${col(SYS.id)}`,
    );
    updated += rowsInResult(res);
  }
  return updated;
}
