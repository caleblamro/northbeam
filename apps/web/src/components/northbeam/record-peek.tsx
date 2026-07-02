'use client';

// Hovercard preview of any record: object chip + name + a few compact-layout
// fields + an Open link. Lazy — record.get only fires the first time the card
// opens, then rides the query cache.

import { HoverCard, HoverCardContent, HoverCardTrigger } from '@/components/ui/hover-card';
import { Skeleton } from '@/components/ui/skeleton';
import { type RouterOutputs, trpc } from '@/lib/api';
import type { ObjectLayout } from '@northbeam/db/field-types';
import { ArrowRight } from 'lucide-react';
import Link from 'next/link';
import { type ReactNode, useState } from 'react';
import { ObjChip } from './app-bits';
import { type FieldDefLite, FieldValue } from './field-render';

export function RecordPeek({
  objectKey,
  id,
  children,
}: {
  objectKey: string;
  id: string;
  children: ReactNode;
}) {
  const [opened, setOpened] = useState(false);
  const rec = trpc.record.get.useQuery({ objectKey, id }, { enabled: opened, retry: false });

  return (
    <HoverCard openDelay={350} closeDelay={150} onOpenChange={(open) => open && setOpened(true)}>
      <HoverCardTrigger asChild>{children}</HoverCardTrigger>
      <HoverCardContent align="start" className="w-80">
        {rec.data ? (
          <PeekBody objectKey={objectKey} id={id} data={rec.data} />
        ) : rec.isError ? (
          <p className="text-muted-foreground text-sm">Unable to preview this record.</p>
        ) : (
          <div className="flex items-center gap-2.5">
            <Skeleton className="size-7 rounded-md" />
            <div className="flex flex-1 flex-col gap-1.5">
              <Skeleton className="h-3 w-16" />
              <Skeleton className="h-4 w-36" />
            </div>
          </div>
        )}
      </HoverCardContent>
    </HoverCard>
  );
}

function PeekBody({
  objectKey,
  id,
  data,
}: {
  objectKey: string;
  id: string;
  data: RouterOutputs['record']['get'];
}) {
  const { object, fields, row, refLabels } = data;
  const byKey = new Map(fields.map((f) => [f.key, f as FieldDefLite]));
  const layout = (object.layout ?? {}) as ObjectLayout;
  const peekFields = (layout.compactKeys ?? [])
    .map((k) => byKey.get(k))
    .filter((f): f is FieldDefLite => {
      if (!f) return false;
      const v = row.data[f.key];
      return v != null && v !== '' && !(Array.isArray(v) && v.length === 0);
    })
    .slice(0, 4);

  return (
    <div className="flex flex-col">
      <div className="flex items-center gap-2.5">
        <ObjChip label={object.label} color={object.color} size={28} />
        <div className="min-w-0 flex-1">
          <div className="text-[0.6875rem] text-muted-foreground">{object.label}</div>
          <div className="truncate font-medium text-foreground text-sm">{row.name}</div>
        </div>
      </div>
      {peekFields.length > 0 && (
        <dl className="mt-3 flex flex-col gap-1.5 border-border border-t pt-3 text-sm">
          {peekFields.map((f) => {
            const v = row.data[f.key];
            return (
              <div key={f.key} className="flex items-baseline justify-between gap-3">
                <dt className="shrink-0 text-muted-foreground text-xs">{f.label}</dt>
                <dd className="min-w-0 truncate text-right text-foreground">
                  <FieldValue field={f} value={v} referenceLabel={refLabels[String(v)]} />
                </dd>
              </div>
            );
          })}
        </dl>
      )}
      <Link
        href={`/${objectKey}/${id}`}
        className="mt-3 inline-flex items-center gap-1 font-medium text-primary text-sm"
      >
        Open
        <ArrowRight className="size-3.5" />
      </Link>
    </div>
  );
}
