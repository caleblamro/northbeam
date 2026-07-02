'use client';

// AiAffordance — the ONE way AI entry points appear in chrome (report headers,
// dashboard headers, builder toolbars). The pattern is deliberately quiet:
// an icon-only sparkle that ships no label, no gradient, no "AI" badge.
// With `revealOnHover`, it is invisible until the surrounding container
// (which must carry the Tailwind `group/ai` class) is hovered or focused —
// keyboard users always land on it via Tab, and every action it triggers is
// also reachable from the ⌘K palette (the tooltip carries the kbd hint).
// Accent (indigo) appears only on hover; at rest the glyph is muted ink.

import { Button } from '@/components/ui/button';
import { Kbd } from '@/components/ui/kbd';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/cn';
import { type VariantProps, cva } from 'class-variance-authority';
import { Sparkles } from 'lucide-react';

const aiAffordanceVariants = cva(
  // `text-link` is the indigo chromatic accent (--color-link: var(--accent) in
  // globals.css); `text-accent` is the light-gray surface token and would vanish
  // against the ghost hover background.
  'text-muted-foreground transition-opacity hover:text-link focus-visible:text-link',
  {
    variants: {
      revealOnHover: {
        // Hidden at rest; parent hover / any focus inside the `group/ai`
        // container (including tabbing onto this button) reveals it.
        true: 'opacity-0 focus-visible:opacity-100 group-focus-within/ai:opacity-100 group-hover/ai:opacity-100',
        false: '',
      },
      size: {
        sm: '', // maps to Button size 'icon-sm' (28px) — toolbar rows
        xs: '', // maps to Button size 'icon-xs' (24px) — dense card headers
      },
    },
    defaultVariants: { revealOnHover: false, size: 'sm' },
  },
);

interface AiAffordanceProps extends VariantProps<typeof aiAffordanceVariants> {
  /** Tooltip text + accessible name, e.g. "Ask AI about this report". */
  label: string;
  onClick: () => void;
  /** Keyboard hint shown in the tooltip. Defaults to the ⌘K palette. */
  kbdHint?: string;
  className?: string;
}

export function AiAffordance({
  label,
  onClick,
  kbdHint = '⌘K',
  revealOnHover,
  size,
  className,
}: AiAffordanceProps) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size={size === 'xs' ? 'icon-xs' : 'icon-sm'}
          aria-label={label}
          onClick={onClick}
          className={cn(aiAffordanceVariants({ revealOnHover, size }), className)}
        >
          <Sparkles />
        </Button>
      </TooltipTrigger>
      <TooltipContent side="bottom" className="flex items-center gap-1.5">
        {label}
        <Kbd>{kbdHint}</Kbd>
      </TooltipContent>
    </Tooltip>
  );
}
