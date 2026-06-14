// Metadata queries for the CRM: objects, fields, and small helpers. Record *values*
// live in per-object physical tables and are read/written by src/dynamic/records.ts
// (the fully-native data model). This module only touches object_def / field_def.

import { and, asc, eq } from 'drizzle-orm';
import type { DbExecutor } from '../client.js';
import { fieldDef, objectDef } from '../schema.js';

export type ObjectRow = typeof objectDef.$inferSelect;
export type FieldRow = typeof fieldDef.$inferSelect;
export type ObjectWithFields = { object: ObjectRow; fields: FieldRow[] };

export async function listObjects(db: DbExecutor, orgId: string): Promise<ObjectRow[]> {
  return db
    .select()
    .from(objectDef)
    .where(eq(objectDef.organizationId, orgId))
    .orderBy(asc(objectDef.label));
}

async function fieldsFor(db: DbExecutor, objectId: string): Promise<FieldRow[]> {
  return db
    .select()
    .from(fieldDef)
    .where(eq(fieldDef.objectId, objectId))
    .orderBy(asc(fieldDef.orderIndex));
}

export async function getObjectByKey(
  db: DbExecutor,
  orgId: string,
  key: string,
): Promise<ObjectWithFields | null> {
  const [object] = await db
    .select()
    .from(objectDef)
    .where(and(eq(objectDef.organizationId, orgId), eq(objectDef.key, key)))
    .limit(1);
  if (!object) return null;
  return { object, fields: await fieldsFor(db, object.id) };
}

export async function getObjectById(
  db: DbExecutor,
  orgId: string,
  objectId: string,
): Promise<ObjectWithFields | null> {
  const [object] = await db
    .select()
    .from(objectDef)
    .where(and(eq(objectDef.organizationId, orgId), eq(objectDef.id, objectId)))
    .limit(1);
  if (!object) return null;
  return { object, fields: await fieldsFor(db, object.id) };
}

/** Best-effort human label for a record, from its field values.
 *
 *  Priority:
 *    1. `object.nameExpression` if set — first-class metadata pointing at the
 *       field that holds the human label (e.g. 'subject' for activities,
 *       'first_name|last_name' for contacts). Pipe-separated keys are joined.
 *    2. Conventional defaults (`name`, `subject`, `title`, `first_name+last_name`)
 *    3. The first text field on the object
 *    4. 'Untitled'
 */
export function displayName(
  fields: FieldRow[],
  data: Record<string, unknown>,
  nameExpression?: string | null,
): string {
  if (nameExpression) {
    const parts = nameExpression
      .split('|')
      .map((k) => data[k.trim()])
      .filter((v): v is string | number => v !== undefined && v !== null && v !== '');
    if (parts.length) return parts.map(String).join(' ').trim();
  }
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
