// Per-FieldType config validation. These schemas are the only thing standing
// between a user-supplied config blob and the JSONB column — if they accept
// invalid shapes, the resulting field is broken downstream (picklists with no
// options, references with no target, formulas with no expression).

import { describe, expect, it } from 'vitest';
import { safeValidateFieldConfig, validateFieldConfig } from '../src/field-config-schemas.js';

describe('text-family configs', () => {
  it('accepts empty / minimal configs', () => {
    expect(validateFieldConfig('text', {})).toEqual({});
    expect(validateFieldConfig('email', { placeholder: 'you@co' })).toEqual({
      placeholder: 'you@co',
    });
  });

  it('accepts maxLength + mask', () => {
    const cfg = { maxLength: 100, mask: '(999) 999-9999' };
    expect(validateFieldConfig('phone', cfg)).toEqual(cfg);
  });

  it('rejects negative maxLength', () => {
    expect(safeValidateFieldConfig('text', { maxLength: -1 }).ok).toBe(false);
  });
});

describe('currency config', () => {
  it('accepts a valid ISO 4217 code', () => {
    expect(validateFieldConfig('currency', { currencyCode: 'USD' })).toEqual({
      currencyCode: 'USD',
    });
  });

  it('rejects non-3-letter currency codes', () => {
    expect(safeValidateFieldConfig('currency', { currencyCode: 'DOLLARS' }).ok).toBe(false);
    expect(safeValidateFieldConfig('currency', { currencyCode: 'US' }).ok).toBe(false);
  });
});

describe('picklist config', () => {
  it('requires at least one option', () => {
    const result = safeValidateFieldConfig('picklist', { options: [] });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.issues.some((i) => i.message.includes('at least one option'))).toBe(true);
    }
  });

  it('accepts a valid options array', () => {
    const cfg = {
      options: [
        { value: 'a', label: 'A' },
        { value: 'b', label: 'B', color: '#f00' },
      ],
    };
    expect(validateFieldConfig('picklist', cfg)).toMatchObject(cfg);
  });

  it('rejects options with blank value or label', () => {
    expect(safeValidateFieldConfig('picklist', { options: [{ value: '', label: 'a' }] }).ok).toBe(
      false,
    );
    expect(safeValidateFieldConfig('picklist', { options: [{ value: 'a', label: '' }] }).ok).toBe(
      false,
    );
  });

  it('accepts a globalPicklistId instead of inline options', () => {
    const cfg = { globalPicklistId: '6f1e0f9a-9df1-4a63-9a3e-2f5b1c9d0e4a' };
    expect(validateFieldConfig('multipicklist', cfg)).toMatchObject(cfg);
  });

  it('rejects a config with neither options nor a globalPicklistId', () => {
    expect(safeValidateFieldConfig('picklist', {}).ok).toBe(false);
  });

  it('rejects a config with both options and a globalPicklistId', () => {
    expect(
      safeValidateFieldConfig('picklist', {
        options: [{ value: 'a', label: 'A' }],
        globalPicklistId: '6f1e0f9a-9df1-4a63-9a3e-2f5b1c9d0e4a',
      }).ok,
    ).toBe(false);
  });

  it('rejects a non-uuid globalPicklistId', () => {
    expect(safeValidateFieldConfig('picklist', { globalPicklistId: 'deal-stages' }).ok).toBe(false);
  });
});

describe('reference config', () => {
  it('requires targetObject', () => {
    expect(safeValidateFieldConfig('reference', {}).ok).toBe(false);
    expect(safeValidateFieldConfig('reference', { targetObject: '' }).ok).toBe(false);
  });

  it('accepts a valid lookup config', () => {
    const cfg = { targetObject: 'account', relationshipName: 'contacts', onDelete: 'setNull' };
    expect(validateFieldConfig('reference', cfg)).toMatchObject(cfg);
  });

  it('rejects an invalid onDelete', () => {
    expect(
      safeValidateFieldConfig('reference', { targetObject: 'a', onDelete: 'detonate' }).ok,
    ).toBe(false);
  });
});

describe('computed type configs', () => {
  it('formula requires a valid expression that the engine can parse', () => {
    expect(safeValidateFieldConfig('formula', {}).ok).toBe(false);
    // Bare "a + b" is now rejected — `a` and `b` would be bare identifiers
    // (the engine requires {a} for a field reference).
    expect(safeValidateFieldConfig('formula', { formula: 'a + b' }).ok).toBe(false);
    expect(
      validateFieldConfig('formula', {
        formula: '{a} + {b}',
        returnType: 'number',
      }),
    ).toMatchObject({ formula: '{a} + {b}' });
  });

  it('rollup requires the descriptor', () => {
    expect(safeValidateFieldConfig('rollup', {}).ok).toBe(false);
    const cfg = {
      rollup: { childObject: 'deal', via: 'account', childField: 'amount', fn: 'sum' as const },
    };
    expect(validateFieldConfig('rollup', cfg)).toMatchObject(cfg);
  });

  it('rollup requires `via` (the child lookup field)', () => {
    expect(
      safeValidateFieldConfig('rollup', {
        rollup: { childObject: 'deal', childField: 'amount', fn: 'sum' },
      }).ok,
    ).toBe(false);
  });

  it('rollup count does not require a childField', () => {
    expect(
      safeValidateFieldConfig('rollup', {
        rollup: { childObject: 'deal', via: 'account', fn: 'count' },
      }).ok,
    ).toBe(true);
  });

  it('rollup rejects an unknown aggregation fn', () => {
    expect(
      safeValidateFieldConfig('rollup', {
        rollup: { childObject: 'deal', childField: 'amount', fn: 'mode' },
      }).ok,
    ).toBe(false);
  });

  it('ai requires an aiPrompt', () => {
    expect(safeValidateFieldConfig('ai', {}).ok).toBe(false);
    expect(validateFieldConfig('ai', { aiPrompt: 'Summarise the description.' })).toMatchObject({
      aiPrompt: 'Summarise the description.',
    });
  });
});
