'use client';

import { ActivityTimeline } from '@/components/northbeam/activity-timeline';
import { HidePageHead, PageActions } from '@/components/northbeam/app-shell';
import { CreateMenu } from '@/components/northbeam/create-menu';
import { EmptyState } from '@/components/northbeam/empty-state';
import { EyebrowLabel } from '@/components/northbeam/eyebrow-label';
import { MetricGroup } from '@/components/northbeam/metric-group';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { Skeleton } from '@/components/ui/skeleton';
import { Sparkline, fakeSeries } from '@/components/ui/sparkline';
import { trpc } from '@/lib/api';
import { fmtMoney } from '@/lib/mock-crm';
import {
  ArrowRight,
  Building2,
  Check,
  CircleDollarSign,
  RefreshCw,
  TrendingUp,
  UserPlus,
  Zap,
} from 'lucide-react';
import Link from 'next/link';

// Home — refined trading-terminal aesthetic. Hero pipeline number with a
// trend delta + inline sparkline, a MetricGroup count strip, an onboarding
// checklist with completion progress, and the recent-activity log.

// TODO(#11): wire real onboarding completion from server state.
const STEPS = [
  { href: '/migrate', label: 'Import from Salesforce' },
  { href: '/contacts', label: 'Add your first contact' },
  { href: '/deals', label: 'Create a deal' },
  { href: '/setup/users', label: 'Invite your team' },
];
const DONE = 1;

export default function HomePage() {
  const summary = trpc.home.summary.useQuery();
  const counts = summary.data?.counts;
  const loading = !summary.data;
  const activities = summary.data?.recentActivities ?? [];
  const pipelineValue = summary.data?.pipelineValue ?? 0;
  const dealCount = counts?.deals ?? 0;
  const series = fakeSeries(Math.max(1, Math.round(pipelineValue / 1000)), 24);

  return (
    <div className="flex flex-col">
      <HidePageHead />
      <PageActions>
        <Button variant="outline">
          <RefreshCw />
          Run migration
        </Button>
        <CreateMenu
          items={[
            { type: 'label', label: 'Create' },
            { type: 'item', icon: UserPlus, label: 'Contact' },
            { type: 'item', icon: Building2, label: 'Account' },
            { type: 'item', icon: CircleDollarSign, label: 'Deal' },
          ]}
        />
      </PageActions>

      <Card className="reveal reveal-1 p-6">
        <div className="flex items-center justify-between gap-4">
          <EyebrowLabel>Open pipeline</EyebrowLabel>
          <Link
            href="/pipeline"
            className="group inline-flex items-center gap-1.5 text-link text-xs underline-offset-4 hover:underline"
          >
            View pipeline
            <ArrowRight className="size-3 transition-transform group-hover:translate-x-0.5" />
          </Link>
        </div>
        <div className="mt-4 flex items-end justify-between gap-6">
          <div className="min-w-0 flex-1">
            {loading ? (
              <Skeleton className="h-14 w-64" />
            ) : (
              <div className="flex items-center gap-3">
                <span className="font-normal text-[clamp(2.25rem,5vw,3.75rem)] text-foreground leading-[1.05] tabular-nums tracking-[-0.035em]">
                  {fmtMoney(pipelineValue)}
                </span>
                <span className="inline-flex items-center gap-1 rounded-full bg-[var(--success)]/10 px-2 py-0.5 font-medium text-[var(--success)] text-xs tabular-nums">
                  <TrendingUp className="size-3" />
                  12.4%
                </span>
              </div>
            )}
            <div className="mt-3 flex items-center gap-2 text-muted-foreground text-sm">
              <span className="text-foreground tabular-nums">{dealCount.toLocaleString()}</span>
              <span>{dealCount === 1 ? 'open deal' : 'open deals'}</span>
              <span className="text-muted-foreground/40">·</span>
              <span className="text-[0.6875rem] uppercase tabular-nums tracking-[0.14em]">
                Last 30 days
              </span>
            </div>
          </div>
          {!loading && (
            <Sparkline
              data={series}
              variant="line"
              height={56}
              width={220}
              color="var(--accent)"
              className="hidden text-muted-foreground sm:block"
              aria-label="Pipeline activity over the last 30 days"
            />
          )}
        </div>
      </Card>

      <MetricGroup
        className="reveal reveal-2 mt-4"
        columns={3}
        loading={loading}
        items={[
          { label: 'Accounts', value: counts?.accounts?.toLocaleString() },
          { label: 'Contacts', value: counts?.contacts?.toLocaleString() },
          { label: 'Deals', value: counts?.deals?.toLocaleString() },
        ]}
      />

      <section className="reveal reveal-3 mt-6 grid grid-cols-1 gap-4 lg:grid-cols-[1.6fr_1fr]">
        <Card className="p-5">
          <div className="mb-4 flex items-baseline justify-between">
            <EyebrowLabel>Recent activity</EyebrowLabel>
            <Link
              href="/activities"
              className="text-link text-xs underline-offset-4 hover:underline"
            >
              View all
            </Link>
          </div>
          {loading && (
            <div className="space-y-3">
              <Skeleton className="h-6 w-3/4" />
              <Skeleton className="h-6 w-1/2" />
              <Skeleton className="h-6 w-2/3" />
              <Skeleton className="h-6 w-3/5" />
            </div>
          )}
          {!loading && activities.length === 0 && (
            <EmptyState
              icon={Zap}
              size="sm"
              title="No activity yet"
              body="Log a call, send an email, or run a Salesforce migration to see your team's work here."
            />
          )}
          {!loading && activities.length > 0 && <ActivityTimeline items={activities} />}
        </Card>

        <OnboardingChecklist />
      </section>
    </div>
  );
}

function OnboardingChecklist() {
  const pct = Math.round((DONE / STEPS.length) * 100);
  return (
    <Card className="p-5">
      <div className="mb-3 flex items-baseline justify-between">
        <EyebrowLabel>Get started</EyebrowLabel>
        <span className="font-medium text-muted-foreground text-xs tabular-nums">
          {DONE}/{STEPS.length}
        </span>
      </div>
      <Progress value={pct} />
      <ul className="-mx-2 mt-4 flex flex-col">
        {STEPS.map((step, i) => {
          const done = i < DONE;
          return (
            <li key={step.href}>
              <Link
                href={step.href}
                className="group flex items-center gap-3 rounded-md px-2 py-2 text-sm transition-colors hover:bg-muted/40"
              >
                <span
                  className={`grid size-4 place-items-center rounded-full border ${done ? 'border-transparent bg-[var(--success)] text-white' : 'border-muted-foreground/30'}`}
                >
                  {done && <Check className="size-2.5" strokeWidth={3} />}
                </span>
                <span
                  className={`flex-1 ${done ? 'text-muted-foreground line-through' : 'text-foreground'}`}
                >
                  {step.label}
                </span>
                {!done && (
                  <ArrowRight className="size-3.5 text-muted-foreground/40 transition-all group-hover:translate-x-0.5 group-hover:text-muted-foreground" />
                )}
              </Link>
            </li>
          );
        })}
      </ul>
    </Card>
  );
}
