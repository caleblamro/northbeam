'use client';

// Reports-overview sections — the /reports index composes these: the natural-
// language ask bar (+ suggestion chips), the insight tile row, the revenue
// forecast panel, and the weekly-change note. Ask/insights/forecast carry
// mock data at v1 — the saved-report list next to them is live (see
// saved-reports.tsx). Extracted so the page stays inside its 30–80 line
// budget while owning the section rhythm (mb-7) and reveal stagger.

import { SectionCard } from '@/components/northbeam/section-card';
import { Button } from '@/components/ui/button';
import { Chip } from '@/components/ui/chip';
import { InputGroup, InputGroupAddon, InputGroupInput } from '@/components/ui/input-group';
import { Kbd } from '@/components/ui/kbd';
import { Sparkline } from '@/components/ui/sparkline';
import { fmtMoney } from '@/lib/mock-crm';
import { AlertTriangle, ArrowRight, RefreshCw, Sparkles, TrendingUp } from 'lucide-react';
import { useState } from 'react';
import { InsightCard } from './insight-card';

const SUGGESTIONS = [
  'Show me deals slipping this quarter',
  'Which accounts are at risk of churn?',
  'Pipeline created vs. closed this month',
  'Top performing owners by win rate',
];

const INSIGHTS = [
  {
    tone: 'danger' as const,
    icon: AlertTriangle,
    title: 'Meridian Health is at risk',
    body: 'No activity in 18 days on a $220K open deal.',
  },
  {
    tone: 'warning' as const,
    icon: RefreshCw,
    title: '3 deals slipped close dates',
    body: 'Northwind, Atlas, and Cobalt pushed past their forecast.',
  },
  {
    tone: 'success' as const,
    icon: TrendingUp,
    title: 'Win rate up 8 points',
    body: 'Closed-won climbed to 41% over the last 30 days.',
  },
];

// Mock forecast-vs-actual, in cents. Actual tracks just under forecast, closing the gap.
const FORECAST = [62, 68, 71, 79, 84, 90, 96, 103, 110, 118, 126, 135].map((v) => v * 1000_00);
const ACTUAL = [60, 64, 70, 74, 82, 86, 95, 99, 108, 114, 121, 129].map((v) => v * 1000_00);

/** The AI ask bar + suggestion chips. The input is a shortcut into the same
 *  flow the ⌘K palette's "AI" group opens — never the only door. */
export function ReportsAskBar() {
  const [q, setQ] = useState('');
  return (
    <div className="flex flex-col gap-3">
      <div className="reveal reveal-1">
        <InputGroup className="h-11 has-[[data-slot=input-group-control]:focus-visible]:border-accent has-[[data-slot=input-group-control]:focus-visible]:ring-accent/25">
          <InputGroupAddon>
            <Sparkles className="size-[1.125rem] text-accent" />
          </InputGroupAddon>
          <InputGroupInput
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Ask anything about your pipeline…"
            className="text-[0.9375rem]"
          />
          <InputGroupAddon align="inline-end">
            <Kbd>⌘K</Kbd>
            <Button size="sm">
              Ask
              <ArrowRight />
            </Button>
          </InputGroupAddon>
        </InputGroup>
      </div>
      <div className="reveal reveal-2 flex flex-wrap gap-1.5">
        {SUGGESTIONS.map((s) => (
          <Chip key={s} selected={false} onClick={() => setQ(s)}>
            {s}
          </Chip>
        ))}
      </div>
    </div>
  );
}

/** Three insight tiles with a per-tile reveal stagger. */
export function ReportsInsights() {
  return (
    <div className="grid gap-3 md:grid-cols-3">
      {INSIGHTS.map((i, idx) => (
        <div
          key={i.title}
          className="reveal"
          style={{ '--reveal-delay': `${120 + idx * 60}ms` } as React.CSSProperties}
        >
          <InsightCard icon={i.icon} tone={i.tone} title={i.title} body={i.body} />
        </div>
      ))}
    </div>
  );
}

/** Forecast-vs-actual panel — two overlaid single-hue sparklines with an
 *  inline legend; the accent line is the forecast, ink is actual. */
export function RevenueForecastCard() {
  return (
    <SectionCard title="Revenue forecast">
      <div className="mb-4 flex items-baseline gap-4 text-xs">
        <span className="flex items-center gap-1.5 text-muted-foreground">
          <span className="inline-block h-0.5 w-3 rounded-full bg-accent" />
          Forecast
        </span>
        <span className="flex items-center gap-1.5 text-muted-foreground">
          <span className="inline-block h-0.5 w-3 rounded-full bg-foreground" />
          Actual
        </span>
        <span className="ml-auto font-medium text-foreground tabular-nums">
          {fmtMoney(ACTUAL.at(-1) ?? 0)}{' '}
          <span className="text-[var(--success)]">of {fmtMoney(FORECAST.at(-1) ?? 0)}</span>
        </span>
      </div>
      <div className="relative h-[120px] w-full overflow-hidden">
        <Sparkline
          data={FORECAST}
          variant="line"
          width={640}
          height={120}
          color="var(--accent)"
          className="absolute inset-0 h-full w-full"
          aria-label="Forecasted revenue trend"
        />
        <Sparkline
          data={ACTUAL}
          variant="line"
          width={640}
          height={120}
          color="var(--foreground)"
          className="absolute inset-0 h-full w-full"
          aria-label="Actual revenue trend"
        />
      </div>
    </SectionCard>
  );
}

/** The narrative "what changed" note beside the forecast panel. */
export function WeeklyChangeCard() {
  return (
    <SectionCard title="What changed this week">
      <p className="text-sm leading-relaxed text-foreground">
        Pipeline grew{' '}
        <span className="font-medium text-[var(--success)]">+{fmtMoney(18_000_00)}</span> with 4 new
        deals. Two closed won, 3 slipped past close. Net new pipeline
        <span className="font-medium text-[var(--success)]"> +12% MoM</span>.
      </p>
    </SectionCard>
  );
}
