'use client';

// PicklistSetCard — one global value set in the picklists admin grid: name,
// description, a preview of the set's colored value badges (first few + "+N"),
// and how many picklist fields draw from it. Badge dot colors come from the
// stored option colors (hex in the DB, never literals here).

import { EmptyState } from '@/components/northbeam/empty-state';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import type { RouterOutputs } from '@/lib/api';
import { ListChecks } from 'lucide-react';
import type { ReactNode } from 'react';

export type PicklistSetSummary = RouterOutputs['picklist']['list'][number];

const PREVIEW_COUNT = 8;

/** The picklists admin card grid, with its empty states. `filtered` is the
 *  search-narrowed subset of `total` sets. */
export function PicklistSetsGrid({
  sets,
  total,
  loaded,
  onManage,
  emptyAction,
}: {
  sets: PicklistSetSummary[];
  total: number;
  loaded: boolean;
  /** Omit to hide the Manage affordance (viewer roles). */
  onManage?: (setId: string) => void;
  /** "New set" button shown when the workspace has no sets at all. */
  emptyAction?: ReactNode;
}) {
  if (loaded && sets.length === 0) {
    return (
      <EmptyState
        icon={ListChecks}
        title={total === 0 ? 'No value sets yet' : 'No matching sets'}
        body={
          total === 0
            ? 'Create a shared set of picklist values once and reuse it across objects.'
            : 'Try a different search.'
        }
        action={total === 0 ? emptyAction : undefined}
      />
    );
  }
  return (
    <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
      {sets.map((set) => (
        <PicklistSetCard
          key={set.id}
          set={set}
          onManage={onManage ? () => onManage(set.id) : undefined}
        />
      ))}
    </div>
  );
}

export function PicklistSetCard({
  set,
  onManage,
}: {
  set: PicklistSetSummary;
  /** Omit to hide the Manage affordance (viewer roles). */
  onManage?: () => void;
}) {
  const preview = set.values.slice(0, PREVIEW_COUNT);
  const overflow = set.values.length - preview.length;

  return (
    <Card className="gap-3 px-5 py-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="truncate font-semibold text-foreground text-sm">{set.name}</div>
          {set.description && (
            <div className="mt-0.5 line-clamp-2 text-muted-foreground text-xs">
              {set.description}
            </div>
          )}
        </div>
        {onManage && (
          <Button type="button" variant="outline" size="sm" onClick={onManage}>
            Manage
          </Button>
        )}
      </div>

      <div className="flex flex-wrap gap-1.5">
        {preview.map((option) => (
          <Badge key={option.value} size="sm">
            <span
              aria-hidden="true"
              className="inline-block size-1.5 shrink-0 rounded-full"
              style={{ background: option.color ?? 'var(--ink-muted)' }}
            />
            {option.label}
          </Badge>
        ))}
        {overflow > 0 && (
          <Badge size="sm" variant="outline">
            +{overflow}
          </Badge>
        )}
      </div>

      <div className="mt-auto flex items-center gap-1.5">
        <Badge size="sm" variant="outline" className="tabular-nums">
          {set.values.length} value{set.values.length === 1 ? '' : 's'}
        </Badge>
        <Badge
          size="sm"
          variant="outline"
          tone={set.usedByCount > 0 ? 'brand' : 'neutral'}
          className="tabular-nums"
        >
          Used by {set.usedByCount} field{set.usedByCount === 1 ? '' : 's'}
        </Badge>
      </div>
    </Card>
  );
}
