'use client';

// ReportRenderer — saved `report` views. The view row's `config` holds a
// ReportConfig ({ groupBy, measure, chartType }); buckets come from
// record.aggregate (server-side, same visibility rules as record.list — the
// view's stored filters apply there too). Renders a header strip (measure
// summary sentence), the chart per config.chartType (bar/line/donut/kpi/
// table — 'line' sorts buckets chronologically for date group-bys, by group
// label otherwise), and a buckets table below the chart as its accessibility
// table-view twin.

import { AiAffordance } from '@/components/northbeam/ai-affordance';
import { AIGenerateDialog } from '@/components/northbeam/ai-generate-dialog';
import { BarList, Donut, LineChart, StatTile } from '@/components/northbeam/charts';
import { EmptyState } from '@/components/northbeam/empty-state';
import type { FieldDefLite } from '@/components/northbeam/field-render';
import { SectionCard } from '@/components/northbeam/section-card';
import {
  type AggBucket,
  bucketLabel,
  fmtAggregate,
  foldBuckets,
} from '@/components/northbeam/views/artifact-walker';
import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { trpc } from '@/lib/api';
import { cn } from '@/lib/cn';
import type { ViewRenderer, ViewRendererProps } from '@/lib/views/types';
import type { Filter, ReportConfig } from '@northbeam/db/views';
import { ChartBar } from 'lucide-react';
import type { ReactNode } from 'react';
import { useMemo, useState } from 'react';
import { z } from 'zod';

/** Grand total across buckets — count/sum add up; avg folds count-weighted. */
function totalOf(buckets: AggBucket[], agg: ReportConfig['measure']['agg']): number {
  if (agg !== 'avg') return buckets.reduce((acc, b) => acc + b.value, 0);
  const n = buckets.reduce((acc, b) => acc + b.count, 0);
  return n > 0 ? buckets.reduce((acc, b) => acc + b.value * b.count, 0) / n : 0;
}

/** Props for the standalone report surface — shared by the saved-view
 *  renderer below AND the report builder's live preview, so the builder shows
 *  exactly what the saved report will render. */
export type ReportResultProps = {
  objectKey: string;
  objectLabel: string;
  fields: FieldDefLite[];
  /** The ReportConfig spec. `limit` is an optional extra key (top-N buckets
   *  before the tail folds into "Other") — the server schema tolerates it. */
  config: Partial<ReportConfig> & { limit?: number };
  filters: Filter[];
  /** SectionCard title over the chart. */
  title?: ReactNode;
  /** SectionCard `action` slot next to the title (e.g. the AI affordance).
   *  Not rendered for `kpi` reports — those have no SectionCard header. */
  titleAction?: ReactNode;
  /** Render the grand total as a StatTile above the chart (builder preview).
   *  Skipped for `kpi` — that chart already IS the total tile. */
  totalTile?: boolean;
};

export function ReportResult({
  objectKey,
  objectLabel,
  fields,
  config: cfg,
  filters,
  title,
  titleAction,
  totalTile,
}: ReportResultProps) {
  const agg = cfg.measure?.agg ?? 'count';
  // A donut states part-to-whole; averages aren't parts of a whole → bars.
  const requested = cfg.chartType ?? 'bar';
  const chartType = requested === 'donut' && agg === 'avg' ? 'bar' : requested;

  const query = trpc.record.aggregate.useQuery(
    {
      objectKey,
      groupBy: cfg.groupBy ?? null,
      measure: { agg, fieldKey: cfg.measure?.fieldKey },
      filters,
      limit: 200,
    },
    { retry: false, meta: { silent: true } },
  );

  const groupField = cfg.groupBy ? fields.find((f) => f.key === cfg.groupBy) : undefined;
  const measureField =
    agg === 'count' ? undefined : fields.find((f) => f.key === cfg.measure?.fieldKey);

  const buckets = query.data?.buckets ?? [];
  const options = query.data?.options ?? [];
  const refLabels = query.data?.groupLabels ?? {};

  const data = useMemo(() => {
    if (!query.data) return null;
    if (chartType === 'line') {
      // A line reads left-to-right as an ordered series: buckets sort by
      // their group (chronological for date/datetime group-bys, group label
      // otherwise) and the tail never folds into "Other" — folding is for
      // ranked charts, not series.
      const opts = query.data.options ?? [];
      const refs = query.data.groupLabels ?? {};
      const isDate = groupField?.type === 'date' || groupField?.type === 'datetime';
      const labelOf = (g: AggBucket['group']) => bucketLabel(g, opts, refs);
      const sorted = [...query.data.buckets].sort((a, b) => {
        if (isDate) {
          const ta = Date.parse(String(a.group ?? ''));
          const tb = Date.parse(String(b.group ?? ''));
          if (!Number.isNaN(ta) && !Number.isNaN(tb)) return ta - tb;
        }
        return labelOf(a.group).localeCompare(labelOf(b.group), 'en-US', { numeric: true });
      });
      const items = sorted.map((b) => ({
        label: labelOf(b.group),
        value: b.value,
        display: fmtAggregate(b.value, measureField),
      }));
      return { items, totalDisplay: fmtAggregate(totalOf(sorted, agg), measureField) };
    }
    // Top-N before folding into "Other" — the optional config.limit narrows
    // it; donuts hold ≤ 6 segments (5 + Other) regardless.
    const cap =
      chartType === 'donut'
        ? Math.min(Math.max(cfg.limit ?? 5, 1), 5)
        : Math.min(Math.max(cfg.limit ?? 12, 1), 12);
    return foldBuckets({
      buckets: query.data.buckets,
      options: query.data.options,
      refLabels: query.data.groupLabels,
      agg,
      cap,
      measureField,
    });
  }, [query.data, chartType, agg, measureField, groupField, cfg.limit]);

  const measurePhrase =
    agg === 'count'
      ? `Count of ${objectLabel.toLowerCase() || 'record'} records`
      : `${agg === 'sum' ? 'Sum' : 'Average'} of ${measureField?.label ?? cfg.measure?.fieldKey ?? '—'}`;
  const summary = groupField ? `${measurePhrase} by ${groupField.label}` : measurePhrase;
  const total = totalOf(buckets, agg);
  const totalDisplay = fmtAggregate(total, measureField);

  // Refetches hold the previous render at reduced opacity (skeleton is for
  // the FIRST load only) — same behavior as the dashboard Chart nodes.
  const dimmed = query.isFetching && !query.isLoading;

  if (query.isError) {
    return (
      <SectionCard padding="none">
        <EmptyState
          icon={ChartBar}
          title="Couldn't run this report"
          body={query.error.message}
          size="sm"
        />
      </SectionCard>
    );
  }

  let chart: ReactNode;
  if (query.isLoading) {
    chart = (
      <div className="flex flex-col gap-3">
        <Skeleton className="h-4 w-3/4" />
        <Skeleton className="h-4 w-1/2" />
        <Skeleton className="h-4 w-2/3" />
      </div>
    );
  } else if (!data || data.items.length === 0) {
    chart = (
      <EmptyState
        title="No data to chart"
        body="No records satisfy the filters this report uses."
        size="sm"
      />
    );
  } else if (chartType === 'donut') {
    chart = <Donut segments={data.items} totalDisplay={data.totalDisplay} />;
  } else if (chartType === 'line') {
    chart = <LineChart points={data.items} />;
  } else if (chartType === 'table') {
    chart = <BucketsTable {...{ buckets, options, refLabels, agg, groupField, measureField }} />;
  } else {
    chart = <BarList items={data.items} />;
  }

  return (
    <div className="flex flex-col gap-4">
      {/* Header strip: the measure summary sentence + grand total. */}
      <Card className="flex-row items-center justify-between gap-3 px-5 py-3">
        <span className="text-muted-foreground text-sm">{summary}</span>
        {!query.isLoading && (
          <span className="shrink-0 font-medium text-foreground text-sm">{totalDisplay} total</span>
        )}
      </Card>

      {totalTile && chartType !== 'kpi' && (
        <StatTile
          label="Total"
          value={totalDisplay}
          loading={query.isLoading}
          className={cn('transition-opacity', dimmed && 'opacity-60')}
        />
      )}

      {chartType === 'kpi' ? (
        <StatTile
          label={summary}
          value={totalDisplay}
          loading={query.isLoading}
          className={cn('transition-opacity', dimmed && 'opacity-60')}
        />
      ) : (
        <SectionCard title={title} action={titleAction}>
          <div className={cn('transition-opacity', dimmed && 'opacity-60')}>{chart}</div>
        </SectionCard>
      )}

      {/* The chart's table-view twin — every bucket, value, and record count
          in plain text. Skipped when the chart already IS the table. */}
      {chartType !== 'table' && !query.isLoading && buckets.length > 0 && (
        <SectionCard title="Report data" padding="none">
          <div className={cn('transition-opacity', dimmed && 'opacity-60')}>
            <BucketsTable {...{ buckets, options, refLabels, agg, groupField, measureField }} />
          </div>
        </SectionCard>
      )}
    </div>
  );
}

export function ReportView({ view, objectKey, objectLabel, fields }: ViewRendererProps) {
  // The report header's quiet AI door (brief placement #1) — a shortcut into
  // the same generate flow the ⌘K palette's "AI" group opens.
  const [aiOpen, setAiOpen] = useState(false);
  return (
    <>
      <ReportResult
        objectKey={objectKey}
        objectLabel={objectLabel}
        fields={fields}
        config={(view.config ?? {}) as Partial<ReportConfig> & { limit?: number }}
        filters={view.filters ?? []}
        title={view.label}
        titleAction={
          <AiAffordance
            size="sm"
            label="Ask AI about this report"
            onClick={() => setAiOpen(true)}
          />
        }
      />
      <AIGenerateDialog open={aiOpen} onOpenChange={setAiOpen} initialObjectKey={objectKey} />
    </>
  );
}

function BucketsTable({
  buckets,
  options,
  refLabels,
  agg,
  groupField,
  measureField,
}: {
  buckets: AggBucket[];
  options: { value: string; label: string }[];
  refLabels: Record<string, string>;
  agg: ReportConfig['measure']['agg'];
  groupField?: FieldDefLite;
  measureField?: FieldDefLite;
}) {
  const valueHead =
    agg === 'count' ? 'Count' : `${agg === 'sum' ? 'Sum' : 'Avg'} of ${measureField?.label ?? ''}`;
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>{groupField?.label ?? 'Group'}</TableHead>
          <TableHead className="text-right">{valueHead}</TableHead>
          {agg !== 'count' && <TableHead className="text-right">Records</TableHead>}
        </TableRow>
      </TableHeader>
      <TableBody>
        {buckets.map((b, i) => (
          <TableRow key={`${String(b.group)}-${i}`}>
            <TableCell>
              {groupField ? bucketLabel(b.group, options, refLabels) : 'All records'}
            </TableCell>
            <TableCell className="text-right tabular-nums">
              {fmtAggregate(b.value, measureField)}
            </TableCell>
            {agg !== 'count' && (
              <TableCell className="text-right text-muted-foreground tabular-nums">
                {b.count.toLocaleString('en-US')}
              </TableCell>
            )}
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

// Client-side mirror of the server's ReportConfigSchema (view.ts router) —
// the server re-validates on save, so this only guards the save dialog.
const ReportConfigSchema = z
  .object({
    groupBy: z.string().nullable(),
    measure: z.object({
      agg: z.enum(['count', 'sum', 'avg']),
      fieldKey: z.string().optional(),
    }),
    chartType: z.enum(['bar', 'donut', 'line', 'kpi', 'table']),
  })
  .passthrough();

export const ReportRenderer: ViewRenderer<ReportConfig> = {
  type: 'report',
  label: 'Report',
  icon: ChartBar,
  Component: ReportView,
  configSchema: ReportConfigSchema,
  defaultConfig: () => ({ groupBy: null, measure: { agg: 'count' }, chartType: 'kpi' }),
  defaultColumns: () => [],
};
