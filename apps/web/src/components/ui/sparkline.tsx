// Sparkline — inline SVG bar chart for the trading-terminal aesthetic.
// Renders a hairline-spaced series of bars. Pass `data` (positive numbers);
// bars get scaled to the max so the silhouette is preserved at any size.
//
// Variants:
//   `bars`  → discrete bars with 1px gaps (default; reads as activity log).
//   `line`  → connected line with optional area fill (reads as trend).
//
// Use it INLINE next to a number (`flex items-end gap-3`) — the visual chunk
// makes a metric feel like a quote, not a static figure.

import { cn } from "@/lib/cn";

interface SparklineProps {
  data: number[];
  variant?: "bars" | "line";
  width?: number;
  height?: number;
  color?: string;
  /** Width of each bar in `bars` mode. 2px gives a refined look. */
  barWidth?: number;
  /** Px gap between bars. */
  gap?: number;
  className?: string;
  "aria-label"?: string;
}

export function Sparkline({
  data,
  variant = "bars",
  width,
  height = 28,
  color = "currentColor",
  barWidth = 2,
  gap = 2,
  className,
  "aria-label": ariaLabel,
}: SparklineProps) {
  if (!data.length) return null;
  const max = Math.max(...data, 1);
  const actualWidth = width ?? data.length * (barWidth + gap) - gap;

  if (variant === "line") {
    const stepX = actualWidth / Math.max(data.length - 1, 1);
    const pts = data
      .map((v, i) => `${(i * stepX).toFixed(2)},${(height - (v / max) * height).toFixed(2)}`)
      .join(" ");
    const area = `M0,${height} L${pts.split(" ").join(" L")} L${actualWidth},${height} Z`;
    return (
      <svg
        viewBox={`0 0 ${actualWidth} ${height}`}
        width={actualWidth}
        height={height}
        className={cn("shrink-0", className)}
        aria-label={ariaLabel}
        role={ariaLabel ? "img" : undefined}
        aria-hidden={ariaLabel ? undefined : "true"}
      >
        <path d={area} fill={color} opacity={0.08} />
        <polyline points={pts} stroke={color} strokeWidth={1.25} fill="none" />
      </svg>
    );
  }

  return (
    <svg
      viewBox={`0 0 ${actualWidth} ${height}`}
      width={actualWidth}
      height={height}
      className={cn("shrink-0", className)}
      aria-label={ariaLabel}
      role={ariaLabel ? "img" : undefined}
      aria-hidden={ariaLabel ? undefined : "true"}
    >
      {data.map((v, i) => {
        const h = (v / max) * height;
        const x = i * (barWidth + gap);
        const y = height - h;
        return (
          <rect
            key={`${i}-${v}`}
            x={x}
            y={y}
            width={barWidth}
            height={Math.max(h, 1)}
            fill={color}
            rx={0.5}
          />
        );
      })}
    </svg>
  );
}

/** Deterministic pseudo-series from a seed — for surfaces without real history. */
export function fakeSeries(seed: number, length = 18): number[] {
  const out: number[] = [];
  let s = seed || 1;
  for (let i = 0; i < length; i++) {
    s = (s * 9301 + 49297) % 233280;
    out.push(0.3 + (s / 233280) * 0.7);
  }
  return out;
}
