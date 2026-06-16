// Layout resolution. The default-default is `objectDef.layout` (JSONB on the
// object). Per-(recordType, audience) overrides live in `layout_def`, with
// the resolver picking the most specific match.

import { and, eq, isNull, or } from 'drizzle-orm';
import type { DbExecutor } from '../client.js';
import type { ObjectLayout } from '../field-types.js';
import { layoutDef, objectDef } from '../schema.js';

export type LayoutRow = typeof layoutDef.$inferSelect;

/** Resolve the layout for a request. Picks the most-specific layoutDef row
 *  matching the given (recordType, audience), falling back to objectDef.layout
 *  when no row matches. The match priority is:
 *
 *    (recordTypeId, audience) > (recordTypeId, *) > (*, audience) > (*, *)
 *
 *  Within a tier the row with `is_default=true` wins; if multiple defaults
 *  exist, the newest one does.
 *
 *  Returns the resolved ObjectLayout plus the source so callers can present
 *  "Custom layout" vs "Default" in the UI. */
export async function resolveLayout(
  db: DbExecutor,
  opts: {
    orgId: string;
    objectId: string;
    recordTypeId?: string | null;
    audience?: string | null;
  },
): Promise<{ layout: ObjectLayout; source: 'default' | LayoutRow }> {
  const { orgId, objectId, recordTypeId = null, audience = null } = opts;

  // Pull every candidate row in one query — small table, simple where, faster
  // than four round-trips for the four match tiers.
  const candidates = await db
    .select()
    .from(layoutDef)
    .where(
      and(
        eq(layoutDef.organizationId, orgId),
        eq(layoutDef.objectId, objectId),
        or(
          isNull(layoutDef.recordTypeId),
          recordTypeId ? eq(layoutDef.recordTypeId, recordTypeId) : isNull(layoutDef.recordTypeId),
        ),
        or(
          isNull(layoutDef.audience),
          audience ? eq(layoutDef.audience, audience) : isNull(layoutDef.audience),
        ),
      ),
    );

  // Score each row by specificity. Higher = better match.
  const score = (row: LayoutRow): number => {
    let s = 0;
    if (row.recordTypeId && row.recordTypeId === recordTypeId) s += 2;
    if (row.audience && row.audience === audience) s += 1;
    if (row.isDefault) s += 0.5;
    return s;
  };

  const best = candidates
    .slice()
    .sort((a, b) => {
      const ds = score(b) - score(a);
      if (ds !== 0) return ds;
      // Tiebreak: newest wins.
      return b.createdAt.getTime() - a.createdAt.getTime();
    })[0];

  if (best) {
    return { layout: best.layout, source: best };
  }

  // Fall back to objectDef.layout — the default-default.
  const [obj] = await db
    .select({ layout: objectDef.layout })
    .from(objectDef)
    .where(and(eq(objectDef.organizationId, orgId), eq(objectDef.id, objectId)))
    .limit(1);
  return { layout: obj?.layout ?? {}, source: 'default' };
}

/** List every layout override for an object — used by the layout editor UI. */
export async function listLayouts(
  db: DbExecutor,
  orgId: string,
  objectId: string,
): Promise<LayoutRow[]> {
  return db
    .select()
    .from(layoutDef)
    .where(and(eq(layoutDef.organizationId, orgId), eq(layoutDef.objectId, objectId)));
}
