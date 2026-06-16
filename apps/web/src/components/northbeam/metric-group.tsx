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
  up: 'text-[var(--success)]',
  down: 'text-destructive',
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
        <Card key={i} className="px-5 py-4">
          <div className="font-medium text-[0.6875rem] text-muted-foreground uppercase tracking-[0.14em]">
            {m.label}
          </div>
          <div className="mt-2 min-h-8 font-normal text-foreground text-2xl tabular-nums tracking-[-0.025em]">
            {loading || m.value === undefined ? <Skeleton className="h-7 w-20" /> : m.value}
          </div>
          {m.delta && !loading && (
            <div
              className={cn(
                'mt-1.5 font-medium text-[0.6875rem] tabular-nums',
                trendClass[m.delta.trend ?? 'neutral'],
              )}
            >
              {m.delta.text}
            </div>
          )}
        </Card>
      ))}
    </div>
  );
}
