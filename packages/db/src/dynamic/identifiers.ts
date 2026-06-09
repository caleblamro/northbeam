// Identifier helpers for the fully-native, table-per-object data model.
// Each org is a Postgres schema (`org_<id>`); each object a table; each field a
// column (`f_<key>`). Everything here produces SAFE, deterministic identifiers —
// the only place raw names enter SQL — so the dynamic SQL layer can inject them
// without injection risk.

/** Lowercase + keep [a-z0-9_]; ensure it starts with a letter/underscore; clamp to 63 bytes. */
function sanitize(raw: string, fallbackPrefix: string): string {
  let s = (raw || '').toLowerCase().replace(/[^a-z0-9_]/g, '_');
  if (!/^[a-z_]/.test(s)) s = `${fallbackPrefix}${s}`;
  return s.slice(0, 63) || `${fallbackPrefix}x`;
}

/** Postgres schema name for an org. Org ids are nanoid-ish (alphanumeric) → safe. */
export function orgSchema(orgId: string): string {
  return sanitize(`org_${orgId}`, 'org_');
}

/** Physical table name for an object, from its key (e.g. 'account', 'project__c'). */
export function objectTableName(key: string): string {
  return sanitize(key, 't_');
}

/** Physical column name for a field. Prefixed `f_` so it can never collide with a
 *  system column (id/name/owner_id/…) or a SQL reserved word. */
export function fieldColumnName(key: string): string {
  return sanitize(`f_${key}`, 'f_');
}

/** Quote an identifier for raw SQL injection. Inputs are already sanitized; this is
 *  defense-in-depth. */
export function qid(name: string): string {
  return `"${name.replace(/"/g, '""')}"`;
}

/** Fully-qualified `"schema"."table"`. */
export function qualified(orgId: string, tableName: string): string {
  return `${qid(orgSchema(orgId))}.${qid(tableName)}`;
}

/** System columns present on every object table (managed by the DDL engine). */
export const SYS = {
  id: 'id',
  ownerId: 'owner_id',
  recordTypeId: 'record_type_id',
  name: 'name',
  salesforceId: 'salesforce_id',
  createdAt: 'created_at',
  updatedAt: 'updated_at',
  createdById: 'created_by_id',
} as const;
