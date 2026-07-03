// Client-side permission gating. Reads the caller's resolved permissions for
// the active org from me.bootstrap — the server sends an org-action set plus
// per-object CRUD grants (custom roles are DB-backed, so there's no static
// role→permission map to mirror). This is UX only; the API's permissionProcedure
// / per-object gates remain authoritative.

import { trpc } from '@/lib/api';
import type { ObjectAction, Permission, Role } from '@northbeam/core/roles';

/** The caller's role KEY on the active org (a system key or a custom slug), or
 *  null before bootstrap resolves. */
export function useCurrentRole(): Role | null {
  const boot = trpc.me.bootstrap.useQuery();
  const role = boot.data?.activeOrg?.role;
  return (role as Role | undefined) ?? null;
}

/** Resolved grants for the active org, or null while bootstrap loads / signed
 *  out. Affordances stay hidden until this is known — the safer default. */
function usePermissions() {
  const boot = trpc.me.bootstrap.useQuery();
  return boot.data?.activeOrg?.permissions ?? null;
}

/** True when the caller's role holds an ORG-level action (settings, members,
 *  object.manage, migration.run, view.*, org.roles.manage, …). */
export function useCan(action: Permission): boolean {
  const p = usePermissions();
  if (!p) return false;
  return p.isOwner || p.org.includes(action);
}

/** True when the caller's role grants `action` (create/read/update/delete) on
 *  the given object — an objectPermission override, else the role default. */
export function useCanObject(objectKey: string, action: ObjectAction): boolean {
  const p = usePermissions();
  if (!p) return false;
  if (p.isOwner) return true;
  const grant = p.objectOverrides[objectKey] ?? p.objectDefault;
  return grant[action];
}

/** A stable org-action checker for data-driven gating (e.g. filtering a nav
 *  list) where calling the useCan hook per item isn't possible. */
export function useCanCheck(): (action: Permission) => boolean {
  const p = usePermissions();
  return (action: Permission) => (p ? p.isOwner || p.org.includes(action) : false);
}
