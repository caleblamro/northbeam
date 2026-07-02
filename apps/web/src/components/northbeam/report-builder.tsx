'use client';

// ReportBuilder — two-pane builder for `report` views (plan 4b). Left pane
// holds the spec controls (object, group-by, measure, filters, chart type,
// limit); the right pane is a live preview rendered by the SAME ReportResult
// component the saved-view renderer uses, so preview === saved output.
// `editViewId` (?edit=<viewId>) loads an existing report for round-trip
// editing: save then patches the view instead of creating a new one.

import { AiAffordance } from '@/components/northbeam/ai-affordance';
import { useAiComposer } from '@/components/northbeam/ai-composer';
import { PageActions } from '@/components/northbeam/app-shell';
import { EmptyState } from '@/components/northbeam/empty-state';
import { Field } from '@/components/northbeam/field';
import type { FieldDefLite } from '@/components/northbeam/field-render';
import { FilterDialog } from '@/components/northbeam/filter-bar';
import { SaveViewDialog } from '@/components/northbeam/save-view-dialog';
import { SectionCard } from '@/components/northbeam/section-card';
import { ReportResult } from '@/components/northbeam/views/report-renderer';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { type RouterOutputs, trpc } from '@/lib/api';
import type { FieldType } from '@northbeam/db/field-types';
import type { Filter, ReportAgg, ReportConfig, ShareTarget, ViewIcon } from '@northbeam/db/views';
import { ChartBar, Save } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { toast } from 'sonner';

type ObjectRow = RouterOutputs['object']['list'][number];
type ViewRow = RouterOutputs['view']['get'];

// Client mirrors of the server's type gates — GROUPABLE_TYPES lives in
// packages/db/src/dynamic/aggregate.ts, NUMERIC_TYPES in dynamic/filters-sql.ts.
// record.aggregate and view.create re-validate, so drift fails loudly there.
const GROUPABLE = new Set<FieldType>(['picklist', 'reference', 'checkbox', 'text']);
const MEASURABLE = new Set<FieldType>(['number', 'currency', 'percent', 'autonumber', 'duration']);

const CHART_TYPES = [
  { value: 'bar', label: 'Bar' },
  { value: 'line', label: 'Line' },
  { value: 'donut', label: 'Donut' },
  { value: 'kpi', label: 'KPI' },
  { value: 'table', label: 'Table' },
] as const;
type BuilderChartType = (typeof CHART_TYPES)[number]['value'];

/** The builder's working state — a flattened, always-editable ReportConfig. */
type Spec = {
  groupBy: string | null;
  agg: ReportAgg;
  measureFieldKey: string | null;
  chartType: BuilderChartType;
  /** Top-N buckets before the tail folds into "Other". null = renderer default. */
  limit: number | null;
  filters: Filter[];
};

const DEFAULT_SPEC: Spec = {
  groupBy: null,
  agg: 'count',
  measureFieldKey: null,
  chartType: 'kpi',
  limit: null,
  filters: [],
};

function specFromView(view: ViewRow): Spec {
  const cfg = (view.config ?? {}) as Partial<ReportConfig> & { limit?: number };
  return {
    groupBy: cfg.groupBy ?? null,
    agg: cfg.measure?.agg ?? 'count',
    measureFieldKey: cfg.measure?.fieldKey ?? null,
    chartType: cfg.chartType ?? 'kpi',
    limit: cfg.limit ?? null,
    filters: view.filters ?? [],
  };
}

export function ReportBuilder({ editViewId }: { editViewId?: string }) {
  const objects = trpc.object.list.useQuery();
  const editQ = trpc.view.get.useQuery(
    { id: editViewId ?? '' },
    { enabled: Boolean(editViewId), retry: false, meta: { silent: true } },
  );

  if (objects.isLoading || (editViewId && editQ.isLoading)) {
    return (
      <div className="grid items-start gap-4 lg:grid-cols-[minmax(260px,320px)_minmax(0,1fr)]">
        <Skeleton className="h-72 rounded-lg" />
        <Skeleton className="h-72 rounded-lg" />
      </div>
    );
  }
  if (editViewId && (editQ.isError || (editQ.data && editQ.data.type !== 'report'))) {
    return (
      <EmptyState
        icon={ChartBar}
        title="Report not found"
        body="That view doesn't exist or isn't a report."
      />
    );
  }

  const editView = editViewId ? editQ.data : undefined;
  const rows = objects.data ?? [];
  const initialObjectKey = editView
    ? (rows.find((o) => o.id === editView.objectId)?.key ?? '')
    : '';
  // Keyed remount so switching between ?edit targets re-seeds the state.
  return (
    <BuilderInner
      key={editView?.id ?? 'new'}
      objects={rows}
      editView={editView}
      initialObjectKey={initialObjectKey}
    />
  );
}

function BuilderInner({
  objects,
  editView,
  initialObjectKey,
}: {
  objects: ObjectRow[];
  editView?: ViewRow;
  initialObjectKey: string;
}) {
  const router = useRouter();
  const utils = trpc.useUtils();
  const [objectKey, setObjectKey] = useState(initialObjectKey);
  const [spec, setSpec] = useState<Spec>(editView ? specFromView(editView) : DEFAULT_SPEC);
  const [saveOpen, setSaveOpen] = useState(false);
  const composer = useAiComposer();

  const object = objects.find((o) => o.key === objectKey);
  const meta = trpc.object.get.useQuery({ key: objectKey }, { enabled: Boolean(objectKey) });
  const fields = (meta.data?.fields ?? []) as FieldDefLite[];
  const groupable = fields.filter((f) => GROUPABLE.has(f.type));
  const measurable = fields.filter((f) => MEASURABLE.has(f.type));

  // A donut states part-to-whole: it needs buckets (groupBy) and an additive
  // measure (count/sum) — averages aren't parts of a whole. A line draws an
  // ordered series across buckets, so it also needs a groupBy (a totals-only
  // report would be a single point).
  const donutOk = Boolean(spec.groupBy) && spec.agg !== 'avg';
  const lineOk = Boolean(spec.groupBy);
  const patch = (p: Partial<Spec>) => {
    setSpec((s) => {
      const next = { ...s, ...p };
      const nextDonutOk = Boolean(next.groupBy) && next.agg !== 'avg';
      if (next.chartType === 'donut' && !nextDonutOk) next.chartType = 'bar';
      if (next.chartType === 'line' && !next.groupBy) next.chartType = 'bar';
      return next;
    });
  };

  const specComplete = spec.agg === 'count' || Boolean(spec.measureFieldKey);
  const config: ReportConfig & { limit?: number } = {
    groupBy: spec.groupBy,
    measure:
      spec.agg === 'count'
        ? { agg: 'count' }
        : { agg: spec.agg, fieldKey: spec.measureFieldKey ?? undefined },
    chartType: spec.chartType,
    ...(spec.limit ? { limit: spec.limit } : {}),
  };

  const createView = trpc.view.create.useMutation({
    meta: { context: "Couldn't save the report" },
  });
  const updateView = trpc.view.update.useMutation({
    meta: { context: "Couldn't save the report" },
  });

  const onSave = async ({
    label,
    sharedWith,
    icon,
  }: { label: string; sharedWith: ShareTarget[]; icon: ViewIcon }) => {
    if (!object) return;
    // Editing keeps the view's existing sharing — the dialog's visibility
    // picker only applies to newly created reports.
    const saved = editView
      ? await updateView.mutateAsync({
          id: editView.id,
          label,
          icon,
          config,
          filters: spec.filters,
        })
      : await createView.mutateAsync({
          objectId: object.id,
          key: `${slugify(label)}-${Date.now().toString(36)}`,
          label,
          type: 'report',
          icon,
          config,
          filters: spec.filters,
          sharedWith,
        });
    await utils.view.list.invalidate();
    if (editView) await utils.view.get.invalidate({ id: editView.id });
    setSaveOpen(false);
    const id = saved?.id ?? editView?.id;
    if (id) {
      const href = `/${objectKey}?view=${id}`;
      toast.success(editView ? 'Report updated' : 'Report saved', {
        description: label,
        action: { label: 'Open report', onClick: () => router.push(href) },
      });
      // New report → drop into edit mode so the next save updates in place.
      if (!editView) router.replace(`/reports/builder?edit=${id}`);
    }
  };

  return (
    <>
      <PageActions>
        {/* Builder-toolbar AI door (brief placement #3) — always visible,
            same generate flow as the ⌘K palette's "AI" group. */}
        <AiAffordance
          size="xs"
          label="Compose from prompt"
          onClick={() => composer.open({ objectKey })}
        />
        <Button onClick={() => setSaveOpen(true)} disabled={!object || !specComplete}>
          <Save />
          {editView ? 'Save report' : 'Save report…'}
        </Button>
      </PageActions>

      <div className="grid items-start gap-4 lg:grid-cols-[minmax(260px,320px)_minmax(0,1fr)]">
        <SectionCard title="Report settings">
          <div className="flex flex-col gap-4">
            <Field label="Object" htmlFor="report-object">
              <Select
                value={objectKey}
                onValueChange={(k) => {
                  setObjectKey(k);
                  // Field keys don't carry across objects — reset the spec.
                  setSpec(DEFAULT_SPEC);
                }}
              >
                <SelectTrigger id="report-object" className="w-full">
                  <SelectValue placeholder="Choose an object…" />
                </SelectTrigger>
                <SelectContent>
                  {objects.map((o) => (
                    <SelectItem key={o.key} value={o.key}>
                      {o.labelPlural}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>

            <Field
              label="Group by"
              htmlFor="report-group-by"
              helpText="Picklist, reference, checkbox, or text fields."
            >
              <Select
                value={spec.groupBy ?? '__none__'}
                onValueChange={(v) => patch({ groupBy: v === '__none__' ? null : v })}
                disabled={!object}
              >
                <SelectTrigger id="report-group-by" className="w-full">
                  <SelectValue placeholder="None (totals)" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">None (totals)</SelectItem>
                  {groupable.map((f) => (
                    <SelectItem key={f.key} value={f.key}>
                      {f.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>

            <Field label="Measure" htmlFor="report-agg">
              <div className="flex flex-col gap-2">
                <Select
                  value={spec.agg}
                  onValueChange={(v) => patch({ agg: v as ReportAgg })}
                  disabled={!object}
                >
                  <SelectTrigger id="report-agg" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="count">Count of records</SelectItem>
                    <SelectItem value="sum">Sum of…</SelectItem>
                    <SelectItem value="avg">Average of…</SelectItem>
                  </SelectContent>
                </Select>
                {spec.agg !== 'count' && (
                  <Select
                    value={spec.measureFieldKey ?? ''}
                    onValueChange={(v) => patch({ measureFieldKey: v })}
                  >
                    <SelectTrigger aria-label="Measure field" className="w-full">
                      <SelectValue placeholder="Choose a numeric field…" />
                    </SelectTrigger>
                    <SelectContent>
                      {measurable.map((f) => (
                        <SelectItem key={f.key} value={f.key}>
                          {f.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              </div>
            </Field>

            <Field label="Filters">
              <div className="flex items-center gap-2">
                <FilterDialog
                  fields={fields}
                  filters={spec.filters}
                  onChange={(filters) => patch({ filters })}
                  loadReferenceOptions={(targetObject, query) =>
                    utils.record.searchRefs.fetch({ objectKey: targetObject, q: query })
                  }
                />
                <span className="text-muted-foreground text-xs">
                  {spec.filters.length === 0
                    ? 'All records'
                    : `${spec.filters.length} condition${spec.filters.length === 1 ? '' : 's'}`}
                </span>
              </div>
            </Field>

            <Field label="Chart type">
              <div className="grid grid-cols-3 gap-1.5">
                {CHART_TYPES.map((ct) => (
                  <Button
                    key={ct.value}
                    type="button"
                    size="sm"
                    variant={spec.chartType === ct.value ? 'default' : 'outline'}
                    aria-pressed={spec.chartType === ct.value}
                    disabled={
                      !object ||
                      (ct.value === 'donut' && !donutOk) ||
                      (ct.value === 'line' && !lineOk)
                    }
                    title={
                      ct.value === 'donut' && !donutOk
                        ? 'Donuts need a group-by and a count or sum measure'
                        : ct.value === 'line' && !lineOk
                          ? 'Lines need a group-by to draw a series'
                          : undefined
                    }
                    onClick={() => patch({ chartType: ct.value })}
                  >
                    {ct.label}
                  </Button>
                ))}
              </div>
            </Field>

            <Field
              label="Limit"
              htmlFor="report-limit"
              helpText="Top groups to chart — the rest fold into “Other”."
            >
              <Input
                id="report-limit"
                type="number"
                min={1}
                max={12}
                placeholder="12"
                disabled={!object}
                value={spec.limit ?? ''}
                onChange={(e) =>
                  patch({ limit: e.target.value === '' ? null : Number(e.target.value) })
                }
              />
            </Field>
          </div>
        </SectionCard>

        {!object ? (
          <SectionCard title="Preview">
            <EmptyState
              icon={ChartBar}
              title="Pick an object to start"
              body="Choose what this report aggregates, then group and measure it."
            />
          </SectionCard>
        ) : !specComplete ? (
          <SectionCard title="Preview">
            <EmptyState
              icon={ChartBar}
              title="Pick a measure field"
              body="Sum and average need a numeric field to aggregate."
              size="sm"
            />
          </SectionCard>
        ) : meta.isLoading ? (
          <Skeleton className="h-72 rounded-lg" />
        ) : (
          <ReportResult
            objectKey={objectKey}
            objectLabel={object.label}
            fields={fields}
            config={config}
            filters={spec.filters}
            title="Preview"
            totalTile
          />
        )}
      </div>

      <SaveViewDialog
        open={saveOpen}
        onOpenChange={setSaveOpen}
        defaultLabel={editView?.label}
        defaultIcon={(editView?.icon as ViewIcon | undefined) ?? 'chart'}
        isSaving={createView.isPending || updateView.isPending}
        onSave={onSave}
      />
    </>
  );
}

function slugify(label: string): string {
  return (
    label
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 48) || 'report'
  );
}
