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
  // Data model — the single gate for all schema editing: objects, fields,
  // record types, global picklist sets, validation rules, format rules.
  'object.manage': 'admin',
  // Migration (the one-click Salesforce import)
  'migration.run': 'admin',
  // API keys
  'apikey.personal.manage': 'viewer', // anyone can manage their own PATs
  'apikey.service.manage': 'admin', // service accounts are org-wide
  // Saved views — read for anyone with record access, write for editors.
  'view.read': 'viewer',
  'view.write': 'member',
} as const satisfies Record<string, Role>;

export type Permission = keyof typeof PERMISSIONS;

/** True if the role can perform the given action. */
export function can(role: Role, action: Permission): boolean {
  return meetsRole(role, PERMISSIONS[action]);
}

// Labels + grouping for permissions — drives the Setup → Permissions matrix
// editor. Keep colocated with PERMISSIONS so any new action has exactly one
// place to be declared.
export type PermissionEntry = { key: Permission; label: string; description?: string };
export type PermissionGroup = { id: string; label: string; permissions: PermissionEntry[] };

export const PERMISSION_GROUPS: PermissionGroup[] = [
  {
    id: 'org',
    label: 'Workspace',
    permissions: [
      {
        key: 'org.settings.update',
        label: 'Update workspace settings',
        description: 'Edit org name, slug, and logo.',
      },
      {
        key: 'org.delete',
        label: 'Delete workspace',
        description: 'Permanently delete this org and all of its data.',
      },
      {
        key: 'org.transfer',
        label: 'Transfer ownership',
        description: 'Hand ownership of the workspace to another member.',
      },
      {
        key: 'org.billing.manage',
        label: 'Manage billing',
        description: 'Plans, payment methods, and invoices.',
      },
    ],
  },
  {
    id: 'members',
    label: 'Members',
    permissions: [
      { key: 'org.members.invite', label: 'Invite members' },
      { key: 'org.members.remove', label: 'Remove members' },
      { key: 'org.members.role', label: 'Change member roles' },
    ],
  },
  {
    id: 'records',
    label: 'Records',
    permissions: [
      { key: 'contact.read', label: 'Read contacts' },
      { key: 'contact.write', label: 'Create / edit contacts' },
      { key: 'contact.delete', label: 'Delete contacts' },
      { key: 'account.read', label: 'Read accounts' },
      { key: 'account.write', label: 'Create / edit accounts' },
      { key: 'account.delete', label: 'Delete accounts' },
      { key: 'deal.read', label: 'Read deals' },
      { key: 'deal.write', label: 'Create / edit deals' },
      { key: 'deal.delete', label: 'Delete deals' },
    ],
  },
  {
    id: 'schema',
    label: 'Data model',
    permissions: [
      {
        key: 'object.manage',
        label: 'Manage the data model',
        description:
          'Create and edit objects, fields, record types, picklist sets, and validation / format rules.',
      },
    ],
  },
  {
    id: 'migration',
    label: 'Migration',
    permissions: [
      {
        key: 'migration.run',
        label: 'Run Salesforce migration',
        description: 'Map and import Salesforce data into this workspace.',
      },
    ],
  },
  {
    id: 'apikey',
    label: 'API Keys',
    permissions: [
      {
        key: 'apikey.personal.manage',
        label: 'Manage personal API keys',
        description: 'Personal access tokens scoped to the caller.',
      },
      {
        key: 'apikey.service.manage',
        label: 'Manage workspace API keys',
        description: 'Service-account tokens scoped to the workspace.',
      },
    ],
  },
  {
    id: 'views',
    label: 'Saved views',
    permissions: [
      {
        key: 'view.read',
        label: 'See saved views',
        description: 'Read the views shared in the workspace.',
      },
      {
        key: 'view.write',
        label: 'Create / edit saved views',
        description: 'Save personal views or update shared ones the caller owns.',
      },
    ],
  },
];

export const ROLE_LABELS: Record<Role, string> = {
  owner: 'Owner',
  admin: 'Admin',
  member: 'Member',
  viewer: 'Viewer',
};

export const ROLE_DESCRIPTIONS: Record<Role, string> = {
  owner: 'Full access. Exactly one per workspace. Can transfer ownership and delete the workspace.',
  admin: 'Manage members, settings, and all records. Cannot delete the workspace.',
  member: 'Create and edit records. Cannot delete records or manage members.',
  viewer: 'Read-only access to records. Useful for stakeholders and auditors.',
};
