// Dependency ordering for computed fields. topoOrder is the "most robust" piece
// — it must evaluate a formula after the computed fields it reads (formula-on-
// formula, formula-on-rollup) in a single pass, and reject circular references.

import { describe, expect, it } from 'vitest';
import { ComputeError, topoOrder } from '../../src/compute/recompute.js';
import type { FieldRow } from '../../src/queries/crm.js';

// Minimal field-like objects — topoOrder only reads key/type/config.
const field = (key: string, type: string, config: unknown): FieldRow =>
  ({ key, type, config }) as unknown as FieldRow;

describe('topoOrder', () => {
  it('orders a formula after the formula it depends on', () => {
    const order = topoOrder([
      field('total', 'formula', { formula: '{subtotal} + {tax}' }),
      field('subtotal', 'formula', { formula: '{price} * {qty}' }),
    ]).map((f) => f.key);
    expect(order.indexOf('subtotal')).toBeLessThan(order.indexOf('total'));
  });

  it('orders a formula after the rollup it reads', () => {
    const order = topoOrder([
      field('has_children', 'formula', { formula: '{child_count} > 0' }),
      field('child_count', 'rollup', {
        rollup: { childObject: 'deal', via: 'account', fn: 'count' },
      }),
    ]).map((f) => f.key);
    expect(order.indexOf('child_count')).toBeLessThan(order.indexOf('has_children'));
  });

  it('ignores cross-object and plain-data refs when building edges', () => {
    // {account.name} (cross-object) and {amount} (plain field) are not computed
    // fields on this object, so they create no ordering constraint.
    const order = topoOrder([
      field('label', 'formula', { formula: '{account.name} & TEXT({amount})' }),
    ]).map((f) => f.key);
    expect(order).toEqual(['label']);
  });

  it('throws ComputeError on a circular reference', () => {
    expect(() =>
      topoOrder([
        field('a', 'formula', { formula: '{b} + 1' }),
        field('b', 'formula', { formula: '{a} + 1' }),
      ]),
    ).toThrow(ComputeError);
  });
});
