import { type VariantProps, cva } from 'class-variance-authority';
import { Slot } from 'radix-ui';
import type * as React from 'react';

import { cn } from '@/lib/cn';

// Minimalist Chip — a small rounded-full pill used for filters/toggles.
// Quiet by default (card bg + hairline border); the selected state pulls in
// the single indigo accent via ring + text, no colored fill.
const chipVariants = cva(
  "inline-flex w-fit shrink-0 cursor-pointer select-none items-center justify-center gap-1.5 whitespace-nowrap rounded-full border border-border bg-card px-3 py-1 font-medium text-foreground text-xs outline-none transition-colors hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background disabled:pointer-events-none disabled:opacity-50 [&_svg:not([class*='size-'])]:size-3.5 [&_svg]:pointer-events-none [&_svg]:shrink-0",
  {
    variants: {
      selected: {
        // NOTE: Tailwind's `accent` utilities resolve to the light-gray
        // shadcn surface token, NOT the indigo accent — the chromatic accent
        // lives in the CSS vars (--accent / --accent-soft / --accent-ring).
        // Same soft-fill treatment as the list page's filter chips, legible
        // in both themes.
        true: 'border-[var(--accent-ring)] bg-[var(--accent-soft)] text-[var(--accent)] hover:bg-[var(--accent-soft)]',
        false: '',
      },
    },
    defaultVariants: {
      selected: false,
    },
  },
);

function Chip({
  className,
  selected = false,
  asChild = false,
  ...props
}: React.ComponentProps<'button'> &
  VariantProps<typeof chipVariants> & {
    asChild?: boolean;
  }) {
  const Comp = asChild ? Slot.Root : 'button';

  return (
    <Comp
      data-slot="chip"
      data-selected={selected}
      aria-pressed={selected || undefined}
      className={cn(chipVariants({ selected, className }))}
      {...props}
    />
  );
}

export { Chip, chipVariants };
