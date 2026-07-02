'use client';

import { PageActions } from '@/components/northbeam/app-shell';
import { InsightCard } from '@/components/northbeam/insight-card';
import { SavedReports } from '@/components/northbeam/saved-reports';
import { SectionCard } from '@/components/northbeam/section-card';
import { Button } from '@/components/ui/button';
import { Chip } from '@/components/ui/chip';
import { InputGroup, InputGroupAddon, InputGroupInput } from '@/components/ui/input-group';
import { Kbd } from '@/components/ui/kbd';
import { Sparkline } from '@/components/ui/sparkline';
import { fmtMoney } from '@/lib/mock-crm';
import { AlertTriangle, ArrowRight, Plus, RefreshCw, Sparkles, TrendingUp } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';

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

export default function ReportsPage() {
  const [q, setQ] = useState('');

  return (
    <>
      <PageActions>
        <Button variant="outline" asChild>
          <Link href="/reports/builder">
            <Plus />
            New report
          </Link>
        </Button>
      </PageActions>

      <div className="reveal reveal-1 mb-3">
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

      <div className="reveal reveal-2 mb-7 flex flex-wrap gap-1.5">
        {SUGGESTIONS.map((s) => (
          <Chip key={s} selected={false} onClick={() => setQ(s)}>
            {s}
          </Chip>
        ))}
      </div>

      <div className="mb-7 grid gap-3 md:grid-cols-3">
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

      <div className="grid gap-4 lg:grid-cols-[1.4fr_1fr]">
        <div className="reveal" style={{ '--reveal-delay': '320ms' } as React.CSSProperties}>
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
        </div>
        <div className="flex flex-col gap-4">
          <div className="reveal" style={{ '--reveal-delay': '380ms' } as React.CSSProperties}>
            <SectionCard title="What changed this week">
              <p className="text-sm leading-relaxed text-foreground">
                Pipeline grew{' '}
                <span className="font-medium text-[var(--success)]">+{fmtMoney(18_000_00)}</span>{' '}
                with 4 new deals. Two closed won, 3 slipped past close. Net new pipeline
                <span className="font-medium text-[var(--success)]"> +12% MoM</span>.
              </p>
            </SectionCard>
          </div>
          <div className="reveal" style={{ '--reveal-delay': '440ms' } as React.CSSProperties}>
            <SectionCard title="Saved reports">
              <SavedReports />
            </SectionCard>
          </div>
        </div>
      </div>
    </>
  );
}
