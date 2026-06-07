// /trpc/me — single round-trip "who am I" payload for the dashboard.
import { type Role, schema } from '@northbeam/db';
import { eq } from 'drizzle-orm';
import { publicProcedure, router } from '../trpc.js';

type Identity = { userId: string; email: string; name: string | null };
type OrgMembership = { id: string; name: string; slug: string; role: Role };
const NO_ORGS: ReadonlyArray<OrgMembership> = [];

export const meRouter = router({
  /**
   * One call answers everything the dashboard needs to render auth state: who
   * is signed in, which org is active, and what orgs they belong to. Returns
   * `null`-ish (session: null) for unauthenticated callers so the same hook
   * drives both signed-out and signed-in paths.
   */
  bootstrap: publicProcedure.query(async ({ ctx }) => {
    const identity: Identity | null = ctx.session
      ? {
          userId: ctx.session.user.id,
          email: ctx.session.user.email,
          name: ctx.session.user.name,
        }
      : null;

    if (!identity) {
      return { session: null, activeOrg: null, organizations: NO_ORGS };
    }

    const activeOrgId = ctx.session?.session.activeOrganizationId ?? null;

    const organizations = await ctx.db
      .select({
        id: schema.organization.id,
        name: schema.organization.name,
        slug: schema.organization.slug,
        role: schema.member.role,
      })
      .from(schema.member)
      .innerJoin(schema.organization, eq(schema.organization.id, schema.member.organizationId))
      .where(eq(schema.member.userId, identity.userId));

    // Fresh sessions come with activeOrganizationId=null even when the user
    // already has memberships. Auto-pick their first org so the dashboard
    // doesn't bounce them to /create-org despite already belonging to one.
    const resolvedActiveOrgId = activeOrgId ?? organizations[0]?.id ?? null;
    const activeOrg = resolvedActiveOrgId
      ? (organizations.find((o) => o.id === resolvedActiveOrgId) ?? null)
      : null;

    return { session: identity, activeOrg, organizations };
  }),
});
