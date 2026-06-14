'use client';

// SectionCard — the "panel with header" pattern. Modern-minimalist defaults:
// flat (border only, no shadow), icon is optional (and OFF by default — pass
// `icon` if you really want it), light title weight, generous body padding.

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { cn } from '@/lib/cn';
import { type VariantProps, cva } from 'class-variance-authority';
import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';

const sectionCardVariants = cva('gap-0 overflow-hidden py-0', {
  variants: {
    elevation: {
      flat: 'shadow-none',
      raised: 'shadow-xs', // Stripe-inspired: very subtle shadow, hairline border.
      sunken: 'border-0 bg-muted/50 shadow-none',
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
      sm: 'px-4 py-4',
      md: 'px-5 py-5',
      lg: 'px-6 py-6',
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
            'flex items-center gap-2.5 border-b px-5 py-3.5 [.border-b]:pb-3.5',
            'has-data-[slot=card-action]:grid-cols-[1fr_auto]',
          )}
        >
          {IconCmp && <IconCmp className="size-3.5 text-muted-foreground" />}
          <CardTitle className="flex-1 font-medium text-[0.9375rem] tracking-[-0.005em]">
            {title}
          </CardTitle>
          {action && <div className="ml-auto flex items-center gap-2">{action}</div>}
        </CardHeader>
      )}
      <CardContent className={cn(bodyVariants({ padding }))}>{children}</CardContent>
    </Card>
  );
}
