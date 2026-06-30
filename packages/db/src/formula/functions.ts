// The formula function library. Salesforce-parity set, ported/extended from the
// On Q `formula.js` reference. Pure: each handler maps evaluated args → a value.
//
// Conventions:
//   - Most handlers are null-aware (a null primary arg → null) so a blank field
//     propagates rather than silently becoming 0/''. Functions whose whole job
//     is to handle blanks (ISBLANK, BLANKVALUE, COALESCE, CASE, IF, CONCAT, …)
//     have their own documented semantics.
//   - Date functions read the "as-of" clock from EvalContext.now (injected by
//     the caller) so the engine stays deterministic — no Date.now() in here.

import type { EvalContext } from './evaluate.js';
import {
  addDays,
  dayDiff,
  formatDate,
  isBlank,
  looseEq,
  toBoolean,
  toDate,
  toNumber,
  toStr,
} from './helpers.js';

export type FnHandler = (args: unknown[], ctx: EvalContext) => unknown;

/** Names of every supported function — used by the SF import transpiler to
 *  decide whether a translated formula targets a function this engine has. */
export function supportedFunctionNames(): Set<string> {
  return new Set(Object.keys(FUNCTIONS));
}

function numArg(v: unknown): number | null {
  return toNumber(v);
}

export const FUNCTIONS: Record<string, FnHandler> = {
  // ── Logical ──────────────────────────────────────────────────────────────
  // AND / OR / NOT are infix operators in this engine (the SF import transpiler
  // rewrites AND()/OR()/NOT() and &&/|| into infix form), so they are not here.
  IF: ([cond, then, otherwise]) => (toBoolean(cond) ? then : (otherwise ?? null)),
  CASE: (args) => {
    // CASE(expr, val1, res1, val2, res2, …, elseResult)
    if (args.length === 0) return null;
    const subject = args[0];
    let i = 1;
    for (; i + 1 < args.length; i += 2) {
      if (looseEq(subject, args[i])) return args[i + 1];
    }
    // A trailing odd arg is the else result.
    return i < args.length ? args[i] : null;
  },
  ISPICKVAL: ([field, value]) => looseEq(field, value),

  // ── Blank handling ─────────────────────────────────────────────────────────
  ISBLANK: ([v]) => isBlank(v),
  ISNULL: ([v]) => v == null,
  BLANKVALUE: ([v, fallback]) => (isBlank(v) ? (fallback ?? null) : v),
  NULLVALUE: ([v, fallback]) => (v == null ? (fallback ?? null) : v),
  COALESCE: (args) => args.find((a) => a != null) ?? null,

  // ── Math ─────────────────────────────────────────────────────────────────
  ABS: ([n]) => (n == null ? null : Math.abs(Number(n))),
  ROUND: ([n, places]) => {
    if (n == null) return null;
    const p = places == null ? 0 : Math.trunc(Number(places));
    const f = 10 ** p;
    return Math.round(Number(n) * f) / f;
  },
  CEILING: ([n]) => (n == null ? null : Math.ceil(Number(n))),
  FLOOR: ([n]) => (n == null ? null : Math.floor(Number(n))),
  SQRT: ([n]) => {
    const x = numArg(n);
    return x == null || x < 0 ? null : Math.sqrt(x);
  },
  POWER: ([base, exp]) => {
    const b = numArg(base);
    const e = numArg(exp);
    if (b == null || e == null) return null;
    const r = b ** e;
    return Number.isFinite(r) ? r : null;
  },
  MOD: ([a, b]) => {
    const na = numArg(a);
    const nb = numArg(b);
    if (na == null || nb == null || nb === 0) return null;
    return na % nb;
  },
  MIN: (args) => {
    const nums = args.filter((a) => a != null).map(Number);
    return nums.length ? Math.min(...nums) : null;
  },
  MAX: (args) => {
    const nums = args.filter((a) => a != null).map(Number);
    return nums.length ? Math.max(...nums) : null;
  },
  VALUE: ([s]) => numArg(s),

  // ── Text ─────────────────────────────────────────────────────────────────
  TEXT: ([v]) => (v == null ? '' : String(v)),
  LEN: ([s]) => (s == null ? null : String(s).length),
  LEFT: ([s, n]) => {
    if (s == null) return null;
    const len = numArg(n) ?? 0;
    return String(s).slice(0, Math.max(0, len));
  },
  RIGHT: ([s, n]) => {
    if (s == null) return null;
    const len = numArg(n) ?? 0;
    return len <= 0 ? '' : String(s).slice(-len);
  },
  MID: ([s, start, len]) => {
    if (s == null) return null;
    const from = Math.max(0, (numArg(start) ?? 1) - 1); // SF MID is 1-based
    const count = numArg(len) ?? 0;
    return String(s).substr(from, Math.max(0, count));
  },
  UPPER: ([s]) => (s == null ? null : String(s).toUpperCase()),
  LOWER: ([s]) => (s == null ? null : String(s).toLowerCase()),
  TRIM: ([s]) => (s == null ? null : String(s).trim()),
  CONCAT: (args) => args.map(toStr).join(''),
  CONCATENATE: (args) => args.map(toStr).join(''),
  CONTAINS: ([s, sub]) => (s == null ? false : String(s).includes(toStr(sub))),
  BEGINS: ([s, sub]) => (s == null ? false : String(s).startsWith(toStr(sub))),
  SUBSTITUTE: ([s, from, to]) => (s == null ? null : String(s).split(toStr(from)).join(toStr(to))),

  // ── Date & time (read the injected clock; null when no clock provided) ─────
  TODAY: (_args, ctx) => (ctx.now ? formatDate(ctx.now) : null),
  NOW: (_args, ctx) => (ctx.now ? ctx.now.toISOString() : null),
  YEAR: ([v]) => {
    const d = toDate(v);
    return d ? d.getUTCFullYear() : null;
  },
  MONTH: ([v]) => {
    const d = toDate(v);
    return d ? d.getUTCMonth() + 1 : null;
  },
  DAY: ([v]) => {
    const d = toDate(v);
    return d ? d.getUTCDate() : null;
  },
  DATE: ([y, m, d]) => {
    const yy = numArg(y);
    const mm = numArg(m);
    const dd = numArg(d);
    if (yy == null || mm == null || dd == null) return null;
    return formatDate(new Date(Date.UTC(yy, mm - 1, dd)));
  },
  DAYS: ([end, start]) => {
    const e = toDate(end);
    const s = toDate(start);
    return e && s ? dayDiff(e, s) : null;
  },
  ADDDAYS: ([v, n]) => {
    const d = toDate(v);
    const days = numArg(n);
    if (!d || days == null) return null;
    return formatDate(addDays(d, days));
  },
};
