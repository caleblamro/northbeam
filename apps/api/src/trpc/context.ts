// tRPC context — built per-request. Carries the db client, optional session,
// and (when present) the resolved auth context with active org + role.

import type { AuthContext, Role } from '@northbeam/core';
import { type Database, createDb, schema } from '@northbeam/db';
import { and, eq } from 'drizzle-orm';
import { type Session, getSession } from '../auth/index.js';
import { env } from '../lib/env.js';

export type Context = {
  db: Database;
  session: Session | null;
  auth: AuthContext | null;
  /** Raw fetch request — useful for forwarding cookies to Better Auth wrappers. */
  req: Request;
};

let cachedDb: Database | undefined;
function db(): Database {
  if (!cachedDb) cachedDb = createDb(env().DATABASE_URL);
  return cachedDb;
}

export async function createContext({ req }: { req: Request }): Promise<Context> {
  const session = await getSession(req.headers);

  if (!session) {
    return { db: db(), session: null, auth: null, req };
  }

  // Fresh sessions (post-magic-link) come with activeOrganizationId=null even
  // when the user has memberships. Fall back to their first one so a signed-in
  // user with at least one org never sees "no_active_org". Mirrors the
  // auto-pick in trpc.me.bootstrap — keep these two in sync.
  let activeOrganizationId: string | null = session.session.activeOrganizationId ?? null;
  let role: Role | null = null;

  if (activeOrganizationId) {
    const [m] = await db()
      .select({ role: schema.member.role })
      .from(schema.member)
      .where(
        and(
          eq(schema.member.userId, session.user.id),
          eq(schema.member.organizationId, activeOrganizationId),
        ),
      )
      .limit(1);
    role = (m?.role as Role | undefined) ?? null;
  }

  if (!role) {
    const [m] = await db()
      .select({ organizationId: schema.member.organizationId, role: schema.member.role })
      .from(schema.member)
      .where(eq(schema.member.userId, session.user.id))
      .limit(1);
    if (!m) {
      return { db: db(), session, auth: null, req };
    }
    activeOrganizationId = m.organizationId;
    role = m.role as Role;
  }

  if (!activeOrganizationId || !role) {
    return { db: db(), session, auth: null, req };
  }

  return {
    db: db(),
    session,
    auth: {
      userId: session.user.id,
      userEmail: session.user.email,
      organizationId: activeOrganizationId,
      role,
    },
    req,
  };
}
