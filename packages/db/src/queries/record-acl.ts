// Per-record ACL helpers. The model is intentionally minimal:
//
//   - objectDef.defaultVisibility = 'public' → every workspace member can read
//     every record of that object. The owner can edit; admins can do anything.
//   - objectDef.defaultVisibility = 'private' → only the owner, admins, and
//     users with a recordShare row can read. Edit requires owner / admin / a
//     share with level='edit'.
//
// The `recordShare` table grants per-record access to specific users. The
// dynamic record-list / record-get queries fold the ACL into a WHERE clause
// so policy lives in the database, not in app code reading every row.

import { and, eq, inArray } from 'drizzle-orm';
import type { DbExecutor } from '../client.js';
import type { Role } from '../roles.js';
import { recordShare } from '../schema.js';

export type AccessLevel = 'read' | 'edit';

export type AclContext = {
  orgId: string;
  /** The caller. */
  userId: string;
  role: Role;
};

/** Admin-or-higher always sees every record in the org. */
export function isAdminish(role: Role): boolean {
  return role === 'owner' || role === 'admin';
}

/** Resolve the set of record ids visible to `userId` on a given object whose
 *  default visibility is `'private'`. Returns the ids that have an explicit
 *  share row at level >= `'read'`. Owner-based visibility is handled at the
 *  SQL layer (owner_id = userId) — this is just the explicit-share half. */
export async function visibleSharedRecordIds(
  db: DbExecutor,
  ctx: AclContext,
  objectId: string,
): Promise<string[]> {
  const rows = await db
    .select({ recordId: recordShare.recordId })
    .from(recordShare)
    .where(
      and(
        eq(recordShare.organizationId, ctx.orgId),
        eq(recordShare.objectId, objectId),
        eq(recordShare.userId, ctx.userId),
      ),
    );
  return rows.map((r) => r.recordId);
}

/** True if the caller can edit a specific record. Owner can edit; admin+ can
 *  always edit; explicit share with level='edit' grants edit. */
export async function canEditRecord(
  db: DbExecutor,
  ctx: AclContext,
  objectId: string,
  recordId: string,
  ownerId: string | null,
): Promise<boolean> {
  if (isAdminish(ctx.role)) return true;
  if (ownerId === ctx.userId) return true;
  const [share] = await db
    .select({ level: recordShare.level })
    .from(recordShare)
    .where(
      and(
        eq(recordShare.organizationId, ctx.orgId),
        eq(recordShare.objectId, objectId),
        eq(recordShare.recordId, recordId),
        eq(recordShare.userId, ctx.userId),
      ),
    )
    .limit(1);
  return share?.level === 'edit';
}

/** Grant or upgrade a share. Idempotent — a second call with the same params
 *  updates the level rather than creating a duplicate (the unique index on
 *  (object, record, user) enforces this physically too). */
export async function grantShare(
  db: DbExecutor,
  ctx: AclContext,
  opts: { objectId: string; recordId: string; userId: string; level: AccessLevel },
): Promise<void> {
  await db
    .insert(recordShare)
    .values({
      organizationId: ctx.orgId,
      objectId: opts.objectId,
      recordId: opts.recordId,
      userId: opts.userId,
      level: opts.level,
      grantedBy: ctx.userId,
    })
    .onConflictDoUpdate({
      target: [recordShare.objectId, recordShare.recordId, recordShare.userId],
      set: { level: opts.level, grantedBy: ctx.userId },
    });
}

export async function revokeShare(
  db: DbExecutor,
  ctx: AclContext,
  opts: { objectId: string; recordId: string; userId: string },
): Promise<void> {
  await db
    .delete(recordShare)
    .where(
      and(
        eq(recordShare.organizationId, ctx.orgId),
        eq(recordShare.objectId, opts.objectId),
        eq(recordShare.recordId, opts.recordId),
        eq(recordShare.userId, opts.userId),
      ),
    );
}

/** List shares for a specific record — drives the "Sharing" panel on the
 *  record detail page. */
export async function listSharesForRecord(
  db: DbExecutor,
  ctx: AclContext,
  objectId: string,
  recordId: string,
): Promise<Array<{ userId: string; level: AccessLevel; grantedBy: string | null }>> {
  const rows = await db
    .select({
      userId: recordShare.userId,
      level: recordShare.level,
      grantedBy: recordShare.grantedBy,
    })
    .from(recordShare)
    .where(
      and(
        eq(recordShare.organizationId, ctx.orgId),
        eq(recordShare.objectId, objectId),
        eq(recordShare.recordId, recordId),
      ),
    );
  return rows;
}

/** Bulk lookup: for a list of record ids, return the set the caller can edit.
 *  Used by list views to compute action availability per row without N queries. */
export async function editableRecordIds(
  db: DbExecutor,
  ctx: AclContext,
  objectId: string,
  recordIds: string[],
): Promise<Set<string>> {
  if (isAdminish(ctx.role)) return new Set(recordIds);
  if (recordIds.length === 0) return new Set();
  const rows = await db
    .select({ recordId: recordShare.recordId })
    .from(recordShare)
    .where(
      and(
        eq(recordShare.organizationId, ctx.orgId),
        eq(recordShare.objectId, objectId),
        eq(recordShare.userId, ctx.userId),
        eq(recordShare.level, 'edit'),
        inArray(recordShare.recordId, recordIds),
      ),
    );
  return new Set(rows.map((r) => r.recordId));
}
