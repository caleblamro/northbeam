'use client';

// One collapsible object in the mapping-review step: header summary + a field
// table you can toggle each field's import status from.

import { ObjChip } from '@/components/northbeam/app-bits';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { ChevronDown, ChevronUp } from 'lucide-react';
import { useMemo, useState } from 'react';

// Mirrors MAX_RECORDS_PER_OBJECT in apps/api/src/salesforce/import.ts — the
// deliberate per-object import cap (a working slice, not a full sync).
export const MAX_RECORDS_PER_OBJECT = 100;

export type RunObject = {
  id: string;
  sfObject: string;
  sfLabel: string | null;
  action: string;
  recordCount: number;
  meta: Record<string, unknown>;
  fields: Array<{
    id: string;
    sfField: string;
    sfType: string | null;
    status: string;
    confidence: number;
    meta: Record<string, unknown>;
  }>;
};

export function ObjectMappingCard({
  object: o,
  onToggleField,
}: {
  object: RunObject;
  /** Omitted for roles without migration.run — statuses render read-only. */
  onToggleField?: (id: string, current: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const meta = o.meta as { targetKey?: string };
  const counts = useMemo(
    () => ({
      mapped: o.fields.filter((f) => f.status === 'mapped').length,
      review: o.fields.filter((f) => f.status === 'review').length,
      skip: o.fields.filter((f) => f.status === 'skip').length,
    }),
    [o.fields],
  );

  return (
    <Card className="gap-0 overflow-hidden py-0">
      <button
        type="button"
        className="flex w-full items-center gap-3 border-b bg-muted/40 px-5 py-3 text-left transition-colors hover:bg-muted/60"
        onClick={() => setOpen((v) => !v)}
      >
        <ObjChip label={o.sfLabel ?? o.sfObject} size={22} />
        <span className="font-medium text-foreground text-sm">
          {o.sfObject} → {meta.targetKey ?? '?'}
        </span>
        <Badge tone="neutral" size="sm">
          {o.recordCount > MAX_RECORDS_PER_OBJECT
            ? `${MAX_RECORDS_PER_OBJECT} of ${o.recordCount.toLocaleString()} records`
            : `${o.recordCount.toLocaleString()} records`}
        </Badge>
        <span className="ml-auto text-muted-foreground text-xs tabular-nums">
          {counts.mapped} mapped · {counts.review} review · {counts.skip} skip
        </span>
        {open ? (
          <ChevronUp className="size-4 text-muted-foreground" />
        ) : (
          <ChevronDown className="size-4 text-muted-foreground" />
        )}
      </button>
      {open && (
        <div className="max-h-[420px] overflow-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Salesforce field</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Northbeam field</TableHead>
                <TableHead className="text-right">Populated</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {o.fields.map((f) => {
                const m = f.meta as {
                  key?: string;
                  type?: string;
                  reason?: string;
                  populatedPct?: number | null;
                };
                return (
                  <TableRow key={f.id}>
                    <TableCell className="font-mono text-xs">{f.sfField}</TableCell>
                    <TableCell>
                      <Badge tone="neutral" size="sm">
                        {f.sfType}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      {f.status === 'skip' ? (
                        <span className="text-muted-foreground">—</span>
                      ) : (
                        <span>
                          {m.key} <span className="text-muted-foreground">({m.type})</span>
                        </span>
                      )}
                      {m.reason && <div className="text-muted-foreground text-xs">{m.reason}</div>}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {m.populatedPct == null ? '—' : `${m.populatedPct}%`}
                    </TableCell>
                    <TableCell>
                      <Button
                        type="button"
                        size="sm"
                        variant={
                          f.status === 'mapped'
                            ? 'default'
                            : f.status === 'review'
                              ? 'outline'
                              : 'ghost'
                        }
                        disabled={!onToggleField}
                        onClick={() => onToggleField?.(f.id, f.status)}
                      >
                        {f.status}
                      </Button>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}
    </Card>
  );
}
