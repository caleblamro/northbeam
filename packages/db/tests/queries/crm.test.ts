// displayName + sanitizeData are pure and frequently called. displayName is
// the function whose output the user sees as the title of every record; a bug
// here is immediately visible. sanitizeData gates what the API will write to
// JSONB — if it lets a computed-field key through, the dynamic record layer
// would write to a column it isn't supposed to.

import { describe, expect, it } from 'vitest';
import type { FieldRow } from '../../src/queries/crm.js';
import { displayName, sanitizeData } from '../../src/queries/crm.js';

function field(overrides: Partial<FieldRow>): FieldRow {
  // Minimal FieldRow stub — only the keys displayName/sanitizeData read.
  return {
    id: 'f1',
    organizationId: 'org_test',
    objectId: 'o1',
    key: overrides.key ?? 'name',
    columnName: overrides.columnName ?? 'f_name',
    pgType: overrides.pgType ?? 'text',
    indexed: false,
    label: overrides.label ?? 'Name',
    type: overrides.type ?? 'text',
    config: overrides.config ?? {},
    required: false,
    unique: false,
    isSystem: false,
    source: 'system',
    orderIndex: 0,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  } as FieldRow;
}

describe('displayName', () => {
  const fields = [field({ key: 'name' }), field({ key: 'first_name' }), field({ key: 'last_name' })];

  it('uses the nameExpression when provided', () => {
    const data = { first_name: 'Ada', last_name: 'Lovelace' };
    expect(displayName(fields, data, 'first_name|last_name')).toBe('Ada Lovelace');
  });

  it('joins the nameExpression parts with a single space, skipping missing keys', () => {
    expect(displayName(fields, { first_name: 'Ada' }, 'first_name|last_name')).toBe('Ada');
    expect(displayName(fields, { last_name: 'Lovelace' }, 'first_name|last_name')).toBe('Lovelace');
  });

  it('handles a single-key nameExpression', () => {
    expect(displayName([field({ key: 'subject' })], { subject: 'Hello' }, 'subject')).toBe('Hello');
  });

  it('falls back to conventional defaults when nameExpression is empty', () => {
    expect(displayName(fields, { name: 'Acme' })).toBe('Acme');
    expect(displayName([field({ key: 'subject' })], { subject: 'Subj' })).toBe('Subj');
    expect(displayName([field({ key: 'title' })], { title: 'CEO' })).toBe('CEO');
  });

  it('falls back to first_name + last_name when name/subject/title missing', () => {
    expect(displayName(fields, { first_name: 'Ada', last_name: 'Lovelace' })).toBe('Ada Lovelace');
    expect(displayName(fields, { first_name: 'Ada' })).toBe('Ada');
    expect(displayName(fields, { last_name: 'Lovelace' })).toBe('Lovelace');
  });

  it('falls back to the first text field when nothing else matches', () => {
    const f = [field({ key: 'description', type: 'text' })];
    expect(displayName(f, { description: 'something' })).toBe('something');
  });

  it('returns Untitled as a last resort', () => {
    expect(displayName([], {})).toBe('Untitled');
    expect(displayName(fields, {})).toBe('Untitled');
  });

  it('coerces non-string values to string', () => {
    expect(displayName([field({ key: 'name' })], { name: 42 })).toBe('42');
  });
});

describe('sanitizeData', () => {
  const fields = [
    field({ key: 'name', type: 'text' }),
    field({ key: 'amount', type: 'currency' }),
    field({ key: 'total_revenue', type: 'rollup' }),
    field({ key: 'arr_formula', type: 'formula' }),
    field({ key: 'ai_summary', type: 'ai' }),
    field({ key: 'record_no', type: 'autonumber' }),
  ];

  it('keeps writable field keys', () => {
    const out = sanitizeData(fields, { name: 'Acme', amount: 1000 });
    expect(out).toEqual({ name: 'Acme', amount: 1000 });
  });

  it('drops all computed (read-only) field keys', () => {
    const out = sanitizeData(fields, {
      name: 'Acme',
      total_revenue: 999_999, // rollup — never accept user input
      arr_formula: '5 * 12', // formula — never accept user input
      ai_summary: 'Sneaky', // ai — never accept user input
      record_no: 1, // autonumber — never accept user input
    });
    expect(out).toEqual({ name: 'Acme' });
  });

  it('drops keys that do not correspond to any field on the object', () => {
    const out = sanitizeData(fields, { name: 'Acme', mystery_key: 'value' });
    expect(out).toEqual({ name: 'Acme' });
  });

  it('returns an empty object for empty input', () => {
    expect(sanitizeData(fields, {})).toEqual({});
  });
});
