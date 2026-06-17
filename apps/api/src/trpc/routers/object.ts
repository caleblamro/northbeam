// /trpc/object — read the metadata layer (object defs + their fields). Powers
// the dynamic table/form renderers and the object-manager UI.

import { getObjectByKey, listObjects, schema, writeAuditEvent } from '@northbeam/db';
import { TRPCError } from '@trpc/server';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import { permissionProcedure, protectedProcedure, router } from '../trpc.js';

const LayoutSectionSchema = z.object({
  id: z.string().min(1).max(40),
  label: z.string().min(1).max(80),
  cols: z.union([z.literal(1), z.literal(2)]).optional(),
  fields: z.array(z.string()),
});

const ObjectLayoutSchema = z.object({
  sections: z.array(LayoutSectionSchema).optional(),
  compactKeys: z.array(z.string()).optional(),
  statKeys: z.array(z.string()).optional(),
  listColumns: z.array(z.string()).optional(),
});

export const objectRouter = router({
  /** All objects in the workspace (standard + custom + SF-imported). */
  list: protectedProcedure.query(({ ctx }) => listObjects(ctx.db, ctx.auth.organizationId)),

  /** One object by key, with its ordered fields. */
  get: protectedProcedure.input(z.object({ key: z.string() })).query(async ({ ctx, input }) => {
    const result = await getObjectByKey(ctx.db, ctx.auth.organizationId, input.key);
    if (!result) {
      throw new TRPCError({ code: 'NOT_FOUND', message: `object '${input.key}' not found` });
    }
    return result;
  }),

  /** Persist the form-layout customizer's output back onto the object def.
   *  Validates the layout shape but does NOT enforce that every section
   *  field key still exists — the customizer is responsible for filtering
   *  stale references. Admin+ only (matches the existing org.settings.update
   *  gate; field schema changes are a workspace-admin concern). */
  updateLayout: permissionProcedure('org.settings.update')
    .input(
      z.object({
        objectId: z.string().uuid(),
        layout: ObjectLayoutSchema,
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const [updated] = await ctx.db
        .update(schema.objectDef)
        .set({ layout: input.layout, updatedAt: new Date() })
        .where(
          and(
            eq(schema.objectDef.organizationId, ctx.auth.organizationId),
            eq(schema.objectDef.id, input.objectId),
          ),
        )
        .returning();
      if (!updated) {
        throw new TRPCError({ code: 'NOT_FOUND', message: `object '${input.objectId}' not found` });
      }
      await writeAuditEvent(ctx.db, {
        organizationId: ctx.auth.organizationId,
        userId: ctx.auth.userId,
        action: 'object.layout.updated',
        targetType: 'object',
        targetId: input.objectId,
        meta: {
          objectKey: updated.key,
          sectionCount: input.layout.sections?.length ?? 0,
        },
      });
      return updated;
    }),
});
