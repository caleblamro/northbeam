// View model types. Standalone (no drizzle imports) so both the schema layer
// (packages/db/src/schema.ts) and the web app can pull from a single source.
//
// The actual data shape — what's stored in the `view` row — is:
//   { type, config, filters, sort, columns, sharedWith, ownerId, isDefault, ... }
// Everything in this file is what the JSONB columns + the type enum reference.

import type { Role } from './roles.js';

/** Built-in view types. The renderer registry on the web side keys off this
 *  string. New types (board, gallery, timeline, ai, …) are added here and a
 *  matching registration in apps/web/src/lib/views/registry.ts. */
export type ViewType = 'list' | 'grid' | 'kanban' | 'calendar' | 'ai';

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

/* ── Filter ─────────────────────────────────────────────────────────────────
   Filter shape that both the view storage layer and the web filter UI share.
   Keep this small + serializable so it fits cleanly into both a JSONB column
   and a URL search param. The matcher and URL helpers live alongside the
   FilterBar component (apps/web/src/lib/filters.ts) — only the *type* lives
   here. */
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
