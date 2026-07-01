'use client';

import { PageActions } from '@/components/northbeam/app-shell';
import { CreateCard } from '@/components/northbeam/create-card';
import { EmptyState } from '@/components/northbeam/empty-state';
import { IconTile } from '@/components/northbeam/icon-tile';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Sparkline, fakeSeries } from '@/components/ui/sparkline';
import { Building2, ChartLine, LayoutDashboard, Plus, RefreshCw, Zap } from 'lucide-react';

type Dash = {
  id: string;
  name: string;
  desc: string;
  icon: typeof Building2;
  tiles: number;
  owner: string;
  shared?: boolean;
  spark: 'bars' | 'line';
  seed: number;
};

const DASHBOARDS: Dash[] = [
  {
    id: 'd1',
    name: 'Revenue overview',
    desc: 'Pipeline, bookings, and forecast at a glance.',
    icon: ChartLine,
    tiles: 8,
    owner: 'Jordan Mills',
    shared: true,
    spark: 'line',
    seed: 17,
  },
  {
    id: 'd2',
    name: 'Sales activity',
    desc: 'Calls, emails, and meetings by rep this week.',
    icon: Zap,
    tiles: 6,
    owner: 'Aisha Khan',
    spark: 'bars',
    seed: 41,
  },
  {
    id: 'd3',
    name: 'Account health',
    desc: 'At-risk accounts and renewal exposure.',
    icon: Building2,
    tiles: 5,
    owner: 'Ravi Teja',
    shared: true,
    spark: 'line',
    seed: 8,
  },
  {
    id: 'd4',
    name: 'Migration audit',
    desc: 'Records imported and field-mapping confidence.',
    icon: RefreshCw,
    tiles: 4,
    owner: 'System',
    spark: 'bars',
    seed: 23,
  },
];

export default function DashboardsPage() {
  return (
    <>
      <PageActions>
        <Button>
          <Plus />
          New dashboard
        </Button>
      </PageActions>

      {DASHBOARDS.length === 0 ? (
        <EmptyState
          icon={LayoutDashboard}
          title="No dashboards yet"
          body="Build a dashboard to track pipeline, activity, and account health in one place."
          action={
            <Button>
              <Plus />
              New dashboard
            </Button>
          }
        />
      ) : (
        <div className="grid gap-3.5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {DASHBOARDS.map((d, i) => (
            <Card
              key={d.id}
              className="reveal lift cursor-pointer gap-4"
              style={{ '--reveal-delay': `${i * 40}ms` } as React.CSSProperties}
            >
              <CardHeader>
                <div className="flex items-start justify-between gap-3">
                  <div className="flex min-w-0 items-center gap-3">
                    <IconTile icon={d.icon} tone={d.shared ? 'accent' : 'neutral'} />
                    <div className="min-w-0">
                      <CardTitle className="truncate">{d.name}</CardTitle>
                      <p className="text-muted-foreground text-xs tabular-nums">{d.tiles} tiles</p>
                    </div>
                  </div>
                  <Sparkline
                    data={fakeSeries(d.seed, d.spark === 'bars' ? 12 : 18)}
                    variant={d.spark}
                    height={26}
                    color="var(--accent)"
                    className="mt-0.5 text-link"
                    aria-label={`${d.name} trend`}
                  />
                </div>
              </CardHeader>
              <CardContent className="text-muted-foreground text-sm leading-snug">
                {d.desc}
              </CardContent>
            </Card>
          ))}
          <CreateCard label="Create dashboard" className="reveal reveal-4 min-h-full" />
        </div>
      )}
    </>
  );
}
