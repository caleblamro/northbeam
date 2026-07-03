// Filter model for record list views (#30). One Filter is `{ fieldKey, op,
// value }`. The same shape powers the FilterBar UI, the URL state in
// RecordListView, and (eventually) the `record.list` tRPC `filters` input
// once the dynamic-records layer grows server-side predicate support.
//
// Right now matching runs client-side over the rows that `record.list`
// returns — fine for the 100-row default page, a regression at scale. The
// matcher (`matchesFilter`) was deliberately written to mirror Postgres
// semantics so the migration to a server-side predicate is a transposition,
// not a redesign.

import type { FieldDefLite } from '@/components/northbeam/field-render';
// Filter / FilterOp / FilterValue types live in `@northbeam/db/views` so the
// schema column and the UI share one source of truth. Helpers (UNARY_OPS,
// matchesFilter, URL serializers) stay on this file because they're
// browser-only.
export type { Filter, FilterEntry, FilterGroup, FilterOp, FilterValue } from '@northbeam/db/views';
import {
  type Filter,
  type FilterEntry,
  type FilterOp,
  isFilterGroup,
  isRelativeDateToken,
  relativeDateLabel,
  resolveRelativeDate,
} from '@northbeam/db/views';
export { RELATIVE_DATE_PRESETS, isFilterGroup, isRelativeDateToken } from '@northbeam/db/views';

/** Ops that don't need a value (so the popover hides the value editor). */
export const UNARY_OPS: ReadonlySet<FilterOp> = new Set(['isTrue', 'isFalse', 'isEmpty', 'isSet']);

export const OP_LABEL: Record<FilterOp, string> = {
  eq: 'is',
  neq: 'is not',
  contains: 'contains',
  startsWith: 'starts with',
  endsWith: 'ends with',
  gt: '>',
  lt: '<',
  gte: '≥',
  lte: '≤',
  before: 'before',
  after: 'after',
  isTrue: 'is true',
  isFalse: 'is false',
  isEmpty: 'is empty',
  isSet: 'is set',
};

/** Which operators a field type supports, in display order. */
export function opsForType(type: string): FilterOp[] {
  switch (type) {
    case 'text':
    case 'textarea':
    case 'email':
    case 'url':
    case 'phone':
      return ['contains', 'eq', 'neq', 'startsWith', 'endsWith', 'isEmpty', 'isSet'];
    case 'number':
    case 'currency':
    case 'percent':
    case 'autonumber':
      return ['eq', 'neq', 'gt', 'lt', 'gte', 'lte', 'isEmpty', 'isSet'];
    case 'date':
    case 'datetime':
      // gte/lte make inclusive relative windows expressible ("last 30 days"
      // = gte '@-30d') — the SQL side compares dates for these ops too.
      return ['eq', 'before', 'after', 'gte', 'lte', 'isEmpty', 'isSet'];
    case 'checkbox':
      return ['isTrue', 'isFalse'];
    case 'picklist':
      return ['eq', 'neq', 'isEmpty', 'isSet'];
    case 'multipicklist':
      return ['contains', 'isEmpty', 'isSet'];
    case 'reference':
      return ['eq', 'neq', 'isEmpty', 'isSet'];
    case 'formula':
    case 'rollup':
    case 'ai':
      return ['contains', 'eq', 'isEmpty', 'isSet'];
    default:
      return ['eq', 'isEmpty', 'isSet'];
  }
}

/** Cheap "is this field worth filtering on?" check — used to dim system /
 *  computed fields in the picker. */
export function isFilterable(field: FieldDefLite): boolean {
  return field.type !== 'autonumber';
}

function isEmptyValue(v: unknown): boolean {
  if (v === null || v === undefined) return true;
  if (typeof v === 'string' && v === '') return true;
  if (Array.isArray(v) && v.length === 0) return true;
  return false;
}

/** A date filter value → epoch millis. Resolves relative tokens through the
 *  SAME module the SQL builder uses (parity contract) and absolute strings
 *  via Date.parse; NaN when neither parses — comparisons then fail, matching
 *  the SQL side dropping the predicate… almost: SQL dropping a predicate
 *  passes every row, so callers must skip (not fail) filters with NaN
 *  instants. matchesFilter handles that below. */
function dateFilterInstant(fv: unknown): number {
  if (isRelativeDateToken(fv)) {
    return resolveRelativeDate(fv)?.getTime() ?? Number.NaN;
  }
  return new Date(String(fv ?? '')).getTime();
}

/** Match a single field value against one filter. Returns true if the row
 *  passes. Designed to mirror Postgres semantics so v1's server predicate
 *  produces identical results. */
export function matchesFilter(field: FieldDefLite, value: unknown, filter: Filter): boolean {
  switch (filter.op) {
    case 'isEmpty':
      return isEmptyValue(value);
    case 'isSet':
      return !isEmptyValue(value);
    case 'isTrue':
      return Boolean(value) === true;
    case 'isFalse':
      return Boolean(value) === false;
  }

  // multipicklist 'contains' is array-membership, not substring.
  if (field.type === 'multipicklist' && filter.op === 'contains') {
    const arr = Array.isArray(value) ? (value as string[]) : [];
    return arr.map((s) => s.toLowerCase()).includes(String(filter.value ?? '').toLowerCase());
  }

  if (isEmptyValue(value)) return false;

  const fv = filter.value;
  switch (filter.op) {
    case 'eq':
      return String(value).toLowerCase() === String(fv ?? '').toLowerCase();
    case 'neq':
      return String(value).toLowerCase() !== String(fv ?? '').toLowerCase();
    case 'contains':
      return String(value)
        .toLowerCase()
        .includes(String(fv ?? '').toLowerCase());
    case 'startsWith':
      return String(value)
        .toLowerCase()
        .startsWith(String(fv ?? '').toLowerCase());
    case 'endsWith':
      return String(value)
        .toLowerCase()
        .endsWith(String(fv ?? '').toLowerCase());
    case 'gt':
    case 'lt':
    case 'gte':
    case 'lte': {
      // Date fields compare as instants (relative tokens resolve through the
      // shared module); everything else numerically. An unresolvable filter
      // value makes the filter a NO-OP (true) — the SQL side drops the
      // predicate in that case, and a dropped predicate passes every row.
      if (field.type === 'date' || field.type === 'datetime') {
        const bound = dateFilterInstant(fv);
        if (Number.isNaN(bound)) return true;
        const t = new Date(String(value)).getTime();
        if (Number.isNaN(t)) return false;
        if (filter.op === 'gt') return t > bound;
        if (filter.op === 'lt') return t < bound;
        if (filter.op === 'gte') return t >= bound;
        return t <= bound;
      }
      if (filter.op === 'gt') return Number(value) > Number(fv);
      if (filter.op === 'lt') return Number(value) < Number(fv);
      if (filter.op === 'gte') return Number(value) >= Number(fv);
      return Number(value) <= Number(fv);
    }
    case 'before':
    case 'after': {
      const bound = dateFilterInstant(fv);
      if (Number.isNaN(bound)) return true; // mirrors SQL dropping the predicate
      const t = new Date(String(value)).getTime();
      if (Number.isNaN(t)) return false;
      return filter.op === 'before' ? t < bound : t > bound;
    }
    default:
      return true;
  }
}

/** Apply all active filter entries to a single row's data. Leaves AND; an
 *  `{ any: [...] }` group passes when ANY known-field leaf matches — and when
 *  a group has NO known-field leaf it PASSES, mirroring the SQL builder
 *  dropping the whole group (a dropped predicate constrains nothing). This
 *  clause is the parity contract with buildFilterPredicates. */
export function rowPassesFilters(
  fields: FieldDefLite[],
  data: Record<string, unknown>,
  filters: FilterEntry[],
): boolean {
  if (!filters.length) return true;
  const byKey = new Map(fields.map((f) => [f.key, f]));
  for (const entry of filters) {
    if (isFilterGroup(entry)) {
      const evaluable = entry.any.filter((f) => byKey.has(f.fieldKey));
      if (evaluable.length === 0) continue; // ↔ SQL drops the group
      const hit = evaluable.some((f) => {
        const field = byKey.get(f.fieldKey);
        return field ? matchesFilter(field, data[f.fieldKey], f) : false;
      });
      if (!hit) return false;
      continue;
    }
    const field = byKey.get(entry.fieldKey);
    if (!field) continue;
    if (!matchesFilter(field, data[entry.fieldKey], entry)) return false;
  }
  return true;
}

/** Chip label for an OR group: "Stage is Won, or Amount ≥ 5000". */
export function groupChipLabel(
  group: { any: Filter[] },
  fieldLabelOf: (fieldKey: string) => string,
): string {
  return group.any.map((f) => chipLabel(f, fieldLabelOf(f.fieldKey))).join(', or ');
}

/* ── URL serialization ───────────────────────────────────────────────────── */

/** Reads filters from a URLSearchParams instance. Tolerates absent / malformed
 *  values — empty array is the safe default. */
export function readFiltersFromParams(params: URLSearchParams): Filter[] {
  const raw = params.get('filters');
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (f): f is Filter =>
        typeof f === 'object' &&
        f !== null &&
        typeof f.fieldKey === 'string' &&
        typeof f.op === 'string',
    );
  } catch {
    return [];
  }
}

/** Write filters to URLSearchParams. Removes the key when empty so URLs stay
 *  tidy and shareable. */
export function writeFiltersToParams(params: URLSearchParams, filters: Filter[]): void {
  if (filters.length === 0) params.delete('filters');
  else params.set('filters', JSON.stringify(filters));
}

/** Build a short human label for a chip: "Amount > 5000", "Type is empty",
 *  "Email contains acme". `valueLabel` lets the caller pretty-print typed
 *  values (e.g., picklist label, currency format) without this lib needing to
 *  know how. */
/** Sort an array of records by the given sort instructions, in order.
 *  Numeric-typed fields compare as numbers; date/datetime as Date; everything
 *  else as locale-sensitive strings. Multi-sort: earlier sort entries take
 *  precedence; later entries break ties. */
export function sortRows<T extends { data: Record<string, unknown> }>(
  fields: FieldDefLite[],
  rows: T[],
  sort: Array<{ fieldKey: string; direction: 'asc' | 'desc' }>,
): T[] {
  if (!sort.length) return rows;
  const byKey = new Map(fields.map((f) => [f.key, f]));
  const out = [...rows];
  out.sort((a, b) => {
    for (const s of sort) {
      const field = byKey.get(s.fieldKey);
      if (!field) continue;
      const av = a.data[s.fieldKey];
      const bv = b.data[s.fieldKey];
      const cmp = compareValues(field.type, av, bv);
      if (cmp !== 0) return s.direction === 'asc' ? cmp : -cmp;
    }
    return 0;
  });
  return out;
}

function compareValues(type: string, a: unknown, b: unknown): number {
  // Nulls always sort to the end regardless of direction (Postgres
  // NULLS LAST default). Direction inversion is applied by the caller.
  const aEmpty = a == null || a === '';
  const bEmpty = b == null || b === '';
  if (aEmpty && bEmpty) return 0;
  if (aEmpty) return 1;
  if (bEmpty) return -1;
  switch (type) {
    case 'number':
    case 'currency':
    case 'percent':
    case 'autonumber':
    case 'duration': {
      const an = Number(a);
      const bn = Number(b);
      if (!Number.isFinite(an) && !Number.isFinite(bn)) return 0;
      if (!Number.isFinite(an)) return 1;
      if (!Number.isFinite(bn)) return -1;
      return an - bn;
    }
    case 'date':
    case 'datetime': {
      const at = new Date(String(a)).getTime();
      const bt = new Date(String(b)).getTime();
      if (Number.isNaN(at) && Number.isNaN(bt)) return 0;
      if (Number.isNaN(at)) return 1;
      if (Number.isNaN(bt)) return -1;
      return at - bt;
    }
    case 'checkbox':
      return Number(Boolean(a)) - Number(Boolean(b));
    default:
      return String(a).localeCompare(String(b));
  }
}

export function chipLabel(filter: Filter, fieldLabel: string, valueLabel?: string): string {
  const op = OP_LABEL[filter.op];
  if (UNARY_OPS.has(filter.op)) return `${fieldLabel} ${op}`;
  const v =
    valueLabel ??
    relativeDateLabel(filter.value) ??
    (filter.value == null ? '' : String(filter.value));
  return `${fieldLabel} ${op} ${v}`;
}
