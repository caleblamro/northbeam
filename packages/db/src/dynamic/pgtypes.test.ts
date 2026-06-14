// pgTypeFor + toDb + fromDb are the boundary between the FieldType vocabulary
// and Postgres. A regression here corrupts data silently — numbers stored as
// text, dates parsed wrong, multipicklist values shoved into a single column.

import { describe, expect, it } from 'vitest';
import { COMPUTED, TEXT_TYPES, fromDb, pgTypeFor, toDb } from './pgtypes.js';

describe('pgTypeFor', () => {
  it('maps simple scalars correctly', () => {
    expect(pgTypeFor('text')).toBe('text');
    expect(pgTypeFor('textarea')).toBe('text');
    expect(pgTypeFor('email')).toBe('text');
    expect(pgTypeFor('phone')).toBe('text');
    expect(pgTypeFor('url')).toBe('text');
    expect(pgTypeFor('picklist')).toBe('text');
    expect(pgTypeFor('date')).toBe('date');
    expect(pgTypeFor('datetime')).toBe('timestamptz');
    expect(pgTypeFor('checkbox')).toBe('boolean');
    expect(pgTypeFor('reference')).toBe('uuid');
  });

  it('uses fixed-precision numeric for currency (18, 2)', () => {
    expect(pgTypeFor('currency')).toBe('numeric(18,2)');
  });

  it('uses generic numeric for number / percent', () => {
    expect(pgTypeFor('number')).toBe('numeric');
    expect(pgTypeFor('percent')).toBe('numeric');
  });

  it('stores multipicklist as a text[]', () => {
    expect(pgTypeFor('multipicklist')).toBe('text[]');
  });

  it('uses bigint for autonumber', () => {
    expect(pgTypeFor('autonumber')).toBe('bigint');
  });

  it('falls back to text for computed types (formula/rollup/ai)', () => {
    // No engine populates these yet, so the column type is just a placeholder.
    expect(pgTypeFor('formula')).toBe('text');
    expect(pgTypeFor('rollup')).toBe('text');
    expect(pgTypeFor('ai')).toBe('text');
  });
});

describe('toDb', () => {
  it('treats empty string, null, and undefined as SQL null', () => {
    expect(toDb('text', '')).toBeNull();
    expect(toDb('text', null)).toBeNull();
    expect(toDb('text', undefined)).toBeNull();
  });

  it('coerces numeric strings (with currency formatting) into numbers', () => {
    expect(toDb('number', '42')).toBe(42);
    expect(toDb('currency', '$1,234.56')).toBeCloseTo(1234.56);
    expect(toDb('percent', '12.5%')).toBeCloseTo(12.5);
  });

  it('returns null when a number coerces to NaN', () => {
    expect(toDb('number', 'not a number')).toBeNull();
    expect(toDb('currency', 'abc')).toBeNull();
  });

  it('coerces checkbox to a real boolean', () => {
    expect(toDb('checkbox', true)).toBe(true);
    expect(toDb('checkbox', 'yes')).toBe(true);
    expect(toDb('checkbox', 0)).toBe(false);
    // empty string already short-circuits to null above, so don't conflate.
  });

  it('wraps a single multipicklist value into an array', () => {
    expect(toDb('multipicklist', 'foo')).toEqual(['foo']);
    expect(toDb('multipicklist', ['a', 'b'])).toEqual(['a', 'b']);
  });

  it('keeps reference values as strings (uuid cast happens in records.ts)', () => {
    expect(toDb('reference', 'abc-123')).toBe('abc-123');
  });
});

describe('fromDb', () => {
  it('null passes through unchanged', () => {
    expect(fromDb('text', null)).toBeNull();
    expect(fromDb('number', null)).toBeNull();
  });

  it('parses numeric strings back to JS numbers', () => {
    expect(fromDb('number', '42.5')).toBe(42.5);
    expect(fromDb('currency', '1234.56')).toBeCloseTo(1234.56);
    expect(fromDb('percent', '12')).toBe(12);
  });

  it('serialises Date values from timestamptz columns to ISO strings', () => {
    const d = new Date('2024-01-15T10:30:00Z');
    expect(fromDb('datetime', d)).toBe(d.toISOString());
  });

  it('passes through non-Date datetime values unchanged', () => {
    expect(fromDb('datetime', '2024-01-15T10:30:00Z')).toBe('2024-01-15T10:30:00Z');
  });
});

describe('COMPUTED set', () => {
  it('flags exactly the four read-only types', () => {
    expect(COMPUTED.has('formula')).toBe(true);
    expect(COMPUTED.has('rollup')).toBe(true);
    expect(COMPUTED.has('ai')).toBe(true);
    expect(COMPUTED.has('autonumber')).toBe(true);
  });

  it('does not include any writable types', () => {
    for (const writable of ['text', 'number', 'currency', 'date', 'reference'] as const) {
      expect(COMPUTED.has(writable)).toBe(false);
    }
  });
});

describe('TEXT_TYPES set', () => {
  it('covers every type whose value is searchable text', () => {
    for (const t of ['text', 'textarea', 'email', 'phone', 'url', 'picklist'] as const) {
      expect(TEXT_TYPES.has(t)).toBe(true);
    }
  });

  it('does not include numeric / date / array / boolean / reference types', () => {
    for (const t of [
      'number',
      'currency',
      'percent',
      'date',
      'datetime',
      'checkbox',
      'multipicklist',
      'reference',
    ] as const) {
      expect(TEXT_TYPES.has(t)).toBe(false);
    }
  });
});
