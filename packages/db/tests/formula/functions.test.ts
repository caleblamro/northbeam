// Tests for the Salesforce-parity function set + cross-object reads added to
// the formula engine. The base arithmetic / null-propagation behaviour lives in
// formula.test.ts; this pins the expanded library and the dotted-key resolution.

import { describe, expect, it } from 'vitest';
import { collectFieldKeys, evaluateFormula, parseFormula } from '../../src/formula/index.js';

const NOW = new Date('2026-06-30T12:00:00Z');

describe('text functions', () => {
  it('LEFT / RIGHT / MID are 1-based like Salesforce', () => {
    expect(evaluateFormula('LEFT("Northbeam", 5)', {})).toBe('North');
    expect(evaluateFormula('RIGHT("Northbeam", 4)', {})).toBe('beam');
    expect(evaluateFormula('MID("Northbeam", 6, 4)', {})).toBe('beam');
  });
  it('CONTAINS / BEGINS / SUBSTITUTE', () => {
    expect(evaluateFormula('CONTAINS("hello world", "o w")', {})).toBe(true);
    expect(evaluateFormula('BEGINS("hello", "he")', {})).toBe(true);
    expect(evaluateFormula('SUBSTITUTE("a-b-c", "-", "/")', {})).toBe('a/b/c');
  });
  it('TEXT of blank is empty, of a number is its string', () => {
    expect(evaluateFormula('TEXT({x})', { x: null })).toBe('');
    expect(evaluateFormula('TEXT({x})', { x: 42 })).toBe('42');
  });
});

describe('math functions', () => {
  it('POWER, SQRT, MOD', () => {
    expect(evaluateFormula('POWER(2, 10)', {})).toBe(1024);
    expect(evaluateFormula('SQRT(144)', {})).toBe(12);
    expect(evaluateFormula('MOD(10, 3)', {})).toBe(1);
  });
  it('MOD by zero and SQRT of negative are null', () => {
    expect(evaluateFormula('MOD(10, 0)', {})).toBe(null);
    expect(evaluateFormula('SQRT(-1)', {})).toBe(null);
  });
  it('VALUE parses numeric text', () => {
    expect(evaluateFormula('VALUE("3.5")', {})).toBe(3.5);
    expect(evaluateFormula('VALUE("nope")', {})).toBe(null);
  });
});

describe('blank handling', () => {
  it('BLANKVALUE falls back on blank, NULLVALUE only on null', () => {
    expect(evaluateFormula('BLANKVALUE({x}, "fallback")', { x: '' })).toBe('fallback');
    expect(evaluateFormula('NULLVALUE({x}, "fallback")', { x: '' })).toBe('');
    expect(evaluateFormula('NULLVALUE({x}, "fallback")', { x: null })).toBe('fallback');
  });
  it('ISNULL distinguishes null from empty string', () => {
    expect(evaluateFormula('ISNULL({x})', { x: null })).toBe(true);
    expect(evaluateFormula('ISNULL({x})', { x: '' })).toBe(false);
  });
});

describe('CASE and ISPICKVAL', () => {
  it('CASE matches a branch or falls to else', () => {
    const f = 'CASE({stage}, "won", 1, "lost", 0, -1)';
    expect(evaluateFormula(f, { stage: 'won' })).toBe(1);
    expect(evaluateFormula(f, { stage: 'lost' })).toBe(0);
    expect(evaluateFormula(f, { stage: 'open' })).toBe(-1);
  });
  it('ISPICKVAL compares the picklist value', () => {
    expect(evaluateFormula('ISPICKVAL({stage}, "won")', { stage: 'won' })).toBe(true);
    expect(evaluateFormula('ISPICKVAL({stage}, "won")', { stage: 'lost' })).toBe(false);
  });
});

describe('date functions with injected clock', () => {
  it('TODAY / NOW read the as-of clock (deterministic)', () => {
    expect(evaluateFormula('TODAY()', {}, { now: NOW })).toBe('2026-06-30');
    expect(evaluateFormula('NOW()', {}, { now: NOW })).toBe('2026-06-30T12:00:00.000Z');
  });
  it('TODAY is null without a clock', () => {
    expect(evaluateFormula('TODAY()', {})).toBe(null);
  });
  it('YEAR / MONTH / DAY decompose a date', () => {
    expect(evaluateFormula('YEAR({d})', { d: '2026-06-30' })).toBe(2026);
    expect(evaluateFormula('MONTH({d})', { d: '2026-06-30' })).toBe(6);
    expect(evaluateFormula('DAY({d})', { d: '2026-06-30' })).toBe(30);
  });
  it('DAYS difference and ADDDAYS', () => {
    expect(evaluateFormula('DAYS({a}, {b})', { a: '2026-06-30', b: '2026-06-20' })).toBe(10);
    expect(evaluateFormula('ADDDAYS({d}, 5)', { d: '2026-06-30' })).toBe('2026-07-05');
  });
  it('DATE builds a date from parts', () => {
    expect(evaluateFormula('DATE(2026, 6, 30)', {})).toBe('2026-06-30');
  });
});

describe('cross-object dotted references', () => {
  it('reads a dotted key from the (pre-resolved) context map', () => {
    const ctx = { amount: 100, 'account.owner.name': 'Dana' };
    expect(evaluateFormula('{account.owner.name}', ctx)).toBe('Dana');
    expect(evaluateFormula('{amount} * 2', ctx)).toBe(200);
  });

  it('collectFieldKeys surfaces both same-record and dotted refs', () => {
    const keys = collectFieldKeys(parseFormula('IF({amount} > 0, {account.name}, "—")'));
    expect(keys.has('amount')).toBe(true);
    expect(keys.has('account.name')).toBe(true);
  });
});
