'use client';

// SavedViews — placeholder tabs row for the saved-view feature (#30). Renders
// a horizontal tab strip with one active view. Pages drop one of these above
// the FilterBar. Wire to real saved views in #30.

import { cn } from '@/lib/cn';
import type { ReactNode } from 'react';

export type SavedView = {
  id: string;
  label: ReactNode;
};

interface SavedViewsProps {
  views: SavedView[];
  activeId: string;
  onSelect: (id: string) => void;
  /** Optional trailing slot — typically a "+" button to create a new view. */
  trailing?: ReactNode;
  className?: string;
}

export function SavedViews({ views, activeId, onSelect, trailing, className }: SavedViewsProps) {
  return (
    <div className={cn('flex items-center gap-1', className)}>
      {views.map((v) => (
        <button
          key={v.id}
          type="button"
          data-active={v.id === activeId ? 'true' : undefined}
          onClick={() => onSelect(v.id)}
          className={cn(
            'rounded-md px-2.5 py-1.5 font-medium text-sm transition-colors',
            'text-muted-foreground hover:bg-muted hover:text-foreground',
            'data-[active=true]:bg-muted data-[active=true]:text-foreground',
          )}
        >
          {v.label}
        </button>
      ))}
      {trailing && <div className="ml-2">{trailing}</div>}
    </div>
  );
}
