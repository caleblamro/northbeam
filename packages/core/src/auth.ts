import { NorthbeamError } from './errors.js';
import {
  type ObjectAction,
  type Permission,
  type ResolvedPermissions,
  type Role,
  canObject,
  canOrg,
} from './roles.js';

/**
 * Canonical "who is calling this request" shape. Resolved by the API's session
 * middleware (apps/api/src/middleware/session.ts) and the tRPC context
 * (apps/api/src/trpc/context.ts) — both import this type so the shape lives in
 * exactly one place.
 *
 * `role` is the caller's role KEY (a system key or a custom role's slug).
 * `permissions` is that role resolved into its org-action set + per-object CRUD
 * grants (custom roles are DB-backed; see @northbeam/core resolvePermissions).
 */
export type AuthContext = {
  userId: string;
  userEmail: string;
  organizationId: string;
  role: Role;
  permissions: ResolvedPermissions;
};

/**
 * Org-action authorization chokepoint. Throws a typed NorthbeamError that the
 * API layer maps to an HTTP 403. Use everywhere an org-level permission check
 * is needed — never roll your own role comparison.
 */
export function requires(ctx: AuthContext, action: Permission): void {
  if (!canOrg(ctx.permissions, action)) {
    throw new NorthbeamError('forbidden', `role '${ctx.role}' cannot perform '${action}'`, {
      action,
      role: ctx.role,
    });
  }
}

/** Soft org-action check — returns boolean, never throws. For UI gating. */
export function may(ctx: AuthContext, action: Permission): boolean {
  return canOrg(ctx.permissions, action);
}

/** Per-object CRUD chokepoint. `objectId` is the object being acted on. */
export function requiresObject(ctx: AuthContext, objectId: string, action: ObjectAction): void {
  if (!canObject(ctx.permissions, objectId, action)) {
    throw new NorthbeamError(
      'forbidden',
      `role '${ctx.role}' cannot ${action} records of this object`,
      { objectId, action, role: ctx.role },
    );
  }
}

/** Soft per-object check — returns boolean. */
export function mayObject(ctx: AuthContext, objectId: string, action: ObjectAction): boolean {
  return canObject(ctx.permissions, objectId, action);
}

/** Asserts an auth context is present. Use at the top of any handler that requires login. */
export function requireSession<T extends AuthContext | undefined>(
  ctx: T,
): asserts ctx is NonNullable<T> {
  if (!ctx) throw new NorthbeamError('unauthorized', 'authentication required');
}

/** Asserts the caller belongs to the given organization. */
export function requireOrg(ctx: AuthContext, organizationId: string): void {
  if (ctx.organizationId !== organizationId) {
    throw new NorthbeamError('forbidden', 'caller is not a member of this organization', {
      callerOrg: ctx.organizationId,
      requestedOrg: organizationId,
    });
  }
}
