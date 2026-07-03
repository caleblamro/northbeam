// Report/dashboard translator: Salesforce Analytics describe payloads →
// Northbeam `view` rows (report/list configs + dashboard artifact trees).
// Pure — no DB, no network — so it's unit-testable and dry-runnable against
// `sf api request rest` JSON (see scripts/sf-dry-run-report.ts).
//
// Shapes verified against a real v62 org (fixture, 2026-07):
// - sobject `Report.Format` is 'Tabular'|'Summary'|'Matrix'; describe's
//   `reportMetadata.reportFormat` is the UPPERCASE 'TABULAR'|'SUMMARY'|'MATRIX'.
// - Column tokens come in two dialects: standard-report constants
//   ('STAGE_NAME', 'OPPORTUNITY_NAME') and dotted API paths
//   ('Property__c.Monthly_Rent__c', 'FlowInterviewLog.CreatedBy.Name').
// - `aggregates` use prefixes: RowCount, s! (sum), a! (avg), m! (min),
//   x! (max). mn!/mx! are accepted too — orgs drift.
// - `chart.chartType` is a human-readable string ('Horizontal Bar Stacked'),
//   so chart mapping is keyword-based.
// - Dashboard describe: `components[]` (properties often null on flex
//   dashboards — fall back to the source report's chart) aligned BY INDEX
//   with `layout.components[]`, whose colspan is out of the same 12-column
//   grid Northbeam artifacts use.

import { type Artifact, ArtifactSchema } from '@northbeam/core';
import {
  type DateGrain,
  type Filter,
  type FilterOp,
  NUMERIC_TYPES,
  type ReportConfig,
  type ViewIcon,
} from '@northbeam/db';
import type { FieldType } from '@northbeam/db';
import type {
  DashboardDescribeResult,
  ReportDescribeResult,
  ReportMetadata,
} from '@northbeam/salesforce';
import { sfToKey } from './mapper.js';

/* ── Field/object resolution ─────────────────────────────────────────────── */

/** How one imported object resolves report tokens to Northbeam field keys. */
export type ObjectResolution = {
  sfObject: string; // 'Opportunity'
  targetKey: string; // 'deal'
  nameFieldSf: string | null;
  /** normalized SF field token → { northbeam key, field type }. Mapped fields only. */
  fieldsByToken: Map<string, { key: string; type: FieldType }>;
};

/** The token appears in two dialects ('STAGE_NAME' vs 'StageName') — collapse
 *  both to lowercase alphanumerics so they collide. */
export function normalizeToken(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, '');
}

type ResolutionPlan = {
  obj: { sfObject: string; targetKey: string; nameFieldSf: string | null };
  fields: Array<{ sfField: string; key: string; type: FieldType; status: string }>;
};

export function buildResolution(plan: ResolutionPlan): ObjectResolution {
  const fieldsByToken = new Map<string, { key: string; type: FieldType }>();
  for (const f of plan.fields) {
    if (f.status !== 'mapped') continue;
    fieldsByToken.set(normalizeToken(f.sfField), { key: f.key, type: f.type });
  }
  return {
    sfObject: plan.obj.sfObject,
    targetKey: plan.obj.targetKey,
    nameFieldSf: plan.obj.nameFieldSf,
    fieldsByToken,
  };
}

/** Sentinel key for the denormalized system `name` column: valid in a list
 *  view's columns (where it renders implicitly), never in groupBy/measure/
 *  filters (it isn't a FieldRow). */
export const NAME_SENTINEL = 'name';

type ResolvedToken = { key: string; type: FieldType } | { key: typeof NAME_SENTINEL } | null;

/** Resolve one report column token against the report's base object.
 *  'STAGE_NAME' → stage; 'Property__c.Monthly_Rent__c' → monthly_rent;
 *  'OPPORTUNITY_NAME' / the object's name field → the 'name' sentinel;
 *  relationship paths ('X.CreatedBy.Name') and foreign prefixes → null. */
export function resolveToken(res: ObjectResolution, token: string): ResolvedToken {
  const segments = token.split('.');
  const objNorm = normalizeToken(res.sfObject.replace(/__c$/i, ''));

  let fieldToken: string | null = null;
  if (segments.length === 1) {
    fieldToken = normalizeToken(segments[0] as string);
    // Standard-report constants often bake the object name in ('OPPORTUNITY_NAME').
    if (!res.fieldsByToken.has(fieldToken) && fieldToken.startsWith(objNorm)) {
      fieldToken = fieldToken.slice(objNorm.length);
    }
  } else if (segments.length === 2) {
    // 'Object.Field' — only same-object tokens resolve; a foreign prefix means
    // a cross-object column, which a single-object view can't represent.
    const prefix = normalizeToken((segments[0] as string).replace(/__c$/i, ''));
    if (prefix !== objNorm) return null;
    fieldToken = normalizeToken(segments[1] as string);
  } else {
    return null; // relationship path (e.g. 'X.CreatedBy.Name')
  }
  if (!fieldToken) return null;

  const nameNorm = res.nameFieldSf ? normalizeToken(res.nameFieldSf) : null;
  if (fieldToken === nameNorm || fieldToken === 'name') return { key: NAME_SENTINEL };
  return res.fieldsByToken.get(fieldToken) ?? null;
}

/* ── Report-type → base object ───────────────────────────────────────────── */

/** Standard report types whose base SObject isn't spelled out in the name. */
const REPORT_TYPE_TO_SOBJECT: Record<string, string> = {
  AccountList: 'Account',
  ContactAccount: 'Contact',
  Opportunity: 'Opportunity',
  OpportunityHistory: 'Opportunity',
  Activity: 'Task',
  TaskAndEvent: 'Task',
};

/** Candidate base SObject names for a report, most confident first: the
 *  standard report-type table, then the modal first segment of the dotted
 *  detail columns (custom report types don't name their base object). Also
 *  used standalone by scripts/sf-dry-run-report.ts to know what to describe. */
export function guessBaseSObjects(meta: ReportMetadata): string[] {
  const out: string[] = [];
  const typeName = meta.reportType?.type ?? '';
  out.push(REPORT_TYPE_TO_SOBJECT[typeName] ?? typeName);

  const counts = new Map<string, number>();
  for (const col of meta.detailColumns ?? []) {
    const seg = col.split('.')[0];
    if (seg && col.includes('.')) counts.set(seg, (counts.get(seg) ?? 0) + 1);
  }
  for (const [seg] of [...counts.entries()].sort((a, b) => b[1] - a[1])) out.push(seg);
  return [...new Set(out.filter(Boolean))];
}

function resolveBaseObject(
  meta: ReportMetadata,
  resolutions: Map<string, ObjectResolution>,
): ObjectResolution | null {
  for (const candidate of guessBaseSObjects(meta)) {
    const byName = resolutions.get(candidate);
    if (byName) return byName;
    const norm = normalizeToken(candidate.replace(/__c$/i, ''));
    for (const res of resolutions.values()) {
      if (normalizeToken(res.sfObject.replace(/__c$/i, '')) === norm) return res;
    }
  }
  return null;
}

/* ── Aggregates / grains / charts / filters — mapping tables ─────────────── */

const AGG_PREFIX: Record<string, ReportConfig['measure']['agg']> = {
  s: 'sum',
  a: 'avg',
  m: 'min',
  mn: 'min',
  x: 'max',
  mx: 'max',
};

const GRAIN_MAP: Record<string, DateGrain> = {
  Day: 'day',
  Week: 'week',
  Month: 'month',
  Quarter: 'quarter',
  Year: 'year',
  FiscalQuarter: 'quarter',
  FiscalYear: 'year',
  // Calendar-position groupings (month-of-year etc.) aren't representable;
  // the nearest chronological grain keeps the report meaningful.
  MonthInYear: 'month',
  DayInMonth: 'day',
  WeekInMonth: 'week',
  WeekInYear: 'week',
};

/** SF filter operator → Northbeam FilterOp. null = drop the filter (noted). */
const FILTER_OP_MAP: Record<string, FilterOp | null> = {
  equals: 'eq',
  notEqual: 'neq',
  contains: 'contains',
  notContain: null,
  startsWith: 'startsWith',
  greaterThan: 'gt',
  lessThan: 'lt',
  greaterOrEqual: 'gte',
  lessOrEqual: 'lte',
  includes: 'contains', // multipicklist membership — first value only
  excludes: null,
  within: null,
};

/** 'Horizontal Bar Stacked' / 'Donut' / 'Vertical Column Grouped' → chart
 *  vocabulary. Keyword-based because the API ships display strings. */
export function mapChartType(sfChart: string | null | undefined): {
  chartType: ReportConfig['chartType'] | null;
  stacked: boolean;
} {
  if (!sfChart) return { chartType: null, stacked: false };
  const s = sfChart.toLowerCase();
  const stacked = s.includes('stack');
  if (s.includes('bar') || s.includes('column')) return { chartType: 'bar', stacked };
  if (s.includes('line')) return { chartType: 'line', stacked: false };
  if (s.includes('donut') || s.includes('pie')) return { chartType: 'donut', stacked: false };
  if (s.includes('funnel')) return { chartType: 'funnel', stacked: false };
  if (s.includes('scatter')) return { chartType: 'scatter', stacked: false };
  if (s.includes('metric') || s.includes('gauge')) return { chartType: 'kpi', stacked: false };
  if (s.includes('table')) return { chartType: 'table', stacked: false };
  return { chartType: null, stacked };
}

/** View key from a report/dashboard developer name: KEY_RE-safe, ≤48 chars. */
export function viewKeyFrom(developerName: string): string {
  const key = sfToKey(developerName).slice(0, 48).replace(/_+$/, '');
  return key || 'imported_report';
}

/* ── Report translation ──────────────────────────────────────────────────── */

export type TranslatedReport =
  | {
      ok: true;
      sfId: string;
      targetObjectKey: string;
      key: string;
      label: string;
      icon: ViewIcon;
      viewType: 'report' | 'list';
      /** ReportConfig for 'report' views; {} for 'list' views. */
      config: ReportConfig | Record<string, never>;
      filters: Filter[];
      columns: string[];
      notes: string[];
    }
  | { ok: false; sfId: string; label: string; reason: string };

export function translateReport(
  describe: ReportDescribeResult,
  resolutions: Map<string, ObjectResolution>,
): TranslatedReport {
  const meta = describe.reportMetadata;
  const sfId = meta.id;
  const label = meta.name;
  const notes: string[] = [];

  const res = resolveBaseObject(meta, resolutions);
  if (!res) {
    return { ok: false, sfId, label, reason: 'base object was not part of this import' };
  }
  const format = (meta.reportFormat ?? '').toUpperCase();
  if (format === 'MULTI_BLOCK') {
    return { ok: false, sfId, label, reason: 'joined (multi-block) reports are not supported' };
  }

  // Filters — per-filter degradation, never whole-report failure.
  const filters: Filter[] = [];
  for (const f of meta.reportFilters ?? []) {
    const field = resolveToken(res, f.column);
    if (!field || field.key === NAME_SENTINEL || !('type' in field)) {
      notes.push(`filter on '${f.column}' dropped — column not imported`);
      continue;
    }
    const op = FILTER_OP_MAP[f.operator] ?? null;
    if (op === null) {
      notes.push(`filter '${f.operator}' on '${field.key}' has no equivalent — dropped`);
      continue;
    }
    filters.push(...convertFilter(field, op, f.value, notes));
  }
  if (
    meta.standardDateFilter?.column &&
    (meta.standardDateFilter.startDate || meta.standardDateFilter.endDate)
  ) {
    const sdf = meta.standardDateFilter;
    const field = resolveToken(res, sdf.column);
    if (field && field.key !== NAME_SENTINEL && 'type' in field) {
      if (sdf.startDate) filters.push({ fieldKey: field.key, op: 'after', value: sdf.startDate });
      if (sdf.endDate) filters.push({ fieldKey: field.key, op: 'before', value: sdf.endDate });
      notes.push(
        `date range '${sdf.durationValue ?? 'custom'}' snapshotted as ${sdf.startDate ?? '…'} – ${sdf.endDate ?? '…'}`,
      );
    }
  }
  if (meta.reportBooleanFilter && /\bOR\b|\bNOT\b/i.test(meta.reportBooleanFilter)) {
    notes.push(`custom filter logic '${meta.reportBooleanFilter}' flattened to AND`);
  }

  // Columns (list views + provenance) — resolved keys only; the system name
  // column renders implicitly, so the sentinel is dropped.
  const columns: string[] = [];
  for (const col of meta.detailColumns ?? []) {
    const field = resolveToken(res, col);
    if (!field) {
      notes.push(`column '${col}' dropped — not imported`);
      continue;
    }
    if (field.key !== NAME_SENTINEL) columns.push(field.key);
  }

  const key = viewKeyFrom(meta.developerName || meta.name);

  if (format === 'TABULAR') {
    // A tabular report is exactly a filtered column list — land it in the
    // object's view picker as a list view.
    return {
      ok: true,
      sfId,
      targetObjectKey: res.targetKey,
      key,
      label,
      icon: 'list',
      viewType: 'list',
      config: {},
      filters,
      columns,
      notes,
    };
  }

  // SUMMARY / MATRIX → report view.
  const groupings: Array<{ key: string; grain?: DateGrain }> = [];
  const down = meta.groupingsDown ?? [];
  const across = meta.groupingsAcross ?? [];
  const rawGroupings = format === 'MATRIX' ? [down[0], across[0]] : [down[0], down[1]];
  for (const g of rawGroupings) {
    if (!g) continue;
    const field = resolveToken(res, g.name);
    if (!field || field.key === NAME_SENTINEL || !('type' in field)) {
      notes.push(`grouping '${g.name}' dropped — column not imported`);
      continue;
    }
    const grain =
      field.type === 'date' || field.type === 'datetime'
        ? (GRAIN_MAP[g.dateGranularity ?? ''] ?? 'day')
        : undefined;
    groupings.push({ key: field.key, ...(grain ? { grain } : {}) });
  }
  if (groupings.length === 0 && rawGroupings.some(Boolean)) {
    return { ok: false, sfId, label, reason: 'no grouping survived translation' };
  }
  if (down.length + across.length > groupings.length + rawGroupings.filter((g) => !g).length) {
    const extra = down.length + across.length - rawGroupings.filter(Boolean).length;
    if (extra > 0) notes.push(`${extra} additional grouping level(s) beyond two dropped`);
  }

  // Measure: prefer the chart's first summary, else the first non-RowCount
  // aggregate that resolves to a numeric field; degrade to count.
  const candidates = [...(meta.chart?.summaries ?? []), ...(meta.aggregates ?? [])];
  let measure: ReportConfig['measure'] = { agg: 'count' };
  for (const agg of candidates) {
    if (!agg || agg === 'RowCount') continue;
    const m = /^([a-z]+)!(.+)$/i.exec(agg);
    const mappedAgg = m ? AGG_PREFIX[(m[1] as string).toLowerCase()] : undefined;
    if (!m || !mappedAgg) {
      notes.push(`aggregate '${agg}' has no equivalent — using count`);
      continue;
    }
    const field = resolveToken(res, m[2] as string);
    if (
      !field ||
      field.key === NAME_SENTINEL ||
      !('type' in field) ||
      !NUMERIC_TYPES.has(field.type)
    ) {
      notes.push(`aggregate '${agg}' skipped — measure column not imported as numeric`);
      continue;
    }
    measure = { agg: mappedAgg, fieldKey: field.key };
    break;
  }

  const { chartType: sfChart, stacked } = mapChartType(meta.chart?.chartType);
  let chartType: ReportConfig['chartType'];
  if (format === 'MATRIX' && groupings.length === 2) {
    chartType = 'matrix';
  } else if (sfChart) {
    chartType = sfChart;
  } else {
    chartType = groupings.length > 0 ? 'bar' : 'kpi';
  }

  const primary = groupings[0];
  const secondary = groupings[1];
  const config: ReportConfig = {
    groupBy: primary?.key ?? null,
    ...(primary?.grain ? { groupByGrain: primary.grain } : {}),
    ...(secondary ? { groupBy2: secondary.key } : {}),
    ...(secondary?.grain ? { groupBy2Grain: secondary.grain } : {}),
    measure,
    chartType,
    ...(stacked && secondary ? { stacked: true } : {}),
  };
  // A stacked SF chart without a second grouping is just a plain chart.
  if (stacked && !secondary) notes.push('stacked chart flattened — only one grouping imported');

  return {
    ok: true,
    sfId,
    targetObjectKey: res.targetKey,
    key,
    label,
    icon: 'chart',
    viewType: 'report',
    config,
    filters,
    columns,
    notes,
  };
}

/** SF filter → 0–n Northbeam filters, with checkbox/empty-value special cases. */
function convertFilter(
  field: { key: string; type: FieldType },
  op: FilterOp,
  rawValue: string,
  notes: string[],
): Filter[] {
  let value = rawValue ?? '';
  if (field.type === 'checkbox' && (op === 'eq' || op === 'neq')) {
    const truthy = value === '1' || value.toLowerCase() === 'true';
    const wantTrue = op === 'eq' ? truthy : !truthy;
    return [{ fieldKey: field.key, op: wantTrue ? 'isTrue' : 'isFalse' }];
  }
  if (value === '') {
    if (op === 'eq') return [{ fieldKey: field.key, op: 'isEmpty' }];
    if (op === 'neq') return [{ fieldKey: field.key, op: 'isSet' }];
  }
  if (value.includes(',') && (op === 'eq' || op === 'contains')) {
    // Comma-separated SF filter values are OR-ed; NB filters are AND-only.
    value = value.split(',')[0]?.trim() ?? value;
    notes.push(`multi-value filter on '${field.key}' narrowed to '${value}'`);
  }
  if ((field.type === 'date' || field.type === 'datetime') && (op === 'gt' || op === 'lt')) {
    return [{ fieldKey: field.key, op: op === 'gt' ? 'after' : 'before', value }];
  }
  return [{ fieldKey: field.key, op, value }];
}

/* ── Dashboard translation ───────────────────────────────────────────────── */

export type TranslatedDashboard =
  | {
      ok: true;
      sfId: string;
      targetObjectKey: string;
      key: string;
      label: string;
      artifact: Artifact;
      notes: string[];
    }
  | { ok: false; sfId: string; label: string; reason: string };

const MAX_DASHBOARD_NODES = 20; // ArtifactSchema cap (incl. the PageHeader)

/** SF colspan (12-col grid) → the artifact span vocabulary. */
function spanFromColspan(colspan: number | undefined): number {
  const c = colspan ?? 6;
  if (c <= 3) return 3;
  if (c <= 4) return 4;
  if (c <= 6) return 6;
  if (c <= 8) return 8;
  return 12;
}

export function translateDashboard(
  describe: DashboardDescribeResult,
  reportsBySfId: Map<string, TranslatedReport>,
): TranslatedDashboard {
  const sfId = describe.id ?? '';
  const label = describe.name ?? 'Imported dashboard';
  const notes: string[] = [];
  const components = describe.components ?? [];
  const layout = describe.layout?.components ?? [];

  // Reading order: by grid position, since components[] order is arbitrary.
  const ordered = components
    .map((c, i) => ({ c, pos: layout[i] }))
    .sort(
      (a, b) =>
        (a.pos?.row ?? 0) - (b.pos?.row ?? 0) || (a.pos?.column ?? 0) - (b.pos?.column ?? 0),
    );

  const nodes: Artifact['components'] = [];
  const objectCounts = new Map<string, number>();

  for (const { c, pos } of ordered) {
    if (nodes.length >= MAX_DASHBOARD_NODES - 1) {
      notes.push(`dashboard truncated at ${MAX_DASHBOARD_NODES - 1} components`);
      break;
    }
    const report = c.reportId ? reportsBySfId.get(c.reportId) : undefined;
    if (!report || !report.ok) {
      notes.push(
        `component '${c.header ?? c.title ?? c.id ?? '?'}' skipped — source report not imported`,
      );
      continue;
    }
    objectCounts.set(report.targetObjectKey, (objectCounts.get(report.targetObjectKey) ?? 0) + 1);
    const title = c.header ?? c.title ?? report.label;
    const span = spanFromColspan(pos?.colspan);
    const viz = c.properties?.visualizationType?.toLowerCase() ?? null;

    if (report.viewType === 'list' || viz === 'table' || viz === 'flattable') {
      nodes.push({
        component: 'RecordTable',
        props: {
          title,
          objectKey: report.targetObjectKey,
          filters: report.filters,
          ...(report.columns.length ? { columns: report.columns } : {}),
          span: Math.max(span, 6),
        },
      });
      continue;
    }

    const config = report.config as ReportConfig;
    const isMetric =
      viz === 'metric' || viz === 'gauge' || !config.groupBy || config.chartType === 'kpi';
    if (isMetric) {
      nodes.push({
        component: 'Metric',
        props: {
          label: title,
          objectKey: report.targetObjectKey,
          fn: config.measure.agg,
          ...(config.measure.fieldKey ? { fieldKey: config.measure.fieldKey } : {}),
          filters: report.filters,
          span: Math.min(span, 4),
        },
      });
      continue;
    }

    // Component-level visualization wins over the report's chart when present.
    const override = viz && !c.properties?.useReportChart ? mapChartType(viz) : null;
    const chartType =
      override?.chartType && override.chartType !== 'kpi' ? override.chartType : config.chartType;
    nodes.push({
      component: 'Chart',
      props: {
        title,
        objectKey: report.targetObjectKey,
        groupBy: config.groupBy,
        ...(config.groupByGrain ? { dateGrain: config.groupByGrain } : {}),
        ...(config.groupBy2 ? { groupBy2: config.groupBy2 } : {}),
        ...(config.groupBy2Grain ? { groupBy2Grain: config.groupBy2Grain } : {}),
        fn: config.measure.agg,
        ...(config.measure.fieldKey ? { measure: config.measure.fieldKey } : {}),
        chartType: chartType === 'kpi' ? 'bar' : chartType,
        ...(config.stacked ? { stacked: true } : {}),
        filters: report.filters,
        ...(c.properties?.maxValuesDisplayed ? { limit: c.properties.maxValuesDisplayed } : {}),
        span,
      },
    });
  }

  if (nodes.length === 0) {
    return { ok: false, sfId, label, reason: 'no dashboard component could be translated' };
  }

  // Anchor the view row on the modal object among the translated components.
  let targetObjectKey = '';
  let best = 0;
  for (const [k, n] of objectCounts) {
    if (n > best) {
      targetObjectKey = k;
      best = n;
    }
  }

  const artifact: Artifact = {
    version: '1',
    components: [{ component: 'PageHeader', props: { title: label } }, ...nodes],
  };
  const parsed = ArtifactSchema.safeParse(artifact);
  if (!parsed.success) {
    // Our own bug guard — mirrors assertDashboardConfig on the tRPC path.
    return {
      ok: false,
      sfId,
      label,
      reason: `translated artifact failed validation: ${parsed.error.issues[0]?.message ?? 'malformed'}`,
    };
  }

  return {
    ok: true,
    sfId,
    targetObjectKey,
    key: viewKeyFrom(describe.developerName || label),
    label,
    artifact: parsed.data,
    notes,
  };
}
