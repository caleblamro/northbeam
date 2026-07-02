'use client';

// DashboardRenderer — composed-layout view type. The view row's
// `config.artifact` holds the component tree; the shared walker
// (artifact-walker.tsx) renders it. Same walker the AI dialog uses for
// preview, so authoring once produces the same UI in both places.
//
// Hand-authorable (you can write JSON onto config.artifact directly) +
// AI-authorable (the dialog's "Save as view" lands here).

import { AiAffordance } from '@/components/northbeam/ai-affordance';
import { AIGenerateDialog } from '@/components/northbeam/ai-generate-dialog';
import { EmptyState } from '@/components/northbeam/empty-state';
import { SectionCard } from '@/components/northbeam/section-card';
import { type Artifact, ArtifactView } from '@/components/northbeam/views/artifact-walker';
import type { ViewRenderer, ViewRendererProps } from '@/lib/views/types';
import { LayoutDashboard } from 'lucide-react';
import { useState } from 'react';
import { z } from 'zod';

type DashboardConfig = {
  /** The component tree. `null` / missing renders an empty-state. */
  artifact?: Artifact;
  /** Provenance — set by the AI dialog when saving. `prompt` seeds the
   *  "Regenerate with AI" affordance so regeneration starts from the
   *  original instruction. */
  prompt?: string;
  model?: string;
  generatedAt?: string;
};

export function DashboardView({ view, objectKey }: ViewRendererProps) {
  const cfg = (view.config ?? {}) as DashboardConfig;
  const [aiOpen, setAiOpen] = useState(false);
  const artifact = cfg.artifact && cfg.artifact.components.length > 0 ? cfg.artifact : null;

  // The one AI entry point on this surface: quiet, revealed by hover/focus on
  // the dashboard (the `group/ai` wrapper), always mirrored by the ⌘K
  // palette's "Generate dashboard from prompt".
  const regenerate = (
    <AiAffordance revealOnHover label="Regenerate with AI" onClick={() => setAiOpen(true)} />
  );

  return (
    <div className="group/ai">
      {artifact ? (
        <ArtifactView artifact={artifact} headerAction={regenerate} />
      ) : (
        <SectionCard icon={LayoutDashboard} title="Empty dashboard" action={regenerate}>
          <EmptyState
            icon={LayoutDashboard}
            title="No content yet"
            body="This dashboard has no components in its artifact. Hand-edit `config.artifact` or regenerate from the ⌘K palette to fill it."
            size="sm"
          />
        </SectionCard>
      )}
      <AIGenerateDialog
        open={aiOpen}
        onOpenChange={setAiOpen}
        initialObjectKey={objectKey}
        initialPrompt={cfg.prompt}
      />
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
