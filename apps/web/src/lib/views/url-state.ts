// View URL state. Owns the contract for what lives in `URLSearchParams`:
//   ?view=<id>       saved view to land on (overrides the object's default)
//   ?type=<type>     built-in type with the type's defaultConfig (transient)
//   ?filters=<json>  transient filter overrides on top of the view
//   ?sort=<json>     transient sort overrides
//
// The "carry filters + sort, reset columns" rule (per product decision)
// lives here too: when type changes, columns key is cleared from the URL so
// the renderer can fall back to its defaultColumns(fields).

import {
  readFiltersFromParams,
  writeFiltersToParams,
} from '@/lib/filters';
import type { Filter, ViewSort, ViewType } from '@northbeam/db/views';

const VIEW_TYPES: ViewType[] = ['list', 'grid', 'kanban', 'calendar', 'ai'];

export function readViewIdFromParams(params: URLSearchParams): string | null {
  return params.get('view') || null;
}

export function readTypeFromParams(params: URLSearchParams): ViewType | null {
  const raw = params.get('type');
  return raw && (VIEW_TYPES as string[]).includes(raw) ? (raw as ViewType) : null;
}

export function readSortFromParams(params: URLSearchParams): ViewSort[] {
  const raw = params.get('sort');
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (s): s is ViewSort =>
        typeof s === 'object' &&
        s !== null &&
        typeof s.fieldKey === 'string' &&
        (s.direction === 'asc' || s.direction === 'desc'),
    );
  } catch {
    return [];
  }
}

export function writeSortToParams(params: URLSearchParams, sort: ViewSort[]): void {
  if (sort.length === 0) params.delete('sort');
  else params.set('sort', JSON.stringify(sort));
}

/** Patch params for a view-type switch: keep filters + sort, drop the
 *  `columns` key (renderer falls back to its defaultColumns), and persist the
 *  new type. Does NOT mutate `params` — returns a new instance. */
export function applyTypeSwitchToParams(
  params: URLSearchParams,
  next: ViewType,
): URLSearchParams {
  const out = new URLSearchParams(params.toString());
  out.set('type', next);
  out.delete('columns');
  return out;
}

/** Pull the full transient state from the URL — what the user has tweaked
 *  on top of the active view. The dispatcher applies these on top of the
 *  view's stored filters/sort. */
export function readTransientFromParams(params: URLSearchParams): {
  filters: Filter[];
  sort: ViewSort[];
  type: ViewType | null;
} {
  return {
    filters: readFiltersFromParams(params),
    sort: readSortFromParams(params),
    type: readTypeFromParams(params),
  };
}

export {
  readFiltersFromParams,
  writeFiltersToParams,
} from '@/lib/filters';
