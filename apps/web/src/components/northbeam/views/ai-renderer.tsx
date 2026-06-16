'use client';

// AIRenderer — the dispatcher's hook for AI-generated artifact views (#11).
// This file ships the *shell* only: a registration in VIEW_RENDERERS, an
// empty-state when no artifact has been generated yet, and a tiny walker
// that maps a small whitelist of artifact nodes onto our `northbeam/*`
// wrappers. The actual generation flow + the wider component vocabulary is
// #11's real subject.
//
// Artifact format (v0):
//   {
//     version: '1',
//     components: ArtifactNode[],
//   }
//   ArtifactNode = {
//     component: 'PageHeader' | 'SectionCard' | 'MetricGroup'
//              | 'DescriptionList' | 'EmptyState' | 'Text';
//     props: Record<string, unknown>;
//     children?: ArtifactNode[];
//   }
//
// Everything not in the whitelist renders as "Unsupported component:
// {name}" with a soft warning so a bad generation never breaks the view.

import { DescriptionList } from '@/components/northbeam/description-list';
import { EmptyState } from '@/components/northbeam/empty-state';
import { MetricGroup } from '@/components/northbeam/metric-group';
import { PageHeader } from '@/components/northbeam/page-header';
import { SectionCard } from '@/components/northbeam/section-card';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { trpc } from '@/lib/api';
import { cn } from '@/lib/cn';
import type { ViewRenderer, ViewRendererProps } from '@/lib/views/types';
import { AlertTriangle, Loader2, Pencil, Sparkles } from 'lucide-react';
import { type ReactNode, useState } from 'react';
import { z } from 'zod';

type ArtifactNode = {
  component: string;
  props?: Record<string, unknown>;
  children?: ArtifactNode[];
};

type Artifact = {
  version: '1';
  components: ArtifactNode[];
};

type AIConfig = {
  prompt?: string;
  model?: string;
  artifact?: Artifact;
  generatedAt?: string;
  error?: string;
};

// Whitelist of components an artifact is allowed to instantiate. Each entry
// gets the literal node props, plus the children walked recursively. Anything
// not here returns the "Unsupported" fallback so a misbehaving generation
// can never crash the page.
const ARTIFACT_COMPONENTS: Record<
  string,
  (node: ArtifactNode, children: ReactNode) => ReactNode
> = {
  PageHeader: (node) => {
    const p = (node.props ?? {}) as { title?: string; subtitle?: string };
    return <PageHeader title={p.title ?? 'Untitled'} subtitle={p.subtitle} />;
  },
  SectionCard: (node, children) => {
    const p = (node.props ?? {}) as { title?: string };
    return <SectionCard title={p.title}>{children}</SectionCard>;
  },
  MetricGroup: (node) => {
    const p = (node.props ?? {}) as {
      items?: { label: string; value?: string; delta?: string }[];
    };
    // MetricItem accepts the typed `delta` object — we wrap the artifact's
    // plain-string delta so a generation can stay terse.
    const items = (p.items ?? []).map((it) => ({
      label: it.label,
      value: it.value,
      delta: it.delta ? { text: it.delta } : undefined,
    }));
    return <MetricGroup items={items} />;
  },
  DescriptionList: (node) => {
    const p = (node.props ?? {}) as {
      items?: { label: string; value: string }[];
    };
    return <DescriptionList items={p.items ?? []} />;
  },
  EmptyState: (node) => {
    const p = (node.props ?? {}) as { title?: string; body?: string };
    return <EmptyState title={p.title ?? '—'} body={p.body} size="sm" />;
  },
  Text: (node) => {
    const p = (node.props ?? {}) as { value?: string; muted?: boolean };
    return (
      <p className={cn('text-sm leading-relaxed', p.muted && 'text-muted-foreground')}>
        {p.value ?? ''}
      </p>
    );
  },
};

function renderArtifactNode(node: ArtifactNode, index: number): ReactNode {
  const children = (node.children ?? []).map((c, i) => renderArtifactNode(c, i));
  const factory = ARTIFACT_COMPONENTS[node.component];
  if (!factory) {
    return (
      <div
        key={index}
        className="flex items-start gap-2 rounded-md border border-dashed bg-muted/30 px-3 py-2 text-xs"
      >
        <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-amber-600" />
        <span className="text-muted-foreground">
          Unsupported component:{' '}
          <code className="font-mono text-foreground">{node.component}</code>
        </span>
      </div>
    );
  }
  return <div key={index}>{factory(node, children)}</div>;
}

export function AIView({ view }: ViewRendererProps) {
  const cfg = (view.config ?? {}) as AIConfig;
  const artifact = cfg.artifact;
  const utils = trpc.useUtils();
  const [editing, setEditing] = useState(!artifact);
  const [prompt, setPrompt] = useState(cfg.prompt ?? '');

  const generate = trpc.ai.generate.useMutation({
    meta: { context: "Couldn't generate the view" },
    onSuccess: () => {
      utils.view.list.invalidate({ objectId: view.objectId });
      setEditing(false);
    },
  });

  const isSynthetic = view.id === '__synthetic__';

  if (editing) {
    return (
      <SectionCard icon={Sparkles} title="AI view">
        <div className="flex max-w-2xl flex-col gap-3">
          <p className="text-muted-foreground text-sm leading-relaxed">
            Describe the view you want in plain language. Claude composes it from a small
            whitelist of layout components (headers, section cards, metric tiles,
            description lists). Data-source wiring comes in a follow-up — values land as
            sample placeholders for now.
          </p>
          <Textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder="A renewal dashboard with deals at risk in the next 30 days, top 5 accounts by ARR, and an empty state for unassigned activities."
            rows={5}
            className="resize-y"
          />
          {isSynthetic && (
            <p className="text-amber-700 text-xs dark:text-amber-400">
              Save this as a view first — generation needs a persisted view id.
            </p>
          )}
          <div className="flex items-center gap-2">
            <Button
              disabled={!prompt.trim() || generate.isPending || isSynthetic}
              onClick={() =>
                generate.mutate({ viewId: view.id, prompt: prompt.trim() })
              }
            >
              {generate.isPending ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Sparkles />
              )}
              {artifact ? 'Regenerate' : 'Generate'}
            </Button>
            {artifact && (
              <Button
                variant="ghost"
                onClick={() => {
                  setPrompt(cfg.prompt ?? '');
                  setEditing(false);
                }}
              >
                Cancel
              </Button>
            )}
          </div>
        </div>
      </SectionCard>
    );
  }

  if (!artifact) {
    return (
      <SectionCard icon={Sparkles} title="AI view">
        <EmptyState
          icon={Sparkles}
          title="No artifact generated yet"
          body="Write a prompt + run generation to fill this view."
          action={
            <Button onClick={() => setEditing(true)}>
              <Sparkles />
              Generate
            </Button>
          }
        />
      </SectionCard>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-2 rounded-md border bg-muted/30 px-3 py-2 text-xs">
        <div className="flex min-w-0 items-center gap-2 text-muted-foreground">
          <Sparkles className="size-3.5" />
          <span className="truncate">{cfg.prompt ?? 'AI-generated'}</span>
        </div>
        <Button variant="ghost" size="sm" onClick={() => setEditing(true)}>
          <Pencil className="size-3.5" />
          Edit prompt
        </Button>
      </div>
      {artifact.components.map((node, i) => renderArtifactNode(node, i))}
    </div>
  );
}

const ArtifactNodeSchema: z.ZodType<ArtifactNode> = z.lazy(() =>
  z.object({
    component: z.string().min(1),
    props: z.record(z.string(), z.unknown()).optional(),
    children: z.array(ArtifactNodeSchema).optional(),
  }),
);

const AIConfigSchema = z
  .object({
    prompt: z.string().optional(),
    model: z.string().optional(),
    artifact: z
      .object({
        version: z.literal('1'),
        components: z.array(ArtifactNodeSchema),
      })
      .optional(),
    generatedAt: z.string().optional(),
    error: z.string().optional(),
  })
  .passthrough();

export const AIRenderer: ViewRenderer<AIConfig> = {
  type: 'ai',
  label: 'AI',
  icon: Sparkles,
  Component: AIView,
  configSchema: AIConfigSchema,
  defaultConfig: () => ({ prompt: '' }),
  defaultColumns: () => [],
};
