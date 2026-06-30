// Shared coercion + comparison helpers for the formula engine. Pure, no I/O.
// Used by both the evaluator (binary ops) and the function library so the two
// agree on null / number / date semantics.
//
// Null semantics mirror SQL: a null operand in arithmetic/comparison generally
// short-circuits to null. String contexts treat null as the empty string.

/** Coerce to a finite number, or null. Unlike Number(), an empty/blank/garbage
 *  value yields null rather than 0 or NaN. */
export function toNumber(v: unknown): number | null {
  if (v == null) return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v === 'boolean') return v ? 1 : 0;
  const n = Number(String(v).trim());
  return Number.isFinite(n) ? n : null;
}

/** Coerce to string; null/undefined become ''. */
export function toStr(v: unknown): string {
  return v == null ? '' : String(v);
}

/** Truthiness for IF / boolean coercion. */
export function toBoolean(v: unknown): boolean {
  if (v == null) return false;
  if (typeof v === 'boolean') return v;
  if (typeof v === 'number') return v !== 0 && !Number.isNaN(v);
  if (typeof v === 'string') return v.length > 0;
  return true;
}

/** SF-style blank: null, undefined, '' or an empty array. */
export function isBlank(v: unknown): boolean {
  return v == null || v === '' || (Array.isArray(v) && v.length === 0);
}

/** Three-way comparison: negative / 0 / positive, or null when either side is
 *  null. Numeric when either side is a number; otherwise lexicographic. */
export function compare(a: unknown, b: unknown): number | null {
  if (a == null || b == null) return null;
  if (typeof a === 'number' || typeof b === 'number') {
    const na = toNumber(a);
    const nb = toNumber(b);
    if (na == null || nb == null) return null;
    return na - nb;
  }
  const sa = String(a);
  const sb = String(b);
  if (sa < sb) return -1;
  if (sa > sb) return 1;
  return 0;
}

/** Loose equality used by `=`, CASE and ISPICKVAL. Two blanks are equal; a
 *  blank and a non-blank are not; numbers compare numerically. */
export function looseEq(a: unknown, b: unknown): boolean {
  const aBlank = a == null || a === '';
  const bBlank = b == null || b === '';
  if (aBlank && bBlank) return true;
  if (aBlank || bBlank) return false;
  if (typeof a === 'number' || typeof b === 'number') {
    const na = toNumber(a);
    const nb = toNumber(b);
    if (na != null && nb != null) return na === nb;
  }
  return a === b || compare(a, b) === 0;
}

/** Parse a date/datetime value (a 'YYYY-MM-DD' string, an ISO string, or a
 *  Date) into a Date in UTC, or null. Dates round-trip through the dynamic
 *  layer as 'YYYY-MM-DD' (date) or ISO strings (datetime). */
export function toDate(v: unknown): Date | null {
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v;
  if (typeof v === 'string' && v) {
    const s = v.length === 10 ? `${v}T00:00:00Z` : v;
    const d = new Date(s);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  return null;
}

/** A Date → 'YYYY-MM-DD' (UTC), the canonical `date` field representation. */
export function formatDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

const MS_PER_DAY = 86_400_000;

/** Whole-day difference end − start (UTC midnight), or null. */
export function dayDiff(end: Date, start: Date): number {
  const e = Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), end.getUTCDate());
  const s = Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate());
  return Math.round((e - s) / MS_PER_DAY);
}

/** Add `days` to a date, returning a new Date (UTC). */
export function addDays(d: Date, days: number): Date {
  return new Date(d.getTime() + days * MS_PER_DAY);
}
