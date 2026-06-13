'use client';

import { PageActions } from '@/components/northbeam/app-shell';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  BarChart3,
  Building2,
  ChartLine,
  Plus,
  RefreshCw,
  Zap,
} from 'lucide-react';

type Dash = {
  id: string;
  name: string;
  desc: string;
  icon: typeof Building2;
  tiles: number;
  owner: string;
  shared?: boolean;
};

const DASHBOARDS: Dash[] = [
  { id: 'd1', name: 'Revenue overview', desc: 'Pipeline, bookings, and forecast at a glance.', icon: ChartLine, tiles: 8, owner: 'Jordan Mills', shared: true },
  { id: 'd2', name: 'Sales activity', desc: 'Calls, emails, and meetings by rep this week.', icon: Zap, tiles: 6, owner: 'Aisha Khan' },
  { id: 'd3', name: 'Account health', desc: 'At-risk accounts and renewal exposure.', icon: Building2, tiles: 5, owner: 'Ravi Teja', shared: true },
  { id: 'd4', name: 'Migration audit', desc: 'Records imported and field-mapping confidence.', icon: RefreshCw, tiles: 4, owner: 'System' },
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

      <div className="grid gap-3.5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {DASHBOARDS.map((d) => {
          const IconCmp = d.icon;
          return (
            <Card key={d.id} className="cursor-pointer transition-shadow hover:shadow-sm">
              <CardHeader>
                <div className="flex items-center gap-3">
                  <div className="grid size-9 place-items-center rounded-md bg-primary/10 text-primary">
                    <IconCmp className="size-4" />
                  </div>
                  <div className="min-w-0">
                    <CardTitle>{d.name}</CardTitle>
                    <p className="text-muted-foreground text-xs">{d.tiles} tiles</p>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="text-muted-foreground text-sm leading-snug">
                {d.desc}
              </CardContent>
            </Card>
          );
        })}
        <Card className="grid cursor-pointer place-items-center border-dashed bg-transparent py-10 text-center text-muted-foreground hover:bg-muted/40">
          <div>
            <Plus className="mx-auto mb-2 size-5" />
            <span className="font-semibold text-foreground">Create dashboard</span>
          </div>
        </Card>
      </div>
    </>
  );
}
