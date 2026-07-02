// /trpc/recordType — record-type CRUD per object (SF RecordType). Every
// record row carries a record_type_id system column (soft reference) that
// layout resolution keys off; deleting a type reassigns its records to the
// object's default type (or clears them) before the row goes away.

import {
  KEY_RE,
  clearDefaultRecordType,
  countByRecordType,
  createRecordType,
  deleteRecordType,
  getObjectById,
  getObjectByKey,
  getRecordType,
  keyFromLabel,
  listRecordTypes,
  reassignRecordType,
  updateRecordType,
  writeAuditEvent,
} from '@northbeam/db';
import { TRPCError } from '@trpc/server';
import { z } from 'zod';
import type { Context } from '../context.js';
import { permissionProcedure, protectedProcedure, router } from '../trpc.js';

async function requireObject(ctx: Context, key: string) {
  if (!ctx.auth) throw new TRPCError({ code: 'UNAUTHORIZED' });
  const result = await getObjectByKey(ctx.db, ctx.auth.organizationId, key);
  if (!result) throw new TRPCError({ code: 'NOT_FOUND', message: `object '${key}' not found` });
  return result;
}

export const recordTypeRouter = router({
  /** Types on an object, each with a live record count. */
  list: protectedProcedure
    .input(z.object({ objectKey: z.string() }))
    .query(async ({ ctx, input }) => {
      const orgId = ctx.auth.organizationId;
      const { object } = await requireObject(ctx, input.objectKey);
      const types = await listRecordTypes(ctx.db, orgId, object.id);
      const out = [];
      for (const rt of types) {
        out.push({
          ...rt,
          count: await countByRecordType(ctx.db, { orgId, object, recordTypeId: rt.id }),
        });
      }
      return out;
    }),

  create: permissionProcedure('object.manage')
    .input(
      z.object({
        objectKey: z.string(),
        label: z.string().min(1).max(80),
        key: z
          .string()
          .regex(KEY_RE, 'lowercase letters/digits/underscores, starting with a letter')
          .optional(),
        isDefault: z.boolean().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const orgId = ctx.auth.organizationId;
      const { object } = await requireObject(ctx, input.objectKey);
      const key = input.key ?? keyFromLabel(input.label);
      const siblings = await listRecordTypes(ctx.db, orgId, object.id);
      if (siblings.some((rt) => rt.key === key)) {
        throw new TRPCError({
          code: 'CONFLICT',
          message: `record type '${key}' already exists on '${object.key}'`,
        });
      }
      if (input.isDefault) await clearDefaultRecordType(ctx.db, orgId, object.id);
      const created = await createRecordType(ctx.db, {
        organizationId: orgId,
        objectId: object.id,
        key,
        label: input.label,
        isDefault: input.isDefault ?? false,
      });
      await writeAuditEvent(ctx.db, {
        organizationId: orgId,
        userId: ctx.auth.userId,
        action: 'recordtype.created',
        targetType: 'record_type',
        targetId: created.id,
        meta: { objectKey: object.key, key, isDefault: created.isDefault },
      });
      return created;
    }),

  /** Patch label / active / isDefault. Key is immutable. Promoting a type to
   *  default clears the previous default first (same clear-then-set pattern
   *  as view.setDefault). */
  update: permissionProcedure('object.manage')
    .input(
      z.object({
        id: z.string().uuid(),
        patch: z.object({
          label: z.string().min(1).max(80).optional(),
          active: z.boolean().optional(),
          isDefault: z.boolean().optional(),
        }),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const orgId = ctx.auth.organizationId;
      const existing = await getRecordType(ctx.db, orgId, input.id);
      if (!existing) {
        throw new TRPCError({ code: 'NOT_FOUND', message: `record type '${input.id}' not found` });
      }
      const result = await getObjectById(ctx.db, orgId, existing.objectId);
      if (!result) throw new TRPCError({ code: 'NOT_FOUND' });
      if (Object.keys(input.patch).length === 0) return existing;
      if (input.patch.isDefault === true) {
        await clearDefaultRecordType(ctx.db, orgId, existing.objectId);
      }
      const updated = await updateRecordType(ctx.db, orgId, input.id, input.patch);
      if (!updated) throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR' });
      await writeAuditEvent(ctx.db, {
        organizationId: orgId,
        userId: ctx.auth.userId,
        action: 'recordtype.updated',
        targetType: 'record_type',
        targetId: updated.id,
        meta: {
          objectKey: result.object.key,
          key: existing.key,
          changed: Object.keys(input.patch),
        },
      });
      return updated;
    }),

  /** Delete a type: its records move to the object's default type (or lose
   *  their type when the default itself is deleted). Per-type layout overrides
   *  cascade away with the row (layout_def.record_type_id FK). */
  delete: permissionProcedure('object.manage')
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const orgId = ctx.auth.organizationId;
      const existing = await getRecordType(ctx.db, orgId, input.id);
      if (!existing) {
        throw new TRPCError({ code: 'NOT_FOUND', message: `record type '${input.id}' not found` });
      }
      const result = await getObjectById(ctx.db, orgId, existing.objectId);
      if (!result) throw new TRPCError({ code: 'NOT_FOUND' });
      const siblings = await listRecordTypes(ctx.db, orgId, existing.objectId);
      const fallback = siblings.find((rt) => rt.id !== existing.id && rt.isDefault) ?? null;
      const reassigned = await reassignRecordType(ctx.db, {
        orgId,
        object: result.object,
        fromId: existing.id,
        toId: fallback?.id ?? null,
      });
      await deleteRecordType(ctx.db, orgId, input.id);
      await writeAuditEvent(ctx.db, {
        organizationId: orgId,
        userId: ctx.auth.userId,
        action: 'recordtype.deleted',
        targetType: 'record_type',
        targetId: input.id,
        meta: {
          objectKey: result.object.key,
          key: existing.key,
          reassignedTo: fallback?.key ?? null,
          reassignedCount: reassigned,
          layoutOverridesDropped: true,
        },
      });
      return { ok: true as const };
    }),
});
