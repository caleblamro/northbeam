'use client';

// DashboardRenderer — composed-layout view type. The view row's
// `config.artifact` holds the component tree; the shared walker
// (artifact-walker.tsx) renders it. Same walker the AI dialog uses for
// preview, so authoring once produces the same UI in both places.
//
// Hand-authorable (you can write JSON onto config.artifact directly) +
// AI-authorable (the dialog's "Save as view" lands here).

import { ArtifactView, type Artifact } from '@/components/northbeam/views/artifact-walker';
import { EmptyState } from '@/components/northbeam/empty-state';
import { SectionCard } from '@/components/northbeam/section-card';
import type { ViewRenderer, ViewRendererProps } from '@/lib/views/types';
import { LayoutDashboard } from 'lucide-react';
import { z } from 'zod';

type DashboardConfig = {
  /** The component tree. `null` / missing renders an empty-state. */
  artifact?: Artifact;
  /** Provenance — set by the AI dialog when saving; useful later for
   *  surfacing "regenerate" affordances. Unused at render time. */
  prompt?: string;
  model?: string;
  generatedAt?: string;
};

export function DashboardView({ view }: ViewRendererProps) {
  const cfg = (view.config ?? {}) as DashboardConfig;
  if (!cfg.artifact || cfg.artifact.components.length === 0) {
    return (
      <SectionCard icon={LayoutDashboard} title="Empty dashboard">
        <EmptyState
          icon={LayoutDashboard}
          title="No content yet"
          body="This dashboard has no components in its artifact. Hand-edit `config.artifact` or regenerate from the ⌘K palette to fill it."
          size="sm"
        />
      </SectionCard>
    );
  }
  return <ArtifactView artifact={cfg.artifact} />;
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
