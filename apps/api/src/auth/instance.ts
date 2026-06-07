// Internal Better Auth construction. Module-private — every caller in the app
// goes through the hand-typed wrappers in ./api.ts. See ./README.md.
//
// Do NOT import `auth` from outside this directory. If you need an auth method
// that isn't exposed yet, add a wrapper to ./api.ts.

import { createDb, schema } from '@northbeam/db';
import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { magicLink, organization } from 'better-auth/plugins';
import { defaultAc, defaultRoles } from 'better-auth/plugins/organization/access';
import { send } from '../email/index.js';
import { env } from '../lib/env.js';

// 'viewer' is a Northbeam-specific read-only role on top of Better Auth's
// owner/admin/member. Declaring it here widens the role union on
// updateMemberRole / createInvitation so callers can pass `viewer`.
// Authorization for Northbeam permissions still flows through @northbeam/core's
// PERMISSIONS map — this AC role only matters for BA's own org/member/invitation
// hooks, which viewers don't get to perform.
const viewerAc = defaultAc.newRole({
  organization: [],
  member: [],
  invitation: [],
  team: [],
});

const e = env();
const db = createDb(e.DATABASE_URL);

export const auth = betterAuth({
  baseURL: e.BETTER_AUTH_URL,
  secret: e.BETTER_AUTH_SECRET,
  trustedOrigins: [e.PUBLIC_WEB_URL],
  database: drizzleAdapter(db, {
    provider: 'pg',
    schema: {
      user: schema.user,
      session: schema.session,
      account: schema.account,
      verification: schema.verification,
      organization: schema.organization,
      member: schema.member,
      invitation: schema.invitation,
    },
  }),
  // No password sign-in at v1 — magic link only.
  emailAndPassword: { enabled: false },
  socialProviders:
    e.GITHUB_APP_CLIENT_ID && e.GITHUB_APP_CLIENT_SECRET
      ? {
          github: {
            clientId: e.GITHUB_APP_CLIENT_ID,
            clientSecret: e.GITHUB_APP_CLIENT_SECRET,
          },
        }
      : undefined,
  plugins: [
    magicLink({
      sendMagicLink: ({ email, url }: { email: string; url: string }) =>
        send(email, 'magic-link', { email, url }),
      expiresIn: 60 * 10, // 10 minutes
    }),
    organization({
      allowUserToCreateOrganization: true,
      organizationLimit: 5,
      roles: { ...defaultRoles, viewer: viewerAc },
    }),
  ],
});
