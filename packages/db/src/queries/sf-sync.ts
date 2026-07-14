// Write-back outbox + poll-cursor persistence for the two-way Salesforce sync.
// Outbox rows accumulate dirty field keys per record (union on conflict) so
// coalesced edits sync as one PATCH and worker retries never lose keys.

import { and, eq, sql } from 'drizzle-orm';
import type { DbExecutor } from '../client.js';
import { sfSyncCursor, sfSyncOutbox } from '../schema.js';

export type SfSyncOutboxRow = typeof sfSyncOutbox.$inferSelect;
export type SfSyncCursorRow = typeof sfSyncCursor.$inferSelect;

/** Record local edits for later push. Call INSIDE the mutating transaction so
 *  the outbox row commits atomically with the record write. */
export async function markDirtyForSync(
  db: DbExecutor,
  opts: { orgId: string; objectKey: string; recordId: string; dirtyKeys: string[] },
): Promise<void> {
  if (!opts.dirtyKeys.length) return;
  await db
    .insert(sfSyncOutbox)
    .values({
      organizationId: opts.orgId,
      objectKey: opts.objectKey,
      recordId: opts.recordId,
      dirtyKeys: opts.dirtyKeys,
    })
    .onConflictDoUpdate({
      target: [sfSyncOutbox.organizationId, sfSyncOutbox.objectKey, sfSyncOutbox.recordId],
      set: {
        // Set-union of existing + incoming keys, deduped in SQL.
        dirtyKeys: sql`(
          select coalesce(jsonb_agg(distinct k), '[]'::jsonb)
          from jsonb_array_elements_text(${sfSyncOutbox.dirtyKeys} || ${JSON.stringify(opts.dirtyKeys)}::jsonb) as t(k)
        )`,
        updatedAt: new Date(),
      },
    });
}

export async function getOutboxRow(
  db: DbExecutor,
  orgId: string,
  objectKey: string,
  recordId: string,
): Promise<SfSyncOutboxRow | null> {
  const [row] = await db
    .select()
    .from(sfSyncOutbox)
    .where(
      and(
        eq(sfSyncOutbox.organizationId, orgId),
        eq(sfSyncOutbox.objectKey, objectKey),
        eq(sfSyncOutbox.recordId, recordId),
      ),
    )
    .limit(1);
  return row ?? null;
}

/** Clear an outbox row only if it hasn't been touched since `asOf` — a newer
 *  edit during the push keeps its (unioned) row for the next cycle. Returns
 *  true when the row was cleared. */
export async function clearOutboxRow(
  db: DbExecutor,
  row: Pick<SfSyncOutboxRow, 'id' | 'updatedAt'>,
): Promise<boolean> {
  const res = await db
    .delete(sfSyncOutbox)
    .where(and(eq(sfSyncOutbox.id, row.id), eq(sfSyncOutbox.updatedAt, row.updatedAt)))
    .returning({ id: sfSyncOutbox.id });
  return res.length > 0;
}

export async function listOutboxRecords(
  db: DbExecutor,
  orgId: string,
  limit = 200,
): Promise<SfSyncOutboxRow[]> {
  return db
    .select()
    .from(sfSyncOutbox)
    .where(eq(sfSyncOutbox.organizationId, orgId))
    .orderBy(sfSyncOutbox.updatedAt)
    .limit(limit);
}

export async function getCursor(
  db: DbExecutor,
  orgId: string,
  objectKey: string,
): Promise<SfSyncCursorRow | null> {
  const [row] = await db
    .select()
    .from(sfSyncCursor)
    .where(and(eq(sfSyncCursor.organizationId, orgId), eq(sfSyncCursor.objectKey, objectKey)))
    .limit(1);
  return row ?? null;
}

export async function setCursor(
  db: DbExecutor,
  opts: { orgId: string; objectKey: string; sfObject: string; lastModstamp: string },
): Promise<void> {
  await db
    .insert(sfSyncCursor)
    .values({
      organizationId: opts.orgId,
      objectKey: opts.objectKey,
      sfObject: opts.sfObject,
      lastModstamp: opts.lastModstamp,
    })
    .onConflictDoUpdate({
      target: [sfSyncCursor.organizationId, sfSyncCursor.objectKey],
      set: { lastModstamp: opts.lastModstamp, sfObject: opts.sfObject, updatedAt: new Date() },
    });
}
