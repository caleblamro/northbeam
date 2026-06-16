'use client';

// RecordGrid — tile / card presentation of records. Each card is a Link to
// the record's detail page; the body shows the configured fields in a
// compact description-list. Pairs with RecordTable as the second
// composable record primitive the AI artifact engine can drop into a
// generated view.

import { type FieldDefLite, FieldValue } from '@/components/northbeam/field-render';
import type { RecordRow } from '@/components/northbeam/record-data-grid';
import { cn } from '@/lib/cn';
import { cva, type VariantProps } from 'class-variance-authority';
import Link from 'next/link';

export type { RecordRow };

const gridVariants = cva('grid gap-3', {
  variants: {
    columns: {
      '1': 'grid-cols-1',
      '2': 'grid-cols-1 sm:grid-cols-2',
      '3': 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-3',
      '4': 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4',
    },
  },
  defaultVariants: { columns: '3' },
});

interface RecordGridProps extends VariantProps<typeof gridVariants> {
  fields: FieldDefLite[];
  rows: RecordRow[];
  refLabels: Record<string, string>;
  objectKey: string;
  className?: string;
}

export function RecordGrid({
  fields,
  rows,
  refLabels,
  objectKey,
  columns,
  className,
}: RecordGridProps) {
  return (
    <div className={cn(gridVariants({ columns }), className)}>
      {rows.map((row) => (
        <Link
          key={row.id}
          href={`/${objectKey}/${row.id}`}
          className={cn(
            'flex flex-col gap-2 rounded-md border bg-card p-3.5 text-left transition-colors',
            'hover:border-foreground/30 hover:bg-muted/40',
          )}
        >
          <div className="font-semibold text-foreground">{row.name}</div>
          {fields.length > 0 && (
            <dl className="grid gap-x-2 gap-y-0.5 text-xs sm:grid-cols-[88px_1fr]">
              {fields.map((f) => (
                <RecordGridRow
                  key={f.key}
                  field={f}
                  value={row.data[f.key]}
                  referenceLabel={refLabels[String(row.data[f.key])]}
                />
              ))}
            </dl>
          )}
        </Link>
      ))}
    </div>
  );
}

function RecordGridRow({
  field,
  value,
  referenceLabel,
}: {
  field: FieldDefLite;
  value: unknown;
  referenceLabel?: string;
}) {
  return (
    <>
      <dt className="truncate text-muted-foreground">{field.label}</dt>
      <dd className="min-w-0 truncate text-foreground">
        <FieldValue field={field} value={value} referenceLabel={referenceLabel} />
      </dd>
    </>
  );
}
