// /trpc/comment — flat per-record comments (the record page's Comments tab).
// Read requires read access on the record's object (via ctx.records.readable);
// authors can delete their own comments, record-admins can delete any.

import { isAdminish, schema } from '@northbeam/db';
import { TRPCError } from '@trpc/server';
import { and, asc, eq } from 'drizzle-orm';
import { z } from 'zod';
import { protectedProcedure, router } from '../trpc.js';

export const commentRouter = router({
  list: protectedProcedure
    .input(z.object({ objectKey: z.string(), recordId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const authed = await ctx.records.readable(input.objectKey);
      if (!authed) throw new TRPCError({ code: 'FORBIDDEN' });
      const rows = await ctx.db
        .select({
          id: schema.recordComment.id,
          body: schema.recordComment.body,
          authorId: schema.recordComment.authorId,
          authorName: schema.user.name,
          authorEmail: schema.user.email,
          createdAt: schema.recordComment.createdAt,
        })
        .from(schema.recordComment)
        .leftJoin(schema.user, eq(schema.user.id, schema.recordComment.authorId))
        .where(
          and(
            eq(schema.recordComment.organizationId, ctx.auth.organizationId),
            eq(schema.recordComment.objectKey, input.objectKey),
            eq(schema.recordComment.recordId, input.recordId),
          ),
        )
        .orderBy(asc(schema.recordComment.createdAt));
      return rows;
    }),

  create: protectedProcedure
    .input(
      z.object({
        objectKey: z.string(),
        recordId: z.string().uuid(),
        body: z.string().trim().min(1).max(4000),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const authed = await ctx.records.readable(input.objectKey);
      if (!authed) throw new TRPCError({ code: 'FORBIDDEN' });
      const [row] = await ctx.db
        .insert(schema.recordComment)
        .values({
          organizationId: ctx.auth.organizationId,
          objectKey: input.objectKey,
          recordId: input.recordId,
          authorId: ctx.auth.userId,
          body: input.body,
        })
        .returning({ id: schema.recordComment.id });
      return { id: row?.id };
    }),

  remove: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const [existing] = await ctx.db
        .select()
        .from(schema.recordComment)
        .where(
          and(
            eq(schema.recordComment.id, input.id),
            eq(schema.recordComment.organizationId, ctx.auth.organizationId),
          ),
        )
        .limit(1);
      if (!existing) throw new TRPCError({ code: 'NOT_FOUND' });
      if (existing.authorId !== ctx.auth.userId && !isAdminish(ctx.auth.role)) {
        throw new TRPCError({ code: 'FORBIDDEN', message: 'not your comment' });
      }
      await ctx.db.delete(schema.recordComment).where(eq(schema.recordComment.id, input.id));
      return { ok: true as const };
    }),
});
