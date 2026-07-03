// Pure data helpers shared by every aggregate surface — the report renderer,
// the dashboard Chart/Metric nodes, and the matrix table. Formerly inlined in
// artifact-walker.tsx (which re-exports them for compatibility); split out
// when buckets grew a second grouping level.

import type { ChartDatum } from '@/components/northbeam/charts';
import type { FieldDefLite } from '@/components/northbeam/field-render';
import type { DateGrain } from '@northbeam/db/views';

export type AggregateFn = 'count' | 'sum' | 'avg' | 'min' | 'max' | 'countDistinct' | 'median';

const AGG_FNS: readonly string[] = ['count', 'sum', 'avg', 'min', 'max', 'countDistinct', 'median'];

/** Aggregates that are NOT part-to-whole safe — a donut/funnel of medians or
 *  distinct counts reads as nonsense. Used by chart-type coercion. */
export const NON_ADDITIVE_FNS: ReadonlySet<string> = new Set([
  'avg',
  'min',
  'max',
  'median',
  'countDistinct',
]);
const GRAINS: readonly string[] = ['day', 'week', 'month', 'quarter', 'year'];

/** Narrow untyped artifact props to the aggregate vocabulary (old saved
 *  artifacts can carry anything — unknowns fall back, they never crash). */
export const toAggFn = (v: unknown): AggregateFn =>
  AGG_FNS.includes(String(v)) ? (v as AggregateFn) : 'count';
export const toGrain = (v: unknown): DateGrain | undefined =>
  GRAINS.includes(String(v)) ? (v as DateGrain) : undefined;

/** One group-by bucket as returned by `record.aggregate`. `group2` is present
 *  only when the query carried a second grouping. */
export type AggBucket = {
  group: string | number | boolean | null;
  group2?: string | number | boolean | null;
  value: number;
  count: number;
};

/** Format an aggregate for display. Currency/percent follow the field type;
 *  large magnitudes compact (12.9K / $4.2M) so stat tiles stay short. */
export function fmtAggregate(n: number, field?: FieldDefLite): string {
  if (field?.type === 'currency') {
    const compact = Math.abs(n) >= 100_000;
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: field.config?.currencyCode ?? 'USD',
      notation: compact ? 'compact' : 'standard',
      maximumFractionDigits: compact ? 1 : 0,
    }).format(n);
  }
  if (field?.type === 'percent') {
    return `${n.toLocaleString('en-US', { maximumFractionDigits: 1 })}%`;
  }
  if (Math.abs(n) >= 100_000) {
    return new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 }).format(
      n,
    );
  }
  return n.toLocaleString('en-US', { maximumFractionDigits: 1 });
}

/** Human label for an aggregate bucket: hydrated picklist option label (the
 *  `options` record.aggregate ships), reference record label (its
 *  `groupLabels`), checkbox Yes/No, empty → "None". */
export function bucketLabel(
  group: AggBucket['group'],
  options: { value: string; label: string }[],
  refLabels: Record<string, string>,
): string {
  if (group === null || group === '') return 'None';
  if (typeof group === 'boolean') return group ? 'Yes' : 'No';
  const key = String(group);
  return options.find((o) => o.value === key)?.label ?? refLabels[key] ?? key;
}

/** Date-grain buckets arrive as ISO 'YYYY-MM-DD' strings (UTC date_trunc) —
 *  format them per grain: 'Jan 5, 2026' / 'Jan 2026' / 'Q1 2026' / '2026'. */
export function fmtDateBucket(iso: string, grain: DateGrain): string {
  const t = Date.parse(`${iso}T00:00:00Z`);
  if (Number.isNaN(t)) return iso;
  const d = new Date(t);
  switch (grain) {
    case 'year':
      return String(d.getUTCFullYear());
    case 'quarter':
      return `Q${Math.floor(d.getUTCMonth() / 3) + 1} ${d.getUTCFullYear()}`;
    case 'month':
      return d.toLocaleDateString('en-US', { timeZone: 'UTC', month: 'short', year: 'numeric' });
    default: // day / week — a week bucket is labeled by its Monday
      return d.toLocaleDateString('en-US', {
        timeZone: 'UTC',
        month: 'short',
        day: 'numeric',
        year: 'numeric',
      });
  }
}

/* ── Metric compare (computed deltas) ───────────────────────────────────────
   A Metric's `compare` spec turns "% vs last period" into two REAL filtered
   aggregates instead of a model-invented string. Boundaries are UTC to match
   the server's UTC date semantics. */

export type ComparePeriod = 'week' | 'month' | 'quarter';

export const COMPARE_PERIODS: readonly string[] = ['week', 'month', 'quarter'];

/** Start of the current period and of the one before it (UTC). Current runs
 *  period-to-date; previous is the full window [prev, curr). */
export function periodStarts(
  period: ComparePeriod,
  now: Date = new Date(),
): {
  curr: Date;
  prev: Date;
} {
  const y = now.getUTCFullYear();
  const m = now.getUTCMonth();
  if (period === 'week') {
    const today = Date.UTC(y, m, now.getUTCDate());
    const dow = new Date(today).getUTCDay();
    const back = dow === 0 ? 6 : dow - 1; // ISO Monday
    const curr = today - back * 86_400_000;
    return { curr: new Date(curr), prev: new Date(curr - 7 * 86_400_000) };
  }
  if (period === 'month') {
    return { curr: new Date(Date.UTC(y, m, 1)), prev: new Date(Date.UTC(y, m - 1, 1)) };
  }
  const q = Math.floor(m / 3) * 3;
  return { curr: new Date(Date.UTC(y, q, 1)), prev: new Date(Date.UTC(y, q - 3, 1)) };
}

/** Signed % change between a full previous period and the current
 *  period-to-date. Undefined when the previous period is empty — "+∞%" is
 *  noise, and a brand-new series has nothing honest to compare against. */
export function pctChangeDelta(
  curr: number,
  prev: number,
  period: ComparePeriod,
): { text: string; trend: 'up' | 'down' | 'neutral' } | undefined {
  if (!Number.isFinite(curr) || !Number.isFinite(prev) || prev === 0) return undefined;
  const pct = ((curr - prev) / Math.abs(prev)) * 100;
  const rounded = Math.round(pct);
  const trend = rounded > 0 ? 'up' : rounded < 0 ? 'down' : 'neutral';
  const sign = rounded > 0 ? '+' : '';
  return { text: `${sign}${rounded}% vs last ${period}`, trend };
}

/** Grand total across buckets — count/sum add up; avg folds count-weighted;
 *  min/max take the extreme across buckets. */
export function totalOf(buckets: AggBucket[], agg: AggregateFn): number {
  if (buckets.length === 0) return 0;
  if (agg === 'min') return Math.min(...buckets.map((b) => b.value));
  if (agg === 'max') return Math.max(...buckets.map((b) => b.value));
  // median folds count-weighted like avg — an APPROXIMATION (the true grand
  // median needs the raw rows); good enough for a header strip.
  if (agg === 'avg' || agg === 'median') {
    const n = buckets.reduce((acc, b) => acc + b.count, 0);
    return n > 0 ? buckets.reduce((acc, b) => acc + b.value * b.count, 0) / n : 0;
  }
  // countDistinct sums bucket-level distinct counts — an UPPER BOUND (the
  // same value can appear in two buckets). Comment stands so this doesn't
  // read as a bug later.
  return buckets.reduce((acc, b) => acc + b.value, 0);
}

/** Combine two already-aggregated cells into one (the "Other" fold).
 *  avg/median fold count-weighted (median approximately); countDistinct sums
 *  as an upper bound — both noted in totalOf, same trade-off. */
function combine(
  agg: AggregateFn,
  a: { value: number; count: number },
  b: { value: number; count: number },
): { value: number; count: number } {
  const count = a.count + b.count;
  if (agg === 'min') return { value: Math.min(a.value, b.value), count };
  if (agg === 'max') return { value: Math.max(a.value, b.value), count };
  if (agg === 'avg' || agg === 'median') {
    return { value: count > 0 ? (a.value * a.count + b.value * b.count) / count : 0, count };
  }
  return { value: a.value + b.value, count };
}

/** Fold aggregate buckets into chart data: top-`cap` buckets plus the tail
 *  folded into "Other" (agg-aware). record.aggregate returns single-group
 *  buckets ranked by value desc, so slicing = top-N. */
export function foldBuckets(args: {
  buckets: AggBucket[];
  options?: { value: string; label: string }[] | null;
  refLabels?: Record<string, string> | null;
  agg: AggregateFn;
  cap: number;
  measureField?: FieldDefLite;
  /** Overrides the option/ref label lookup (e.g. date-grain formatting). */
  labelOf?: (g: AggBucket['group']) => string;
}): { items: ChartDatum[]; totalDisplay: string } {
  const { buckets, agg, cap, measureField } = args;
  const options = args.options ?? [];
  const refLabels = args.refLabels ?? {};
  const labelOf = args.labelOf ?? ((g: AggBucket['group']) => bucketLabel(g, options, refLabels));
  const items: ChartDatum[] = buckets.slice(0, cap).map((b) => ({
    label: labelOf(b.group),
    value: b.value,
    display: fmtAggregate(b.value, measureField),
  }));
  const [first, ...rest] = buckets.slice(cap);
  if (first) {
    const folded = rest.reduce((acc, t) => combine(agg, acc, t), {
      value: first.value,
      count: first.count,
    });
    const v = folded.value;
    items.push({ label: 'Other', value: v, display: fmtAggregate(v, measureField), isOther: true });
  }
  const total = totalOf(buckets, agg);
  return { items, totalDisplay: fmtAggregate(total, measureField) };
}

/* ── Two-level pivot (stacked/grouped charts + matrix tables) ────────────── */

export type PivotSeries = { key: string; label: string; isOther?: boolean };
export type PivotRow = {
  label: string;
  /** series key → aggregated cell. Missing key = no records in that cell. */
  cells: Record<string, { value: number; count: number }>;
};

/** Pivot two-level buckets into rows (primary groups, server order preserved)
 *  × series (top-`seriesCap` secondary groups by total, tail folded into an
 *  "Other" series). */
export function pivotBuckets(args: {
  buckets: AggBucket[];
  agg: AggregateFn;
  labelOf: (g: AggBucket['group']) => string;
  label2Of: (g: AggBucket['group']) => string;
  seriesCap?: number;
}): { rows: PivotRow[]; series: PivotSeries[] } {
  const { buckets, agg, labelOf, label2Of } = args;
  const seriesCap = Math.max(args.seriesCap ?? 5, 1);

  // Rank secondary groups by their overall weight to pick the visible series.
  const seriesTotals = new Map<string, number>();
  for (const b of buckets) {
    const k = label2Of(b.group2 ?? null);
    seriesTotals.set(
      k,
      (seriesTotals.get(k) ?? 0) + (agg === 'count' || agg === 'sum' ? b.value : b.count),
    );
  }
  const ranked = [...seriesTotals.entries()].sort((a, b) => b[1] - a[1]).map(([k]) => k);
  const visible = ranked.slice(0, seriesCap);
  const hasOther = ranked.length > visible.length;

  const series: PivotSeries[] = visible.map((label, i) => ({ key: `s${i}`, label }));
  if (hasOther) series.push({ key: 'other', label: 'Other', isOther: true });
  const keyOf = new Map(visible.map((label, i) => [label, `s${i}`]));

  const rows: PivotRow[] = [];
  const rowByLabel = new Map<string, PivotRow>();
  for (const b of buckets) {
    const rowLabel = labelOf(b.group);
    let row = rowByLabel.get(rowLabel);
    if (!row) {
      row = { label: rowLabel, cells: {} };
      rowByLabel.set(rowLabel, row);
      rows.push(row);
    }
    const seriesKey = keyOf.get(label2Of(b.group2 ?? null)) ?? 'other';
    const cell = { value: b.value, count: b.count };
    const existing = row.cells[seriesKey];
    row.cells[seriesKey] = existing ? combine(agg, existing, cell) : cell;
  }
  return { rows, series };
}
