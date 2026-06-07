import { NorthbeamError } from './errors.js';
import { type Permission, type Role, can } from './roles.js';

/**
 * Canonical "who is calling this request" shape. Resolved by the API's session
 * middleware (apps/api/src/middleware/session.ts) and the tRPC context
 * (apps/api/src/trpc/context.ts) — both import this type so the shape lives in
 * exactly one place.
 */
export type AuthContext = {
  userId: string;
  userEmail: string;
  organizationId: string;
  role: Role;
};

/**
 * Authorization chokepoint. Throws a typed NorthbeamError that the API layer
 * maps to an HTTP 403. Use everywhere a permission check is needed — never roll
 * your own role comparison.
 */
export function requires(ctx: AuthContext, action: Permission): void {
  if (!can(ctx.role, action)) {
    throw new NorthbeamError('forbidden', `role '${ctx.role}' cannot perform '${action}'`, {
      action,
      role: ctx.role,
    });
  }
}

/** Soft check — returns boolean, never throws. For UI gating. */
export function may(ctx: AuthContext, action: Permission): boolean {
  return can(ctx.role, action);
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
