'use client';

// ReportRenderer — saved `report` views. The view row's `config` holds a
// ReportConfig ({ groupBy(+grain), groupBy2(+grain), measure, chartType,
// stacked }); buckets come from record.aggregate (server-side, one native
// GROUP BY — same visibility rules as record.list; the view's stored filters
// apply there too). Renders a header strip (measure summary sentence), the
// chart via the shared AggChart switch (also used by dashboard Chart nodes),
// and a buckets table below the chart as its accessibility table-view twin.

import { AiAffordance } from '@/components/northbeam/ai-affordance';
import { useAiComposer } from '@/components/northbeam/ai-composer';
import { StatTile } from '@/components/northbeam/charts';
import { EmptyState } from '@/components/northbeam/empty-state';
import type { FieldDefLite } from '@/components/northbeam/field-render';
import { SectionCard } from '@/components/northbeam/section-card';
import { AggChart, coerceChartType } from '@/components/northbeam/views/agg-chart';
import { type AggBucket, fmtAggregate, totalOf } from '@/components/northbeam/views/aggregate-data';
import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { trpc } from '@/lib/api';
import { cn } from '@/lib/cn';
import type { ViewRenderer, ViewRendererProps } from '@/lib/views/types';
import type { Filter, ReportConfig } from '@northbeam/db/views';
import { ChartBar } from 'lucide-react';
import type { ReactNode } from 'react';
import { z } from 'zod';

const AGG_WORD: Record<string, string> = {
  sum: 'Sum',
  avg: 'Average',
  min: 'Minimum',
  max: 'Maximum',
};

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
  const hasGroup2 = Boolean(cfg.groupBy && cfg.groupBy2);
  // Shape mismatches degrade (donut+avg → bar, matrix w/o groupBy2 → table…)
  // — same coercions the dashboard Chart node applies.
  const chartType = coerceChartType(cfg.chartType, {
    agg,
    hasGroup: Boolean(cfg.groupBy),
    hasGroup2,
  });

  const query = trpc.record.aggregate.useQuery(
    {
      objectKey,
      groupBy: cfg.groupBy ?? null,
      groupByGrain: cfg.groupByGrain,
      groupBy2: hasGroup2 ? cfg.groupBy2 : undefined,
      groupBy2Grain: cfg.groupBy2Grain,
      measure: { agg, fieldKey: cfg.measure?.fieldKey },
      filters,
      limit: hasGroup2 ? 1000 : 200,
    },
    { retry: false, meta: { silent: true } },
  );

  const groupField = cfg.groupBy ? fields.find((f) => f.key === cfg.groupBy) : undefined;
  const group2Field = cfg.groupBy2 ? fields.find((f) => f.key === cfg.groupBy2) : undefined;
  const measureField =
    agg === 'count' ? undefined : fields.find((f) => f.key === cfg.measure?.fieldKey);

  const buckets = (query.data?.buckets ?? []) as AggBucket[];

  const measurePhrase =
    agg === 'count'
      ? `Count of ${objectLabel.toLowerCase() || 'record'} records`
      : `${AGG_WORD[agg] ?? agg} of ${measureField?.label ?? cfg.measure?.fieldKey ?? '—'}`;
  const summary = groupField
    ? `${measurePhrase} by ${groupField.label}${group2Field ? ` and ${group2Field.label}` : ''}`
    : measurePhrase;
  const total = totalOf(buckets, agg);
  const totalDisplay = fmtAggregate(total, measureField);
  const totalWord = agg === 'min' ? 'min' : agg === 'max' ? 'max' : 'total';

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

  const chartProps = {
    agg,
    buckets,
    options: query.data?.options,
    refLabels: query.data?.groupLabels,
    options2: query.data?.options2,
    group2Labels: query.data?.group2Labels,
    groupField,
    group2Field,
    grain: cfg.groupByGrain,
    grain2: cfg.groupBy2Grain,
    hasGroup2,
    stacked: cfg.stacked,
    measureField,
  } as const;

  let chart: ReactNode;
  if (query.isLoading) {
    chart = (
      <div className="flex flex-col gap-3">
        <Skeleton className="h-4 w-3/4" />
        <Skeleton className="h-4 w-1/2" />
        <Skeleton className="h-4 w-2/3" />
      </div>
    );
  } else if (buckets.length === 0) {
    chart = (
      <EmptyState
        title="No data to chart"
        body="No records satisfy the filters this report uses."
        size="sm"
      />
    );
  } else {
    chart = (
      <AggChart
        {...chartProps}
        chartType={chartType === 'kpi' ? 'table' : chartType}
        limit={cfg.limit}
      />
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {/* Header strip: the measure summary sentence + grand total. */}
      <Card className="flex-row items-center justify-between gap-3 px-5 py-3">
        <span className="text-muted-foreground text-sm">{summary}</span>
        {!query.isLoading && (
          <span className="shrink-0 font-medium text-foreground text-sm">
            {totalDisplay} {totalWord}
          </span>
        )}
      </Card>

      {totalTile && chartType !== 'kpi' && (
        <StatTile
          label={agg === 'min' ? 'Minimum' : agg === 'max' ? 'Maximum' : 'Total'}
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
          in plain text. Skipped when the chart already IS a table. */}
      {chartType !== 'table' &&
        chartType !== 'matrix' &&
        !query.isLoading &&
        buckets.length > 0 && (
          <SectionCard title="Report data" padding="none">
            <div className={cn('transition-opacity', dimmed && 'opacity-60')}>
              <AggChart {...chartProps} chartType="table" />
            </div>
          </SectionCard>
        )}
    </div>
  );
}

export function ReportView({ view, objectKey, objectLabel, fields }: ViewRendererProps) {
  // The report header's quiet AI door (brief placement #1) — a shortcut into
  // the same composer the ⌘K palette's "AI" group opens.
  const composer = useAiComposer();
  return (
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
          onClick={() => composer.open({ objectKey })}
        />
      }
    />
  );
}

// Client-side mirror of the server's ReportConfigSchema (trpc/report-config.ts)
// — the server re-validates on save, so this only guards the save dialog.
const DateGrainSchema = z.enum(['day', 'week', 'month', 'quarter', 'year']);
const ReportConfigSchema = z
  .object({
    groupBy: z.string().nullable(),
    groupByGrain: DateGrainSchema.optional(),
    groupBy2: z.string().nullable().optional(),
    groupBy2Grain: DateGrainSchema.optional(),
    measure: z.object({
      agg: z.enum(['count', 'sum', 'avg', 'min', 'max']),
      fieldKey: z.string().optional(),
    }),
    chartType: z.enum([
      'bar',
      'line',
      'area',
      'donut',
      'scatter',
      'funnel',
      'kpi',
      'table',
      'matrix',
    ]),
    stacked: z.boolean().optional(),
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
