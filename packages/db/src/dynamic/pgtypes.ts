// FieldType ⇄ Postgres mapping + value coercion for the native data model.

import type { FieldConfig, FieldType } from '../field-types.js';

/** Field types that are computed/non-writable (engine- or system-populated). */
export const COMPUTED: ReadonlySet<FieldType> = new Set<FieldType>([
  'formula',
  'rollup',
  'ai',
  'autonumber',
]);

/** Field types whose values are searchable text (for ILIKE search). */
export const TEXT_TYPES: ReadonlySet<FieldType> = new Set<FieldType>([
  'text',
  'textarea',
  'email',
  'phone',
  'url',
  'picklist',
]);

/** Postgres column type for a field. */
export function pgTypeFor(type: FieldType, _config: FieldConfig = {}): string {
  switch (type) {
    case 'number':
    case 'percent':
      return 'numeric';
    case 'currency':
      return 'numeric(18,2)';
    case 'autonumber':
      return 'bigint';
    case 'date':
      return 'date';
    case 'datetime':
      return 'timestamptz';
    case 'checkbox':
      return 'boolean';
    case 'multipicklist':
      return 'text[]';
    case 'reference':
      return 'uuid';
    default:
      // text, textarea, email, phone, url, picklist, formula, rollup, ai
      return 'text';
  }
}

/** Coerce an app value into the JS type Postgres expects for this column. */
export function toDb(type: FieldType, v: unknown): unknown {
  if (v === '' || v === undefined || v === null) return null;
  switch (type) {
    case 'number':
    case 'currency':
    case 'percent': {
      const n = typeof v === 'number' ? v : Number(String(v).replace(/[^0-9.-]/g, ''));
      return Number.isFinite(n) ? n : null;
    }
    case 'checkbox':
      return Boolean(v);
    case 'multipicklist':
      return Array.isArray(v) ? (v as unknown[]).map(String) : [String(v)];
    case 'reference':
      return String(v);
    default:
      return typeof v === 'string' ? v : String(v);
  }
}

/** Convert a Postgres value back to the app representation (e.g. numeric→number). */
export function fromDb(type: FieldType, v: unknown): unknown {
  if (v === null || v === undefined) return null;
  switch (type) {
    case 'number':
    case 'currency':
    case 'percent':
      return typeof v === 'string' ? Number(v) : v;
    case 'datetime':
      return v instanceof Date ? v.toISOString() : v;
    default:
      return v;
  }
}
