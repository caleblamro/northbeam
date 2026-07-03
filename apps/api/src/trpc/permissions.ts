// Resolve a member's role KEY into a ResolvedPermissions bag (org-action set +
// per-object CRUD grants), reading the org's `role` + `object_permission` rows.
//
// Cached per (orgId, roleKey) with a short TTL so authorization doesn't cost two
// queries on every request. Role edits take effect within CACHE_TTL_MS —
// acceptable for a permissions surface that changes rarely. Reads use the root
// db inside a per-org GUC transaction so the RLS policies on `role` /
// `object_permission` apply (these are public-schema metadata tables).

import {
  type CrudGrant,
  type Permission,
  type ResolvedPermissions,
  resolveFromStatic,
  resolvePermissions,
} from '@northbeam/core';
import {
  type Database,
  getRoleByKey,
  listObjectPermissions,
  listObjectPermissionsWithKey,
  withOrgContext,
} from '@northbeam/db';

const CACHE_TTL_MS = 5_000;

type CacheEntry = { at: number; value: ResolvedPermissions };
const cache = new Map<string, CacheEntry>();

/** Drop cached grants for a role (or a whole org) after a permission edit, so
 *  the change is visible immediately instead of after the TTL. */
export function invalidatePermissions(orgId: string, roleKey?: string): void {
  if (roleKey) {
    cache.delete(`${orgId}:${roleKey}`);
    return;
  }
  for (const k of cache.keys()) if (k.startsWith(`${orgId}:`)) cache.delete(k);
}

export async function resolveGrants(
  db: Database,
  orgId: string,
  roleKey: string,
): Promise<ResolvedPermissions> {
  const cacheKey = `${orgId}:${roleKey}`;
  const hit = cache.get(cacheKey);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.value;

  const value = await withOrgContext(db, orgId, async (tx) => {
    const roleRow = await getRoleByKey(tx, orgId, roleKey);
    // No row yet (org not backfilled, or a stale custom key) → fall back to the
    // static matrix so authorization never silently opens up or breaks.
    if (!roleRow) return resolveFromStatic(roleKey);

    const overrides = await listObjectPermissions(tx, orgId, roleRow.id);
    const objectOverrides = new Map<string, CrudGrant>(
      overrides.map((o) => [
        o.objectId,
        { create: o.canCreate, read: o.canRead, update: o.canUpdate, delete: o.canDelete },
      ]),
    );
    return resolvePermissions({
      roleKey,
      // Stored as string[]; the values are Permission keys written by the role
      // editor (validated there against the catalog).
      orgPermissions: roleRow.orgPermissions as Permission[],
      defaultGrant: {
        create: roleRow.defaultCreate,
        read: roleRow.defaultRead,
        update: roleRow.defaultUpdate,
        delete: roleRow.defaultDelete,
      },
      objectOverrides,
    });
  });

  cache.set(cacheKey, { at: Date.now(), value });
  return value;
}

/** Client-facing grants for me.bootstrap: the same resolution but with object
 *  overrides keyed by objectKey (the client resolves by key, not id) and
 *  org actions as a plain array. Not cached — bootstrap runs once per load. */
export type ClientGrants = {
  isOwner: boolean;
  org: Permission[];
  objectDefault: CrudGrant;
  objectOverrides: Record<string, CrudGrant>;
};

export async function resolveClientGrants(
  db: Database,
  orgId: string,
  roleKey: string,
): Promise<ClientGrants> {
  return withOrgContext(db, orgId, async (tx) => {
    const roleRow = await getRoleByKey(tx, orgId, roleKey);
    if (!roleRow) {
      const stat = resolveFromStatic(roleKey);
      return {
        isOwner: stat.isOwner,
        org: [...stat.org],
        objectDefault: stat.objectDefault,
        objectOverrides: {},
      };
    }
    const overrides = await listObjectPermissionsWithKey(tx, orgId, roleRow.id);
    return {
      isOwner: roleKey === 'owner',
      org: roleRow.orgPermissions as Permission[],
      objectDefault: {
        create: roleRow.defaultCreate,
        read: roleRow.defaultRead,
        update: roleRow.defaultUpdate,
        delete: roleRow.defaultDelete,
      },
      objectOverrides: Object.fromEntries(overrides.map((o) => [o.objectKey, o.grant])),
    };
  });
}
