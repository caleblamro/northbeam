// Global picklist sets (SF Global Value Sets) — typed CRUD plus the two
// read-path helpers: usedBy (which picklist fields draw from a set, app-side
// filter over config.globalPicklistId) and the batched option hydrator the
// record/object serving reads call (reference-at-read).

import { and, asc, eq, inArray } from 'drizzle-orm';
import type { DbExecutor } from '../client.js';
import { type PicklistOption, narrowFieldConfig } from '../field-types.js';
import { fieldDef, globalPicklist, objectDef } from '../schema.js';
import type { FieldRow } from './crm.js';

export type GlobalPicklistRow = typeof globalPicklist.$inferSelect;

export type PicklistUsage = {
  objectId: string;
  objectKey: string;
  objectLabel: string;
  fieldId: string;
  fieldKey: string;
  fieldLabel: string;
};

export async function listGlobalPicklists(
  db: DbExecutor,
  orgId: string,
): Promise<GlobalPicklistRow[]> {
  return db
    .select()
    .from(globalPicklist)
    .where(eq(globalPicklist.organizationId, orgId))
    .orderBy(asc(globalPicklist.name));
}

export async function getGlobalPicklist(
  db: DbExecutor,
  orgId: string,
  id: string,
): Promise<GlobalPicklistRow | null> {
  const [row] = await db
    .select()
    .from(globalPicklist)
    .where(and(eq(globalPicklist.organizationId, orgId), eq(globalPicklist.id, id)))
    .limit(1);
  return row ?? null;
}

export async function createGlobalPicklist(
  db: DbExecutor,
  input: {
    organizationId: string;
    name: string;
    description?: string | null;
    values: PicklistOption[];
  },
): Promise<GlobalPicklistRow> {
  const [row] = await db.insert(globalPicklist).values(input).returning();
  if (!row) throw new Error('global picklist insert returned no row');
  return row;
}

export async function updateGlobalPicklist(
  db: DbExecutor,
  orgId: string,
  id: string,
  patch: {
    name?: string;
    /** `null` clears the description. */
    description?: string | null;
    values?: PicklistOption[];
  },
): Promise<GlobalPicklistRow | null> {
  const [row] = await db
    .update(globalPicklist)
    .set({
      ...(patch.name !== undefined ? { name: patch.name } : {}),
      ...(patch.description !== undefined ? { description: patch.description } : {}),
      ...(patch.values !== undefined ? { values: patch.values } : {}),
      updatedAt: new Date(),
    })
    .where(and(eq(globalPicklist.organizationId, orgId), eq(globalPicklist.id, id)))
    .returning();
  return row ?? null;
}

export async function deleteGlobalPicklist(
  db: DbExecutor,
  orgId: string,
  id: string,
): Promise<boolean> {
  const rows = await db
    .delete(globalPicklist)
    .where(and(eq(globalPicklist.organizationId, orgId), eq(globalPicklist.id, id)))
    .returning({ id: globalPicklist.id });
  return rows.length > 0;
}

/** Every picklist/multipicklist field in the org that draws from a global set,
 *  with its object's labels. The globalPicklistId lives inside JSONB config, so
 *  the set filter runs app-side — picklist fields per org number in the
 *  hundreds at most. */
async function assignedPicklistFields(
  db: DbExecutor,
  orgId: string,
): Promise<Array<{ field: FieldRow; setId: string; objectKey: string; objectLabel: string }>> {
  const rows = await db
    .select({ field: fieldDef, objectKey: objectDef.key, objectLabel: objectDef.label })
    .from(fieldDef)
    .innerJoin(objectDef, eq(fieldDef.objectId, objectDef.id))
    .where(
      and(
        eq(fieldDef.organizationId, orgId),
        inArray(fieldDef.type, ['picklist', 'multipicklist']),
      ),
    )
    .orderBy(asc(objectDef.label), asc(fieldDef.orderIndex));
  const out: Array<{ field: FieldRow; setId: string; objectKey: string; objectLabel: string }> = [];
  for (const row of rows) {
    const setId = narrowFieldConfig('picklist', row.field.config).globalPicklistId;
    if (setId) out.push({ ...row, setId });
  }
  return out;
}

export async function globalPicklistUsedBy(
  db: DbExecutor,
  orgId: string,
  id: string,
): Promise<PicklistUsage[]> {
  const assigned = await assignedPicklistFields(db, orgId);
  return assigned
    .filter((row) => row.setId === id)
    .map(({ field, objectKey, objectLabel }) => ({
      objectId: field.objectId,
      objectKey,
      objectLabel,
      fieldId: field.id,
      fieldKey: field.key,
      fieldLabel: field.label,
    }));
}

/** setId → number of assigned fields, for the picklist admin list in one pass. */
export async function globalPicklistUsageCounts(
  db: DbExecutor,
  orgId: string,
): Promise<Map<string, number>> {
  const counts = new Map<string, number>();
  for (const { setId } of await assignedPicklistFields(db, orgId)) {
    counts.set(setId, (counts.get(setId) ?? 0) + 1);
  }
  return counts;
}

/** Materialize config.options for every field bound to a global set, in one
 *  batched IN query. The globalPicklistId stays in config so the admin UI can
 *  show provenance; a set that no longer exists leaves the field untouched
 *  (renders optionless rather than failing the read). */
export async function hydratePicklistOptions(
  db: DbExecutor,
  orgId: string,
  fields: FieldRow[],
): Promise<FieldRow[]> {
  const setIds = new Set<string>();
  for (const field of fields) {
    if (field.type !== 'picklist' && field.type !== 'multipicklist') continue;
    const setId = narrowFieldConfig('picklist', field.config).globalPicklistId;
    if (setId) setIds.add(setId);
  }
  if (setIds.size === 0) return fields;
  const sets = await db
    .select({ id: globalPicklist.id, values: globalPicklist.values })
    .from(globalPicklist)
    .where(and(eq(globalPicklist.organizationId, orgId), inArray(globalPicklist.id, [...setIds])));
  const valuesById = new Map(sets.map((s) => [s.id, s.values]));
  return fields.map((field) => {
    if (field.type !== 'picklist' && field.type !== 'multipicklist') return field;
    const config = narrowFieldConfig('picklist', field.config);
    const values = config.globalPicklistId ? valuesById.get(config.globalPicklistId) : undefined;
    if (!values) return field;
    return { ...field, config: { ...config, options: values } };
  });
}
