'use client';

// Recharts-backed primitives for the expanded report palette — grouped /
// stacked columns, area, multi-series line, bucket scatter, funnel. The
// hand-rolled primitives in charts.tsx (BarList / LineChart / Donut /
// StatTile) stay canonical for the shapes they already draw; these cover the
// shapes that would be disproportionate to hand-roll. Theming matches:
//   - series colors from the validated --nb-chart ramp (SLOT_COLORS),
//     "Other" in the de-emphasis hue,
//   - hairline horizontal grid only, 11px muted ticks, no axis lines,
//   - the same primary-bubble tooltip as the SVG charts,
//   - legend only when there are ≥ 2 series (swatch + label, Donut-style).

import { ChartRampStyle, SLOT_COLORS } from '@/components/northbeam/charts';
import type { PivotRow, PivotSeries } from '@/components/northbeam/views/aggregate-data';
import { cn } from '@/lib/cn';
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Funnel,
  FunnelChart,
  LabelList,
  Line,
  LineChart,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
  ZAxis,
} from 'recharts';

const CHART_HEIGHT = 240;
const TICK = { fontSize: 11, fill: 'var(--muted-foreground)' } as const;

function seriesColor(s: PivotSeries, i: number): string {
  return s.isOther
    ? 'var(--nb-chart-other)'
    : (SLOT_COLORS[i % SLOT_COLORS.length] ?? SLOT_COLORS[0]);
}

/* ── Tooltip (primary bubble, same as charts.tsx) ───────────────────────── */

type TooltipEntry = { name?: string; value?: number | string; color?: string };

function NbTooltip({
  active,
  label,
  payload,
  format,
}: {
  active?: boolean;
  label?: string | number;
  payload?: TooltipEntry[];
  format: (n: number) => string;
}) {
  if (!active || !payload || payload.length === 0) return null;
  return (
    <div className="rounded-md bg-primary px-2.5 py-1.5 text-primary-foreground text-xs shadow-md">
      {label != null && label !== '' && <div className="mb-0.5 opacity-80">{String(label)}</div>}
      {payload.map((e, i) => (
        <div key={`${e.name}-${i}`} className="flex items-center gap-1.5">
          {e.color && (
            <span
              aria-hidden="true"
              className="size-2 rounded-[2px]"
              style={{ background: e.color }}
            />
          )}
          <span className="font-semibold tabular-nums">{format(Number(e.value ?? 0))}</span>
          {payload.length > 1 && <span className="opacity-80">{e.name}</span>}
        </div>
      ))}
    </div>
  );
}

/* ── Legend (Donut-style: swatch + label) ───────────────────────────────── */

function SeriesLegend({ series }: { series: PivotSeries[] }) {
  if (series.length < 2) return null;
  return (
    <ul className="m-0 mt-2 flex list-none flex-wrap gap-x-4 gap-y-1 p-0">
      {series.map((s, i) => (
        <li key={s.key} className="flex items-center gap-1.5 text-[12px]">
          <span
            aria-hidden="true"
            className="size-2.5 shrink-0 rounded-[2px]"
            style={{ background: seriesColor(s, i) }}
          />
          <span className="text-muted-foreground">{s.label}</span>
        </li>
      ))}
    </ul>
  );
}

/* ── SeriesChart: column / area / line over pivoted rows ────────────────── */

export type SeriesChartKind = 'column' | 'area' | 'line';

export type SeriesChartProps = {
  kind: SeriesChartKind;
  rows: PivotRow[];
  series: PivotSeries[];
  /** column/area only — series stack instead of grouping/overlaying. */
  stacked?: boolean;
  format: (n: number) => string;
  className?: string;
};

/** Flatten pivot rows for Recharts: `{ label, s0: v, s1: v, … }`. Missing
 *  cells become 0 so stacks and areas stay contiguous. */
function flatten(rows: PivotRow[], series: PivotSeries[]) {
  return rows.map((r) => {
    const flat: Record<string, number | string> = { label: r.label };
    for (const s of series) flat[s.key] = r.cells[s.key]?.value ?? 0;
    return flat;
  });
}

export function SeriesChart({ kind, rows, series, stacked, format, className }: SeriesChartProps) {
  if (rows.length === 0) {
    return <p className="text-muted-foreground text-sm">No data to chart.</p>;
  }
  const data = flatten(rows, series);
  const nameOf = new Map(series.map((s) => [s.key, s.label]));
  const common = {
    data,
    margin: { top: 8, right: 8, bottom: 0, left: 0 },
  } as const;
  const axes = (
    <>
      <CartesianGrid vertical={false} stroke="var(--border)" strokeOpacity={0.6} />
      <XAxis
        dataKey="label"
        tick={TICK}
        tickLine={false}
        axisLine={{ stroke: 'var(--border)' }}
        interval="preserveStartEnd"
        minTickGap={24}
      />
      <YAxis
        tick={TICK}
        tickLine={false}
        axisLine={false}
        width={44}
        tickFormatter={(v: number) => format(v)}
      />
      <Tooltip
        cursor={{ fill: 'var(--muted)', fillOpacity: 0.4 }}
        content={<NbTooltip format={format} />}
        isAnimationActive={false}
      />
    </>
  );

  let chart: React.ReactElement;
  if (kind === 'column') {
    chart = (
      <BarChart {...common} barCategoryGap="24%">
        {axes}
        {series.map((s, i) => (
          <Bar
            key={s.key}
            dataKey={s.key}
            name={nameOf.get(s.key)}
            stackId={stacked ? 'stack' : undefined}
            fill={seriesColor(s, i)}
            radius={stacked ? 0 : [4, 4, 0, 0]}
            maxBarSize={24}
          />
        ))}
      </BarChart>
    );
  } else if (kind === 'area') {
    chart = (
      <AreaChart {...common}>
        {axes}
        {series.map((s, i) => (
          <Area
            key={s.key}
            dataKey={s.key}
            name={nameOf.get(s.key)}
            stackId={stacked || series.length > 1 ? 'stack' : undefined}
            stroke={seriesColor(s, i)}
            fill={seriesColor(s, i)}
            fillOpacity={series.length > 1 ? 0.25 : 0.08}
            strokeWidth={1.5}
            dot={false}
            isAnimationActive={false}
          />
        ))}
      </AreaChart>
    );
  } else {
    chart = (
      <LineChart {...common}>
        {axes}
        {series.map((s, i) => (
          <Line
            key={s.key}
            dataKey={s.key}
            name={nameOf.get(s.key)}
            stroke={seriesColor(s, i)}
            strokeWidth={1.5}
            dot={false}
            isAnimationActive={false}
          />
        ))}
      </LineChart>
    );
  }

  return (
    <div className={cn('nb-chart', className)}>
      <ChartRampStyle />
      <ResponsiveContainer width="100%" height={CHART_HEIGHT}>
        {chart}
      </ResponsiveContainer>
      <SeriesLegend series={series} />
    </div>
  );
}

/* ── Bucket scatter: one point per group (x = records, y = measure) ─────── */

export type ScatterPoint = { label: string; x: number; y: number; display: string };

export function BucketScatter({
  points,
  xLabel = 'Records',
  yLabel,
  format,
  className,
}: {
  points: ScatterPoint[];
  xLabel?: string;
  yLabel: string;
  format: (n: number) => string;
  className?: string;
}) {
  if (points.length === 0) {
    return <p className="text-muted-foreground text-sm">No data to chart.</p>;
  }
  return (
    <div className={cn('nb-chart', className)}>
      <ChartRampStyle />
      <ResponsiveContainer width="100%" height={CHART_HEIGHT}>
        <ScatterChart margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
          <CartesianGrid stroke="var(--border)" strokeOpacity={0.6} />
          <XAxis
            type="number"
            dataKey="x"
            name={xLabel}
            tick={TICK}
            tickLine={false}
            axisLine={{ stroke: 'var(--border)' }}
          />
          <YAxis
            type="number"
            dataKey="y"
            name={yLabel}
            tick={TICK}
            tickLine={false}
            axisLine={false}
            width={44}
            tickFormatter={(v: number) => format(v)}
          />
          <ZAxis range={[60, 60]} />
          <Tooltip
            cursor={{ strokeDasharray: '3 3', stroke: 'var(--border)' }}
            isAnimationActive={false}
            content={({ active, payload }) => {
              const p = payload?.[0]?.payload as ScatterPoint | undefined;
              if (!active || !p) return null;
              return (
                <div className="rounded-md bg-primary px-2.5 py-1.5 text-primary-foreground text-xs shadow-md">
                  <div className="mb-0.5 opacity-80">{p.label}</div>
                  <div className="font-semibold tabular-nums">{p.display}</div>
                  <div className="opacity-80">
                    {p.x.toLocaleString('en-US')} record{p.x === 1 ? '' : 's'}
                  </div>
                </div>
              );
            }}
          />
          <Scatter data={points} fill="var(--nb-chart-1)" isAnimationActive={false} />
        </ScatterChart>
      </ResponsiveContainer>
      <p className="mt-1 text-[11px] text-muted-foreground">
        x: {xLabel.toLowerCase()} · y: {yLabel}
      </p>
    </div>
  );
}

/* ── Funnel: ordered stage progression ──────────────────────────────────── */

export function FunnelChartNb({
  items,
  className,
}: {
  /** Ordered stages (picklist option order when available), value + display. */
  items: { label: string; value: number; display?: string; isOther?: boolean }[];
  className?: string;
}) {
  const drawable = items.filter((d) => d.value > 0);
  if (drawable.length === 0) {
    return <p className="text-muted-foreground text-sm">No data to chart.</p>;
  }
  const data = drawable.map((d, i) => ({
    name: d.label,
    value: d.value,
    display: d.display ?? d.value.toLocaleString('en-US'),
    fill: d.isOther ? 'var(--nb-chart-other)' : SLOT_COLORS[i % SLOT_COLORS.length],
  }));
  return (
    <div className={cn('nb-chart', className)}>
      <ChartRampStyle />
      <ResponsiveContainer width="100%" height={CHART_HEIGHT}>
        <FunnelChart margin={{ top: 8, right: 96, bottom: 8, left: 8 }}>
          <Tooltip
            isAnimationActive={false}
            content={({ active, payload }) => {
              const p = payload?.[0]?.payload as { name: string; display: string } | undefined;
              if (!active || !p) return null;
              return (
                <div className="rounded-md bg-primary px-2.5 py-1.5 text-primary-foreground text-xs shadow-md">
                  <span className="font-semibold tabular-nums">{p.display}</span>{' '}
                  <span className="opacity-80">{p.name}</span>
                </div>
              );
            }}
          />
          <Funnel dataKey="value" data={data} isAnimationActive={false}>
            {data.map((d) => (
              <Cell key={d.name} fill={d.fill} />
            ))}
            <LabelList
              position="right"
              dataKey="name"
              stroke="none"
              fill="var(--muted-foreground)"
              fontSize={11}
            />
          </Funnel>
        </FunnelChart>
      </ResponsiveContainer>
    </div>
  );
}
