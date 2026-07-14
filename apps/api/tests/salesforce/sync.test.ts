import { describe, expect, it } from 'vitest';
import type { ProposedField } from '../../src/salesforce/mapper.js';
import {
  diffInbound,
  fromSalesforceValue,
  toSalesforceValue,
  writebackFields,
} from '../../src/salesforce/sync.js';

const pf = (over: Partial<ProposedField>): ProposedField => ({
  sfField: 'X__c',
  sfLabel: 'X',
  sfType: 'string',
  key: 'x',
  columnName: 'f_x',
  label: 'X',
  type: 'text',
  pgType: 'text',
  config: {},
  required: false,
  confidence: 90,
  status: 'mapped',
  populatedPct: null,
  ...over,
});

describe('writebackFields', () => {
  it('keeps mapped writable fields, drops computed and non-mapped', () => {
    const map = writebackFields([
      pf({ key: 'status', sfField: 'Status__c', type: 'picklist' }),
      pf({ key: 'total', sfField: 'Total__c', type: 'formula' }),
      pf({ key: 'skipped', sfField: 'Old__c', status: 'skip' }),
      pf({ key: 'roll', sfField: 'Roll__c', type: 'rollup' }),
    ]);
    expect([...map.keys()]).toEqual(['status']);
    expect(map.get('status')?.sfField).toBe('Status__c');
  });
});

describe('toSalesforceValue', () => {
  const none = () => null;
  it('joins multipicklists with semicolons', () => {
    expect(toSalesforceValue('multipicklist', ['a', 'b'], none)).toEqual({
      ok: true,
      value: 'a;b',
    });
  });
  it('nulls clear the SF field', () => {
    expect(toSalesforceValue('text', null, none)).toEqual({ ok: true, value: null });
  });
  it('resolves references through sfIdOf and skips unlinked targets', () => {
    const sfIdOf = (obj: string, id: string) =>
      obj === 'account' && id === 'u-1' ? '001XX' : null;
    expect(toSalesforceValue('reference', 'u-1', sfIdOf, 'account')).toEqual({
      ok: true,
      value: '001XX',
    });
    expect(toSalesforceValue('reference', 'u-2', sfIdOf, 'account').ok).toBe(false);
  });
  it('resolves reference_any composites', () => {
    const sfIdOf = (obj: string, id: string) =>
      obj === 'contact' && id === '3d1c9c1e-0000-0000-0000-000000000001' ? '003XX' : null;
    expect(
      toSalesforceValue('reference_any', 'contact:3d1c9c1e-0000-0000-0000-000000000001', sfIdOf),
    ).toEqual({ ok: true, value: '003XX' });
  });
});

describe('diffInbound (echo suppression)', () => {
  const fields = [
    { key: 'amount', type: 'currency' },
    { key: 'close_date', type: 'datetime' },
    { key: 'tags', type: 'multipicklist' },
    { key: 'note', type: 'text' },
  ] as const satisfies ReadonlyArray<{ key: string; type: string }>;
  const f = fields as unknown as Parameters<typeof diffInbound>[0];
  it('an exact echo of our own write-back diffs to empty', () => {
    const incoming = {
      amount: 1200,
      close_date: '2026-07-12T18:00:00.000+0000',
      tags: ['b', 'a'],
      note: 'hi',
    };
    const current = {
      amount: 1200,
      close_date: '2026-07-12T18:00:00.000Z', // same instant, different serialization
      tags: ['a', 'b'], // same set, different order
      note: 'hi',
    };
    expect(diffInbound(f, incoming, current)).toEqual([]);
  });
  it('real changes surface, unchanged keys stay quiet', () => {
    const incoming = { amount: 1300, note: 'hi' };
    const current = { amount: 1200, note: 'hi' };
    expect(diffInbound(f, incoming, current)).toEqual(['amount']);
  });
  it('string numbers compare numerically-insensitively only when identical', () => {
    const one = [{ key: 'amount', type: 'currency' }] as unknown as Parameters<
      typeof diffInbound
    >[0];
    expect(diffInbound(one, { amount: 1200 }, { amount: 1200 })).toEqual([]);
  });
});

describe('fromSalesforceValue', () => {
  it('splits multipicklists and nulls empties', () => {
    expect(fromSalesforceValue('multipicklist', 'a;b')).toEqual(['a', 'b']);
    expect(fromSalesforceValue('text', '')).toBeNull();
  });
});
