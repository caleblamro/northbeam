// In-app notifications — written by the flow engine's `notify` executor,
// read by the topbar bell. All reads/mutations are (org, user)-scoped so a
// user can never touch another user's items even inside their own org.

import { and, count, desc, eq, inArray, isNull } from 'drizzle-orm';
import type { DbExecutor } from '../client.js';
import { notification } from '../schema.js';

export type NotificationRow = typeof notification.$inferSelect;

export type NewNotificationInput = {
  organizationId: string;
  userId: string;
  title: string;
  body?: string | null;
  link?: string | null;
};

/** Bulk insert — one notify node can fan out to many recipients. Empty
 *  input is a no-op. */
export async function insertNotifications(
  db: DbExecutor,
  rows: NewNotificationInput[],
): Promise<NotificationRow[]> {
  if (rows.length === 0) return [];
  return db.insert(notification).values(rows).returning();
}

/** Page of the user's notifications, newest first. */
export async function listNotificationsForUser(
  db: DbExecutor,
  orgId: string,
  userId: string,
  opts: { limit?: number; offset?: number; unreadOnly?: boolean } = {},
): Promise<NotificationRow[]> {
  const conditions = [eq(notification.organizationId, orgId), eq(notification.userId, userId)];
  if (opts.unreadOnly) conditions.push(isNull(notification.readAt));
  return db
    .select()
    .from(notification)
    .where(and(...conditions))
    .orderBy(desc(notification.createdAt))
    .limit(opts.limit ?? 30)
    .offset(opts.offset ?? 0);
}

export async function unreadNotificationCount(
  db: DbExecutor,
  orgId: string,
  userId: string,
): Promise<number> {
  const [row] = await db
    .select({ value: count() })
    .from(notification)
    .where(
      and(
        eq(notification.organizationId, orgId),
        eq(notification.userId, userId),
        isNull(notification.readAt),
      ),
    );
  return row?.value ?? 0;
}

/** Mark specific notifications read. userId-scoped — ids belonging to other
 *  users are silently ignored. Returns how many rows flipped. */
export async function markNotificationsRead(
  db: DbExecutor,
  orgId: string,
  userId: string,
  ids: string[],
): Promise<number> {
  if (ids.length === 0) return 0;
  const rows = await db
    .update(notification)
    .set({ readAt: new Date() })
    .where(
      and(
        eq(notification.organizationId, orgId),
        eq(notification.userId, userId),
        inArray(notification.id, ids),
        isNull(notification.readAt),
      ),
    )
    .returning({ id: notification.id });
  return rows.length;
}

/** Mark everything unread for the user as read. Returns how many flipped. */
export async function markAllNotificationsRead(
  db: DbExecutor,
  orgId: string,
  userId: string,
): Promise<number> {
  const rows = await db
    .update(notification)
    .set({ readAt: new Date() })
    .where(
      and(
        eq(notification.organizationId, orgId),
        eq(notification.userId, userId),
        isNull(notification.readAt),
      ),
    )
    .returning({ id: notification.id });
  return rows.length;
}
