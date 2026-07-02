'use client';

// Curated admin color swatches + a keyboard-operable picker. Used by the
// field editor (picklist option colors), the new-object wizard (object color)
// and the format-rules editor (semantic tones via FORMAT_TONES).
//
// HEX EXCEPTION: object + picklist colors are *stored* as hex in the DB
// (packages/db/src/seed.ts seeds them that way), so this file is the one
// sanctioned place in components for hex literals. Every value below is
// commented with the seed color / token it traces to. Everything else in the
// admin UI must keep referencing CSS vars.

import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/cn';
import type { FormatTone } from '@northbeam/db/views';
import { type VariantProps, cva } from 'class-variance-authority';
import { useRef } from 'react';

export type Swatch = {
  name: string;
  value: string;
  /** Paint color when `value` isn't itself a CSS color (e.g. semantic tone
   *  names like 'red' whose stored value maps to a CSS var). */
  color?: string;
};

/** The curated palette offered everywhere an admin picks a stored color. */
export const ADMIN_SWATCHES: Swatch[] = [
  { name: 'Indigo', value: '#635bff' }, // brand indigo — seed.ts account object color (--brand seed)
  { name: 'Blue', value: '#3d5afe' }, // seed.ts deal-stage blue ("Needs analysis")
  { name: 'Sky', value: '#0ea5e9' }, // seed.ts contact object color
  { name: 'Green', value: '#117a52' }, // seed.ts deal-stage green ("Closed won")
  { name: 'Emerald', value: '#10b981' }, // seed.ts deal object color
  { name: 'Amber', value: '#9a6800' }, // seed.ts deal-stage amber ("Negotiation")
  { name: 'Orange', value: '#f59e0b' }, // seed.ts activity object color
  { name: 'Red', value: '#df1b41' }, // seed.ts deal-stage red ("Closed lost")
  { name: 'Gray', value: '#8792a2' }, // seed.ts deal-stage gray ("Prospecting")
];

/** Semantic tone vocabulary for format rules. Names come from the stored
 *  FormatTone union; colors are theme-following CSS vars from tokens.css. */
export const FORMAT_TONES: Record<FormatTone, { label: string; fg: string; bg: string }> = {
  red: { label: 'Red', fg: 'var(--danger)', bg: 'var(--danger-bg)' },
  amber: { label: 'Amber', fg: 'var(--warning)', bg: 'var(--warning-bg)' },
  green: { label: 'Green', fg: 'var(--success)', bg: 'var(--success-bg)' },
  blue: { label: 'Blue', fg: 'var(--info)', bg: 'var(--info-bg)' },
  purple: { label: 'Purple', fg: 'var(--lilac)', bg: 'var(--lilac-bg)' },
  gray: { label: 'Gray', fg: 'var(--ink-muted)', bg: 'var(--surface-sunken)' },
};

const swatchVariants = cva(
  'shrink-0 cursor-pointer rounded-full outline-none transition-shadow focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:pointer-events-none disabled:opacity-50 data-[selected=true]:ring-2 data-[selected=true]:ring-[var(--accent)] data-[selected=true]:ring-offset-2 data-[selected=true]:ring-offset-background',
  {
    variants: {
      size: {
        sm: 'size-4',
        md: 'size-5',
      },
    },
    defaultVariants: { size: 'md' },
  },
);

/** Row of round color buttons. Roving-tabindex radiogroup: arrow keys move
 *  and select, Home/End jump, Space/Enter select the focused swatch. */
export function SwatchPicker({
  value,
  onChange,
  swatches = ADMIN_SWATCHES,
  size,
  disabled,
  label = 'Color',
  className,
}: {
  value?: string;
  onChange: (value: string) => void;
  swatches?: Swatch[];
  disabled?: boolean;
  /** Accessible group label. */
  label?: string;
  className?: string;
} & VariantProps<typeof swatchVariants>) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const selectedIndex = swatches.findIndex((s) => s.value === value);

  const focusAndSelect = (index: number) => {
    const next = (index + swatches.length) % swatches.length;
    refs.current[next]?.focus();
    const swatch = swatches[next];
    if (swatch) onChange(swatch.value);
  };

  const onKeyDown = (event: React.KeyboardEvent, index: number) => {
    switch (event.key) {
      case 'ArrowRight':
      case 'ArrowDown':
        event.preventDefault();
        focusAndSelect(index + 1);
        break;
      case 'ArrowLeft':
      case 'ArrowUp':
        event.preventDefault();
        focusAndSelect(index - 1);
        break;
      case 'Home':
        event.preventDefault();
        focusAndSelect(0);
        break;
      case 'End':
        event.preventDefault();
        focusAndSelect(swatches.length - 1);
        break;
    }
  };

  return (
    <div
      role="radiogroup"
      aria-label={label}
      className={cn('flex flex-wrap items-center gap-2', className)}
    >
      {swatches.map((swatch, i) => {
        const selected = swatch.value === value;
        // Roving tabindex: the selected swatch (or the first, when nothing is
        // selected yet) is the group's single tab stop.
        const tabbable = selected || (selectedIndex === -1 && i === 0);
        return (
          <Tooltip key={swatch.value}>
            <TooltipTrigger asChild>
              <button
                ref={(el) => {
                  refs.current[i] = el;
                }}
                type="button"
                role="radio"
                aria-checked={selected}
                aria-label={swatch.name}
                tabIndex={tabbable ? 0 : -1}
                disabled={disabled}
                data-selected={selected}
                className={cn(swatchVariants({ size }))}
                style={{ background: swatch.color ?? swatch.value }}
                onClick={() => onChange(swatch.value)}
                onKeyDown={(e) => onKeyDown(e, i)}
              />
            </TooltipTrigger>
            <TooltipContent>{swatch.name}</TooltipContent>
          </Tooltip>
        );
      })}
    </div>
  );
}
