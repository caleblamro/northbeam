// Dynamic record CRUD against the per-object physical tables. Same conceptual
// surface as the old JSONB query helpers (list/get/create/update/delete/related/
// refLabels) so the tRPC router barely changes — but every value is a real typed
// column. Returns/accepts records as `{ ...system, data: {fieldKey: value} }`.

import { type SQL, and, eq, inArray, sql } from 'drizzle-orm';
import type { DbExecutor } from '../client.js';
import type { FieldConfig } from '../field-types.js';
import {
  type FieldRow,
  type ObjectRow,
  displayName,
  getObjectById,
  getObjectByKey,
} from '../queries/crm.js';
import { fieldDef, objectDef } from '../schema.js';
import { SYS, qid, qualified } from './identifiers.js';
import { COMPUTED, TEXT_TYPES, fromDb, toDb } from './pgtypes.js';

export type { FieldRow, ObjectRow } from '../queries/crm.js';

export type RecordRow = {
  id: string;
  ownerId: string | null;
  recordTypeId: string | null;
  name: string;
  salesforceId: string | null;
  createdAt: Date;
  updatedAt: Date;
  data: Record<string, unknown>;
};

export type RelatedGroup = {
  object: ObjectRow;
  via: FieldRow;
  fields: FieldRow[];
  rows: RecordRow[];
};

function asRows(res: unknown): Array<Record<string, unknown>> {
  return res as Array<Record<string, unknown>>;
}

function rowToRecord(fields: FieldRow[], row: Record<string, unknown>): RecordRow {
  const data: Record<string, unknown> = {};
  for (const f of fields) data[f.key] = fromDb(f.type, row[f.columnName] ?? null);
  return {
    id: String(row[SYS.id]),
    ownerId: (row[SYS.ownerId] as string | null) ?? null,
    recordTypeId: (row[SYS.recordTypeId] as string | null) ?? null,
    name: (row[SYS.name] as string | null) ?? '',
    salesforceId: (row[SYS.salesforceId] as string | null) ?? null,
    createdAt: row[SYS.createdAt] as Date,
    updatedAt: row[SYS.updatedAt] as Date,
    data,
  };
}

/** A parameterized value with the right cast for its column type. */
function bindValue(field: FieldRow, value: unknown): SQL {
  const dv = toDb(field.type, value);
  if (dv === null) return sql`null`;
  if (field.type === 'reference') return sql`${dv}::uuid`;
  if (field.type === 'multipicklist') return sql`${dv}::text[]`;
  return sql`${dv}`;
}

const col = (name: string): SQL => sql.raw(qid(name));

export async function listRecords(
  db: DbExecutor,
  opts: {
    orgId: string;
    object: ObjectRow;
    fields: FieldRow[];
    search?: string;
    limit?: number;
    offset?: number;
  },
): Promise<RecordRow[]> {
  const tbl = sql.raw(qualified(opts.orgId, opts.object.tableName));
  let where = sql``;
  const term = opts.search?.trim();
  if (term) {
    const like = `%${term}%`;
    const cols = opts.fields.filter((f) => TEXT_TYPES.has(f.type)).map((f) => f.columnName);
    cols.push(SYS.name);
    const ors = cols.map((c) => sql`${col(c)} ilike ${like}`);
    where = sql`where (${sql.join(ors, sql` or `)})`;
  }
  const res = await db.execute(
    sql`select * from ${tbl} ${where} order by ${col(SYS.createdAt)} desc limit ${opts.limit ?? 100} offset ${opts.offset ?? 0}`,
  );
  return asRows(res).map((r) => rowToRecord(opts.fields, r));
}

export async function getRecord(
  db: DbExecutor,
  opts: { orgId: string; object: ObjectRow; fields: FieldRow[]; id: string },
): Promise<RecordRow | null> {
  const tbl = sql.raw(qualified(opts.orgId, opts.object.tableName));
  const res = await db.execute(
    sql`select * from ${tbl} where ${col(SYS.id)} = ${opts.id}::uuid limit 1`,
  );
  const row = asRows(res)[0];
  return row ? rowToRecord(opts.fields, row) : null;
}

/** count(*) on the object's table — used by home/dashboard summary panels. */
export async function countRecords(
  db: DbExecutor,
  opts: { orgId: string; object: ObjectRow },
): Promise<number> {
  const tbl = sql.raw(qualified(opts.orgId, opts.object.tableName));
  const res = await db.execute(sql`select count(*)::int as n from ${tbl}`);
  const row = asRows(res)[0];
  return Number((row?.n as number | undefined) ?? 0);
}

/** Sum a numeric/currency field on the object's table. Returns 0 if no rows. */
export async function sumField(
  db: DbExecutor,
  opts: {
    orgId: string;
    object: ObjectRow;
    field: FieldRow;
    whereField?: FieldRow;
    whereIn?: string[];
  },
): Promise<number> {
  const tbl = sql.raw(qualified(opts.orgId, opts.object.tableName));
  const valCol = col(opts.field.columnName);
  let where = sql``;
  if (opts.whereField && opts.whereIn && opts.whereIn.length > 0) {
    const wCol = col(opts.whereField.columnName);
    // Use IN (...) with explicit param-per-value joining — passing the JS
    // array to Drizzle generates `($1, $2, $3)::text[]` which is not a valid
    // Postgres array literal and fails at runtime.
    const values = sql.join(
      opts.whereIn.map((v) => sql`${v}`),
      sql`, `,
    );
    where = sql`where ${wCol} in (${values})`;
  }
  const res = await db.execute(
    sql`select coalesce(sum(${valCol}), 0)::numeric as s from ${tbl} ${where}`,
  );
  const row = asRows(res)[0];
  return Number((row?.s as string | number | undefined) ?? 0);
}

export async function createRecord(
  db: DbExecutor,
  opts: {
    orgId: string;
    object: ObjectRow;
    fields: FieldRow[];
    data: Record<string, unknown>;
    ownerId?: string | null;
    recordTypeId?: string | null;
    salesforceId?: string | null;
  },
): Promise<RecordRow> {
  const { orgId, object, fields, data } = opts;
  const tbl = sql.raw(qualified(orgId, object.tableName));
  const cols: SQL[] = [col(SYS.name)];
  const vals: SQL[] = [sql`${displayName(fields, data, object.nameExpression)}`];
  if (opts.ownerId != null) {
    cols.push(col(SYS.ownerId));
    vals.push(sql`${opts.ownerId}`);
  }
  if (opts.recordTypeId != null) {
    cols.push(col(SYS.recordTypeId));
    vals.push(sql`${opts.recordTypeId}::uuid`);
  }
  if (opts.salesforceId != null) {
    cols.push(col(SYS.salesforceId));
    vals.push(sql`${opts.salesforceId}`);
  }
  for (const f of fields) {
    if (COMPUTED.has(f.type) || !(f.key in data)) continue;
    cols.push(col(f.columnName));
    vals.push(bindValue(f, data[f.key]));
  }
  const res = await db.execute(
    sql`insert into ${tbl} (${sql.join(cols, sql`, `)}) values (${sql.join(vals, sql`, `)}) returning *`,
  );
  const row = asRows(res)[0];
  if (!row) throw new Error('record insert returned no row');
  return rowToRecord(fields, row);
}

export async function updateRecord(
  db: DbExecutor,
  opts: {
    orgId: string;
    object: ObjectRow;
    fields: FieldRow[];
    id: string;
    data: Record<string, unknown>;
  },
): Promise<RecordRow | null> {
  const { orgId, object, fields, id, data } = opts;
  const tbl = sql.raw(qualified(orgId, object.tableName));
  const sets: SQL[] = [
    sql`${col(SYS.name)} = ${displayName(fields, data, object.nameExpression)}`,
    sql`${col(SYS.updatedAt)} = now()`,
  ];
  for (const f of fields) {
    if (COMPUTED.has(f.type) || !(f.key in data)) continue;
    sets.push(sql`${col(f.columnName)} = ${bindValue(f, data[f.key])}`);
  }
  const res = await db.execute(
    sql`update ${tbl} set ${sql.join(sets, sql`, `)} where ${col(SYS.id)} = ${id}::uuid returning *`,
  );
  const row = asRows(res)[0];
  return row ? rowToRecord(fields, row) : null;
}

export async function deleteRecord(
  db: DbExecutor,
  opts: { orgId: string; object: ObjectRow; id: string },
): Promise<void> {
  const tbl = sql.raw(qualified(opts.orgId, opts.object.tableName));
  await db.execute(sql`delete from ${tbl} where ${col(SYS.id)} = ${opts.id}::uuid`);
}

/** id → display name for every record referenced by a `reference` field in `rows`.
 *
 *  Batched: one SELECT per distinct target object (not per reference field). For
 *  a list view with 5 lookup fields pointing at 2 objects, this is 2 queries
 *  instead of 5. The targets and ids are deduped before query so a referenced
 *  record only fetches once even if it appears under multiple fields. */
export async function resolveRefLabels(
  db: DbExecutor,
  orgId: string,
  fields: FieldRow[],
  rows: RecordRow[],
): Promise<Record<string, string>> {
  const labels: Record<string, string> = {};
  const refFields = fields.filter(
    (f) => f.type === 'reference' && (f.config as FieldConfig | null)?.targetObject,
  );
  if (!refFields.length) return labels;

  // Bucket all referenced ids by target object key. Multiple ref fields can
  // point at the same object — collapse them so we only query that object once.
  const idsByTarget = new Map<string, Set<string>>();
  for (const rf of refFields) {
    const target = (rf.config as FieldConfig).targetObject as string;
    let bucket = idsByTarget.get(target);
    if (!bucket) {
      bucket = new Set<string>();
      idsByTarget.set(target, bucket);
    }
    for (const r of rows) {
      const v = r.data[rf.key];
      if (typeof v === 'string' && v.length) bucket.add(v);
    }
  }

  for (const [targetKey, idSet] of idsByTarget) {
    if (!idSet.size) continue;
    const target = await getObjectByKey(db, orgId, targetKey);
    if (!target) continue;
    const tbl = sql.raw(qualified(orgId, target.object.tableName));
    // `where id = any($1::uuid[])` looks right but drizzle interpolates the JS
    // array as a single scalar param, so PG sees `any($1::uuid[])` with $1 = a
    // single uuid string and rejects it. Expand into `in (v1, v2, …)` with one
    // bound param per id — same shape sumField uses.
    const values = sql.join(
      Array.from(idSet).map((id) => sql`${id}::uuid`),
      sql`, `,
    );
    const res = await db.execute(
      sql`select ${col(SYS.id)}, ${col(SYS.name)} from ${tbl} where ${col(SYS.id)} in (${values})`,
    );
    for (const row of asRows(res)) labels[String(row[SYS.id])] = String(row[SYS.name] ?? '');
  }
  return labels;
}

/** Records on OTHER objects that reference this record (reverse lookups). */
export async function listRelated(
  db: DbExecutor,
  orgId: string,
  parentObjectKey: string,
  recordId: string,
  perGroup = 6,
): Promise<RelatedGroup[]> {
  const refFields = await db
    .select()
    .from(fieldDef)
    .where(and(eq(fieldDef.organizationId, orgId), eq(fieldDef.type, 'reference')));
  const pointers = refFields.filter(
    (f) => (f.config as FieldConfig | null)?.targetObject === parentObjectKey,
  );
  const groups: RelatedGroup[] = [];
  for (const via of pointers) {
    const target = await getObjectById(db, orgId, via.objectId);
    if (!target) continue;
    const tbl = sql.raw(qualified(orgId, target.object.tableName));
    const res = await db.execute(
      sql`select * from ${tbl} where ${col(via.columnName)} = ${recordId}::uuid order by ${col(SYS.createdAt)} desc limit ${perGroup}`,
    );
    const rs = asRows(res).map((r) => rowToRecord(target.fields, r));
    if (rs.length) groups.push({ object: target.object, via, fields: target.fields, rows: rs });
  }
  return groups;
}
