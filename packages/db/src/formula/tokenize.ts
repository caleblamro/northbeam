// Tokenizer for the formula language. Pure functions; no DB or runtime deps.
//
// Token kinds we emit:
//   - NUMBER       42, 3.14
//   - STRING       "hello"  (single or double quoted; backslash escapes \" \n \\)
//   - IDENT        UPPER, IF, AND, TRUE  (case-insensitive — uppercased in tok)
//   - FIELD        {first_name}          (field reference)
//   - OP           + - * / & = <> < > <= >= != AND OR NOT
//   - LPAREN       (
//   - RPAREN       )
//   - COMMA        ,
//   - EOF
//
// We accept `&` and `+` for string concat (Excel-ish). `<>` and `!=` are both
// not-equal. Identifiers are matched case-insensitively.

export type TokenKind =
  | 'NUMBER'
  | 'STRING'
  | 'IDENT'
  | 'FIELD'
  | 'OP'
  | 'LPAREN'
  | 'RPAREN'
  | 'COMMA'
  | 'EOF';

export type Token = { kind: TokenKind; value: string; pos: number };

const OPS = new Set([
  '+',
  '-',
  '*',
  '/',
  '&',
  '=',
  '<',
  '>',
  '<=',
  '>=',
  '<>',
  '!=',
]);

export class TokenizeError extends Error {
  constructor(
    message: string,
    readonly pos: number,
  ) {
    super(`Formula tokenize error at ${pos}: ${message}`);
    this.name = 'TokenizeError';
  }
}

export function tokenize(input: string): Token[] {
  const out: Token[] = [];
  let i = 0;
  const len = input.length;

  while (i < len) {
    const ch = input[i] ?? '';

    // Whitespace
    if (ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r') {
      i++;
      continue;
    }

    // Parens / comma
    if (ch === '(') {
      out.push({ kind: 'LPAREN', value: '(', pos: i });
      i++;
      continue;
    }
    if (ch === ')') {
      out.push({ kind: 'RPAREN', value: ')', pos: i });
      i++;
      continue;
    }
    if (ch === ',') {
      out.push({ kind: 'COMMA', value: ',', pos: i });
      i++;
      continue;
    }

    // Field reference: {key}
    if (ch === '{') {
      const start = i;
      i++;
      let key = '';
      while (i < len && input[i] !== '}') {
        key += input[i];
        i++;
      }
      if (input[i] !== '}') {
        throw new TokenizeError('unterminated field reference', start);
      }
      i++; // consume }
      const trimmed = key.trim();
      if (!trimmed) throw new TokenizeError('empty field reference', start);
      out.push({ kind: 'FIELD', value: trimmed, pos: start });
      continue;
    }

    // String literal
    if (ch === '"' || ch === "'") {
      const quote = ch;
      const start = i;
      i++;
      let s = '';
      while (i < len && input[i] !== quote) {
        if (input[i] === '\\' && i + 1 < len) {
          const next = input[i + 1];
          if (next === 'n') s += '\n';
          else if (next === 't') s += '\t';
          else if (next === '\\') s += '\\';
          else if (next === quote) s += quote;
          else s += next ?? '';
          i += 2;
        } else {
          s += input[i];
          i++;
        }
      }
      if (input[i] !== quote) {
        throw new TokenizeError('unterminated string literal', start);
      }
      i++;
      out.push({ kind: 'STRING', value: s, pos: start });
      continue;
    }

    // Number literal
    if ((ch >= '0' && ch <= '9') || (ch === '.' && /[0-9]/.test(input[i + 1] ?? ''))) {
      const start = i;
      let num = '';
      while (i < len && /[0-9.]/.test(input[i] ?? '')) {
        num += input[i];
        i++;
      }
      out.push({ kind: 'NUMBER', value: num, pos: start });
      continue;
    }

    // Identifier (function name, AND/OR/NOT/TRUE/FALSE/NULL)
    if (/[A-Za-z_]/.test(ch)) {
      const start = i;
      let id = '';
      while (i < len && /[A-Za-z0-9_]/.test(input[i] ?? '')) {
        id += input[i];
        i++;
      }
      const upper = id.toUpperCase();
      if (upper === 'AND' || upper === 'OR' || upper === 'NOT') {
        out.push({ kind: 'OP', value: upper, pos: start });
      } else {
        out.push({ kind: 'IDENT', value: upper, pos: start });
      }
      continue;
    }

    // Multi-char operators
    const two = input.slice(i, i + 2);
    if (OPS.has(two)) {
      out.push({ kind: 'OP', value: two, pos: i });
      i += 2;
      continue;
    }
    if (OPS.has(ch)) {
      out.push({ kind: 'OP', value: ch, pos: i });
      i++;
      continue;
    }

    throw new TokenizeError(`unexpected character '${ch}'`, i);
  }

  out.push({ kind: 'EOF', value: '', pos: len });
  return out;
}
