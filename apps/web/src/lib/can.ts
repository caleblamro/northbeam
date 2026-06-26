// useCan(action) — client-side permission check for UI gating. Mirrors the
// server-side `can(role, action)` from @northbeam/core/roles using the
// caller's role from me.bootstrap.activeOrg.role.
//
// This is for hiding / disabling affordances the user can't actually use.
// Server-side enforcement (permissionProcedure) is still authoritative — the
// hook is UX, not security.

import { trpc } from '@/lib/api';
import { type Permission, type Role, can } from '@northbeam/core/roles';

/** Returns the caller's role on the active org, or null when there's no
 *  active session / org yet (initial render, /sign-in, etc.). */
export function useCurrentRole(): Role | null {
  const boot = trpc.me.bootstrap.useQuery();
  const role = boot.data?.activeOrg?.role;
  return (role as Role | undefined) ?? null;
}

/** True when the current user's role permits `action`. Returns false while
 *  bootstrap is still loading — affordances stay hidden until we know the
 *  role for sure, which is the safer default. */
export function useCan(action: Permission): boolean {
  const role = useCurrentRole();
  if (!role) return false;
  return can(role, action);
}
