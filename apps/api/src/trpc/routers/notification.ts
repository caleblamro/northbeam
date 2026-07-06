// /trpc/notification — the topbar bell. Strictly self-scoped: every query
// helper takes (orgId, userId) and foreign ids are ignored by the db layer,
// so no procedure here can read or mutate another user's items.

import {
  listNotificationsForUser,
  markAllNotificationsRead,
  markNotificationsRead,
  unreadNotificationCount,
} from '@northbeam/db';
import { z } from 'zod';
import { protectedProcedure, router } from '../trpc.js';

export const notificationRouter = router({
  list: protectedProcedure
    .input(
      z
        .object({
          limit: z.number().int().min(1).max(100).default(30),
          offset: z.number().int().min(0).default(0),
          unreadOnly: z.boolean().default(false),
        })
        .default({ limit: 30, offset: 0, unreadOnly: false }),
    )
    .query(async ({ ctx, input }) => {
      const orgId = ctx.auth.organizationId;
      const userId = ctx.auth.userId;
      const [items, unreadCount] = await Promise.all([
        listNotificationsForUser(ctx.db, orgId, userId, input),
        unreadNotificationCount(ctx.db, orgId, userId),
      ]);
      return {
        items: items.map((n) => ({
          id: n.id,
          title: n.title,
          body: n.body,
          link: n.link,
          readAt: n.readAt,
          createdAt: n.createdAt,
        })),
        unreadCount,
      };
    }),

  unreadCount: protectedProcedure.query(({ ctx }) =>
    unreadNotificationCount(ctx.db, ctx.auth.organizationId, ctx.auth.userId),
  ),

  markRead: protectedProcedure
    .input(z.object({ ids: z.array(z.string().uuid()).min(1).max(100) }))
    .mutation(async ({ ctx, input }) => {
      const updated = await markNotificationsRead(
        ctx.db,
        ctx.auth.organizationId,
        ctx.auth.userId,
        input.ids,
      );
      return { updated };
    }),

  markAllRead: protectedProcedure.mutation(async ({ ctx }) => {
    const updated = await markAllNotificationsRead(
      ctx.db,
      ctx.auth.organizationId,
      ctx.auth.userId,
    );
    return { updated };
  }),
});
