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

import { BarList, StatTile } from '@/components/northbeam/charts';
import { ConfirmDialog } from '@/components/northbeam/confirm-dialog';
import { DescriptionList } from '@/components/northbeam/description-list';
import { EmptyState } from '@/components/northbeam/empty-state';
import type { FieldDefLite } from '@/components/northbeam/field-render';
import { FieldValue } from '@/components/northbeam/field-render';
import { FilterDialog } from '@/components/northbeam/filter-bar';
import { Greeting } from '@/components/northbeam/greeting';
import { HomeAttention } from '@/components/northbeam/home-attention';
import { ListToolbar } from '@/components/northbeam/list-toolbar';
import { MetricGroup } from '@/components/northbeam/metric-group';
import { PageHeader } from '@/components/northbeam/page-header';
import { RecordFormDrawer } from '@/components/northbeam/record-form';
import { RecordGrid } from '@/components/northbeam/record-grid';
import { RecordTable } from '@/components/northbeam/record-table';
import { SectionCard } from '@/components/northbeam/section-card';
import { StagePath, findStageField } from '@/components/northbeam/stage-path';
import { AggChart, coerceChartType } from '@/components/northbeam/views/agg-chart';
import {
  type AggBucket,
  type AggregateFn,
  COMPARE_PERIODS,
  type ComparePeriod,
  bucketLabel,
  fmtAggregate,
  pctChangeDelta,
  periodStarts,
  toAggFn,
  toGrain,
} from '@/components/northbeam/views/aggregate-data';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Callout } from '@/components/ui/callout';
import { Progress } from '@/components/ui/progress';
import { Separator } from '@/components/ui/separator';
import { Skeleton } from '@/components/ui/skeleton';
import { trpc } from '@/lib/api';
import { useCurrentRole } from '@/lib/can';
import { cn } from '@/lib/cn';
import { requestComposerOpen } from '@/lib/composer-bus';
import { timeAgo } from '@/lib/time';
import {
  type ArtifactAction,
  ArtifactActionSchema,
  type ArtifactLike,
  type ArtifactNodeLike,
  type ArtifactRowAction,
  ArtifactRowActionSchema,
} from '@northbeam/core/artifact';
import { can, recordPermissionFor } from '@northbeam/core/roles';
import type { Filter, ViewSort } from '@northbeam/db/views';
import { motion } from 'framer-motion';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Fragment, type ReactNode, createContext, useContext, useMemo, useState } from 'react';

/* ── Record context (detail views) ──────────────────────────────────────────
   A `detail` view renders the artifact ON a record page: RecordFields /
   RelatedList / StagePath nodes read the current record, and the literal
   filter value '@record' resolves to the record's id so live nodes can scope
   to "this record's children". Outside record context those nodes soft-fail
   and '@record' never matches (harmless). */

export type ArtifactRecordCtx = {
  objectKey: string;
  recordId: string;
  record: { id: string; data: Record<string, unknown> };
  fields: FieldDefLite[];
  refLabels?: Record<string, string>;
};

const RecordCtx = createContext<ArtifactRecordCtx | null>(null);

/** Resolve '@record' filter values against the surrounding record context.
 *  Leaves and one level of `{ any: [...] }` groups are handled. */
function useResolvedFilters(filters: Filter[] | undefined): Filter[] {
  const ctx = useContext(RecordCtx);
  return useMemo(() => {
    const raw = filters ?? [];
    if (!ctx) return raw;
    const resolveLeaf = (f: Filter): Filter =>
      f.value === '@record' ? { ...f, value: ctx.recordId } : f;
    return raw.map((entry) => {
      const anyArr = (entry as unknown as { any?: Filter[] }).any;
      if (Array.isArray(anyArr)) {
        return { any: anyArr.map(resolveLeaf) } as unknown as Filter;
      }
      return resolveLeaf(entry);
    });
  }, [filters, ctx]);
}

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
  recordCtx,
}: {
  artifact: Artifact;
  headerAction?: ReactNode;
  /** Present when rendering a `detail` view on a record page — enables the
   *  record-bound components and '@record' filter resolution. */
  recordCtx?: ArtifactRecordCtx;
}) {
  const headerLeads = artifact.components[0]?.component === 'PageHeader';
  return (
    <RecordCtx.Provider value={recordCtx ?? null}>
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
              transition={{
                duration: 0.4,
                ease: [0.16, 1, 0.3, 1],
                delay: Math.min(i * 0.05, 0.4),
              }}
              className={cn('col-span-12', SPAN_CLASS[spanOf(node)])}
            >
              <RenderNode node={node} action={i === 0 && headerLeads ? headerAction : undefined} />
            </motion.div>
          ))}
        </div>
      </div>
    </RecordCtx.Provider>
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
    case 'Greeting':
      return <Greeting subtitle={props.subtitle as string | undefined} />;
    case 'StatBand':
      return <StatBandNode props={props} />;
    case 'AttentionQueue':
      return <HomeAttention limit={typeof props.limit === 'number' ? props.limit : undefined} />;
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
    case 'ActionBar':
      return <ActionBarNode props={props} />;
    case 'RecordFields':
      return <RecordFieldsNode props={props} />;
    case 'RelatedList':
      return <RelatedListNode props={props} />;
    case 'StagePath':
      return <StagePathNode props={props} />;
    case 'QueryBlock':
      return <QueryBlockNode props={props} />;
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

/* ── Aggregation helpers ─────────────────────────────────────────────────
   The pure helpers moved to ./aggregate-data (and BucketsTable to
   ./agg-chart) when buckets grew a second grouping level; re-exported here
   so existing imports keep working. */

export {
  type AggBucket,
  type AggregateFn,
  bucketLabel,
  fmtAggregate,
  foldBuckets,
  periodStarts,
} from '@/components/northbeam/views/aggregate-data';
export { BucketsTable } from '@/components/northbeam/views/agg-chart';

function deltaTrend(delta: string): 'up' | 'down' | 'neutral' {
  const t = delta.trim();
  if (t.startsWith('-') || t.startsWith('↓')) return 'down';
  if (t.startsWith('+') || t.startsWith('↑')) return 'up';
  return 'neutral';
}

/* ── Live-data nodes ────────────────────────────────────────────────────── */

type MetricCompare = { dateFieldKey: string; period: ComparePeriod };

/* ── StatBand — the Home hero's slim inline stat strip ──────────────────────
   One card, stats separated by hairline dividers ("$1.8M open pipeline ·
   9 open deals · …"), optional trailing link. Each item is a live aggregate
   with the same spec as Metric (label/objectKey/fn/fieldKey/filters). */

type StatBandItemSpec = {
  label?: string;
  objectKey?: string;
  fn?: AggregateFn;
  fieldKey?: string;
  filters?: Filter[];
};

function StatBandItem({ spec }: { spec: StatBandItemSpec }) {
  const fn = toAggFn(spec.fn);
  const live = Boolean(spec.objectKey && spec.fn);
  const filters = useResolvedFilters(spec.filters);
  const query = trpc.record.aggregate.useQuery(
    {
      objectKey: spec.objectKey ?? '',
      groupBy: null,
      measure: { agg: fn, fieldKey: spec.fieldKey },
      filters,
    },
    { enabled: live, retry: false, meta: { silent: true } },
  );
  const needsField = live && fn !== 'count' && Boolean(spec.fieldKey);
  const meta = trpc.object.get.useQuery(
    { key: spec.objectKey ?? '' },
    { enabled: needsField, retry: false, meta: { silent: true } },
  );
  const measureField = needsField
    ? ((meta.data?.fields ?? []) as FieldDefLite[]).find((f) => f.key === spec.fieldKey)
    : undefined;

  const display =
    live && query.data
      ? fmtAggregate(Number(query.data.buckets[0]?.value ?? 0), measureField)
      : null;

  return (
    <span className="flex items-baseline gap-2 whitespace-nowrap">
      {display == null ? (
        <Skeleton className="h-5 w-14" />
      ) : (
        <span className="font-semibold text-base tabular-nums tracking-[-0.01em]">{display}</span>
      )}
      {spec.label && <span className="text-muted-foreground text-sm">{spec.label}</span>}
    </span>
  );
}

function StatBandNode({ props }: { props: Record<string, unknown> }) {
  const items = Array.isArray(props.items) ? (props.items as StatBandItemSpec[]) : [];
  const link = (props.link ?? null) as { label?: string; href?: string } | null;
  if (items.length === 0) {
    return <UnsupportedNodeNote message="StatBand: no items configured." />;
  }
  return (
    <div className="flex items-center gap-6 overflow-x-auto rounded-xl border border-border bg-card px-5 py-3 shadow-xs">
      {items.map((spec, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: specs have no ids; order is the identity
        <Fragment key={i}>
          {i > 0 && <span className="h-6 w-px shrink-0 bg-border" />}
          <StatBandItem spec={spec} />
        </Fragment>
      ))}
      {link?.href && (
        <Link
          href={link.href}
          className="ml-auto whitespace-nowrap font-medium text-link text-sm hover:underline"
        >
          {link.label ?? 'View'} →
        </Link>
      )}
    </div>
  );
}

type MetricProps = {
  label?: string;
  /** With objectKey + fn the value is computed live; otherwise `value` is a
   *  static fallback rendered as-is. */
  objectKey?: string;
  fn?: AggregateFn;
  fieldKey?: string;
  filters?: Filter[];
  value?: string | number;
  /** Legacy free-text delta — rendered only when no `compare` spec exists.
   *  New artifacts carry `compare` (a REAL computed % change) instead; the
   *  repair pass strips model-written delta strings when compare is set. */
  delta?: string;
  compare?: MetricCompare;
};

function MetricNode({ props }: { props: Record<string, unknown> }) {
  const p = props as MetricProps;
  const fn = toAggFn(p.fn);
  const live = Boolean(p.objectKey && p.fn);
  const compare =
    live && p.compare && COMPARE_PERIODS.includes(String(p.compare.period)) ? p.compare : undefined;

  // Server-side aggregation — same visibility rules as record.list, but over
  // ALL rows instead of the first 200. groupBy null = one totals bucket.
  const metricFilters = useResolvedFilters(p.filters);
  const query = trpc.record.aggregate.useQuery(
    {
      objectKey: p.objectKey ?? '',
      groupBy: null,
      measure: { agg: fn, fieldKey: p.fieldKey },
      filters: metricFilters,
    },
    { enabled: live, retry: false, meta: { silent: true } },
  );

  // Compare = two more filtered aggregates: current period-to-date vs the
  // full previous period. Boundaries are computed once per render pass —
  // absolute ISO values, so the server needs no token support here.
  const bounds = compare ? periodStarts(compare.period) : null;
  const boundFilters = (extra: Filter[]): Filter[] => [...metricFilters, ...extra];
  const currQuery = trpc.record.aggregate.useQuery(
    {
      objectKey: p.objectKey ?? '',
      groupBy: null,
      measure: { agg: fn, fieldKey: p.fieldKey },
      filters: compare
        ? boundFilters([
            {
              fieldKey: compare.dateFieldKey,
              op: 'gte',
              value: bounds?.curr.toISOString() ?? '',
            },
          ])
        : [],
    },
    { enabled: Boolean(compare), retry: false, meta: { silent: true } },
  );
  const prevQuery = trpc.record.aggregate.useQuery(
    {
      objectKey: p.objectKey ?? '',
      groupBy: null,
      measure: { agg: fn, fieldKey: p.fieldKey },
      filters: compare
        ? boundFilters([
            {
              fieldKey: compare.dateFieldKey,
              op: 'gte',
              value: bounds?.prev.toISOString() ?? '',
            },
            {
              fieldKey: compare.dateFieldKey,
              op: 'before',
              value: bounds?.curr.toISOString() ?? '',
            },
          ])
        : [],
    },
    { enabled: Boolean(compare), retry: false, meta: { silent: true } },
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

  const computedDelta =
    compare && currQuery.data && prevQuery.data
      ? pctChangeDelta(
          currQuery.data.buckets[0]?.value ?? 0,
          prevQuery.data.buckets[0]?.value ?? 0,
          compare.period,
        )
      : undefined;
  const delta =
    computedDelta ??
    // Legacy artifacts only — repair strips free-text deltas on new ones.
    (!compare && p.delta ? { text: p.delta, trend: deltaTrend(p.delta) } : undefined);

  const staticValue = p.value != null ? String(p.value) : undefined;
  const loading = live && (query.isLoading || (needsField && meta.isLoading));
  return (
    <StatTile
      label={p.label ?? '—'}
      value={loading ? undefined : (computed ?? staticValue ?? '—')}
      loading={loading}
      delta={delta}
      className={cn('h-full', query.isFetching && !query.isLoading && 'opacity-60')}
    />
  );
}

type ChartProps = {
  title?: string;
  objectKey?: string;
  groupBy?: string;
  dateGrain?: string;
  groupBy2?: string;
  groupBy2Grain?: string;
  measure?: string;
  fn?: AggregateFn;
  chartType?: string;
  stacked?: boolean;
  filters?: Filter[];
  limit?: number;
  having?: { target: 'value' | 'count'; op: 'gt' | 'gte' | 'lt' | 'lte'; value: number };
};

function ChartNode({ props }: { props: Record<string, unknown> }) {
  const p = props as ChartProps;
  const fn = toAggFn(p.fn);
  const hasGroup2 = Boolean(p.groupBy2);
  // Degrade shape mismatches instead of erroring — old saved artifacts and
  // drifted AI output must keep rendering (unknown chartType → bar).
  const chartType = coerceChartType(p.chartType, {
    agg: fn,
    hasGroup: Boolean(p.groupBy),
    hasGroup2,
  });
  const enabled = Boolean(p.objectKey && p.groupBy);

  // Server-side group/aggregate over ALL rows — one native GROUP BY (two
  // levels ride the same query). Fetch a deep bucket set and keep the top-N +
  // "Other" folding client-side.
  const chartFilters = useResolvedFilters(p.filters);
  const query = trpc.record.aggregate.useQuery(
    {
      objectKey: p.objectKey ?? '',
      groupBy: p.groupBy,
      groupByGrain: toGrain(p.dateGrain),
      groupBy2: p.groupBy2 || undefined,
      groupBy2Grain: toGrain(p.groupBy2Grain),
      measure: { agg: fn, fieldKey: fn === 'count' ? undefined : p.measure },
      having: p.having,
      filters: chartFilters,
      limit: hasGroup2 ? 1000 : 200,
    },
    { enabled, retry: false, meta: { silent: true } },
  );
  // Field metadata shapes the display: currency/percent formatting, table
  // headers, and date-grain label detection. object.get is deduped by
  // react-query, so sibling nodes share one fetch.
  const meta = trpc.object.get.useQuery(
    { key: p.objectKey ?? '' },
    { enabled, retry: false, meta: { silent: true } },
  );
  const metaFields = (meta.data?.fields ?? []) as FieldDefLite[];
  const measureField = fn === 'count' ? undefined : metaFields.find((f) => f.key === p.measure);
  const groupField = metaFields.find((f) => f.key === p.groupBy);
  const group2Field = metaFields.find((f) => f.key === p.groupBy2);

  const buckets = (query.data?.buckets ?? []) as AggBucket[];

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
  if (query.isLoading || meta.isLoading) {
    // Skeleton on FIRST load only — refetches hold the previous render dimmed.
    body = (
      <div className="flex flex-col gap-3">
        <Skeleton className="h-4 w-3/4" />
        <Skeleton className="h-4 w-1/2" />
        <Skeleton className="h-4 w-2/3" />
      </div>
    );
  } else if (buckets.length === 0) {
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
        <AggChart
          chartType={chartType === 'kpi' ? 'bar' : chartType}
          agg={fn}
          buckets={buckets}
          options={query.data?.options}
          refLabels={query.data?.groupLabels}
          options2={query.data?.options2}
          group2Labels={query.data?.group2Labels}
          groupField={groupField}
          group2Field={group2Field}
          grain={toGrain(p.dateGrain)}
          grain2={toGrain(p.groupBy2Grain)}
          hasGroup2={hasGroup2}
          stacked={p.stacked}
          limit={p.limit}
          measureField={measureField}
        />
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

  // Artifact filters are the widget's pinned scope ('@record' resolves to
  // the surrounding record on detail pages); the user's own filters layer on
  // top — same composition RecordListView uses for staticFilters + view
  // filters + URL filters.
  const pinnedFilters = useResolvedFilters(p.filters);
  const effectiveFilters = useMemo(
    () => [...pinnedFilters, ...userFilters],
    [pinnedFilters, userFilters],
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
  /** Optional per-row one-click field write ("Mark won") — validated by the
   *  repair pass, permission-gated here, confirmed before running. */
  rowAction?: unknown;
};

/** Compact clickable record rows — name, one secondary field, relative time.
 *  The "recent X" / "top X at a glance" primitive, quieter than a table. */
function RecordListNode({ props }: { props: Record<string, unknown> }) {
  const p = props as RecordListProps;
  const objectKey = p.objectKey;
  const limit = Math.min(Math.max(p.limit ?? 6, 1), 20);
  const rowAction = useRowAction(objectKey, p.rowAction);
  const filters = useResolvedFilters(p.filters);

  const query = trpc.record.list.useQuery(
    { objectKey: objectKey ?? '', filters, sort: p.sort ?? [], limit },
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
        <div key={row.id} className="group flex items-center gap-3 py-2.5">
          <Link href={`/${objectKey}/${row.id}`} className="flex min-w-0 flex-1 items-center gap-3">
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
          </Link>
          {rowAction.action && (
            <Button
              variant="outline"
              size="xs"
              className="shrink-0 opacity-0 transition-opacity focus-visible:opacity-100 group-hover:opacity-100"
              onClick={() => rowAction.setPending({ id: row.id, name: row.name || 'this record' })}
            >
              {rowAction.action.label}
            </Button>
          )}
          <span className="shrink-0 text-muted-foreground text-xs">{timeAgo(row.updatedAt)}</span>
        </div>
      ))}
      {rowAction.action && (
        <ConfirmDialog
          open={rowAction.pending !== null}
          onOpenChange={(open) => {
            if (!open) rowAction.setPending(null);
          }}
          title={`${rowAction.action.label}?`}
          description={`This sets ${rowAction.action.fieldKey} to "${String(rowAction.action.value)}" on ${rowAction.pending?.name ?? 'this record'}.`}
          confirmLabel={rowAction.action.label}
          pending={rowAction.update.isPending}
          onConfirm={rowAction.confirm}
        />
      )}
    </div>
  );
}

/* ── Actions ─────────────────────────────────────────────────────────────
   Declarative next-steps from the closed @northbeam/core action vocabulary.
   Everything executes through existing app flows (RecordFormDrawer →
   record.create, router.push, the composer bus) so server-side permission
   checks stay authoritative; the role gate here is UX, not security. */

type CreateRecordAction = Extract<ArtifactAction, { kind: 'createRecord' }>;

function ActionBarNode({ props }: { props: Record<string, unknown> }) {
  const router = useRouter();
  const role = useCurrentRole();
  const [createAction, setCreateAction] = useState<CreateRecordAction | null>(null);

  const actions = useMemo(() => {
    const raw = Array.isArray(props.items) ? props.items : [];
    return raw
      .map((item) => ArtifactActionSchema.safeParse(item))
      .filter((r): r is { success: true; data: ArtifactAction } => r.success)
      .map((r) => r.data)
      .slice(0, 4);
  }, [props.items]);

  // Write actions hide for roles that can't write the target object.
  const visible = actions.filter(
    (a) =>
      a.kind !== 'createRecord' ||
      (role !== null && can(role, recordPermissionFor(a.objectKey, 'write'))),
  );

  // The create form needs the target object's metadata — fetched on demand.
  const meta = trpc.object.get.useQuery(
    { key: createAction?.objectKey ?? '' },
    { enabled: Boolean(createAction), retry: false, meta: { silent: true } },
  );
  const metaObject = (meta.data as { object?: { label?: string } } | undefined)?.object;

  const run = (action: ArtifactAction) => {
    if (action.kind === 'createRecord') setCreateAction(action);
    else if (action.kind === 'navigate') router.push(`/${action.objectKey}`);
    else requestComposerOpen({ prompt: action.prompt });
  };

  if (visible.length === 0) return null;
  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        {visible.map((a, i) => (
          <Button
            key={`${a.kind}-${a.label}`}
            variant={i === 0 ? 'default' : 'outline'}
            size="sm"
            onClick={() => run(a)}
          >
            {a.label}
          </Button>
        ))}
      </div>
      {createAction && meta.data && (
        <RecordFormDrawer
          open
          onClose={() => setCreateAction(null)}
          objectKey={createAction.objectKey}
          objectLabel={metaObject?.label ?? createAction.objectKey}
          fields={((meta.data as { fields?: FieldDefLite[] }).fields ?? []) as FieldDefLite[]}
          defaultValues={createAction.defaults}
        />
      )}
    </>
  );
}

/** Per-row "setField" quick action (RecordList) — confirm, then the ordinary
 *  record.update. Rendered only when the spec parses and the role can write. */
function useRowAction(objectKey: string | undefined, raw: unknown) {
  const role = useCurrentRole();
  const utils = trpc.useUtils();
  const [pending, setPending] = useState<{ id: string; name: string } | null>(null);
  const update = trpc.record.update.useMutation({
    meta: { silent: true },
    onSuccess: () => utils.record.list.invalidate(),
  });

  const action = useMemo<ArtifactRowAction | null>(() => {
    if (raw === undefined) return null;
    const parsed = ArtifactRowActionSchema.safeParse(raw);
    return parsed.success ? parsed.data : null;
  }, [raw]);

  const allowed =
    action !== null &&
    Boolean(objectKey) &&
    role !== null &&
    can(role, recordPermissionFor(objectKey ?? '', 'write'));

  const confirm = () => {
    if (!pending || !action || !objectKey) return;
    update.mutate(
      { objectKey, id: pending.id, data: { [action.fieldKey]: action.value } },
      { onSettled: () => setPending(null) },
    );
  };

  return { action: allowed ? action : null, pending, setPending, confirm, update };
}

/* ── QueryBlock (advanced declarative queries) ──────────────────────────────
   Renders a QuerySpec through record.query: a multi-measure table, or one
   selected measure as a bar list / stat tile. The spec was validated by the
   repair pass; the server re-validates + compiles with the caller's ACL. */

type QueryBlockProps = {
  title?: string;
  query?: unknown;
  display?: string;
  /** Which measure drives bar/kpi displays; defaults to the first. */
  measureKey?: string;
};

function QueryBlockNode({ props }: { props: Record<string, unknown> }) {
  const p = props as QueryBlockProps;
  const spec = (p.query ?? null) as Parameters<typeof trpc.record.query.useQuery>[0] | null;
  const query = trpc.record.query.useQuery(
    spec ?? { objectKey: '', measures: [{ id: 'm', fn: 'count' as const }] },
    { enabled: Boolean(spec), retry: false, meta: { silent: true } },
  );

  if (!spec) return <UnsupportedNodeNote message="QueryBlock: missing query spec." />;
  if (query.isError) {
    return <UnsupportedNodeNote message={`QueryBlock: ${query.error.message}`} />;
  }
  if (query.isLoading || !query.data) {
    return (
      <div className="flex flex-col gap-3">
        {[0, 1, 2].map((i) => (
          <Skeleton key={i} className="h-4" />
        ))}
      </div>
    );
  }

  const { rows, measures, groupLabels, options } = query.data;
  const labelOf = (g: string | number | boolean | null) =>
    bucketLabel(g, options ?? [], groupLabels ?? {});
  const measureKey =
    p.measureKey && measures.includes(p.measureKey) ? p.measureKey : (measures[0] ?? 'count');
  const display = ['table', 'bar', 'kpi'].includes(String(p.display))
    ? String(p.display)
    : measures.length > 1
      ? 'table'
      : 'bar';
  const hasGroups = rows.some((r) => r.group !== null) || rows.length > 1;

  const body = (() => {
    if (display === 'kpi' || !hasGroups) {
      const v = rows[0]?.values[measureKey];
      return <StatTile label={p.title ?? measureKey} value={v == null ? '—' : fmtAggregate(v)} />;
    }
    if (display === 'bar' && measures.length === 1) {
      const items = rows.map((r) => {
        const v = r.values[measureKey] ?? 0;
        return { label: labelOf(r.group), value: v, display: fmtAggregate(v) };
      });
      return <BarList items={items} />;
    }
    // Multi-measure (or explicit) table.
    return (
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b text-left text-muted-foreground text-xs">
              <th className="py-1.5 pr-3 font-medium">Group</th>
              {measures.map((id) => (
                <th key={id} className="py-1.5 pr-3 text-right font-medium">
                  {id}
                </th>
              ))}
              <th className="py-1.5 text-right font-medium">Records</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: rows have no natural id
              <tr key={i} className="border-b last:border-0">
                <td className="py-1.5 pr-3">{labelOf(r.group)}</td>
                {measures.map((id) => (
                  <td key={id} className="py-1.5 pr-3 text-right tabular-nums">
                    {r.values[id] == null ? '—' : fmtAggregate(r.values[id] ?? 0)}
                  </td>
                ))}
                <td className="py-1.5 text-right tabular-nums">{r.count.toLocaleString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  })();

  if (display === 'kpi' || !hasGroups) return body;
  return <SectionCard title={p.title}>{body}</SectionCard>;
}

/* ── Record-context nodes (detail views) ─────────────────────────────────── */

/** Label/value grid over the current record's fields. Repair guarantees the
 *  fieldKeys exist; unknown keys (drifted metadata) are skipped quietly. */
function RecordFieldsNode({ props }: { props: Record<string, unknown> }) {
  const ctx = useContext(RecordCtx);
  if (!ctx) return <UnsupportedNodeNote message="RecordFields renders on a record page only." />;
  const keys = Array.isArray(props.fieldKeys) ? props.fieldKeys.map(String) : [];
  const byKey = new Map(ctx.fields.map((f) => [f.key, f]));
  const shown = (keys.length > 0 ? keys : ctx.fields.map((f) => f.key))
    .map((k) => byKey.get(k))
    .filter((f): f is FieldDefLite => Boolean(f))
    .slice(0, 12);
  if (shown.length === 0) {
    return <UnsupportedNodeNote message="RecordFields: no known fields to show." />;
  }
  return (
    <dl className="grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-2">
      {shown.map((f) => (
        <div key={f.key} className="min-w-0">
          <dt className="text-muted-foreground text-xs">{f.label}</dt>
          <dd className="mt-0.5 truncate text-sm">
            <FieldValue
              field={f}
              value={ctx.record.data[f.key]}
              referenceLabel={
                f.type === 'reference'
                  ? ctx.refLabels?.[String(ctx.record.data[f.key] ?? '')]
                  : undefined
              }
            />
          </dd>
        </div>
      ))}
    </dl>
  );
}

/** Records of another object whose reference field points at the current
 *  record — a RecordList with the relationship filter pinned. */
function RelatedListNode({ props }: { props: Record<string, unknown> }) {
  const ctx = useContext(RecordCtx);
  if (!ctx) return <UnsupportedNodeNote message="RelatedList renders on a record page only." />;
  const objectKey = typeof props.objectKey === 'string' ? props.objectKey : undefined;
  const refFieldKey = typeof props.refFieldKey === 'string' ? props.refFieldKey : undefined;
  if (!objectKey || !refFieldKey) {
    return <UnsupportedNodeNote message="RelatedList: missing objectKey/refFieldKey." />;
  }
  return (
    <RecordListNode
      props={{
        ...props,
        objectKey,
        filters: [
          ...(Array.isArray(props.filters) ? (props.filters as Filter[]) : []),
          { fieldKey: refFieldKey, op: 'eq', value: ctx.recordId },
        ],
      }}
    />
  );
}

/** The record's stage/status progression — the same StagePath the built-in
 *  record page renders, driven by the record context. */
function StagePathNode({ props }: { props: Record<string, unknown> }) {
  const ctx = useContext(RecordCtx);
  if (!ctx) return <UnsupportedNodeNote message="StagePath renders on a record page only." />;
  const explicit =
    typeof props.fieldKey === 'string'
      ? ctx.fields.find((f) => f.key === props.fieldKey)
      : undefined;
  const field = explicit ?? findStageField(ctx.fields);
  if (!field) {
    return <UnsupportedNodeNote message="StagePath: no stage-like picklist on this object." />;
  }
  return (
    <StagePath
      objectKey={ctx.objectKey}
      recordId={ctx.recordId}
      field={field}
      value={ctx.record.data[field.key]}
    />
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
