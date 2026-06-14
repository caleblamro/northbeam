// FieldType ⇄ Postgres mapping + value coercion for the native data model.

import { type FieldConfig, type FieldType, parseDurationMinutes } from '../field-types.js';

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

/** Field types whose Postgres value is a JSON object/array (jsonb). */
export const JSON_TYPES: ReadonlySet<FieldType> = new Set<FieldType>(['address']);

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
    case 'duration':
      // Integer minutes. bigint covers durations beyond a human lifetime —
      // overkill for activities but cheap insurance for projects / SLAs.
      return 'bigint';
    case 'date':
      return 'date';
    case 'datetime':
      return 'timestamptz';
    case 'address':
      return 'jsonb';
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
      if (typeof v === 'number') return Number.isFinite(v) ? v : null;
      // Strip locale formatting (commas, $, %, spaces, …) before parsing. If
      // nothing numeric is left, treat as null rather than letting Number('')
      // silently coerce to 0 — a non-numeric input shouldn't become a real
      // value in the database.
      const stripped = String(v).replace(/[^0-9.-]/g, '');
      if (!stripped) return null;
      const n = Number(stripped);
      return Number.isFinite(n) ? n : null;
    }
    case 'checkbox':
      return Boolean(v);
    case 'multipicklist':
      return Array.isArray(v) ? (v as unknown[]).map(String) : [String(v)];
    case 'reference':
      return String(v);
    case 'duration': {
      // Accepts canonical minutes (number) or "1h3m" / "90m" / "2:30" text.
      if (typeof v === 'number') return Number.isFinite(v) ? Math.round(v) : null;
      const parsed = parseDurationMinutes(String(v));
      return parsed == null ? null : Math.round(parsed);
    }
    case 'address':
      // JSONB column — drizzle's pg driver accepts plain objects.
      if (typeof v === 'string') {
        try {
          return JSON.parse(v);
        } catch {
          return null;
        }
      }
      return typeof v === 'object' ? v : null;
    default:
      return typeof v === 'string' ? v : String(v);
  }
}

// Duration parser/formatter live in field-types.ts so the web app can reach
// them via the `@northbeam/db/field-types` subpath without dragging the
// dynamic layer (drizzle, pg) into the client bundle.
export { formatDurationMinutes, parseDurationMinutes } from '../field-types.js';

/** Convert a Postgres value back to the app representation (e.g. numeric→number). */
export function fromDb(type: FieldType, v: unknown): unknown {
  if (v === null || v === undefined) return null;
  switch (type) {
    case 'number':
    case 'currency':
    case 'percent':
      return typeof v === 'string' ? Number(v) : v;
    case 'duration':
      // bigint comes back as string from postgres-js — coerce.
      return typeof v === 'string' ? Number(v) : v;
    case 'datetime':
      return v instanceof Date ? v.toISOString() : v;
    default:
      return v;
  }
}
