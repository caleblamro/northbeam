import type * as React from 'react';

import { cn } from '@/lib/cn';

export function EyebrowLabel({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <span
      data-slot="eyebrow-label"
      className={cn(
        'font-medium text-[0.6875rem] text-muted-foreground uppercase tracking-[0.16em]',
        className,
      )}
    >
      {children}
    </span>
  );
}
