// /trpc/record — generic CRUD over records of ANY object, driven by the metadata
// layer. Every operation is org-scoped. Field values live in `data` (JSONB).

import {
  type ObjectAction,
  QuerySpecSchema,
  ValidationFailedError,
  canObject,
} from '@northbeam/core';
import {
  type FieldRow,
  type FormatRule,
  type ObjectWithFields,
  type PicklistOption,
  type QuerySpecLike,
  aggregateRecords,
  canEditRecord,
  collectQueryTargetKeys,
  createRecord,
  deleteRecord,
  displayName,
  getObjectByKey,
  getRecord,
  getRecordType,
  grantShare,
  hydratePicklistOptions,
  isAdminish,
  labelsForIds,
  listRecords,
  listRelated,
  listSharesForRecord,
  listValidationRules,
  narrowFieldConfig,
  recomputeAndPersist,
  recomputeParentRollups,
  requiredIssues,
  resolveQuerySpec,
  resolveRefLabels,
  revokeShare,
  ruleIssues,
  runQuery,
  sanitizeData,
  updateRecord,
  visibleSharedRecordIds,
  writeAuditEvent,
} from '@northbeam/db';
import { TRPCError } from '@trpc/server';
import { sql } from 'drizzle-orm';
import { z } from 'zod';
import type { Context } from '../context.js';
import {
  DateGrainSchema,
  ReportAggSchema,
  ReportHavingSchema,
  collectRefTargetKeys,
  resolveFilterRefPaths,
  resolveReportSpec,
} from '../report-config.js';
import { FilterEntrySchema } from '../schemas.js';
import { protectedProcedure, router } from '../trpc.js';

const dataSchema = z.record(z.string(), z.unknown());

/** Per-object CRUD gate — the caller's role must grant `action` on this object
 *  (a role default or an objectPermission override; owner always passes). */
function assertObjectPermission(ctx: Context, objectId: string, action: ObjectAction): void {
  if (!ctx.auth) throw new TRPCError({ code: 'UNAUTHORIZED' });
  if (!canObject(ctx.auth.permissions, objectId, action)) {
    throw new TRPCError({
      code: 'FORBIDDEN',
      message: `your role cannot ${action} records of this object`,
    });
  }
}

async function requireObject(
  ctx: Context,
  key: string,
  opts?: { forWrite?: boolean; skipReadCheck?: boolean },
) {
  if (!ctx.auth) throw new TRPCError({ code: 'UNAUTHORIZED' });
  const result = await getObjectByKey(ctx.db, ctx.auth.organizationId, key);
  if (!result) throw new TRPCError({ code: 'NOT_FOUND', message: `object '${key}' not found` });
  // Archived objects stay readable but reject record mutations.
  if (opts?.forWrite && result.object.archivedAt) {
    throw new TRPCError({ code: 'FORBIDDEN', message: `object '${key}' is archived` });
  }
  // Every record procedure funnels through here, so the per-object READ gate
  // lives here — mutations layer their create/update/delete check on top.
  if (!opts?.skipReadCheck) assertObjectPermission(ctx, result.object.id, 'read');
  return result;
}

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

/** Bucket labels for one grouping level of record.aggregate: reference
 *  buckets carry raw uuids (resolve to display names), picklist/multipicklist
 *  buckets carry raw values (ship the hydrated options for label + color). */
async function labelsForGroup(
  ctx: Context,
  field: FieldRow | undefined,
  values: Array<string | number | boolean | null>,
): Promise<{ labels?: Record<string, string>; options?: PicklistOption[] }> {
  if (!ctx.auth) throw new TRPCError({ code: 'UNAUTHORIZED' });
  if (!field) return {};
  if (field.type === 'reference') {
    const target = narrowFieldConfig('reference', field.config).targetObject;
    const ids = values.filter((g): g is string => typeof g === 'string' && g.length > 0);
    return {
      labels: target ? await labelsForIds(ctx.db, ctx.auth.organizationId, target, ids) : {},
    };
  }
  if (field.type === 'picklist') {
    return { options: narrowFieldConfig('picklist', field.config).options ?? [] };
  }
  if (field.type === 'multipicklist') {
    return { options: narrowFieldConfig('multipicklist', field.config).options ?? [] };
  }
  return {};
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
        // View filters/sort, pushed down to SQL by listRecords so the rows come
        // back already filtered + ordered (see packages/db dynamic/filters-sql.ts).
        // Entries may be `{ any: [...] }` OR groups (AI dashboards emit them).
        filters: z.array(FilterEntrySchema).default([]),
        sort: z
          .array(z.object({ fieldKey: z.string(), direction: z.enum(['asc', 'desc']) }))
          .default([]),
        limit: z.number().min(1).max(200).optional(),
        offset: z.number().min(0).optional(),
      }),
    )
    .query(async ({ ctx, input }) => {
      const { object, fields: rawFields } = await requireObject(ctx, input.objectKey);
      const fields = await hydratePicklistOptions(ctx.db, ctx.auth.organizationId, rawFields);
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
        filters: input.filters,
        sort: input.sort,
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
          recordTypeId: r.recordTypeId,
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
      const { object, fields: rawFields } = await requireObject(ctx, input.objectKey);
      const fields = await hydratePicklistOptions(ctx.db, ctx.auth.organizationId, rawFields);
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
          recordTypeId: row.recordTypeId,
          name: displayName(fields, row.data, object.nameExpression),
          createdAt: row.createdAt,
          updatedAt: row.updatedAt,
        },
        refLabels,
      };
    }),

  /** Group-by aggregation for report views and dashboard Chart nodes. Applies
   *  the same visibility rules as `list` — the ACL predicate is shared with
   *  listRecords server-side, so a report never counts a hidden row. */
  aggregate: protectedProcedure
    .input(
      z.object({
        objectKey: z.string(),
        groupBy: z.string().nullish(),
        groupByGrain: DateGrainSchema.optional(),
        groupBy2: z.string().nullish(),
        groupBy2Grain: DateGrainSchema.optional(),
        measure: z.object({
          agg: ReportAggSchema,
          fieldKey: z.string().optional(),
        }),
        having: ReportHavingSchema.optional(),
        filters: z.array(FilterEntrySchema).default([]),
        /** Same ILIKE text search listRecords applies — keeps the list
         *  footer's count/Σ exact while the search box is active. */
        search: z.string().optional(),
        // Two groupings return (group, group2) PAIRS, so the cap is wider;
        // single-group requests are clamped back to 200 below.
        limit: z.number().min(1).max(1000).optional(),
      }),
    )
    .query(async ({ ctx, input }) => {
      const { object, fields: rawFields } = await requireObject(ctx, input.objectKey);
      const fields = await hydratePicklistOptions(ctx.db, ctx.auth.organizationId, rawFields);

      // Dot paths ('account.industry') need the target objects' metadata —
      // load each referenced target once, hydrated so remote picklist buckets
      // carry labeled options.
      const targetKeys = collectRefTargetKeys(
        fields,
        [input.groupBy, input.groupBy2],
        input.filters,
      );
      const targets = new Map<string, ObjectWithFields>();
      for (const key of targetKeys) {
        const t = await getObjectByKey(ctx.db, ctx.auth.organizationId, key);
        if (!t) continue;
        targets.set(key, {
          object: t.object,
          fields: await hydratePicklistOptions(ctx.db, ctx.auth.organizationId, t.fields),
        });
      }

      const resolved = resolveReportSpec(
        fields,
        {
          groupBy: input.groupBy,
          groupByGrain: input.groupByGrain,
          groupBy2: input.groupBy2,
          groupBy2Grain: input.groupBy2Grain,
          measure: input.measure,
        },
        targets,
      );
      if (!resolved.ok) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: `${resolved.message} on '${object.key}'`,
        });
      }
      const { groups, measureField } = resolved.value;
      const refPaths = resolveFilterRefPaths(fields, targets, input.filters);

      const sharedRecordIds =
        object.defaultVisibility === 'private' && !isAdminish(ctx.auth.role)
          ? await visibleSharedRecordIds(
              ctx.db,
              { orgId: ctx.auth.organizationId, userId: ctx.auth.userId, role: ctx.auth.role },
              object.id,
            )
          : [];
      const buckets = await aggregateRecords(ctx.db, {
        orgId: ctx.auth.organizationId,
        object,
        fields,
        groups,
        measure: { fn: input.measure.agg, field: measureField },
        having: input.having,
        filters: input.filters,
        refPaths,
        search: input.search,
        acl: {
          userId: ctx.auth.userId,
          sharedRecordIds,
          isAdminish: isAdminish(ctx.auth.role),
        },
        limit:
          input.limit !== undefined && groups.length < 2 ? Math.min(input.limit, 200) : input.limit,
      });

      // Reference buckets carry raw uuids (resolve to display names), picklist
      // buckets carry raw values (ship the hydrated options for label + color)
      // — once per grouping level, so the client never needs a second trip.
      const primary = await labelsForGroup(
        ctx,
        groups[0]?.field,
        buckets.map((b) => b.group),
      );
      const secondary = groups[1]
        ? await labelsForGroup(
            ctx,
            groups[1].field,
            buckets.map((b) => b.group2 ?? null),
          )
        : {};
      return {
        buckets,
        groupLabels: primary.labels,
        options: primary.options,
        group2Labels: secondary.labels,
        options2: secondary.options,
      };
    }),

  /** QuerySpec execution — the "almost raw SQL" declarative engine behind
   *  QueryBlock artifact nodes: multi-measure, expression measures, EXISTS
   *  sub-conditions, AND/OR trees. Resolution + compilation live in
   *  packages/db (query-compiler.ts); the caller's ACL is mandatory there.
   *  A local statement_timeout backstops runaway shapes. */
  query: protectedProcedure.input(QuerySpecSchema).query(async ({ ctx, input }) => {
    const { object, fields: rawFields } = await requireObject(ctx, input.objectKey);
    const fields = await hydratePicklistOptions(ctx.db, ctx.auth.organizationId, rawFields);
    const base = { object, fields };

    const targets = new Map<string, ObjectWithFields>();
    for (const key of collectQueryTargetKeys(base, input as QuerySpecLike)) {
      const t = await getObjectByKey(ctx.db, ctx.auth.organizationId, key);
      if (!t) continue;
      targets.set(key, {
        object: t.object,
        fields: await hydratePicklistOptions(ctx.db, ctx.auth.organizationId, t.fields),
      });
    }

    const resolved = resolveQuerySpec(base, targets, input as QuerySpecLike);
    if (!resolved.ok) {
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: `${resolved.message} on '${object.key}'`,
      });
    }

    const sharedRecordIds =
      object.defaultVisibility === 'private' && !isAdminish(ctx.auth.role)
        ? await visibleSharedRecordIds(
            ctx.db,
            { orgId: ctx.auth.organizationId, userId: ctx.auth.userId, role: ctx.auth.role },
            object.id,
          )
        : [];

    // protectedProcedure runs in a transaction — SET LOCAL scopes to it.
    await ctx.db.execute(sql`set local statement_timeout = '5000'`);
    const rows = await runQuery(ctx.db, ctx.auth.organizationId, resolved.plan, {
      userId: ctx.auth.userId,
      sharedRecordIds,
      isAdminish: isAdminish(ctx.auth.role),
    });

    const primary = await labelsForGroup(
      ctx,
      resolved.plan.groups[0]?.field,
      rows.map((r) => r.group),
    );
    const secondary = resolved.plan.groups[1]
      ? await labelsForGroup(
          ctx,
          resolved.plan.groups[1].field,
          rows.map((r) => r.group2 ?? null),
        )
      : {};
    return {
      rows,
      measures: resolved.plan.measures.map((m) => m.id),
      groupLabels: primary.labels,
      options: primary.options,
      group2Labels: secondary.labels,
      options2: secondary.options,
    };
  }),

  /** Records on other objects that reference this one — the Related panel. */
  related: protectedProcedure
    .input(z.object({ objectKey: z.string(), id: z.string() }))
    .query(async ({ ctx, input }) => {
      const groups = await listRelated(ctx.db, ctx.auth.organizationId, input.objectKey, input.id);
      const out = [];
      for (const g of groups) {
        const fields = await hydratePicklistOptions(ctx.db, ctx.auth.organizationId, g.fields);
        out.push({
          object: serializeObject(g.object),
          via: { key: g.via.key, label: g.via.label },
          fields: fields.map(serializeField),
          rows: g.rows.map((r) => ({
            id: r.id,
            data: r.data,
            name: displayName(g.fields, r.data),
            createdAt: r.createdAt,
          })),
        });
      }
      return out;
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
      const { object, fields: rawFields } = await requireObject(ctx, input.objectKey, {
        forWrite: true,
      });
      assertObjectPermission(ctx, object.id, 'create');
      if (input.recordTypeId) await assertRecordType(ctx, object, input.recordTypeId);
      const fields = await hydratePicklistOptions(ctx.db, ctx.auth.organizationId, rawFields);
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
      // Compute this record's own formulas/rollups in-transaction, then update
      // any parent whose rollups this new child feeds.
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
      const { object, fields: rawFields } = await requireObject(ctx, input.objectKey, {
        forWrite: true,
      });
      assertObjectPermission(ctx, object.id, 'update');
      if (input.recordTypeId) await assertRecordType(ctx, object, input.recordTypeId);
      const fields = await hydratePicklistOptions(ctx.db, ctx.auth.organizationId, rawFields);
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
      // Recompute this record, then refresh parent rollups for BOTH the old and
      // new reference targets (a child re-parented to a different record must
      // update both the old and new parent's rollup).
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
      // Only keys whose value actually differs from the stored record count as
      // changed — a no-op PATCH shouldn't log a misleading field list.
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
      return row ? { ...row, data: { ...row.data, ...computed } } : row;
    }),

  remove: protectedProcedure
    .input(z.object({ objectKey: z.string(), id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const { object, fields } = await requireObject(ctx, input.objectKey, { forWrite: true });
      assertObjectPermission(ctx, object.id, 'delete');
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
      assertObjectPermission(ctx, object.id, 'update');
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
      const { object, fields } = await requireObject(ctx, input.objectKey);
      assertObjectPermission(ctx, object.id, 'update');
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

  /** Re-evaluate every formula + rollup field on a record (topologically
   *  ordered, with cross-object resolution) and persist the new values.
   *  Triggered by the field-editor "Recalculate now" button; safe to call any
   *  time. Same-record writes already recompute automatically. */
  recompute: protectedProcedure
    .input(z.object({ objectKey: z.string(), id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const { object, fields } = await requireObject(ctx, input.objectKey);
      assertObjectPermission(ctx, object.id, 'update');
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
      // Same visibility rules as `list` — the typeahead must not surface
      // private-object records the caller has no share for.
      const sharedRecordIds =
        object.defaultVisibility === 'private' && !isAdminish(ctx.auth.role)
          ? await visibleSharedRecordIds(
              ctx.db,
              { orgId: ctx.auth.organizationId, userId: ctx.auth.userId, role: ctx.auth.role },
              object.id,
            )
          : [];
      const rows = await listRecords(ctx.db, {
        orgId: ctx.auth.organizationId,
        object,
        fields,
        search: input.q,
        limit: input.limit ?? 20,
        acl: {
          userId: ctx.auth.userId,
          sharedRecordIds,
          isAdminish: isAdminish(ctx.auth.role),
        },
      });
      return rows.map((r) => ({ value: r.id, label: displayName(fields, r.data) }));
    }),
});
