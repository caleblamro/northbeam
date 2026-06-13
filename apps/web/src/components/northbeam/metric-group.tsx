'use client';

// MetricGroup — a row of metric tiles. Built directly on Card (not DiceUI Stat,
// which has a grid layout that doesn't always lay out cleanly with Skeleton
// content). Predictable: label on top, value on the next line, optional delta
// below.

import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/cn';
import { type VariantProps, cva } from 'class-variance-authority';
import type { ReactNode } from 'react';

const metricGroupVariants = cva('grid gap-3', {
  variants: {
    columns: {
      2: 'grid-cols-2',
      3: 'grid-cols-2 lg:grid-cols-3',
      4: 'grid-cols-2 lg:grid-cols-4',
      5: 'grid-cols-2 lg:grid-cols-5',
    },
  },
  defaultVariants: { columns: 4 },
});

const trendClass: Record<'up' | 'down' | 'neutral', string> = {
  up: 'text-green-600 dark:text-green-400',
  down: 'text-red-600 dark:text-red-400',
  neutral: 'text-muted-foreground',
};

export type MetricItem = {
  label: ReactNode;
  /** Pre-formatted display value. Skeleton renders when `loading` is true. */
  value?: ReactNode;
  delta?: { text: ReactNode; trend?: 'up' | 'down' | 'neutral' };
};

interface MetricGroupProps extends VariantProps<typeof metricGroupVariants> {
  items: MetricItem[];
  loading?: boolean;
  className?: string;
}

export function MetricGroup({ items, loading, columns, className }: MetricGroupProps) {
  return (
    <div className={cn(metricGroupVariants({ columns }), className)}>
      {items.map((m, i) => (
        <Card key={i} className="px-4 py-3.5">
          <div className="font-medium text-muted-foreground text-sm">{m.label}</div>
          <div className="mt-1 min-h-8 font-semibold text-2xl tabular-nums tracking-tight text-foreground">
            {loading || m.value === undefined ? <Skeleton className="h-7 w-20" /> : m.value}
          </div>
          {m.delta && !loading && (
            <div className={cn('mt-1 font-medium text-xs', trendClass[m.delta.trend ?? 'neutral'])}>
              {m.delta.text}
            </div>
          )}
        </Card>
      ))}
    </div>
  );
}
