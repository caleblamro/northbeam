// View URL state. Owns the contract for what lives in `URLSearchParams`:
//   ?view=<id>       saved view to land on (overrides the object's default)
//   ?filters=<json>  transient filter overrides on top of the view
//   ?sort=<json>     transient sort overrides
//
// View type is not stored in the URL — the active view row already carries its
// type (`list` | `dashboard` | `report`, per ViewType in @northbeam/db/views).
// Switching views navigates via ?view=<id>, which the dispatcher resolves to
// the correct renderer; no separate ?type= param is needed.

import { readFiltersFromParams } from '@/lib/filters';
import type { Filter, ViewSort } from '@northbeam/db/views';

export function readViewIdFromParams(params: URLSearchParams): string | null {
  return params.get('view') || null;
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

/** Read the transient state from the URL — what the user has tweaked on
 *  top of the active view. The dispatcher applies these on top of the
 *  view's stored filters/sort. */
export function readTransientFromParams(params: URLSearchParams): {
  filters: Filter[];
  sort: ViewSort[];
} {
  return {
    filters: readFiltersFromParams(params),
    sort: readSortFromParams(params),
  };
}

export {
  readFiltersFromParams,
  writeFiltersToParams,
} from '@/lib/filters';
