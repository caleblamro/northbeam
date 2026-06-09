// /trpc/record — generic CRUD over records of ANY object, driven by the metadata
// layer. Every operation is org-scoped. Field values live in `data` (JSONB).

import {
  createRecord,
  deleteRecord,
  displayName,
  getObjectByKey,
  getRecord,
  listRecords,
  listRelated,
  resolveRefLabels,
  sanitizeData,
  updateRecord,
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
      const rows = await listRecords(ctx.db, {
        orgId: ctx.auth.organizationId,
        objectId: object.id,
        fields,
        search: input.search,
        limit: input.limit,
        offset: input.offset,
      });
      const refLabels = await resolveRefLabels(ctx.db, ctx.auth.organizationId, fields, rows);
      return {
        object: serializeObject(object),
        fields: fields.map(serializeField),
        rows: rows.map((r) => ({
          id: r.id,
          data: r.data,
          ownerId: r.ownerId,
          name: displayName(fields, r.data),
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
      const row = await getRecord(ctx.db, ctx.auth.organizationId, input.id);
      if (!row) throw new TRPCError({ code: 'NOT_FOUND' });
      const refLabels = await resolveRefLabels(ctx.db, ctx.auth.organizationId, fields, [row]);
      return {
        object: serializeObject(object),
        fields: fields.map(serializeField),
        row: {
          id: row.id,
          data: row.data,
          ownerId: row.ownerId,
          name: displayName(fields, row.data),
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
      return createRecord(ctx.db, {
        orgId: ctx.auth.organizationId,
        objectId: object.id,
        data: sanitizeData(fields, input.data),
        ownerId: ctx.auth.userId,
      });
    }),

  update: protectedProcedure
    .input(z.object({ objectKey: z.string(), id: z.string(), data: dataSchema }))
    .mutation(async ({ ctx, input }) => {
      const { fields } = await requireObject(ctx, input.objectKey);
      const existing = await getRecord(ctx.db, ctx.auth.organizationId, input.id);
      if (!existing) throw new TRPCError({ code: 'NOT_FOUND' });
      const merged = { ...existing.data, ...sanitizeData(fields, input.data) };
      const row = await updateRecord(ctx.db, {
        orgId: ctx.auth.organizationId,
        id: input.id,
        data: merged,
      });
      return row;
    }),

  remove: protectedProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      await deleteRecord(ctx.db, ctx.auth.organizationId, input.id);
      return { ok: true as const };
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
        objectId: object.id,
        fields,
        search: input.q,
        limit: input.limit ?? 20,
      });
      return rows.map((r) => ({ value: r.id, label: displayName(fields, r.data) }));
    }),
});
