// End-to-end tests for the formula engine. The engine is a small DSL — easy
// to get the precedence wrong or to miss a null-propagation rule. Each test
// pins one observable behaviour the field-editor user relies on.

import { describe, expect, it } from 'vitest';
import { evaluateFormula, validateFormula } from '../../src/formula/index.js';

describe('arithmetic', () => {
  it('adds, subtracts, multiplies, divides numbers', () => {
    expect(evaluateFormula('1 + 2', {})).toBe(3);
    expect(evaluateFormula('5 - 3', {})).toBe(2);
    expect(evaluateFormula('4 * 6', {})).toBe(24);
    expect(evaluateFormula('10 / 4', {})).toBe(2.5);
  });

  it('respects standard precedence (mul before add)', () => {
    expect(evaluateFormula('1 + 2 * 3', {})).toBe(7);
    expect(evaluateFormula('(1 + 2) * 3', {})).toBe(9);
  });

  it('handles unary minus', () => {
    expect(evaluateFormula('-5', {})).toBe(-5);
    expect(evaluateFormula('-(2 + 3)', {})).toBe(-5);
    expect(evaluateFormula('5 - -3', {})).toBe(8);
  });

  it('divides by zero → null (not Infinity / NaN)', () => {
    expect(evaluateFormula('10 / 0', {})).toBeNull();
  });

  it('propagates null through arithmetic', () => {
    expect(evaluateFormula('{x} + 1', { x: null })).toBeNull();
    expect(evaluateFormula('{x} * 2', { x: undefined })).toBeNull();
  });
});

describe('field references', () => {
  it('reads field values from data', () => {
    expect(evaluateFormula('{amount}', { amount: 1000 })).toBe(1000);
    expect(evaluateFormula('{amount} * 0.20', { amount: 1000 })).toBeCloseTo(200);
  });

  it('returns null for missing keys', () => {
    expect(evaluateFormula('{missing}', { other: 5 })).toBeNull();
  });

  it('coerces stringy numbers in arithmetic', () => {
    expect(evaluateFormula('{a} + {b}', { a: '5', b: '3' })).toBe(8);
  });
});

describe('strings', () => {
  it('concatenates with & or +', () => {
    expect(evaluateFormula('"hello" & " " & "world"', {})).toBe('hello world');
  });

  it('treats null as empty in concatenation', () => {
    expect(evaluateFormula('{first} & " " & {last}', { first: 'Ada', last: null })).toBe('Ada ');
  });

  it('honours single-quoted strings + escapes', () => {
    expect(evaluateFormula("'foo' & '\\n' & 'bar'", {})).toBe('foo\nbar');
  });
});

describe('comparison + boolean', () => {
  it('compares numbers', () => {
    expect(evaluateFormula('1 < 2', {})).toBe(true);
    expect(evaluateFormula('2 <= 2', {})).toBe(true);
    expect(evaluateFormula('3 = 3', {})).toBe(true);
    expect(evaluateFormula('3 != 4', {})).toBe(true);
    expect(evaluateFormula('3 <> 4', {})).toBe(true);
  });

  it('compares strings lexicographically', () => {
    expect(evaluateFormula('"abc" < "abd"', {})).toBe(true);
    expect(evaluateFormula('"abc" = "abc"', {})).toBe(true);
  });

  it('AND / OR / NOT follow boolean logic', () => {
    expect(evaluateFormula('TRUE AND FALSE', {})).toBe(false);
    expect(evaluateFormula('TRUE OR FALSE', {})).toBe(true);
    expect(evaluateFormula('NOT FALSE', {})).toBe(true);
  });

  it('uses SQL three-valued logic for NULL', () => {
    expect(evaluateFormula('TRUE AND {x}', { x: null })).toBeNull();
    expect(evaluateFormula('FALSE AND {x}', { x: null })).toBe(false);
    expect(evaluateFormula('{x} OR TRUE', { x: null })).toBe(true);
    expect(evaluateFormula('{x} OR FALSE', { x: null })).toBeNull();
  });
});

describe('functions', () => {
  it('UPPER / LOWER / LEN / TRIM', () => {
    expect(evaluateFormula('UPPER("hi")', {})).toBe('HI');
    expect(evaluateFormula('LOWER("HI")', {})).toBe('hi');
    expect(evaluateFormula('LEN("abcd")', {})).toBe(4);
    expect(evaluateFormula('TRIM("  ok  ")', {})).toBe('ok');
  });

  it('IF / ISBLANK / COALESCE', () => {
    expect(evaluateFormula('IF({x} > 5, "big", "small")', { x: 10 })).toBe('big');
    expect(evaluateFormula('IF({x} > 5, "big", "small")', { x: 1 })).toBe('small');
    expect(evaluateFormula('ISBLANK({x})', { x: null })).toBe(true);
    expect(evaluateFormula('ISBLANK({x})', { x: '' })).toBe(true);
    expect(evaluateFormula('ISBLANK({x})', { x: 'hi' })).toBe(false);
    expect(evaluateFormula('COALESCE({a}, {b}, "default")', { a: null, b: 'fallback' })).toBe(
      'fallback',
    );
  });

  it('ROUND / ABS / CEILING / FLOOR / MIN / MAX', () => {
    expect(evaluateFormula('ROUND(3.14159, 2)', {})).toBeCloseTo(3.14);
    expect(evaluateFormula('ROUND(3.14159, 0)', {})).toBe(3);
    expect(evaluateFormula('ABS(-7)', {})).toBe(7);
    expect(evaluateFormula('CEILING(2.1)', {})).toBe(3);
    expect(evaluateFormula('FLOOR(2.9)', {})).toBe(2);
    expect(evaluateFormula('MIN(3, 1, 2)', {})).toBe(1);
    expect(evaluateFormula('MAX(3, 1, 2)', {})).toBe(3);
  });

  it('throws on an unknown function name', () => {
    expect(() => evaluateFormula('FROBNICATE(1)', {})).toThrowError(/unknown function/);
  });
});

describe('validateFormula', () => {
  it('accepts well-formed formulas', () => {
    expect(validateFormula('{a} + 1')).toEqual({ ok: true });
    expect(validateFormula('IF({stage} = "closed_won", {amount}, 0)')).toEqual({ ok: true });
  });

  it('rejects unterminated strings, parens, fields', () => {
    expect(validateFormula('"hello').ok).toBe(false);
    expect(validateFormula('(1 + 2').ok).toBe(false);
    expect(validateFormula('{unterminated').ok).toBe(false);
  });

  it('rejects bare identifiers (no function call)', () => {
    expect(validateFormula('FOO').ok).toBe(false);
  });

  it('rejects empty field references', () => {
    expect(validateFormula('{}').ok).toBe(false);
  });
});
