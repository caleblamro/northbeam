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

/** Ops that don't need a value (so the popover hides the value editor). */
export const UNARY_OPS: ReadonlySet<FilterOp> = new Set([
  'isTrue',
  'isFalse',
  'isEmpty',
  'isSet',
]);

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
      return ['eq', 'before', 'after', 'isEmpty', 'isSet'];
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

/** Match a single field value against one filter. Returns true if the row
 *  passes. Designed to mirror Postgres semantics so v1's server predicate
 *  produces identical results. */
export function matchesFilter(
  field: FieldDefLite,
  value: unknown,
  filter: Filter,
): boolean {
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
      return String(value).toLowerCase().includes(String(fv ?? '').toLowerCase());
    case 'startsWith':
      return String(value).toLowerCase().startsWith(String(fv ?? '').toLowerCase());
    case 'endsWith':
      return String(value).toLowerCase().endsWith(String(fv ?? '').toLowerCase());
    case 'gt':
      return Number(value) > Number(fv);
    case 'lt':
      return Number(value) < Number(fv);
    case 'gte':
      return Number(value) >= Number(fv);
    case 'lte':
      return Number(value) <= Number(fv);
    case 'before':
      return new Date(String(value)).getTime() < new Date(String(fv)).getTime();
    case 'after':
      return new Date(String(value)).getTime() > new Date(String(fv)).getTime();
    default:
      return true;
  }
}

/** Apply all active filters to a single row's data. */
export function rowPassesFilters(
  fields: FieldDefLite[],
  data: Record<string, unknown>,
  filters: Filter[],
): boolean {
  if (!filters.length) return true;
  const byKey = new Map(fields.map((f) => [f.key, f]));
  for (const f of filters) {
    const field = byKey.get(f.fieldKey);
    if (!field) continue;
    if (!matchesFilter(field, data[f.fieldKey], f)) return false;
  }
  return true;
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
export function chipLabel(filter: Filter, fieldLabel: string, valueLabel?: string): string {
  const op = OP_LABEL[filter.op];
  if (UNARY_OPS.has(filter.op)) return `${fieldLabel} ${op}`;
  const v = valueLabel ?? (filter.value == null ? '' : String(filter.value));
  return `${fieldLabel} ${op} ${v}`;
}
