'use client';

// Shared walker for artifact trees. Used by the dashboard view renderer AND
// the AI dialog preview so the two paths render identically — a dashboard
// authored by the LLM and saved via the dialog ends up matching what the
// dialog showed in preview.
//
// Schema mirrors apps/api/src/ai/artifact-generator.ts. ANY new component
// added there needs a matching renderer here (and vice versa). Unknown
// components fall back to a soft "Unsupported component" placeholder so a
// drift between generator + renderer never crashes a page.
//
// Layout: top-level nodes land on a 12-column grid. Every node may carry
// `props.span` (1-12, default 12) — old artifacts without spans render
// exactly as before (full-width stack). Children inside a SectionCard keep
// a plain vertical stack.

import { BarList, type ChartDatum, Donut, StatTile } from '@/components/northbeam/charts';
import { DescriptionList } from '@/components/northbeam/description-list';
import { EmptyState } from '@/components/northbeam/empty-state';
import type { FieldDefLite } from '@/components/northbeam/field-render';
import { MetricGroup } from '@/components/northbeam/metric-group';
import { PageHeader } from '@/components/northbeam/page-header';
import { RecordGrid } from '@/components/northbeam/record-grid';
import { RecordTable } from '@/components/northbeam/record-table';
import { SectionCard } from '@/components/northbeam/section-card';
import { Skeleton } from '@/components/ui/skeleton';
import { trpc } from '@/lib/api';
import { cn } from '@/lib/cn';
import { rowPassesFilters, sortRows } from '@/lib/filters';
import type { Filter, ViewSort } from '@northbeam/db/views';
import { AlertTriangle } from 'lucide-react';
import { type ReactNode, useMemo } from 'react';

/** What a single artifact node looks like at runtime. The generator's Zod
 *  schema is the source of truth; we keep this type loose so the renderer
 *  is resilient to format changes from older saved dashboards. */
export type ArtifactNode = {
  component: string;
  props?: Record<string, unknown>;
  children?: ArtifactNode[];
};

export type Artifact = {
  version: '1';
  components: ArtifactNode[];
};

/* ── Grid spans ─────────────────────────────────────────────────────────── */

// Tailwind can't build class names dynamically — static map, md-and-up only
// so everything stacks to full width on small screens.
const SPAN_CLASS: Record<number, string> = {
  1: 'md:col-span-1',
  2: 'md:col-span-2',
  3: 'md:col-span-3',
  4: 'md:col-span-4',
  5: 'md:col-span-5',
  6: 'md:col-span-6',
  7: 'md:col-span-7',
  8: 'md:col-span-8',
  9: 'md:col-span-9',
  10: 'md:col-span-10',
  11: 'md:col-span-11',
  12: 'md:col-span-12',
};

function spanOf(node: ArtifactNode): number {
  const raw = Number(node.props?.span);
  if (!Number.isFinite(raw)) return 12;
  return Math.min(Math.max(Math.round(raw), 1), 12);
}

/** Render the full artifact onto a 12-column grid. Each top-level node honors
 *  `props.span`; missing/unknown spans default to 12 (= the old stacked
 *  layout, so pre-grid saved dashboards render unchanged). */
export function ArtifactView({ artifact }: { artifact: Artifact }) {
  return (
    <div className="grid grid-cols-12 gap-4">
      {artifact.components.map((node, i) => (
        <div key={i} className={cn('col-span-12', SPAN_CLASS[spanOf(node)])}>
          <RenderNode node={node} />
        </div>
      ))}
    </div>
  );
}

function RenderNode({ node }: { node: ArtifactNode }): ReactNode {
  if (node.component === 'SectionCard') {
    const props = (node.props ?? {}) as { title?: string };
    return (
      <SectionCard title={props.title} className="h-full">
        <div className="flex flex-col gap-3">
          {(node.children ?? []).map((c, i) => (
            <RenderNode key={i} node={c} />
          ))}
        </div>
      </SectionCard>
    );
  }
  // MetricGroup may carry Metric children (live tiles) instead of static items.
  if (node.component === 'MetricGroup' && (node.children?.length ?? 0) > 0) {
    return (
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {(node.children ?? []).map((c, i) => (
          <RenderNode key={i} node={c} />
        ))}
      </div>
    );
  }
  return <RenderLeaf node={node} />;
}

function RenderLeaf({ node }: { node: ArtifactNode }): ReactNode {
  const props = (node.props ?? {}) as Record<string, unknown>;
  switch (node.component) {
    case 'PageHeader':
      return (
        <PageHeader
          title={(props.title as string | undefined) ?? 'Untitled'}
          subtitle={props.subtitle as string | undefined}
        />
      );
    case 'MetricGroup': {
      const items = (
        (props.items as { label: string; value?: string; delta?: string }[] | undefined) ?? []
      ).map((it) => ({
        label: it.label,
        value: it.value,
        delta: it.delta ? { text: it.delta } : undefined,
      }));
      return <MetricGroup items={items} />;
    }
    case 'Metric':
      return <MetricNode props={props} />;
    case 'Chart':
      return <ChartNode props={props} />;
    case 'DescriptionList': {
      const items = (props.items as { label: string; value: string }[] | undefined) ?? [];
      return <DescriptionList items={items} />;
    }
    case 'EmptyState':
      return (
        <EmptyState
          title={(props.title as string | undefined) ?? '—'}
          body={props.body as string | undefined}
          size="sm"
        />
      );
    case 'Text':
      return (
        <p
          className={cn(
            'text-sm leading-relaxed',
            (props.muted as boolean | undefined) && 'text-muted-foreground',
          )}
        >
          {(props.value as string | undefined) ?? ''}
        </p>
      );
    case 'RecordTable':
      return <RecordTableNode props={props} />;
    case 'RecordGrid':
      return <RecordGridNode props={props} />;
    default:
      return (
        <div className="flex items-start gap-2 rounded-md border border-dashed bg-muted/30 px-3 py-2 text-xs">
          <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-amber-600" />
          <span className="text-muted-foreground">
            Unsupported component:{' '}
            <code className="font-mono text-foreground">{node.component}</code>
          </span>
        </div>
      );
  }
}

/* ── Aggregation helpers (Chart + Metric + report renderer) ─────────────── */

export type AggregateFn = 'count' | 'sum' | 'avg';

/** Format an aggregate for display. Currency/percent follow the field type;
 *  large magnitudes compact (12.9K / $4.2M) so stat tiles stay short. */
export function fmtAggregate(n: number, field?: FieldDefLite): string {
  if (field?.type === 'currency') {
    const compact = Math.abs(n) >= 100_000;
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: field.config?.currencyCode ?? 'USD',
      notation: compact ? 'compact' : 'standard',
      maximumFractionDigits: compact ? 1 : 0,
    }).format(n);
  }
  if (field?.type === 'percent') {
    return `${n.toLocaleString('en-US', { maximumFractionDigits: 1 })}%`;
  }
  if (Math.abs(n) >= 100_000) {
    return new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 }).format(
      n,
    );
  }
  return n.toLocaleString('en-US', { maximumFractionDigits: 1 });
}

/** One group-by bucket as returned by `record.aggregate`. */
export type AggBucket = { group: string | number | boolean | null; value: number; count: number };

/** Human label for an aggregate bucket: hydrated picklist option label (the
 *  `options` record.aggregate ships), reference record label (its
 *  `groupLabels`), checkbox Yes/No, empty → "None". */
export function bucketLabel(
  group: AggBucket['group'],
  options: { value: string; label: string }[],
  refLabels: Record<string, string>,
): string {
  if (group === null || group === '') return 'None';
  if (typeof group === 'boolean') return group ? 'Yes' : 'No';
  const key = String(group);
  return options.find((o) => o.value === key)?.label ?? refLabels[key] ?? key;
}

/** Fold aggregate buckets into chart data: top-`cap` buckets plus the tail
 *  folded into "Other" (count-weighted for avg). record.aggregate returns
 *  buckets ranked by value desc, so slicing = top-N. */
export function foldBuckets(args: {
  buckets: AggBucket[];
  options?: { value: string; label: string }[] | null;
  refLabels?: Record<string, string> | null;
  agg: AggregateFn;
  cap: number;
  measureField?: FieldDefLite;
}): { items: ChartDatum[]; totalDisplay: string } {
  const { buckets, agg, cap, measureField } = args;
  const options = args.options ?? [];
  const refLabels = args.refLabels ?? {};
  const items: ChartDatum[] = buckets.slice(0, cap).map((b) => ({
    label: bucketLabel(b.group, options, refLabels),
    value: b.value,
    display: fmtAggregate(b.value, measureField),
  }));
  const tail = buckets.slice(cap);
  if (tail.length > 0) {
    const n = tail.reduce((acc, t) => acc + t.count, 0);
    const v =
      agg === 'avg'
        ? n > 0
          ? tail.reduce((acc, t) => acc + t.value * t.count, 0) / n
          : 0
        : tail.reduce((acc, t) => acc + t.value, 0);
    items.push({ label: 'Other', value: v, display: fmtAggregate(v, measureField), isOther: true });
  }
  const total = items.reduce((acc, it) => acc + Math.max(it.value, 0), 0);
  return { items, totalDisplay: fmtAggregate(total, measureField) };
}

function deltaTrend(delta: string): 'up' | 'down' | 'neutral' {
  const t = delta.trim();
  if (t.startsWith('-') || t.startsWith('↓')) return 'down';
  if (t.startsWith('+') || t.startsWith('↑')) return 'up';
  return 'neutral';
}

/* ── Live-data nodes ────────────────────────────────────────────────────── */

type MetricProps = {
  label?: string;
  /** With objectKey + fn the value is computed live; otherwise `value` is a
   *  static fallback rendered as-is. */
  objectKey?: string;
  fn?: AggregateFn;
  fieldKey?: string;
  filters?: Filter[];
  value?: string | number;
  delta?: string;
};

function MetricNode({ props }: { props: Record<string, unknown> }) {
  const p = props as MetricProps;
  const fn: AggregateFn = p.fn ?? 'count';
  const live = Boolean(p.objectKey && p.fn);

  // Server-side aggregation — same visibility rules as record.list, but over
  // ALL rows instead of the first 200. groupBy null = one totals bucket.
  const query = trpc.record.aggregate.useQuery(
    {
      objectKey: p.objectKey ?? '',
      groupBy: null,
      measure: { agg: fn, fieldKey: p.fieldKey },
      filters: p.filters ?? [],
    },
    { enabled: live, retry: false, meta: { silent: true } },
  );
  // Field metadata only shapes the display (currency/percent formatting).
  const needsField = live && fn !== 'count' && Boolean(p.fieldKey);
  const meta = trpc.object.get.useQuery(
    { key: p.objectKey ?? '' },
    { enabled: needsField, retry: false, meta: { silent: true } },
  );
  const measureField = needsField
    ? ((meta.data?.fields ?? []) as FieldDefLite[]).find((f) => f.key === p.fieldKey)
    : undefined;

  const computed =
    live && query.data ? fmtAggregate(query.data.buckets[0]?.value ?? 0, measureField) : undefined;

  const staticValue = p.value != null ? String(p.value) : undefined;
  const loading = live && (query.isLoading || (needsField && meta.isLoading));
  return (
    <StatTile
      label={p.label ?? '—'}
      value={loading ? undefined : (computed ?? staticValue ?? '—')}
      loading={loading}
      delta={p.delta ? { text: p.delta, trend: deltaTrend(p.delta) } : undefined}
      className={cn('h-full', query.isFetching && !query.isLoading && 'opacity-60')}
    />
  );
}

type ChartProps = {
  title?: string;
  objectKey?: string;
  groupBy?: string;
  measure?: string;
  fn?: AggregateFn;
  chartType?: 'bar' | 'donut';
  filters?: Filter[];
  limit?: number;
};

function ChartNode({ props }: { props: Record<string, unknown> }) {
  const p = props as ChartProps;
  const fn: AggregateFn = p.fn ?? 'count';
  // A donut states part-to-whole; averages aren't parts of a whole → bars.
  const chartType = p.chartType === 'donut' && fn !== 'avg' ? 'donut' : 'bar';
  const enabled = Boolean(p.objectKey && p.groupBy);

  // Server-side group/aggregate over ALL rows. Fetch a deep bucket set (200)
  // and keep the top-N + "Other" folding client-side — the endpoint caps
  // buckets but doesn't fold the tail.
  const query = trpc.record.aggregate.useQuery(
    {
      objectKey: p.objectKey ?? '',
      groupBy: p.groupBy,
      measure: { agg: fn, fieldKey: fn === 'count' ? undefined : p.measure },
      filters: p.filters ?? [],
      limit: 200,
    },
    { enabled, retry: false, meta: { silent: true } },
  );
  // Field metadata only shapes the display (currency/percent formatting).
  const needsField = enabled && fn !== 'count' && Boolean(p.measure);
  const meta = trpc.object.get.useQuery(
    { key: p.objectKey ?? '' },
    { enabled: needsField, retry: false, meta: { silent: true } },
  );
  const measureField = needsField
    ? ((meta.data?.fields ?? []) as FieldDefLite[]).find((f) => f.key === p.measure)
    : undefined;

  const data = useMemo(() => {
    if (!query.data) return null;
    // Top-N, tail folded into "Other". Donuts hold ≤ 6 segments (5 + Other).
    const cap =
      chartType === 'donut'
        ? Math.min(Math.max(p.limit ?? 5, 1), 5)
        : Math.min(Math.max(p.limit ?? 8, 1), 12);
    return foldBuckets({
      buckets: query.data.buckets,
      options: query.data.options,
      refLabels: query.data.groupLabels,
      agg: fn,
      cap,
      measureField,
    });
  }, [query.data, p.limit, fn, chartType, measureField]);

  if (!p.objectKey || !p.groupBy) {
    return <UnsupportedNodeNote message="Chart: missing objectKey/groupBy." />;
  }
  if (query.isError) {
    return (
      <UnsupportedNodeNote
        message={`Chart: couldn't aggregate '${p.objectKey}' (unknown object or field?).`}
      />
    );
  }

  let body: ReactNode;
  if (query.isLoading || (needsField && meta.isLoading)) {
    // Skeleton on FIRST load only — refetches hold the previous render dimmed.
    body = (
      <div className="flex flex-col gap-3">
        <Skeleton className="h-4 w-3/4" />
        <Skeleton className="h-4 w-1/2" />
        <Skeleton className="h-4 w-2/3" />
      </div>
    );
  } else if (!data || data.items.length === 0) {
    body = (
      <EmptyState
        title="No data to chart"
        body="No records satisfy the filters this chart uses."
        size="sm"
      />
    );
  } else {
    body = (
      <div className={cn('transition-opacity', query.isFetching && 'opacity-60')}>
        {chartType === 'donut' ? (
          <Donut segments={data.items} totalDisplay={data.totalDisplay} />
        ) : (
          <BarList items={data.items} />
        )}
      </div>
    );
  }
  return (
    <SectionCard title={p.title} className="h-full">
      {body}
    </SectionCard>
  );
}

type RecordTableProps = {
  objectKey?: string;
  filters?: Filter[];
  sort?: ViewSort[];
  columns?: string[];
  limit?: number;
};

function RecordTableNode({ props }: { props: Record<string, unknown> }) {
  const p = props as RecordTableProps;
  const objectKey = p.objectKey;
  const limit = Math.min(Math.max(p.limit ?? 10, 1), 50);

  const query = trpc.record.list.useQuery(
    { objectKey: objectKey ?? '', limit: 200 },
    { enabled: Boolean(objectKey), retry: false, meta: { silent: true } },
  );

  const fields = (query.data?.fields ?? []) as FieldDefLite[];
  const refLabels = query.data?.refLabels ?? {};
  const rows = useMemo(() => {
    const all = query.data?.rows ?? [];
    const filters = p.filters ?? [];
    const filtered =
      filters.length === 0 ? all : all.filter((r) => rowPassesFilters(fields, r.data, filters));
    return sortRows(fields, filtered, p.sort ?? []).slice(0, limit);
  }, [query.data, fields, p.filters, p.sort, limit]);

  const columnKeys =
    p.columns && p.columns.length > 0 ? p.columns : fields.slice(0, 4).map((f) => f.key);
  const columns = columnKeys
    .map((k) => fields.find((f) => f.key === k))
    .filter((f): f is FieldDefLite => !!f);

  if (!objectKey) {
    return <UnsupportedNodeNote message="RecordTable: missing objectKey." />;
  }
  if (query.isError) {
    return (
      <UnsupportedNodeNote
        message={`RecordTable: couldn't load '${objectKey}' (unknown object?).`}
      />
    );
  }
  if (rows.length === 0 && !query.isLoading) {
    return (
      <EmptyState
        title={`No ${objectKey}s match`}
        body="No records satisfy the filters this section uses."
        size="sm"
      />
    );
  }
  return (
    <RecordTable
      columns={columns}
      rows={rows}
      refLabels={refLabels}
      objectKey={objectKey}
      defaultPageSize={limit}
    />
  );
}

type RecordGridProps = RecordTableProps & {
  columnsCount?: 1 | 2 | 3 | 4;
};

function RecordGridNode({ props }: { props: Record<string, unknown> }) {
  const p = props as RecordGridProps;
  const objectKey = p.objectKey;
  const limit = Math.min(Math.max(p.limit ?? 12, 1), 50);

  const query = trpc.record.list.useQuery(
    { objectKey: objectKey ?? '', limit: 200 },
    { enabled: Boolean(objectKey), retry: false, meta: { silent: true } },
  );

  const fields = (query.data?.fields ?? []) as FieldDefLite[];
  const refLabels = query.data?.refLabels ?? {};
  const rows = useMemo(() => {
    const all = query.data?.rows ?? [];
    const filters = p.filters ?? [];
    const filtered =
      filters.length === 0 ? all : all.filter((r) => rowPassesFilters(fields, r.data, filters));
    return sortRows(fields, filtered, p.sort ?? []).slice(0, limit);
  }, [query.data, fields, p.filters, p.sort, limit]);

  const fieldKeys =
    p.columns && p.columns.length > 0 ? p.columns : fields.slice(0, 3).map((f) => f.key);
  const cardFields = fieldKeys
    .map((k) => fields.find((f) => f.key === k))
    .filter((f): f is FieldDefLite => !!f);

  const columnsCount = (p.columnsCount ? String(p.columnsCount) : '3') as '1' | '2' | '3' | '4';

  if (!objectKey) {
    return <UnsupportedNodeNote message="RecordGrid: missing objectKey." />;
  }
  if (query.isError) {
    return (
      <UnsupportedNodeNote
        message={`RecordGrid: couldn't load '${objectKey}' (unknown object?).`}
      />
    );
  }
  if (rows.length === 0 && !query.isLoading) {
    return (
      <EmptyState
        title={`No ${objectKey}s match`}
        body="No records satisfy the filters this section uses."
        size="sm"
      />
    );
  }
  return (
    <RecordGrid
      fields={cardFields}
      rows={rows}
      refLabels={refLabels}
      objectKey={objectKey}
      columns={columnsCount}
    />
  );
}

function UnsupportedNodeNote({ message }: { message: string }) {
  return (
    <div className="flex items-start gap-2 rounded-md border border-dashed bg-muted/30 px-3 py-2 text-xs">
      <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-amber-600" />
      <span className="text-muted-foreground">{message}</span>
    </div>
  );
}
