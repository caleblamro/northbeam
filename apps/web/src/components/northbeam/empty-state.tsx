'use client';

// EmptyState — DiceUI-native version of the legacy EmptyState in page-head.tsx.
// Uses Tailwind utilities and CVA variants instead of inline styles. Renders
// inside Card, SectionCard, Table cell, or anywhere a "nothing here" hint is
// needed.

import { cn } from '@/lib/cn';
import { type VariantProps, cva } from 'class-variance-authority';
import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';

const emptyStateVariants = cva(
  'flex flex-col items-center justify-center gap-3 text-center text-muted-foreground',
  {
    variants: {
      size: {
        sm: 'gap-2 px-4 py-8',
        md: 'gap-3 px-6 py-16',
        lg: 'gap-3.5 px-8 py-24',
      },
    },
    defaultVariants: { size: 'md' },
  },
);

const iconBoxVariants = cva('grid place-items-center text-muted-foreground/80', {
  variants: {
    size: {
      sm: 'size-9 rounded-md bg-muted [&_svg]:size-4',
      md: 'size-12 rounded-lg bg-muted [&_svg]:size-5',
      lg: 'size-14 rounded-lg bg-muted [&_svg]:size-6',
    },
  },
  defaultVariants: { size: 'md' },
});

interface EmptyStateProps extends VariantProps<typeof emptyStateVariants> {
  icon?: LucideIcon;
  title: ReactNode;
  body?: ReactNode;
  action?: ReactNode;
  className?: string;
}

export function EmptyState({ icon: Icon, title, body, action, size, className }: EmptyStateProps) {
  return (
    <div className={cn(emptyStateVariants({ size }), className)}>
      {Icon && (
        <div className={cn(iconBoxVariants({ size }))}>
          <Icon />
        </div>
      )}
      <div className="font-semibold text-base text-foreground">{title}</div>
      {body && <div className="max-w-prose text-sm leading-relaxed">{body}</div>}
      {action && <div className="mt-1.5">{action}</div>}
    </div>
  );
}
