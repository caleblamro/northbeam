'use client';

// Chart primitives for dashboard artifacts — BarList, LineChart, Donut,
// StatTile. Plain HTML/SVG, no chart dependency. Follows the dataviz method:
//   - BarList: ranked nominal categories, ONE hue for every bar (slot 1),
//     bars ≤ 24px thick, 4px rounded data-end + square baseline edge,
//     hairline recessive track, labels/values in text tokens only.
//   - LineChart: single ordered series (report 'line' chartType), ONE hue
//     (slot 1) with the Sparkline's 8%-opacity area fill, hairline zero
//     baseline, sparse x-axis tick labels so dense series stay legible.
//   - Donut: part-to-whole, ≤ 6 segments, fixed categorical slot order,
//     2px surface-color gaps between segments (no strokes), total in the
//     center, legend always present (swatch + label + value).
//   - StatTile: sentence-case label, semibold PROPORTIONAL-figure value
//     (tabular-nums is reserved for aligned columns, never big standalone
//     numbers), signed delta colored by direction, optional 12-pt sparkline.
// Tooltips enhance, never gate: BarList shows values as direct labels, the
// Donut legend carries every value, and LineChart's report surface always
// ships its buckets-table twin — hover is a convenience.

import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Sparkline } from '@/components/ui/sparkline';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/cn';
import { motion } from 'framer-motion';
import { type ReactNode, useState } from 'react';

/* ── Chart ramp ──────────────────────────────────────────────────────────────
   Local resolved ramp for `--color-chart-1..5` (globals.css @theme). The
   tokens resolve to --accent / --brand / --ink-secondary / --ink-muted /
   --ink-subtle: slots 2-5 are neutrals (OKLCH chroma ≈ 0.01) that fail the
   categorical chroma floor — a gray can't do series-identity work — and the
   dark-mode accent (#818cf8, L 0.68) sits just above the dark lightness band.
   Snapped here to validated values instead of editing the tokens:
     light: #4f46e5 #1baf7a #eda100 #e34948 #008300 → validator ALL PASS
            (contrast WARN on slots 2-3 — relieved: BarList shows direct
            value labels and the Donut always ships a legend with values)
     dark:  #6366f1 #199e70 #c98500 #e66767 #008300 → validator ALL PASS
   Slot 1 light IS the literal --accent value, so single-series charts stay
   on brand. Verified with dataviz/scripts/validate_palette.js against the
   real surfaces (--surface: #ffffff light / #101012 dark). */
const CHART_RAMP_CSS = `
.nb-chart {
  --nb-chart-1: #4f46e5;
  --nb-chart-2: #1baf7a;
  --nb-chart-3: #eda100;
  --nb-chart-4: #e34948;
  --nb-chart-5: #008300;
  --nb-chart-other: var(--ink-subtle);
}
[data-theme="dark"] .nb-chart {
  --nb-chart-1: #6366f1;
  --nb-chart-2: #199e70;
  --nb-chart-3: #c98500;
  --nb-chart-4: #e66767;
  --nb-chart-5: #008300;
}
`;

const SLOT_COLORS = [
  'var(--nb-chart-1)',
  'var(--nb-chart-2)',
  'var(--nb-chart-3)',
  'var(--nb-chart-4)',
  'var(--nb-chart-5)',
] as const;

/** De-duplicated (React hoists by href) style carrying the validated ramp. */
function ChartRampStyle() {
  return (
    <style href="nb-chart-ramp" precedence="medium">
      {CHART_RAMP_CSS}
    </style>
  );
}

export type ChartDatum = {
  label: string;
  value: number;
  /** Pre-formatted display value (currency etc). Falls back to toLocaleString. */
  display?: string;
  /** Marks the folded "Other" bucket — rendered in the de-emphasis hue. */
  isOther?: boolean;
};

function displayOf(d: ChartDatum): string {
  return d.display ?? d.value.toLocaleString('en-US');
}

/* ── BarList ────────────────────────────────────────────────────────────── */

export function BarList({ items, className }: { items: ChartDatum[]; className?: string }) {
  const max = Math.max(...items.map((d) => d.value), 1);
  return (
    <div className={cn('nb-chart flex flex-col gap-2.5', className)}>
      <ChartRampStyle />
      {items.map((d, i) => {
        const pct = Math.max((Math.max(d.value, 0) / max) * 100, 0.5);
        return (
          <Tooltip key={`${d.label}-${i}`}>
            {/* Hover-only enhancement — label AND value are already visible
                as direct text on the row, so nothing is gated on the tooltip. */}
            <TooltipTrigger asChild>
              <div className="group">
                <div className="flex items-baseline justify-between gap-3">
                  <span className="truncate text-[13px] text-foreground">{d.label}</span>
                  <span className="shrink-0 text-[13px] text-muted-foreground tabular-nums">
                    {displayOf(d)}
                  </span>
                </div>
                {/* Track: hairline recessive, one step off surface. Bar: single
                    hue (slot 1), 8px thick, 4px rounded data-end, square
                    baseline edge. "Other" wears the de-emphasis hue. */}
                <div className="mt-1 h-2 w-full rounded-r-[4px] bg-muted">
                  {/* Bars grow in on mount (staggered top-down), then width
                      transitions handle later data changes. */}
                  <motion.div
                    className="h-full rounded-r-[4px]"
                    initial={{ width: 0 }}
                    animate={{ width: `${pct}%` }}
                    transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1], delay: i * 0.04 }}
                    style={{
                      background: d.isOther ? 'var(--nb-chart-other)' : 'var(--nb-chart-1)',
                    }}
                  />
                </div>
              </div>
            </TooltipTrigger>
            <TooltipContent>
              <span className="font-semibold tabular-nums">{displayOf(d)}</span>{' '}
              <span className="opacity-80">{d.label}</span>
            </TooltipContent>
          </Tooltip>
        );
      })}
    </div>
  );
}

/* ── LineChart ──────────────────────────────────────────────────────────── */

// Fixed drawing coordinates — the SVG scales uniformly (w-full h-auto), so
// tick/tooltip positions expressed as % of these match the rendered box.
const LINE_W = 640;
const LINE_H = 180;
const LINE_PAD = 10;

/** Evenly spaced tick indices (always including first + last) so a dense
 *  series never renders more than `max` overlapping x labels. */
function tickIndices(n: number, max = 6): number[] {
  if (n <= max) return Array.from({ length: n }, (_, i) => i);
  const count = Math.min(n, max);
  const picked = new Set<number>();
  for (let t = 0; t < count; t++) picked.add(Math.round((t * (n - 1)) / (count - 1)));
  return [...picked].sort((a, b) => a - b);
}

export function LineChart({ points, className }: { points: ChartDatum[]; className?: string }) {
  const [hover, setHover] = useState<number | null>(null);
  if (points.length === 0) {
    return <p className="text-muted-foreground text-sm">No data to chart.</p>;
  }

  const values = points.map((p) => p.value);
  const yMax = Math.max(...values, 1);
  const yMin = Math.min(...values, 0);
  const range = yMax - yMin || 1;
  const xOf = (i: number) =>
    points.length === 1
      ? LINE_W / 2
      : LINE_PAD + (i * (LINE_W - LINE_PAD * 2)) / (points.length - 1);
  const yOf = (v: number) => LINE_H - LINE_PAD - ((v - yMin) / range) * (LINE_H - LINE_PAD * 2);
  const yBase = yOf(Math.max(yMin, 0)); // zero baseline (yMin is never above 0)

  const pts = points.map((p, i) => `${xOf(i).toFixed(2)},${yOf(p.value).toFixed(2)}`).join(' ');
  const area = `M${xOf(0).toFixed(2)},${yBase.toFixed(2)} L${pts.split(' ').join(' L')} L${xOf(
    points.length - 1,
  ).toFixed(2)},${yBase.toFixed(2)} Z`;
  const ticks = tickIndices(points.length);
  const hovered = hover !== null ? points[hover] : undefined;

  return (
    <div className={cn('nb-chart', className)}>
      <ChartRampStyle />
      <div className="relative">
        <svg
          viewBox={`0 0 ${LINE_W} ${LINE_H}`}
          className="block h-auto w-full"
          role="img"
          aria-label={`Line chart, ${points.length} point${points.length === 1 ? '' : 's'}`}
        >
          {/* Hairline zero baseline — the only chart furniture. */}
          <line
            x1={0}
            y1={yBase}
            x2={LINE_W}
            y2={yBase}
            stroke="var(--border)"
            strokeWidth={1}
            vectorEffect="non-scaling-stroke"
          />
          <path d={area} fill="var(--nb-chart-1)" opacity={0.08} />
          {points.length > 1 && (
            <polyline
              points={pts}
              stroke="var(--nb-chart-1)"
              strokeWidth={1.5}
              fill="none"
              vectorEffect="non-scaling-stroke"
              strokeLinejoin="round"
              strokeLinecap="round"
            />
          )}
          {/* Hover/focus targets — a convenience: every value also lives in
              the report's buckets-table twin, so nothing is gated on hover. */}
          {points.map((p, i) => (
            <circle
              key={`${p.label}-${i}`}
              cx={xOf(i)}
              cy={yOf(p.value)}
              r={3}
              fill="var(--nb-chart-1)"
              className="outline-none transition-opacity"
              opacity={hover === null || hover === i ? 1 : 0.45}
              tabIndex={0}
              aria-label={`${p.label}: ${displayOf(p)}`}
              onMouseEnter={() => setHover(i)}
              onMouseLeave={() => setHover(null)}
              onFocus={() => setHover(i)}
              onBlur={() => setHover(null)}
            />
          ))}
        </svg>
        {hover !== null && hovered && (
          <div
            className="pointer-events-none absolute z-10 w-max rounded-md bg-primary px-2.5 py-1 text-primary-foreground text-xs shadow-md"
            style={{
              left: `${(xOf(hover) / LINE_W) * 100}%`,
              top: `${(yOf(hovered.value) / LINE_H) * 100}%`,
              transform: 'translate(-50%, calc(-100% - 8px))',
            }}
          >
            <span className="font-semibold tabular-nums">{displayOf(hovered)}</span>{' '}
            <span className="opacity-80">{hovered.label}</span>
          </div>
        )}
      </div>
      {/* Sparse x-axis labels — % positions mirror the uniformly-scaled SVG. */}
      <div className="relative mt-1.5 h-4">
        {ticks.map((i) => {
          const p = points[i];
          if (!p) return null;
          return (
            <span
              key={i}
              className="absolute top-0 max-w-24 truncate text-[11px] text-muted-foreground"
              style={{
                left: `${(xOf(i) / LINE_W) * 100}%`,
                transform:
                  points.length === 1
                    ? 'translateX(-50%)'
                    : i === 0
                      ? 'none'
                      : i === points.length - 1
                        ? 'translateX(-100%)'
                        : 'translateX(-50%)',
              }}
            >
              {p.label}
            </span>
          );
        })}
      </div>
    </div>
  );
}

/* ── Donut ──────────────────────────────────────────────────────────────── */

const DONUT_SIZE = 168;
const R_OUTER = 80;
const R_INNER = 57; // 23px ring — same weight class as the bar spec (≤ 24px)
const GAP_PX = 2; // surface-color gap between segments — the only separator

function polar(r: number, angle: number): [number, number] {
  const c = DONUT_SIZE / 2;
  return [c + r * Math.sin(angle), c - r * Math.cos(angle)];
}

/** Annular sector path from `start` to `end` (radians from 12 o'clock, clockwise). */
function sectorPath(start: number, end: number): string {
  const large = end - start > Math.PI ? 1 : 0;
  const [ox0, oy0] = polar(R_OUTER, start);
  const [ox1, oy1] = polar(R_OUTER, end);
  const [ix0, iy0] = polar(R_INNER, start);
  const [ix1, iy1] = polar(R_INNER, end);
  return [
    `M ${ox0.toFixed(2)} ${oy0.toFixed(2)}`,
    `A ${R_OUTER} ${R_OUTER} 0 ${large} 1 ${ox1.toFixed(2)} ${oy1.toFixed(2)}`,
    `L ${ix1.toFixed(2)} ${iy1.toFixed(2)}`,
    `A ${R_INNER} ${R_INNER} 0 ${large} 0 ${ix0.toFixed(2)} ${iy0.toFixed(2)}`,
    'Z',
  ].join(' ');
}

export function Donut({
  segments,
  totalDisplay,
  className,
}: {
  /** ≤ 6 entries (fold the tail into "Other" before passing). Slot colors are
   *  assigned in fixed categorical order; "Other" gets the de-emphasis hue. */
  segments: ChartDatum[];
  /** Center figure. Defaults to the localized sum of segment values. */
  totalDisplay?: string;
  className?: string;
}) {
  const [hover, setHover] = useState<{ x: number; y: number; i: number } | null>(null);
  const total = segments.reduce((acc, s) => acc + Math.max(s.value, 0), 0);
  const center = totalDisplay ?? total.toLocaleString('en-US');

  const colorOf = (s: ChartDatum, i: number) =>
    s.isOther ? 'var(--nb-chart-other)' : SLOT_COLORS[Math.min(i, SLOT_COLORS.length - 1)];

  // Angular gap equivalent to GAP_PX at the ring's mid radius.
  const pad = GAP_PX / ((R_OUTER + R_INNER) / 2);
  let cursor = 0;
  const arcs = segments.map((s, i) => {
    const sweep = total > 0 ? (Math.max(s.value, 0) / total) * Math.PI * 2 : 0;
    const start = cursor;
    cursor += sweep;
    if (sweep <= 0) return null;
    const gap = segments.length > 1 ? pad / 2 : 0; // full circle → no gap
    const a0 = start + gap;
    const a1 = Math.max(cursor - gap, a0 + 0.004);
    // A single full-circle segment can't be one SVG arc — split it in two.
    if (sweep >= Math.PI * 2 - 0.0001) {
      return { d: `${sectorPath(0, Math.PI)} ${sectorPath(Math.PI, Math.PI * 2)}`, i, mid: 0 };
    }
    return { d: sectorPath(a0, a1), i, mid: (a0 + a1) / 2 };
  });

  if (total <= 0) {
    return <p className="text-muted-foreground text-sm">No data to chart.</p>;
  }

  return (
    <div className={cn('nb-chart flex flex-wrap items-center gap-x-8 gap-y-4', className)}>
      <ChartRampStyle />
      <div className="relative shrink-0" style={{ width: DONUT_SIZE, height: DONUT_SIZE }}>
        <svg
          viewBox={`0 0 ${DONUT_SIZE} ${DONUT_SIZE}`}
          width={DONUT_SIZE}
          height={DONUT_SIZE}
          role="img"
          aria-label={`Donut chart, total ${center}`}
        >
          {arcs.map((arc) => {
            if (!arc) return null;
            const s = segments[arc.i];
            if (!s) return null;
            return (
              <path
                key={arc.i}
                d={arc.d}
                fill={colorOf(s, arc.i)}
                className="outline-none transition-opacity"
                opacity={hover === null || hover.i === arc.i ? 1 : 0.45}
                tabIndex={0}
                aria-label={`${s.label}: ${displayOf(s)}`}
                onMouseMove={(e) => {
                  const box = e.currentTarget.ownerSVGElement?.getBoundingClientRect();
                  if (box) setHover({ x: e.clientX - box.left, y: e.clientY - box.top, i: arc.i });
                }}
                onMouseLeave={() => setHover(null)}
                onFocus={() => {
                  const [x, y] = polar((R_OUTER + R_INNER) / 2, arc.mid);
                  setHover({ x, y, i: arc.i });
                }}
                onBlur={() => setHover(null)}
              />
            );
          })}
        </svg>
        {/* Center total — the donut's one direct label. Proportional figures. */}
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
          <span className="font-semibold text-foreground text-xl tracking-tight">{center}</span>
          <span className="text-[11px] text-muted-foreground">Total</span>
        </div>
        {hover !== null && segments[hover.i] && (
          <div
            className="pointer-events-none absolute z-10 w-max rounded-md bg-primary px-2.5 py-1 text-primary-foreground text-xs shadow-md"
            style={{ left: hover.x, top: hover.y - 10, transform: 'translate(-50%, -100%)' }}
          >
            <span className="font-semibold tabular-nums">
              {displayOf(segments[hover.i] as ChartDatum)}
            </span>{' '}
            <span className="opacity-80">{(segments[hover.i] as ChartDatum).label}</span>
          </div>
        )}
      </div>
      {/* Legend — always present; the accessible home of every value. */}
      <ul className="m-0 flex min-w-36 list-none flex-col gap-1.5 p-0">
        {segments.map((s, i) => (
          <li key={`${s.label}-${i}`} className="flex items-center gap-2 text-[13px]">
            <span
              aria-hidden="true"
              className="size-2.5 shrink-0 rounded-[2px]"
              style={{ background: colorOf(s, i) }}
            />
            <span className="min-w-0 flex-1 truncate text-foreground">{s.label}</span>
            <span className="text-muted-foreground tabular-nums">{displayOf(s)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/* ── StatTile ───────────────────────────────────────────────────────────── */

export function StatTile({
  label,
  value,
  delta,
  spark,
  loading,
  className,
}: {
  /** Sentence case, no trailing colon. */
  label: ReactNode;
  value?: ReactNode;
  delta?: { text: ReactNode; trend?: 'up' | 'down' | 'neutral' };
  /** Optional 12-point trend series. */
  spark?: number[];
  loading?: boolean;
  className?: string;
}) {
  return (
    <Card className={cn('nb-chart gap-0 px-5 py-4', className)}>
      <ChartRampStyle />
      <div className="font-medium text-[13px] text-muted-foreground">{label}</div>
      <div className="mt-1.5 flex items-end justify-between gap-3">
        {/* Big standalone number → proportional figures, never tabular-nums. */}
        <div className="min-h-8 font-semibold text-2xl text-foreground tracking-tight">
          {loading || value === undefined ? <Skeleton className="h-7 w-20" /> : value}
        </div>
        {spark && spark.length > 1 && !loading && (
          <Sparkline
            data={spark.slice(-12)}
            variant="line"
            height={24}
            width={72}
            color="var(--nb-chart-1)"
            className="mb-0.5"
            aria-label="Trend"
          />
        )}
      </div>
      {delta && !loading && (
        <div
          className={cn('mt-1 font-medium text-[11px]', {
            'text-[var(--success)]': delta.trend === 'up',
            'text-destructive': delta.trend === 'down',
            'text-muted-foreground': delta.trend === 'neutral' || !delta.trend,
          })}
        >
          {delta.text}
        </div>
      )}
    </Card>
  );
}
