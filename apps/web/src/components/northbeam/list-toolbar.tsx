'use client';

// ListToolbar — the canonical "search + view-mode toggle + actions" row above
// any record collection. Search uses InputGroup; the view toggle is a small
// segmented button group. Pages drop a ListToolbar and pass `searchValue`,
// `onSearchChange`, optional `view` + `onViewChange`, optional `actions`.

import { Button } from '@/components/ui/button';
import { InputGroup, InputGroupAddon, InputGroupInput } from '@/components/ui/input-group';
import { cn } from '@/lib/cn';
import { LayoutGrid, List, Search } from 'lucide-react';
import type { ReactNode } from 'react';

export type ListView = 'list' | 'grid';

interface ListToolbarProps {
  searchValue: string;
  onSearchChange: (v: string) => void;
  searchPlaceholder?: string;
  view?: ListView;
  onViewChange?: (v: ListView) => void;
  actions?: ReactNode;
  className?: string;
}

export function ListToolbar({
  searchValue,
  onSearchChange,
  searchPlaceholder = 'Search…',
  view,
  onViewChange,
  actions,
  className,
}: ListToolbarProps) {
  return (
    <div className={cn('mb-3 flex items-center gap-2.5', className)}>
      <InputGroup className="w-72">
        <InputGroupAddon>
          <Search />
        </InputGroupAddon>
        <InputGroupInput
          placeholder={searchPlaceholder}
          value={searchValue}
          onChange={(e) => onSearchChange(e.target.value)}
        />
      </InputGroup>
      <div className="flex-1" />
      {actions}
      {view !== undefined && onViewChange && (
        <div className="flex overflow-hidden rounded-md border" role="group" aria-label="View mode">
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label="List view"
            className="rounded-none"
            data-state={view === 'list' ? 'open' : undefined}
            onClick={() => onViewChange('list')}
          >
            <List />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label="Grid view"
            className="rounded-none border-l"
            data-state={view === 'grid' ? 'open' : undefined}
            onClick={() => onViewChange('grid')}
          >
            <LayoutGrid />
          </Button>
        </div>
      )}
    </div>
  );
}
