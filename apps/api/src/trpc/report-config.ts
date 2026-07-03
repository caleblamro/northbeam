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
  type FilterEntry,
  GROUPABLE_TYPES,
  NUMERIC_TYPES,
  type ObjectWithFields,
  type ReportAgg,
  type ReportConfig,
  type ReportHaving,
  type ResolvedRefPath,
  isFilterGroup,
  narrowFieldConfig,
  splitRefPath,
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
  'countDistinct',
  'median',
  'stddev',
  'p90',
  'p10',
]) satisfies z.ZodType<ReportAgg>;

export const ReportHavingSchema = z.object({
  target: z.enum(['value', 'count']),
  op: z.enum(['gt', 'gte', 'lt', 'lte']),
  value: z.number().finite(),
}) satisfies z.ZodType<ReportHaving>;

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
    having: ReportHavingSchema.optional(),
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

/* ── Dot paths ('account.industry') ────────────────────────────────────────
   One-hop reference traversal. The tRPC layer resolves keys against loaded
   target metadata; the engine receives ready ResolvedRefPaths. */

/** Target object KEYS a spec + filters reference through dot paths — what the
 *  router must load (once each) before resolving. Unknown ref segments are
 *  skipped here; resolution reports them properly later. */
export function collectRefTargetKeys(
  fields: FieldRow[],
  groupKeys: Array<string | null | undefined>,
  filters: FilterEntry[] = [],
): string[] {
  const byKey = new Map(fields.map((f) => [f.key, f]));
  const out = new Set<string>();
  const consider = (key: string | null | undefined) => {
    if (!key) return;
    const split = splitRefPath(key);
    if (!split) return;
    const ref = byKey.get(split.ref);
    if (!ref || ref.type !== 'reference') return;
    const target = narrowFieldConfig('reference', ref.config).targetObject;
    if (target) out.add(target);
  };
  for (const k of groupKeys) consider(k);
  for (const entry of filters) {
    if (isFilterGroup(entry)) for (const leaf of entry.any) consider(leaf.fieldKey);
    else consider(entry.fieldKey);
  }
  return [...out];
}

/** Resolve one dot key against base fields + loaded targets. Null when any
 *  hop is unknown (caller decides: error for group-bys, drop for filters). */
export function resolveRefPath(
  fields: FieldRow[],
  targets: Map<string, ObjectWithFields>,
  key: string,
): ResolvedRefPath | null {
  const split = splitRefPath(key);
  if (!split) return null;
  const refField = fields.find((f) => f.key === split.ref);
  if (!refField || refField.type !== 'reference') return null;
  const targetKey = narrowFieldConfig('reference', refField.config).targetObject;
  const target = targetKey ? targets.get(targetKey) : undefined;
  if (!target) return null;
  const targetField = target.fields.find((f) => f.key === split.remote);
  if (!targetField) return null;
  return { key, refField, targetObject: target.object, targetField };
}

/** Resolved paths for every dot-key FILTER leaf. Unresolvable keys are
 *  skipped — the predicate builder drops them (unknown-field semantics). */
export function resolveFilterRefPaths(
  fields: FieldRow[],
  targets: Map<string, ObjectWithFields>,
  filters: FilterEntry[],
): ResolvedRefPath[] {
  const out: ResolvedRefPath[] = [];
  const seen = new Set<string>();
  const consider = (key: string) => {
    if (seen.has(key) || !key.includes('.')) return;
    seen.add(key);
    const resolved = resolveRefPath(fields, targets, key);
    if (resolved) out.push(resolved);
  };
  for (const entry of filters) {
    if (isFilterGroup(entry)) for (const leaf of entry.any) consider(leaf.fieldKey);
    else consider(entry.fieldKey);
  }
  return out;
}

/** Resolve a report spec against an object's fields, or explain why it can't
 *  run. Grains on non-date fields are ignored (the engine ignores them too) so
 *  a field-type change can't strand a saved view. Group-by keys may be one-hop
 *  dot paths ('account.industry') when `targets` carries the loaded target
 *  objects (see collectRefTargetKeys); remote multipicklist is not groupable. */
export function resolveReportSpec(
  fields: FieldRow[],
  spec: ReportSpec,
  targets: Map<string, ObjectWithFields> = new Map(),
): { ok: true; value: ResolvedReportSpec } | { ok: false; message: string } {
  const byKey = new Map(fields.map((f) => [f.key, f]));
  const groups: AggregateGrouping[] = [];

  if (spec.groupBy2 && !spec.groupBy) {
    return { ok: false, message: 'groupBy2 requires groupBy' };
  }
  if (spec.groupBy2 && spec.groupBy2 === spec.groupBy) {
    return { ok: false, message: 'groupBy2 must differ from groupBy' };
  }

  const resolveGroup = (
    key: string,
    position: 'primary' | 'secondary',
    grain?: DateGrain,
  ): AggregateGrouping | { error: string } => {
    if (key.includes('.')) {
      const via = resolveRefPath(fields, targets, key);
      // Remote multipicklist would need unnest inside the lateral — out of
      // scope; every other groupable remote type works.
      if (
        !via ||
        !(
          GROUPABLE_TYPES.has(via.targetField.type) ||
          DATE_GROUPABLE_TYPES.has(via.targetField.type)
        )
      ) {
        return { error: `'${key}' is not a groupable reference path` };
      }
      return DATE_GROUPABLE_TYPES.has(via.targetField.type)
        ? { field: via.targetField, grain: grain ?? 'month', via }
        : { field: via.targetField, via };
    }
    const f = byKey.get(key);
    if (!f || !isGroupableField(f, position)) {
      return {
        error: `'${key}' is not a ${position === 'primary' ? 'groupable' : 'secondary-groupable'} field`,
      };
    }
    return DATE_GROUPABLE_TYPES.has(f.type) ? { field: f, grain: grain ?? 'month' } : { field: f };
  };

  if (spec.groupBy) {
    const g = resolveGroup(spec.groupBy, 'primary', spec.groupByGrain);
    if ('error' in g) return { ok: false, message: g.error };
    groups.push(g);
  }
  if (spec.groupBy2) {
    const g = resolveGroup(spec.groupBy2, 'secondary', spec.groupBy2Grain);
    if ('error' in g) return { ok: false, message: g.error };
    groups.push(g);
  }

  let measureField: FieldRow | undefined;
  if (spec.measure.agg !== 'count') {
    const f = spec.measure.fieldKey ? byKey.get(spec.measure.fieldKey) : undefined;
    // countDistinct works over any scalar column ("how many distinct
    // industries") — multipicklist arrays are excluded because DISTINCT over
    // arrays compares whole arrays, which reads as a bug. Every other agg
    // needs a numeric ordering/summation.
    if (spec.measure.agg === 'countDistinct') {
      if (!f || f.type === 'multipicklist') {
        return {
          ok: false,
          message: `measure field '${spec.measure.fieldKey ?? ''}' can't be counted distinctly`,
        };
      }
    } else if (!f || !NUMERIC_TYPES.has(f.type)) {
      return {
        ok: false,
        message: `measure field '${spec.measure.fieldKey ?? ''}' must be a numeric field`,
      };
    }
    measureField = f;
  }

  return { ok: true, value: { groups, measureField } };
}
