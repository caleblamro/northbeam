'use client';

import { PageActions } from '@/components/northbeam/app-shell';
import { SectionCard } from '@/components/northbeam/section-card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { InputGroup, InputGroupAddon, InputGroupInput } from '@/components/ui/input-group';
import { fmtMoney } from '@/lib/mock-crm';
import {
  AlertTriangle,
  ArrowRight,
  BookOpen,
  ChartLine,
  Plus,
  RefreshCw,
  Sparkles,
  TrendingUp,
  Zap,
} from 'lucide-react';
import { useState } from 'react';

const SUGGESTIONS = [
  'Show me deals slipping this quarter',
  'Which accounts are at risk of churn?',
  'Pipeline created vs. closed this month',
  'Top performing owners by win rate',
];

const INSIGHTS = [
  { tone: 'danger' as const, icon: AlertTriangle, title: 'Meridian Health is at risk', body: 'No activity in 18 days on a $220K open deal.' },
  { tone: 'warning' as const, icon: RefreshCw, title: '3 deals slipped close dates', body: 'Northwind, Atlas, and Cobalt pushed past their forecast.' },
  { tone: 'success' as const, icon: TrendingUp, title: 'Win rate up 8 points', body: 'Closed-won climbed to 41% over the last 30 days.' },
];

const TONE_CLASS: Record<'danger' | 'warning' | 'success', string> = {
  danger: 'bg-destructive/10 text-destructive',
  warning: 'bg-amber-500/15 text-amber-600 dark:text-amber-400',
  success: 'bg-green-500/15 text-green-600 dark:text-green-400',
};

export default function ReportsPage() {
  const [q, setQ] = useState('');

  return (
    <>
      <PageActions>
        <Button variant="outline">
          <Plus />
          New report
        </Button>
      </PageActions>

      <InputGroup className="mb-2.5">
        <InputGroupAddon>
          <Sparkles className="text-primary" />
        </InputGroupAddon>
        <InputGroupInput
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Ask anything about your pipeline…"
        />
        <InputGroupAddon align="inline-end">
          <Button size="sm">
            Ask
            <ArrowRight />
          </Button>
        </InputGroupAddon>
      </InputGroup>
      <div className="mb-6 flex flex-wrap gap-1.5">
        {SUGGESTIONS.map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => setQ(s)}
            className="rounded-full border bg-card px-3 py-1 text-muted-foreground text-xs hover:border-primary/30 hover:text-primary"
          >
            {s}
          </button>
        ))}
      </div>

      <div className="mb-6 grid gap-3 md:grid-cols-3">
        {INSIGHTS.map((i) => {
          const IconCmp = i.icon;
          return (
            <SectionCard key={i.title}>
              <div className="flex gap-3">
                <div className={`grid size-9 shrink-0 place-items-center rounded-md ${TONE_CLASS[i.tone]}`}>
                  <IconCmp className="size-4" />
                </div>
                <div className="min-w-0">
                  <h4 className="font-semibold text-foreground text-sm">{i.title}</h4>
                  <p className="mt-1 text-muted-foreground text-xs leading-snug">{i.body}</p>
                </div>
              </div>
            </SectionCard>
          );
        })}
      </div>

      <div className="grid gap-4 lg:grid-cols-[1.4fr_1fr]">
        <SectionCard icon={ChartLine} title="Revenue forecast">
          <p className="text-muted-foreground text-sm">
            Forecast vs. actual chart placeholder. Wire to real data once the reports query layer
            ships (#32 + #11).
          </p>
        </SectionCard>
        <div className="flex flex-col gap-4">
          <SectionCard icon={Zap} title="What changed this week">
            <p className="text-sm leading-relaxed">
              Pipeline grew{' '}
              <span className="font-semibold text-green-600">+{fmtMoney(18_000_00)}</span>{' '}
              with 4 new deals. Two closed won, 3 slipped past close. Net new pipeline
              <span className="font-semibold text-green-600"> +12% MoM</span>.
            </p>
          </SectionCard>
          <SectionCard icon={BookOpen} title="Saved reports">
            <p className="text-muted-foreground text-sm">Saved-report list comes online with #11.</p>
          </SectionCard>
        </div>
      </div>
    </>
  );
}
