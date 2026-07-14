// /trpc/record — generic CRUD over records of ANY object, driven by the metadata
// layer. Authorization (per-object CRUD grant + record ACL) is NOT open-coded
// here: every read/write goes through `ctx.records` (RecordAccess), which
// applies the gate centrally. These handlers own only input shape, validation,
// compute, audit, and wire serialization.

import { QuerySpecSchema, ValidationFailedError } from '@northbeam/core';
import {
  type FormatRule,
  type QuerySpecLike,
  createRecord,
  deleteRecord,
  displayName,
  getRecordType,
  grantShare,
  listObjects,
  listSharesForRecord,
  listValidationRules,
  recomputeAndPersist,
  recomputeParentRollups,
  requiredIssues,
  resolveRefLabels,
  revokeShare,
  ruleIssues,
  sanitizeData,
  updateRecord,
  writeAuditEvent,
} from '@northbeam/db';
import { TRPCError } from '@trpc/server';
import { z } from 'zod';
import { captureRecordChange } from '../../salesforce/capture.js';
import type { Context } from '../context.js';
import { DateGrainSchema, ReportAggSchema, ReportHavingSchema } from '../report-config.js';
import { FilterEntrySchema } from '../schemas.js';
import { protectedProcedure, router } from '../trpc.js';

const dataSchema = z.record(z.string(), z.unknown());

/** A recordTypeId sent with a write must be an active type on the object. */
async function assertRecordType(
  ctx: Context,
  object: { id: string; key: string },
  recordTypeId: string,
): Promise<void> {
  if (!ctx.auth) throw new TRPCError({ code: 'UNAUTHORIZED' });
  const rt = await getRecordType(ctx.db, ctx.auth.organizationId, recordTypeId);
  if (!rt || rt.objectId !== object.id || !rt.active) {
    throw new TRPCError({
      code: 'BAD_REQUEST',
      message: `record type '${recordTypeId}' is not an active type on '${object.key}'`,
    });
  }
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
  formatRules: FormatRule[];
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
    formatRules: o.formatRules,
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
        // View filters/sort, pushed down to SQL. Entries may be `{ any: [...] }`
        // OR groups (AI dashboards emit them).
        filters: z.array(FilterEntrySchema).default([]),
        sort: z
          .array(z.object({ fieldKey: z.string(), direction: z.enum(['asc', 'desc']) }))
          .default([]),
        limit: z.number().min(1).max(200).optional(),
        offset: z.number().min(0).optional(),
      }),
    )
    .query(async ({ ctx, input }) => {
      const { authed, rows } = await ctx.records.list(input.objectKey, {
        search: input.search,
        filters: input.filters,
        sort: input.sort,
        limit: input.limit,
        offset: input.offset,
      });
      const { object, fields } = authed;
      const refLabels = await resolveRefLabels(ctx.db, ctx.auth.organizationId, fields, rows);
      return {
        object: serializeObject(object),
        fields: fields.map(serializeField),
        rows: rows.map((r) => ({
          id: r.id,
          data: r.data,
          ownerId: r.ownerId,
          recordTypeId: r.recordTypeId,
          name: displayName(fields, r.data, object.nameExpression),
          createdAt: r.createdAt,
          updatedAt: r.updatedAt,
        })),
        refLabels,
      };
    }),

  /** Cross-object record search for the ⌘K palette / global search bar.
   *  Mirrors `list`'s ACL exactly (per-object read gate, private-visibility
   *  share resolution) — do NOT relax this to the searchRefs shape, which
   *  skips ACL. Results are name matches only, a handful per object. */
  search: protectedProcedure
    .input(
      z.object({ q: z.string().min(1).max(200), perObject: z.number().min(1).max(10).optional() }),
    )
    .query(async ({ ctx, input }) => {
      const per = input.perObject ?? 3;
      const objects = await listObjects(ctx.db, ctx.auth.organizationId);
      const groups = await Promise.all(
        objects
          .filter((o) => !o.archivedAt)
          .map(async (o) => {
            // Non-throwing read gate: silently skip objects this caller can't
            // see instead of failing the whole cross-object search.
            const authed = await ctx.records.readable(o.key);
            if (!authed) return [];
            const { rows } = await ctx.records.searchRefs(o.key, input.q, per);
            return rows.map((r) => ({
              objectKey: authed.object.key,
              objectLabel: authed.object.label,
              icon: authed.object.icon,
              color: authed.object.color,
              id: r.id,
              name: displayName(authed.fields, r.data, authed.object.nameExpression),
            }));
          }),
      );
      return groups.flat().slice(0, 30);
    }),

  get: protectedProcedure
    .input(z.object({ objectKey: z.string(), id: z.string() }))
    .query(async ({ ctx, input }) => {
      const { authed, row } = await ctx.records.get(input.objectKey, input.id);
      if (!row) throw new TRPCError({ code: 'NOT_FOUND' });
      const { object, fields } = authed;
      const refLabels = await resolveRefLabels(ctx.db, ctx.auth.organizationId, fields, [row]);
      return {
        object: serializeObject(object),
        fields: fields.map(serializeField),
        row: {
          id: row.id,
          data: row.data,
          ownerId: row.ownerId,
          recordTypeId: row.recordTypeId,
          name: displayName(fields, row.data, object.nameExpression),
          createdAt: row.createdAt,
          updatedAt: row.updatedAt,
        },
        refLabels,
      };
    }),

  /** Group-by aggregation for report views and dashboard Chart nodes. The read
   *  gate + record ACL + join-target read gate are applied by ctx.records. */
  aggregate: protectedProcedure
    .input(
      z.object({
        objectKey: z.string(),
        groupBy: z.string().nullish(),
        groupByGrain: DateGrainSchema.optional(),
        groupBy2: z.string().nullish(),
        groupBy2Grain: DateGrainSchema.optional(),
        measure: z.object({ agg: ReportAggSchema, fieldKey: z.string().optional() }),
        having: ReportHavingSchema.optional(),
        filters: z.array(FilterEntrySchema).default([]),
        search: z.string().optional(),
        limit: z.number().min(1).max(1000).optional(),
      }),
    )
    .query(async ({ ctx, input }) => {
      return ctx.records.aggregate(input.objectKey, {
        groupBy: input.groupBy,
        groupByGrain: input.groupByGrain,
        groupBy2: input.groupBy2,
        groupBy2Grain: input.groupBy2Grain,
        measure: input.measure,
        having: input.having,
        filters: input.filters,
        search: input.search,
        limit: input.limit,
      });
    }),

  /** QuerySpec execution — the declarative engine behind QueryBlock artifact
   *  nodes. Resolution + join-target read gate + ACL live in ctx.records. */
  query: protectedProcedure.input(QuerySpecSchema).query(async ({ ctx, input }) => {
    return ctx.records.query(input.objectKey, input as QuerySpecLike);
  }),

  /** Records on other objects that reference this one — the Related panel.
   *  ctx.records.related gates the base read and drops child objects/rows the
   *  caller can't see. */
  related: protectedProcedure
    .input(z.object({ objectKey: z.string(), id: z.string() }))
    .query(async ({ ctx, input }) => {
      const groups = await ctx.records.related(input.objectKey, input.id);
      return groups.map((g) => ({
        object: serializeObject(g.object),
        via: { key: g.via.key, label: g.via.label },
        fields: g.fields.map(serializeField),
        rows: g.rows.map((r) => ({
          id: r.id,
          data: r.data,
          name: displayName(g.fields, r.data),
          createdAt: r.createdAt,
        })),
      }));
    }),

  create: protectedProcedure
    .input(
      z.object({
        objectKey: z.string(),
        data: dataSchema,
        recordTypeId: z.string().uuid().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const { authed } = await ctx.records.authorizeWrite(input.objectKey, 'create');
      const { object, fields } = authed;
      if (input.recordTypeId) await assertRecordType(ctx, object, input.recordTypeId);
      const data = sanitizeData(fields, input.data);
      const now = new Date();
      // Required + validation-rule checks. v1 limitation: rule conditions
      // referencing formula/rollup keys see null on create (recompute runs
      // after the save) and the stored values on update.
      const rules = await listValidationRules(ctx.db, ctx.auth.organizationId, object.id);
      const issues = [...requiredIssues(fields, data), ...ruleIssues(rules, data, now)];
      if (issues.length) throw new ValidationFailedError(issues);
      const created = await createRecord(ctx.db, {
        orgId: ctx.auth.organizationId,
        object,
        fields,
        data,
        ownerId: ctx.auth.userId,
        recordTypeId: input.recordTypeId,
      });
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
      await writeAuditEvent(ctx.db, {
        organizationId: ctx.auth.organizationId,
        userId: ctx.auth.userId,
        action: 'record.created',
        targetType: 'record',
        targetId: created.id,
        meta: {
          objectKey: object.key,
          name: displayName(fields, created.data, object.nameExpression),
        },
      });
      // Write-back capture: a locally-created record on a mapped object gets
      // an SF counterpart (the worker POSTs and stamps salesforce_id back).
      const syncEnqueue = await captureRecordChange(ctx.db, {
        orgId: ctx.auth.organizationId,
        objectKey: object.key,
        recordId: created.id,
        changedKeys: Object.keys(created.data),
      });
      if (syncEnqueue) ctx.postCommit.push(syncEnqueue);
      return { ...created, data: { ...created.data, ...computed } };
    }),

  update: protectedProcedure
    .input(
      z.object({
        objectKey: z.string(),
        id: z.string(),
        data: dataSchema,
        recordTypeId: z.string().uuid().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const { authed, existing } = await ctx.records.authorizeWrite(
        input.objectKey,
        'update',
        input.id,
      );
      // authorizeWrite('update', id) throws NOT_FOUND when the row is missing.
      if (!existing) throw new TRPCError({ code: 'NOT_FOUND' });
      const { object, fields } = authed;
      if (input.recordTypeId) await assertRecordType(ctx, object, input.recordTypeId);
      const patch = sanitizeData(fields, input.data);
      const merged = { ...existing.data, ...patch };
      const now = new Date();
      // Checks run on the MERGED record so clearing a required field — or
      // patching one field into a state a rule forbids — is caught.
      const rules = await listValidationRules(ctx.db, ctx.auth.organizationId, object.id);
      const issues = [...requiredIssues(fields, merged), ...ruleIssues(rules, merged, now)];
      if (issues.length) throw new ValidationFailedError(issues);
      const row = await updateRecord(ctx.db, {
        orgId: ctx.auth.organizationId,
        object,
        fields,
        id: input.id,
        data: merged,
        recordTypeId: input.recordTypeId,
      });
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
      const changed = Object.keys(patch).filter(
        (k) => JSON.stringify(existing.data[k] ?? null) !== JSON.stringify(patch[k] ?? null),
      );
      await writeAuditEvent(ctx.db, {
        organizationId: ctx.auth.organizationId,
        userId: ctx.auth.userId,
        action: 'record.updated',
        targetType: 'record',
        targetId: input.id,
        meta: {
          objectKey: object.key,
          name: displayName(fields, merged, object.nameExpression),
          changed,
        },
      });
      // Write-back capture (no-op unless the org enabled sync). Outbox row
      // commits with this tx; the enqueue runs post-commit.
      const syncEnqueue = await captureRecordChange(ctx.db, {
        orgId: ctx.auth.organizationId,
        objectKey: object.key,
        recordId: input.id,
        changedKeys: changed,
      });
      if (syncEnqueue) ctx.postCommit.push(syncEnqueue);
      return row ? { ...row, data: { ...row.data, ...computed } } : row;
    }),

  remove: protectedProcedure
    .input(z.object({ objectKey: z.string(), id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const { authed, existing } = await ctx.records.authorizeWrite(
        input.objectKey,
        'delete',
        input.id,
      );
      if (!existing) throw new TRPCError({ code: 'NOT_FOUND' });
      const { object, fields } = authed;
      await deleteRecord(ctx.db, { orgId: ctx.auth.organizationId, object, id: input.id });
      await recomputeParentRollups(ctx.db, {
        orgId: ctx.auth.organizationId,
        childObjectKey: object.key,
        childData: existing.data,
        now: new Date(),
      });
      await writeAuditEvent(ctx.db, {
        organizationId: ctx.auth.organizationId,
        userId: ctx.auth.userId,
        action: 'record.deleted',
        targetType: 'record',
        targetId: input.id,
        meta: {
          objectKey: object.key,
          name: displayName(fields, existing.data, object.nameExpression),
        },
      });
      return { ok: true as const };
    }),

  /** List who can see this record (owner + explicit shares). */
  shares: protectedProcedure
    .input(z.object({ objectKey: z.string(), id: z.string() }))
    .query(async ({ ctx, input }) => {
      const { object } = await ctx.records.require(input.objectKey);
      return listSharesForRecord(
        ctx.db,
        { orgId: ctx.auth.organizationId, userId: ctx.auth.userId, role: ctx.auth.role },
        object.id,
        input.id,
      );
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
      const { authed, existing } = await ctx.records.authorizeShare(input.objectKey, input.id);
      const { object, fields } = authed;
      await grantShare(
        ctx.db,
        { orgId: ctx.auth.organizationId, userId: ctx.auth.userId, role: ctx.auth.role },
        { objectId: object.id, recordId: input.id, userId: input.userId, level: input.level },
      );
      await writeAuditEvent(ctx.db, {
        organizationId: ctx.auth.organizationId,
        userId: ctx.auth.userId,
        action: 'record.shared',
        targetType: 'record',
        targetId: input.id,
        meta: {
          objectKey: object.key,
          name: displayName(fields, existing.data, object.nameExpression),
          sharedWith: input.userId,
          level: input.level,
        },
      });
      return { ok: true as const };
    }),

  /** Remove a share. Same authz as `share`. */
  unshare: protectedProcedure
    .input(z.object({ objectKey: z.string(), id: z.string(), userId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const { authed, existing } = await ctx.records.authorizeShare(input.objectKey, input.id);
      const { object, fields } = authed;
      await revokeShare(
        ctx.db,
        { orgId: ctx.auth.organizationId, userId: ctx.auth.userId, role: ctx.auth.role },
        { objectId: object.id, recordId: input.id, userId: input.userId },
      );
      await writeAuditEvent(ctx.db, {
        organizationId: ctx.auth.organizationId,
        userId: ctx.auth.userId,
        action: 'record.unshared',
        targetType: 'record',
        targetId: input.id,
        meta: {
          objectKey: object.key,
          name: displayName(fields, existing.data, object.nameExpression),
          unsharedFrom: input.userId,
        },
      });
      return { ok: true as const };
    }),

  /** Re-evaluate every formula + rollup field on a record and persist. Requires
   *  update access (it writes). */
  recompute: protectedProcedure
    .input(z.object({ objectKey: z.string(), id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const { authed } = await ctx.records.authorizeWrite(input.objectKey, 'update', input.id);
      const { object, fields } = authed;
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
      const { authed, rows } = await ctx.records.searchRefs(
        input.objectKey,
        input.q,
        input.limit ?? 20,
      );
      return rows.map((r) => ({ value: r.id, label: displayName(authed.fields, r.data) }));
    }),
});
