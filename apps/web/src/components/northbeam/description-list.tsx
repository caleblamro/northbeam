'use client';

// DescriptionList — the "label / value" `<dl>` pattern used in side panels and
// record summaries. Replaces 6 lines of grid-template-columns boilerplate every
// time. Variants control density and label width.

import { cn } from '@/lib/cn';
import { type VariantProps, cva } from 'class-variance-authority';
import { Fragment, type ReactNode } from 'react';

const descriptionListVariants = cva('grid items-baseline text-sm', {
  variants: {
    density: {
      compact: 'gap-x-3 gap-y-1',
      cozy: 'gap-x-3 gap-y-1.5',
      relaxed: 'gap-x-4 gap-y-2',
    },
    labelWidth: {
      auto: 'grid-cols-[1fr_auto]',
      sm: 'grid-cols-[88px_1fr]',
      md: 'grid-cols-[120px_1fr]',
      lg: 'grid-cols-[160px_1fr]',
    },
  },
  defaultVariants: { density: 'cozy', labelWidth: 'auto' },
});

export type DescriptionItem = {
  label: ReactNode;
  value: ReactNode;
  /** Override label className per-item (e.g., to highlight). */
  labelClassName?: string;
  /** Override value className per-item (e.g., tabular-nums for numbers). */
  valueClassName?: string;
};

interface DescriptionListProps extends VariantProps<typeof descriptionListVariants> {
  items: DescriptionItem[];
  className?: string;
}

export function DescriptionList({
  items,
  density,
  labelWidth,
  className,
}: DescriptionListProps) {
  return (
    <dl className={cn(descriptionListVariants({ density, labelWidth }), className)}>
      {items.map((it, i) => (
        <Fragment key={i}>
          <dt className={cn('text-muted-foreground', it.labelClassName)}>{it.label}</dt>
          <dd className={cn('min-w-0 text-foreground', it.valueClassName)}>{it.value}</dd>
        </Fragment>
      ))}
    </dl>
  );
}
