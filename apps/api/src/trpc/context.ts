// tRPC context — built per-request. Carries the db client, optional session,
// and (when present) the resolved auth context with active org + role.

import type { AuthContext, Role } from '@northbeam/core';
import { type Database, type DbExecutor, createDb, schema } from '@northbeam/db';
import { and, eq } from 'drizzle-orm';
import { type Session, getSession } from '../auth/index.js';
import type { RecordAccess } from '../data/record-access.js';
import { env } from '../lib/env.js';
import { resolveGrants } from './permissions.js';

export type Context = {
  /** A query executor — root Database for publicProcedure, a transaction with
   *  `app.org_id` set for protectedProcedure (RLS gate). Always assignable to
   *  any helper that takes `DbExecutor` from `@northbeam/db`. */
  db: DbExecutor;
  session: Session | null;
  auth: AuthContext | null;
  /** Raw fetch request — useful for forwarding cookies to Better Auth wrappers. */
  req: Request;
  /** Post-commit hooks (e.g. flow-run enqueues). Procedures push closures
   *  here; protectedProcedure runs them AFTER its transaction commits and
   *  only when the procedure succeeded. protectedProcedure swaps in a fresh
   *  array per call — batched procedures share one Context, and a hook must
   *  never run against another batch member's uncommitted transaction. */
  postCommit: Array<() => Promise<void>>;
  /** Authorized record data access — the sanctioned path to read/write record
   *  data with the per-object CRUD gate + record ACL applied. Non-null only on
   *  protectedProcedure (needs ctx.auth + the RLS-scoped tx). */
  records: RecordAccess | null;
};

let cachedDb: Database | undefined;
function db(): Database {
  if (!cachedDb) cachedDb = createDb(env().DATABASE_URL);
  return cachedDb;
}

/** Expose the root Database for code paths that need to start their own
 *  transaction (e.g. org.create wrapping seedStandardObjects in withOrgContext
 *  after Better Auth creates the org). Inside a protectedProcedure handler,
 *  callers should prefer `ctx.db` so they reuse the RLS-scoped transaction. */
export function rootDb(): Database {
  return db();
}

export async function createContext({ req }: { req: Request }): Promise<Context> {
  const session = await getSession(req.headers);

  if (!session) {
    return { db: db(), session: null, auth: null, req, postCommit: [], records: null };
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
      return { db: db(), session, auth: null, req, postCommit: [], records: null };
    }
    activeOrganizationId = m.organizationId;
    role = m.role as Role;
  }

  if (!activeOrganizationId || !role) {
    return { db: db(), session, auth: null, req, postCommit: [], records: null };
  }

  // Resolve the role key into its org-action set + per-object CRUD grants
  // (custom roles are DB-backed; missing rows fall back to the static matrix).
  const permissions = await resolveGrants(db(), activeOrganizationId, role);

  return {
    db: db(),
    session,
    auth: {
      userId: session.user.id,
      userEmail: session.user.email,
      organizationId: activeOrganizationId,
      role,
      permissions,
    },
    req,
    postCommit: [],
    // protectedProcedure swaps in the tx-bound RecordAccess alongside auth.
    records: null,
  };
}
