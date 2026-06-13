'use client';

// CreateMenu — the "New ▾" dropdown used on every list-page header.
// Compose with PageActions or any toolbar; one line per option.

import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import type { LucideIcon } from 'lucide-react';
import { ChevronDown, Plus } from 'lucide-react';
import type { ReactNode } from 'react';

export type CreateMenuItem =
  | { type: 'item'; icon?: LucideIcon; label: ReactNode; onSelect?: () => void }
  | { type: 'label'; label: ReactNode }
  | { type: 'separator' };

interface CreateMenuProps {
  label?: ReactNode;
  items: CreateMenuItem[];
  variant?: 'default' | 'outline' | 'secondary' | 'ghost';
  align?: 'start' | 'center' | 'end';
}

export function CreateMenu({
  label = 'New',
  items,
  variant = 'default',
  align = 'end',
}: CreateMenuProps) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant={variant}>
          <Plus />
          {label}
          <ChevronDown />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align={align}>
        {items.map((it, i) => {
          if (it.type === 'label') {
            return <DropdownMenuLabel key={i}>{it.label}</DropdownMenuLabel>;
          }
          if (it.type === 'separator') {
            return <DropdownMenuSeparator key={i} />;
          }
          const IconCmp = it.icon;
          return (
            <DropdownMenuItem key={i} onSelect={it.onSelect}>
              {IconCmp && <IconCmp />}
              {it.label}
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
