// Role + permission model for Northbeam orgs.
// ROLES + Role are owned by @northbeam/db (the column definitions are the
// source of truth for allowed values); we re-export them here so consumers can
// `import { ROLES, type Role } from '@northbeam/core'` and get the auth + policy
// surface in one place.
//
// Import via the `@northbeam/db/roles` subpath rather than the package barrel so
// web bundles that deep-import `@northbeam/core/roles` don't drag drizzle / pg
// into the client.

export { ROLES, type Role, isRole } from '@northbeam/db/roles';
import type { Role } from '@northbeam/db/roles';

// Hierarchy: a higher-ranked role implicitly satisfies lower-ranked checks.
const RANK: Record<Role, number> = {
  owner: 3,
  admin: 2,
  member: 1,
  viewer: 0,
};

export function rankOf(role: Role): number {
  return RANK[role];
}

/** True if `actual` is at least as privileged as `required`. */
export function meetsRole(actual: Role, required: Role): boolean {
  return RANK[actual] >= RANK[required];
}

export const PERMISSIONS = {
  // Org lifecycle
  'org.delete': 'owner',
  'org.transfer': 'owner',
  'org.billing.manage': 'owner',
  'org.settings.update': 'admin',
  // Membership
  'org.members.invite': 'admin',
  'org.members.remove': 'admin',
  'org.members.role': 'admin',
  // CRM records
  'contact.read': 'viewer',
  'contact.write': 'member',
  'contact.delete': 'admin',
  'account.read': 'viewer',
  'account.write': 'member',
  'account.delete': 'admin',
  'deal.read': 'viewer',
  'deal.write': 'member',
  'deal.delete': 'admin',
  // Migration (the one-click Salesforce import)
  'migration.run': 'admin',
  // API keys
  'apikey.personal.manage': 'viewer', // anyone can manage their own PATs
  'apikey.service.manage': 'admin', // service accounts are org-wide
} as const satisfies Record<string, Role>;

export type Permission = keyof typeof PERMISSIONS;

/** True if the role can perform the given action. */
export function can(role: Role, action: Permission): boolean {
  return meetsRole(role, PERMISSIONS[action]);
}
