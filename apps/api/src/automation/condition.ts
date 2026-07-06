// FlowCondition evaluation — entry conditions at dispatch time and decision
// outcomes in the engine. Pure except the formula engine import.
//
// Filters mode mirrors the op-table contract shared by packages/db
// dynamic/filters-sql.ts and apps/web/src/lib/filters.ts (matchesFilter):
// same empty-value guard, case-folded text ops, numeric compares for numeric
// field types, instant compares for date types, array membership for
// multipicklist `contains`, and the same "an inapplicable/unresolvable filter
// constrains nothing" posture. Pass `fields` (key+type) whenever metadata is
// in hand — without it the matcher falls back to value-shape heuristics.
//
// Failure policy mirrors ruleIssues (packages/db/src/validation.ts): a
// condition that cannot be evaluated must not break the write or the other
// flows, so it comes back `matched: false` with a warning for the caller to
// surface — the broken flow/outcome is skipped, never guessed.

import {
  type FlowCondition,
  type FlowFilter,
  type FlowFilterOp,
  type TemplateScopes,
  interpolate,
} from '@northbeam/core';
import { evaluateFormula, isRelativeDateToken, resolveRelativeDate } from '@northbeam/db';

/** key + field type — the slice of FieldRow the matcher needs. */
export type ConditionField = { key: string; type: string };

export type ConditionResult = { matched: boolean; warning?: string };

export type ConditionOptions = {
  /** The record data bag filters read from (data[filter.fieldKey]). */
  data: Record<string, unknown>;
  /** Flattened into the formula bag as '{oldRecord.<key>}' references. */
  oldData?: Record<string, unknown>;
  /** Template scopes for {{merge}} values inside filter values. */
  scopes?: TemplateScopes;
  fields?: ConditionField[];
  now?: Date;
};

/** Mirrors NUMERIC_TYPES / DATE_TYPES in packages/db dynamic/filters-sql.ts. */
const NUMERIC_TYPES: ReadonlySet<string> = new Set([
  'number',
  'currency',
  'percent',
  'autonumber',
  'duration',
]);
const DATE_TYPES: ReadonlySet<string> = new Set(['date', 'datetime']);

/** Truthiness for formula-mode conditions — mirrors toBoolean in
 *  packages/db/src/formula/helpers.ts (not exported from the barrel). */
function truthy(v: unknown): boolean {
  if (v == null) return false;
  if (typeof v === 'boolean') return v;
  if (typeof v === 'number') return v !== 0 && !Number.isNaN(v);
  if (typeof v === 'string') return v.length > 0;
  return true;
}

/** null | undefined | '' | [] — the shared empty-value contract. */
function isEmptyValue(v: unknown): boolean {
  return v === null || v === undefined || v === '' || (Array.isArray(v) && v.length === 0);
}

function asFiniteNumber(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v === 'string' && v.trim() !== '') {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

/** Value → epoch millis. Relative tokens ('@today', '@-30d') resolve through
 *  the same module the SQL builder uses; NaN when nothing parses. */
function instant(v: unknown, now?: Date): number {
  if (isRelativeDateToken(v)) return resolveRelativeDate(v, now)?.getTime() ?? Number.NaN;
  if (v instanceof Date) return v.getTime();
  return new Date(String(v ?? '')).getTime();
}

/** Heuristic for untyped values: ISO-shaped date strings / Date instances. */
function looksLikeDate(v: unknown): boolean {
  return v instanceof Date || (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}/.test(v));
}

/** Match one stored value against one filter, mirroring the web matcher's op
 *  table (`fieldType` selects the exact branch; absent = shape heuristics). */
export function matchesFlowFilter(
  fieldType: string | undefined,
  value: unknown,
  op: FlowFilterOp,
  filterValue: unknown,
  now?: Date,
): boolean {
  switch (op) {
    case 'isEmpty':
      return isEmptyValue(value);
    case 'isSet':
      return !isEmptyValue(value);
    case 'isTrue':
      return Boolean(value) === true;
    case 'isFalse':
      return Boolean(value) === false;
    default:
      break;
  }

  // multipicklist 'contains' is case-insensitive array membership, not substring.
  if (op === 'contains' && (fieldType === 'multipicklist' || Array.isArray(value))) {
    const arr = Array.isArray(value) ? value : [];
    const needle = String(filterValue ?? '').toLowerCase();
    return arr.some((e) => String(e).toLowerCase() === needle);
  }

  // Binary ops never match an empty stored value (shared contract).
  if (isEmptyValue(value)) return false;

  switch (op) {
    case 'eq':
    case 'neq': {
      // Numeric field types compare as numbers ('5000' must equal a stored
      // 5000.00); untyped values do too when both sides coerce cleanly.
      const vn = asFiniteNumber(value);
      const fn = asFiniteNumber(filterValue);
      const numeric = fieldType ? NUMERIC_TYPES.has(fieldType) : vn !== null && fn !== null;
      if (numeric) {
        if (vn === null || fn === null) return false;
        return op === 'eq' ? vn === fn : vn !== fn;
      }
      const equal = String(value).toLowerCase() === String(filterValue ?? '').toLowerCase();
      return op === 'eq' ? equal : !equal;
    }
    case 'contains':
      return String(value)
        .toLowerCase()
        .includes(String(filterValue ?? '').toLowerCase());
    case 'startsWith':
      return String(value)
        .toLowerCase()
        .startsWith(String(filterValue ?? '').toLowerCase());
    case 'endsWith':
      return String(value)
        .toLowerCase()
        .endsWith(String(filterValue ?? '').toLowerCase());
    case 'gt':
    case 'lt':
    case 'gte':
    case 'lte': {
      const dateCompare = fieldType
        ? DATE_TYPES.has(fieldType)
        : isRelativeDateToken(filterValue) || (looksLikeDate(value) && looksLikeDate(filterValue));
      if (dateCompare) {
        const bound = instant(filterValue, now);
        // Unresolvable bound = the SQL side drops the predicate: match everything.
        if (Number.isNaN(bound)) return true;
        const t = instant(value, now);
        if (Number.isNaN(t)) return false;
        if (op === 'gt') return t > bound;
        if (op === 'lt') return t < bound;
        if (op === 'gte') return t >= bound;
        return t <= bound;
      }
      const vn = asFiniteNumber(value);
      const fn = asFiniteNumber(filterValue);
      if (vn === null || fn === null) return false;
      if (op === 'gt') return vn > fn;
      if (op === 'lt') return vn < fn;
      if (op === 'gte') return vn >= fn;
      return vn <= fn;
    }
    case 'before':
    case 'after': {
      const bound = instant(filterValue, now);
      if (Number.isNaN(bound)) return true; // mirrors SQL dropping the predicate
      const t = instant(value, now);
      if (Number.isNaN(t)) return false;
      return op === 'before' ? t < bound : t > bound;
    }
    default:
      return true;
  }
}

/** Evaluate a FlowCondition. Filter values run through interpolate() first
 *  (so `{{record.stage}}`-style bounds work); unknown field keys are skipped
 *  when `fields` is provided — a filter that can't be evaluated constrains
 *  nothing, exactly like the SQL builder dropping its predicate. */
export function evaluateFlowCondition(
  condition: FlowCondition,
  opts: ConditionOptions,
): ConditionResult {
  try {
    if (condition.mode === 'formula') {
      const bag: Record<string, unknown> = { ...opts.data };
      if (opts.oldData) {
        for (const [key, value] of Object.entries(opts.oldData)) {
          bag[`oldRecord.${key}`] = value;
        }
      }
      const result = evaluateFormula(condition.formula, bag, opts.now ? { now: opts.now } : {});
      return { matched: truthy(result) };
    }

    const byKey = opts.fields ? new Map(opts.fields.map((f) => [f.key, f])) : null;
    const evaluable: FlowFilter[] = byKey
      ? condition.filters.filter((f) => byKey.has(f.fieldKey))
      : [...condition.filters];
    if (evaluable.length === 0) return { matched: true };

    const matchOne = (f: FlowFilter): boolean => {
      const bound =
        typeof f.value === 'string' && opts.scopes ? interpolate(f.value, opts.scopes) : f.value;
      return matchesFlowFilter(
        byKey?.get(f.fieldKey)?.type,
        opts.data[f.fieldKey],
        f.op,
        bound,
        opts.now,
      );
    };
    const matched =
      condition.logic === 'and' ? evaluable.every(matchOne) : evaluable.some(matchOne);
    return { matched };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { matched: false, warning: `condition failed to evaluate: ${message}` };
  }
}
