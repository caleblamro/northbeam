// SF → Northbeam formula transpiler tests. Resolver maps same-object SF field
// API names to Northbeam keys (cross-object paths return null → unsupported).

import { evaluateFormula } from '@northbeam/db';
import { describe, expect, it } from 'vitest';
import { transpileFormula } from '../../src/salesforce/transpile.js';

const KEYS: Record<string, string> = {
  AnnualRevenue: 'annual_revenue',
  Amount: 'amount',
  StageName: 'stage',
  Name: 'name',
};
const resolve = (p: string) => KEYS[p] ?? null;
const t = (sf: string) => transpileFormula(sf, resolve);

describe('field references', () => {
  it('rewrites a bare SF API name to a {key} ref', () => {
    expect(t('AnnualRevenue * 0.2')).toEqual({ ok: true, formula: '({annual_revenue} * 0.2)' });
  });
  it('flags a cross-object path it cannot resolve', () => {
    const r = t('Account.Name');
    expect(r.ok).toBe(false);
  });
});

describe('operators', () => {
  it('maps && || == to AND OR =', () => {
    expect(t('Amount > 0 && StageName == "Closed Won"')).toEqual({
      ok: true,
      formula: '(({amount} > 0) AND ({stage} = "Closed Won"))',
    });
  });
  it('maps ^ to POWER', () => {
    expect(t('Amount ^ 2')).toEqual({ ok: true, formula: 'POWER({amount}, 2)' });
  });
  it('keeps string concat &', () => {
    expect(t('Name & " (VIP)"')).toEqual({ ok: true, formula: '({name} & " (VIP)")' });
  });
});

describe('functions', () => {
  it('passes through supported functions', () => {
    expect(t('IF(Amount > 0, "yes", "no")')).toEqual({
      ok: true,
      formula: 'IF(({amount} > 0), "yes", "no")',
    });
  });
  it('converts function-form AND/OR/NOT to infix', () => {
    expect(t('AND(Amount > 0, StageName == "X")')).toEqual({
      ok: true,
      formula: '(({amount} > 0) AND ({stage} = "X"))',
    });
    expect(t('NOT(ISBLANK(Name))')).toEqual({ ok: true, formula: 'NOT (ISBLANK({name}))' });
  });
  it('flags an unsupported function for review', () => {
    const r = t('GETSESSIONID()');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toContain('GETSESSIONID');
  });
});

describe('round trip: translated formula runs on the engine', () => {
  it('evaluates to the same intent against record data', () => {
    const r = t('IF(Amount >= 1000, Amount * 0.1, 0)');
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(evaluateFormula(r.formula, { amount: 1000 })).toBe(100);
      expect(evaluateFormula(r.formula, { amount: 500 })).toBe(0);
    }
  });
});
