'use client';

// Workspace-scoped dashboard detail — dashboards saved with no objectId
// (the composer's "no single object" case) render here; object-scoped ones
// render inside their object's view dispatcher at /<object>?view=<id>.

import { AiAffordance } from '@/components/northbeam/ai-affordance';
import { useAiComposer } from '@/components/northbeam/ai-composer';
import { EmptyState } from '@/components/northbeam/empty-state';
import { SectionCard } from '@/components/northbeam/section-card';
import { type Artifact, ArtifactView } from '@/components/northbeam/views/artifact-walker';
import { Skeleton } from '@/components/ui/skeleton';
import { trpc } from '@/lib/api';
import { LayoutDashboard } from 'lucide-react';
import { useParams } from 'next/navigation';

type DashboardConfig = { artifact?: Artifact; prompt?: string };

export default function WorkspaceDashboardPage() {
  const { id } = useParams<{ id: string }>();
  const composer = useAiComposer();
  const view = trpc.view.get.useQuery({ id }, { retry: false });

  if (view.isLoading) {
    return (
      <div className="flex flex-col gap-3">
        <Skeleton className="h-24 rounded-lg" />
        <Skeleton className="h-64 rounded-lg" />
      </div>
    );
  }
  if (view.isError || !view.data || view.data.type !== 'dashboard') {
    return (
      <SectionCard>
        <EmptyState
          icon={LayoutDashboard}
          title="Dashboard not found"
          body="It may have been deleted, or you may not have access to it."
        />
      </SectionCard>
    );
  }

  const cfg = (view.data.config ?? {}) as DashboardConfig;
  const artifact = cfg.artifact && cfg.artifact.components.length > 0 ? cfg.artifact : null;
  const refine = (
    <AiAffordance
      revealOnHover
      label="Refine with AI"
      onClick={() => composer.open({ prompt: cfg.prompt, artifact: artifact ?? undefined })}
    />
  );

  return (
    <div className="group/ai">
      {artifact ? (
        <ArtifactView artifact={artifact} headerAction={refine} />
      ) : (
        <SectionCard icon={LayoutDashboard} title={view.data.label} action={refine}>
          <EmptyState
            icon={LayoutDashboard}
            title="No content yet"
            body="This dashboard has no components. Refine it with AI to fill it in."
            size="sm"
          />
        </SectionCard>
      )}
    </div>
  );
}
