'use client';

// ViewTypeToggle — compact icon row in the toolbar for switching between
// registered renderers (list, grid, kanban, calendar, ai). Reads
// available types from the registry so a new registration shows up here
// automatically. Disabled types (renderer.available(fields) === false)
// show a muted icon with a tooltip explaining what's missing.

import type { FieldDefLite } from '@/components/northbeam/field-render';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/cn';
import { availableViewTypes, getViewRenderer } from '@/lib/views/registry';
import type { ViewType } from '@/lib/views/types';

interface ViewTypeToggleProps {
  activeType: ViewType;
  fields: FieldDefLite[];
  onChange: (next: ViewType) => void;
  className?: string;
}

export function ViewTypeToggle({
  activeType,
  fields,
  onChange,
  className,
}: ViewTypeToggleProps) {
  const types = availableViewTypes();

  return (
    <div
      className={cn(
        'inline-flex items-center gap-0.5 rounded-md border bg-card p-0.5',
        className,
      )}
      role="tablist"
      aria-label="View type"
    >
      {types.map((type) => {
        const renderer = getViewRenderer(type);
        if (!renderer) return null;
        const Icon = renderer.icon;
        const isAvailable = renderer.available ? renderer.available(fields) : true;
        const isActive = type === activeType;
        const button = (
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            role="tab"
            aria-selected={isActive}
            disabled={!isAvailable}
            data-active={isActive ? 'true' : undefined}
            onClick={() => isAvailable && onChange(type)}
            className="size-7 text-muted-foreground data-[active=true]:bg-primary/10 data-[active=true]:text-primary"
            aria-label={renderer.label}
          >
            <Icon className="size-3.5" />
          </Button>
        );
        if (isAvailable) {
          return (
            <Tooltip key={type}>
              <TooltipTrigger asChild>{button}</TooltipTrigger>
              <TooltipContent>{renderer.label}</TooltipContent>
            </Tooltip>
          );
        }
        return (
          <Tooltip key={type}>
            <TooltipTrigger asChild>{button}</TooltipTrigger>
            <TooltipContent>
              {renderer.label} — not available for this object yet
            </TooltipContent>
          </Tooltip>
        );
      })}
    </div>
  );
}
