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

import { FUNCTIONS } from './functions';
import { compare, toBoolean, toNumber } from './helpers';
import type { AstNode } from './parse';
import { parseFormula } from './parse';

export type EvalContext = {
  /** field key → value. Same-record keys come from record.data (coerced via
   *  fromDb); cross-object keys are dotted (e.g. 'account.owner.name') and are
   *  pre-resolved into this flat map by the compute-context builder. */
  data: Record<string, unknown>;
  /** "As-of" clock for TODAY/NOW. Injected by the caller so the engine stays
   *  pure + deterministic; when absent, TODAY/NOW evaluate to null. */
  now?: Date;
};

export class FormulaEvalError extends Error {
  constructor(message: string) {
    super(`Formula evaluate error: ${message}`);
    this.name = 'FormulaEvalError';
  }
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
      throw new FormulaEvalError('unhandled binary operator');
    }
    case 'Call': {
      const fn = FUNCTIONS[node.name];
      if (!fn) throw new FormulaEvalError(`unknown function '${node.name}'`);
      const args = node.args.map((a) => evaluateAst(a, ctx));
      return fn(args, ctx);
    }
  }
}

/** Top-level: parse + evaluate. Returns the formula's result, or null on
 *  evaluation failure. Throws on parse / tokenize errors so the field-editor
 *  surface can show a precise error when the formula expression is broken. */
export function evaluateFormula(
  formula: string,
  data: Record<string, unknown>,
  opts: { now?: Date } = {},
): unknown {
  const ast = parseFormula(formula);
  return evaluateAst(ast, { data, ...opts });
}
