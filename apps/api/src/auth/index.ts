// Public surface for the auth module. Callers import typed helpers from here.
// The underlying Better Auth instance lives in ./instance.ts and is module-
// private. See ./README.md for why.

export {
  cancelInvitation,
  createInvitation,
  createOrganization,
  deleteOrganization,
  getSession,
  handleAuthRequest,
  removeMember,
  setActiveOrganization,
  signInMagicLink,
  signOut,
  updateMemberRole,
  updateOrganization,
  type CreateInvitationInput,
  type CreateOrganizationInput,
  type InvitableRole,
  type Organization,
  type Session,
  type SessionRecord,
  type SessionUser,
  type SignInMagicLinkInput,
  type UpdateMemberRoleInput,
  type UpdateOrganizationInput,
} from './api.js';
