// View model types. Standalone (no drizzle imports) so both the schema layer
// (packages/db/src/schema.ts) and the web app can pull from a single source.

import type { Role } from './roles.js';

// Relative-date filter tokens ride the same web/server boundary as the view
// model — re-exported here so the web's existing '@northbeam/db/views' import
// path reaches them.
export {
  isRelativeDateToken,
  resolveRelativeDate,
  relativeDateLabel,
  RELATIVE_DATE_PRESETS,
} from './relative-date';

/** Built-in view types:
 *    - `list`: filter/sort/column variant on a table. Most saved views.
 *    - `dashboard`: composed layout (PageHeader / SectionCard / MetricGroup
 *      / DescriptionList / RecordTable / RecordGrid / Text). Hand-authorable
 *      and AI-authorable; the artifact lives in `view.config.artifact`.
 *    - `report`: aggregate over one object (group-by + measure + chart). The
 *      spec lives in `view.config` as a {@link ReportConfig}.
 *    - `detail`: a RECORD PAGE layout for one object — the same artifact
 *      shape as `dashboard` (config.artifact) rendered with a record context
 *      (RecordFields / RelatedList / StagePath nodes, '@record' filter
 *      values). Detail views never appear in the list dispatcher; the record
 *      page resolves its object's default detail view.
 *  AI generation itself is reachable only via the ⌘K palette — there is no
 *  separate `ai` view type. */
export type ViewType = 'list' | 'dashboard' | 'report' | 'detail';

/** Where a view can be shared. `shared_with` on the view row is an array of
 *  these — dynamic enough for org-wide, role-scoped, or direct-to-user shares
 *  without a schema change when teams/groups land later. */
export type ShareTarget =
  | { kind: 'org' }
  | { kind: 'role'; role: Role }
  | { kind: 'user'; userId: string };

/** A single sort instruction. Multi-key sort is just an array. */
export type ViewSort = {
  fieldKey: string;
  direction: 'asc' | 'desc';
};

/** Curated icon vocabulary for views. Keys are stored verbatim on the row;
 *  the web side maps them onto Lucide components in icons-views.ts. Adding
 *  a new icon is a one-line edit there. */
export type ViewIcon =
  | 'list'
  | 'pin'
  | 'star'
  | 'bookmark'
  | 'inbox'
  | 'folder'
  | 'briefcase'
  | 'flag'
  | 'eye'
  | 'heart'
  | 'building'
  | 'users'
  | 'dollar'
  | 'chart'
  | 'calendar'
  | 'clock';

/* ── Filter ─────────────────────────────────────────────────────────────────
   Filter shape that both the view storage layer and the web filter UI share.
   Keep this small + serializable so it fits cleanly into both a JSONB column
   and a URL search param. */
export type FilterOp =
  | 'eq'
  | 'neq'
  | 'contains'
  | 'startsWith'
  | 'endsWith'
  | 'gt'
  | 'lt'
  | 'gte'
  | 'lte'
  | 'before'
  | 'after'
  | 'isTrue'
  | 'isFalse'
  | 'isEmpty'
  | 'isSet';

export type FilterValue = string | number | boolean | null;

export type Filter = {
  fieldKey: string;
  op: FilterOp;
  value?: FilterValue;
};

/** One OR-combined group of leaf filters. One nesting level only — a group
 *  holds leaves, never other groups. */
export type FilterGroup = { any: Filter[] };

/** What query inputs accept: a list of entries AND-combined, where each
 *  entry is a leaf filter or an OR group. A plain Filter[] is a valid
 *  FilterEntry[] — every stored/legacy filter list parses unchanged. */
export type FilterEntry = Filter | FilterGroup;

export function isFilterGroup(entry: FilterEntry): entry is FilterGroup {
  return (
    typeof entry === 'object' &&
    entry !== null &&
    'any' in entry &&
    Array.isArray((entry as FilterGroup).any)
  );
}

/* ── Format rules ───────────────────────────────────────────────────────────
   Conditional formatting for an object's records, stored as
   object_def.format_rules (JSONB). Conditions are plain Filter rows (AND-ed),
   not formulas — they reuse the filter editor UI and the client-side
   rowPassesFilters matcher. Evaluated client-side at v1. */
export type FormatTone = 'red' | 'amber' | 'green' | 'blue' | 'purple' | 'gray';

export type FormatRule = {
  id: string;
  label: string;
  tone: FormatTone;
  filters: Filter[];
  active: boolean;
};

/* ── Report config ──────────────────────────────────────────────────────────
   Type-specific config for `report` views: one object, up to two group-by
   fields, a measure, and a chart type. Lives in `view.config`; the shared
   filters/sort slots on the view row still apply. Every key added after v1
   is optional so saved configs keep validating without a migration. */
export type ReportAgg =
  | 'count'
  | 'sum'
  | 'avg'
  | 'min'
  | 'max'
  | 'countDistinct'
  | 'median';

/** "Only show groups where …" — a bucket-count or measure-value threshold,
 *  executed as a HAVING clause. Ignored on ungrouped (single-total) reports. */
export type ReportHaving = {
  target: 'value' | 'count';
  op: 'gt' | 'gte' | 'lt' | 'lte';
  value: number;
};

/** Time bucket for grouping by a date/datetime field — becomes a Postgres
 *  `date_trunc` grain in the aggregate SQL. */
export type DateGrain = 'day' | 'week' | 'month' | 'quarter' | 'year';

export type ReportChartType =
  | 'bar'
  | 'line'
  | 'area'
  | 'donut'
  | 'scatter'
  | 'funnel'
  | 'kpi'
  | 'table'
  | 'matrix';

export type ReportConfig = {
  /** field key to bucket by; null = single-row totals. */
  groupBy: string | null;
  /** Only meaningful when `groupBy` is a date/datetime field. Default 'month'. */
  groupByGrain?: DateGrain;
  /** Secondary grouping — stacked/grouped bars and matrix columns. Requires `groupBy`. */
  groupBy2?: string | null;
  /** Only meaningful when `groupBy2` is a date/datetime field. Default 'month'. */
  groupBy2Grain?: DateGrain;
  /** `fieldKey` is required unless `agg` is 'count'. */
  measure: { agg: ReportAgg; fieldKey?: string };
  chartType: ReportChartType;
  /** bar/area with `groupBy2`: stack the series instead of grouping side by side. */
  stacked?: boolean;
  /** Optional bucket threshold — see {@link ReportHaving}. */
  having?: ReportHaving;
};
