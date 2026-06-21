'use client';

// AIGenerateDialog — the ⌘K palette's "AI: Generate from prompt" target.
// Object picker + prompt + inline artifact render. Ephemeral by design:
// nothing is persisted, closing the dialog discards the result. AI surface
// is kept to this single moment — no view types, no badges on the page.
//
// Artifact format matches packages/api's artifact-generator v0:
//   ArtifactNode = LeafNode | SectionNode
//   LeafNode    = { component: 'PageHeader' | 'MetricGroup' | … , props? }
//   SectionNode = { component: 'SectionCard', props?, children?: LeafNode[] }
// One level of nesting; no recursion.

import { DescriptionList } from '@/components/northbeam/description-list';
import { EmptyState } from '@/components/northbeam/empty-state';
import { MetricGroup } from '@/components/northbeam/metric-group';
import { PageHeader } from '@/components/northbeam/page-header';
import { SaveViewDialog } from '@/components/northbeam/save-view-dialog';
import { SectionCard } from '@/components/northbeam/section-card';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { trpc } from '@/lib/api';
import { cn } from '@/lib/cn';
import type { Filter, ShareTarget, ViewIcon, ViewSort } from '@northbeam/db/views';
import { AlertTriangle, BookmarkPlus, Loader2, Sparkles } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { type ReactNode, useEffect, useState } from 'react';

type Leaf = { component: string; props?: Record<string, unknown> };
type Section = {
  component: 'SectionCard';
  props?: Record<string, unknown>;
  children?: Leaf[];
};
type ArtifactNode = Leaf | Section;
type ViewSuggestion = {
  label: string;
  filters: Filter[];
  sort: ViewSort[];
  columns: string[];
};
type Artifact = {
  version: '1';
  components: ArtifactNode[];
  view: ViewSuggestion;
};

const PLACEHOLDER_PROMPTS = [
  'A snapshot dashboard with total record count, top 4 industries, and an empty state for follow-ups due this week.',
  'A renewals page with deals at risk in the next 30 days and a description list of the top 5 by ARR.',
  'A weekly digest: new accounts added, top stages by count, and recent activity highlights.',
];

interface AIGenerateDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function AIGenerateDialog({ open, onOpenChange }: AIGenerateDialogProps) {
  const router = useRouter();
  const utils = trpc.useUtils();
  const objects = trpc.object.list.useQuery(undefined, { enabled: open });
  const [objectKey, setObjectKey] = useState<string>('');
  const [prompt, setPrompt] = useState('');
  const [artifact, setArtifact] = useState<Artifact | null>(null);
  const [saveDialogOpen, setSaveDialogOpen] = useState(false);
  const objectId =
    objects.data?.find((o) => o.key === objectKey)?.id ?? null;

  // Pick the first object once data lands. Doesn't override an existing
  // selection so the user can switch and keep their prompt.
  useEffect(() => {
    if (!open) return;
    if (!objectKey && objects.data && objects.data.length > 0) {
      setObjectKey(objects.data[0]?.key ?? '');
    }
  }, [open, objectKey, objects.data]);

  // Reset everything when the dialog closes so the next open is clean.
  useEffect(() => {
    if (open) return;
    setArtifact(null);
    setPrompt('');
  }, [open]);

  const generate = trpc.ai.preview.useMutation({
    meta: { context: "Couldn't generate" },
    onSuccess: (data) => setArtifact(data.artifact as Artifact),
  });

  const createView = trpc.view.create.useMutation({
    meta: { context: "Couldn't save the view" },
  });

  const onSaveDialogSubmit = async ({
    label,
    sharedWith,
    icon,
  }: { label: string; sharedWith: ShareTarget[]; icon: ViewIcon }) => {
    if (!objectId || !artifact) return;
    const slug =
      label
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 48) || 'ai-view';
    const created = await createView.mutateAsync({
      objectId,
      key: `${slug}-${Date.now().toString(36)}`,
      label,
      type: 'list',
      icon,
      filters: artifact.view.filters,
      sort: artifact.view.sort,
      columns: artifact.view.columns,
      sharedWith,
    });
    await utils.view.list.invalidate({ objectId });
    setSaveDialogOpen(false);
    onOpenChange(false);
    // Navigate the user to the list view they just saved so the result is
    // immediately visible — the AI dialog is gone after this point.
    router.push(`/${objectKey}?view=${created?.id ?? ''}`);
  };

  const placeholder = PLACEHOLDER_PROMPTS[0];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="size-4" />
            Generate from prompt
          </DialogTitle>
        </DialogHeader>

        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <span className="text-muted-foreground text-xs sm:w-20">Object</span>
            <Select
              value={objectKey}
              onValueChange={(v) => {
                setObjectKey(v);
                setArtifact(null);
              }}
            >
              <SelectTrigger className="h-8">
                <SelectValue placeholder="Pick an object" />
              </SelectTrigger>
              <SelectContent>
                {(objects.data ?? []).map((o) => (
                  <SelectItem key={o.id} value={o.key}>
                    {o.labelPlural}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <Textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder={placeholder}
            rows={4}
            className="resize-y"
          />

          <div className="flex items-center gap-2">
            <Button
              disabled={!prompt.trim() || !objectKey || generate.isPending}
              onClick={() =>
                generate.mutate({ objectKey, prompt: prompt.trim() })
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
              <Button variant="ghost" onClick={() => setArtifact(null)}>
                Clear
              </Button>
            )}
          </div>
        </div>

        {artifact && (
          <>
            <div className="-mx-6 max-h-[60vh] overflow-y-auto border-t bg-muted/20 px-6 py-4">
              <div className="flex flex-col gap-3">
                {artifact.components.map((node, i) => (
                  <RenderNode key={i} node={node} index={i} />
                ))}
              </div>
            </div>
            <ViewSuggestionSummary suggestion={artifact.view} />
          </>
        )}

        <DialogFooter className="border-t px-0 pt-3">
          <span className="mr-auto text-[10px] text-muted-foreground">
            Preview is ephemeral. Save persists the equivalent list view; the
            generated layout is not kept.
          </span>
          {artifact && (
            <Button
              onClick={() => setSaveDialogOpen(true)}
              disabled={createView.isPending}
            >
              <BookmarkPlus />
              Save as list view
            </Button>
          )}
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Close
          </Button>
        </DialogFooter>

        <SaveViewDialog
          open={saveDialogOpen}
          onOpenChange={setSaveDialogOpen}
          defaultLabel={artifact?.view.label ?? ''}
          defaultIcon="star"
          isSaving={createView.isPending}
          onSave={onSaveDialogSubmit}
        />
      </DialogContent>
    </Dialog>
  );
}

/** Compact read-only summary of the filter / sort / column config Claude
 *  proposed. Shows the user exactly what saving will persist, so it's not
 *  a surprise when the list view loads with those filters pre-applied. */
function ViewSuggestionSummary({ suggestion }: { suggestion: ViewSuggestion }) {
  const hasFilters = suggestion.filters.length > 0;
  const hasSort = suggestion.sort.length > 0;
  const hasColumns = suggestion.columns.length > 0;
  if (!hasFilters && !hasSort && !hasColumns) {
    return (
      <p className="px-6 pt-3 text-muted-foreground text-xs">
        No filters or columns proposed — saving keeps the object's default list
        view configuration.
      </p>
    );
  }
  return (
    <div className="flex flex-col gap-1 px-6 pt-3 text-xs">
      <span className="font-medium text-foreground">Save would persist</span>
      {hasFilters && (
        <div className="text-muted-foreground">
          <span>Filters: </span>
          <span className="font-mono">
            {suggestion.filters
              .map((f) => `${f.fieldKey} ${f.op}${f.value != null ? ` ${f.value}` : ''}`)
              .join(' · ')}
          </span>
        </div>
      )}
      {hasSort && (
        <div className="text-muted-foreground">
          <span>Sort: </span>
          <span className="font-mono">
            {suggestion.sort.map((s) => `${s.fieldKey} ${s.direction}`).join(' · ')}
          </span>
        </div>
      )}
      {hasColumns && (
        <div className="text-muted-foreground">
          <span>Columns: </span>
          <span className="font-mono">{suggestion.columns.join(' · ')}</span>
        </div>
      )}
    </div>
  );
}

/* ── Artifact walker ────────────────────────────────────────────────────── */

function RenderNode({ node, index }: { node: ArtifactNode; index: number }): ReactNode {
  if (node.component === 'SectionCard') {
    const section = node as Section;
    const p = (section.props ?? {}) as { title?: string };
    const children = (section.children ?? []).map((c, i) => (
      <RenderLeaf key={i} node={c} />
    ));
    return (
      <SectionCard title={p.title}>
        <div className="flex flex-col gap-3">{children}</div>
      </SectionCard>
    );
  }
  return <RenderLeaf node={node as Leaf} key={index} />;
}

function RenderLeaf({ node }: { node: Leaf }): ReactNode {
  const p = (node.props ?? {}) as Record<string, unknown>;
  switch (node.component) {
    case 'PageHeader':
      return (
        <PageHeader
          title={(p.title as string | undefined) ?? 'Untitled'}
          subtitle={p.subtitle as string | undefined}
        />
      );
    case 'MetricGroup': {
      const items =
        ((p.items as { label: string; value?: string; delta?: string }[] | undefined) ?? [])
          .map((it) => ({
            label: it.label,
            value: it.value,
            delta: it.delta ? { text: it.delta } : undefined,
          }));
      return <MetricGroup items={items} />;
    }
    case 'DescriptionList': {
      const items =
        (p.items as { label: string; value: string }[] | undefined) ?? [];
      return <DescriptionList items={items} />;
    }
    case 'EmptyState':
      return (
        <EmptyState
          title={(p.title as string | undefined) ?? '—'}
          body={p.body as string | undefined}
          size="sm"
        />
      );
    case 'Text':
      return (
        <p
          className={cn(
            'text-sm leading-relaxed',
            (p.muted as boolean | undefined) && 'text-muted-foreground',
          )}
        >
          {(p.value as string | undefined) ?? ''}
        </p>
      );
    default:
      return (
        <div className="flex items-start gap-2 rounded-md border border-dashed bg-muted/30 px-3 py-2 text-xs">
          <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-amber-600" />
          <span className="text-muted-foreground">
            Unsupported component:{' '}
            <code className="font-mono text-foreground">{node.component}</code>
          </span>
        </div>
      );
  }
}
