'use client';

// SavedReports — the real saved-report list on /reports (plan 4c). Rows come
// from view.list filtered to type 'report'; each shows the object chip, the
// report label (→ opens the saved view), and its measure summary ("Deals ·
// Sum of Amount by Stage"). The row menu holds Open / Edit (builder
// round-trip) / Pin to dashboard — pinning appends an artifact node built
// from the report's ReportConfig into the target dashboard's config.artifact
// via appendArtifactNode + view.update.

import { ObjChip } from '@/components/northbeam/app-bits';
import { EmptyState } from '@/components/northbeam/empty-state';
import type { ArtifactNode } from '@/components/northbeam/views/artifact-walker';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Skeleton } from '@/components/ui/skeleton';
import { type RouterOutputs, trpc } from '@/lib/api';
import { appendArtifactNode } from '@/lib/views/artifact-edit';
import type { ReportConfig } from '@northbeam/db/views';
import {
  ArrowUpRight,
  ChartBar,
  LayoutDashboard,
  MoreHorizontal,
  Pencil,
  Pin,
  Plus,
} from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';

type ViewRow = RouterOutputs['view']['list'][number];
type ObjectRow = RouterOutputs['object']['list'][number];
type FieldLite = { key: string; label: string };

/** "Deals · Sum of Amount by Stage" — object plural + measure + group-by. */
function reportSummary(view: ViewRow, object: ObjectRow | undefined, fields: FieldLite[]): string {
  const cfg = (view.config ?? {}) as Partial<ReportConfig>;
  const labelOf = (key?: string | null) => fields.find((f) => f.key === key)?.label ?? key ?? '';
  const agg = cfg.measure?.agg ?? 'count';
  const measure =
    agg === 'count'
      ? 'Count of records'
      : `${agg === 'sum' ? 'Sum' : 'Average'} of ${labelOf(cfg.measure?.fieldKey)}`;
  const by = cfg.groupBy ? ` by ${labelOf(cfg.groupBy)}` : '';
  return `${object?.labelPlural ?? 'Records'} · ${measure}${by}`;
}

/** The artifact node a pinned report becomes. Grouped reports pin as a Chart
 *  (bar/donut — the walker's chart vocabulary; table/line/kpi render as the
 *  ranked bar list on dashboards). Totals-only reports pin as a Metric stat
 *  tile, since a chart needs buckets to draw. */
function nodeFromReport(view: ViewRow, objectKey: string): ArtifactNode {
  const cfg = (view.config ?? {}) as Partial<ReportConfig> & { limit?: number };
  const agg = cfg.measure?.agg ?? 'count';
  const fieldKey = agg === 'count' ? undefined : cfg.measure?.fieldKey;
  const filters = view.filters ?? [];
  if (!cfg.groupBy) {
    return {
      component: 'Metric',
      props: { label: view.label, objectKey, fn: agg, fieldKey, filters },
    };
  }
  return {
    component: 'Chart',
    props: {
      title: view.label,
      objectKey,
      groupBy: cfg.groupBy,
      fn: agg,
      measure: fieldKey,
      chartType: cfg.chartType === 'donut' && agg !== 'avg' ? 'donut' : 'bar',
      filters,
      ...(cfg.limit ? { limit: cfg.limit } : {}),
    },
  };
}

export function SavedReports() {
  const router = useRouter();
  const utils = trpc.useUtils();
  const views = trpc.view.list.useQuery({});
  const objects = trpc.object.list.useQuery();

  const reports = (views.data ?? []).filter((v) => v.type === 'report');
  const dashboards = (views.data ?? []).filter((v) => v.type === 'dashboard');
  const objectById = new Map((objects.data ?? []).map((o) => [o.id, o]));

  // Field labels for the measure summaries — one object.get per distinct
  // object among the saved reports (a small set; each hits the query cache).
  const objectKeys = [
    ...new Set(
      reports
        .map((r) => objectById.get(r.objectId)?.key)
        .filter((k): k is string => typeof k === 'string'),
    ),
  ];
  const fieldQueries = trpc.useQueries((t) => objectKeys.map((key) => t.object.get({ key })));
  const fieldsByKey = new Map<string, FieldLite[]>(
    objectKeys.map((k, i) => [k, fieldQueries[i]?.data?.fields ?? []]),
  );

  const update = trpc.view.update.useMutation({
    meta: { context: "Couldn't pin the report" },
  });

  const pin = (report: ViewRow, dashboard: ViewRow) => {
    const objectKey = objectById.get(report.objectId)?.key;
    if (!objectKey) return;
    const config = appendArtifactNode(dashboard.config, nodeFromReport(report, objectKey));
    const dashObject = objectById.get(dashboard.objectId);
    update.mutate(
      { id: dashboard.id, config },
      {
        onSuccess: () => {
          void utils.view.list.invalidate();
          void utils.view.get.invalidate({ id: dashboard.id });
          toast.success('Pinned to dashboard', {
            description: `${report.label} → ${dashboard.label}`,
            action: dashObject
              ? {
                  label: 'Open dashboard',
                  onClick: () => router.push(`/${dashObject.key}?view=${dashboard.id}`),
                }
              : undefined,
          });
        },
      },
    );
  };

  if (views.isLoading || objects.isLoading) {
    return (
      <div className="flex flex-col gap-2">
        {[0, 1, 2].map((i) => (
          <Skeleton key={i} className="h-14 rounded-lg" />
        ))}
      </div>
    );
  }
  if (reports.length === 0) {
    return (
      <EmptyState
        icon={ChartBar}
        size="sm"
        title="No saved reports"
        body="Group and measure any object, then save it here."
        action={
          <Button size="sm" variant="outline" asChild>
            <Link href="/reports/builder">
              <Plus />
              New report
            </Link>
          </Button>
        }
      />
    );
  }
  return (
    <div className="flex flex-col gap-2">
      {reports.map((r) => {
        const object = objectById.get(r.objectId);
        return (
          <ReportRow
            key={r.id}
            report={r}
            object={object}
            fields={object ? (fieldsByKey.get(object.key) ?? []) : []}
            dashboards={dashboards}
            onPin={pin}
          />
        );
      })}
    </div>
  );
}

function ReportRow({
  report,
  object,
  fields,
  dashboards,
  onPin,
}: {
  report: ViewRow;
  object?: ObjectRow;
  fields: FieldLite[];
  dashboards: ViewRow[];
  onPin: (report: ViewRow, dashboard: ViewRow) => void;
}) {
  const href = object ? `/${object.key}?view=${report.id}` : '/reports';
  return (
    <div className="flex items-center gap-3 rounded-lg border px-3 py-2.5">
      <ObjChip label={object?.label ?? '?'} color={object?.color ?? undefined} />
      <div className="min-w-0 flex-1">
        <Link
          href={href}
          className="block truncate font-medium text-foreground text-sm hover:underline"
        >
          {report.label}
        </Link>
        <p className="truncate text-muted-foreground text-xs">
          {reportSummary(report, object, fields)}
        </p>
      </div>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon-sm" aria-label={`Actions for ${report.label}`}>
            <MoreHorizontal />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem asChild>
            <Link href={href}>
              <ArrowUpRight />
              Open
            </Link>
          </DropdownMenuItem>
          <DropdownMenuItem asChild>
            <Link href={`/reports/builder?edit=${report.id}`}>
              <Pencil />
              Edit
            </Link>
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuSub>
            <DropdownMenuSubTrigger>
              <Pin />
              Pin to dashboard…
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent>
              {dashboards.length === 0 ? (
                <DropdownMenuItem disabled>No dashboards yet</DropdownMenuItem>
              ) : (
                dashboards.map((d) => (
                  <DropdownMenuItem key={d.id} onSelect={() => onPin(report, d)}>
                    <LayoutDashboard />
                    {d.label}
                  </DropdownMenuItem>
                ))
              )}
            </DropdownMenuSubContent>
          </DropdownMenuSub>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
