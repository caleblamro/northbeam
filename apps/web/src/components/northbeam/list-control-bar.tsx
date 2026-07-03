'use client';

// ListControlBar — the single row of chrome above every record collection:
// object identity (chip + plural + true count) · saved-view underline tabs
// with a manage menu on the active tab · removable filter chips + the
// FilterDialog editor · search · the New button. Replaces the old three-row
// stack (page header → ViewPicker row → ListToolbar) so the table below can
// own the rest of the viewport.

import type { FieldDefLite } from '@/components/northbeam/field-render';
import { FilterDialog } from '@/components/northbeam/filter-bar';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/cn';
import { type Filter, chipLabel } from '@/lib/filters';
import type { ViewRow } from '@/lib/views/types';
import { ChevronDown, Pin, Plus, Search, Trash2, X } from 'lucide-react';
import type { ReactNode } from 'react';
import { ObjChip } from './app-bits';

type ReferenceLoader = (
  objectKey: string,
  query: string,
) => Promise<{ value: string; label: string }[]>;

interface ListControlBarProps {
  objectLabel: string;
  objectPlural: string;
  objectColor?: string;
  /** True server-side record count for the active view's filter set — not the
   *  ≤200-row page length. Null while loading. */
  count?: number | null;
  views: ViewRow[];
  activeView: ViewRow;
  hasOverrides: boolean;
  currentUserId: string | null;
  onSelectView: (view: ViewRow) => void;
  onSaveAsNew: () => void;
  onSetDefault: (view: ViewRow) => void;
  onDeleteView: (view: ViewRow) => void;
  fields: FieldDefLite[];
  /** Transient URL filters — rendered as removable chips. The active view's
   *  own stored filters are part of the view definition and stay implicit. */
  filters: Filter[];
  onFiltersChange: (filters: Filter[]) => void;
  loadReferenceOptions?: ReferenceLoader;
  searchValue: string;
  onSearchChange: (q: string) => void;
  searchPlaceholder?: string;
  /** Right-most action slot — the New button. */
  createAction?: ReactNode;
  /** Gates the save/set-default/delete-view affordances. When false (the
   *  caller lacks `view.write`), views are still selectable — just read-only. */
  canWriteViews?: boolean;
}

export function ListControlBar({
  objectLabel,
  objectPlural,
  objectColor,
  count,
  views,
  activeView,
  hasOverrides,
  currentUserId,
  onSelectView,
  onSaveAsNew,
  onSetDefault,
  onDeleteView,
  fields,
  filters,
  onFiltersChange,
  loadReferenceOptions,
  searchValue,
  onSearchChange,
  searchPlaceholder,
  createAction,
  canWriteViews = true,
}: ListControlBarProps) {
  const byKey = new Map(fields.map((f) => [f.key, f]));
  const real = views.filter((v) => v.id !== '__synthetic__');
  // The synthetic fallback only tabs itself when nothing is persisted yet.
  const tabViews = real.length > 0 ? real : [activeView];

  const canManage = (view: ViewRow) => {
    if (!canWriteViews) return false;
    if (view.id === '__synthetic__') return false;
    if (view.ownerId === null && view.isDefault) return false;
    return currentUserId ? view.ownerId === currentUserId : false;
  };

  const removeFilter = (index: number) => onFiltersChange(filters.filter((_, i) => i !== index));

  return (
    <div className="flex min-h-12 flex-wrap items-center gap-x-3 gap-y-1 border-border border-b bg-background px-4">
      <div className="flex items-center gap-2.5">
        <ObjChip label={objectLabel} color={objectColor} size={26} />
        <h1 className="font-semibold text-[15px] tracking-[-0.01em]">{objectPlural}</h1>
        {count != null && (
          <span className="text-muted-foreground text-sm tabular-nums">
            {count.toLocaleString()}
          </span>
        )}
      </div>

      {/* Saved views as underline tabs */}
      <nav className="flex min-w-0 items-stretch self-stretch overflow-x-auto" aria-label="Views">
        {tabViews.map((v) => {
          const active = v.id === activeView.id;
          return (
            <div key={v.id} className="relative flex items-stretch">
              <button
                type="button"
                onClick={() => onSelectView(v)}
                className={cn(
                  'relative flex items-center gap-1.5 whitespace-nowrap px-2.5 font-medium text-[13px] transition-colors',
                  active ? 'text-foreground' : 'text-muted-foreground hover:text-foreground',
                  active &&
                    'after:absolute after:inset-x-2 after:bottom-0 after:h-0.5 after:rounded-full after:bg-[var(--accent)]',
                )}
              >
                {v.label}
                {active && hasOverrides && (
                  <span
                    className="size-1.5 rounded-full bg-[var(--accent)]"
                    title="Unsaved filter or sort changes"
                  />
                )}
              </button>
              {active && (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <button
                      type="button"
                      aria-label={`Manage view ${v.label}`}
                      className="flex items-center pr-1.5 text-muted-foreground hover:text-foreground"
                    >
                      <ChevronDown className="size-3" />
                    </button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="start" className="w-52">
                    {hasOverrides && canWriteViews && (
                      <DropdownMenuItem onClick={onSaveAsNew}>
                        <Plus className="size-3.5" />
                        Save as new view…
                      </DropdownMenuItem>
                    )}
                    <DropdownMenuItem
                      disabled={!canWriteViews || v.isDefault || v.id === '__synthetic__'}
                      onClick={() => onSetDefault(v)}
                    >
                      <Pin className="size-3.5" />
                      Set as default
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      variant="destructive"
                      disabled={!canManage(v)}
                      onClick={() => onDeleteView(v)}
                    >
                      <Trash2 className="size-3.5" />
                      Delete view
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              )}
            </div>
          );
        })}
        {canWriteViews && (
          <button
            type="button"
            aria-label="Save current state as a new view"
            onClick={onSaveAsNew}
            className="flex items-center px-2 text-muted-foreground hover:text-foreground"
          >
            <Plus className="size-3.5" />
          </button>
        )}
      </nav>

      <div className="ml-auto flex flex-wrap items-center gap-2 py-1.5">
        {filters.map((f, i) => {
          const field = byKey.get(f.fieldKey);
          if (!field) return null;
          const cfg = (field.config ?? {}) as {
            options?: { value: string; label: string }[];
          };
          const valueLabel =
            field.type === 'picklist' || field.type === 'multipicklist'
              ? cfg.options?.find((o) => o.value === f.value)?.label
              : undefined;
          return (
            <span
              key={`${f.fieldKey}-${i}`}
              className="inline-flex h-6 items-center gap-1 rounded-full border border-[var(--accent-ring)] bg-[var(--accent-soft)] px-2 text-[var(--accent)] text-xs"
            >
              {chipLabel(f, field.label, valueLabel)}
              <button
                type="button"
                aria-label={`Remove filter on ${field.label}`}
                onClick={() => removeFilter(i)}
                className="hover:opacity-70"
              >
                <X className="size-3" />
              </button>
            </span>
          );
        })}
        <FilterDialog
          fields={fields}
          filters={filters}
          onChange={onFiltersChange}
          loadReferenceOptions={loadReferenceOptions}
        />
        <div className="relative">
          <Search className="-translate-y-1/2 absolute top-1/2 left-2.5 size-3.5 text-muted-foreground" />
          <Input
            value={searchValue}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder={searchPlaceholder ?? 'Search…'}
            className="h-8 w-52 pl-8"
          />
        </div>
        {createAction}
      </div>
    </div>
  );
}
