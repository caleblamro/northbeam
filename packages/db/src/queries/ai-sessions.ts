// AI composer sessions — a user's threads with the dashboard composer.
// Personal by default: `listAiSessions` is scoped by (organizationId, userId).
// A thread can opt into read-only sharing via `sharedWith` (same ShareTarget
// vocabulary as saved views); `listSharedAiSessions` / `getAiSessionForUser`
// resolve that visibility in SQL, mirroring queries/views.ts. Saving a
// finished dashboard goes through the `view` table; these rows just let the
// drawer resume a conversation (messages + latest artifact) later.

import { type SQL, and, desc, eq, ne, or, sql } from 'drizzle-orm';
import type { DbExecutor } from '../client.js';
import type { Role } from '../roles.js';
import { type AiSessionMessage, aiSession } from '../schema.js';
import type { ShareTarget } from '../views.js';

export type AiSessionRow = typeof aiSession.$inferSelect;
export type { AiSessionMessage };

/** Newest-first sessions for one user. `messages`/`artifact` ride along —
 *  session bodies are small (a handful of turns), so the list doubles as the
 *  resume payload without a second round trip. */
export async function listAiSessions(
  db: DbExecutor,
  opts: { orgId: string; userId: string; limit?: number },
): Promise<AiSessionRow[]> {
  return db
    .select()
    .from(aiSession)
    .where(and(eq(aiSession.organizationId, opts.orgId), eq(aiSession.userId, opts.userId)))
    .orderBy(desc(aiSession.updatedAt))
    .limit(Math.min(Math.max(opts.limit ?? 20, 1), 50));
}

/** SQL predicate for "sharedWith grants user `u` access": the array contains
 *  {kind:'org'}, {kind:'role', role: u.role}, or {kind:'user', userId: u.id}.
 *  Same `@>` jsonb containment pattern as queries/views.ts visibleToUser. */
function sharedWithUser(userId: string, role: Role): SQL {
  const orgShared = sql`${aiSession.sharedWith} @> ${JSON.stringify([{ kind: 'org' }])}::jsonb`;
  const roleShared = sql`${aiSession.sharedWith} @> ${JSON.stringify([{ kind: 'role', role }])}::jsonb`;
  const userShared = sql`${aiSession.sharedWith} @> ${JSON.stringify([{ kind: 'user', userId }])}::jsonb`;
  return or(orgShared, roleShared, userShared) as SQL;
}

/** Newest-first sessions OTHER users shared with this one (org-wide, to the
 *  caller's role, or directly). The caller's own threads are excluded —
 *  `listAiSessions` already covers those. */
export async function listSharedAiSessions(
  db: DbExecutor,
  opts: { orgId: string; userId: string; role: Role; limit?: number },
): Promise<AiSessionRow[]> {
  return db
    .select()
    .from(aiSession)
    .where(
      and(
        eq(aiSession.organizationId, opts.orgId),
        ne(aiSession.userId, opts.userId),
        sharedWithUser(opts.userId, opts.role),
      ),
    )
    .orderBy(desc(aiSession.updatedAt))
    .limit(Math.min(Math.max(opts.limit ?? 20, 1), 50));
}

/** One session the user may read: their own, or one shared with them. Null
 *  when missing or not visible. */
export async function getAiSessionForUser(
  db: DbExecutor,
  opts: { orgId: string; userId: string; role: Role; id: string },
): Promise<AiSessionRow | null> {
  const [row] = await db
    .select()
    .from(aiSession)
    .where(
      and(
        eq(aiSession.id, opts.id),
        eq(aiSession.organizationId, opts.orgId),
        or(eq(aiSession.userId, opts.userId), sharedWithUser(opts.userId, opts.role)),
      ),
    )
    .limit(1);
  return row ?? null;
}

export type UpsertAiSessionInput = {
  orgId: string;
  userId: string;
  /** Omit to create; pass to update. An id that doesn't exist (or belongs to
   *  someone else) falls through to create so a stale client can't clobber. */
  id?: string;
  objectKey: string;
  title: string;
  messages: AiSessionMessage[];
  artifact?: unknown;
  /** Agent preset the thread runs as. Null/omitted = the default composer. */
  agentId?: string | null;
  /** Model id picked for the thread. Null/omitted = the org default model. */
  model?: string | null;
  /** Read-only shares. Omitted = leave unchanged on update, [] on create. */
  sharedWith?: ShareTarget[];
};

/** Create or update one session; returns the row (create) / id (update). */
export async function upsertAiSession(
  db: DbExecutor,
  input: UpsertAiSessionInput,
): Promise<{ id: string }> {
  if (input.id) {
    const [updated] = await db
      .update(aiSession)
      .set({
        objectKey: input.objectKey,
        title: input.title,
        messages: input.messages,
        artifact: input.artifact ?? null,
        agentId: input.agentId ?? null,
        model: input.model ?? null,
        ...(input.sharedWith !== undefined ? { sharedWith: input.sharedWith } : {}),
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(aiSession.id, input.id),
          eq(aiSession.organizationId, input.orgId),
          eq(aiSession.userId, input.userId),
        ),
      )
      .returning({ id: aiSession.id });
    if (updated) return updated;
  }
  const [created] = await db
    .insert(aiSession)
    .values({
      organizationId: input.orgId,
      userId: input.userId,
      objectKey: input.objectKey,
      title: input.title,
      messages: input.messages,
      artifact: input.artifact ?? null,
      agentId: input.agentId ?? null,
      model: input.model ?? null,
      sharedWith: input.sharedWith ?? [],
    })
    .returning({ id: aiSession.id });
  if (!created) throw new Error('failed to create ai session');
  return created;
}

/** Replace a session's share targets. Owner-only by construction — the
 *  update is keyed on (id, org, caller). False when the row isn't the
 *  caller's (or doesn't exist). */
export async function setAiSessionShare(
  db: DbExecutor,
  opts: { orgId: string; userId: string; id: string; sharedWith: ShareTarget[] },
): Promise<boolean> {
  const rows = await db
    .update(aiSession)
    .set({ sharedWith: opts.sharedWith, updatedAt: new Date() })
    .where(
      and(
        eq(aiSession.id, opts.id),
        eq(aiSession.organizationId, opts.orgId),
        eq(aiSession.userId, opts.userId),
      ),
    )
    .returning({ id: aiSession.id });
  return rows.length > 0;
}

export async function deleteAiSession(
  db: DbExecutor,
  opts: { orgId: string; userId: string; id: string },
): Promise<void> {
  await db
    .delete(aiSession)
    .where(
      and(
        eq(aiSession.id, opts.id),
        eq(aiSession.organizationId, opts.orgId),
        eq(aiSession.userId, opts.userId),
      ),
    );
}
