// record_type CRUD — typed Drizzle only. The per-org physical tables hold the
// record_type_id pointers; live counts + reassignment are dynamic-layer work
// (countByRecordType / reassignRecordType in src/dynamic/records.ts).

import { and, asc, eq } from 'drizzle-orm';
import type { DbExecutor } from '../client.js';
import { recordType } from '../schema.js';

export type RecordTypeRow = typeof recordType.$inferSelect;

export async function listRecordTypes(
  db: DbExecutor,
  orgId: string,
  objectId: string,
): Promise<RecordTypeRow[]> {
  return db
    .select()
    .from(recordType)
    .where(and(eq(recordType.organizationId, orgId), eq(recordType.objectId, objectId)))
    .orderBy(asc(recordType.label));
}

export async function getRecordType(
  db: DbExecutor,
  orgId: string,
  id: string,
): Promise<RecordTypeRow | null> {
  const [row] = await db
    .select()
    .from(recordType)
    .where(and(eq(recordType.organizationId, orgId), eq(recordType.id, id)))
    .limit(1);
  return row ?? null;
}

export async function createRecordType(
  db: DbExecutor,
  input: {
    organizationId: string;
    objectId: string;
    key: string;
    label: string;
    isDefault?: boolean;
    active?: boolean;
  },
): Promise<RecordTypeRow> {
  const [row] = await db.insert(recordType).values(input).returning();
  if (!row) throw new Error('record type insert returned no row');
  return row;
}

export async function updateRecordType(
  db: DbExecutor,
  orgId: string,
  id: string,
  patch: { label?: string; active?: boolean; isDefault?: boolean },
): Promise<RecordTypeRow | null> {
  const [row] = await db
    .update(recordType)
    .set({
      ...(patch.label !== undefined ? { label: patch.label } : {}),
      ...(patch.active !== undefined ? { active: patch.active } : {}),
      ...(patch.isDefault !== undefined ? { isDefault: patch.isDefault } : {}),
    })
    .where(and(eq(recordType.organizationId, orgId), eq(recordType.id, id)))
    .returning();
  return row ?? null;
}

export async function deleteRecordType(
  db: DbExecutor,
  orgId: string,
  id: string,
): Promise<boolean> {
  const rows = await db
    .delete(recordType)
    .where(and(eq(recordType.organizationId, orgId), eq(recordType.id, id)))
    .returning({ id: recordType.id });
  return rows.length > 0;
}

/** Drop the default flag from every type on the object — the first half of
 *  the clear-then-set default pattern (mirrors view.setDefault). */
export async function clearDefaultRecordType(
  db: DbExecutor,
  orgId: string,
  objectId: string,
): Promise<void> {
  await db
    .update(recordType)
    .set({ isDefault: false })
    .where(
      and(
        eq(recordType.organizationId, orgId),
        eq(recordType.objectId, objectId),
        eq(recordType.isDefault, true),
      ),
    );
}
