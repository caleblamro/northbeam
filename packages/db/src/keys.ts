// Metadata key derivation + guards for user-created objects and fields.
// A key is the API name stored on object_def.key / field_def.key — the
// physical identifiers (t_<key> / f_<key>) derive from it via identifiers.ts.
// keyFromLabel is the same spirit as sfToKey (apps/api/src/salesforce/mapper.ts)
// and sanitize (dynamic/identifiers.ts): the output always matches KEY_RE.

import { SYS } from './dynamic/identifiers.js';

/** Valid metadata key: starts with a letter, then [a-z0-9_], ≤48 chars. */
export const KEY_RE = /^[a-z][a-z0-9_]{0,47}$/;

/** System columns a field key may never shadow. `name` is deliberately NOT
 *  reserved — the seed already uses field key `name` for the primary label
 *  field (the f_ column prefix keeps the physical names apart regardless). */
export const RESERVED_FIELD_KEYS: ReadonlySet<string> = new Set(
  Object.values(SYS).filter((column) => column !== SYS.name),
);

/** Derive a KEY_RE-safe key from a human label:
 *    'Annual Revenue'  → 'annual_revenue'
 *    '# of Employees!' → 'of_employees'
 *    '2024 Quota'      → 'x2024_quota'
 *  Falls back to 'field' when nothing usable survives. */
export function keyFromLabel(label: string): string {
  let key = (label || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '');
  if (/^[0-9]/.test(key)) key = `x${key}`;
  key = key.slice(0, 48).replace(/_+$/, '');
  return key || 'field';
}
