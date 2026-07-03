'use client';

// AggChart — the ONE chart-rendering switch over record.aggregate buckets,
// shared by the report renderer and the dashboard Chart node so the two
// surfaces stay pixel-identical. Owns:
//   - chart-type coercion (unknown → bar; shape mismatches degrade, never
//     error — old saved views/artifacts keep rendering),
//   - bucket labeling (picklist options / reference labels / date grains),
//   - top-N folding for ranked charts and series pivoting for two-level ones.

import { BarList, Donut, LineChart } from '@/components/northbeam/charts';
import { BucketScatter, FunnelChartNb, SeriesChart } from '@/components/northbeam/charts-recharts';
import type { FieldDefLite } from '@/components/northbeam/field-render';
import {
  type AggBucket,
  type AggregateFn,
  type PivotRow,
  type PivotSeries,
  bucketLabel,
  fmtAggregate,
  fmtDateBucket,
  foldBuckets,
  pivotBuckets,
} from '@/components/northbeam/views/aggregate-data';
import { MatrixTable } from '@/components/northbeam/views/matrix-table';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import type { DateGrain } from '@northbeam/db/views';
import type { ReactNode } from 'react';

type PicklistOptionLite = { value: string; label: string };

export type ResolvedChartType =
  | 'bar'
  | 'line'
  | 'area'
  | 'donut'
  | 'scatter'
  | 'funnel'
  | 'table'
  | 'matrix'
  | 'kpi';

const KNOWN_CHART_TYPES = new Set<ResolvedChartType>([
  'bar',
  'line',
  'area',
  'donut',
  'scatter',
  'funnel',
  'table',
  'matrix',
  'kpi',
]);

/** Resolve a requested chart type against what the spec can actually draw.
 *  Degrade, never reject — the server tolerates soft mismatches for the same
 *  reason (a stale saved view must render something sensible). */
export function coerceChartType(
  requested: string | undefined,
  opts: { agg: AggregateFn; hasGroup: boolean; hasGroup2: boolean },
): ResolvedChartType {
  let t: ResolvedChartType = KNOWN_CHART_TYPES.has(requested as ResolvedChartType)
    ? (requested as ResolvedChartType)
    : 'bar';
  if (!opts.hasGroup) return 'kpi';
  const nonAdditive = opts.agg === 'avg' || opts.agg === 'min' || opts.agg === 'max';
  // Donuts/funnels state part-to-whole; averages/extremes aren't parts.
  if ((t === 'donut' || t === 'funnel') && nonAdditive) t = 'bar';
  // A bucket scatter plots count (x) vs measure (y) — count-only is a line.
  if (t === 'scatter' && opts.agg === 'count') t = 'bar';
  if (t === 'matrix' && !opts.hasGroup2) t = 'table';
  // Two-level buckets can only render as series or a pivot.
  if (opts.hasGroup2 && !['bar', 'line', 'area', 'matrix', 'table'].includes(t)) t = 'bar';
  return t;
}

const isDateField = (f?: FieldDefLite) => f?.type === 'date' || f?.type === 'datetime';

export type AggChartProps = {
  /** Already coerced via coerceChartType (minus 'kpi', which callers own). */
  chartType: Exclude<ResolvedChartType, 'kpi'>;
  agg: AggregateFn;
  buckets: AggBucket[];
  options?: PicklistOptionLite[] | null;
  refLabels?: Record<string, string> | null;
  options2?: PicklistOptionLite[] | null;
  group2Labels?: Record<string, string> | null;
  groupField?: FieldDefLite;
  group2Field?: FieldDefLite;
  grain?: DateGrain;
  grain2?: DateGrain;
  hasGroup2: boolean;
  stacked?: boolean;
  /** Top-N before the tail folds into "Other" (ranked charts only). */
  limit?: number;
  measureField?: FieldDefLite;
};

export function AggChart(p: AggChartProps): ReactNode {
  const options = p.options ?? [];
  const refLabels = p.refLabels ?? {};
  const options2 = p.options2 ?? [];
  const group2Labels = p.group2Labels ?? {};
  const dateGroup = isDateField(p.groupField);
  const dateGroup2 = isDateField(p.group2Field);

  const labelOf = (g: AggBucket['group']) =>
    dateGroup && typeof g === 'string' && g
      ? fmtDateBucket(g, p.grain ?? 'month')
      : bucketLabel(g, options, refLabels);
  const label2Of = (g: AggBucket['group']) =>
    dateGroup2 && typeof g === 'string' && g
      ? fmtDateBucket(g, p.grain2 ?? 'month')
      : bucketLabel(g, options2, group2Labels);
  const fmt = (n: number) => fmtAggregate(n, p.measureField);

  /** Ordered-series order: chronological for date group-bys, label otherwise.
   *  Ranked charts keep the server's value-desc order untouched. */
  const seriesOrdered = () =>
    [...p.buckets].sort((a, b) => {
      if (dateGroup) {
        const ta = Date.parse(String(a.group ?? ''));
        const tb = Date.parse(String(b.group ?? ''));
        if (!Number.isNaN(ta) && !Number.isNaN(tb)) return ta - tb;
      }
      return labelOf(a.group).localeCompare(labelOf(b.group), 'en-US', { numeric: true });
    });

  /** Pivot two-level buckets, or lift single-level buckets into one series. */
  const toRows = (buckets: AggBucket[]): { rows: PivotRow[]; series: PivotSeries[] } => {
    if (p.hasGroup2) return pivotBuckets({ buckets, agg: p.agg, labelOf, label2Of });
    return {
      rows: buckets.map((b) => ({
        label: labelOf(b.group),
        cells: { s0: { value: b.value, count: b.count } },
      })),
      series: [{ key: 's0', label: p.measureField?.label ?? 'Value' }],
    };
  };

  switch (p.chartType) {
    case 'donut': {
      const cap = Math.min(Math.max(p.limit ?? 5, 1), 5);
      const data = foldBuckets({
        buckets: p.buckets,
        agg: p.agg,
        cap,
        measureField: p.measureField,
        labelOf,
      });
      return <Donut segments={data.items} totalDisplay={data.totalDisplay} />;
    }
    case 'funnel': {
      // Stage order comes from the picklist definition when there is one —
      // a funnel reads as progression, not ranking.
      let buckets = p.buckets;
      if (p.groupField?.type === 'picklist' && options.length > 0) {
        const idx = new Map(options.map((o, i) => [o.value, i]));
        buckets = [...p.buckets].sort(
          (a, b) =>
            (idx.get(String(a.group)) ?? options.length) -
            (idx.get(String(b.group)) ?? options.length),
        );
      }
      const cap = Math.min(Math.max(p.limit ?? 8, 1), 8);
      const data = foldBuckets({ buckets, agg: p.agg, cap, measureField: p.measureField, labelOf });
      return <FunnelChartNb items={data.items} />;
    }
    case 'scatter': {
      const points = p.buckets.slice(0, Math.min(Math.max(p.limit ?? 50, 1), 100)).map((b) => ({
        label: labelOf(b.group),
        x: b.count,
        y: b.value,
        display: fmt(b.value),
      }));
      return (
        <BucketScatter points={points} yLabel={p.measureField?.label ?? 'Value'} format={fmt} />
      );
    }
    case 'matrix':
      return (
        <MatrixTable
          buckets={p.buckets}
          agg={p.agg}
          labelOf={labelOf}
          label2Of={label2Of}
          groupLabel={p.groupField?.label ?? 'Group'}
          measureField={p.measureField}
        />
      );
    case 'table':
      return (
        <BucketsTable
          buckets={p.buckets}
          options={options}
          refLabels={refLabels}
          agg={p.agg}
          groupField={p.groupField}
          measureField={p.measureField}
          labelOf={labelOf}
          label2Of={p.hasGroup2 ? label2Of : undefined}
          group2Field={p.group2Field}
        />
      );
    case 'line': {
      if (p.hasGroup2) {
        const { rows, series } = toRows(seriesOrdered());
        return <SeriesChart kind="line" rows={rows} series={series} format={fmt} />;
      }
      const items = seriesOrdered().map((b) => ({
        label: labelOf(b.group),
        value: b.value,
        display: fmt(b.value),
      }));
      return <LineChart points={items} />;
    }
    case 'area': {
      const { rows, series } = toRows(seriesOrdered());
      return (
        <SeriesChart kind="area" rows={rows} series={series} stacked={p.stacked} format={fmt} />
      );
    }
    default: {
      // bar
      if (p.hasGroup2) {
        const { rows, series } = toRows(p.buckets);
        return (
          <SeriesChart kind="column" rows={rows} series={series} stacked={p.stacked} format={fmt} />
        );
      }
      const cap = Math.min(Math.max(p.limit ?? 12, 1), 12);
      const data = foldBuckets({
        buckets: p.buckets,
        agg: p.agg,
        cap,
        measureField: p.measureField,
        labelOf,
      });
      return <BarList items={data.items} />;
    }
  }
}

/* ── BucketsTable ───────────────────────────────────────────────────────── */

const AGG_NOUN: Record<AggregateFn, string> = {
  count: 'Count',
  sum: 'Sum',
  avg: 'Avg',
  min: 'Min',
  max: 'Max',
};

/** Aggregate buckets as a plain table — Chart `table` type, and the report
 *  renderer's accessibility twin below every chart. Grows a second group
 *  column when the buckets carry one. */
export function BucketsTable({
  buckets,
  options,
  refLabels,
  agg,
  groupField,
  measureField,
  labelOf,
  label2Of,
  group2Field,
}: {
  buckets: AggBucket[];
  options: PicklistOptionLite[];
  refLabels: Record<string, string>;
  agg: AggregateFn;
  groupField?: FieldDefLite;
  measureField?: FieldDefLite;
  /** Overrides the default option/ref lookup (date-grain formatting). */
  labelOf?: (g: AggBucket['group']) => string;
  /** Present when the buckets carry a second grouping. */
  label2Of?: (g: AggBucket['group']) => string;
  group2Field?: FieldDefLite;
}) {
  const label = labelOf ?? ((g: AggBucket['group']) => bucketLabel(g, options, refLabels));
  const valueHead = agg === 'count' ? 'Count' : `${AGG_NOUN[agg]} of ${measureField?.label ?? ''}`;
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>{groupField?.label ?? 'Group'}</TableHead>
          {label2Of && <TableHead>{group2Field?.label ?? 'Sub-group'}</TableHead>}
          <TableHead className="text-right">{valueHead}</TableHead>
          {agg !== 'count' && <TableHead className="text-right">Records</TableHead>}
        </TableRow>
      </TableHeader>
      <TableBody>
        {buckets.map((b, i) => (
          <TableRow key={`${String(b.group)}-${String(b.group2 ?? '')}-${i}`}>
            <TableCell>{groupField ? label(b.group) : 'All records'}</TableCell>
            {label2Of && <TableCell>{label2Of(b.group2 ?? null)}</TableCell>}
            <TableCell className="text-right tabular-nums">
              {fmtAggregate(b.value, measureField)}
            </TableCell>
            {agg !== 'count' && (
              <TableCell className="text-right text-muted-foreground tabular-nums">
                {b.count.toLocaleString('en-US')}
              </TableCell>
            )}
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
