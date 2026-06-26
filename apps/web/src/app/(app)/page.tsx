'use client';

import { ActivityTimeline } from '@/components/northbeam/activity-timeline';
import { HidePageHead, PageActions } from '@/components/northbeam/app-shell';
import { CreateMenu } from '@/components/northbeam/create-menu';
import { EmptyState } from '@/components/northbeam/empty-state';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Sparkline, fakeSeries } from '@/components/ui/sparkline';
import { trpc } from '@/lib/api';
import { fmtMoney } from '@/lib/mock-crm';
import { ArrowRight, Building2, CircleDollarSign, RefreshCw, UserPlus, Zap } from 'lucide-react';
import Link from 'next/link';

// Home — refined trading-terminal aesthetic. Hero pipeline number in
// JetBrains Mono Light 300 (instantly distinctive), inline activity sparkline,
// hairline-divided metric strip, compact recent-activity log.

export default function HomePage() {
  const summary = trpc.home.summary.useQuery();
  const counts = summary.data?.counts;
  const loading = !summary.data;
  const activities = summary.data?.recentActivities ?? [];
  const pipelineValue = summary.data?.pipelineValue ?? 0;
  const dealCount = counts?.deals ?? 0;

  // Deterministic faux activity-density series — real history wires in #11.
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

      {/* Hero: pipeline value as the page's anchor. Inter at huge size with
          tight tracking — refined, not mono. */}
      <Card className="p-6">
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
              <div className="font-normal text-[clamp(2.25rem,5vw,3.75rem)] text-foreground leading-[1.05] tabular-nums tracking-[-0.035em]">
                {fmtMoney(pipelineValue)}
              </div>
            )}
            <div className="mt-3 flex items-center gap-2 text-muted-foreground text-sm">
              <span className="tabular-nums text-foreground">{dealCount.toLocaleString()}</span>
              <span>{dealCount === 1 ? 'open deal' : 'open deals'}</span>
              <span className="text-muted-foreground/40">·</span>
              <span className="text-[0.6875rem] tabular-nums uppercase tracking-[0.14em]">
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
              className="text-muted-foreground hidden sm:block"
              aria-label="Pipeline activity over the last 30 days"
            />
          )}
        </div>
      </Card>

      {/* 3-up metric tiles using soft Cards. Each tile has a small sparkline
          peeking out next to the eyebrow label — adds visual texture without
          shouting. */}
      <section className="mt-4 grid grid-cols-3 gap-4">
        <MetricCell
          label="Accounts"
          value={counts?.accounts}
          loading={loading}
          href="/accounts"
          seed={1}
        />
        <MetricCell
          label="Contacts"
          value={counts?.contacts}
          loading={loading}
          href="/contacts"
          seed={2}
        />
        <MetricCell label="Deals" value={counts?.deals} loading={loading} href="/deals" seed={3} />
      </section>

      {/* Activity + Quick start */}
      <section className="mt-6 grid grid-cols-1 gap-4 lg:grid-cols-[1.6fr_1fr]">
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

        <Card className="p-5">
          <div className="mb-4 flex items-baseline justify-between">
            <EyebrowLabel>Quick start</EyebrowLabel>
          </div>
          <ul className="-mx-2 flex flex-col">
            <QuickItem index="01" href="/migrate" label="Import from Salesforce" />
            <QuickItem index="02" href="/contacts" label="Add your first contact" />
            <QuickItem index="03" href="/deals" label="Create a deal" />
            <QuickItem index="04" href="/setup/users" label="Invite your team" />
          </ul>
        </Card>
      </section>
    </div>
  );
}

function EyebrowLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="font-medium text-[0.6875rem] text-muted-foreground uppercase tracking-[0.16em]">
      {children}
    </div>
  );
}

function MetricCell({
  label,
  value,
  loading,
  href,
  seed,
}: {
  label: string;
  value?: number;
  loading: boolean;
  href: string;
  seed: number;
}) {
  const series = fakeSeries(seed * (value ?? 1), 14);
  return (
    <Link href={href} className="group">
      <Card className="flex h-full flex-col gap-5 p-5 transition-shadow hover:shadow-sm">
        <div className="flex items-center justify-between gap-3">
          <EyebrowLabel>{label}</EyebrowLabel>
          <Sparkline
            data={series}
            variant="bars"
            height={16}
            barWidth={1.5}
            gap={1.5}
            color="var(--accent)"
            className="text-muted-foreground opacity-50 transition-opacity group-hover:opacity-100"
          />
        </div>
        {loading ? (
          <Skeleton className="h-8 w-20" />
        ) : (
          <div className="font-normal text-3xl text-foreground tabular-nums tracking-[-0.03em]">
            {value?.toLocaleString() ?? '—'}
          </div>
        )}
      </Card>
    </Link>
  );
}

function QuickItem({
  index,
  href,
  label,
}: {
  index: string;
  href: string;
  label: string;
}) {
  return (
    <li>
      <Link
        href={href}
        className="group flex items-center gap-4 rounded-md px-2 py-2 text-sm transition-colors hover:bg-muted/40"
      >
        <span className="text-[0.6875rem] text-muted-foreground/60 tabular-nums tracking-[0.08em]">
          {index}
        </span>
        <span className="flex-1 text-foreground">{label}</span>
        <ArrowRight className="size-3.5 text-muted-foreground/40 transition-all group-hover:translate-x-0.5 group-hover:text-muted-foreground" />
      </Link>
    </li>
  );
}
