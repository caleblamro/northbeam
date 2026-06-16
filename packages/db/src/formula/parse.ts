// Recursive-descent parser. Builds an AST whose nodes the evaluator walks.
//
// Precedence (lowest → highest):
//   1. OR
//   2. AND
//   3. NOT (unary)
//   4. = != <> < > <= >=
//   5. + - &     (concat shares precedence with addition for Excel-style use)
//   6. * /
//   7. unary -
//   8. atoms: literal, field, identifier, call, (expr)

import { type Token, tokenize } from './tokenize.js';

export type AstNode =
  | { kind: 'Num'; value: number }
  | { kind: 'Str'; value: string }
  | { kind: 'Bool'; value: boolean }
  | { kind: 'Null' }
  | { kind: 'Field'; key: string }
  | { kind: 'Unary'; op: '-' | 'NOT'; expr: AstNode }
  | {
      kind: 'Binary';
      op:
        | '+'
        | '-'
        | '*'
        | '/'
        | '&'
        | '='
        | '!='
        | '<'
        | '>'
        | '<='
        | '>='
        | 'AND'
        | 'OR';
      left: AstNode;
      right: AstNode;
    }
  | { kind: 'Call'; name: string; args: AstNode[] };

export class ParseError extends Error {
  constructor(
    message: string,
    readonly pos: number,
  ) {
    super(`Formula parse error at ${pos}: ${message}`);
    this.name = 'ParseError';
  }
}

class Parser {
  private idx = 0;

  constructor(private readonly toks: Token[]) {}

  parse(): AstNode {
    const expr = this.parseOr();
    const t = this.peek();
    if (t.kind !== 'EOF') {
      throw new ParseError(`unexpected '${t.value}' after expression`, t.pos);
    }
    return expr;
  }

  private peek(): Token {
    return this.toks[this.idx]!;
  }

  private eat(): Token {
    const t = this.toks[this.idx]!;
    this.idx++;
    return t;
  }

  private expect(kind: Token['kind']): Token {
    const t = this.peek();
    if (t.kind !== kind) throw new ParseError(`expected ${kind} but got ${t.kind}`, t.pos);
    return this.eat();
  }

  private parseOr(): AstNode {
    let left = this.parseAnd();
    while (this.peek().kind === 'OP' && this.peek().value === 'OR') {
      this.eat();
      const right = this.parseAnd();
      left = { kind: 'Binary', op: 'OR', left, right };
    }
    return left;
  }

  private parseAnd(): AstNode {
    let left = this.parseNot();
    while (this.peek().kind === 'OP' && this.peek().value === 'AND') {
      this.eat();
      const right = this.parseNot();
      left = { kind: 'Binary', op: 'AND', left, right };
    }
    return left;
  }

  private parseNot(): AstNode {
    if (this.peek().kind === 'OP' && this.peek().value === 'NOT') {
      this.eat();
      return { kind: 'Unary', op: 'NOT', expr: this.parseNot() };
    }
    return this.parseComparison();
  }

  private parseComparison(): AstNode {
    let left = this.parseAdditive();
    while (this.peek().kind === 'OP') {
      const v = this.peek().value;
      if (v === '=' || v === '!=' || v === '<>' || v === '<' || v === '>' || v === '<=' || v === '>=') {
        this.eat();
        const right = this.parseAdditive();
        const op = v === '<>' ? '!=' : v;
        left = { kind: 'Binary', op: op as '=' | '!=' | '<' | '>' | '<=' | '>=', left, right };
      } else break;
    }
    return left;
  }

  private parseAdditive(): AstNode {
    let left = this.parseMultiplicative();
    while (this.peek().kind === 'OP') {
      const v = this.peek().value;
      if (v === '+' || v === '-' || v === '&') {
        this.eat();
        const right = this.parseMultiplicative();
        left = { kind: 'Binary', op: v as '+' | '-' | '&', left, right };
      } else break;
    }
    return left;
  }

  private parseMultiplicative(): AstNode {
    let left = this.parseUnary();
    while (this.peek().kind === 'OP') {
      const v = this.peek().value;
      if (v === '*' || v === '/') {
        this.eat();
        const right = this.parseUnary();
        left = { kind: 'Binary', op: v as '*' | '/', left, right };
      } else break;
    }
    return left;
  }

  private parseUnary(): AstNode {
    if (this.peek().kind === 'OP' && this.peek().value === '-') {
      this.eat();
      return { kind: 'Unary', op: '-', expr: this.parseUnary() };
    }
    return this.parseAtom();
  }

  private parseAtom(): AstNode {
    const t = this.peek();
    if (t.kind === 'NUMBER') {
      this.eat();
      return { kind: 'Num', value: Number(t.value) };
    }
    if (t.kind === 'STRING') {
      this.eat();
      return { kind: 'Str', value: t.value };
    }
    if (t.kind === 'FIELD') {
      this.eat();
      return { kind: 'Field', key: t.value };
    }
    if (t.kind === 'LPAREN') {
      this.eat();
      const inner = this.parseOr();
      this.expect('RPAREN');
      return inner;
    }
    if (t.kind === 'IDENT') {
      this.eat();
      if (t.value === 'TRUE') return { kind: 'Bool', value: true };
      if (t.value === 'FALSE') return { kind: 'Bool', value: false };
      if (t.value === 'NULL') return { kind: 'Null' };
      // Function call: IDENT ( args )
      if (this.peek().kind !== 'LPAREN') {
        throw new ParseError(`bare identifier '${t.value}' — did you forget '{...}' for a field?`, t.pos);
      }
      this.eat(); // (
      const args: AstNode[] = [];
      if (this.peek().kind !== 'RPAREN') {
        args.push(this.parseOr());
        while (this.peek().kind === 'COMMA') {
          this.eat();
          args.push(this.parseOr());
        }
      }
      this.expect('RPAREN');
      return { kind: 'Call', name: t.value, args };
    }
    throw new ParseError(`unexpected token '${t.value}'`, t.pos);
  }
}

export function parseFormula(input: string): AstNode {
  return new Parser(tokenize(input)).parse();
}
