// /trpc/view — read + manage saved views. Visibility filtering lives in the
// query helper (listViewsForUser) so the same access rules apply here, in
// background jobs, and in any future server actions.

import {
  type Filter,
  GROUPABLE_TYPES,
  NUMERIC_TYPES,
  type ReportConfig,
  type ShareTarget,
  type ViewSort,
  type ViewType,
  getDefaultView,
  getObjectById,
  getView,
  listViewsForUser,
  schema,
  writeAuditEvent,
} from '@northbeam/db';
import { TRPCError } from '@trpc/server';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import type { Context } from '../context.js';
import { FilterSchema } from '../schemas.js';
import { permissionProcedure, protectedProcedure, router } from '../trpc.js';

/* ── Zod shapes shared between mutations ────────────────────────────────── */

const ShareTargetSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('org') }),
  z.object({ kind: z.literal('role'), role: z.enum(['owner', 'admin', 'member', 'viewer']) }),
  z.object({ kind: z.literal('user'), userId: z.string().min(1) }),
]) satisfies z.ZodType<ShareTarget>;

const ViewTypeSchema = z.enum(['list', 'dashboard', 'report']) satisfies z.ZodType<ViewType>;

const ViewIconSchema = z.enum([
  'list',
  'pin',
  'star',
  'bookmark',
  'inbox',
  'folder',
  'briefcase',
  'flag',
  'eye',
  'heart',
  'building',
  'users',
  'dollar',
  'chart',
  'calendar',
  'clock',
]);

// Filter (imported from ../schemas.js) / Sort use the same FilterOp /
// direction enums the web layer does, so the inferred Zod type lines up with
// the storage column type exactly. Renderer-specific config validation lives
// on the web side — with one exception: `report` configs execute server-side
// (record.aggregate), so the server validates them (see assertReportConfig).
const SortSchema: z.ZodType<ViewSort> = z.object({
  fieldKey: z.string().min(1),
  direction: z.enum(['asc', 'desc']),
});

const KEY_RE = /^[a-z0-9](?:[a-z0-9-_]{0,46}[a-z0-9])?$/;

const ReportConfigSchema = z
  .object({
    groupBy: z.string().min(1).nullable(),
    measure: z.object({
      agg: z.enum(['count', 'sum', 'avg']),
      fieldKey: z.string().min(1).optional(),
    }),
    chartType: z.enum(['bar', 'donut', 'line', 'kpi', 'table']),
  })
  .superRefine((cfg, ctx) => {
    if (cfg.measure.agg !== 'count' && !cfg.measure.fieldKey) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `measure agg '${cfg.measure.agg}' requires a fieldKey`,
        path: ['measure', 'fieldKey'],
      });
    }
  }) satisfies z.ZodType<ReportConfig>;

// The shared field shapes, sans defaults. CreateInput layers defaults on top;
// UpdateInput stays default-free so a partial patch can't silently reset the
// unspecified slots back to empty (zod applies .default() even through
// .partial(), which would wipe a report's config on a label-only patch).
const ViewFields = z.object({
  objectId: z.string().uuid(),
  key: z.string().regex(KEY_RE, 'lowercase letters, digits, dashes / underscores'),
  label: z.string().min(1).max(80),
  type: ViewTypeSchema,
  icon: ViewIconSchema,
  config: z.unknown(),
  filters: z.array(FilterSchema),
  sort: z.array(SortSchema),
  columns: z.array(z.string()),
  sharedWith: z.array(ShareTargetSchema),
});

const CreateInput = ViewFields.extend({
  icon: ViewIconSchema.default('list'),
  config: z.unknown().default({}),
  filters: z.array(FilterSchema).default([]),
  sort: z.array(SortSchema).default([]),
  columns: z.array(z.string()).default([]),
  sharedWith: z.array(ShareTargetSchema).default([]),
});

const UpdateInput = ViewFields.partial().extend({
  id: z.string().uuid(),
});

/** `report` view configs are executed server-side by record.aggregate, so the
 *  server must trust what it stores: parse the ReportConfig shape and check
 *  every referenced field key (group-by groupable, measure numeric, filters
 *  known) against the object's live field list. */
async function assertReportConfig(
  ctx: Context,
  objectId: string,
  config: unknown,
  filters: Filter[],
): Promise<void> {
  if (!ctx.auth) throw new TRPCError({ code: 'UNAUTHORIZED' });
  const parsed = ReportConfigSchema.safeParse(config ?? {});
  if (!parsed.success) {
    throw new TRPCError({
      code: 'BAD_REQUEST',
      message: `invalid report config: ${parsed.error.issues[0]?.message ?? 'malformed'}`,
    });
  }
  const result = await getObjectById(ctx.db, ctx.auth.organizationId, objectId);
  if (!result) {
    throw new TRPCError({ code: 'NOT_FOUND', message: `object '${objectId}' not found` });
  }
  const byKey = new Map(result.fields.map((f) => [f.key, f]));
  const cfg = parsed.data;
  if (cfg.groupBy) {
    const f = byKey.get(cfg.groupBy);
    if (!f || !GROUPABLE_TYPES.has(f.type)) {
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: `'${cfg.groupBy}' is not a groupable field on '${result.object.key}'`,
      });
    }
  }
  if (cfg.measure.agg !== 'count') {
    const f = cfg.measure.fieldKey ? byKey.get(cfg.measure.fieldKey) : undefined;
    if (!f || !NUMERIC_TYPES.has(f.type)) {
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: `measure field '${cfg.measure.fieldKey ?? ''}' must be a numeric field on '${result.object.key}'`,
      });
    }
  }
  for (const flt of filters) {
    if (!byKey.has(flt.fieldKey)) {
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: `filter field '${flt.fieldKey}' does not exist on '${result.object.key}'`,
      });
    }
  }
}

export const viewRouter = router({
  /** All views the caller can see, optionally narrowed to one object. */
  list: protectedProcedure
    .input(z.object({ objectId: z.string().uuid().optional() }).optional())
    .query(({ ctx, input }) =>
      listViewsForUser(
        ctx.db,
        ctx.auth.organizationId,
        ctx.auth.userId,
        ctx.auth.role,
        input?.objectId,
      ),
    ),

  /** One view by id, scoped to the active org. NOT_FOUND on miss. */
  get: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const row = await getView(ctx.db, ctx.auth.organizationId, input.id);
      if (!row) {
        throw new TRPCError({ code: 'NOT_FOUND', message: `view '${input.id}' not found` });
      }
      return row;
    }),

  /** The default view for an object — what the dispatcher lands on when no
   *  `?view=…` is in the URL. Returns null if the org has no views for the
   *  object (a fresh org always has the seeded default, so null is rare). */
  default: protectedProcedure
    .input(z.object({ objectId: z.string().uuid() }))
    .query(({ ctx, input }) => getDefaultView(ctx.db, ctx.auth.organizationId, input.objectId)),

  /** Create a new view. Caller becomes the owner. Default `sharedWith` is
   *  a personal view ({user, caller}); pass [{kind:'org'}] to share the
   *  whole workspace. */
  create: permissionProcedure('view.write')
    .input(CreateInput)
    .mutation(async ({ ctx, input }) => {
      if (input.type === 'report') {
        await assertReportConfig(ctx, input.objectId, input.config, input.filters);
      }
      const shared =
        input.sharedWith.length > 0
          ? input.sharedWith
          : ([{ kind: 'user', userId: ctx.auth.userId }] as ShareTarget[]);
      const [row] = await ctx.db
        .insert(schema.view)
        .values({
          organizationId: ctx.auth.organizationId,
          objectId: input.objectId,
          key: input.key,
          label: input.label,
          type: input.type,
          icon: input.icon,
          config: input.config ?? {},
          filters: input.filters,
          sort: input.sort,
          columns: input.columns,
          sharedWith: shared,
          ownerId: ctx.auth.userId,
          isDefault: false,
        })
        .returning();
      await writeAuditEvent(ctx.db, {
        organizationId: ctx.auth.organizationId,
        userId: ctx.auth.userId,
        action: 'view.created',
        targetType: 'view',
        targetId: row?.id ?? null,
        meta: { label: input.label, type: input.type, objectId: input.objectId },
      });
      return row;
    }),

  /** Patch any subset of fields. Only the owner can edit; admins can edit
   *  any view in the org. */
  update: permissionProcedure('view.write')
    .input(UpdateInput)
    .mutation(async ({ ctx, input }) => {
      const existing = await getView(ctx.db, ctx.auth.organizationId, input.id);
      if (!existing) {
        throw new TRPCError({ code: 'NOT_FOUND', message: `view '${input.id}' not found` });
      }
      const isOwner = existing.ownerId === ctx.auth.userId;
      const isAdmin = ctx.auth.role === 'owner' || ctx.auth.role === 'admin';
      if (!isOwner && !isAdmin) {
        throw new TRPCError({ code: 'FORBIDDEN', message: 'only the view owner can edit this' });
      }
      // Re-validate the effective (patched) report spec — covers a config
      // change, a type switch to 'report', and a filter change alike.
      if ((input.type ?? existing.type) === 'report') {
        await assertReportConfig(
          ctx,
          input.objectId ?? existing.objectId,
          input.config !== undefined ? input.config : existing.config,
          input.filters ?? existing.filters,
        );
      }
      const { id, ...patch } = input;
      const [row] = await ctx.db
        .update(schema.view)
        .set({ ...patch, updatedAt: new Date() })
        .where(and(eq(schema.view.organizationId, ctx.auth.organizationId), eq(schema.view.id, id)))
        .returning();
      await writeAuditEvent(ctx.db, {
        organizationId: ctx.auth.organizationId,
        userId: ctx.auth.userId,
        action: 'view.updated',
        targetType: 'view',
        targetId: id,
        meta: { label: row?.label, changed: Object.keys(patch) },
      });
      return row;
    }),

  /** Pin a view as the default for its (object, type). At most one default
   *  per object; this clears the previous one in the same transaction. */
  setDefault: permissionProcedure('view.write')
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const target = await getView(ctx.db, ctx.auth.organizationId, input.id);
      if (!target) {
        throw new TRPCError({ code: 'NOT_FOUND', message: `view '${input.id}' not found` });
      }
      await ctx.db
        .update(schema.view)
        .set({ isDefault: false })
        .where(
          and(
            eq(schema.view.organizationId, ctx.auth.organizationId),
            eq(schema.view.objectId, target.objectId),
            eq(schema.view.isDefault, true),
          ),
        );
      await ctx.db
        .update(schema.view)
        .set({ isDefault: true })
        .where(
          and(
            eq(schema.view.organizationId, ctx.auth.organizationId),
            eq(schema.view.id, input.id),
          ),
        );
      await writeAuditEvent(ctx.db, {
        organizationId: ctx.auth.organizationId,
        userId: ctx.auth.userId,
        action: 'view.pinned',
        targetType: 'view',
        targetId: input.id,
        meta: { label: target.label, objectId: target.objectId },
      });
      return { ok: true as const };
    }),

  /** Delete a view. System-seeded defaults (ownerId is null + isDefault)
   *  can't be deleted — they're the dispatcher's safety net. */
  delete: permissionProcedure('view.write')
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const existing = await getView(ctx.db, ctx.auth.organizationId, input.id);
      if (!existing) {
        throw new TRPCError({ code: 'NOT_FOUND', message: `view '${input.id}' not found` });
      }
      if (existing.ownerId === null && existing.isDefault) {
        throw new TRPCError({
          code: 'FORBIDDEN',
          message: "can't delete the system default view",
        });
      }
      const isOwner = existing.ownerId === ctx.auth.userId;
      const isAdmin = ctx.auth.role === 'owner' || ctx.auth.role === 'admin';
      if (!isOwner && !isAdmin) {
        throw new TRPCError({ code: 'FORBIDDEN', message: 'only the view owner can delete this' });
      }
      await ctx.db
        .delete(schema.view)
        .where(
          and(
            eq(schema.view.organizationId, ctx.auth.organizationId),
            eq(schema.view.id, input.id),
          ),
        );
      await writeAuditEvent(ctx.db, {
        organizationId: ctx.auth.organizationId,
        userId: ctx.auth.userId,
        action: 'view.deleted',
        targetType: 'view',
        targetId: input.id,
        meta: { label: existing.label, type: existing.type },
      });
      return { ok: true as const };
    }),
});
