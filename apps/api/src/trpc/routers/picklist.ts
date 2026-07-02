// /trpc/picklist — global picklist set CRUD (SF Global Value Sets). Fields
// bind via config.globalPicklistId (reference-at-read): editing a set's values
// updates every assigned field with a single row write, no fan-out. Deleting
// a set is blocked while any field still draws from it.

import {
  PicklistOptionSchema,
  createGlobalPicklist,
  deleteGlobalPicklist,
  getGlobalPicklist,
  globalPicklistUsageCounts,
  globalPicklistUsedBy,
  listGlobalPicklists,
  updateGlobalPicklist,
  writeAuditEvent,
} from '@northbeam/db';
import { TRPCError } from '@trpc/server';
import { z } from 'zod';
import { permissionProcedure, protectedProcedure, router } from '../trpc.js';

const ValuesSchema = z.array(PicklistOptionSchema).min(1, 'a set needs at least one value');

export const picklistRouter = router({
  /** Every set in the workspace, with how many fields draw from each. */
  list: protectedProcedure.query(async ({ ctx }) => {
    const orgId = ctx.auth.organizationId;
    const sets = await listGlobalPicklists(ctx.db, orgId);
    const counts = await globalPicklistUsageCounts(ctx.db, orgId);
    return sets.map((set) => ({ ...set, usedByCount: counts.get(set.id) ?? 0 }));
  }),

  /** One set with the full list of fields assigned to it. */
  get: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const orgId = ctx.auth.organizationId;
      const set = await getGlobalPicklist(ctx.db, orgId, input.id);
      if (!set) {
        throw new TRPCError({ code: 'NOT_FOUND', message: `picklist set '${input.id}' not found` });
      }
      return { ...set, usedBy: await globalPicklistUsedBy(ctx.db, orgId, input.id) };
    }),

  create: permissionProcedure('object.manage')
    .input(
      z.object({
        name: z.string().min(1).max(80),
        description: z.string().max(500).optional(),
        values: ValuesSchema,
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const orgId = ctx.auth.organizationId;
      const existing = await listGlobalPicklists(ctx.db, orgId);
      if (existing.some((s) => s.name === input.name)) {
        throw new TRPCError({
          code: 'CONFLICT',
          message: `picklist set '${input.name}' already exists`,
        });
      }
      const set = await createGlobalPicklist(ctx.db, {
        organizationId: orgId,
        name: input.name,
        description: input.description,
        values: input.values,
      });
      await writeAuditEvent(ctx.db, {
        organizationId: orgId,
        userId: ctx.auth.userId,
        action: 'picklist.created',
        targetType: 'global_picklist',
        targetId: set.id,
        meta: { name: set.name, valueCount: set.values.length },
      });
      return set;
    }),

  /** Value edits propagate implicitly — assigned fields hydrate from the set
   *  at read time, so no per-field writes happen here. */
  update: permissionProcedure('object.manage')
    .input(
      z.object({
        id: z.string().uuid(),
        patch: z.object({
          name: z.string().min(1).max(80).optional(),
          // null clears the description.
          description: z.string().max(500).nullable().optional(),
          values: ValuesSchema.optional(),
        }),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const orgId = ctx.auth.organizationId;
      const existing = await getGlobalPicklist(ctx.db, orgId, input.id);
      if (!existing) {
        throw new TRPCError({ code: 'NOT_FOUND', message: `picklist set '${input.id}' not found` });
      }
      if (input.patch.name !== undefined && input.patch.name !== existing.name) {
        const siblings = await listGlobalPicklists(ctx.db, orgId);
        if (siblings.some((s) => s.id !== existing.id && s.name === input.patch.name)) {
          throw new TRPCError({
            code: 'CONFLICT',
            message: `picklist set '${input.patch.name}' already exists`,
          });
        }
      }
      const updated = await updateGlobalPicklist(ctx.db, orgId, input.id, input.patch);
      if (!updated) throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR' });
      await writeAuditEvent(ctx.db, {
        organizationId: orgId,
        userId: ctx.auth.userId,
        action: 'picklist.updated',
        targetType: 'global_picklist',
        targetId: updated.id,
        meta: { name: updated.name, changed: Object.keys(input.patch) },
      });
      return updated;
    }),

  /** Blocked while any field still draws from the set — unassign first. */
  delete: permissionProcedure('object.manage')
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const orgId = ctx.auth.organizationId;
      const existing = await getGlobalPicklist(ctx.db, orgId, input.id);
      if (!existing) {
        throw new TRPCError({ code: 'NOT_FOUND', message: `picklist set '${input.id}' not found` });
      }
      const usedBy = await globalPicklistUsedBy(ctx.db, orgId, input.id);
      if (usedBy.length > 0) {
        const names = usedBy.slice(0, 3).map((u) => `'${u.objectKey}.${u.fieldKey}'`);
        throw new TRPCError({
          code: 'CONFLICT',
          message: `set is used by ${usedBy.length} field(s) (${names.join(', ')}) — unassign those first`,
        });
      }
      await deleteGlobalPicklist(ctx.db, orgId, input.id);
      await writeAuditEvent(ctx.db, {
        organizationId: orgId,
        userId: ctx.auth.userId,
        action: 'picklist.deleted',
        targetType: 'global_picklist',
        targetId: input.id,
        meta: { name: existing.name },
      });
      return { ok: true as const };
    }),

  usedBy: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .query(({ ctx, input }) => globalPicklistUsedBy(ctx.db, ctx.auth.organizationId, input.id)),
});
