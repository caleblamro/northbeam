// Hand-typed wrappers around the Better Auth server API.
//
// We expose narrow contracts for the auth.api.* methods we actually call so
// callers (routers, middleware) don't import the underlying Better Auth
// instance and reason about its inferred types. Stable signatures here mean a
// Better Auth upgrade doesn't ripple through every call site.

import { auth as betterAuth } from './instance.js';

const api = betterAuth.api;

/* ── Sessions ────────────────────────────────────────────────────────────── */

export type Session = NonNullable<Awaited<ReturnType<typeof api.getSession>>>;
export type SessionUser = Session['user'];
export type SessionRecord = Session['session'];

export async function getSession(headers: Headers): Promise<Session | null> {
  const result = await api.getSession({ headers });
  return result ?? null;
}

export async function signOut(headers: Headers): Promise<void> {
  await api.signOut({ headers });
}

/* ── Magic link ──────────────────────────────────────────────────────────── */

export type SignInMagicLinkInput = {
  email: string;
  callbackURL: string;
};

export async function signInMagicLink(
  input: SignInMagicLinkInput,
  headers: Headers,
): Promise<void> {
  await api.signInMagicLink({ body: input, headers });
}

/* ── Organizations ───────────────────────────────────────────────────────── */

export type CreateOrganizationInput = {
  name: string;
  slug: string;
};

export type Organization = {
  id: string;
  name: string;
  slug: string;
};

export async function createOrganization(
  input: CreateOrganizationInput,
  headers: Headers,
): Promise<Organization | null> {
  const result = await api.createOrganization({ body: input, headers });
  if (!result) return null;
  return { id: result.id, name: result.name, slug: result.slug };
}

export async function setActiveOrganization(
  organizationId: string,
  headers: Headers,
): Promise<void> {
  await api.setActiveOrganization({ body: { organizationId }, headers });
}

export type UpdateOrganizationInput = {
  organizationId: string;
  data: { name?: string; slug?: string; logo?: string };
};

export async function updateOrganization(
  input: UpdateOrganizationInput,
  headers: Headers,
): Promise<void> {
  await api.updateOrganization({ body: input, headers });
}

export async function deleteOrganization(organizationId: string, headers: Headers): Promise<void> {
  await api.deleteOrganization({ body: { organizationId }, headers });
}

/* ── Members + invitations ───────────────────────────────────────────────── */

// All four are invitable — `viewer` is registered with BA's org plugin via the
// `roles` option in ./instance.ts.
export type InvitableRole = 'owner' | 'admin' | 'member' | 'viewer';

export type CreateInvitationInput = {
  organizationId: string;
  email: string;
  role: InvitableRole;
};

export async function createInvitation(
  input: CreateInvitationInput,
  headers: Headers,
): Promise<void> {
  await api.createInvitation({ body: input, headers });
}

export async function cancelInvitation(invitationId: string, headers: Headers): Promise<void> {
  await api.cancelInvitation({ body: { invitationId }, headers });
}

export type UpdateMemberRoleInput = {
  organizationId: string;
  memberId: string;
  role: InvitableRole;
};

export async function updateMemberRole(
  input: UpdateMemberRoleInput,
  headers: Headers,
): Promise<void> {
  await api.updateMemberRole({ body: input, headers });
}

export async function removeMember(
  input: { organizationId: string; memberIdOrEmail: string },
  headers: Headers,
): Promise<void> {
  await api.removeMember({ body: input, headers });
}

/* ── Raw fetch handler (Better Auth's HTTP entry point) ──────────────────── */

export function handleAuthRequest(req: Request): Promise<Response> {
  return betterAuth.handler(req);
}
