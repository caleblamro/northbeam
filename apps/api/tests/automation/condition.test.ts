// Condition evaluation: the filter op table (mirroring packages/db
// dynamic/filters-sql.ts + apps/web/src/lib/filters.ts semantics), template
// interpolation of filter values, formula mode with oldRecord.* flattening,
// and the ruleIssues-style fail-open (matched:false + warning) policy.

import type { FlowCondition } from '@northbeam/core';
import { describe, expect, it } from 'vitest';
import { evaluateFlowCondition, matchesFlowFilter } from '../../src/automation/condition.js';

const NOW = new Date('2026-07-05T12:00:00.000Z');

describe('matchesFlowFilter — op table', () => {
  it('unary state ops', () => {
    expect(matchesFlowFilter('text', '', 'isEmpty', null)).toBe(true);
    expect(matchesFlowFilter('text', null, 'isEmpty', null)).toBe(true);
    expect(matchesFlowFilter('multipicklist', [], 'isEmpty', null)).toBe(true);
    expect(matchesFlowFilter('number', 0, 'isEmpty', null)).toBe(false); // 0 is a real value
    expect(matchesFlowFilter('text', 'x', 'isSet', null)).toBe(true);
    expect(matchesFlowFilter('checkbox', true, 'isTrue', null)).toBe(true);
    expect(matchesFlowFilter('checkbox', null, 'isFalse', null)).toBe(true); // NULL is false
    expect(matchesFlowFilter('checkbox', false, 'isTrue', null)).toBe(false);
  });

  it('eq/neq fold case on text and compare numerically on numeric types', () => {
    expect(matchesFlowFilter('text', 'Acme', 'eq', 'acme')).toBe(true);
    expect(matchesFlowFilter('text', 'Acme', 'neq', 'acme')).toBe(false);
    // numeric(18,2) stringifies as '5000.00' while the flow author types '5000'.
    expect(matchesFlowFilter('currency', '5000.00', 'eq', '5000')).toBe(true);
    expect(matchesFlowFilter('currency', 5000, 'eq', '5000')).toBe(true);
    expect(matchesFlowFilter('currency', 5000, 'neq', '5000')).toBe(false);
  });

  it('untyped eq falls back to numeric compare only when both sides coerce', () => {
    expect(matchesFlowFilter(undefined, '5000.00', 'eq', 5000)).toBe(true);
    expect(matchesFlowFilter(undefined, 'Acme', 'eq', 'ACME')).toBe(true);
  });

  it('substring ops fold case', () => {
    expect(matchesFlowFilter('text', 'Hello World', 'contains', 'lo wo')).toBe(true);
    expect(matchesFlowFilter('text', 'Hello', 'startsWith', 'he')).toBe(true);
    expect(matchesFlowFilter('text', 'Hello', 'endsWith', 'LLO')).toBe(true);
    expect(matchesFlowFilter('text', 'Hello', 'contains', 'xyz')).toBe(false);
  });

  it('binary ops never match an empty stored value', () => {
    expect(matchesFlowFilter('text', '', 'eq', '')).toBe(false);
    expect(matchesFlowFilter('text', null, 'contains', '')).toBe(false);
    expect(matchesFlowFilter('number', null, 'gt', 0)).toBe(false);
  });

  it('multipicklist contains is case-insensitive membership, not substring', () => {
    expect(matchesFlowFilter('multipicklist', ['Alpha', 'Beta'], 'contains', 'alpha')).toBe(true);
    expect(matchesFlowFilter('multipicklist', ['Alphabet'], 'contains', 'alpha')).toBe(false);
    // Untyped array values get membership semantics too (vars from get_records).
    expect(matchesFlowFilter(undefined, ['a', 'b'], 'contains', 'B')).toBe(true);
  });

  it('gt/lt/gte/lte compare numerically for numeric types', () => {
    expect(matchesFlowFilter('number', 250, 'gt', 100)).toBe(true);
    expect(matchesFlowFilter('number', 250, 'lte', '250')).toBe(true);
    expect(matchesFlowFilter('number', 99, 'gte', 100)).toBe(false);
    // Non-coercible bound → no match (mirrors NaN comparisons in the web matcher).
    expect(matchesFlowFilter('number', 250, 'gt', 'abc')).toBe(false);
  });

  it('gt/gte/lte compare as instants on date types, honoring relative tokens', () => {
    expect(matchesFlowFilter('date', '2026-07-04', 'lt', '@today', NOW)).toBe(true);
    expect(matchesFlowFilter('datetime', '2026-07-05T13:00:00Z', 'gte', '@today', NOW)).toBe(true);
    expect(matchesFlowFilter('date', '2026-07-01', 'gt', '2026-06-30')).toBe(true);
  });

  it('before/after compare instants; an unresolvable bound is a no-op', () => {
    expect(matchesFlowFilter('date', '2026-07-01', 'before', '2026-07-02')).toBe(true);
    expect(matchesFlowFilter('date', '2026-07-03', 'after', '2026-07-02')).toBe(true);
    expect(matchesFlowFilter('date', '2026-07-03', 'before', 'not a date')).toBe(true); // ↔ SQL drops the predicate
    expect(matchesFlowFilter('date', 'garbage', 'before', '2026-07-02')).toBe(false);
  });
});

describe('evaluateFlowCondition — filters mode', () => {
  const data = { stage: 'closed_won', amount: 250, region: 'EMEA' };
  const fields = [
    { key: 'stage', type: 'picklist' },
    { key: 'amount', type: 'currency' },
    { key: 'region', type: 'text' },
  ];
  const cond = (
    logic: 'and' | 'or',
    filters: Array<{ fieldKey: string; op: string; value?: unknown }>,
  ) => ({ mode: 'filters', logic, filters }) as FlowCondition;

  it('AND requires every filter; OR requires one', () => {
    const both = [
      { fieldKey: 'stage', op: 'eq', value: 'closed_won' },
      { fieldKey: 'amount', op: 'gt', value: 1000 },
    ];
    expect(evaluateFlowCondition(cond('and', both), { data, fields }).matched).toBe(false);
    expect(evaluateFlowCondition(cond('or', both), { data, fields }).matched).toBe(true);
  });

  it('interpolates {{merge}} filter values through the provided scopes first', () => {
    const c = cond('and', [{ fieldKey: 'amount', op: 'gt', value: '{{vars.threshold}}' }]);
    const scopes = { vars: { threshold: 100 } };
    expect(evaluateFlowCondition(c, { data, fields, scopes }).matched).toBe(true);
    expect(
      evaluateFlowCondition(c, { data, fields, scopes: { vars: { threshold: 9999 } } }).matched,
    ).toBe(false);
  });

  it('skips unknown field keys when fields are provided (constrains nothing)', () => {
    const c = cond('and', [
      { fieldKey: 'ghost', op: 'eq', value: 'x' },
      { fieldKey: 'stage', op: 'eq', value: 'closed_won' },
    ]);
    expect(evaluateFlowCondition(c, { data, fields }).matched).toBe(true);
    // All filters unknown → the condition cannot constrain → matched.
    const allGhost = cond('and', [{ fieldKey: 'ghost', op: 'eq', value: 'x' }]);
    expect(evaluateFlowCondition(allGhost, { data, fields }).matched).toBe(true);
  });

  it('falls back to value-shape heuristics without field metadata', () => {
    const c = cond('and', [{ fieldKey: 'amount', op: 'gte', value: '250' }]);
    expect(evaluateFlowCondition(c, { data }).matched).toBe(true);
  });
});

describe('evaluateFlowCondition — formula mode', () => {
  const formula = (f: string): FlowCondition => ({ mode: 'formula', formula: f });

  it('evaluates against the record data bag with formula truthiness', () => {
    expect(
      evaluateFlowCondition(formula('{amount} > 100'), { data: { amount: 250 } }).matched,
    ).toBe(true);
    expect(evaluateFlowCondition(formula('{amount} > 100'), { data: { amount: 50 } }).matched).toBe(
      false,
    );
    expect(evaluateFlowCondition(formula('0'), { data: {} }).matched).toBe(false);
    expect(evaluateFlowCondition(formula('"x"'), { data: {} }).matched).toBe(true);
  });

  it('flattens oldData into {oldRecord.<key>} references', () => {
    const result = evaluateFlowCondition(formula('{amount} > {oldRecord.amount}'), {
      data: { amount: 250 },
      oldData: { amount: 100 },
    });
    expect(result.matched).toBe(true);
    const shrunk = evaluateFlowCondition(formula('{amount} > {oldRecord.amount}'), {
      data: { amount: 50 },
      oldData: { amount: 100 },
    });
    expect(shrunk.matched).toBe(false);
  });

  it('injects now for TODAY()/NOW(); without it they evaluate to null', () => {
    expect(evaluateFlowCondition(formula('NOW()'), { data: {}, now: NOW }).matched).toBe(true);
    expect(evaluateFlowCondition(formula('NOW()'), { data: {} }).matched).toBe(false);
  });

  it('fails open with a warning on a broken formula (ruleIssues policy)', () => {
    const result = evaluateFlowCondition(formula('SYNTAX((('), { data: {} });
    expect(result.matched).toBe(false);
    expect(result.warning).toContain('condition failed to evaluate');
  });
});
