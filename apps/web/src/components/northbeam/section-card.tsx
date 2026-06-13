'use client';

// SectionCard — the "panel with header" pattern used across home/reports/detail.
// Wraps DiceUI Card with the slot layout the handoff uses everywhere: small
// icon + title left, optional action right, content body below. Variants
// control the body padding and the header weight.

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { cn } from '@/lib/cn';
import { type VariantProps, cva } from 'class-variance-authority';
import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';

const sectionCardVariants = cva('gap-0 overflow-hidden', {
  variants: {
    elevation: {
      flat: 'shadow-none',
      raised: 'shadow-sm',
      sunken: 'bg-muted/40 shadow-none',
    },
    bordered: {
      true: '',
      false: 'border-0',
    },
  },
  defaultVariants: {
    elevation: 'raised',
    bordered: true,
  },
});

const bodyVariants = cva('', {
  variants: {
    padding: {
      none: 'p-0',
      sm: 'px-4 py-3.5',
      md: 'px-5 py-4',
      lg: 'px-6 py-5',
    },
  },
  defaultVariants: { padding: 'md' },
});

interface SectionCardProps
  extends VariantProps<typeof sectionCardVariants>,
    VariantProps<typeof bodyVariants> {
  icon?: LucideIcon;
  title?: ReactNode;
  /** Right-side header content — typically a Button, link, or Badge. */
  action?: ReactNode;
  className?: string;
  children?: ReactNode;
}

export function SectionCard({
  icon: IconCmp,
  title,
  action,
  elevation,
  bordered,
  padding,
  className,
  children,
}: SectionCardProps) {
  return (
    <Card
      data-slot="section-card"
      className={cn(sectionCardVariants({ elevation, bordered }), className)}
    >
      {(title || action) && (
        <CardHeader
          className={cn(
            'flex items-center gap-2 border-b px-5 py-3',
            'has-data-[slot=card-action]:grid-cols-[1fr_auto]',
          )}
        >
          {IconCmp && <IconCmp className="size-4 text-muted-foreground" />}
          <CardTitle className="flex-1 font-semibold text-base">{title}</CardTitle>
          {action && <div className="ml-auto flex items-center gap-2">{action}</div>}
        </CardHeader>
      )}
      <CardContent className={cn(bodyVariants({ padding }))}>{children}</CardContent>
    </Card>
  );
}
