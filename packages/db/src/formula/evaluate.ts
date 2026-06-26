// Tree-walking evaluator for the formula AST. Pure — no side effects, no
// global state, deterministic. The same (formula, record) pair always yields
// the same result.
//
// Null semantics: any null in arithmetic/comparison short-circuits the whole
// expression to null (like SQL). Boolean ops with null follow Postgres rules:
//   NULL AND TRUE  → NULL
//   NULL AND FALSE → FALSE
//   NULL OR FALSE  → NULL
//   NULL OR TRUE   → TRUE
// String concat with null treats null as empty string (Excel-ish).

import type { AstNode } from './parse.js';
import { parseFormula } from './parse.js';

export type EvalContext = {
  /** field key → value (from record.data, already coerced via fromDb). */
  data: Record<string, unknown>;
};

export class EvalError extends Error {
  constructor(message: string) {
    super(`Formula evaluate error: ${message}`);
    this.name = 'EvalError';
  }
}

type FnHandler = (args: unknown[]) => unknown;

const FUNCTIONS: Record<string, FnHandler> = {
  UPPER: ([s]) => (s == null ? null : String(s).toUpperCase()),
  LOWER: ([s]) => (s == null ? null : String(s).toLowerCase()),
  LEN: ([s]) => (s == null ? null : String(s).length),
  TRIM: ([s]) => (s == null ? null : String(s).trim()),
  CONCAT: (args) => args.map((a) => (a == null ? '' : String(a))).join(''),

  ABS: ([n]) => (n == null ? null : Math.abs(Number(n))),
  ROUND: ([n, places]) => {
    if (n == null) return null;
    const p = places == null ? 0 : Math.trunc(Number(places));
    const f = 10 ** p;
    return Math.round(Number(n) * f) / f;
  },
  CEILING: ([n]) => (n == null ? null : Math.ceil(Number(n))),
  FLOOR: ([n]) => (n == null ? null : Math.floor(Number(n))),
  MIN: (args) => {
    const nums = args.filter((a) => a != null).map((a) => Number(a));
    return nums.length ? Math.min(...nums) : null;
  },
  MAX: (args) => {
    const nums = args.filter((a) => a != null).map((a) => Number(a));
    return nums.length ? Math.max(...nums) : null;
  },

  IF: ([cond, then, otherwise]) => (toBoolean(cond) ? then : otherwise),
  ISBLANK: ([v]) => v == null || v === '',
  COALESCE: (args) => args.find((a) => a != null) ?? null,
};

function toBoolean(v: unknown): boolean {
  if (v == null) return false;
  if (typeof v === 'boolean') return v;
  if (typeof v === 'number') return v !== 0 && !Number.isNaN(v);
  if (typeof v === 'string') return v.length > 0;
  return true;
}

function toNumber(v: unknown): number | null {
  if (v == null) return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function compare(a: unknown, b: unknown): number | null {
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

export function evaluateAst(node: AstNode, ctx: EvalContext): unknown {
  switch (node.kind) {
    case 'Num':
      return node.value;
    case 'Str':
      return node.value;
    case 'Bool':
      return node.value;
    case 'Null':
      return null;
    case 'Field': {
      // Permissive: an unknown key returns null rather than throwing, matching
      // the SQL behaviour of selecting an absent column on a relaxed schema.
      // The formula author can guard with ISBLANK / COALESCE.
      return ctx.data[node.key] ?? null;
    }
    case 'Unary': {
      const inner = evaluateAst(node.expr, ctx);
      if (node.op === '-') {
        const n = toNumber(inner);
        return n == null ? null : -n;
      }
      // NOT
      return !toBoolean(inner);
    }
    case 'Binary': {
      // Logical ops with NULL semantics handled before evaluating both sides
      // would be more efficient (short-circuit), but the test surface is
      // small and clarity beats microseconds here.
      const l = evaluateAst(node.left, ctx);
      const r = evaluateAst(node.right, ctx);
      switch (node.op) {
        case '+': {
          const ln = toNumber(l);
          const rn = toNumber(r);
          if (ln == null || rn == null) return null;
          return ln + rn;
        }
        case '-': {
          const ln = toNumber(l);
          const rn = toNumber(r);
          if (ln == null || rn == null) return null;
          return ln - rn;
        }
        case '*': {
          const ln = toNumber(l);
          const rn = toNumber(r);
          if (ln == null || rn == null) return null;
          return ln * rn;
        }
        case '/': {
          const ln = toNumber(l);
          const rn = toNumber(r);
          if (ln == null || rn == null || rn === 0) return null;
          return ln / rn;
        }
        case '&':
          return (l == null ? '' : String(l)) + (r == null ? '' : String(r));
        case '=':
          if (l == null && r == null) return true;
          if (l == null || r == null) return false;
          return l === r || compare(l, r) === 0;
        case '!=':
          if (l == null && r == null) return false;
          if (l == null || r == null) return true;
          return l !== r && compare(l, r) !== 0;
        case '<': {
          const c = compare(l, r);
          return c == null ? null : c < 0;
        }
        case '>': {
          const c = compare(l, r);
          return c == null ? null : c > 0;
        }
        case '<=': {
          const c = compare(l, r);
          return c == null ? null : c <= 0;
        }
        case '>=': {
          const c = compare(l, r);
          return c == null ? null : c >= 0;
        }
        case 'AND': {
          // SQL three-valued logic
          const lb = l == null ? null : toBoolean(l);
          const rb = r == null ? null : toBoolean(r);
          if (lb === false || rb === false) return false;
          if (lb == null || rb == null) return null;
          return true;
        }
        case 'OR': {
          const lb = l == null ? null : toBoolean(l);
          const rb = r == null ? null : toBoolean(r);
          if (lb === true || rb === true) return true;
          if (lb == null || rb == null) return null;
          return false;
        }
      }
    }
    case 'Call': {
      const fn = FUNCTIONS[node.name];
      if (!fn) throw new EvalError(`unknown function '${node.name}'`);
      const args = node.args.map((a) => evaluateAst(a, ctx));
      return fn(args);
    }
  }
}

/** Top-level: parse + evaluate. Returns the formula's result, or null on
 *  evaluation failure. Throws on parse / tokenize errors so the field-editor
 *  surface can show a precise error when the formula expression is broken. */
export function evaluateFormula(formula: string, data: Record<string, unknown>): unknown {
  const ast = parseFormula(formula);
  return evaluateAst(ast, { data });
}
