// Phase 6 of the migration: import Salesforce reports + dashboards as native
// Northbeam `view` rows. Best-effort by design — this phase runs inside its
// own try/catch in executeRun (a reporting failure must never fail the record
// import), and every report describe is individually guarded (folder sharing
// makes per-report 403s routine, verified against a real org).
//
// Inserted rows bypass the tRPC view router, so the SAME validation it applies
// (resolveReportSpec from trpc/report-config.ts) runs here before insert:
// invalid filters are dropped, invalid measures degrade to count, an invalid
// groupBy skips the report.

import {
  type DbExecutor,
  type FieldRow,
  type Filter,
  type ReportConfig,
  getObjectByKey,
  schema,
  writeAuditEvent,
} from '@northbeam/db';
import type { SalesforceClient } from '@northbeam/salesforce';
import { resolveReportSpec } from '../trpc/report-config.js';
import type { MappedObject, ProposedField } from './mapper.js';
import {
  type ObjectResolution,
  type TranslatedReport,
  buildResolution,
  translateDashboard,
  translateReport,
} from './report-mapper.js';

// Working-slice caps, same philosophy as MAX_RECORDS_PER_OBJECT: each describe
// is one API round trip, so these bound the phase to seconds.
export const REPORT_IMPORT_CAP = 50;
export const DASHBOARD_IMPORT_CAP = 20;
const MAX_SKIP_NOTES = 25;

type Plan = { obj: MappedObject; fields: ProposedField[] };
type Stats = NonNullable<typeof schema.migrationRun.$inferSelect.stats>;
type RunFn = <T>(fn: (tx: DbExecutor) => Promise<T>) => Promise<T>;

export async function importAnalyticsViews(opts: {
  run: RunFn;
  client: SalesforceClient;
  orgId: string;
  plans: Plan[];
  stats: Stats;
  writeStats: () => Promise<void>;
}): Promise<void> {
  const { run, client, orgId, plans, stats } = opts;

  const resolutions = new Map<string, ObjectResolution>();
  for (const plan of plans) {
    const res = buildResolution({
      obj: {
        sfObject: plan.obj.sfObject,
        targetKey: plan.obj.targetKey,
        nameFieldSf: plan.obj.nameFieldSf,
      },
      fields: plan.fields,
    });
    resolutions.set(res.sfObject, res);
  }

  const skipped: Array<{ label: string; reason: string }> = [];
  const noteSkip = (label: string, reason: string) => {
    stats.viewsSkipped = (stats.viewsSkipped ?? 0) + 1;
    if (skipped.length < MAX_SKIP_NOTES) skipped.push({ label, reason });
  };

  // Live field lists per target object — the ground truth inserts validate
  // against (memoized; the import just created/loaded these objects).
  const objectCache = new Map<string, { id: string; key: string; fields: FieldRow[] } | null>();
  const loadObject = async (targetKey: string) => {
    if (!objectCache.has(targetKey)) {
      const loaded = await run((tx) => getObjectByKey(tx, orgId, targetKey));
      objectCache.set(
        targetKey,
        loaded ? { id: loaded.object.id, key: targetKey, fields: loaded.fields } : null,
      );
    }
    return objectCache.get(targetKey) ?? null;
  };

  // Translate one report by SF id (memoized — dashboards re-reference reports).
  const reportCache = new Map<string, TranslatedReport>();
  const describeAndTranslate = async (sfId: string, label: string): Promise<TranslatedReport> => {
    const cached = reportCache.get(sfId);
    if (cached) return cached;
    let result: TranslatedReport;
    try {
      const describe = await client.getReportDescribe(sfId);
      result = translateReport(describe, resolutions);
      if (result.ok) result = await sanitizeReport(result);
    } catch (err) {
      // Per-report failures (403 on folder sharing, deleted reports) are routine.
      result = { ok: false, sfId, label, reason: trimError(err) };
    }
    reportCache.set(sfId, result);
    return result;
  };

  /** Enforce the same rules the tRPC view router would: drop unknown filter /
   *  column keys, degrade an invalid measure to count, fail on a bad groupBy. */
  const sanitizeReport = async (
    t: Extract<TranslatedReport, { ok: true }>,
  ): Promise<TranslatedReport> => {
    const obj = await loadObject(t.targetObjectKey);
    if (!obj) return { ok: false, sfId: t.sfId, label: t.label, reason: 'target object missing' };
    const byKey = new Map(obj.fields.map((f) => [f.key, f]));
    const filters: Filter[] = t.filters.filter((f) => byKey.has(f.fieldKey));
    if (filters.length < t.filters.length) {
      t.notes.push(`${t.filters.length - filters.length} filter(s) dropped — field not imported`);
    }
    const columns = t.columns.filter((c) => byKey.has(c));
    if (t.viewType === 'list') return { ...t, filters, columns };

    let config = t.config as ReportConfig;
    let spec = resolveReportSpec(obj.fields, config);
    if (!spec.ok && config.measure.agg !== 'count') {
      config = { ...config, measure: { agg: 'count' } };
      spec = resolveReportSpec(obj.fields, config);
      if (spec.ok) t.notes.push('measure degraded to count — field not imported as numeric');
    }
    if (!spec.ok) {
      return { ok: false, sfId: t.sfId, label: t.label, reason: spec.message };
    }
    return { ...t, config, filters, columns };
  };

  const insertView = async (view: {
    targetObjectKey: string;
    key: string;
    label: string;
    type: 'report' | 'list' | 'dashboard';
    icon: string;
    config: unknown;
    filters: Filter[];
    columns: string[];
  }): Promise<boolean> => {
    const obj = await loadObject(view.targetObjectKey);
    if (!obj) return false;
    const inserted = await run((tx) =>
      tx
        .insert(schema.view)
        .values({
          organizationId: orgId,
          objectId: obj.id,
          key: view.key,
          label: view.label,
          type: view.type,
          icon: view.icon as (typeof schema.view.$inferInsert)['icon'],
          config: view.config ?? {},
          filters: view.filters,
          sort: [],
          columns: view.columns,
          sharedWith: [{ kind: 'org' as const }],
          ownerId: null,
          isDefault: false,
        })
        // (org, object, key) unique index → re-running a migration is
        // idempotent; a conflict means "already imported".
        .onConflictDoNothing()
        .returning({ id: schema.view.id }),
    );
    const row = inserted[0];
    if (row) {
      await run((tx) =>
        writeAuditEvent(tx, {
          organizationId: orgId,
          userId: null,
          action: 'view.created',
          targetType: 'view',
          targetId: row.id,
          meta: { label: view.label, type: view.type, source: 'salesforce' },
        }),
      );
    }
    return Boolean(row);
  };

  // ── Reports ─────────────────────────────────────────────────────────────
  const reports = await client.listReports(REPORT_IMPORT_CAP);
  stats.reportsFound = reports.length;
  stats.reportsImported = 0;
  await opts.writeStats();

  for (const r of reports) {
    if ((r.Format ?? '').toLowerCase() === 'multiblock') {
      noteSkip(r.Name, 'joined (multi-block) reports are not supported');
      continue;
    }
    const t = await describeAndTranslate(r.Id, r.Name);
    if (!t.ok) {
      noteSkip(t.label, t.reason);
      continue;
    }
    const created = await insertView({ ...t, type: t.viewType });
    if (created) stats.reportsImported = (stats.reportsImported ?? 0) + 1;
  }
  await opts.writeStats();

  // ── Dashboards ──────────────────────────────────────────────────────────
  const dashboards = await client.listDashboards(DASHBOARD_IMPORT_CAP);
  stats.dashboardsFound = dashboards.length;
  stats.dashboardsImported = 0;

  for (const d of dashboards) {
    let translated: ReturnType<typeof translateDashboard>;
    try {
      const describe = await client.getDashboardDescribe(d.Id);
      // Source reports beyond the report cap are described on demand (memoized).
      for (const c of describe.components ?? []) {
        if (c.reportId) await describeAndTranslate(c.reportId, c.header ?? c.reportId);
      }
      translated = translateDashboard(describe, reportCache);
    } catch (err) {
      noteSkip(d.Title, trimError(err));
      continue;
    }
    if (!translated.ok) {
      noteSkip(translated.label, translated.reason);
      continue;
    }
    const created = await insertView({
      targetObjectKey: translated.targetObjectKey,
      key: translated.key,
      label: translated.label,
      type: 'dashboard',
      icon: 'chart',
      config: { artifact: translated.artifact, source: 'salesforce' },
      filters: [],
      columns: [],
    });
    if (created) stats.dashboardsImported = (stats.dashboardsImported ?? 0) + 1;
  }

  if (skipped.length) stats.skippedViews = skipped;
  await opts.writeStats();
}

function trimError(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err);
  return msg.length > 200 ? `${msg.slice(0, 200)}…` : msg;
}
