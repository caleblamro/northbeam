// Query helpers for the metadata-driven CRM (objects / fields / records).
// Org-scoped — every function takes the caller's organizationId.

import { and, asc, desc, eq, inArray, or, sql } from 'drizzle-orm';
import type { Database } from '../client.js';
import type { FieldType } from '../field-types.js';
import { fieldDef, objectDef, record } from '../schema.js';

export type ObjectRow = typeof objectDef.$inferSelect;
export type FieldRow = typeof fieldDef.$inferSelect;
export type RecordRow = typeof record.$inferSelect;
export type ObjectWithFields = { object: ObjectRow; fields: FieldRow[] };

// Field types whose values are searchable text.
const TEXT_TYPES: FieldType[] = ['text', 'textarea', 'email', 'phone', 'url', 'picklist'];

export async function listObjects(db: Database, orgId: string): Promise<ObjectRow[]> {
  return db
    .select()
    .from(objectDef)
    .where(eq(objectDef.organizationId, orgId))
    .orderBy(asc(objectDef.label));
}

export async function getObjectByKey(
  db: Database,
  orgId: string,
  key: string,
): Promise<ObjectWithFields | null> {
  const [object] = await db
    .select()
    .from(objectDef)
    .where(and(eq(objectDef.organizationId, orgId), eq(objectDef.key, key)))
    .limit(1);
  if (!object) return null;
  const fields = await db
    .select()
    .from(fieldDef)
    .where(eq(fieldDef.objectId, object.id))
    .orderBy(asc(fieldDef.orderIndex));
  return { object, fields };
}

/** Best-effort human label for a record, from its field values. */
export function displayName(fields: FieldRow[], data: Record<string, unknown>): string {
  for (const key of ['name', 'subject', 'title']) {
    if (data[key]) return String(data[key]);
  }
  if (data.first_name || data.last_name) {
    return [data.first_name, data.last_name].filter(Boolean).join(' ');
  }
  const firstText = fields.find((f) => f.type === 'text');
  if (firstText && data[firstText.key]) return String(data[firstText.key]);
  return 'Untitled';
}

export async function listRecords(
  db: Database,
  opts: {
    orgId: string;
    objectId: string;
    fields: FieldRow[];
    search?: string;
    limit?: number;
    offset?: number;
  },
): Promise<RecordRow[]> {
  const conds = [eq(record.organizationId, opts.orgId), eq(record.objectId, opts.objectId)];
  const term = opts.search?.trim();
  if (term) {
    const keys = opts.fields.filter((f) => TEXT_TYPES.includes(f.type)).map((f) => f.key);
    if (keys.length) {
      const like = `%${term}%`;
      const ors = keys.map((k) => sql`${record.data}->>${k} ILIKE ${like}`);
      const orExpr = or(...ors);
      if (orExpr) conds.push(orExpr);
    }
  }
  return db
    .select()
    .from(record)
    .where(and(...conds))
    .orderBy(desc(record.createdAt))
    .limit(opts.limit ?? 100)
    .offset(opts.offset ?? 0);
}

export async function getRecord(
  db: Database,
  orgId: string,
  id: string,
): Promise<RecordRow | null> {
  const [row] = await db
    .select()
    .from(record)
    .where(and(eq(record.organizationId, orgId), eq(record.id, id)))
    .limit(1);
  return row ?? null;
}

export async function createRecord(
  db: Database,
  opts: {
    orgId: string;
    objectId: string;
    data: Record<string, unknown>;
    ownerId?: string | null;
    salesforceId?: string | null;
  },
): Promise<RecordRow> {
  const [row] = await db
    .insert(record)
    .values({
      organizationId: opts.orgId,
      objectId: opts.objectId,
      data: opts.data,
      ownerId: opts.ownerId ?? null,
      salesforceId: opts.salesforceId ?? null,
    })
    .returning();
  if (!row) throw new Error('record insert failed');
  return row;
}

export async function updateRecord(
  db: Database,
  opts: { orgId: string; id: string; data: Record<string, unknown> },
): Promise<RecordRow | null> {
  const [row] = await db
    .update(record)
    .set({ data: opts.data, updatedAt: new Date() })
    .where(and(eq(record.organizationId, opts.orgId), eq(record.id, opts.id)))
    .returning();
  return row ?? null;
}

export async function deleteRecord(db: Database, orgId: string, id: string): Promise<void> {
  await db.delete(record).where(and(eq(record.organizationId, orgId), eq(record.id, id)));
}

/** id → display label for every record referenced by a `reference` field in `rows`. */
export async function resolveRefLabels(
  db: Database,
  orgId: string,
  fields: FieldRow[],
  rows: RecordRow[],
): Promise<Record<string, string>> {
  const labels: Record<string, string> = {};
  const refFields = fields.filter((f) => f.type === 'reference' && f.config?.targetObject);
  for (const rf of refFields) {
    const ids = rows.map((r) => r.data[rf.key]).filter((v): v is string => typeof v === 'string');
    if (!ids.length) continue;
    const target = await getObjectByKey(db, orgId, rf.config.targetObject as string);
    if (!target) continue;
    const targetRows = await db
      .select()
      .from(record)
      .where(and(eq(record.organizationId, orgId), inArray(record.id, ids)));
    for (const tr of targetRows) labels[tr.id] = displayName(target.fields, tr.data);
  }
  return labels;
}

/** Keep only keys that correspond to real (writable) fields on the object. */
export function sanitizeData(
  fields: FieldRow[],
  data: Record<string, unknown>,
): Record<string, unknown> {
  const writable = new Set(
    fields
      .filter((f) => !['formula', 'rollup', 'ai', 'autonumber'].includes(f.type))
      .map((f) => f.key),
  );
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(data)) if (writable.has(k)) out[k] = v;
  return out;
}
