'use client';

// The step picker behind every '+' affordance on the canvas: a Command
// popover grouped Logic / Actions from the node catalog. Triggers are not
// offered — a flow has exactly one, created with the flow itself.

import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import type { FlowNodeType } from '@northbeam/core/flow';
import { useState } from 'react';
import { CATALOG_GROUPS, NODE_CATALOG } from './node-catalog';

export function AddNodeMenu({
  onPick,
  children,
  side = 'bottom',
  align = 'center',
}: {
  onPick: (type: FlowNodeType) => void;
  /** The trigger element (usually the edge-midpoint '+' button). */
  children: React.ReactNode;
  side?: 'top' | 'bottom' | 'left' | 'right';
  align?: 'start' | 'center' | 'end';
}) {
  const [open, setOpen] = useState(false);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>{children}</PopoverTrigger>
      <PopoverContent side={side} align={align} className="w-72 p-0">
        <Command>
          <CommandInput placeholder="Add a step…" autoFocus />
          <CommandList>
            <CommandEmpty>No matching steps.</CommandEmpty>
            {CATALOG_GROUPS.map((group) => (
              <CommandGroup key={group.category} heading={group.label}>
                {group.types.map((type) => {
                  const entry = NODE_CATALOG[type];
                  const Icon = entry.icon;
                  return (
                    <CommandItem
                      key={type}
                      value={`${entry.label} ${type}`}
                      onSelect={() => {
                        setOpen(false);
                        onPick(type);
                      }}
                    >
                      <Icon className="size-4 text-muted-foreground" />
                      <span className="flex min-w-0 flex-col">
                        <span className="truncate">{entry.label}</span>
                        <span className="truncate text-muted-foreground text-xs">{entry.hint}</span>
                      </span>
                    </CommandItem>
                  );
                })}
              </CommandGroup>
            ))}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
