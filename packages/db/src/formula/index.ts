// Public surface of the formula engine. The compute path is:
//
//   1. The user authors a formula in field config (e.g. "{amount} * 0.20").
//   2. validateFormula() ensures it parses (called at field-create time).
//   3. evaluateFormula() runs it against a record's data to produce the value.
//
// The engine is intentionally pure: same input → same output, no I/O, no
// globals. The compute worker (apps/api/src/workers) reads the formula off
// field_def.config.formula and writes the result back to the record's column.

export { tokenize, type Token, TokenizeError } from './tokenize.js';
export { parseFormula, collectFieldKeys, type AstNode, ParseError } from './parse.js';
export { evaluateFormula, evaluateAst, EvalError, type EvalContext } from './evaluate.js';
export { supportedFunctionNames, type FnHandler } from './functions.js';

import { parseFormula } from './parse.js';
import { ParseError } from './parse.js';
import { TokenizeError } from './tokenize.js';

/** True if the formula parses cleanly. Use at write time to reject bad
 *  expressions before they reach the compute worker. */
export function validateFormula(
  formula: string,
): { ok: true } | { ok: false; message: string; pos: number } {
  try {
    parseFormula(formula);
    return { ok: true };
  } catch (err) {
    if (err instanceof ParseError || err instanceof TokenizeError) {
      return { ok: false, message: err.message, pos: err.pos };
    }
    if (err instanceof Error) return { ok: false, message: err.message, pos: 0 };
    return { ok: false, message: 'unknown error', pos: 0 };
  }
}
