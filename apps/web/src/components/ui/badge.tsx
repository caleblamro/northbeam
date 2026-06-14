import { type VariantProps, cva } from 'class-variance-authority';
import { Slot } from 'radix-ui';
import type * as React from 'react';

import { cn } from '@/lib/cn';

// Minimalist Badge — monochrome by default. The `tone` prop adds a small
// color-dot prefix instead of tinting the whole background. The 6+ tone
// pills that used to live in object detail + pipeline now share this one
// component. Use the `solid` variant for the rare colored-fill case.
const badgeVariants = cva(
  'inline-flex w-fit shrink-0 items-center justify-center gap-1.5 overflow-hidden whitespace-nowrap rounded-full px-2 py-0.5 font-medium text-xs transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background aria-invalid:ring-2 aria-invalid:ring-destructive/30 [&>svg]:pointer-events-none [&>svg]:size-3',
  {
    variants: {
      variant: {
        // Default: muted gray text on muted bg. Tone-pill use-case.
        default: 'bg-muted text-muted-foreground',
        // Same as default — kept for backwards compat with data-grid usages.
        secondary: 'bg-muted text-muted-foreground [a&]:hover:bg-muted/80',
        // Subtle outlined chip — even quieter than default.
        outline: 'border border-border bg-transparent text-foreground',
        // Hover-only background, used inside hovered rows.
        ghost:
          'bg-transparent text-muted-foreground [a&]:hover:bg-muted [a&]:hover:text-foreground',
        // Solid primary fill (near-black on light) — for prominent emphasis only.
        solid: 'bg-primary text-primary-foreground [a&]:hover:bg-primary/90',
        // Soft destructive — quiet error state.
        destructive: 'bg-destructive/10 text-destructive',
        // Link-styled, used inside copy.
        link: 'text-link underline-offset-4 [a&]:hover:underline',
      },
      size: {
        sm: 'h-5 px-1.5 text-[0.6875rem] [&>svg]:size-2.5',
        md: 'h-6 px-2 text-xs',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'md',
    },
  },
);

// Tone palette — mapped to flat color values that work in light + dark mode.
// The dot prefix uses the tone color; the bg/text stay neutral so the badge
// reads as a label, not a colored block.
export type BadgeTone =
  | 'neutral'
  | 'brand'
  | 'accent'
  | 'success'
  | 'warning'
  | 'danger'
  | 'text'
  | 'number'
  | 'date'
  | 'choice'
  | 'relation'
  | 'computed';

const TONE_DOT: Record<BadgeTone, string> = {
  neutral: 'var(--ink-muted)',
  brand: 'var(--brand)',
  accent: 'var(--accent)',
  success: 'var(--success)',
  warning: 'var(--warning)',
  danger: 'var(--danger)',
  // Field-type tones (kept for backwards-compat across the field type pills):
  text: 'var(--ink-muted)',
  number: 'var(--accent)',
  date: '#8b5cf6', // violet-500
  choice: 'var(--warning)',
  relation: 'var(--success)',
  computed: '#f97316', // orange-500
};

function Badge({
  className,
  variant = 'default',
  size = 'md',
  tone,
  dot = true,
  asChild = false,
  children,
  ...props
}: Omit<React.ComponentProps<'span'>, 'color'> &
  VariantProps<typeof badgeVariants> & {
    asChild?: boolean;
    tone?: BadgeTone;
    /** Render the colored dot prefix when a tone is set. Default true. */
    dot?: boolean;
  }) {
  const Comp = asChild ? Slot.Root : 'span';
  const dotColor = tone && dot ? TONE_DOT[tone] : undefined;

  return (
    <Comp
      data-slot="badge"
      data-variant={variant}
      data-tone={tone}
      className={cn(badgeVariants({ variant, size }), className)}
      {...props}
    >
      {dotColor && (
        <span
          aria-hidden="true"
          className="inline-block size-1.5 shrink-0 rounded-full"
          style={{ background: dotColor }}
        />
      )}
      {children}
    </Comp>
  );
}

export { Badge, badgeVariants };
