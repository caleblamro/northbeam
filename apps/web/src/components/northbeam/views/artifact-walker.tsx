'use client';

// Shared walker for artifact trees. Used by the dashboard view renderer AND
// the AI dialog preview so the two paths render identically — a dashboard
// authored by the LLM and saved via the dialog ends up matching what the
// dialog showed in preview.
//
// The strict schema lives in @northbeam/core/artifact (the generator emits it,
// view.create validates it). ANY new component added there needs a matching
// renderer here (and vice versa). Unknown components fall back to a soft
// "Unsupported component" placeholder so a drift between generator + renderer
// never crashes a page.
//
// Layout: top-level nodes land on a 12-column grid. Every node may carry
// `props.span` (1-12, default 12) — old artifacts without spans render
// exactly as before (full-width stack). Children inside a SectionCard keep
// a plain vertical stack.

import {
  BarList,
  type ChartDatum,
  Donut,
  LineChart,
  StatTile,
} from '@/components/northbeam/charts';
import { DescriptionList } from '@/components/northbeam/description-list';
import { EmptyState } from '@/components/northbeam/empty-state';
import type { FieldDefLite } from '@/components/northbeam/field-render';
import { FilterDialog } from '@/components/northbeam/filter-bar';
import { ListToolbar } from '@/components/northbeam/list-toolbar';
import { MetricGroup } from '@/components/northbeam/metric-group';
import { PageHeader } from '@/components/northbeam/page-header';
import { RecordGrid } from '@/components/northbeam/record-grid';
import { RecordTable } from '@/components/northbeam/record-table';
import { SectionCard } from '@/components/northbeam/section-card';
import { Badge } from '@/components/ui/badge';
import { Callout } from '@/components/ui/callout';
import { Progress } from '@/components/ui/progress';
import { Separator } from '@/components/ui/separator';
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
import { timeAgo } from '@/lib/time';
import type { ArtifactLike, ArtifactNodeLike } from '@northbeam/core/artifact';
import type { Filter, ViewSort } from '@northbeam/db/views';
import { motion } from 'framer-motion';
import Link from 'next/link';
import { type ReactNode, useMemo, useState } from 'react';

/** What a single artifact node looks like at runtime — the deliberately-loose
 *  `*Like` shape from @northbeam/core/artifact, so the renderer is resilient
 *  to format changes from older saved dashboards. */
export type ArtifactNode = ArtifactNodeLike;

export type Artifact = ArtifactLike;

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
 *  layout, so pre-grid saved dashboards render unchanged).
 *
 *  `headerAction` is the surface's quiet AI affordance (dashboard renderer
 *  passes it). It rides in the artifact's own PageHeader when one leads the
 *  tree (the generator's canonical layout); hand-authored artifacts without a
 *  leading header get it floated over the top-right corner instead. */
export function ArtifactView({
  artifact,
  headerAction,
}: {
  artifact: Artifact;
  headerAction?: ReactNode;
}) {
  const headerLeads = artifact.components[0]?.component === 'PageHeader';
  return (
    <div className="relative">
      {headerAction && !headerLeads && (
        <div className="absolute top-1 right-1 z-10">{headerAction}</div>
      )}
      <div className="grid grid-cols-12 gap-4">
        {artifact.components.map((node, i) => (
          <motion.div
            // biome-ignore lint/suspicious/noArrayIndexKey: artifact nodes have no ids; order is the identity
            key={i}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1], delay: Math.min(i * 0.05, 0.4) }}
            className={cn('col-span-12', SPAN_CLASS[spanOf(node)])}
          >
            <RenderNode node={node} action={i === 0 && headerLeads ? headerAction : undefined} />
          </motion.div>
        ))}
      </div>
    </div>
  );
}

function RenderNode({ node, action }: { node: ArtifactNode; action?: ReactNode }): ReactNode {
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
  return <RenderLeaf node={node} action={action} />;
}

function RenderLeaf({ node, action }: { node: ArtifactNode; action?: ReactNode }): ReactNode {
  const props = (node.props ?? {}) as Record<string, unknown>;
  switch (node.component) {
    case 'PageHeader':
      return (
        <PageHeader
          title={(props.title as string | undefined) ?? 'Untitled'}
          subtitle={props.subtitle as string | undefined}
          actions={action}
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
    case 'Callout': {
      const tone = String(props.tone ?? 'neutral');
      const variant = (
        ['info', 'warning', 'success', 'danger', 'neutral'].includes(tone) ? tone : 'neutral'
      ) as 'info' | 'warning' | 'success' | 'danger' | 'neutral';
      return (
        <Callout variant={variant} title={props.title as string | undefined}>
          {(props.body as string | undefined) ?? ''}
        </Callout>
      );
    }
    case 'Divider':
      return <Separator />;
    case 'Heading':
      return (
        <div className="pt-2">
          <h2 className="font-semibold text-base tracking-tight">
            {(props.text as string | undefined) ?? ''}
          </h2>
          {typeof props.sub === 'string' && (
            <p className="mt-0.5 text-muted-foreground text-sm">{props.sub}</p>
          )}
        </div>
      );
    case 'Progress': {
      const value = Math.min(Math.max(Number(props.value ?? 0), 0), 100);
      return (
        <div className="flex flex-col gap-1.5">
          <div className="flex items-baseline justify-between gap-3">
            <span className="text-[13px] text-foreground">
              {(props.label as string | undefined) ?? ''}
            </span>
            <span className="shrink-0 text-[13px] text-muted-foreground tabular-nums">
              {(props.display as string | undefined) ?? `${value.toLocaleString('en-US')}%`}
            </span>
          </div>
          <Progress value={value} />
        </div>
      );
    }
    case 'Chips': {
      const items = ((props.items as { label: string; tone?: string }[] | undefined) ?? []).filter(
        (c) => typeof c?.label === 'string',
      );
      return (
        <div className="flex flex-wrap gap-1.5">
          {items.map((c) => (
            <Badge key={c.label} variant={c.tone === 'outline' ? 'outline' : 'default'}>
              {c.label}
            </Badge>
          ))}
        </div>
      );
    }
    case 'RecordTable':
      return <RecordTableNode props={props} />;
    case 'RecordGrid':
      return <RecordGridNode props={props} />;
    case 'RecordList':
      return <RecordListNode props={props} />;
    default:
      return (
        <UnsupportedNodeNote
          message={
            <>
              Unsupported component: <code className="font-mono">{node.component}</code>
            </>
          }
        />
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
  chartType?: 'bar' | 'donut' | 'line' | 'table';
  filters?: Filter[];
  limit?: number;
};

function ChartNode({ props }: { props: Record<string, unknown> }) {
  const p = props as ChartProps;
  const fn: AggregateFn = p.fn ?? 'count';
  // A donut states part-to-whole; averages aren't parts of a whole → bars.
  const requested = p.chartType ?? 'bar';
  const chartType = requested === 'donut' && fn === 'avg' ? 'bar' : requested;
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
  // Field metadata shapes the display: currency/percent formatting for the
  // measure, and the group column header for table charts. object.get is
  // deduped by react-query, so sibling nodes share one fetch.
  const needsMeta = enabled && ((fn !== 'count' && Boolean(p.measure)) || chartType === 'table');
  const meta = trpc.object.get.useQuery(
    { key: p.objectKey ?? '' },
    { enabled: needsMeta, retry: false, meta: { silent: true } },
  );
  const metaFields = (meta.data?.fields ?? []) as FieldDefLite[];
  const measureField = fn === 'count' ? undefined : metaFields.find((f) => f.key === p.measure);
  const groupField = metaFields.find((f) => f.key === p.groupBy);

  const buckets = query.data?.buckets ?? [];
  const options = query.data?.options ?? [];
  const refLabels = query.data?.groupLabels ?? {};

  const data = useMemo(() => {
    if (!query.data) return null;
    if (chartType === 'line') {
      // A line reads left-to-right as an ordered series: sort by group label
      // and never fold the tail into "Other" — folding is for ranked charts.
      const labelOf = (g: AggBucket['group']) =>
        bucketLabel(g, query.data.options ?? [], query.data.groupLabels ?? {});
      const items = [...query.data.buckets]
        .sort((a, b) =>
          labelOf(a.group).localeCompare(labelOf(b.group), 'en-US', { numeric: true }),
        )
        .map((b) => ({
          label: labelOf(b.group),
          value: b.value,
          display: fmtAggregate(b.value, measureField),
        }));
      const total = items.reduce((acc, it) => acc + Math.max(it.value, 0), 0);
      return { items, totalDisplay: fmtAggregate(total, measureField) };
    }
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
  if (query.isLoading || (needsMeta && meta.isLoading)) {
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
        ) : chartType === 'line' ? (
          <LineChart points={data.items} />
        ) : chartType === 'table' ? (
          <BucketsTable {...{ buckets, options, refLabels, agg: fn, groupField, measureField }} />
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

/** Aggregate buckets as a plain table — Chart `table` type here, and the
 *  report renderer's accessibility twin below every report chart. */
export function BucketsTable({
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
  agg: AggregateFn;
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

type RecordTableProps = {
  objectKey?: string;
  filters?: Filter[];
  sort?: ViewSort[];
  columns?: string[];
  limit?: number;
};

/** The interactive-record plumbing every REAL page gets from RecordListView —
 *  search box, user-editable filters (layered on top of the artifact's pinned
 *  ones, exactly like staticFilters on object pages), and sortable headers —
 *  shared by the embedded RecordTable / RecordGrid nodes so an AI dashboard
 *  behaves like any other page, not a static snapshot. */
function useEmbeddedRecords(p: RecordTableProps, defaultLimit: number) {
  const objectKey = p.objectKey;
  const limit = Math.min(Math.max(p.limit ?? defaultLimit, 1), 50);
  const [q, setQ] = useState('');
  const [userFilters, setUserFilters] = useState<Filter[]>([]);
  const [sort, setSort] = useState<ViewSort[]>(p.sort ?? []);

  // Artifact filters are the widget's pinned scope; the user's own filters
  // layer on top — same composition RecordListView uses for staticFilters +
  // view filters + URL filters.
  const effectiveFilters = useMemo(
    () => [...(p.filters ?? []), ...userFilters],
    [p.filters, userFilters],
  );
  // The widget's `limit` is its resting size. Once the user starts slicing,
  // fetch a real working set so search/filter results aren't capped at the
  // widget height (client-side pagination takes over via footer='auto').
  const interacting = q.trim().length > 0 || userFilters.length > 0;
  const fetchLimit = interacting ? Math.max(limit, 50) : limit;

  const query = trpc.record.list.useQuery(
    {
      objectKey: objectKey ?? '',
      search: q.trim() || undefined,
      filters: effectiveFilters,
      sort,
      limit: fetchLimit,
    },
    {
      enabled: Boolean(objectKey),
      retry: false,
      meta: { silent: true },
      placeholderData: (d) => d,
    },
  );

  const fields = (query.data?.fields ?? []) as FieldDefLite[];
  const toolbar = objectKey ? (
    <ListToolbar
      className="mb-2"
      searchValue={q}
      onSearchChange={setQ}
      searchPlaceholder={`Search ${query.data?.object.labelPlural.toLowerCase() ?? 'records'}…`}
      actions={<FilterDialog fields={fields} filters={userFilters} onChange={setUserFilters} />}
    />
  ) : null;

  return {
    objectKey,
    limit,
    query,
    fields,
    refLabels: query.data?.refLabels ?? {},
    rows: query.data?.rows ?? [],
    sort,
    setSort,
    interacting,
    toolbar,
  };
}

function RecordTableNode({ props }: { props: Record<string, unknown> }) {
  const p = props as RecordTableProps;
  const { objectKey, limit, query, fields, refLabels, rows, sort, setSort, interacting, toolbar } =
    useEmbeddedRecords(p, 10);

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
        message={`RecordTable: couldn't load '${objectKey}' (unknown object or invalid filters?).`}
      />
    );
  }
  return (
    <div>
      {toolbar}
      {rows.length === 0 && !query.isLoading ? (
        <EmptyState
          title={`No ${objectKey}s match`}
          body={
            interacting
              ? 'Nothing matches your search / filters.'
              : 'No records satisfy the filters this section uses.'
          }
          size="sm"
        />
      ) : (
        <RecordTable
          columns={columns}
          rows={rows}
          refLabels={refLabels}
          objectKey={objectKey}
          defaultPageSize={limit}
          footer="auto"
          sort={sort}
          onSortChange={setSort}
        />
      )}
    </div>
  );
}

type RecordGridProps = RecordTableProps & {
  columnsCount?: 1 | 2 | 3 | 4;
};

function RecordGridNode({ props }: { props: Record<string, unknown> }) {
  const p = props as RecordGridProps;
  const { objectKey, query, fields, refLabels, rows, toolbar } = useEmbeddedRecords(p, 12);

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
        message={`RecordGrid: couldn't load '${objectKey}' (unknown object or invalid filters?).`}
      />
    );
  }
  return (
    <div>
      {toolbar}
      {rows.length === 0 && !query.isLoading ? (
        <EmptyState
          title={`No ${objectKey}s match`}
          body="No records satisfy the filters this section uses."
          size="sm"
        />
      ) : (
        <RecordGrid
          fields={cardFields}
          rows={rows}
          refLabels={refLabels}
          objectKey={objectKey}
          columns={columnsCount}
        />
      )}
    </div>
  );
}

type RecordListProps = {
  objectKey?: string;
  filters?: Filter[];
  sort?: ViewSort[];
  /** Field key rendered as the muted second line under the record name. */
  secondaryField?: string;
  limit?: number;
};

/** Compact clickable record rows — name, one secondary field, relative time.
 *  The "recent X" / "top X at a glance" primitive, quieter than a table. */
function RecordListNode({ props }: { props: Record<string, unknown> }) {
  const p = props as RecordListProps;
  const objectKey = p.objectKey;
  const limit = Math.min(Math.max(p.limit ?? 6, 1), 20);

  const query = trpc.record.list.useQuery(
    { objectKey: objectKey ?? '', filters: p.filters ?? [], sort: p.sort ?? [], limit },
    { enabled: Boolean(objectKey), retry: false, meta: { silent: true } },
  );

  const fields = (query.data?.fields ?? []) as FieldDefLite[];
  const refLabels = query.data?.refLabels ?? {};
  const rows = query.data?.rows ?? [];
  const secondary = p.secondaryField ? fields.find((f) => f.key === p.secondaryField) : undefined;

  const secondaryText = (row: (typeof rows)[number]): string | null => {
    if (!secondary) return null;
    const v = row.data[secondary.key];
    if (v == null || v === '') return null;
    if (secondary.type === 'reference') return refLabels[String(v)] ?? null;
    if (secondary.type === 'currency' || secondary.type === 'number') {
      return fmtAggregate(Number(v), secondary);
    }
    return String(v);
  };

  if (!objectKey) {
    return <UnsupportedNodeNote message="RecordList: missing objectKey." />;
  }
  if (query.isError) {
    return (
      <UnsupportedNodeNote
        message={`RecordList: couldn't load '${objectKey}' (unknown object or invalid filters?).`}
      />
    );
  }
  if (query.isLoading) {
    return (
      <div className="flex flex-col gap-3">
        {[0, 1, 2].map((i) => (
          <Skeleton key={i} className="h-9" />
        ))}
      </div>
    );
  }
  if (rows.length === 0) {
    return (
      <EmptyState
        title={`No ${objectKey}s match`}
        body="No records satisfy the filters this section uses."
        size="sm"
      />
    );
  }
  return (
    <div className="-my-1 divide-y">
      {rows.map((row) => (
        <Link
          key={row.id}
          href={`/${objectKey}/${row.id}`}
          className="group flex items-center gap-3 py-2.5"
        >
          <span className="grid size-7 shrink-0 place-items-center rounded-md bg-muted font-medium text-muted-foreground text-xs uppercase">
            {(row.name || '·').slice(0, 1)}
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate font-medium text-sm transition-colors group-hover:text-link">
              {row.name || 'Untitled'}
            </span>
            {secondaryText(row) && (
              <span className="block truncate text-muted-foreground text-xs">
                {secondaryText(row)}
              </span>
            )}
          </span>
          <span className="shrink-0 text-muted-foreground text-xs">{timeAgo(row.updatedAt)}</span>
        </Link>
      ))}
    </div>
  );
}

// Deliberately quiet: a drifted or mis-authored node is a soft gap in the
// grid, not an alarm — muted ink on a dashed hairline, no warning color.
function UnsupportedNodeNote({ message }: { message: ReactNode }) {
  return (
    <p className="rounded-md border border-dashed bg-muted/30 px-3 py-2 text-muted-foreground text-xs">
      {message}
    </p>
  );
}
