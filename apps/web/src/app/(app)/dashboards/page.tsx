'use client';

import { AIGenerateDialog } from '@/components/northbeam/ai-generate-dialog';
import { PageActions } from '@/components/northbeam/app-shell';
import { CreateCard } from '@/components/northbeam/create-card';
import { DashboardCard } from '@/components/northbeam/dashboard-card';
import { EmptyState } from '@/components/northbeam/empty-state';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { trpc } from '@/lib/api';
import { LayoutDashboard, Plus } from 'lucide-react';
import { useState } from 'react';

export default function DashboardsPage() {
  const [aiOpen, setAiOpen] = useState(false);
  const views = trpc.view.list.useQuery({});
  const objects = trpc.object.list.useQuery();
  const objectById = new Map((objects.data ?? []).map((o) => [o.id, o]));
  const dashboards = (views.data ?? []).filter((v) => v.type === 'dashboard');
  const loading = views.isLoading || objects.isLoading;

  const newButton = (
    <Button onClick={() => setAiOpen(true)}>
      <Plus />
      New dashboard
    </Button>
  );

  return (
    <>
      <PageActions>{newButton}</PageActions>

      {loading ? (
        <div className="grid gap-3.5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-24 rounded-lg" />
          ))}
        </div>
      ) : dashboards.length === 0 ? (
        <EmptyState
          icon={LayoutDashboard}
          title="No dashboards yet"
          body="Generate one from a prompt — it saves as a shared view and lands here."
          action={newButton}
        />
      ) : (
        <div className="grid gap-3.5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {dashboards.map((v, i) => (
            <DashboardCard key={v.id} view={v} object={objectById.get(v.objectId)} index={i} />
          ))}
          <CreateCard
            label="Create dashboard"
            onClick={() => setAiOpen(true)}
            className="min-h-full"
          />
        </div>
      )}

      <AIGenerateDialog open={aiOpen} onOpenChange={setAiOpen} />
    </>
  );
}
