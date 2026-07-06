'use client';

// DashboardRenderer — composed-layout view type. The view row's
// `config.artifact` holds the component tree; the shared walker
// (artifact-walker.tsx) renders it. Same walker the AI dialog uses for
// preview, so authoring once produces the same UI in both places.
//
// Hand-authorable (you can write JSON onto config.artifact directly) +
// AI-authorable (the dialog's "Save as view" lands here).

import { AiAffordance } from '@/components/northbeam/ai-affordance';
import { useAiComposer } from '@/components/northbeam/ai-composer';
import { EmptyState } from '@/components/northbeam/empty-state';
import { SectionCard } from '@/components/northbeam/section-card';
import { type Artifact, ArtifactView } from '@/components/northbeam/views/artifact-walker';
import type { ViewRenderer, ViewRendererProps } from '@/lib/views/types';
import { LayoutDashboard } from 'lucide-react';
import { z } from 'zod';

type DashboardConfig = {
  /** The component tree. `null` / missing renders an empty-state. */
  artifact?: Artifact;
  /** Provenance — set by the AI dialog when saving. `prompt` is the original
   *  instruction (shown as history when the dialog reopens in refinement
   *  mode); `prompts` the full refinement history. */
  prompt?: string;
  prompts?: string[];
  model?: string;
  generatedAt?: string;
};

export function DashboardView({ view, objectKey }: ViewRendererProps) {
  const cfg = (view.config ?? {}) as DashboardConfig;
  const composer = useAiComposer();
  const artifact = cfg.artifact && cfg.artifact.components.length > 0 ? cfg.artifact : null;

  // The one AI entry point on this surface: quiet, revealed by hover/focus on
  // the dashboard (the `group/ai` wrapper), always mirrored by the ⌘K
  // palette's "Generate dashboard from prompt". Passing the saved artifact
  // opens the composer in refinement mode — follow-up prompts edit this
  // dashboard rather than composing a new one.
  const refine = (
    <AiAffordance
      revealOnHover
      label="Refine in Build"
      onClick={() =>
        composer.open({ objectKey, prompt: cfg.prompt, artifact: artifact ?? undefined })
      }
    />
  );

  return (
    <div className="group/ai">
      {artifact ? (
        <ArtifactView artifact={artifact} headerAction={refine} />
      ) : (
        <SectionCard icon={LayoutDashboard} title="Empty dashboard" action={refine}>
          <EmptyState
            icon={LayoutDashboard}
            title="No content yet"
            body="This dashboard has no components in its artifact. Hand-edit `config.artifact` or compose from the ⌘K palette to fill it."
            size="sm"
          />
        </SectionCard>
      )}
    </div>
  );
}

const DashboardConfigSchema = z
  .object({
    artifact: z
      .object({
        version: z.literal('1'),
        components: z.array(z.unknown()),
      })
      .optional(),
    prompt: z.string().optional(),
    model: z.string().optional(),
    generatedAt: z.string().optional(),
  })
  .passthrough();

export const DashboardRenderer: ViewRenderer<DashboardConfig> = {
  type: 'dashboard',
  label: 'Dashboard',
  icon: LayoutDashboard,
  Component: DashboardView,
  configSchema: DashboardConfigSchema,
  defaultConfig: () => ({}),
  defaultColumns: () => [],
};
