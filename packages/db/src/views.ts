// View model types. Standalone (no drizzle imports) so both the schema layer
// (packages/db/src/schema.ts) and the web app can pull from a single source.

import type { Role } from './roles.js';

/** Built-in view types:
 *    - `list`: filter/sort/column variant on a table. Most saved views.
 *    - `dashboard`: composed layout (PageHeader / SectionCard / MetricGroup
 *      / DescriptionList / RecordTable / RecordGrid / Text). Hand-authorable
 *      and AI-authorable; the artifact lives in `view.config.artifact`.
 *    - `report`: aggregate over one object (group-by + measure + chart). The
 *      spec lives in `view.config` as a {@link ReportConfig}.
 *  AI generation itself is reachable only via the ⌘K palette — there is no
 *  separate `ai` view type. */
export type ViewType = 'list' | 'dashboard' | 'report';

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
   Type-specific config for `report` views: one object, an optional group-by
   field, a measure, and a chart type. Lives in `view.config`; the shared
   filters/sort slots on the view row still apply. */
export type ReportAgg = 'count' | 'sum' | 'avg';

export type ReportConfig = {
  /** field key to bucket by; null = single-row totals. */
  groupBy: string | null;
  /** `fieldKey` is required unless `agg` is 'count'. */
  measure: { agg: ReportAgg; fieldKey?: string };
  chartType: 'bar' | 'donut' | 'line' | 'kpi' | 'table';
};
