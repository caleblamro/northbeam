// View model types. Standalone (no drizzle imports) so both the schema layer
// (packages/db/src/schema.ts) and the web app can pull from a single source.

import type { Role } from './roles.js';

/** Built-in view types. Only `list` is rendered today — kanban / calendar /
 *  grid / ai renderers were removed by request. AI generation is reachable
 *  via the ⌘K palette and never registers as a view type. */
export type ViewType = 'list';

/** Where a view can be shared. `shared_with` on the view row is an array of
 *  these — dynamic enough for org-wide, role-scoped, or direct-to-user shares
 *  without a schema change when teams/groups land later. */
export type ShareTarget =
  | { kind: 'org' }
  | { kind: 'role'; role: Role }
  | { kind: 'user'; userId: string };

/** A single sort instruction. Multi-key sort is just an array. */
export type ViewSort = {
  fieldKey: string;
  direction: 'asc' | 'desc';
};

/** Curated icon vocabulary for views. Keys are stored verbatim on the row;
 *  the web side maps them onto Lucide components in icons-views.ts. Adding
 *  a new icon is a one-line edit there. */
export type ViewIcon =
  | 'list'
  | 'pin'
  | 'star'
  | 'bookmark'
  | 'inbox'
  | 'folder'
  | 'briefcase'
  | 'flag'
  | 'eye'
  | 'heart'
  | 'building'
  | 'users'
  | 'dollar'
  | 'chart'
  | 'calendar'
  | 'clock';

/* ── Filter ─────────────────────────────────────────────────────────────────
   Filter shape that both the view storage layer and the web filter UI share.
   Keep this small + serializable so it fits cleanly into both a JSONB column
   and a URL search param. */
export type FilterOp =
  | 'eq'
  | 'neq'
  | 'contains'
  | 'startsWith'
  | 'endsWith'
  | 'gt'
  | 'lt'
  | 'gte'
  | 'lte'
  | 'before'
  | 'after'
  | 'isTrue'
  | 'isFalse'
  | 'isEmpty'
  | 'isSet';

export type FilterValue = string | number | boolean | null;

export type Filter = {
  fieldKey: string;
  op: FilterOp;
  value?: FilterValue;
};
