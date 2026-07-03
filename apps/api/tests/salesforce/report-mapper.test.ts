// translateReport/translateDashboard are pure describe-payload → view-config
// translators. Fixtures are small inline synthetic payloads shaped like the
// real v62 Analytics API responses (verified against a live org — see the
// header of src/salesforce/report-mapper.ts for the shape notes).

import { ArtifactSchema } from '@northbeam/core';
import type { DashboardDescribeResult, ReportDescribeResult } from '@northbeam/salesforce';
import { describe, expect, it } from 'vitest';
import {
  type ObjectResolution,
  buildResolution,
  mapChartType,
  resolveToken,
  translateDashboard,
  translateReport,
  viewKeyFrom,
} from '../../src/salesforce/report-mapper.js';

/* ── Fixtures ────────────────────────────────────────────────────────────── */

const dealResolution = buildResolution({
  obj: { sfObject: 'Opportunity', targetKey: 'deal', nameFieldSf: 'Name' },
  fields: [
    { sfField: 'StageName', key: 'stage', type: 'picklist', status: 'mapped' },
    { sfField: 'Amount', key: 'amount', type: 'currency', status: 'mapped' },
    { sfField: 'CloseDate', key: 'close_date', type: 'date', status: 'mapped' },
    { sfField: 'IsPrivate', key: 'is_private', type: 'checkbox', status: 'mapped' },
    { sfField: 'Description', key: 'description', type: 'textarea', status: 'mapped' },
    { sfField: 'NextStep', key: 'next_step', type: 'text', status: 'skip' },
  ],
});

const propertyResolution = buildResolution({
  obj: { sfObject: 'Property__c', targetKey: 'property', nameFieldSf: 'Name' },
  fields: [
    { sfField: 'Monthly_Rent__c', key: 'monthly_rent', type: 'currency', status: 'mapped' },
    { sfField: 'Status__c', key: 'status', type: 'picklist', status: 'mapped' },
  ],
});

const resolutions = new Map<string, ObjectResolution>([
  ['Opportunity', dealResolution],
  ['Property__c', propertyResolution],
]);

function reportDescribe(
  overrides: Partial<ReportDescribeResult['reportMetadata']>,
): ReportDescribeResult {
  return {
    reportMetadata: {
      id: '00O000000000001AAA',
      name: 'Pipeline by Stage',
      developerName: 'Pipeline_by_Stage',
      reportFormat: 'SUMMARY',
      reportType: { type: 'Opportunity', label: 'Opportunities' },
      detailColumns: ['OPPORTUNITY_NAME', 'STAGE_NAME', 'AMOUNT'],
      groupingsDown: [
        { name: 'STAGE_NAME', dateGranularity: 'None', sortOrder: 'Asc', sortAggregate: null },
      ],
      groupingsAcross: [],
      aggregates: ['s!AMOUNT', 'RowCount'],
      reportFilters: [],
      reportBooleanFilter: null,
      standardDateFilter: null,
      chart: null,
      ...overrides,
    },
  };
}

/* ── Token resolution ────────────────────────────────────────────────────── */

describe('resolveToken', () => {
  it('resolves standard-report constants and dotted API names alike', () => {
    expect(resolveToken(dealResolution, 'STAGE_NAME')).toEqual({ key: 'stage', type: 'picklist' });
    expect(resolveToken(dealResolution, 'Opportunity.StageName')).toEqual({
      key: 'stage',
      type: 'picklist',
    });
    expect(resolveToken(propertyResolution, 'Property__c.Monthly_Rent__c')).toEqual({
      key: 'monthly_rent',
      type: 'currency',
    });
  });

  it('maps the object name field to the name sentinel', () => {
    expect(resolveToken(dealResolution, 'OPPORTUNITY_NAME')).toEqual({ key: 'name' });
    expect(resolveToken(dealResolution, 'Opportunity.Name')).toEqual({ key: 'name' });
  });

  it('drops relationship paths, foreign prefixes, and unmapped fields', () => {
    expect(resolveToken(dealResolution, 'Opportunity.CreatedBy.Name')).toBeNull();
    expect(resolveToken(dealResolution, 'Account.Industry')).toBeNull();
    expect(resolveToken(dealResolution, 'NEXT_STEP')).toBeNull(); // status: skip
  });
});

describe('viewKeyFrom', () => {
  it('sanitizes and truncates to a KEY_RE-safe key', () => {
    expect(viewKeyFrom('Pipeline_by_Stage')).toBe('pipeline_by_stage');
    const long = viewKeyFrom(`${'Really_'.repeat(12)}Long_Name`);
    expect(long.length).toBeLessThanOrEqual(48);
    expect(long).toMatch(/^[a-z0-9](?:[a-z0-9-_]{0,46}[a-z0-9])?$/);
  });
});

/* ── Report translation ──────────────────────────────────────────────────── */

describe('translateReport', () => {
  it('translates a grouped summary with a sum measure', () => {
    const t = translateReport(reportDescribe({}), resolutions);
    if (!t.ok) throw new Error(t.reason);
    expect(t.viewType).toBe('report');
    expect(t.targetObjectKey).toBe('deal');
    expect(t.key).toBe('pipeline_by_stage');
    expect(t.config).toMatchObject({
      groupBy: 'stage',
      measure: { agg: 'sum', fieldKey: 'amount' },
      chartType: 'bar',
    });
    expect(t.columns).toEqual(['stage', 'amount']); // name sentinel implicit
  });

  it('routes TABULAR reports to list views', () => {
    const t = translateReport(
      reportDescribe({ reportFormat: 'TABULAR', groupingsDown: [], aggregates: ['RowCount'] }),
      resolutions,
    );
    if (!t.ok) throw new Error(t.reason);
    expect(t.viewType).toBe('list');
    expect(t.config).toEqual({});
  });

  it('routes MATRIX reports to a matrix report with groupBy2', () => {
    const t = translateReport(
      reportDescribe({
        reportFormat: 'MATRIX',
        groupingsDown: [{ name: 'STAGE_NAME', dateGranularity: 'None' }],
        groupingsAcross: [{ name: 'CLOSE_DATE', dateGranularity: 'FiscalQuarter' }],
      }),
      resolutions,
    );
    if (!t.ok) throw new Error(t.reason);
    expect(t.config).toMatchObject({
      groupBy: 'stage',
      groupBy2: 'close_date',
      groupBy2Grain: 'quarter',
      chartType: 'matrix',
    });
  });

  it('maps a two-level SUMMARY to groupBy + groupBy2 with date grains', () => {
    const t = translateReport(
      reportDescribe({
        groupingsDown: [
          { name: 'CLOSE_DATE', dateGranularity: 'Month' },
          { name: 'STAGE_NAME', dateGranularity: 'None' },
        ],
      }),
      resolutions,
    );
    if (!t.ok) throw new Error(t.reason);
    expect(t.config).toMatchObject({
      groupBy: 'close_date',
      groupByGrain: 'month',
      groupBy2: 'stage',
    });
  });

  it('skips MULTI_BLOCK reports and reports on unimported objects', () => {
    const joined = translateReport(reportDescribe({ reportFormat: 'MULTI_BLOCK' }), resolutions);
    expect(joined.ok).toBe(false);
    const foreign = translateReport(
      reportDescribe({
        reportType: { type: 'Lead', label: 'Leads' },
        detailColumns: ['Lead.Company'],
      }),
      resolutions,
    );
    expect(foreign.ok).toBe(false);
  });

  it('resolves custom report types via the modal dotted-column prefix', () => {
    const t = translateReport(
      reportDescribe({
        reportType: { type: 'CustomEntity$Property__c', label: 'Properties' },
        detailColumns: ['Property__c.Monthly_Rent__c', 'Property__c.Status__c'],
        groupingsDown: [{ name: 'Property__c.Status__c', dateGranularity: 'None' }],
        aggregates: ['a!Property__c.Monthly_Rent__c'],
      }),
      resolutions,
    );
    if (!t.ok) throw new Error(t.reason);
    expect(t.targetObjectKey).toBe('property');
    expect(t.config).toMatchObject({
      groupBy: 'status',
      measure: { agg: 'avg', fieldKey: 'monthly_rent' },
    });
  });

  it('maps the filter operator table with type-aware special cases', () => {
    const t = translateReport(
      reportDescribe({
        reportFilters: [
          { column: 'STAGE_NAME', operator: 'equals', value: 'Closed Won' },
          { column: 'AMOUNT', operator: 'greaterOrEqual', value: '1000' },
          { column: 'CLOSE_DATE', operator: 'greaterThan', value: '2026-01-01' },
          { column: 'IS_PRIVATE', operator: 'equals', value: '0' },
          { column: 'STAGE_NAME', operator: 'notEqual', value: '' },
          { column: 'DESCRIPTION', operator: 'notContain', value: 'test' },
          { column: 'GHOST_FIELD', operator: 'equals', value: 'x' },
        ],
      }),
      resolutions,
    );
    if (!t.ok) throw new Error(t.reason);
    expect(t.filters).toEqual([
      { fieldKey: 'stage', op: 'eq', value: 'Closed Won' },
      { fieldKey: 'amount', op: 'gte', value: '1000' },
      { fieldKey: 'close_date', op: 'after', value: '2026-01-01' },
      { fieldKey: 'is_private', op: 'isFalse' },
      { fieldKey: 'stage', op: 'isSet' },
    ]);
    expect(t.notes.some((n) => n.includes("'notContain'"))).toBe(true);
    expect(t.notes.some((n) => n.includes('GHOST_FIELD'))).toBe(true);
  });

  it('narrows multi-value equals filters to the first value with a note', () => {
    const t = translateReport(
      reportDescribe({
        reportFilters: [{ column: 'STAGE_NAME', operator: 'equals', value: 'Won,Lost' }],
      }),
      resolutions,
    );
    if (!t.ok) throw new Error(t.reason);
    expect(t.filters).toEqual([{ fieldKey: 'stage', op: 'eq', value: 'Won' }]);
    expect(t.notes.some((n) => n.includes('narrowed'))).toBe(true);
  });

  it('snapshots the standard date filter as after/before', () => {
    const t = translateReport(
      reportDescribe({
        standardDateFilter: {
          column: 'CLOSE_DATE',
          durationValue: 'LAST_N_DAYS:7',
          startDate: '2026-06-27',
          endDate: '2026-07-03',
        },
      }),
      resolutions,
    );
    if (!t.ok) throw new Error(t.reason);
    expect(t.filters).toEqual([
      { fieldKey: 'close_date', op: 'after', value: '2026-06-27' },
      { fieldKey: 'close_date', op: 'before', value: '2026-07-03' },
    ]);
    expect(t.notes.some((n) => n.includes('LAST_N_DAYS:7'))).toBe(true);
  });

  it('notes flattened OR logic', () => {
    const t = translateReport(reportDescribe({ reportBooleanFilter: '1 OR 2' }), resolutions);
    if (!t.ok) throw new Error(t.reason);
    expect(t.notes.some((n) => n.includes('flattened to AND'))).toBe(true);
  });

  it('parses every aggregate prefix and degrades unknowns to count', () => {
    for (const [agg, expected] of [
      ['s!AMOUNT', 'sum'],
      ['a!AMOUNT', 'avg'],
      ['m!AMOUNT', 'min'],
      ['x!AMOUNT', 'max'],
      ['mx!AMOUNT', 'max'],
      ['mn!AMOUNT', 'min'],
    ] as const) {
      const t = translateReport(reportDescribe({ aggregates: [agg] }), resolutions);
      if (!t.ok) throw new Error(t.reason);
      expect(t.config).toMatchObject({ measure: { agg: expected, fieldKey: 'amount' } });
    }
    const formula = translateReport(reportDescribe({ aggregates: ['FORMULA1'] }), resolutions);
    if (!formula.ok) throw new Error(formula.reason);
    expect(formula.config).toMatchObject({ measure: { agg: 'count' } });
    const textual = translateReport(reportDescribe({ aggregates: ['s!DESCRIPTION'] }), resolutions);
    if (!textual.ok) throw new Error(textual.reason);
    expect(textual.config).toMatchObject({ measure: { agg: 'count' } });
  });

  it('prefers the chart summary over the aggregate list order', () => {
    const t = translateReport(
      reportDescribe({
        aggregates: ['RowCount', 's!AMOUNT'],
        chart: { chartType: 'Vertical Column', summaries: ['s!AMOUNT'] },
      }),
      resolutions,
    );
    if (!t.ok) throw new Error(t.reason);
    expect(t.config).toMatchObject({ measure: { agg: 'sum', fieldKey: 'amount' } });
  });

  it('marks stacked charts only when a second grouping survives', () => {
    const stacked = translateReport(
      reportDescribe({
        groupingsDown: [
          { name: 'STAGE_NAME', dateGranularity: 'None' },
          { name: 'CLOSE_DATE', dateGranularity: 'Year' },
        ],
        chart: { chartType: 'Horizontal Bar Stacked' },
      }),
      resolutions,
    );
    if (!stacked.ok) throw new Error(stacked.reason);
    expect(stacked.config).toMatchObject({ chartType: 'bar', stacked: true });

    const flattened = translateReport(
      reportDescribe({ chart: { chartType: 'Horizontal Bar Stacked' } }),
      resolutions,
    );
    if (!flattened.ok) throw new Error(flattened.reason);
    expect((flattened.config as { stacked?: boolean }).stacked).toBeUndefined();
    expect(flattened.notes.some((n) => n.includes('flattened'))).toBe(true);
  });
});

describe('mapChartType', () => {
  it('keyword-matches the display strings the API ships', () => {
    expect(mapChartType('Horizontal Bar Stacked')).toEqual({ chartType: 'bar', stacked: true });
    expect(mapChartType('Vertical Column Grouped')).toEqual({ chartType: 'bar', stacked: false });
    expect(mapChartType('Line')).toEqual({ chartType: 'line', stacked: false });
    expect(mapChartType('Donut')).toEqual({ chartType: 'donut', stacked: false });
    expect(mapChartType('Pie')).toEqual({ chartType: 'donut', stacked: false });
    expect(mapChartType('Funnel')).toEqual({ chartType: 'funnel', stacked: false });
    expect(mapChartType('Scatter')).toEqual({ chartType: 'scatter', stacked: false });
    expect(mapChartType(null)).toEqual({ chartType: null, stacked: false });
  });
});

/* ── Dashboard translation ───────────────────────────────────────────────── */

function dashboardDescribe(): DashboardDescribeResult {
  return {
    id: '01Z000000000001AAA',
    name: 'Sales Overview',
    developerName: 'Sales_Overview',
    components: [
      // components[] order is arbitrary; layout aligns by index.
      { id: 'c1', header: 'Pipeline by stage', reportId: 'r-grouped', properties: null },
      { id: 'c2', header: 'Total won', reportId: 'r-total', properties: null },
      { id: 'c3', header: 'All deals', reportId: 'r-tabular', properties: null },
      { id: 'c4', header: 'Broken', reportId: 'r-missing', properties: null },
    ],
    layout: {
      components: [
        { colspan: 6, column: 0, row: 4, rowspan: 8 },
        { colspan: 3, column: 0, row: 0, rowspan: 4 },
        { colspan: 12, column: 0, row: 12, rowspan: 8 },
        { colspan: 6, column: 6, row: 4, rowspan: 8 },
      ],
    },
  };
}

function dashboardReports() {
  const grouped = translateReport(reportDescribe({}), resolutions);
  const total = translateReport(
    reportDescribe({
      name: 'Total won',
      developerName: 'Total_Won',
      groupingsDown: [],
      aggregates: ['s!AMOUNT'],
    }),
    resolutions,
  );
  const tabular = translateReport(
    reportDescribe({
      name: 'All deals',
      developerName: 'All_Deals',
      reportFormat: 'TABULAR',
      groupingsDown: [],
      aggregates: ['RowCount'],
    }),
    resolutions,
  );
  return new Map([
    ['r-grouped', grouped],
    ['r-total', total],
    ['r-tabular', tabular],
  ]);
}

describe('translateDashboard', () => {
  it('builds a valid artifact in grid reading order with spans from colspan', () => {
    const t = translateDashboard(dashboardDescribe(), dashboardReports());
    if (!t.ok) throw new Error(t.reason);
    expect(t.targetObjectKey).toBe('deal');
    expect(t.key).toBe('sales_overview');
    expect(ArtifactSchema.safeParse(t.artifact).success).toBe(true);

    const [header, ...nodes] = t.artifact.components;
    expect(header).toMatchObject({ component: 'PageHeader', props: { title: 'Sales Overview' } });
    // Reading order: Total won (row 0) → Pipeline (row 4) → All deals (row 12).
    expect(nodes.map((n) => n.component)).toEqual(['Metric', 'Chart', 'RecordTable']);
    expect(nodes[0]?.props).toMatchObject({
      label: 'Total won',
      objectKey: 'deal',
      fn: 'sum',
      fieldKey: 'amount',
      span: 3,
    });
    expect(nodes[1]?.props).toMatchObject({
      objectKey: 'deal',
      groupBy: 'stage',
      fn: 'sum',
      measure: 'amount',
      chartType: 'bar',
      span: 6,
    });
    expect(nodes[2]?.props).toMatchObject({ objectKey: 'deal', span: 12 });
    // The component whose source report is missing gets skipped with a note.
    expect(t.notes.some((n) => n.includes('Broken'))).toBe(true);
  });

  it('fails when no component translates', () => {
    const t = translateDashboard(dashboardDescribe(), new Map());
    expect(t.ok).toBe(false);
  });

  it('truncates at the artifact component cap', () => {
    const reports = dashboardReports();
    const many: DashboardDescribeResult = {
      id: '01Z000000000002AAA',
      name: 'Big',
      developerName: 'Big',
      components: Array.from({ length: 25 }, (_, i) => ({
        id: `c${i}`,
        header: `Tile ${i}`,
        reportId: 'r-total',
        properties: null,
      })),
      layout: {
        components: Array.from({ length: 25 }, (_, i) => ({
          colspan: 4,
          column: (i % 3) * 4,
          row: Math.floor(i / 3) * 4,
        })),
      },
    };
    const t = translateDashboard(many, reports);
    if (!t.ok) throw new Error(t.reason);
    expect(t.artifact.components.length).toBeLessThanOrEqual(20);
    expect(ArtifactSchema.safeParse(t.artifact).success).toBe(true);
    expect(t.notes.some((n) => n.includes('truncated'))).toBe(true);
  });
});
