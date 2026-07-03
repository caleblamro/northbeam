// Server-side translation of the view Filter / ViewSort model into parameterized
// Postgres predicates and ORDER BY terms against a dynamic per-object table.
//
// This is the server twin of apps/web/src/lib/filters.ts (`matchesFilter` +
// `compareValues`). The web matcher was deliberately written to mirror Postgres
// semantics; this module is the other half of that contract, so a filtered list
// produces the SAME rows whether matched in the browser or pushed to SQL. When
// you change one, change the other — the parity test in
// tests/dynamic/filters-sql.test.ts guards the operator table.
//
// Identifiers go through qid() (column names are already sanitized in field_def,
// but qid is defense-in-depth); every value is bound via Drizzle's sql template.

import { type SQL, sql } from 'drizzle-orm';
import type { FieldType } from '../field-types.js';
import { isRelativeDateToken, resolveRelativeDate } from '../relative-date.js';
import { type Filter, type FilterEntry, type ViewSort, isFilterGroup } from '../views.js';
import { SYS, qid } from './identifiers.js';

/** Minimal field shape the builder needs — satisfied by FieldRow.
 *  `tableAlias` qualifies the column for joined (dot-path) fields; base
 *  fields stay unqualified. */
export type FilterField = {
  key: string;
  columnName: string;
  type: FieldType;
  tableAlias?: string;
};

const col = (name: string): SQL => sql.raw(qid(name));
const fieldCol = (f: FilterField): SQL =>
  f.tableAlias ? sql.raw(`${qid(f.tableAlias)}.${qid(f.columnName)}`) : sql.raw(qid(f.columnName));

/** Types stored in a Postgres `numeric`/`bigint` column — compared as numbers. */
export const NUMERIC_TYPES: ReadonlySet<FieldType> = new Set<FieldType>([
  'number',
  'currency',
  'percent',
  'autonumber',
  'duration',
]);

/** Types stored in a `date`/`timestamptz` column — compared as instants. */
const DATE_TYPES: ReadonlySet<FieldType> = new Set<FieldType>(['date', 'datetime']);

/** Types backed by a plain `text` column. These are the only ones where the
 *  empty string is a real, distinct-from-NULL value — so the binary-op guard
 *  ("empty value never matches a binary op", mirroring the web matcher's
 *  `if (isEmptyValue(value)) return false`) only needs `<> ''` for these. */
const TEXT_COLUMN_TYPES: ReadonlySet<FieldType> = new Set<FieldType>([
  'text',
  'textarea',
  'email',
  'phone',
  'url',
  'picklist',
  'formula',
  'rollup',
  'ai',
]);

/** Escape a user string for use inside an ILIKE pattern (backslash is the
 *  default ILIKE escape char). The escaped string is still bound as a param. */
function escapeLike(s: string): string {
  return s.replace(/[\\%_]/g, (c) => `\\${c}`);
}

/** A date filter value → bound ISO string. Accepts relative tokens
 *  ('@today', '@-30d' — resolved through the shared relative-date module so
 *  the web matcher agrees) and absolute date strings; null when neither
 *  parses, which drops the predicate (existing safe behavior). */
function dateIso(fv: unknown): string | null {
  if (isRelativeDateToken(fv)) {
    return resolveRelativeDate(fv)?.toISOString() ?? null;
  }
  const t = Date.parse(String(fv ?? ''));
  return Number.isNaN(t) ? null : new Date(t).toISOString();
}

/** `col IS empty` for this field type, matching the web `isEmptyValue`:
 *  null OR empty-string (text) OR empty-array (multipicklist). */
function emptyPredicate(field: FilterField, c: SQL): SQL {
  if (field.type === 'multipicklist') return sql`(${c} is null or cardinality(${c}) = 0)`;
  if (TEXT_COLUMN_TYPES.has(field.type)) return sql`(${c} is null or ${c} = '')`;
  // numeric / date / checkbox / reference(uuid) / address(jsonb): only NULL is empty.
  return sql`${c} is null`;
}

/** Build one SQL predicate for a single filter, or null if the operator can't
 *  be applied (unknown field handled by the caller, non-numeric value for a
 *  numeric op, etc.) — mirroring the web matcher, which skips such filters. */
function predicate(field: FilterField, f: Filter): SQL | null {
  const c = fieldCol(field);

  // Unary / state operators — these run regardless of whether the value is set.
  switch (f.op) {
    case 'isEmpty':
      return emptyPredicate(field, c);
    case 'isSet':
      return sql`not ${emptyPredicate(field, c)}`;
    case 'isTrue':
      // Boolean(value) === true  →  only a real TRUE matches (NULL is false).
      // Checkbox-only: `IS TRUE` on any other column type is a Postgres type
      // error (42804), and opsForType only offers these ops for checkbox.
      return field.type === 'checkbox' ? sql`${c} is true` : null;
    case 'isFalse':
      // Boolean(value) === false →  NULL and FALSE both match.
      return field.type === 'checkbox' ? sql`${c} is not true` : null;
  }

  // multipicklist 'contains' is array membership (case-insensitive), not substring.
  if (field.type === 'multipicklist' && f.op === 'contains') {
    const needle = String(f.value ?? '');
    return sql`exists (select 1 from unnest(${c}) as e where lower(e) = lower(${needle}))`;
  }

  // Every binary op below requires a non-empty column value (the web matcher
  // bails with `if (isEmptyValue(value)) return false` before these). For text
  // columns the empty string counts as empty, so guard it; other column types
  // can't hold '' and their comparisons already exclude NULL.
  const guard = TEXT_COLUMN_TYPES.has(field.type)
    ? sql`${c} is not null and ${c} <> '' and `
    : sql``;
  const wrap = (body: SQL): SQL => sql`(${guard}${body})`;

  const fv = f.value;
  switch (f.op) {
    case 'eq':
    case 'neq': {
      // Numeric columns compare as numbers, not rendered text: numeric(18,2)
      // stringifies as '5000.00' while the user types '5000', and the web
      // matcher compares Number-normalized values (fromDb coerces to JS
      // number). Text equality would silently miss every scaled value.
      if (NUMERIC_TYPES.has(field.type)) {
        const n = Number(fv);
        if (!Number.isFinite(n)) return null;
        return f.op === 'eq' ? sql`${c}::numeric = ${n}` : sql`${c}::numeric <> ${n}`;
      }
      return f.op === 'eq'
        ? wrap(sql`lower(${c}::text) = lower(${String(fv ?? '')})`)
        : wrap(sql`lower(${c}::text) <> lower(${String(fv ?? '')})`);
    }
    case 'contains':
      return wrap(sql`${c}::text ilike ${`%${escapeLike(String(fv ?? ''))}%`}`);
    case 'startsWith':
      return wrap(sql`${c}::text ilike ${`${escapeLike(String(fv ?? ''))}%`}`);
    case 'endsWith':
      return wrap(sql`${c}::text ilike ${`%${escapeLike(String(fv ?? ''))}`}`);
    case 'gt':
    case 'lt':
    case 'gte':
    case 'lte': {
      const opSql =
        f.op === 'gt' ? sql`>` : f.op === 'lt' ? sql`<` : f.op === 'gte' ? sql`>=` : sql`<=`;
      // Date columns compare as instants — this is what makes inclusive
      // relative windows work ("last 30 days" = gte '@-30d').
      if (DATE_TYPES.has(field.type)) {
        const iso = dateIso(fv);
        if (iso === null) return null;
        return sql`${c}::timestamptz ${opSql} ${iso}::timestamptz`;
      }
      // Numeric otherwise (mirrors opsForType): `::numeric` on a text column
      // would be a per-row cast error, reachable via crafted URLs or stale
      // saved views after a field type change.
      if (!NUMERIC_TYPES.has(field.type)) return null;
      const n = Number(fv);
      if (!Number.isFinite(n)) return null;
      return sql`${c}::numeric ${opSql} ${n}`;
    }
    case 'before':
    case 'after': {
      // Date columns only, and the value must resolve to an instant — the
      // FilterDialog lets an empty value through (`{ op: 'before', value:
      // null }`), and `'null'::timestamptz` is a query-killing cast error.
      // Relative tokens ('@-30d') resolve through the shared module; the
      // instant is bound as ISO so Postgres sees exactly what the web
      // matcher's `new Date(...)` resolved.
      if (!DATE_TYPES.has(field.type)) return null;
      const iso = dateIso(fv);
      if (iso === null) return null;
      return f.op === 'before'
        ? sql`${c}::timestamptz < ${iso}::timestamptz`
        : sql`${c}::timestamptz > ${iso}::timestamptz`;
    }
    default:
      return null;
  }
}

/** Translate FilterEntry[] into AND-combined SQL predicates. Leaf entries with
 *  unknown field keys or inapplicable operators are dropped (the web matcher
 *  `continue`s on them); `{ any: [...] }` groups OR-combine their surviving
 *  leaves and drop entirely when NO leaf survives — a group you can't
 *  evaluate must not constrain the query (parity: the web matcher passes such
 *  groups). Returns [] when nothing applies. */
export function buildFilterPredicates(fields: FilterField[], filters: FilterEntry[]): SQL[] {
  if (!filters.length) return [];
  const byKey = new Map(fields.map((f) => [f.key, f]));
  const leaf = (f: FilterEntry): SQL | null => {
    if (isFilterGroup(f)) return null;
    const field = byKey.get(f.fieldKey);
    if (!field) return null;
    return predicate(field, f);
  };
  const out: SQL[] = [];
  for (const entry of filters) {
    if (isFilterGroup(entry)) {
      const parts = entry.any.map((f) => leaf(f)).filter((p): p is SQL => p !== null);
      if (parts.length === 1 && parts[0]) out.push(parts[0]);
      else if (parts.length > 1) out.push(sql`(${sql.join(parts, sql` or `)})`);
      continue;
    }
    const p = leaf(entry);
    if (p) out.push(p);
  }
  return out;
}

/** Translate a ViewSort[] into an ORDER BY clause. NULLS LAST on every term
 *  (the web `compareValues` always sinks empties), text compared case-folded
 *  with empty-string treated as NULL, numerics/dates compared natively. A
 *  `created_at desc` tiebreaker is always appended so the order is total and
 *  stable (matching the server's previous default + the web sort's stability). */
export function buildOrderBy(fields: FilterField[], sort: ViewSort[]): SQL {
  const byKey = new Map(fields.map((f) => [f.key, f]));
  const terms: SQL[] = [];
  for (const s of sort) {
    const field = byKey.get(s.fieldKey);
    if (!field) continue;
    const c = col(field.columnName);
    const dir = s.direction === 'desc' ? sql`desc` : sql`asc`;
    let expr: SQL;
    if (NUMERIC_TYPES.has(field.type) || DATE_TYPES.has(field.type) || field.type === 'checkbox') {
      expr = c;
    } else {
      // text / picklist / reference / multipicklist / address — fold case and
      // treat '' as NULL so empties sink regardless of direction.
      expr = sql`nullif(lower(${c}::text), '')`;
    }
    terms.push(sql`${expr} ${dir} nulls last`);
  }
  terms.push(sql`${col(SYS.createdAt)} desc`);
  return sql`order by ${sql.join(terms, sql`, `)}`;
}
