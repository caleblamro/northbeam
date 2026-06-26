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

import { DescriptionList } from '@/components/northbeam/description-list';
import { EmptyState } from '@/components/northbeam/empty-state';
import type { FieldDefLite } from '@/components/northbeam/field-render';
import { MetricGroup } from '@/components/northbeam/metric-group';
import { PageHeader } from '@/components/northbeam/page-header';
import { RecordGrid } from '@/components/northbeam/record-grid';
import { RecordTable } from '@/components/northbeam/record-table';
import { SectionCard } from '@/components/northbeam/section-card';
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

/** Render the full artifact. Wraps each top-level node in the appropriate
 *  block; supplies a small "Unsupported" placeholder when the generator
 *  surfaces a node we don't know how to render. */
export function ArtifactView({ artifact }: { artifact: Artifact }) {
  return (
    <div className="flex flex-col gap-3">
      {artifact.components.map((node, i) => (
        <RenderNode key={i} node={node} />
      ))}
    </div>
  );
}

function RenderNode({ node }: { node: ArtifactNode }): ReactNode {
  if (node.component === 'SectionCard') {
    const props = (node.props ?? {}) as { title?: string };
    return (
      <SectionCard title={props.title}>
        <div className="flex flex-col gap-3">
          {(node.children ?? []).map((c, i) => (
            <RenderNode key={i} node={c} />
          ))}
        </div>
      </SectionCard>
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

/* ── Live-data nodes ────────────────────────────────────────────────────── */

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
