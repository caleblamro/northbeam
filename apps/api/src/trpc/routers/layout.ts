// /trpc/layout — read + write the layoutDef overrides on top of an object's
// default-default JSONB layout (objectDef.layout). The resolver lives in
// @northbeam/db (resolveLayout); this router exposes the CRUD admins use to
// customise per-recordType / per-audience layouts in the UI.

import { listLayouts, resolveLayout, schema } from '@northbeam/db';
import { TRPCError } from '@trpc/server';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import { permissionProcedure, protectedProcedure, router } from '../trpc.js';

const LayoutSectionSchema = z.object({
  id: z.string(),
  label: z.string(),
  cols: z.union([z.literal(1), z.literal(2)]).optional(),
  fields: z.array(z.string()),
});

const ObjectLayoutSchema = z.object({
  sections: z.array(LayoutSectionSchema).optional(),
  compactKeys: z.array(z.string()).optional(),
  statKeys: z.array(z.string()).optional(),
  listColumns: z.array(z.string()).optional(),
});

export const layoutRouter = router({
  /** Every override row for an object. The default-default
   *  (objectDef.layout) is not included — fetch via object.get. */
  list: protectedProcedure
    .input(z.object({ objectId: z.string().uuid() }))
    .query(({ ctx, input }) => listLayouts(ctx.db, ctx.auth.organizationId, input.objectId)),

  /** Resolve the layout for a request: most-specific (rt, audience) match
   *  with fallback to objectDef.layout. Used by the dispatcher to render the
   *  right form for the active record-type / role. */
  resolve: protectedProcedure
    .input(
      z.object({
        objectId: z.string().uuid(),
        recordTypeId: z.string().uuid().nullable().optional(),
        audience: z.string().nullable().optional(),
      }),
    )
    .query(({ ctx, input }) =>
      resolveLayout(ctx.db, {
        orgId: ctx.auth.organizationId,
        objectId: input.objectId,
        recordTypeId: input.recordTypeId ?? null,
        audience: input.audience ?? null,
      }),
    ),

  /** Create or replace a layout override. The (objectId, recordTypeId,
   *  audience, name) tuple is unique — a second upsert with the same key
   *  updates in place. Admin+. */
  upsert: permissionProcedure('object.manage')
    .input(
      z.object({
        id: z.string().uuid().optional(),
        objectId: z.string().uuid(),
        recordTypeId: z.string().uuid().nullable().optional(),
        audience: z.string().min(1).nullable().optional(),
        name: z.string().min(1).max(80),
        layout: ObjectLayoutSchema,
        isDefault: z.boolean().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const orgId = ctx.auth.organizationId;
      if (input.id) {
        const [row] = await ctx.db
          .update(schema.layoutDef)
          .set({
            recordTypeId: input.recordTypeId ?? null,
            audience: input.audience ?? null,
            name: input.name,
            layout: input.layout,
            isDefault: input.isDefault ?? true,
            updatedAt: new Date(),
          })
          .where(and(eq(schema.layoutDef.id, input.id), eq(schema.layoutDef.organizationId, orgId)))
          .returning();
        if (!row) throw new TRPCError({ code: 'NOT_FOUND' });
        return row;
      }
      const [row] = await ctx.db
        .insert(schema.layoutDef)
        .values({
          organizationId: orgId,
          objectId: input.objectId,
          recordTypeId: input.recordTypeId ?? null,
          audience: input.audience ?? null,
          name: input.name,
          layout: input.layout,
          isDefault: input.isDefault ?? true,
        })
        .returning();
      if (!row) throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR' });
      return row;
    }),

  /** Remove an override row. Admin+. The default-default (objectDef.layout)
   *  is unaffected — it stays as the fallback. */
  delete: permissionProcedure('object.manage')
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      await ctx.db
        .delete(schema.layoutDef)
        .where(
          and(
            eq(schema.layoutDef.id, input.id),
            eq(schema.layoutDef.organizationId, ctx.auth.organizationId),
          ),
        );
      return { ok: true as const };
    }),
});
