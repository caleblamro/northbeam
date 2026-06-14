'use client';

import { ActivityTimeline } from '@/components/northbeam/activity-timeline';
import { PageActions } from '@/components/northbeam/app-shell';
import { CreateMenu } from '@/components/northbeam/create-menu';
import { EmptyState } from '@/components/northbeam/empty-state';
import { SectionCard } from '@/components/northbeam/section-card';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { trpc } from '@/lib/api';
import { fmtMoney } from '@/lib/mock-crm';
import {
  ArrowRight,
  ArrowUpRight,
  Building2,
  CircleDollarSign,
  RefreshCw,
  UserPlus,
  Zap,
} from 'lucide-react';
import Link from 'next/link';

export default function HomePage() {
  const summary = trpc.home.summary.useQuery();
  const counts = summary.data?.counts;
  const loading = !summary.data;
  const activities = summary.data?.recentActivities ?? [];
  const pipelineValue = summary.data?.pipelineValue ?? 0;
  const dealCount = counts?.deals ?? 0;

  return (
    <div className="flex flex-col gap-6">
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

      <HeroCard
        loading={loading}
        pipelineValue={pipelineValue}
        dealCount={dealCount}
        counts={counts}
      />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1.5fr_1fr]">
        <SectionCard
          title="Recent activity"
          action={
            <Link
              href="/activities"
              className="text-link text-sm underline-offset-4 hover:underline"
            >
              View all
            </Link>
          }
        >
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
        </SectionCard>

        <SectionCard title="Quick start">
          <ul className="flex flex-col gap-1">
            <QuickItem href="/migrate" label="Import from Salesforce" />
            <QuickItem href="/contacts" label="Add your first contact" />
            <QuickItem href="/deals" label="Create a deal" />
            <QuickItem href="/setup/users" label="Invite your team" />
          </ul>
        </SectionCard>
      </div>
    </div>
  );
}

function HeroCard({
  loading,
  pipelineValue,
  dealCount,
  counts,
}: {
  loading: boolean;
  pipelineValue: number;
  dealCount: number;
  counts: { accounts: number; contacts: number; deals: number } | undefined;
}) {
  return (
    <Card className="gap-0 overflow-hidden py-0">
      <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
        <Link
          href="/pipeline"
          className="group flex flex-col justify-between gap-4 border-b border-border p-6 lg:border-b-0 lg:border-r"
        >
          <div className="flex items-center justify-between gap-3">
            <div className="font-medium text-[0.6875rem] text-muted-foreground uppercase tracking-[0.14em]">
              Open pipeline
            </div>
            <ArrowUpRight className="size-3.5 text-muted-foreground/60 transition-colors group-hover:text-foreground" />
          </div>
          {loading ? (
            <Skeleton className="h-12 w-48" />
          ) : (
            <div className="font-medium text-4xl text-foreground tabular-nums tracking-[-0.025em] lg:text-[2.75rem]">
              {fmtMoney(pipelineValue)}
            </div>
          )}
          <div className="text-muted-foreground text-sm">
            Across {dealCount.toLocaleString()} open {dealCount === 1 ? 'deal' : 'deals'}.
          </div>
        </Link>

        <div className="grid grid-cols-3 divide-x divide-border">
          <MetricCell
            label="Accounts"
            value={counts?.accounts}
            loading={loading}
            href="/accounts"
          />
          <MetricCell
            label="Contacts"
            value={counts?.contacts}
            loading={loading}
            href="/contacts"
          />
          <MetricCell
            label="Deals"
            value={counts?.deals}
            loading={loading}
            href="/deals"
          />
        </div>
      </div>
    </Card>
  );
}

function MetricCell({
  label,
  value,
  loading,
  href,
}: {
  label: string;
  value?: number;
  loading: boolean;
  href: string;
}) {
  return (
    <Link
      href={href}
      className="group flex flex-col justify-between gap-4 p-5 transition-colors hover:bg-muted/40"
    >
      <div className="flex items-center justify-between gap-3">
        <div className="font-medium text-[0.6875rem] text-muted-foreground uppercase tracking-[0.14em]">
          {label}
        </div>
        <ArrowUpRight className="size-3.5 text-muted-foreground/0 transition-colors group-hover:text-muted-foreground" />
      </div>
      {loading ? (
        <Skeleton className="h-8 w-16" />
      ) : (
        <div className="font-medium text-2xl text-foreground tabular-nums tracking-[-0.02em]">
          {value?.toLocaleString() ?? '—'}
        </div>
      )}
    </Link>
  );
}

function QuickItem({ href, label }: { href: string; label: string }) {
  return (
    <li>
      <Link
        href={href}
        className="group -mx-2 flex items-center gap-2.5 rounded-md px-2 py-1.5 text-sm transition-colors hover:bg-muted/60"
      >
        <span className="flex-1 text-foreground">{label}</span>
        <ArrowRight className="size-3.5 text-muted-foreground/40 transition-all group-hover:translate-x-0.5 group-hover:text-muted-foreground" />
      </Link>
    </li>
  );
}
