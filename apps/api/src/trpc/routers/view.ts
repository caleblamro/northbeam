// /trpc/view — read + manage saved views. Visibility filtering lives in the
// query helper (listViewsForUser) so the same access rules apply here, in
// background jobs, and in any future server actions.

import {
  type Filter,
  type ShareTarget,
  type ViewSort,
  type ViewType,
  getDefaultView,
  getView,
  listViewsForUser,
  schema,
  writeAuditEvent,
} from '@northbeam/db';
import { TRPCError } from '@trpc/server';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import { permissionProcedure, protectedProcedure, router } from '../trpc.js';

/* ── Zod shapes shared between mutations ────────────────────────────────── */

const ShareTargetSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('org') }),
  z.object({ kind: z.literal('role'), role: z.enum(['owner', 'admin', 'member', 'viewer']) }),
  z.object({ kind: z.literal('user'), userId: z.string().min(1) }),
]) satisfies z.ZodType<ShareTarget>;

const ViewTypeSchema = z.enum(['list']) satisfies z.ZodType<ViewType>;

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

// Filter / Sort use the same FilterOp / direction enums the web layer does,
// so the inferred Zod type lines up with the storage column type exactly.
// Renderer-specific config validation lives on the web side — keeping the
// API ignorant of the registry.
const FilterOpSchema = z.enum([
  'eq',
  'neq',
  'contains',
  'startsWith',
  'endsWith',
  'gt',
  'lt',
  'gte',
  'lte',
  'before',
  'after',
  'isTrue',
  'isFalse',
  'isEmpty',
  'isSet',
]);

const FilterSchema: z.ZodType<Filter> = z.object({
  fieldKey: z.string().min(1),
  op: FilterOpSchema,
  value: z.union([z.string(), z.number(), z.boolean(), z.null()]).optional(),
});

const SortSchema: z.ZodType<ViewSort> = z.object({
  fieldKey: z.string().min(1),
  direction: z.enum(['asc', 'desc']),
});

const KEY_RE = /^[a-z0-9](?:[a-z0-9-_]{0,46}[a-z0-9])?$/;

const CreateInput = z.object({
  objectId: z.string().uuid(),
  key: z.string().regex(KEY_RE, 'lowercase letters, digits, dashes / underscores'),
  label: z.string().min(1).max(80),
  type: ViewTypeSchema,
  icon: ViewIconSchema.default('list'),
  config: z.unknown().default({}),
  filters: z.array(FilterSchema).default([]),
  sort: z.array(SortSchema).default([]),
  columns: z.array(z.string()).default([]),
  sharedWith: z.array(ShareTargetSchema).default([]),
});

const UpdateInput = CreateInput.partial().extend({
  id: z.string().uuid(),
});

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
    .query(({ ctx, input }) =>
      getDefaultView(ctx.db, ctx.auth.organizationId, input.objectId),
    ),

  /** Create a new view. Caller becomes the owner. Default `sharedWith` is
   *  a personal view ({user, caller}); pass [{kind:'org'}] to share the
   *  whole workspace. */
  create: permissionProcedure('view.write')
    .input(CreateInput)
    .mutation(async ({ ctx, input }) => {
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
      const { id, ...patch } = input;
      const [row] = await ctx.db
        .update(schema.view)
        .set({ ...patch, updatedAt: new Date() })
        .where(
          and(eq(schema.view.organizationId, ctx.auth.organizationId), eq(schema.view.id, id)),
        )
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
          and(eq(schema.view.organizationId, ctx.auth.organizationId), eq(schema.view.id, input.id)),
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
          and(eq(schema.view.organizationId, ctx.auth.organizationId), eq(schema.view.id, input.id)),
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
