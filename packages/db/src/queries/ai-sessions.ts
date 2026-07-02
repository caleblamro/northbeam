// AI composer sessions — a user's private threads with the dashboard
// composer. Every query is scoped by (organizationId, userId): sessions are
// personal working drafts, never shared. Saving a finished dashboard goes
// through the `view` table; these rows just let the drawer resume a
// conversation (messages + latest artifact) later.

import { and, desc, eq } from 'drizzle-orm';
import type { DbExecutor } from '../client.js';
import { type AiSessionMessage, aiSession } from '../schema.js';

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
    })
    .returning({ id: aiSession.id });
  if (!created) throw new Error('failed to create ai session');
  return created;
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
