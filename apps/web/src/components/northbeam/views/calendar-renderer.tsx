'use client';

// CalendarRenderer — month grid that pins records to their date/datetime
// field value. defaultConfig picks the first date-ish field; the type
// toggle hides Calendar for objects with no date field at all.
//
// Phase 1 scope: read-only visualisation. Drag-to-date and inline event
// create are queued — the field's existing DatePicker already covers
// editing inside the drawer, so the v0 calendar surfaces what's there and
// links into detail / edit on click.

import { type FieldDefLite, FieldValue } from '@/components/northbeam/field-render';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/cn';
import type { ViewRenderer, ViewRendererProps } from '@/lib/views/types';
import {
  addMonths,
  endOfMonth,
  endOfWeek,
  format,
  isSameDay,
  isSameMonth,
  startOfMonth,
  startOfWeek,
  subMonths,
} from 'date-fns';
import { CalendarDays, ChevronLeft, ChevronRight } from 'lucide-react';
import { useMemo, useState } from 'react';
import { z } from 'zod';

type CalendarRow = ViewRendererProps['rows'][number];

type CalendarConfig = {
  /** Field key whose value pins a record to a date. Date or datetime. */
  date_field?: string;
  /** Optional field key for color-coding cards (picklist with `color` on
   *  its options gives a tiny dot). */
  color_by?: string;
  /** Field keys shown as muted secondary text on the card. */
  card_fields?: string[];
};

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function isDateLike(f: FieldDefLite): boolean {
  return f.type === 'date' || f.type === 'datetime';
}

function firstDateField(fields: FieldDefLite[]): FieldDefLite | null {
  return fields.find(isDateLike) ?? null;
}

function calendarDays(month: Date): Date[] {
  const start = startOfWeek(startOfMonth(month));
  const end = endOfWeek(endOfMonth(month));
  const out: Date[] = [];
  for (let d = start; d <= end; d = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1)) {
    out.push(d);
  }
  return out;
}

export function CalendarView({
  view,
  fields,
  rows,
  refLabels,
  onRowOpen,
}: ViewRendererProps) {
  const cfg = (view.config ?? {}) as CalendarConfig;
  const dateField =
    fields.find((f) => f.key === cfg.date_field && isDateLike(f)) ?? firstDateField(fields);
  const colorField =
    cfg.color_by !== undefined
      ? fields.find((f) => f.key === cfg.color_by && f.type === 'picklist')
      : null;

  const [month, setMonth] = useState(() => startOfMonth(new Date()));
  const today = new Date();

  // Bucket records by yyyy-MM-dd. Skips rows where the field is null or
  // unparseable — surfacing them is the FilterBar / list view's job.
  const byDate = useMemo(() => {
    const map = new Map<string, CalendarRow[]>();
    if (!dateField) return map;
    for (const r of rows) {
      const v = r.data[dateField.key];
      if (v == null || v === '') continue;
      const d = new Date(String(v));
      if (Number.isNaN(d.getTime())) continue;
      const key = format(d, 'yyyy-MM-dd');
      const arr = map.get(key) ?? [];
      arr.push(r);
      map.set(key, arr);
    }
    return map;
  }, [rows, dateField]);

  if (!dateField) {
    return (
      <div className="rounded-md border bg-card p-8 text-center text-muted-foreground text-sm">
        No date or datetime field on this object — calendar needs one to pin records to.
      </div>
    );
  }

  const days = calendarDays(month);
  const cardFieldKeys =
    cfg.card_fields && cfg.card_fields.length > 0
      ? cfg.card_fields
      : view.columns.slice(0, 1);
  const cardFields = cardFieldKeys
    .map((k) => fields.find((f) => f.key === k))
    .filter((f): f is FieldDefLite => !!f);

  return (
    <div className="flex flex-col gap-3">
      {/* Header: month name + navigation */}
      <header className="flex items-center gap-2">
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Previous month"
          onClick={() => setMonth(subMonths(month, 1))}
        >
          <ChevronLeft />
        </Button>
        <h2 className="font-medium text-base tabular-nums">{format(month, 'MMMM yyyy')}</h2>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Next month"
          onClick={() => setMonth(addMonths(month, 1))}
        >
          <ChevronRight />
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setMonth(startOfMonth(new Date()))}
        >
          Today
        </Button>
        <div className="flex-1" />
        <Badge tone="neutral" size="sm" className="text-muted-foreground">
          Pinned to <span className="ml-1 font-medium text-foreground">{dateField.label}</span>
        </Badge>
      </header>

      {/* Weekday header */}
      <div className="grid grid-cols-7 gap-px overflow-hidden rounded-md border bg-border">
        {WEEKDAYS.map((d) => (
          <div
            key={d}
            className="bg-muted/40 px-2 py-1.5 font-medium text-[10px] text-muted-foreground uppercase tracking-wider"
          >
            {d}
          </div>
        ))}
        {/* Day cells */}
        {days.map((day) => {
          const inMonth = isSameMonth(day, month);
          const isToday = isSameDay(day, today);
          const key = format(day, 'yyyy-MM-dd');
          const items = byDate.get(key) ?? [];
          return (
            <div
              key={key}
              className={cn(
                'flex min-h-[110px] flex-col gap-1 bg-card p-1.5 text-xs',
                !inMonth && 'bg-muted/20 text-muted-foreground/60',
              )}
            >
              <div
                className={cn(
                  'flex size-5 items-center justify-center self-start rounded font-medium tabular-nums',
                  isToday && 'bg-primary text-primary-foreground',
                )}
              >
                {format(day, 'd')}
              </div>
              {items.map((row) => {
                const colorOpt =
                  colorField && row.data[colorField.key]
                    ? (colorField.config?.options ?? []).find(
                        (o) => o.value === String(row.data[colorField.key]),
                      )
                    : null;
                return (
                  <button
                    key={row.id}
                    type="button"
                    onClick={() => onRowOpen(row.id)}
                    className="flex items-start gap-1.5 rounded bg-muted/50 px-1.5 py-1 text-left hover:bg-muted"
                  >
                    {colorOpt?.color && (
                      <span
                        className="mt-1 size-1.5 shrink-0 rounded-full"
                        style={{ background: colorOpt.color }}
                        aria-hidden
                      />
                    )}
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-medium text-foreground">
                        {row.name}
                      </span>
                      {cardFields.map((f) => (
                        <span
                          key={f.key}
                          className="block truncate text-[10px] text-muted-foreground"
                        >
                          <FieldValue
                            field={f}
                            value={row.data[f.key]}
                            referenceLabel={refLabels[String(row.data[f.key])]}
                          />
                        </span>
                      ))}
                    </span>
                  </button>
                );
              })}
            </div>
          );
        })}
      </div>
    </div>
  );
}

const CalendarConfigSchema = z
  .object({
    date_field: z.string().optional(),
    color_by: z.string().optional(),
    card_fields: z.array(z.string()).optional(),
  })
  .passthrough();

export const CalendarRenderer: ViewRenderer<CalendarConfig> = {
  type: 'calendar',
  label: 'Calendar',
  icon: CalendarDays,
  Component: CalendarView,
  configSchema: CalendarConfigSchema,
  defaultConfig: (fields) => {
    const d = firstDateField(fields);
    const c = fields.find((f) => f.type === 'picklist');
    return d ? { date_field: d.key, color_by: c?.key } : {};
  },
  defaultColumns: () => [],
  // Hidden from the type toggle when there's no date / datetime field.
  available: (fields) => fields.some(isDateLike),
};
