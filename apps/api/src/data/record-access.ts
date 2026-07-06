// Authorized record data access — the single sanctioned path to read or write
// record data. Enforcement (per-object CRUD grant + per-record share ACL) lives
// HERE, once, instead of being re-derived by every caller. Routers hold a
// per-request instance on `ctx.records` and never touch the raw dynamic-record
// helpers or `canObject` directly, so a read/write can't skip its gate.
//
// Two axes, both applied automatically:
//   - Object CRUD: `canObject(actor.permissions, objectId, action)` — the
//     custom-role grid. `recordAdmin` (grant-based: can-delete ⇒ sees-all) is
//     derived per object, so admin-equivalent custom roles aren't under-exposed.
//   - Record visibility: private-object rows are filtered to owner + shares
//     unless the caller is recordAdmin. The share ACL is folded into SQL by the
//     db helpers; this class just supplies it.
//
// Org isolation is handled below this layer by RLS (the `app.org_id` GUC set by
// protectedProcedure) and is not this class's concern.

import { type AuthContext, type ObjectAction, canObject, objectFilter } from '@northbeam/core';
import {
  type DbExecutor,
  type FieldRow,
  type ObjectRow,
  type ObjectWithFields,
  type PicklistOption,
  type QuerySpecLike,
  type RecordRow,
  aggregateRecords,
  buildFilterPredicates,
  canEditRecord,
  collectQueryTargetKeys,
  countRecords,
  getObjectByKey,
  getRecord,
  hydratePicklistOptions,
  labelsForIds,
  listRecords,
  listRelated,
  narrowFieldConfig,
  resolveQuerySpec,
  runQuery,
  sumField,
  visibleSharedRecordIds,
} from '@northbeam/db';
import type {
  DateGrain,
  Filter,
  FilterEntry,
  ReportAgg,
  ReportHaving,
  ViewSort,
} from '@northbeam/db';
import { TRPCError } from '@trpc/server';
import { type SQL, sql } from 'drizzle-orm';
import {
  collectRefTargetKeys,
  resolveFilterRefPaths,
  resolveReportSpec,
} from '../trpc/report-config.js';

/** Resolve the `@me` token in a permission filter to the caller's user id, so a
 *  criteria like "assigned_to = @me" scopes to the current user. Handles leaves
 *  and one level of `{ any: [...] }` groups. */
function resolveMeTokens(filter: FilterEntry[], userId: string): FilterEntry[] {
  const leaf = (f: Filter): Filter => (f.value === '@me' ? { ...f, value: userId } : f);
  return filter.map((entry) => ('any' in entry ? { any: entry.any.map(leaf) } : leaf(entry)));
}

/** An object the caller is authorized to read, with hydrated fields and the
 *  grant-derived `recordAdmin` flag. Only produced by RecordAccess, so holding
 *  one is proof the read gate passed. */
export type AuthedObject = {
  object: ObjectRow;
  fields: FieldRow[];
  /** True when the caller sees/edits every record of this object (grant-based:
   *  can-delete ⇒ full control), bypassing the private-record share filter. */
  recordAdmin: boolean;
};

type ListAcl = {
  userId: string;
  sharedRecordIds: string[];
  isAdminish: boolean;
  criteria: SQL | null;
};

export type AggregateSpec = {
  groupBy?: string | null;
  groupByGrain?: DateGrain;
  groupBy2?: string | null;
  groupBy2Grain?: DateGrain;
  measure: { agg: ReportAgg; fieldKey?: string };
  having?: ReportHaving;
  filters?: FilterEntry[];
  search?: string;
  limit?: number;
};

export class RecordAccess {
  constructor(
    private readonly db: DbExecutor,
    private readonly actor: AuthContext,
  ) {}

  private get orgId() {
    return this.actor.organizationId;
  }

  private forbid(action: ObjectAction, key: string): never {
    throw new TRPCError({
      code: 'FORBIDDEN',
      message: `your role cannot ${action} records of '${key}'`,
    });
  }

  /** Grant-based "controls every record of this object". Delete implies full
   *  control, so a role that can delete an object's records also sees them all. */
  private recordAdminFor(objectId: string): boolean {
    return canObject(this.actor.permissions, objectId, 'delete');
  }

  /** Resolve + hydrate an object and enforce the per-object `action` gate.
   *  Throws NOT_FOUND for unknown objects, FORBIDDEN when the grant is missing,
   *  and (for writes) FORBIDDEN for archived objects. */
  async require(
    objectKey: string,
    opts?: { action?: ObjectAction; forWrite?: boolean },
  ): Promise<AuthedObject> {
    const action = opts?.action ?? 'read';
    const res = await getObjectByKey(this.db, this.orgId, objectKey);
    if (!res) {
      throw new TRPCError({ code: 'NOT_FOUND', message: `object '${objectKey}' not found` });
    }
    if (opts?.forWrite && res.object.archivedAt) {
      throw new TRPCError({ code: 'FORBIDDEN', message: `object '${objectKey}' is archived` });
    }
    if (!canObject(this.actor.permissions, res.object.id, action)) this.forbid(action, objectKey);
    const fields = await hydratePicklistOptions(this.db, this.orgId, res.fields);
    return { object: res.object, fields, recordAdmin: this.recordAdminFor(res.object.id) };
  }

  /** Like `require('read')` but returns null instead of throwing when the
   *  object is missing OR unreadable — for dashboards/home that aggregate over
   *  many objects and simply skip the ones the caller can't see. */
  async readable(objectKey: string): Promise<AuthedObject | null> {
    const res = await getObjectByKey(this.db, this.orgId, objectKey);
    if (!res) return null;
    if (!canObject(this.actor.permissions, res.object.id, 'read')) return null;
    const fields = await hydratePicklistOptions(this.db, this.orgId, res.fields);
    return { object: res.object, fields, recordAdmin: this.recordAdminFor(res.object.id) };
  }

  /** Compile the role's row-level criteria for an object into a SQL predicate,
   *  or null when the role is unscoped there. `@me` resolves to the caller.
   *  The referenced fields are auto-indexed when the criteria is saved, so this
   *  predicate uses an index rather than a seq scan. */
  private compileCriteria(objectId: string, fields: FieldRow[]): SQL | null {
    const filter = objectFilter(this.actor.permissions, objectId);
    if (!filter || filter.length === 0) return null;
    const resolved = resolveMeTokens(filter, this.actor.userId);
    const preds = buildFilterPredicates(fields, resolved);
    return preds.length ? sql`(${sql.join(preds, sql` and `)})` : null;
  }

  private async listAcl(a: AuthedObject): Promise<ListAcl> {
    const sharedRecordIds =
      a.object.defaultVisibility === 'private' && !a.recordAdmin
        ? await visibleSharedRecordIds(
            this.db,
            { orgId: this.orgId, userId: this.actor.userId, role: this.actor.role },
            a.object.id,
          )
        : [];
    return {
      userId: this.actor.userId,
      sharedRecordIds,
      isAdminish: a.recordAdmin,
      criteria: this.compileCriteria(a.object.id, a.fields),
    };
  }

  // ── Reads (throw on not-readable) ─────────────────────────────────────────

  async list(
    objectKey: string,
    opts: {
      search?: string;
      filters?: FilterEntry[];
      sort?: ViewSort[];
      limit?: number;
      offset?: number;
    },
  ): Promise<{ authed: AuthedObject; rows: RecordRow[] }> {
    const authed = await this.require(objectKey);
    const rows = await listRecords(this.db, {
      orgId: this.orgId,
      object: authed.object,
      fields: authed.fields,
      search: opts.search,
      filters: opts.filters,
      sort: opts.sort,
      limit: opts.limit,
      offset: opts.offset,
      acl: await this.listAcl(authed),
    });
    return { authed, rows };
  }

  async get(
    objectKey: string,
    id: string,
  ): Promise<{ authed: AuthedObject; row: RecordRow | null }> {
    const authed = await this.require(objectKey);
    let hasShare = false;
    if (authed.object.defaultVisibility === 'private' && !authed.recordAdmin) {
      const shares = await visibleSharedRecordIds(
        this.db,
        { orgId: this.orgId, userId: this.actor.userId, role: this.actor.role },
        authed.object.id,
      );
      hasShare = shares.includes(id);
    }
    const row = await getRecord(this.db, {
      orgId: this.orgId,
      object: authed.object,
      fields: authed.fields,
      id,
      acl: { userId: this.actor.userId, isAdminish: authed.recordAdmin, hasShare },
      criteria: this.compileCriteria(authed.object.id, authed.fields),
    });
    return { authed, row };
  }

  /** Related records on other objects — gates the base READ and drops child
   *  groups the caller can't read, then filters private-child rows to visible
   *  ones. (The prior direct `listRelated` call skipped both.) */
  async related(objectKey: string, id: string) {
    const base = await this.require(objectKey);
    // rowPredicate applies the read gate (drop group) + row-criteria (in SQL)
    // per child object; the private-share ACL is applied in-app below (it needs
    // an async share lookup the sync predicate can't do).
    const groups = await listRelated(this.db, this.orgId, base.object.key, id, {
      rowPredicate: (object, fields) =>
        canObject(this.actor.permissions, object.id, 'read')
          ? this.compileCriteria(object.id, fields)
          : false,
    });
    const out: Array<{
      object: ObjectRow;
      via: { key: string; label: string };
      fields: FieldRow[];
      rows: RecordRow[];
    }> = [];
    for (const g of groups) {
      const recordAdmin = this.recordAdminFor(g.object.id);
      let rows = g.rows;
      // Filter private child rows the caller can't see (owner/shared only).
      if (g.object.defaultVisibility === 'private' && !recordAdmin) {
        const shared = new Set(
          await visibleSharedRecordIds(
            this.db,
            { orgId: this.orgId, userId: this.actor.userId, role: this.actor.role },
            g.object.id,
          ),
        );
        rows = rows.filter((r) => r.ownerId === this.actor.userId || shared.has(r.id));
      }
      out.push({
        object: g.object,
        via: g.via,
        fields: await hydratePicklistOptions(this.db, this.orgId, g.fields),
        rows,
      });
    }
    return out;
  }

  async searchRefs(
    objectKey: string,
    q: string | undefined,
    limit: number,
  ): Promise<{ authed: AuthedObject; rows: RecordRow[] }> {
    const authed = await this.require(objectKey);
    const rows = await listRecords(this.db, {
      orgId: this.orgId,
      object: authed.object,
      fields: authed.fields,
      search: q,
      limit,
      acl: await this.listAcl(authed),
    });
    return { authed, rows };
  }

  /** Resolve + hydrate + READ-gate every object a QuerySpec/report references
   *  by dot-path or EXISTS. This is what the open-coded aggregate/query paths
   *  forgot — a caller can now only group/filter across objects they can read. */
  private async authorizeTargets(keys: Iterable<string>): Promise<Map<string, ObjectWithFields>> {
    const targets = new Map<string, ObjectWithFields>();
    for (const key of keys) {
      // `require` throws FORBIDDEN if the join target isn't readable.
      const t = await this.require(key);
      targets.set(key, { object: t.object, fields: t.fields });
    }
    return targets;
  }

  async aggregate(objectKey: string, spec: AggregateSpec) {
    const base = await this.require(objectKey);
    const filters = spec.filters ?? [];
    const targetKeys = collectRefTargetKeys(base.fields, [spec.groupBy, spec.groupBy2], filters);
    const targets = await this.authorizeTargets(targetKeys);

    const resolved = resolveReportSpec(
      base.fields,
      {
        groupBy: spec.groupBy,
        groupByGrain: spec.groupByGrain,
        groupBy2: spec.groupBy2,
        groupBy2Grain: spec.groupBy2Grain,
        measure: spec.measure,
      },
      targets,
    );
    if (!resolved.ok) {
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: `${resolved.message} on '${objectKey}'`,
      });
    }
    const { groups, measureField } = resolved.value;
    const refPaths = resolveFilterRefPaths(base.fields, targets, filters);
    const buckets = await aggregateRecords(this.db, {
      orgId: this.orgId,
      object: base.object,
      fields: base.fields,
      groups,
      measure: { fn: spec.measure.agg, field: measureField },
      having: spec.having,
      filters,
      refPaths,
      search: spec.search,
      acl: await this.listAcl(base),
      limit: spec.limit !== undefined && groups.length < 2 ? Math.min(spec.limit, 200) : spec.limit,
    });
    const primary = await this.labelsForGroup(
      groups[0]?.field,
      buckets.map((b) => b.group),
    );
    const secondary = groups[1]
      ? await this.labelsForGroup(
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
  }

  async query(objectKey: string, spec: QuerySpecLike) {
    const base = await this.require(objectKey);
    const b = { object: base.object, fields: base.fields };
    const targets = await this.authorizeTargets(collectQueryTargetKeys(b, spec));
    const resolved = resolveQuerySpec(b, targets, spec);
    if (!resolved.ok) {
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: `${resolved.message} on '${objectKey}'`,
      });
    }
    // protectedProcedure runs in a transaction — SET LOCAL scopes to it.
    await this.db.execute(sql`set local statement_timeout = '5000'`);
    const rows = await runQuery(this.db, this.orgId, resolved.plan, await this.listAcl(base));
    const primary = await this.labelsForGroup(
      resolved.plan.groups[0]?.field,
      rows.map((r) => r.group),
    );
    const secondary = resolved.plan.groups[1]
      ? await this.labelsForGroup(
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
  }

  private async labelsForGroup(
    field: FieldRow | undefined,
    values: Array<string | number | boolean | null>,
  ): Promise<{ labels?: Record<string, string>; options?: PicklistOption[] }> {
    if (!field) return {};
    if (field.type === 'reference') {
      const target = narrowFieldConfig('reference', field.config).targetObject;
      const ids = values.filter((g): g is string => typeof g === 'string' && g.length > 0);
      return { labels: target ? await labelsForIds(this.db, this.orgId, target, ids) : {} };
    }
    if (field.type === 'picklist') {
      return { options: narrowFieldConfig('picklist', field.config).options ?? [] };
    }
    if (field.type === 'multipicklist') {
      return { options: narrowFieldConfig('multipicklist', field.config).options ?? [] };
    }
    return {};
  }

  // ── Dashboard reads on a pre-authorized object (from readable()) ───────────

  async count(a: AuthedObject, opts?: { filters?: FilterEntry[] }): Promise<number> {
    if (opts?.filters?.length) {
      // Filtered counts reuse the list path (aclPredicate + filter predicates).
      const rows = await listRecords(this.db, {
        orgId: this.orgId,
        object: a.object,
        fields: a.fields,
        filters: opts.filters,
        limit: 1_000_000,
        acl: await this.listAcl(a),
      });
      return rows.length;
    }
    return countRecords(this.db, {
      orgId: this.orgId,
      object: a.object,
      acl: await this.listAcl(a),
    });
  }

  async sum(
    a: AuthedObject,
    fieldKey: string,
    opts?: { whereFieldKey?: string; whereIn?: string[] },
  ): Promise<number> {
    const field = a.fields.find((f) => f.key === fieldKey);
    if (!field) return 0;
    const whereField = opts?.whereFieldKey
      ? a.fields.find((f) => f.key === opts.whereFieldKey)
      : undefined;
    return sumField(this.db, {
      orgId: this.orgId,
      object: a.object,
      field,
      whereField,
      whereIn: opts?.whereIn,
      acl: await this.listAcl(a),
    });
  }

  async listRows(
    a: AuthedObject,
    opts: { search?: string; filters?: FilterEntry[]; sort?: ViewSort[]; limit?: number },
  ): Promise<RecordRow[]> {
    return listRecords(this.db, {
      orgId: this.orgId,
      object: a.object,
      fields: a.fields,
      search: opts.search,
      filters: opts.filters,
      sort: opts.sort,
      limit: opts.limit,
      acl: await this.listAcl(a),
    });
  }

  // ── Write authorization ───────────────────────────────────────────────────

  /** Gate a create/update/delete: resolves the object (not archived), enforces
   *  the CRUD grant, and for update/delete loads the row + enforces the private
   *  record edit ACL. Returns everything the caller needs to perform the write;
   *  the mutation + validation + recompute stay in the router. */
  async authorizeWrite(
    objectKey: string,
    action: 'create' | 'update' | 'delete',
    recordId?: string,
  ): Promise<{ authed: AuthedObject; existing: RecordRow | null }> {
    const authed = await this.require(objectKey, { action, forWrite: true });
    if (action === 'create' || !recordId) return { authed, existing: null };
    // Load through the role's row-criteria: a record outside the role's scope
    // reads as not-found, so update/delete on it is blocked.
    const existing = await getRecord(this.db, {
      orgId: this.orgId,
      object: authed.object,
      fields: authed.fields,
      id: recordId,
      criteria: this.compileCriteria(authed.object.id, authed.fields),
    });
    if (!existing) throw new TRPCError({ code: 'NOT_FOUND' });
    if (authed.object.defaultVisibility === 'private') {
      const ok = await canEditRecord(
        this.db,
        {
          orgId: this.orgId,
          userId: this.actor.userId,
          role: this.actor.role,
          recordAdmin: authed.recordAdmin,
        },
        authed.object.id,
        recordId,
        existing.ownerId,
      );
      if (!ok) {
        throw new TRPCError({ code: 'FORBIDDEN', message: `no ${action} access to this record` });
      }
    }
    return { authed, existing };
  }

  /** Sharing is stricter than editing: only the record owner or a recordAdmin
   *  may (un)share. Gates 'update' on the object, then this ownership check. */
  async authorizeShare(
    objectKey: string,
    recordId: string,
  ): Promise<{ authed: AuthedObject; existing: RecordRow }> {
    const authed = await this.require(objectKey, { action: 'update' });
    const existing = await getRecord(this.db, {
      orgId: this.orgId,
      object: authed.object,
      fields: authed.fields,
      id: recordId,
      criteria: this.compileCriteria(authed.object.id, authed.fields),
    });
    if (!existing) throw new TRPCError({ code: 'NOT_FOUND' });
    if (!authed.recordAdmin && existing.ownerId !== this.actor.userId) {
      throw new TRPCError({
        code: 'FORBIDDEN',
        message: 'only the owner or an admin can share this record',
      });
    }
    return { authed, existing };
  }
}

export function createRecordAccess(db: DbExecutor, actor: AuthContext): RecordAccess {
  return new RecordAccess(db, actor);
}
