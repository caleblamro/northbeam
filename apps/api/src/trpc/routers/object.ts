// /trpc/object — the metadata layer (object defs + their fields). Powers the
// dynamic table/form renderers and the object-manager UI. Schema editing
// (create/update/archive/delete/format rules) is gated by 'object.manage'.

import {
  type FormatRule,
  KEY_RE,
  createObjectTable,
  dropObjectTable,
  fieldColumnName,
  getObjectById,
  getObjectByKey,
  hydratePicklistOptions,
  keyFromLabel,
  listObjects,
  narrowFieldConfig,
  objectTableName,
  schema,
  writeAuditEvent,
} from '@northbeam/db';
import { TRPCError } from '@trpc/server';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import { FilterSchema } from '../schemas.js';
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

const FormatRuleSchema = z.object({
  id: z.string().min(1).max(40),
  label: z.string().min(1).max(80),
  tone: z.enum(['red', 'amber', 'green', 'blue', 'purple', 'gray']),
  filters: z.array(FilterSchema),
  active: z.boolean(),
}) satisfies z.ZodType<FormatRule>;

/** Every pipe-separated part of a nameExpression must be a real field key. */
function assertNameExpression(expr: string, fieldKeys: Set<string>): void {
  for (const part of expr.split('|').map((p) => p.trim())) {
    if (!fieldKeys.has(part)) {
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: `nameExpression references unknown field '${part}'`,
      });
    }
  }
}

export const objectRouter = router({
  /** All objects in the workspace (standard + custom + SF-imported). Archived
   *  objects are hidden unless explicitly requested (the object manager). */
  list: protectedProcedure
    .input(z.object({ includeArchived: z.boolean().optional() }).optional())
    .query(({ ctx, input }) =>
      listObjects(ctx.db, ctx.auth.organizationId, {
        includeArchived: input?.includeArchived,
      }),
    ),

  /** One object by key, with its ordered fields. Picklist fields bound to a
   *  global set come back with options hydrated (reference-at-read). */
  get: protectedProcedure.input(z.object({ key: z.string() })).query(async ({ ctx, input }) => {
    const result = await getObjectByKey(ctx.db, ctx.auth.organizationId, input.key);
    if (!result) {
      throw new TRPCError({ code: 'NOT_FOUND', message: `object '${input.key}' not found` });
    }
    return {
      ...result,
      fields: await hydratePicklistOptions(ctx.db, ctx.auth.organizationId, result.fields),
    };
  }),

  /** Create a custom object: metadata row + scaffolded `name` field + the
   *  physical table + a seeded org-shared "All" view, all in the procedure's
   *  transaction. */
  create: permissionProcedure('object.manage')
    .input(
      z.object({
        label: z.string().min(1).max(80),
        labelPlural: z.string().min(1).max(80),
        key: z
          .string()
          .regex(KEY_RE, 'lowercase letters/digits/underscores, starting with a letter')
          .optional(),
        icon: z.string().min(1).max(40).optional(),
        color: z.string().min(1).max(20).optional(),
        description: z.string().max(500).optional(),
        defaultVisibility: z.enum(['public', 'private']).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const orgId = ctx.auth.organizationId;
      const key = input.key ?? keyFromLabel(input.label);
      if (await getObjectByKey(ctx.db, orgId, key)) {
        throw new TRPCError({ code: 'CONFLICT', message: `object '${key}' already exists` });
      }
      const [inserted] = await ctx.db
        .insert(schema.objectDef)
        .values({
          organizationId: orgId,
          key,
          tableName: objectTableName(key),
          label: input.label,
          labelPlural: input.labelPlural,
          icon: input.icon,
          color: input.color,
          description: input.description,
          nameExpression: 'name',
          defaultVisibility: input.defaultVisibility ?? 'public',
          layout: {
            sections: [{ id: 'details', label: 'Details', cols: 2, fields: ['name'] }],
            listColumns: [],
          },
          isSystem: false,
          source: 'custom',
        })
        .returning();
      if (!inserted) throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR' });
      await ctx.db.insert(schema.fieldDef).values({
        organizationId: orgId,
        objectId: inserted.id,
        key: 'name',
        columnName: fieldColumnName('name'),
        pgType: 'text',
        label: `${input.label} name`,
        type: 'text',
        config: {},
        required: true,
        isSystem: false,
        source: 'custom',
        orderIndex: 0,
      });
      const created = await getObjectByKey(ctx.db, orgId, key);
      if (!created) throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR' });
      await createObjectTable(ctx.db, orgId, created.object, created.fields);
      await ctx.db.insert(schema.view).values({
        organizationId: orgId,
        objectId: inserted.id,
        key: 'all',
        label: `All ${input.labelPlural}`,
        type: 'list',
        icon: 'list',
        sharedWith: [{ kind: 'org' }],
        ownerId: null,
        isDefault: true,
      });
      await writeAuditEvent(ctx.db, {
        organizationId: orgId,
        userId: ctx.auth.userId,
        action: 'object.created',
        targetType: 'object',
        targetId: inserted.id,
        meta: { objectKey: key, label: input.label },
      });
      return created;
    }),

  /** Label-level patches. `key` / `tableName` are immutable — the physical
   *  identifiers derive from the key, so renaming is a metadata-only affair. */
  update: permissionProcedure('object.manage')
    .input(
      z.object({
        objectId: z.string().uuid(),
        patch: z.object({
          label: z.string().min(1).max(80).optional(),
          labelPlural: z.string().min(1).max(80).optional(),
          icon: z.string().min(1).max(40).optional(),
          color: z.string().min(1).max(20).optional(),
          description: z.string().max(500).nullable().optional(),
          nameExpression: z.string().min(1).max(200).optional(),
          defaultVisibility: z.enum(['public', 'private']).optional(),
        }),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const existing = await getObjectById(ctx.db, ctx.auth.organizationId, input.objectId);
      if (!existing) {
        throw new TRPCError({ code: 'NOT_FOUND', message: `object '${input.objectId}' not found` });
      }
      if (input.patch.nameExpression) {
        assertNameExpression(
          input.patch.nameExpression,
          new Set(existing.fields.map((f) => f.key)),
        );
      }
      const [updated] = await ctx.db
        .update(schema.objectDef)
        .set({ ...input.patch, updatedAt: new Date() })
        .where(
          and(
            eq(schema.objectDef.organizationId, ctx.auth.organizationId),
            eq(schema.objectDef.id, input.objectId),
          ),
        )
        .returning();
      await writeAuditEvent(ctx.db, {
        organizationId: ctx.auth.organizationId,
        userId: ctx.auth.userId,
        action: 'object.updated',
        targetType: 'object',
        targetId: input.objectId,
        meta: { objectKey: existing.object.key, changed: Object.keys(input.patch) },
      });
      return updated;
    }),

  /** Soft-archive: hidden from pickers, record writes blocked, reads stay
   *  live. System objects can't be archived. */
  archive: permissionProcedure('object.manage')
    .input(z.object({ objectId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const existing = await getObjectById(ctx.db, ctx.auth.organizationId, input.objectId);
      if (!existing) {
        throw new TRPCError({ code: 'NOT_FOUND', message: `object '${input.objectId}' not found` });
      }
      if (existing.object.isSystem) {
        throw new TRPCError({ code: 'FORBIDDEN', message: 'system objects cannot be archived' });
      }
      const [updated] = await ctx.db
        .update(schema.objectDef)
        .set({ archivedAt: new Date(), updatedAt: new Date() })
        .where(
          and(
            eq(schema.objectDef.organizationId, ctx.auth.organizationId),
            eq(schema.objectDef.id, input.objectId),
          ),
        )
        .returning();
      await writeAuditEvent(ctx.db, {
        organizationId: ctx.auth.organizationId,
        userId: ctx.auth.userId,
        action: 'object.archived',
        targetType: 'object',
        targetId: input.objectId,
        meta: { objectKey: existing.object.key },
      });
      return updated;
    }),

  unarchive: permissionProcedure('object.manage')
    .input(z.object({ objectId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const existing = await getObjectById(ctx.db, ctx.auth.organizationId, input.objectId);
      if (!existing) {
        throw new TRPCError({ code: 'NOT_FOUND', message: `object '${input.objectId}' not found` });
      }
      const [updated] = await ctx.db
        .update(schema.objectDef)
        .set({ archivedAt: null, updatedAt: new Date() })
        .where(
          and(
            eq(schema.objectDef.organizationId, ctx.auth.organizationId),
            eq(schema.objectDef.id, input.objectId),
          ),
        )
        .returning();
      await writeAuditEvent(ctx.db, {
        organizationId: ctx.auth.organizationId,
        userId: ctx.auth.userId,
        action: 'object.unarchived',
        targetType: 'object',
        targetId: input.objectId,
        meta: { objectKey: existing.object.key },
      });
      return updated;
    }),

  /** Hard delete — custom objects only, and only when no other object has a
   *  reference field pointing at it. Drops the physical table; fieldDef /
   *  recordType / layoutDef / view rows cascade via FKs. */
  delete: permissionProcedure('object.manage')
    .input(z.object({ objectId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const orgId = ctx.auth.organizationId;
      const existing = await getObjectById(ctx.db, orgId, input.objectId);
      if (!existing) {
        throw new TRPCError({ code: 'NOT_FOUND', message: `object '${input.objectId}' not found` });
      }
      if (existing.object.isSystem || existing.object.source !== 'custom') {
        throw new TRPCError({ code: 'FORBIDDEN', message: 'only custom objects can be deleted' });
      }
      const refFields = await ctx.db
        .select()
        .from(schema.fieldDef)
        .where(
          and(eq(schema.fieldDef.organizationId, orgId), eq(schema.fieldDef.type, 'reference')),
        );
      const inbound = refFields.filter(
        (f) =>
          f.objectId !== existing.object.id &&
          narrowFieldConfig('reference', f.config).targetObject === existing.object.key,
      );
      if (inbound.length > 0) {
        const names = inbound.slice(0, 3).map((f) => `'${f.key}'`);
        throw new TRPCError({
          code: 'CONFLICT',
          message: `object is referenced by ${inbound.length} field(s) (${names.join(', ')}) — remove those first`,
        });
      }
      await dropObjectTable(ctx.db, orgId, existing.object);
      await ctx.db
        .delete(schema.objectDef)
        .where(
          and(eq(schema.objectDef.organizationId, orgId), eq(schema.objectDef.id, input.objectId)),
        );
      await writeAuditEvent(ctx.db, {
        organizationId: orgId,
        userId: ctx.auth.userId,
        action: 'object.deleted',
        targetType: 'object',
        targetId: input.objectId,
        meta: { objectKey: existing.object.key },
      });
      return { ok: true as const };
    }),

  /** Replace the object's conditional-formatting rules. Conditions are plain
   *  Filter rows (AND-ed), evaluated client-side — see views.ts FormatRule. */
  updateFormatRules: permissionProcedure('object.manage')
    .input(
      z.object({
        objectId: z.string().uuid(),
        formatRules: z.array(FormatRuleSchema).max(20),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const existing = await getObjectById(ctx.db, ctx.auth.organizationId, input.objectId);
      if (!existing) {
        throw new TRPCError({ code: 'NOT_FOUND', message: `object '${input.objectId}' not found` });
      }
      const fieldKeys = new Set(existing.fields.map((f) => f.key));
      for (const rule of input.formatRules) {
        for (const filter of rule.filters) {
          if (!fieldKeys.has(filter.fieldKey)) {
            throw new TRPCError({
              code: 'BAD_REQUEST',
              message: `format rule '${rule.label}' references unknown field '${filter.fieldKey}'`,
            });
          }
        }
      }
      const [updated] = await ctx.db
        .update(schema.objectDef)
        .set({ formatRules: input.formatRules, updatedAt: new Date() })
        .where(
          and(
            eq(schema.objectDef.organizationId, ctx.auth.organizationId),
            eq(schema.objectDef.id, input.objectId),
          ),
        )
        .returning();
      await writeAuditEvent(ctx.db, {
        organizationId: ctx.auth.organizationId,
        userId: ctx.auth.userId,
        action: 'object.format_rules.updated',
        targetType: 'object',
        targetId: input.objectId,
        meta: { objectKey: existing.object.key, ruleCount: input.formatRules.length },
      });
      return updated;
    }),

  /** Persist the form-layout customizer's output back onto the object def.
   *  Validates the layout shape but does NOT enforce that every section
   *  field key still exists — the customizer is responsible for filtering
   *  stale references. Gated by 'object.manage' — editing an object's layout
   *  is part of editing the data model, same as its fields/rules. */
  updateLayout: permissionProcedure('object.manage')
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
