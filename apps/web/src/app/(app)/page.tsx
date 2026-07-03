'use client';

// Home — a user-customizable, AI-editable page. Renders the caller's saved
// `home` view (a workspace-scoped dashboard, view.home) through the same
// artifact walker every AI dashboard uses; falls back to the built-in
// "focus queue" artifact (greeting → KPI strip → needs-attention queue →
// pipeline chart + recent activity → closing soon) until they customize.
// "Customize with AI" opens the composer in workspace scope seeded with
// whatever is currently on screen, so the AI refines the page in place and
// Save writes it back to the home view.
//
// NOTE: home hides the layout page-head, so the action cluster can't ride
// PageActions (it renders inside the hidden head) — it floats through
// ArtifactView's headerAction slot instead, top-right beside the greeting.

import { useAiComposer } from '@/components/northbeam/ai-composer';
import { HidePageHead } from '@/components/northbeam/app-shell';
import { CreateMenu } from '@/components/northbeam/create-menu';
import { ArtifactView } from '@/components/northbeam/views/artifact-walker';
import { Button } from '@/components/ui/button';
import { LoadingScreen } from '@/components/ui/loading-screen';
import { trpc } from '@/lib/api';
import { useCan } from '@/lib/can';
import { DEFAULT_HOME_ARTIFACT } from '@/lib/home-artifact';
import type { ArtifactLike } from '@northbeam/core/artifact';
import { Building2, CircleDollarSign, Sparkles, UserPlus } from 'lucide-react';

export default function HomePage() {
  const homeView = trpc.view.home.useQuery();
  const composer = useAiComposer();
  // Composing persists as a saved view — hide the door for roles that can't
  // write views (the backend gates ai.preview the same way).
  const canCustomize = useCan('view.write');

  const cfg = (homeView.data?.config ?? {}) as { artifact?: ArtifactLike; prompt?: string };
  const artifact = cfg.artifact ?? DEFAULT_HOME_ARTIFACT;

  return (
    <div className="flex flex-col">
      <HidePageHead />
      {homeView.isLoading ? (
        <LoadingScreen size="md" />
      ) : (
        <ArtifactView
          artifact={artifact}
          headerAction={
            <div className="flex items-center gap-2">
              {canCustomize && (
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
              )}
              <CreateMenu
                items={[
                  { type: 'label', label: 'Create' },
                  { type: 'item', icon: UserPlus, label: 'Contact' },
                  { type: 'item', icon: Building2, label: 'Account' },
                  { type: 'item', icon: CircleDollarSign, label: 'Deal' },
                ]}
              />
            </div>
          }
        />
      )}
    </div>
  );
}
