'use client';

// ViewPicker — toolbar dropdown for the saved views attached to a (org,
// object). Replaces the placeholder SavedViews tabs. Groups results by
// share scope, calls out the active view, and surfaces "Save as new view…"
// when the URL has transient overrides (filters / sort / type) that
// haven't been persisted.

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from '@/components/ui/command';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { cn } from '@/lib/cn';
import { getViewIcon } from '@/lib/views/icons';
import type { ViewRow } from '@/lib/views/types';
import { Check, ChevronDown, MoreHorizontal, Pin, Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';

interface ViewPickerProps {
  views: ViewRow[];
  activeView: ViewRow;
  /** True when URL has filters / sort / type that don't match the active
   *  view — drives the "Save as new view…" affordance. */
  hasOverrides: boolean;
  onSelect: (view: ViewRow) => void;
  onSaveAsNew: () => void;
  onSetDefault?: (view: ViewRow) => void;
  onDelete?: (view: ViewRow) => void;
  /** Caller's user id — used to decide which views the user can manage. */
  currentUserId?: string | null;
  className?: string;
}

type Section = { label: string; kind: 'mine' | 'org' | 'role' | 'shared' };

const SECTION_ORDER: Section[] = [
  { kind: 'mine', label: 'My views' },
  { kind: 'org', label: 'Workspace' },
  { kind: 'role', label: 'Role-shared' },
  { kind: 'shared', label: 'Shared with me' },
];

function classifyView(view: ViewRow, currentUserId: string | null): Section['kind'] {
  if (currentUserId && view.ownerId === currentUserId) return 'mine';
  if (view.sharedWith.some((s) => s.kind === 'org')) return 'org';
  if (view.sharedWith.some((s) => s.kind === 'role')) return 'role';
  return 'shared';
}

export function ViewPicker({
  views,
  activeView,
  hasOverrides,
  onSelect,
  onSaveAsNew,
  onSetDefault,
  onDelete,
  currentUserId,
  className,
}: ViewPickerProps) {
  const [open, setOpen] = useState(false);
  const ActiveIcon = getViewIcon(activeView.icon);

  // Group views by share scope. Synthetic-default views (id === '__synthetic__')
  // never appear in the saved list — they're a runtime fallback.
  const real = views.filter((v) => v.id !== '__synthetic__');
  const grouped = new Map<Section['kind'], ViewRow[]>();
  for (const v of real) {
    const k = classifyView(v, currentUserId ?? null);
    const cur = grouped.get(k) ?? [];
    cur.push(v);
    grouped.set(k, cur);
  }

  const canManage = (view: ViewRow) => {
    // System defaults (ownerId null + isDefault) are immutable from this UI.
    if (view.ownerId === null && view.isDefault) return false;
    // Owners always manage their own; org-scope decisions defer to the API.
    return currentUserId ? view.ownerId === currentUserId : false;
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className={cn('h-8 gap-1.5 px-2 font-medium', className)}
        >
          <ActiveIcon className="size-3.5 text-muted-foreground" />
          <span className="max-w-[12rem] truncate">{activeView.label}</span>
          {hasOverrides && (
            <Badge tone="brand" size="sm" className="ml-1">
              Edited
            </Badge>
          )}
          <ChevronDown className="size-3 text-muted-foreground" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-72 p-0" align="start">
        <Command>
          <CommandInput placeholder="Find a view…" />
          <CommandList>
            <CommandEmpty>No views.</CommandEmpty>
            {SECTION_ORDER.map((section) => {
              const items = grouped.get(section.kind) ?? [];
              if (items.length === 0) return null;
              return (
                <CommandGroup key={section.kind} heading={section.label}>
                  {items.map((v) => {
                    const Icon = getViewIcon(v.icon);
                    const isActive = v.id === activeView.id;
                    const showActions = canManage(v) && (onSetDefault || onDelete);
                    return (
                      <CommandItem
                        key={v.id}
                        value={`${v.label} ${v.key}`}
                        onSelect={() => {
                          onSelect(v);
                          setOpen(false);
                        }}
                      >
                        <Icon className="size-3.5 text-muted-foreground" />
                        <span className="flex-1 truncate">{v.label}</span>
                        {v.isDefault && (
                          <span className="text-[10px] text-muted-foreground">default</span>
                        )}
                        {isActive && <Check className="size-3.5 text-primary" />}
                        {showActions && (
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <button
                                type="button"
                                aria-label="View actions"
                                className="rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"
                                onClick={(e) => e.stopPropagation()}
                                onPointerDown={(e) => e.stopPropagation()}
                              >
                                <MoreHorizontal className="size-3.5" />
                              </button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end" className="w-44">
                              {onSetDefault && !v.isDefault && (
                                <DropdownMenuItem
                                  onSelect={(e) => {
                                    e.preventDefault();
                                    onSetDefault(v);
                                    setOpen(false);
                                  }}
                                >
                                  <Pin className="size-3.5 text-muted-foreground" />
                                  Set as default
                                </DropdownMenuItem>
                              )}
                              {onDelete && (
                                <DropdownMenuItem
                                  variant="destructive"
                                  onSelect={(e) => {
                                    e.preventDefault();
                                    onDelete(v);
                                    setOpen(false);
                                  }}
                                >
                                  <Trash2 className="size-3.5" />
                                  Delete view
                                </DropdownMenuItem>
                              )}
                            </DropdownMenuContent>
                          </DropdownMenu>
                        )}
                      </CommandItem>
                    );
                  })}
                </CommandGroup>
              );
            })}
            {hasOverrides && (
              <>
                <CommandSeparator />
                <CommandGroup>
                  <CommandItem
                    onSelect={() => {
                      onSaveAsNew();
                      setOpen(false);
                    }}
                  >
                    <Plus className="size-3.5 text-muted-foreground" />
                    Save as new view…
                  </CommandItem>
                </CommandGroup>
              </>
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
