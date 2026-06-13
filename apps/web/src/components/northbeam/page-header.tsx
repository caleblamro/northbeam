'use client';

// Page header — gradient icon + title + subtitle + actions slot.
// One component for the canonical "what page is this" treatment.
// Variants (cva) live here so pages don't repeat the styling.

import { cn } from '@/lib/cn';
import { type VariantProps, cva } from 'class-variance-authority';
import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';

const iconBoxVariants = cva(
  'grid shrink-0 place-items-center text-primary-foreground shadow-sm',
  {
    variants: {
      size: {
        sm: 'size-9 rounded-md [&_svg]:size-4',
        md: 'size-11 rounded-lg [&_svg]:size-5',
        lg: 'size-12 rounded-lg [&_svg]:size-6',
      },
      tone: {
        brand:
          'bg-[linear-gradient(150deg,var(--brand),color-mix(in_srgb,var(--brand)_55%,#11d1c4))]',
        ai: 'bg-[linear-gradient(120deg,var(--ai),var(--ai-2))]',
        neutral: 'bg-secondary text-secondary-foreground shadow-none',
        custom: '',
      },
    },
    defaultVariants: {
      size: 'md',
      tone: 'brand',
    },
  },
);

interface PageHeaderProps extends VariantProps<typeof iconBoxVariants> {
  icon?: LucideIcon | ReactNode;
  /** Use this when `tone="custom"` — a CSS color/gradient value applied to the icon box. */
  iconColor?: string;
  title: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
  className?: string;
}

export function PageHeader({
  icon,
  iconColor,
  title,
  subtitle,
  actions,
  size,
  tone,
  className,
}: PageHeaderProps) {
  const IconNode =
    typeof icon === 'function' ? (() => {
      const Cmp = icon as LucideIcon;
      return <Cmp />;
    })() : icon;
  return (
    <header className={cn('mb-5 flex items-center gap-4', className)}>
      {icon && (
        <div
          className={cn(iconBoxVariants({ size, tone }))}
          style={iconColor ? { background: iconColor, color: '#fff' } : undefined}
        >
          {IconNode}
        </div>
      )}
      <div className="min-w-0 flex-1">
        <h1 className="font-semibold text-2xl text-foreground leading-tight tracking-[-0.02em]">
          {title}
        </h1>
        {subtitle && (
          <p className="mt-1 max-w-prose text-muted-foreground text-sm leading-snug">{subtitle}</p>
        )}
      </div>
      {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
    </header>
  );
}
