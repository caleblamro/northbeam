// Saved-view queries. Visibility filtering is enforced in SQL (not in the
// tRPC router) so every consumer — current tRPC, future server actions,
// background jobs that pull a user's views for AI summarisation — gets the
// same access rules.

import { type SQL, and, asc, desc, eq, or, sql } from 'drizzle-orm';
import type { DbExecutor } from '../client.js';
import type { Role } from '../roles.js';
import { view } from '../schema.js';

export type ViewRow = typeof view.$inferSelect;

/** SQL predicate for "user `u` can see this view". The view is visible when:
 *    - they own it, OR
 *    - sharedWith contains {kind:'org'}, OR
 *    - sharedWith contains {kind:'role', role: u.role}, OR
 *    - sharedWith contains {kind:'user', userId: u.id}
 *  Org isolation is enforced by the caller (always pair this with
 *  `view.organizationId = :orgId`). */
function visibleToUser(userId: string, role: Role): SQL {
  // jsonb_path_exists is the cleanest "array contains object that matches"
  // predicate Postgres has. The path is a JSONPath against the column.
  const ownerMatch = sql`${view.ownerId} = ${userId}`;
  const orgShared = sql`jsonb_path_exists(${view.sharedWith}, '$[*] ? (@.kind == "org")')`;
  const roleShared = sql`jsonb_path_exists(${view.sharedWith}, ${`$[*] ? (@.kind == "role" && @.role == "${role}")`})`;
  const userShared = sql`jsonb_path_exists(${view.sharedWith}, ${`$[*] ? (@.kind == "user" && @.userId == "${userId}")`})`;
  return or(ownerMatch, orgShared, roleShared, userShared) as SQL;
}

/** All views visible to the user, optionally narrowed to a single object.
 *  Defaults come first so the dispatcher can land on one without extra
 *  bookkeeping; everything else sorts by label. */
export async function listViewsForUser(
  db: DbExecutor,
  orgId: string,
  userId: string,
  role: Role,
  objectId?: string,
): Promise<ViewRow[]> {
  const where = objectId
    ? and(eq(view.organizationId, orgId), eq(view.objectId, objectId), visibleToUser(userId, role))
    : and(eq(view.organizationId, orgId), visibleToUser(userId, role));
  return db
    .select()
    .from(view)
    .where(where)
    .orderBy(desc(view.isDefault), asc(view.label));
}

/** One view by id, scoped to the org. Visibility check is the caller's job —
 *  this is used internally where we already know the user has access (the
 *  tRPC procedure runs it after a list lookup). */
export async function getView(
  db: DbExecutor,
  orgId: string,
  viewId: string,
): Promise<ViewRow | null> {
  const [row] = await db
    .select()
    .from(view)
    .where(and(eq(view.organizationId, orgId), eq(view.id, viewId)))
    .limit(1);
  return row ?? null;
}

/** Default view for an object — the dispatcher's fallback when the URL
 *  doesn't specify `?view=…`. Prefers an `is_default=true` row; falls back
 *  to the oldest list view; returns null if no views exist yet. */
export async function getDefaultView(
  db: DbExecutor,
  orgId: string,
  objectId: string,
): Promise<ViewRow | null> {
  const [row] = await db
    .select()
    .from(view)
    .where(and(eq(view.organizationId, orgId), eq(view.objectId, objectId)))
    .orderBy(desc(view.isDefault), asc(view.createdAt))
    .limit(1);
  return row ?? null;
}
