// Shared report-spec validation — the one place the grouping/measure rules
// live. Three consumers execute report specs against the aggregate engine and
// must agree on what's valid: the view router (saving report views), the
// record.aggregate procedure (running them), and the Salesforce import
// (inserting translated views without going through tRPC). Pure functions +
// zod schemas only, so they're unit-testable without a caller harness.

import {
  type AggregateGrouping,
  DATE_GROUPABLE_TYPES,
  type DateGrain,
  type FieldRow,
  GROUPABLE_TYPES,
  NUMERIC_TYPES,
  type ReportAgg,
  type ReportConfig,
} from '@northbeam/db';
import { z } from 'zod';

export const DateGrainSchema = z.enum([
  'day',
  'week',
  'month',
  'quarter',
  'year',
]) satisfies z.ZodType<DateGrain>;

export const ReportAggSchema = z.enum([
  'count',
  'sum',
  'avg',
  'min',
  'max',
]) satisfies z.ZodType<ReportAgg>;

export const ReportChartTypeSchema = z.enum([
  'bar',
  'line',
  'area',
  'donut',
  'scatter',
  'funnel',
  'kpi',
  'table',
  'matrix',
]);

/** Shape validation for `view.config` on report views. Every key added after
 *  v1 is optional, so configs saved before this schema widened still parse.
 *  Soft chart/shape mismatches (e.g. matrix without groupBy2) are NOT errors —
 *  the renderer degrades them, same as the existing donut+avg coercion. */
export const ReportConfigSchema = z
  .object({
    groupBy: z.string().min(1).nullable(),
    groupByGrain: DateGrainSchema.optional(),
    groupBy2: z.string().min(1).nullable().optional(),
    groupBy2Grain: DateGrainSchema.optional(),
    measure: z.object({
      agg: ReportAggSchema,
      fieldKey: z.string().min(1).optional(),
    }),
    chartType: ReportChartTypeSchema,
    stacked: z.boolean().optional(),
  })
  .superRefine((cfg, ctx) => {
    if (cfg.measure.agg !== 'count' && !cfg.measure.fieldKey) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `measure agg '${cfg.measure.agg}' requires a fieldKey`,
        path: ['measure', 'fieldKey'],
      });
    }
    if (cfg.groupBy2 && !cfg.groupBy) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'groupBy2 requires groupBy',
        path: ['groupBy2'],
      });
    }
  }) satisfies z.ZodType<ReportConfig>;

/** The executable subset of a report spec — what resolveReportSpec checks
 *  against the object's live fields. chartType is presentation-only and is
 *  deliberately not part of this. */
export type ReportSpec = {
  groupBy?: string | null;
  groupByGrain?: DateGrain;
  groupBy2?: string | null;
  groupBy2Grain?: DateGrain;
  measure: { agg: ReportAgg; fieldKey?: string };
};

export type ResolvedReportSpec = {
  /** 0–2 groupings ready for aggregateRecords. */
  groups: AggregateGrouping[];
  measureField?: FieldRow;
};

/** True when this field can be a grouping. Multipicklist explodes through a
 *  LATERAL unnest and is only supported in the primary position. */
export function isGroupableField(field: FieldRow, position: 'primary' | 'secondary'): boolean {
  if (GROUPABLE_TYPES.has(field.type) || DATE_GROUPABLE_TYPES.has(field.type)) return true;
  return field.type === 'multipicklist' && position === 'primary';
}

/** Resolve a report spec against an object's fields, or explain why it can't
 *  run. Grains on non-date fields are ignored (the engine ignores them too) so
 *  a field-type change can't strand a saved view. */
export function resolveReportSpec(
  fields: FieldRow[],
  spec: ReportSpec,
): { ok: true; value: ResolvedReportSpec } | { ok: false; message: string } {
  const byKey = new Map(fields.map((f) => [f.key, f]));
  const groups: AggregateGrouping[] = [];

  if (spec.groupBy2 && !spec.groupBy) {
    return { ok: false, message: 'groupBy2 requires groupBy' };
  }
  if (spec.groupBy2 && spec.groupBy2 === spec.groupBy) {
    return { ok: false, message: 'groupBy2 must differ from groupBy' };
  }
  if (spec.groupBy) {
    const f = byKey.get(spec.groupBy);
    if (!f || !isGroupableField(f, 'primary')) {
      return { ok: false, message: `'${spec.groupBy}' is not a groupable field` };
    }
    groups.push(
      DATE_GROUPABLE_TYPES.has(f.type)
        ? { field: f, grain: spec.groupByGrain ?? 'month' }
        : { field: f },
    );
  }
  if (spec.groupBy2) {
    const f = byKey.get(spec.groupBy2);
    if (!f || !isGroupableField(f, 'secondary')) {
      return { ok: false, message: `'${spec.groupBy2}' is not a secondary-groupable field` };
    }
    groups.push(
      DATE_GROUPABLE_TYPES.has(f.type)
        ? { field: f, grain: spec.groupBy2Grain ?? 'month' }
        : { field: f },
    );
  }

  let measureField: FieldRow | undefined;
  if (spec.measure.agg !== 'count') {
    const f = spec.measure.fieldKey ? byKey.get(spec.measure.fieldKey) : undefined;
    if (!f || !NUMERIC_TYPES.has(f.type)) {
      return {
        ok: false,
        message: `measure field '${spec.measure.fieldKey ?? ''}' must be a numeric field`,
      };
    }
    measureField = f;
  }

  return { ok: true, value: { groups, measureField } };
}
