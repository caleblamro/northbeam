'use client';

// ReportBuilder — two-pane builder for `report` views (plan 4b). Left pane
// holds the spec controls (object, group-by + date grain, second group-by,
// measure, filters, chart type, stacked, limit); the right pane is a live
// preview rendered by the SAME ReportResult component the saved-view renderer
// uses, so preview === saved output. `editViewId` (?edit=<viewId>) loads an
// existing report for round-trip editing: save then patches the view instead
// of creating a new one.

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
import { Switch } from '@/components/ui/switch';
import { type RouterOutputs, trpc } from '@/lib/api';
import { useCan } from '@/lib/can';
import type { FieldType } from '@northbeam/db/field-types';
import type {
  DateGrain,
  Filter,
  ReportAgg,
  ReportChartType,
  ReportConfig,
  ReportHaving,
  ShareTarget,
  ViewIcon,
} from '@northbeam/db/views';
import { ChartBar, Save } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { toast } from 'sonner';

type ObjectRow = RouterOutputs['object']['list'][number];
type ViewRow = RouterOutputs['view']['get'];

// Client mirrors of the server's type gates — GROUPABLE_TYPES /
// DATE_GROUPABLE_TYPES live in packages/db/src/dynamic/aggregate.ts,
// NUMERIC_TYPES in dynamic/filters-sql.ts. record.aggregate and view.create
// re-validate, so drift fails loudly there.
const GROUPABLE = new Set<FieldType>(['picklist', 'reference', 'checkbox', 'text']);
const DATE_GROUPABLE = new Set<FieldType>(['date', 'datetime']);
const MEASURABLE = new Set<FieldType>(['number', 'currency', 'percent', 'autonumber', 'duration']);

const GRAINS: Array<{ value: DateGrain; label: string }> = [
  { value: 'day', label: 'Day' },
  { value: 'week', label: 'Week' },
  { value: 'month', label: 'Month' },
  { value: 'quarter', label: 'Quarter' },
  { value: 'year', label: 'Year' },
];

const CHART_TYPES: Array<{ value: ReportChartType; label: string }> = [
  { value: 'bar', label: 'Bar' },
  { value: 'line', label: 'Line' },
  { value: 'area', label: 'Area' },
  { value: 'donut', label: 'Donut' },
  { value: 'scatter', label: 'Scatter' },
  { value: 'funnel', label: 'Funnel' },
  { value: 'matrix', label: 'Matrix' },
  { value: 'kpi', label: 'KPI' },
  { value: 'table', label: 'Table' },
];

/** The builder's working state — a flattened, always-editable ReportConfig. */
type Spec = {
  groupBy: string | null;
  groupByGrain: DateGrain;
  groupBy2: string | null;
  groupBy2Grain: DateGrain;
  agg: ReportAgg;
  measureFieldKey: string | null;
  chartType: ReportChartType;
  stacked: boolean;
  /** Top-N buckets before the tail folds into "Other". null = renderer default. */
  limit: number | null;
  filters: Filter[];
  /** "Only show groups where …" — HAVING threshold; null = off. */
  having: ReportHaving | null;
};

const DEFAULT_SPEC: Spec = {
  groupBy: null,
  groupByGrain: 'month',
  groupBy2: null,
  groupBy2Grain: 'month',
  agg: 'count',
  measureFieldKey: null,
  chartType: 'kpi',
  stacked: false,
  limit: null,
  filters: [],
  having: null,
};

function specFromView(view: ViewRow): Spec {
  const cfg = (view.config ?? {}) as Partial<ReportConfig> & { limit?: number };
  return {
    groupBy: cfg.groupBy ?? null,
    groupByGrain: cfg.groupByGrain ?? 'month',
    groupBy2: cfg.groupBy2 ?? null,
    groupBy2Grain: cfg.groupBy2Grain ?? 'month',
    agg: cfg.measure?.agg ?? 'count',
    measureFieldKey: cfg.measure?.fieldKey ?? null,
    chartType: cfg.chartType ?? 'kpi',
    stacked: cfg.stacked ?? false,
    limit: cfg.limit ?? null,
    filters: view.filters ?? [],
    having: cfg.having ?? null,
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
  const canSave = useCan('view.write');

  const object = objects.find((o) => o.key === objectKey);
  const meta = trpc.object.get.useQuery({ key: objectKey }, { enabled: Boolean(objectKey) });
  const fields = (meta.data?.fields ?? []) as FieldDefLite[];
  // Multipicklist explodes through a LATERAL unnest server-side, so it can
  // only ever be the PRIMARY grouping.
  const groupable = fields.filter(
    (f) => GROUPABLE.has(f.type) || DATE_GROUPABLE.has(f.type) || f.type === 'multipicklist',
  );
  const groupable2 = fields.filter(
    (f) => (GROUPABLE.has(f.type) || DATE_GROUPABLE.has(f.type)) && f.key !== spec.groupBy,
  );
  const measurable = fields.filter((f) => MEASURABLE.has(f.type));
  // Distinct counts work over any scalar column; arrays compare whole-array.
  const distinctable = fields.filter((f) => f.type !== 'multipicklist');
  const isDate = (key: string | null) =>
    DATE_GROUPABLE.has(fields.find((f) => f.key === key)?.type as FieldType);

  // Enable rules mirror the renderer's coercions (AggChart.coerceChartType) —
  // a disabled button explains itself; the renderer would degrade it anyway.
  const additive = spec.agg === 'count' || spec.agg === 'sum';
  const okOf: Partial<Record<ReportChartType, boolean>> = {
    donut: Boolean(spec.groupBy) && additive,
    funnel: Boolean(spec.groupBy) && additive,
    line: Boolean(spec.groupBy),
    area: Boolean(spec.groupBy),
    scatter: Boolean(spec.groupBy) && spec.agg !== 'count',
    matrix: Boolean(spec.groupBy) && Boolean(spec.groupBy2),
  };
  const disabledReason: Partial<Record<ReportChartType, string>> = {
    donut: 'Donuts need a group-by and a count or sum measure',
    funnel: 'Funnels need a group-by and a count or sum measure',
    line: 'Lines need a group-by to draw a series',
    area: 'Areas need a group-by to draw a series',
    scatter: 'Scatter plots record count vs a numeric measure — pick sum/avg/min/max',
    matrix: 'A matrix pivots two groupings — pick a “then group by” field',
  };

  const patch = (p: Partial<Spec>) => {
    setSpec((s) => {
      const next = { ...s, ...p };
      // Invariant fixups so the spec always describes a drawable chart.
      if (!next.groupBy) {
        next.groupBy2 = null;
        next.stacked = false;
      }
      if (!next.groupBy2 && next.chartType === 'matrix') next.chartType = 'table';
      if (!next.groupBy2) next.stacked = false;
      const nextAdditive = next.agg === 'count' || next.agg === 'sum';
      if ((next.chartType === 'donut' || next.chartType === 'funnel') && !nextAdditive) {
        next.chartType = 'bar';
      }
      if (next.chartType === 'scatter' && next.agg === 'count') next.chartType = 'bar';
      if (
        !next.groupBy &&
        ['line', 'area', 'donut', 'funnel', 'scatter'].includes(next.chartType)
      ) {
        next.chartType = 'bar';
      }
      return next;
    });
  };

  const specComplete = spec.agg === 'count' || Boolean(spec.measureFieldKey);
  const config: ReportConfig & { limit?: number } = {
    groupBy: spec.groupBy,
    ...(spec.groupBy && isDate(spec.groupBy) ? { groupByGrain: spec.groupByGrain } : {}),
    ...(spec.groupBy2 ? { groupBy2: spec.groupBy2 } : {}),
    ...(spec.groupBy2 && isDate(spec.groupBy2) ? { groupBy2Grain: spec.groupBy2Grain } : {}),
    measure:
      spec.agg === 'count'
        ? { agg: 'count' }
        : { agg: spec.agg, fieldKey: spec.measureFieldKey ?? undefined },
    chartType: spec.chartType,
    ...(spec.stacked && spec.groupBy2 ? { stacked: true } : {}),
    ...(spec.limit ? { limit: spec.limit } : {}),
    ...(spec.having && spec.groupBy ? { having: spec.having } : {}),
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

  const grainSelect = (value: DateGrain, onChange: (g: DateGrain) => void, ariaLabel: string) => (
    <Select value={value} onValueChange={(v) => onChange(v as DateGrain)}>
      <SelectTrigger aria-label={ariaLabel} className="w-full">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {GRAINS.map((g) => (
          <SelectItem key={g.value} value={g.value}>
            By {g.label.toLowerCase()}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );

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
        {canSave && (
          <Button onClick={() => setSaveOpen(true)} disabled={!object || !specComplete}>
            <Save />
            {editView ? 'Save report' : 'Save report…'}
          </Button>
        )}
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
              helpText="Picklist, reference, checkbox, text, date, or multi-select fields."
            >
              <div className="flex flex-col gap-2">
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
                {spec.groupBy &&
                  isDate(spec.groupBy) &&
                  grainSelect(
                    spec.groupByGrain,
                    (g) => patch({ groupByGrain: g }),
                    'Date bucket size',
                  )}
              </div>
            </Field>

            {spec.groupBy && (
              <Field
                label="Then group by"
                htmlFor="report-group-by-2"
                helpText="A second level — stacked bars and matrix tables."
              >
                <div className="flex flex-col gap-2">
                  <Select
                    value={spec.groupBy2 ?? '__none__'}
                    onValueChange={(v) => patch({ groupBy2: v === '__none__' ? null : v })}
                  >
                    <SelectTrigger id="report-group-by-2" className="w-full">
                      <SelectValue placeholder="None" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__none__">None</SelectItem>
                      {groupable2.map((f) => (
                        <SelectItem key={f.key} value={f.key}>
                          {f.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {spec.groupBy2 &&
                    isDate(spec.groupBy2) &&
                    grainSelect(
                      spec.groupBy2Grain,
                      (g) => patch({ groupBy2Grain: g }),
                      'Second date bucket size',
                    )}
                </div>
              </Field>
            )}

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
                    <SelectItem value="median">Median of…</SelectItem>
                    <SelectItem value="min">Minimum of…</SelectItem>
                    <SelectItem value="max">Maximum of…</SelectItem>
                    <SelectItem value="countDistinct">Distinct count of…</SelectItem>
                  </SelectContent>
                </Select>
                {spec.agg !== 'count' && (
                  <Select
                    value={spec.measureFieldKey ?? ''}
                    onValueChange={(v) => patch({ measureFieldKey: v })}
                  >
                    <SelectTrigger aria-label="Measure field" className="w-full">
                      <SelectValue
                        placeholder={
                          spec.agg === 'countDistinct'
                            ? 'Choose a field…'
                            : 'Choose a numeric field…'
                        }
                      />
                    </SelectTrigger>
                    <SelectContent>
                      {(spec.agg === 'countDistinct' ? distinctable : measurable).map((f) => (
                        <SelectItem key={f.key} value={f.key}>
                          {f.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              </div>
            </Field>

            {spec.groupBy && (
              <Field label="Only show groups where">
                <div className="flex items-center gap-1.5">
                  <Select
                    value={spec.having ? spec.having.target : 'off'}
                    onValueChange={(v) =>
                      patch({
                        having:
                          v === 'off'
                            ? null
                            : {
                                target: v as ReportHaving['target'],
                                op: spec.having?.op ?? 'gte',
                                value: spec.having?.value ?? 1,
                              },
                      })
                    }
                  >
                    <SelectTrigger aria-label="Threshold target" className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="off">Off</SelectItem>
                      <SelectItem value="count">Record count</SelectItem>
                      <SelectItem value="value">The measure</SelectItem>
                    </SelectContent>
                  </Select>
                  {spec.having && (
                    <>
                      <Select
                        value={spec.having.op}
                        onValueChange={(v) =>
                          // biome-ignore lint/style/noNonNullAssertion: guarded by spec.having above
                          patch({ having: { ...spec.having!, op: v as ReportHaving['op'] } })
                        }
                      >
                        <SelectTrigger aria-label="Threshold operator" className="w-20 shrink-0">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="gt">&gt;</SelectItem>
                          <SelectItem value="gte">≥</SelectItem>
                          <SelectItem value="lt">&lt;</SelectItem>
                          <SelectItem value="lte">≤</SelectItem>
                        </SelectContent>
                      </Select>
                      <Input
                        type="number"
                        aria-label="Threshold value"
                        className="w-24 shrink-0"
                        value={spec.having.value}
                        onChange={(e) =>
                          patch({
                            having: {
                              // biome-ignore lint/style/noNonNullAssertion: guarded by spec.having above
                              ...spec.having!,
                              value: Number(e.target.value) || 0,
                            },
                          })
                        }
                      />
                    </>
                  )}
                </div>
              </Field>
            )}

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
                {CHART_TYPES.map((ct) => {
                  const ok = okOf[ct.value] ?? true;
                  return (
                    <Button
                      key={ct.value}
                      type="button"
                      size="sm"
                      variant={spec.chartType === ct.value ? 'default' : 'outline'}
                      aria-pressed={spec.chartType === ct.value}
                      disabled={!object || !ok}
                      title={!ok ? disabledReason[ct.value] : undefined}
                      onClick={() => patch({ chartType: ct.value })}
                    >
                      {ct.label}
                    </Button>
                  );
                })}
              </div>
            </Field>

            {spec.groupBy2 && (spec.chartType === 'bar' || spec.chartType === 'area') && (
              <Field label="Stacked" htmlFor="report-stacked">
                <div className="flex items-center gap-2">
                  <Switch
                    id="report-stacked"
                    checked={spec.stacked}
                    onCheckedChange={(v) => patch({ stacked: Boolean(v) })}
                  />
                  <span className="text-muted-foreground text-xs">
                    Stack the series instead of grouping side by side.
                  </span>
                </div>
              </Field>
            )}

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
              body="Sum, average, min, and max need a numeric field to aggregate."
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
