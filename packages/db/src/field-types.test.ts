// FieldType registry tests — the registry is the single source of truth for
// what types exist, which ones are pickable, and how SF maps in. A regression
// here changes what users can create and what migrations produce.

import { describe, expect, it } from 'vitest';
import {
  FIELD_TYPES,
  FIELD_TYPE_IDS,
  PICKABLE_FIELD_TYPES,
  type FieldType,
  fieldTypeMeta,
  isFieldTypeAvailable,
  mapSalesforceType,
  narrowFieldConfig,
} from './field-types.js';

describe('FIELD_TYPES registry', () => {
  it('includes every type the dynamic SQL layer knows about', () => {
    const expected: FieldType[] = [
      'text',
      'textarea',
      'email',
      'phone',
      'url',
      'number',
      'currency',
      'percent',
      'autonumber',
      'date',
      'datetime',
      'duration',
      'checkbox',
      'picklist',
      'multipicklist',
      'reference',
      'address',
      'formula',
      'rollup',
      'ai',
    ];
    expect(FIELD_TYPE_IDS).toEqual(expected);
  });

  it('has no duplicate ids', () => {
    const ids = FIELD_TYPES.map((f) => f.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe('PICKABLE_FIELD_TYPES', () => {
  it('excludes the inert compute types until the compute engine ships', () => {
    const ids = PICKABLE_FIELD_TYPES.map((f) => f.id);
    expect(ids).not.toContain('formula');
    expect(ids).not.toContain('rollup');
    expect(ids).not.toContain('ai');
    expect(ids).not.toContain('autonumber');
  });

  it('still includes every supported writable type', () => {
    const ids = PICKABLE_FIELD_TYPES.map((f) => f.id);
    for (const writable of ['text', 'number', 'currency', 'date', 'reference', 'picklist']) {
      expect(ids).toContain(writable);
    }
  });
});

describe('isFieldTypeAvailable', () => {
  it('returns false for the inert compute types', () => {
    expect(isFieldTypeAvailable('formula')).toBe(false);
    expect(isFieldTypeAvailable('rollup')).toBe(false);
    expect(isFieldTypeAvailable('ai')).toBe(false);
    expect(isFieldTypeAvailable('autonumber')).toBe(false);
  });

  it('returns true for every supported type', () => {
    expect(isFieldTypeAvailable('text')).toBe(true);
    expect(isFieldTypeAvailable('currency')).toBe(true);
    expect(isFieldTypeAvailable('reference')).toBe(true);
  });
});

describe('fieldTypeMeta', () => {
  it('returns the meta entry for a known type', () => {
    const meta = fieldTypeMeta('currency');
    expect(meta.id).toBe('currency');
    expect(meta.group).toBe('Number');
    expect(meta.storage).toBe('number');
  });
});

describe('mapSalesforceType', () => {
  it('returns confident match for known SF types', () => {
    expect(mapSalesforceType('string')).toEqual({ type: 'text', confident: true });
    expect(mapSalesforceType('currency')).toEqual({ type: 'currency', confident: true });
    expect(mapSalesforceType('reference')).toEqual({ type: 'reference', confident: true });
    expect(mapSalesforceType('picklist')).toEqual({ type: 'picklist', confident: true });
  });

  it('falls back to text with confident=false on unknown', () => {
    expect(mapSalesforceType('quantumWidget')).toEqual({ type: 'text', confident: false });
  });

  it('is case-insensitive on SF type input', () => {
    expect(mapSalesforceType('STRING')).toEqual({ type: 'text', confident: true });
    expect(mapSalesforceType('DateTime')).toEqual({ type: 'datetime', confident: true });
  });
});

describe('narrowFieldConfig', () => {
  it('returns an empty object when given null or undefined', () => {
    expect(narrowFieldConfig('text', null)).toEqual({});
    expect(narrowFieldConfig('text', undefined)).toEqual({});
  });

  it('passes the config through structurally (no validation)', () => {
    const cfg = { options: [{ value: 'a', label: 'A' }] };
    expect(narrowFieldConfig('picklist', cfg)).toBe(cfg);
  });
});
