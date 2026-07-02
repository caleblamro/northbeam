// /trpc/validation — validation-rule CRUD per object, plus a `test` probe
// that evaluates a condition against a sample record for the editor's live
// validity check. Rules are Northbeam formulas that BLOCK a save when truthy
// (Salesforce semantics); enforcement lives in the record router's write path.

import {
  type FieldRow,
  collectFieldKeys,
  createValidationRule,
  deleteValidationRule,
  displayName,
  evaluateFormula,
  getObjectById,
  getObjectByKey,
  getRecord,
  getValidationRule,
  listRecords,
  listValidationRules,
  parseFormula,
  updateValidationRule,
  validateFormula,
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

/** The condition must parse, and its same-record refs must exist on the
 *  object. Dotted (cross-object) refs are left unchecked — the evaluator
 *  resolves unknown keys to null, matching the compute engine's tolerance. */
function assertCondition(fields: FieldRow[], condition: string): void {
  const valid = validateFormula(condition);
  if (!valid.ok) {
    throw new TRPCError({ code: 'BAD_REQUEST', message: `invalid condition: ${valid.message}` });
  }
  const known = new Set(fields.map((f) => f.key));
  for (const key of collectFieldKeys(parseFormula(condition))) {
    if (!key.includes('.') && !known.has(key)) {
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: `condition references unknown field '${key}'`,
      });
    }
  }
}

function assertErrorFieldKey(fields: FieldRow[], errorFieldKey: string): void {
  if (!fields.some((f) => f.key === errorFieldKey)) {
    throw new TRPCError({
      code: 'BAD_REQUEST',
      message: `errorFieldKey '${errorFieldKey}' is not a field on this object`,
    });
  }
}

export const validationRouter = router({
  list: protectedProcedure
    .input(z.object({ objectKey: z.string() }))
    .query(async ({ ctx, input }) => {
      const { object } = await requireObject(ctx, input.objectKey);
      return listValidationRules(ctx.db, ctx.auth.organizationId, object.id);
    }),

  create: permissionProcedure('object.manage')
    .input(
      z.object({
        objectKey: z.string(),
        name: z.string().min(1).max(80),
        condition: z.string().min(1).max(2000),
        errorMessage: z.string().min(1).max(300),
        errorFieldKey: z.string().optional(),
        active: z.boolean().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const orgId = ctx.auth.organizationId;
      const { object, fields } = await requireObject(ctx, input.objectKey);
      assertCondition(fields, input.condition);
      if (input.errorFieldKey) assertErrorFieldKey(fields, input.errorFieldKey);
      const existing = await listValidationRules(ctx.db, orgId, object.id);
      if (existing.some((r) => r.name === input.name)) {
        throw new TRPCError({
          code: 'CONFLICT',
          message: `validation rule '${input.name}' already exists on '${object.key}'`,
        });
      }
      const rule = await createValidationRule(ctx.db, {
        organizationId: orgId,
        objectId: object.id,
        name: input.name,
        condition: input.condition,
        errorMessage: input.errorMessage,
        errorFieldKey: input.errorFieldKey ?? null,
        active: input.active ?? true,
      });
      await writeAuditEvent(ctx.db, {
        organizationId: orgId,
        userId: ctx.auth.userId,
        action: 'validation.created',
        targetType: 'validation_rule',
        targetId: rule.id,
        meta: { objectKey: object.key, name: rule.name },
      });
      return rule;
    }),

  update: permissionProcedure('object.manage')
    .input(
      z.object({
        id: z.string().uuid(),
        patch: z.object({
          name: z.string().min(1).max(80).optional(),
          condition: z.string().min(1).max(2000).optional(),
          errorMessage: z.string().min(1).max(300).optional(),
          // null clears the anchor → record-level error.
          errorFieldKey: z.string().nullable().optional(),
          active: z.boolean().optional(),
        }),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const orgId = ctx.auth.organizationId;
      const existing = await getValidationRule(ctx.db, orgId, input.id);
      if (!existing) {
        throw new TRPCError({ code: 'NOT_FOUND', message: `rule '${input.id}' not found` });
      }
      const result = await getObjectById(ctx.db, orgId, existing.objectId);
      if (!result) throw new TRPCError({ code: 'NOT_FOUND' });
      const { object, fields } = result;
      if (input.patch.condition !== undefined) assertCondition(fields, input.patch.condition);
      if (input.patch.errorFieldKey) assertErrorFieldKey(fields, input.patch.errorFieldKey);
      if (input.patch.name !== undefined && input.patch.name !== existing.name) {
        const siblings = await listValidationRules(ctx.db, orgId, object.id);
        if (siblings.some((r) => r.id !== existing.id && r.name === input.patch.name)) {
          throw new TRPCError({
            code: 'CONFLICT',
            message: `validation rule '${input.patch.name}' already exists on '${object.key}'`,
          });
        }
      }
      const updated = await updateValidationRule(ctx.db, orgId, input.id, input.patch);
      if (!updated) throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR' });
      await writeAuditEvent(ctx.db, {
        organizationId: orgId,
        userId: ctx.auth.userId,
        action: 'validation.updated',
        targetType: 'validation_rule',
        targetId: updated.id,
        meta: { objectKey: object.key, name: updated.name, changed: Object.keys(input.patch) },
      });
      return updated;
    }),

  delete: permissionProcedure('object.manage')
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const orgId = ctx.auth.organizationId;
      const existing = await getValidationRule(ctx.db, orgId, input.id);
      if (!existing) {
        throw new TRPCError({ code: 'NOT_FOUND', message: `rule '${input.id}' not found` });
      }
      await deleteValidationRule(ctx.db, orgId, input.id);
      await writeAuditEvent(ctx.db, {
        organizationId: orgId,
        userId: ctx.auth.userId,
        action: 'validation.deleted',
        targetType: 'validation_rule',
        targetId: input.id,
        meta: { name: existing.name },
      });
      return { ok: true as const };
    }),

  /** Dry-run a condition against one record (by id, or the newest) so the
   *  editor can show "would trigger on <record>" while the admin types. */
  test: permissionProcedure('object.manage')
    .input(
      z.object({
        objectKey: z.string(),
        condition: z.string().min(1).max(2000),
        recordId: z.string().uuid().optional(),
      }),
    )
    .query(async ({ ctx, input }) => {
      const { object, fields } = await requireObject(ctx, input.objectKey);
      const valid = validateFormula(input.condition);
      if (!valid.ok) {
        return { ok: false as const, message: valid.message, sample: null };
      }
      const row = input.recordId
        ? await getRecord(ctx.db, {
            orgId: ctx.auth.organizationId,
            object,
            fields,
            id: input.recordId,
          })
        : ((
            await listRecords(ctx.db, {
              orgId: ctx.auth.organizationId,
              object,
              fields,
              limit: 1,
            })
          )[0] ?? null);
      if (!row) return { ok: true as const, sample: null };
      try {
        const result = evaluateFormula(input.condition, row.data, { now: new Date() });
        return {
          ok: true as const,
          sample: {
            id: row.id,
            name: displayName(fields, row.data, object.nameExpression),
            triggered: Boolean(result),
          },
        };
      } catch (err) {
        return {
          ok: false as const,
          message: err instanceof Error ? err.message : 'evaluation failed',
          sample: null,
        };
      }
    }),
});
