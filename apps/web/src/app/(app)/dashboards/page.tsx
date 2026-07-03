'use client';

import { useAiComposer } from '@/components/northbeam/ai-composer';
import { PageActions } from '@/components/northbeam/app-shell';
import { CreateCard } from '@/components/northbeam/create-card';
import { DashboardCard } from '@/components/northbeam/dashboard-card';
import { EmptyState } from '@/components/northbeam/empty-state';
import { SectionCard } from '@/components/northbeam/section-card';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { trpc } from '@/lib/api';
import { LayoutDashboard, Plus } from 'lucide-react';

export default function DashboardsPage() {
  const composer = useAiComposer();
  const views = trpc.view.list.useQuery({});
  const objects = trpc.object.list.useQuery();
  const objectById = new Map((objects.data ?? []).map((o) => [o.id, o]));
  // Workspace-scoped views (null objectId — the Home page) live on `/`, not
  // in this grid; DashboardCard links through the object route.
  const dashboards = (views.data ?? []).filter((v) => v.type === 'dashboard' && v.objectId != null);
  const loading = views.isLoading || objects.isLoading;

  const newButton = (
    <Button onClick={() => composer.open()}>
      <Plus />
      New dashboard
    </Button>
  );

  return (
    <>
      <PageActions>{newButton}</PageActions>

      {loading ? (
        // Skeletons mirror the final tile grid — one row of cards.
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-24 rounded-lg" />
          ))}
        </div>
      ) : dashboards.length === 0 ? (
        <div className="reveal reveal-1">
          <SectionCard>
            <EmptyState
              icon={LayoutDashboard}
              title="No dashboards yet"
              body="Generate one from a prompt — it saves as a shared view and lands here."
              action={newButton}
            />
          </SectionCard>
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {dashboards.map((v, i) => (
            <DashboardCard
              key={v.id}
              view={v}
              object={v.objectId ? objectById.get(v.objectId) : undefined}
              index={i}
            />
          ))}
          <CreateCard
            label="Create dashboard"
            onClick={() => composer.open()}
            className="min-h-full"
          />
        </div>
      )}
    </>
  );
}
