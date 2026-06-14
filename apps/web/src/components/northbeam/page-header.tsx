'use client';

// Page header — minimal: small muted icon (optional) + title + subtitle + actions.
// No gradient, no icon-box chrome. Hierarchy is type-driven.

import { cn } from '@/lib/cn';
import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';

interface PageHeaderProps {
  icon?: LucideIcon | ReactNode;
  title: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
  className?: string;
}

export function PageHeader({ icon, title, subtitle, actions, className }: PageHeaderProps) {
  const IconNode =
    typeof icon === 'function'
      ? (() => {
          const Cmp = icon as LucideIcon;
          return <Cmp className="size-5" />;
        })()
      : icon;
  return (
    <header className={cn('mb-7 flex items-center gap-3', className)}>
      {icon && <span className="text-muted-foreground">{IconNode}</span>}
      <div className="min-w-0 flex-1">
        <h1 className="font-medium text-2xl text-foreground leading-tight tracking-[-0.02em]">
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
