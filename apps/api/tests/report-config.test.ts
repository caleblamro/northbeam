// ReportConfigSchema + resolveReportSpec are the shared contract between the
// view router (saving report views), record.aggregate (running them), and the
// Salesforce import (inserting translated views). These tests pin backward
// compatibility with v1 configs and the field-level grouping/measure rules.

import type { FieldRow } from '@northbeam/db';
import { describe, expect, it } from 'vitest';
import {
  ReportConfigSchema,
  isGroupableField,
  resolveReportSpec,
} from '../src/trpc/report-config.js';

function field(overrides: Partial<FieldRow>): FieldRow {
  return {
    id: 'f1',
    organizationId: 'abc',
    objectId: 'o1',
    key: overrides.key ?? 'stage',
    columnName: `f_${overrides.key ?? 'stage'}`,
    type: overrides.type ?? 'picklist',
    config: {},
    ...overrides,
  } as FieldRow;
}

const stage = field({ key: 'stage', type: 'picklist' });
const amount = field({ key: 'amount', type: 'currency' });
const closeDate = field({ key: 'close_date', type: 'date' });
const tags = field({ key: 'tags', type: 'multipicklist' });
const notes = field({ key: 'notes', type: 'textarea' });
const FIELDS = [stage, amount, closeDate, tags, notes];

describe('ReportConfigSchema', () => {
  it('still parses a v1 config unchanged (backward-compat pin)', () => {
    const v1 = { groupBy: 'stage', measure: { agg: 'count' }, chartType: 'bar' };
    const parsed = ReportConfigSchema.safeParse(v1);
    expect(parsed.success).toBe(true);
  });

  it('accepts every chart type', () => {
    for (const chartType of [
      'bar',
      'line',
      'area',
      'donut',
      'scatter',
      'funnel',
      'kpi',
      'table',
      'matrix',
    ]) {
      const parsed = ReportConfigSchema.safeParse({
        groupBy: 'stage',
        measure: { agg: 'count' },
        chartType,
      });
      expect(parsed.success, chartType).toBe(true);
    }
  });

  it('accepts the widened config keys', () => {
    const parsed = ReportConfigSchema.safeParse({
      groupBy: 'close_date',
      groupByGrain: 'quarter',
      groupBy2: 'stage',
      measure: { agg: 'max', fieldKey: 'amount' },
      chartType: 'matrix',
      stacked: true,
    });
    expect(parsed.success).toBe(true);
  });

  it('rejects a non-count measure without a fieldKey', () => {
    for (const agg of ['sum', 'avg', 'min', 'max']) {
      const parsed = ReportConfigSchema.safeParse({
        groupBy: 'stage',
        measure: { agg },
        chartType: 'bar',
      });
      expect(parsed.success, agg).toBe(false);
    }
  });

  it('rejects groupBy2 without groupBy', () => {
    const parsed = ReportConfigSchema.safeParse({
      groupBy: null,
      groupBy2: 'stage',
      measure: { agg: 'count' },
      chartType: 'bar',
    });
    expect(parsed.success).toBe(false);
  });
});

describe('resolveReportSpec', () => {
  it('resolves a categorical grouping without a grain', () => {
    const r = resolveReportSpec(FIELDS, { groupBy: 'stage', measure: { agg: 'count' } });
    expect(r).toEqual({ ok: true, value: { groups: [{ field: stage }], measureField: undefined } });
  });

  it("defaults date groupings to the 'month' grain", () => {
    const r = resolveReportSpec(FIELDS, { groupBy: 'close_date', measure: { agg: 'count' } });
    expect(r.ok && r.value.groups[0]).toEqual({ field: closeDate, grain: 'month' });
  });

  it('ignores a grain on a non-date grouping (engine ignores it too)', () => {
    const r = resolveReportSpec(FIELDS, {
      groupBy: 'stage',
      groupByGrain: 'week',
      measure: { agg: 'count' },
    });
    expect(r.ok && r.value.groups[0]).toEqual({ field: stage });
  });

  it('resolves two groupings, dates at either level', () => {
    const r = resolveReportSpec(FIELDS, {
      groupBy: 'stage',
      groupBy2: 'close_date',
      groupBy2Grain: 'year',
      measure: { agg: 'sum', fieldKey: 'amount' },
    });
    expect(r.ok && r.value.groups).toEqual([{ field: stage }, { field: closeDate, grain: 'year' }]);
    expect(r.ok && r.value.measureField).toBe(amount);
  });

  it('allows multipicklist as the primary grouping only', () => {
    expect(isGroupableField(tags, 'primary')).toBe(true);
    expect(isGroupableField(tags, 'secondary')).toBe(false);
    const ok = resolveReportSpec(FIELDS, { groupBy: 'tags', measure: { agg: 'count' } });
    expect(ok.ok).toBe(true);
    const bad = resolveReportSpec(FIELDS, {
      groupBy: 'stage',
      groupBy2: 'tags',
      measure: { agg: 'count' },
    });
    expect(bad).toEqual({ ok: false, message: "'tags' is not a secondary-groupable field" });
  });

  it('rejects ungroupable and unknown fields', () => {
    expect(resolveReportSpec(FIELDS, { groupBy: 'notes', measure: { agg: 'count' } }).ok).toBe(
      false,
    );
    expect(resolveReportSpec(FIELDS, { groupBy: 'ghost', measure: { agg: 'count' } }).ok).toBe(
      false,
    );
  });

  it('rejects groupBy2 without groupBy and groupBy2 === groupBy', () => {
    expect(resolveReportSpec(FIELDS, { groupBy2: 'stage', measure: { agg: 'count' } }).ok).toBe(
      false,
    );
    expect(
      resolveReportSpec(FIELDS, {
        groupBy: 'stage',
        groupBy2: 'stage',
        measure: { agg: 'count' },
      }).ok,
    ).toBe(false);
  });

  it('requires a numeric measure field for every non-count aggregate', () => {
    for (const agg of ['sum', 'avg', 'min', 'max'] as const) {
      const ok = resolveReportSpec(FIELDS, {
        groupBy: 'stage',
        measure: { agg, fieldKey: 'amount' },
      });
      expect(ok.ok, agg).toBe(true);
      const bad = resolveReportSpec(FIELDS, {
        groupBy: 'stage',
        measure: { agg, fieldKey: 'notes' },
      });
      expect(bad.ok, agg).toBe(false);
    }
  });
});
