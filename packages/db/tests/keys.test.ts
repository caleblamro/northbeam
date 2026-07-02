// keyFromLabel is the only path from a human label to a metadata key, and the
// key feeds the physical identifiers (t_<key> / f_<key>) — a bad output here
// becomes a broken table or column name downstream.

import { describe, expect, it } from 'vitest';
import { KEY_RE, RESERVED_FIELD_KEYS, keyFromLabel } from '../src/keys.js';

describe('keyFromLabel', () => {
  it('snake_cases a plain label', () => {
    expect(keyFromLabel('Annual Revenue')).toBe('annual_revenue');
  });

  it('collapses punctuation runs and trims edge underscores', () => {
    expect(keyFromLabel('# of Employees!')).toBe('of_employees');
    expect(keyFromLabel('--Lease  End   Date--')).toBe('lease_end_date');
  });

  it('prefixes a leading digit with x', () => {
    expect(keyFromLabel('2024 Quota')).toBe('x2024_quota');
  });

  it('clamps to 48 chars without a trailing underscore', () => {
    const key = keyFromLabel(`${'a'.repeat(47)} tail`);
    expect(key.length).toBeLessThanOrEqual(48);
    expect(key.endsWith('_')).toBe(false);
  });

  it('falls back to "field" when nothing survives', () => {
    expect(keyFromLabel('')).toBe('field');
    expect(keyFromLabel('!!!')).toBe('field');
  });

  it('always emits a KEY_RE-valid key', () => {
    for (const label of ['Annual Revenue', '2024 Quota', '#!', 'ARR ($)', 'é è ü']) {
      expect(keyFromLabel(label)).toMatch(KEY_RE);
    }
  });
});

describe('KEY_RE', () => {
  it('accepts valid keys and rejects invalid ones', () => {
    expect(KEY_RE.test('amount')).toBe(true);
    expect(KEY_RE.test('lease_end_date')).toBe(true);
    expect(KEY_RE.test('_leading')).toBe(false);
    expect(KEY_RE.test('9lives')).toBe(false);
    expect(KEY_RE.test('Has-Caps')).toBe(false);
    expect(KEY_RE.test('')).toBe(false);
    expect(KEY_RE.test(`a${'b'.repeat(48)}`)).toBe(false);
  });
});

describe('RESERVED_FIELD_KEYS', () => {
  it('blocks the system columns but allows name', () => {
    for (const reserved of [
      'id',
      'owner_id',
      'record_type_id',
      'salesforce_id',
      'created_at',
      'updated_at',
      'created_by_id',
    ]) {
      expect(RESERVED_FIELD_KEYS.has(reserved)).toBe(true);
    }
    expect(RESERVED_FIELD_KEYS.has('name')).toBe(false);
  });
});
