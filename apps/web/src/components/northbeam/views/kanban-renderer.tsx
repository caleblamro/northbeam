'use client';

// KanbanRenderer — groups records by a picklist field into draggable columns.
// Drag updates the field via trpc.record.update; the rest of the dispatch
// (filters, search, drawer) flows through RecordListView like every other
// renderer.
//
// Phase 0 + 1 of the View foundation only required this to register and
// render. Drag-to-reorder cards within a column is left at "respects display
// order"; cross-column drag fires the update and surfaces a toast on error.

import { type FieldDefLite, FieldValue } from '@/components/northbeam/field-render';
import { Badge } from '@/components/ui/badge';
import { Kanban, KanbanBoard, KanbanColumn, KanbanItem } from '@/components/ui/kanban';
import { trpc } from '@/lib/api';
import { notifyError } from '@/lib/api/errors';
import { cn } from '@/lib/cn';
import type { ViewRenderer, ViewRendererProps } from '@/lib/views/types';
import { KanbanSquare } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { z } from 'zod';

type KanbanItemRow = ViewRendererProps['rows'][number];

type KanbanConfig = {
  /** Field key whose value groups records into columns. Must be a picklist
   *  (validated by `available` at registration time + the editor surface). */
  group_by?: string;
  /** Optional explicit column order — picklist option values in display
   *  order. Falls back to the field's `config.options` order. */
  stage_order?: string[];
  /** Field keys shown on each card under the record name. */
  card_fields?: string[];
};

const UNASSIGNED = '__unassigned__';

function firstPicklist(fields: FieldDefLite[]): FieldDefLite | null {
  return fields.find((f) => f.type === 'picklist') ?? null;
}

export function KanbanView({
  view,
  objectKey,
  fields,
  rows,
  refLabels,
}: ViewRendererProps) {
  const utils = trpc.useUtils();
  const cfg = (view.config ?? {}) as KanbanConfig;
  const fallback = firstPicklist(fields);
  const groupField =
    fields.find((f) => f.key === cfg.group_by) ?? fallback;

  const update = trpc.record.update.useMutation({
    meta: { context: "Couldn't move that card" },
    onSuccess: () => utils.record.list.invalidate(),
  });

  // Columns + initial values. Picklist options drive column order + labels;
  // an "Unassigned" column catches rows whose value is missing.
  const columns = useMemo(() => {
    if (!groupField) return [];
    const opts = groupField.config?.options ?? [];
    const order =
      cfg.stage_order && cfg.stage_order.length > 0
        ? cfg.stage_order
        : opts.map((o) => o.value);
    const cols = order.map((value) => {
      const opt = opts.find((o) => o.value === value);
      return { id: value, label: opt?.label ?? value, color: opt?.color };
    });
    return [...cols, { id: UNASSIGNED, label: 'Unassigned', color: undefined }];
  }, [groupField, cfg.stage_order]);

  // Group rows. Kanban primitive expects `Record<columnId, Item[]>`.
  const [board, setBoard] = useState<Record<string, KanbanItemRow[]>>({});
  useEffect(() => {
    const next: Record<string, KanbanItemRow[]> = {};
    for (const col of columns) next[col.id] = [];
    if (!groupField) return setBoard(next);
    for (const r of rows) {
      const v = r.data[groupField.key];
      const key = typeof v === 'string' && v.length > 0 ? v : UNASSIGNED;
      const bucket = next[key] ?? next[UNASSIGNED];
      bucket?.push(r);
    }
    setBoard(next);
  }, [columns, groupField, rows]);

  if (!groupField) {
    return (
      <div className="rounded-md border bg-card p-8 text-center text-muted-foreground text-sm">
        No picklist field on this object — kanban needs a field to group cards by.
      </div>
    );
  }

  const cardFieldKeys =
    cfg.card_fields && cfg.card_fields.length > 0
      ? cfg.card_fields
      : view.columns.slice(0, 2);
  const cardFields = cardFieldKeys
    .map((k) => fields.find((f) => f.key === k))
    .filter((f): f is FieldDefLite => !!f);

  /** Persist cross-column drags. Drizzle returns the updated row; we
   *  invalidate so the next list query is authoritative. */
  const moveCard = async (rowId: string, fromCol: string, toCol: string) => {
    if (fromCol === toCol) return;
    try {
      await update.mutateAsync({
        objectKey,
        id: rowId,
        data: { [groupField.key]: toCol === UNASSIGNED ? null : toCol },
      });
    } catch (err) {
      notifyError(err, "Couldn't move that card");
    }
  };

  return (
    <Kanban<KanbanItemRow>
      value={board}
      onValueChange={(next) => {
        // Diff the columns to find which row crossed boundaries. The
        // primitive may also reorder within a column; that's a no-op for
        // persistence.
        for (const [colId, items] of Object.entries(next)) {
          for (const item of items) {
            const previousColId = Object.entries(board).find(([, arr]) =>
              arr.some((r) => r.id === item.id),
            )?.[0];
            if (previousColId && previousColId !== colId) {
              moveCard(item.id, previousColId, colId);
            }
          }
        }
        setBoard(next);
      }}
      getItemValue={(item) => item.id}
    >
      <KanbanBoard className="flex gap-3 overflow-x-auto pb-2">
        {columns.map((col) => {
          const items = board[col.id] ?? [];
          return (
            <KanbanColumn
              key={col.id}
              value={col.id}
              className="flex w-72 shrink-0 flex-col gap-2 rounded-md border bg-muted/30 p-2.5"
            >
              <div className="flex items-center justify-between gap-2 pb-1">
                <div className="flex items-center gap-2">
                  {col.color && (
                    <span
                      className="size-2 rounded-full"
                      style={{ background: col.color }}
                      aria-hidden
                    />
                  )}
                  <span className="font-semibold text-foreground text-sm">{col.label}</span>
                </div>
                <Badge tone="neutral" size="sm" className="tabular-nums">
                  {items.length}
                </Badge>
              </div>
              {items.map((row) => (
                <KanbanItem
                  key={row.id}
                  value={row.id}
                  className={cn(
                    'cursor-grab rounded-md border bg-card px-3 py-2.5 shadow-xs',
                    'hover:shadow-sm active:cursor-grabbing',
                  )}
                >
                  <div className="font-semibold text-foreground text-sm">{row.name}</div>
                  {cardFields.length > 0 && (
                    <div className="mt-1 flex flex-col gap-0.5 text-xs">
                      {cardFields.map((f) => (
                        <div
                          key={f.key}
                          className="flex items-center gap-1.5 text-muted-foreground"
                        >
                          <span className="font-medium text-muted-foreground/80">{f.label}:</span>
                          <span className="truncate text-foreground">
                            <FieldValue
                              field={f}
                              value={row.data[f.key]}
                              referenceLabel={refLabels[String(row.data[f.key])]}
                            />
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </KanbanItem>
              ))}
            </KanbanColumn>
          );
        })}
      </KanbanBoard>
    </Kanban>
  );
}

const KanbanConfigSchema = z
  .object({
    group_by: z.string().optional(),
    stage_order: z.array(z.string()).optional(),
    card_fields: z.array(z.string()).optional(),
  })
  .passthrough();

export const KanbanRenderer: ViewRenderer<KanbanConfig> = {
  type: 'kanban',
  label: 'Kanban',
  icon: KanbanSquare,
  Component: KanbanView,
  configSchema: KanbanConfigSchema,
  defaultConfig: (fields) => {
    const pl = firstPicklist(fields);
    return pl ? { group_by: pl.key } : {};
  },
  defaultColumns: () => [],
  // Kanban needs a picklist to group by; without one, the toggle stays
  // disabled with a tooltip explaining why.
  available: (fields) => fields.some((f) => f.type === 'picklist'),
};
