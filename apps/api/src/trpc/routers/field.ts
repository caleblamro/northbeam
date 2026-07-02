// /trpc/field — field-level schema editing on an object: create (metadata +
// DDL), update (label/config/required/indexed — type changes are disallowed
// at v1; delete + recreate is the story), delete (with dependency guards),
// and reorder. All gated by 'object.manage'.

import {
  FIELD_TYPE_IDS,
  type FieldConfig,
  type FieldRow,
  type FieldType,
  KEY_RE,
  type ObjectLayout,
  RESERVED_FIELD_KEYS,
  addField,
  collectFieldKeys,
  dropField,
  ensureFieldIndex,
  fieldColumnName,
  getObjectByKey,
  isFieldTypeAvailable,
  keyFromLabel,
  listLayouts,
  listRollupFields,
  narrowFieldConfig,
  parseFormula,
  pgTypeFor,
  safeValidateFieldConfig,
  schema,
  writeAuditEvent,
} from '@northbeam/db';
import { TRPCError } from '@trpc/server';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import { enqueueCompute } from '../../queue/compute.js';
import type { Context } from '../context.js';
import { permissionProcedure, router } from '../trpc.js';

/** Types a rollup childField may aggregate — mirrors NUMERIC_TYPES in
 *  dynamic/filters-sql.ts (numeric/bigint columns). */
const NUMERIC_FIELD_TYPES: ReadonlySet<FieldType> = new Set<FieldType>([
  'number',
  'currency',
  'percent',
  'autonumber',
  'duration',
]);

async function requireObject(ctx: Context, key: string) {
  if (!ctx.auth) throw new TRPCError({ code: 'UNAUTHORIZED' });
  const result = await getObjectByKey(ctx.db, ctx.auth.organizationId, key);
  if (!result) throw new TRPCError({ code: 'NOT_FOUND', message: `object '${key}' not found` });
  return result;
}

/** Cross-entity checks validateFieldConfig can't do: the reference target /
 *  rollup child / global picklist set / formula field refs must actually
 *  exist. Dotted formula refs are left unchecked — the compute engine
 *  tolerates unresolved cross-object paths. */
async function assertConfigSemantics(
  ctx: Context & { auth: NonNullable<Context['auth']> },
  objectKey: string,
  fields: FieldRow[],
  type: FieldType,
  config: FieldConfig,
): Promise<void> {
  const orgId = ctx.auth.organizationId;
  const bad = (message: string): never => {
    throw new TRPCError({ code: 'BAD_REQUEST', message });
  };
  if (type === 'reference') {
    const target = narrowFieldConfig('reference', config).targetObject;
    if (!target || !(await getObjectByKey(ctx.db, orgId, target))) {
      bad(`reference target '${target}' not found`);
    }
  }
  if (type === 'rollup') {
    const rollup = narrowFieldConfig('rollup', config).rollup;
    if (!rollup) return;
    const child = await getObjectByKey(ctx.db, orgId, rollup.childObject);
    if (!child) bad(`rollup child object '${rollup.childObject}' not found`);
    const via = child?.fields.find((f) => f.key === rollup.via);
    if (
      !via ||
      via.type !== 'reference' ||
      narrowFieldConfig('reference', via.config).targetObject !== objectKey
    ) {
      bad(
        `rollup 'via' must be a reference field on '${rollup.childObject}' pointing at '${objectKey}'`,
      );
    }
    if (rollup.childField) {
      const childField = child?.fields.find((f) => f.key === rollup.childField);
      if (!childField) bad(`rollup childField '${rollup.childField}' not found`);
      else if (!NUMERIC_FIELD_TYPES.has(childField.type)) {
        bad(`rollup childField '${rollup.childField}' must be numeric`);
      }
    }
  }
  if (type === 'picklist' || type === 'multipicklist') {
    const setId = narrowFieldConfig('picklist', config).globalPicklistId;
    if (setId) {
      const [set] = await ctx.db
        .select({ id: schema.globalPicklist.id })
        .from(schema.globalPicklist)
        .where(
          and(eq(schema.globalPicklist.organizationId, orgId), eq(schema.globalPicklist.id, setId)),
        )
        .limit(1);
      if (!set) bad(`global picklist '${setId}' not found`);
    }
  }
  if (type === 'formula') {
    const formula = narrowFieldConfig('formula', config).formula;
    if (!formula) return;
    const known = new Set(fields.map((f) => f.key));
    for (const key of collectFieldKeys(parseFormula(formula))) {
      if (!key.includes('.') && !known.has(key)) {
        bad(`formula references unknown field '${key}'`);
      }
    }
  }
}

function parseConfigOrThrow(type: FieldType, config: unknown): FieldConfig {
  const parsed = safeValidateFieldConfig(type, config);
  if (!parsed.ok) {
    const first = parsed.error.issues[0];
    throw new TRPCError({
      code: 'BAD_REQUEST',
      message: `invalid ${type} config: ${first?.message ?? 'validation failed'}`,
    });
  }
  return parsed.config;
}

function stripKeyFromLayout(layout: ObjectLayout, key: string): ObjectLayout {
  return {
    ...layout,
    sections: layout.sections?.map((s) => ({
      ...s,
      fields: s.fields.filter((k) => k !== key),
    })),
    compactKeys: layout.compactKeys?.filter((k) => k !== key),
    statKeys: layout.statKeys?.filter((k) => k !== key),
    listColumns: layout.listColumns?.filter((k) => k !== key),
  };
}

export const fieldRouter = router({
  /** Create a field: validated metadata row + ALTER TABLE ADD COLUMN. Computed
   *  types (formula/rollup) get a backfill enqueued for existing records. */
  create: permissionProcedure('object.manage')
    .input(
      z.object({
        objectKey: z.string(),
        label: z.string().min(1).max(80),
        key: z
          .string()
          .regex(KEY_RE, 'lowercase letters/digits/underscores, starting with a letter')
          .optional(),
        type: z.enum(FIELD_TYPE_IDS),
        config: z.unknown().optional(),
        required: z.boolean().optional(),
        indexed: z.boolean().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const orgId = ctx.auth.organizationId;
      const { object, fields } = await requireObject(ctx, input.objectKey);
      if (!isFieldTypeAvailable(input.type)) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: `field type '${input.type}' is not yet available`,
        });
      }
      const key = input.key ?? keyFromLabel(input.label);
      if (RESERVED_FIELD_KEYS.has(key)) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: `'${key}' is a reserved field key` });
      }
      if (fields.some((f) => f.key === key)) {
        throw new TRPCError({
          code: 'CONFLICT',
          message: `field '${key}' already exists on '${object.key}'`,
        });
      }
      const config = parseConfigOrThrow(input.type, input.config ?? {});
      await assertConfigSemantics(ctx, object.key, fields, input.type, config);
      const [inserted] = await ctx.db
        .insert(schema.fieldDef)
        .values({
          organizationId: orgId,
          objectId: object.id,
          key,
          columnName: fieldColumnName(key),
          pgType: pgTypeFor(input.type, config),
          label: input.label,
          type: input.type,
          config,
          required: input.required ?? false,
          indexed: input.indexed ?? false,
          isSystem: false,
          source: 'custom',
          orderIndex: fields.reduce((max, f) => Math.max(max, f.orderIndex), -1) + 1,
        })
        .returning();
      if (!inserted) throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR' });
      await addField(ctx.db, orgId, object, inserted);
      if (inserted.type === 'formula' || inserted.type === 'rollup') {
        await enqueueCompute({ orgId, objectKey: object.key, reason: 'field-change' });
      }
      await writeAuditEvent(ctx.db, {
        organizationId: orgId,
        userId: ctx.auth.userId,
        action: 'field.created',
        targetType: 'field',
        targetId: inserted.id,
        meta: { objectKey: object.key, key, type: input.type },
      });
      return inserted;
    }),

  /** Patch label / config / required / indexed. Type changes are disallowed
   *  (no `type` in the schema); key/columnName/pgType are immutable. System
   *  fields allow label/config/indexed only — picklist option editing on the
   *  seeded fields goes through this path. */
  update: permissionProcedure('object.manage')
    .input(
      z.object({
        objectKey: z.string(),
        fieldId: z.string().uuid(),
        patch: z.object({
          label: z.string().min(1).max(80).optional(),
          config: z.unknown().optional(),
          required: z.boolean().optional(),
          indexed: z.boolean().optional(),
        }),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const orgId = ctx.auth.organizationId;
      const { object, fields } = await requireObject(ctx, input.objectKey);
      const existing = fields.find((f) => f.id === input.fieldId);
      if (!existing) {
        throw new TRPCError({ code: 'NOT_FOUND', message: `field '${input.fieldId}' not found` });
      }
      if (
        existing.isSystem &&
        input.patch.required !== undefined &&
        input.patch.required !== existing.required
      ) {
        throw new TRPCError({
          code: 'FORBIDDEN',
          message: 'the required flag on system fields is fixed',
        });
      }
      let config: FieldConfig | undefined;
      if (input.patch.config !== undefined) {
        config = parseConfigOrThrow(existing.type, input.patch.config);
        await assertConfigSemantics(ctx, object.key, fields, existing.type, config);
      }
      const [updated] = await ctx.db
        .update(schema.fieldDef)
        .set({
          ...(input.patch.label !== undefined ? { label: input.patch.label } : {}),
          ...(config !== undefined ? { config } : {}),
          ...(input.patch.required !== undefined ? { required: input.patch.required } : {}),
          ...(input.patch.indexed !== undefined ? { indexed: input.patch.indexed } : {}),
          updatedAt: new Date(),
        })
        .where(
          and(eq(schema.fieldDef.organizationId, orgId), eq(schema.fieldDef.id, input.fieldId)),
        )
        .returning();
      if (!updated) throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR' });
      // indexed false→true creates the index; true→false leaves it in place
      // (cheap to keep, avoids DDL churn).
      if (!existing.indexed && updated.indexed) {
        await ensureFieldIndex(ctx.db, orgId, object, updated);
      }
      if (config !== undefined && (existing.type === 'formula' || existing.type === 'rollup')) {
        await enqueueCompute({ orgId, objectKey: object.key, reason: 'field-change' });
      }
      await writeAuditEvent(ctx.db, {
        organizationId: orgId,
        userId: ctx.auth.userId,
        action: 'field.updated',
        targetType: 'field',
        targetId: input.fieldId,
        meta: { objectKey: object.key, key: existing.key, changed: Object.keys(input.patch) },
      });
      return updated;
    }),

  /** Drop a field: guarded against system fields, the name expression, and
   *  anything another field depends on (formula refs, rollup via/childField,
   *  picklist controllingField). Strips the key from stored layouts. */
  delete: permissionProcedure('object.manage')
    .input(z.object({ objectKey: z.string(), fieldId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const orgId = ctx.auth.organizationId;
      const { object, fields } = await requireObject(ctx, input.objectKey);
      const field = fields.find((f) => f.id === input.fieldId);
      if (!field) {
        throw new TRPCError({ code: 'NOT_FOUND', message: `field '${input.fieldId}' not found` });
      }
      if (field.isSystem) {
        throw new TRPCError({ code: 'FORBIDDEN', message: 'system fields cannot be deleted' });
      }
      const nameParts = (object.nameExpression ?? '').split('|').map((p) => p.trim());
      if (nameParts.includes(field.key)) {
        throw new TRPCError({
          code: 'CONFLICT',
          message: `'${field.key}' is part of the object's name expression`,
        });
      }
      for (const other of fields) {
        if (other.id === field.id) continue;
        if (other.type === 'formula') {
          const formula = narrowFieldConfig('formula', other.config).formula;
          if (formula) {
            const refs = collectFieldKeys(parseFormula(formula));
            if ([...refs].some((k) => k === field.key || k.split('.')[0] === field.key)) {
              throw new TRPCError({
                code: 'CONFLICT',
                message: `'${field.key}' is referenced by formula field '${other.key}'`,
              });
            }
          }
        }
        if (
          (other.type === 'picklist' || other.type === 'multipicklist') &&
          narrowFieldConfig('picklist', other.config).controllingField === field.key
        ) {
          throw new TRPCError({
            code: 'CONFLICT',
            message: `'${field.key}' is the controlling field of '${other.key}'`,
          });
        }
      }
      const rollups = await listRollupFields(ctx.db, orgId);
      for (const other of rollups) {
        if (other.id === field.id) continue;
        const rollup = narrowFieldConfig('rollup', other.config).rollup;
        if (
          rollup?.childObject === object.key &&
          (rollup.via === field.key || rollup.childField === field.key)
        ) {
          throw new TRPCError({
            code: 'CONFLICT',
            message: `'${field.key}' is used by rollup field '${other.key}'`,
          });
        }
      }
      await dropField(ctx.db, orgId, object, field.columnName);
      await ctx.db
        .delete(schema.fieldDef)
        .where(
          and(eq(schema.fieldDef.organizationId, orgId), eq(schema.fieldDef.id, input.fieldId)),
        );
      await ctx.db
        .update(schema.objectDef)
        .set({ layout: stripKeyFromLayout(object.layout, field.key), updatedAt: new Date() })
        .where(and(eq(schema.objectDef.organizationId, orgId), eq(schema.objectDef.id, object.id)));
      for (const layoutRow of await listLayouts(ctx.db, orgId, object.id)) {
        await ctx.db
          .update(schema.layoutDef)
          .set({ layout: stripKeyFromLayout(layoutRow.layout, field.key), updatedAt: new Date() })
          .where(eq(schema.layoutDef.id, layoutRow.id));
      }
      await writeAuditEvent(ctx.db, {
        organizationId: orgId,
        userId: ctx.auth.userId,
        action: 'field.deleted',
        targetType: 'field',
        targetId: input.fieldId,
        meta: { objectKey: object.key, key: field.key, type: field.type },
      });
      return { ok: true as const };
    }),

  /** Persist a new display order. `orderedKeys` must cover every field on the
   *  object exactly once. */
  reorder: permissionProcedure('object.manage')
    .input(z.object({ objectKey: z.string(), orderedKeys: z.array(z.string()).min(1) }))
    .mutation(async ({ ctx, input }) => {
      const orgId = ctx.auth.organizationId;
      const { object, fields } = await requireObject(ctx, input.objectKey);
      const byKey = new Map(fields.map((f) => [f.key, f]));
      if (
        input.orderedKeys.length !== fields.length ||
        new Set(input.orderedKeys).size !== fields.length ||
        input.orderedKeys.some((k) => !byKey.has(k))
      ) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'orderedKeys must include every field on the object exactly once',
        });
      }
      for (const [index, key] of input.orderedKeys.entries()) {
        const field = byKey.get(key);
        if (!field || field.orderIndex === index) continue;
        await ctx.db
          .update(schema.fieldDef)
          .set({ orderIndex: index, updatedAt: new Date() })
          .where(and(eq(schema.fieldDef.organizationId, orgId), eq(schema.fieldDef.id, field.id)));
      }
      await writeAuditEvent(ctx.db, {
        organizationId: orgId,
        userId: ctx.auth.userId,
        action: 'field.reordered',
        targetType: 'object',
        targetId: object.id,
        meta: { objectKey: object.key, count: input.orderedKeys.length },
      });
      return { ok: true as const };
    }),
});
