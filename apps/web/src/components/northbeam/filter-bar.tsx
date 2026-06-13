'use client';

// FilterBar — placeholder UI for the upcoming dynamic filter system (#30).
// Renders pinned filters as chips and an "Add filter" button. Wire to real
// filter logic in #30. For now it just shows the affordance so pages look
// finished and the AI artifact renderer has a known component to compose.

import { Button } from '@/components/ui/button';
import { cn } from '@/lib/cn';
import { Filter, X } from 'lucide-react';
import type { ReactNode } from 'react';

export type FilterChip = {
  id: string;
  label: ReactNode;
  /** Optional close handler — when omitted, the chip renders without an x. */
  onRemove?: () => void;
};

interface FilterBarProps {
  chips?: FilterChip[];
  onAddFilter?: () => void;
  /** Optional saved-view tabs row to render above the filter chips. */
  views?: ReactNode;
  className?: string;
}

export function FilterBar({ chips = [], onAddFilter, views, className }: FilterBarProps) {
  return (
    <div className={cn('mb-3 flex flex-col gap-2', className)}>
      {views && (
        <div className="flex items-center gap-2 border-b">{views}</div>
      )}
      <div className="flex flex-wrap items-center gap-1.5">
        {chips.map((c) => (
          <span
            key={c.id}
            className="inline-flex items-center gap-1.5 rounded-md border bg-muted/40 px-2 py-1 text-xs"
          >
            {c.label}
            {c.onRemove && (
              <Button
                type="button"
                variant="ghost"
                size="icon-xs"
                aria-label="Remove filter"
                className="-mr-1"
                onClick={c.onRemove}
              >
                <X />
              </Button>
            )}
          </span>
        ))}
        <Button type="button" variant="ghost" size="sm" onClick={onAddFilter}>
          <Filter />
          {chips.length === 0 ? 'Add filter' : 'Filter'}
        </Button>
      </div>
    </div>
  );
}
