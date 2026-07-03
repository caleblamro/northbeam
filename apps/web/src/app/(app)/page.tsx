'use client';

// Home — a user-customizable, AI-editable page. Renders the caller's saved
// `home` view (a workspace-scoped dashboard, view.home) through the same
// artifact walker every AI dashboard uses; falls back to the built-in
// "focus queue" artifact (greeting → KPI strip → needs-attention queue →
// recent activity) until they customize. "Customize" opens the composer in
// workspace scope seeded with whatever is currently on screen, so the AI
// refines the page in place and Save writes it back to the home view.

import { useAiComposer } from '@/components/northbeam/ai-composer';
import { HidePageHead, PageActions } from '@/components/northbeam/app-shell';
import { CreateMenu } from '@/components/northbeam/create-menu';
import { ArtifactView } from '@/components/northbeam/views/artifact-walker';
import { Button } from '@/components/ui/button';
import { LoadingScreen } from '@/components/ui/loading-screen';
import { trpc } from '@/lib/api';
import { DEFAULT_HOME_ARTIFACT } from '@/lib/home-artifact';
import type { ArtifactLike } from '@northbeam/core/artifact';
import { Building2, CircleDollarSign, Sparkles, UserPlus } from 'lucide-react';

export default function HomePage() {
  const homeView = trpc.view.home.useQuery();
  const composer = useAiComposer();

  const cfg = (homeView.data?.config ?? {}) as { artifact?: ArtifactLike; prompt?: string };
  const artifact = cfg.artifact ?? DEFAULT_HOME_ARTIFACT;

  return (
    <div className="flex flex-col">
      <HidePageHead />
      <PageActions>
        <Button
          variant="outline"
          onClick={() =>
            composer.open({
              home: { viewId: homeView.data?.id ?? null },
              artifact,
              prompt: cfg.prompt,
            })
          }
        >
          <Sparkles />
          Customize
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

      {homeView.isLoading ? <LoadingScreen size="md" /> : <ArtifactView artifact={artifact} />}
    </div>
  );
}
