// /trpc/record — generic CRUD over records of ANY object, driven by the metadata
// layer. Every operation is org-scoped. Field values live in `data` (JSONB).

import {
  canEditRecord,
  createRecord,
  deleteRecord,
  displayName,
  getObjectByKey,
  getRecord,
  grantShare,
  isAdminish,
  listRecords,
  listRelated,
  listSharesForRecord,
  recomputeAndPersist,
  recomputeParentRollups,
  resolveRefLabels,
  revokeShare,
  sanitizeData,
  updateRecord,
  visibleSharedRecordIds,
} from '@northbeam/db';
import { TRPCError } from '@trpc/server';
import { z } from 'zod';
import type { Context } from '../context.js';
import { protectedProcedure, router } from '../trpc.js';

const dataSchema = z.record(z.string(), z.unknown());

async function requireObject(ctx: Context, key: string) {
  if (!ctx.auth) throw new TRPCError({ code: 'UNAUTHORIZED' });
  const result = await getObjectByKey(ctx.db, ctx.auth.organizationId, key);
  if (!result) throw new TRPCError({ code: 'NOT_FOUND', message: `object '${key}' not found` });
  return result;
}

// Wire-friendly projections shared by list/get/related — the web app's
// FieldDefLite / object shape. Keeps Drizzle internals off the client.
type ObjectRowLike = {
  id: string;
  key: string;
  label: string;
  labelPlural: string;
  icon: string;
  color: string;
  layout: unknown;
};
function serializeObject(o: ObjectRowLike) {
  return {
    id: o.id,
    key: o.key,
    label: o.label,
    labelPlural: o.labelPlural,
    icon: o.icon,
    color: o.color,
    layout: o.layout,
  };
}
type FieldRowLike = {
  id: string;
  key: string;
  label: string;
  type: string;
  config: unknown;
  required: boolean;
  orderIndex: number;
};
function serializeField(f: FieldRowLike) {
  return {
    id: f.id,
    key: f.key,
    label: f.label,
    type: f.type,
    config: f.config,
    required: f.required,
    orderIndex: f.orderIndex,
  };
}

export const recordRouter = router({
  /** Records of an object, with field defs + resolved reference labels for the page. */
  list: protectedProcedure
    .input(
      z.object({
        objectKey: z.string(),
        search: z.string().optional(),
        limit: z.number().min(1).max(200).optional(),
        offset: z.number().min(0).optional(),
      }),
    )
    .query(async ({ ctx, input }) => {
      const { object, fields } = await requireObject(ctx, input.objectKey);
      // Pre-resolve the caller's explicit-share record ids when the object
      // is private — listRecords folds them into the WHERE so SQL does the
      // filtering, not app code reading every row.
      const aclCtx = {
        orgId: ctx.auth.organizationId,
        userId: ctx.auth.userId,
        role: ctx.auth.role,
      };
      const sharedRecordIds =
        object.defaultVisibility === 'private' && !isAdminish(ctx.auth.role)
          ? await visibleSharedRecordIds(ctx.db, aclCtx, object.id)
          : [];
      const rows = await listRecords(ctx.db, {
        orgId: ctx.auth.organizationId,
        object,
        fields,
        search: input.search,
        limit: input.limit,
        offset: input.offset,
        acl: {
          userId: ctx.auth.userId,
          sharedRecordIds,
          isAdminish: isAdminish(ctx.auth.role),
        },
      });
      const refLabels = await resolveRefLabels(ctx.db, ctx.auth.organizationId, fields, rows);
      return {
        object: serializeObject(object),
        fields: fields.map(serializeField),
        rows: rows.map((r) => ({
          id: r.id,
          data: r.data,
          ownerId: r.ownerId,
          name: displayName(fields, r.data, object.nameExpression),
          createdAt: r.createdAt,
          updatedAt: r.updatedAt,
        })),
        refLabels,
      };
    }),

  get: protectedProcedure
    .input(z.object({ objectKey: z.string(), id: z.string() }))
    .query(async ({ ctx, input }) => {
      const { object, fields } = await requireObject(ctx, input.objectKey);
      // For a single record we just check whether *this* record has a share
      // for the caller; cheaper than the bulk visibleSharedRecordIds query.
      let hasShare = false;
      if (object.defaultVisibility === 'private' && !isAdminish(ctx.auth.role)) {
        const shares = await visibleSharedRecordIds(
          ctx.db,
          { orgId: ctx.auth.organizationId, userId: ctx.auth.userId, role: ctx.auth.role },
          object.id,
        );
        hasShare = shares.includes(input.id);
      }
      const row = await getRecord(ctx.db, {
        orgId: ctx.auth.organizationId,
        object,
        fields,
        id: input.id,
        acl: { userId: ctx.auth.userId, isAdminish: isAdminish(ctx.auth.role), hasShare },
      });
      if (!row) throw new TRPCError({ code: 'NOT_FOUND' });
      const refLabels = await resolveRefLabels(ctx.db, ctx.auth.organizationId, fields, [row]);
      return {
        object: serializeObject(object),
        fields: fields.map(serializeField),
        row: {
          id: row.id,
          data: row.data,
          ownerId: row.ownerId,
          name: displayName(fields, row.data, object.nameExpression),
          createdAt: row.createdAt,
          updatedAt: row.updatedAt,
        },
        refLabels,
      };
    }),

  /** Records on other objects that reference this one — the Related panel. */
  related: protectedProcedure
    .input(z.object({ objectKey: z.string(), id: z.string() }))
    .query(async ({ ctx, input }) => {
      const groups = await listRelated(ctx.db, ctx.auth.organizationId, input.objectKey, input.id);
      return groups.map((g) => ({
        object: serializeObject(g.object),
        via: { key: g.via.key, label: g.via.label },
        fields: g.fields.map(serializeField),
        rows: g.rows.map((r) => ({
          id: r.id,
          data: r.data,
          name: displayName(g.fields, r.data),
        })),
      }));
    }),

  create: protectedProcedure
    .input(z.object({ objectKey: z.string(), data: dataSchema }))
    .mutation(async ({ ctx, input }) => {
      const { object, fields } = await requireObject(ctx, input.objectKey);
      const created = await createRecord(ctx.db, {
        orgId: ctx.auth.organizationId,
        object,
        fields,
        data: sanitizeData(fields, input.data),
        ownerId: ctx.auth.userId,
      });
      // Compute this record's own formulas/rollups in-transaction, then update
      // any parent whose rollups this new child feeds.
      const now = new Date();
      const computed = await recomputeAndPersist(ctx.db, {
        orgId: ctx.auth.organizationId,
        object,
        fields,
        recordId: created.id,
        now,
      });
      await recomputeParentRollups(ctx.db, {
        orgId: ctx.auth.organizationId,
        childObjectKey: object.key,
        childData: created.data,
        now,
      });
      return { ...created, data: { ...created.data, ...computed } };
    }),

  update: protectedProcedure
    .input(z.object({ objectKey: z.string(), id: z.string(), data: dataSchema }))
    .mutation(async ({ ctx, input }) => {
      const { object, fields } = await requireObject(ctx, input.objectKey);
      const existing = await getRecord(ctx.db, {
        orgId: ctx.auth.organizationId,
        object,
        fields,
        id: input.id,
      });
      if (!existing) throw new TRPCError({ code: 'NOT_FOUND' });
      // Edit ACL: owner / admin+ always; explicit share with level='edit'
      // otherwise. Public objects skip the check.
      if (object.defaultVisibility === 'private') {
        const allowed = await canEditRecord(
          ctx.db,
          { orgId: ctx.auth.organizationId, userId: ctx.auth.userId, role: ctx.auth.role },
          object.id,
          input.id,
          existing.ownerId,
        );
        if (!allowed) {
          throw new TRPCError({ code: 'FORBIDDEN', message: 'no edit access to this record' });
        }
      }
      const merged = { ...existing.data, ...sanitizeData(fields, input.data) };
      const row = await updateRecord(ctx.db, {
        orgId: ctx.auth.organizationId,
        object,
        fields,
        id: input.id,
        data: merged,
      });
      // Recompute this record, then refresh parent rollups for BOTH the old and
      // new reference targets (a child re-parented to a different record must
      // update both the old and new parent's rollup).
      const now = new Date();
      const computed = await recomputeAndPersist(ctx.db, {
        orgId: ctx.auth.organizationId,
        object,
        fields,
        recordId: input.id,
        now,
      });
      for (const childData of [existing.data, merged]) {
        await recomputeParentRollups(ctx.db, {
          orgId: ctx.auth.organizationId,
          childObjectKey: object.key,
          childData,
          now,
        });
      }
      return row ? { ...row, data: { ...row.data, ...computed } } : row;
    }),

  remove: protectedProcedure
    .input(z.object({ objectKey: z.string(), id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const { object, fields } = await requireObject(ctx, input.objectKey);
      // Delete needs the existing row to check the owner.
      const existing = await getRecord(ctx.db, {
        orgId: ctx.auth.organizationId,
        object,
        fields,
        id: input.id,
      });
      if (!existing) throw new TRPCError({ code: 'NOT_FOUND' });
      if (object.defaultVisibility === 'private') {
        const allowed = await canEditRecord(
          ctx.db,
          { orgId: ctx.auth.organizationId, userId: ctx.auth.userId, role: ctx.auth.role },
          object.id,
          input.id,
          existing.ownerId,
        );
        if (!allowed) {
          throw new TRPCError({ code: 'FORBIDDEN', message: 'no delete access to this record' });
        }
      }
      await deleteRecord(ctx.db, { orgId: ctx.auth.organizationId, object, id: input.id });
      // The parent's rollups must drop this now-deleted child.
      await recomputeParentRollups(ctx.db, {
        orgId: ctx.auth.organizationId,
        childObjectKey: object.key,
        childData: existing.data,
        now: new Date(),
      });
      return { ok: true as const };
    }),

  /** List who can see this record (owner + explicit shares). Drives the
   *  Sharing panel on the record detail page. */
  shares: protectedProcedure
    .input(z.object({ objectKey: z.string(), id: z.string() }))
    .query(async ({ ctx, input }) => {
      const { object } = await requireObject(ctx, input.objectKey);
      const shares = await listSharesForRecord(
        ctx.db,
        { orgId: ctx.auth.organizationId, userId: ctx.auth.userId, role: ctx.auth.role },
        object.id,
        input.id,
      );
      return shares;
    }),

  /** Grant a user read or edit access to a specific record. */
  share: protectedProcedure
    .input(
      z.object({
        objectKey: z.string(),
        id: z.string(),
        userId: z.string(),
        level: z.enum(['read', 'edit']),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const { object, fields } = await requireObject(ctx, input.objectKey);
      const existing = await getRecord(ctx.db, {
        orgId: ctx.auth.organizationId,
        object,
        fields,
        id: input.id,
      });
      if (!existing) throw new TRPCError({ code: 'NOT_FOUND' });
      // Only the owner or an admin+ can share.
      if (!isAdminish(ctx.auth.role) && existing.ownerId !== ctx.auth.userId) {
        throw new TRPCError({
          code: 'FORBIDDEN',
          message: 'only the owner or an admin can share this record',
        });
      }
      await grantShare(
        ctx.db,
        { orgId: ctx.auth.organizationId, userId: ctx.auth.userId, role: ctx.auth.role },
        { objectId: object.id, recordId: input.id, userId: input.userId, level: input.level },
      );
      return { ok: true as const };
    }),

  /** Remove a share. Same authz as `share`. */
  unshare: protectedProcedure
    .input(z.object({ objectKey: z.string(), id: z.string(), userId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const { object, fields } = await requireObject(ctx, input.objectKey);
      const existing = await getRecord(ctx.db, {
        orgId: ctx.auth.organizationId,
        object,
        fields,
        id: input.id,
      });
      if (!existing) throw new TRPCError({ code: 'NOT_FOUND' });
      if (!isAdminish(ctx.auth.role) && existing.ownerId !== ctx.auth.userId) {
        throw new TRPCError({
          code: 'FORBIDDEN',
          message: 'only the owner or an admin can unshare this record',
        });
      }
      await revokeShare(
        ctx.db,
        { orgId: ctx.auth.organizationId, userId: ctx.auth.userId, role: ctx.auth.role },
        { objectId: object.id, recordId: input.id, userId: input.userId },
      );
      return { ok: true as const };
    }),

  /** Re-evaluate every formula + rollup field on a record (topologically
   *  ordered, with cross-object resolution) and persist the new values.
   *  Triggered by the field-editor "Recalculate now" button; safe to call any
   *  time. Same-record writes already recompute automatically. */
  recompute: protectedProcedure
    .input(z.object({ objectKey: z.string(), id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const { object, fields } = await requireObject(ctx, input.objectKey);
      const row = await getRecord(ctx.db, {
        orgId: ctx.auth.organizationId,
        object,
        fields,
        id: input.id,
      });
      if (!row) throw new TRPCError({ code: 'NOT_FOUND' });
      const values = await recomputeAndPersist(ctx.db, {
        orgId: ctx.auth.organizationId,
        object,
        fields,
        recordId: input.id,
        now: new Date(),
      });
      return { recomputed: Object.keys(values).length };
    }),

  /** Typeahead for reference (lookup) fields: search a target object's records. */
  searchRefs: protectedProcedure
    .input(
      z.object({
        objectKey: z.string(),
        q: z.string().optional(),
        limit: z.number().max(50).optional(),
      }),
    )
    .query(async ({ ctx, input }) => {
      const { object, fields } = await requireObject(ctx, input.objectKey);
      const rows = await listRecords(ctx.db, {
        orgId: ctx.auth.organizationId,
        object,
        fields,
        search: input.q,
        limit: input.limit ?? 20,
      });
      return rows.map((r) => ({ value: r.id, label: displayName(fields, r.data) }));
    }),
});
