// Session middleware. Attaches { session } always, and { auth } on protected
// routes (resolving the active org + the caller's role within it).

import type { AuthContext } from '@northbeam/core';
import { createDb, schema } from '@northbeam/db';
import { and, eq } from 'drizzle-orm';
import { createMiddleware } from 'hono/factory';
import { type Session, getSession } from '../auth/index.js';
import { env } from '../lib/env.js';
import { resolveGrants } from '../trpc/permissions.js';

const db = createDb(env().DATABASE_URL);

export type Variables = {
  /** Set only on routes that require authentication. */
  auth: AuthContext;
  /** Raw Better Auth session. Available whenever a valid cookie/header is sent. */
  session: Session;
};

/** Attach session if present, but don't require it. */
export const sessionMiddleware = createMiddleware<{ Variables: Variables }>(async (c, next) => {
  const session = await getSession(c.req.raw.headers);
  if (session) c.set('session', session);
  await next();
});

/**
 * Require an authenticated session. Resolves the active org (from session,
 * falling back to the caller's first membership) and looks up their role.
 * 401 if no session, 403 if the caller belongs to no org.
 */
export const requireAuth = createMiddleware<{ Variables: Variables }>(async (c, next) => {
  const session = c.get('session');
  if (!session) return c.json({ error: 'unauthorized' }, 401);

  let activeOrganizationId: string | null = session.session.activeOrganizationId ?? null;
  let role: AuthContext['role'] | null = null;

  if (activeOrganizationId) {
    const [m] = await db
      .select({ role: schema.member.role })
      .from(schema.member)
      .where(
        and(
          eq(schema.member.userId, session.user.id),
          eq(schema.member.organizationId, activeOrganizationId),
        ),
      )
      .limit(1);
    role = (m?.role as AuthContext['role'] | undefined) ?? null;
  }

  if (!role) {
    const [m] = await db
      .select({ organizationId: schema.member.organizationId, role: schema.member.role })
      .from(schema.member)
      .where(eq(schema.member.userId, session.user.id))
      .limit(1);
    if (!m) {
      return c.json({ error: 'forbidden', message: 'caller is not a member of any org' }, 403);
    }
    activeOrganizationId = m.organizationId;
    role = m.role as AuthContext['role'];
  }

  if (!activeOrganizationId || !role) return c.json({ error: 'forbidden' }, 403);

  const permissions = await resolveGrants(db, activeOrganizationId, role);

  c.set('auth', {
    userId: session.user.id,
    userEmail: session.user.email,
    organizationId: activeOrganizationId,
    role,
    permissions,
  });
  await next();
});
