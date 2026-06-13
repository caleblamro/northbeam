'use client';

import { ActivityTimeline } from '@/components/northbeam/activity-timeline';
import { PageActions } from '@/components/northbeam/app-shell';
import { CreateMenu } from '@/components/northbeam/create-menu';
import { DescriptionList } from '@/components/northbeam/description-list';
import { EmptyState } from '@/components/northbeam/empty-state';
import { MetricGroup } from '@/components/northbeam/metric-group';
import { SectionCard } from '@/components/northbeam/section-card';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { trpc } from '@/lib/api';
import { fmtMoney } from '@/lib/mock-crm';
import {
  ArrowRight,
  Building2,
  CircleDollarSign,
  RefreshCw,
  TrendingUp,
  UserPlus,
  Users,
  Zap,
} from 'lucide-react';

export default function HomePage() {
  const summary = trpc.home.summary.useQuery();
  const counts = summary.data?.counts;
  const loading = !summary.data;
  const activities = summary.data?.recentActivities ?? [];

  return (
    <>
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

      <MetricGroup
        loading={loading}
        items={[
          { label: 'Accounts', value: counts?.accounts.toLocaleString() },
          { label: 'Contacts', value: counts?.contacts.toLocaleString() },
          {
            label: 'Open pipeline',
            value: summary.data && fmtMoney(summary.data.pipelineValue),
            delta: counts && { text: `${counts.deals} open deals`, trend: 'neutral' },
          },
          { label: 'Deals', value: counts?.deals.toLocaleString() },
        ]}
      />

      <div className="mt-6 grid gap-4 lg:grid-cols-[1.4fr_1fr]">
        <SectionCard icon={Zap} title="Recent activity">
          {loading && (
            <div className="space-y-3">
              <Skeleton className="h-6 w-3/4" />
              <Skeleton className="h-6 w-1/2" />
              <Skeleton className="h-6 w-2/3" />
            </div>
          )}
          {!loading && activities.length === 0 && (
            <EmptyState
              icon={Zap}
              size="sm"
              title="No activity yet"
              body="Log a call, send an email, or run a Salesforce migration."
            />
          )}
          {!loading && activities.length > 0 && <ActivityTimeline items={activities} />}
        </SectionCard>

        <div className="flex flex-col gap-4">
          <SectionCard icon={TrendingUp} title="Pipeline value">
            {loading ? (
              <>
                <Skeleton className="h-8 w-32" />
                <Skeleton className="mt-2 h-4 w-40" />
              </>
            ) : (
              <>
                <div className="font-semibold text-2xl tabular-nums tracking-tight">
                  {fmtMoney(summary.data!.pipelineValue)}
                </div>
                <p className="mt-1 text-muted-foreground text-sm">
                  Across {counts!.deals} open deals.
                </p>
                <Button variant="link" className="mt-2 h-auto p-0">
                  View pipeline
                  <ArrowRight />
                </Button>
              </>
            )}
          </SectionCard>
          <SectionCard icon={Users} title="Workspace at a glance">
            {loading ? (
              <div className="space-y-2">
                <Skeleton className="h-5 w-full" />
                <Skeleton className="h-5 w-full" />
                <Skeleton className="h-5 w-full" />
              </div>
            ) : (
              <DescriptionList
                items={[
                  {
                    label: 'Accounts',
                    value: counts!.accounts.toLocaleString(),
                    valueClassName: 'tabular-nums',
                  },
                  {
                    label: 'Contacts',
                    value: counts!.contacts.toLocaleString(),
                    valueClassName: 'tabular-nums',
                  },
                  {
                    label: 'Deals',
                    value: counts!.deals.toLocaleString(),
                    valueClassName: 'tabular-nums',
                  },
                ]}
              />
            )}
          </SectionCard>
        </div>
      </div>
    </>
  );
}
