// SF → Northbeam formula transpiler. THE ONLY module that knows Salesforce
// formula syntax — the runtime engine (@northbeam/db/formula) stays SF-agnostic.
//
// Strategy: parse the SF expression into a small AST, then emit Northbeam
// formula text (fully parenthesized, `{key}` field refs, infix AND/OR/NOT). The
// emitted string is validated against the real engine before we accept it. Any
// construct we can't translate confidently — an unsupported function, a field
// path the resolver can't map (e.g. cross-object in v1) — throws and the field
// is left for manual review rather than importing a wrong formula.
//
// Scope (chunk 1): same-object field refs resolve; cross-object dot-paths and
// SF functions outside the engine's set are flagged unsupported.

import { supportedFunctionNames, validateFormula } from '@northbeam/db';

const SUPPORTED = supportedFunctionNames();

/** Maps a Salesforce field path (e.g. 'AnnualRevenue', 'Account.Name') to a
 *  Northbeam field key, or null when it can't be resolved (→ unsupported). */
export type FieldResolver = (sfPath: string) => string | null;

export type TranspileResult = { ok: true; formula: string } | { ok: false; reason: string };

class Unsupported extends Error {}

/* ── tokenizer ──────────────────────────────────────────────────────────── */

type Tok =
  | { t: 'num'; v: string }
  | { t: 'str'; v: string }
  | { t: 'name'; v: string }
  | { t: 'op'; v: string }
  | { t: 'lp' }
  | { t: 'rp' }
  | { t: 'comma' }
  | { t: 'dot' }
  | { t: 'eof' };

const OPS2 = ['&&', '||', '==', '!=', '<>', '<=', '>='];

function tokenizeSf(src: string): Tok[] {
  const out: Tok[] = [];
  let i = 0;
  const n = src.length;
  while (i < n) {
    const c = src[i] as string;
    if (/\s/.test(c)) {
      i++;
      continue;
    }
    if (c === '"' || c === "'") {
      const quote = c;
      let j = i + 1;
      let s = '';
      while (j < n && src[j] !== quote) {
        if (src[j] === '\\' && j + 1 < n) {
          s += src[j + 1];
          j += 2;
        } else {
          s += src[j];
          j++;
        }
      }
      if (j >= n) throw new Unsupported('unterminated string');
      out.push({ t: 'str', v: s });
      i = j + 1;
      continue;
    }
    if (/[0-9]/.test(c) || (c === '.' && /[0-9]/.test(src[i + 1] ?? ''))) {
      let j = i;
      let s = '';
      while (j < n && /[0-9.]/.test(src[j] as string)) {
        s += src[j];
        j++;
      }
      out.push({ t: 'num', v: s });
      i = j;
      continue;
    }
    if (/[A-Za-z_]/.test(c)) {
      let j = i;
      let s = '';
      while (j < n && /[A-Za-z0-9_]/.test(src[j] as string)) {
        s += src[j];
        j++;
      }
      out.push({ t: 'name', v: s });
      i = j;
      continue;
    }
    const two = src.slice(i, i + 2);
    if (OPS2.includes(two)) {
      out.push({ t: 'op', v: two });
      i += 2;
      continue;
    }
    if (c === '(') {
      out.push({ t: 'lp' });
      i++;
      continue;
    }
    if (c === ')') {
      out.push({ t: 'rp' });
      i++;
      continue;
    }
    if (c === ',') {
      out.push({ t: 'comma' });
      i++;
      continue;
    }
    if (c === '.') {
      out.push({ t: 'dot' });
      i++;
      continue;
    }
    if ('+-*/&=<>!^'.includes(c)) {
      out.push({ t: 'op', v: c });
      i++;
      continue;
    }
    // $User / $Profile globals and any other punctuation we don't model.
    throw new Unsupported(`unexpected character '${c}'`);
  }
  out.push({ t: 'eof' });
  return out;
}

/* ── parser (SF precedence) → AST ───────────────────────────────────────── */

type Ast =
  | { k: 'num'; v: string }
  | { k: 'str'; v: string }
  | { k: 'bool'; v: boolean }
  | { k: 'null' }
  | { k: 'path'; v: string }
  | { k: 'call'; name: string; args: Ast[] }
  | { k: 'unary'; op: string; e: Ast }
  | { k: 'binary'; op: string; l: Ast; r: Ast };

function parseSf(toks: Tok[]): Ast {
  let p = 0;
  const peek = () => toks[p] as Tok;
  const next = () => toks[p++] as Tok;
  const isOp = (v: string) => {
    const t = peek();
    return t.t === 'op' && t.v === v;
  };

  function parseOr(): Ast {
    let l = parseAnd();
    while (isOp('||')) {
      next();
      l = { k: 'binary', op: '||', l, r: parseAnd() };
    }
    return l;
  }
  function parseAnd(): Ast {
    let l = parseCmp();
    while (isOp('&&')) {
      next();
      l = { k: 'binary', op: '&&', l, r: parseCmp() };
    }
    return l;
  }
  function parseCmp(): Ast {
    let l = parseAdd();
    while (
      peek().t === 'op' &&
      ['=', '==', '!=', '<>', '<', '>', '<=', '>='].includes((peek() as { v: string }).v)
    ) {
      const op = (next() as { v: string }).v;
      l = { k: 'binary', op, l, r: parseAdd() };
    }
    return l;
  }
  function parseAdd(): Ast {
    let l = parseMul();
    while (peek().t === 'op' && ['+', '-', '&'].includes((peek() as { v: string }).v)) {
      const op = (next() as { v: string }).v;
      l = { k: 'binary', op, l, r: parseMul() };
    }
    return l;
  }
  function parseMul(): Ast {
    let l = parsePow();
    while (peek().t === 'op' && ['*', '/'].includes((peek() as { v: string }).v)) {
      const op = (next() as { v: string }).v;
      l = { k: 'binary', op, l, r: parsePow() };
    }
    return l;
  }
  function parsePow(): Ast {
    const l = parseUnary();
    if (isOp('^')) {
      next();
      return { k: 'binary', op: '^', l, r: parsePow() }; // right-assoc
    }
    return l;
  }
  function parseUnary(): Ast {
    if (isOp('-') || isOp('!')) {
      const op = (next() as { v: string }).v;
      return { k: 'unary', op, e: parseUnary() };
    }
    return parsePrimary();
  }
  function parsePrimary(): Ast {
    const t = peek();
    if (t.t === 'num') {
      next();
      return { k: 'num', v: t.v };
    }
    if (t.t === 'str') {
      next();
      return { k: 'str', v: t.v };
    }
    if (t.t === 'lp') {
      next();
      const e = parseOr();
      if (peek().t !== 'rp') throw new Unsupported('missing )');
      next();
      return e;
    }
    if (t.t === 'name') {
      next();
      const up = t.v.toUpperCase();
      if (up === 'TRUE') return { k: 'bool', v: true };
      if (up === 'FALSE') return { k: 'bool', v: false };
      if (up === 'NULL') return { k: 'null' };
      if (peek().t === 'lp') {
        next();
        const args: Ast[] = [];
        if (peek().t !== 'rp') {
          args.push(parseOr());
          while (peek().t === 'comma') {
            next();
            args.push(parseOr());
          }
        }
        if (peek().t !== 'rp') throw new Unsupported('missing ) in call');
        next();
        return { k: 'call', name: up, args };
      }
      // Dotted field path (e.g. Account.Owner.Name).
      let path = t.v;
      while (peek().t === 'dot') {
        next();
        const part = next();
        if (part.t !== 'name') throw new Unsupported('bad field path');
        path += `.${part.v}`;
      }
      return { k: 'path', v: path };
    }
    throw new Unsupported('unexpected token');
  }

  const ast = parseOr();
  if (peek().t !== 'eof') throw new Unsupported('trailing input');
  return ast;
}

/* ── emit Northbeam formula text ────────────────────────────────────────── */

const BIN_MAP: Record<string, string> = { '&&': 'AND', '||': 'OR', '==': '=' };

function emit(ast: Ast, resolve: FieldResolver): string {
  switch (ast.k) {
    case 'num':
      return ast.v;
    case 'str':
      return `"${ast.v.replace(/"/g, '\\"')}"`;
    case 'bool':
      return ast.v ? 'TRUE' : 'FALSE';
    case 'null':
      return 'NULL';
    case 'path': {
      const key = resolve(ast.v);
      if (!key) throw new Unsupported(`unresolved field '${ast.v}'`);
      return `{${key}}`;
    }
    case 'unary':
      return ast.op === '!' ? `NOT (${emit(ast.e, resolve)})` : `(-${emit(ast.e, resolve)})`;
    case 'binary': {
      if (ast.op === '^') {
        return `POWER(${emit(ast.l, resolve)}, ${emit(ast.r, resolve)})`;
      }
      const op = BIN_MAP[ast.op] ?? ast.op;
      return `(${emit(ast.l, resolve)} ${op} ${emit(ast.r, resolve)})`;
    }
    case 'call': {
      const args = ast.args.map((a) => emit(a, resolve));
      // SF function-form AND/OR/NOT → Northbeam infix operators.
      if (ast.name === 'AND') return args.length ? `(${args.join(' AND ')})` : 'TRUE';
      if (ast.name === 'OR') return args.length ? `(${args.join(' OR ')})` : 'FALSE';
      if (ast.name === 'NOT') return `NOT (${args[0] ?? 'FALSE'})`;
      if (!SUPPORTED.has(ast.name)) throw new Unsupported(`function ${ast.name}()`);
      return `${ast.name}(${args.join(', ')})`;
    }
  }
}

/** Transpile a Salesforce formula into a Northbeam formula. Returns ok:false
 *  with a human reason when any part can't be translated — the caller then
 *  leaves the field as 'review' rather than importing a wrong formula. */
export function transpileFormula(sfFormula: string, resolve: FieldResolver): TranspileResult {
  const src = sfFormula?.trim();
  if (!src) return { ok: false, reason: 'empty formula' };
  try {
    const ast = parseSf(tokenizeSf(src));
    const formula = emit(ast, resolve);
    const check = validateFormula(formula);
    if (!check.ok) return { ok: false, reason: `translated formula invalid: ${check.message}` };
    return { ok: true, formula };
  } catch (err) {
    if (err instanceof Unsupported) return { ok: false, reason: err.message };
    return { ok: false, reason: err instanceof Error ? err.message : 'transpile failed' };
  }
}
