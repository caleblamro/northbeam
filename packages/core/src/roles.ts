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
import { ROLES, type Role } from '@northbeam/db/roles';
import type { FilterEntry } from '@northbeam/db/views';

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
  // Roles & permissions — create/edit custom roles and the per-object CRUD grid.
  'org.roles.manage': 'admin',
  // AI agents — create/edit agent presets (prompt, models, tools, roles).
  'ai.agents.manage': 'admin',
  // CRM records — SF-style granular layer for the standard objects. Custom and
  // imported objects fall back to the generic record.* keys below until the
  // planned objectPermission table (per-org, per-object, per-role rows plus SF
  // permission import) lands.
  'contact.read': 'viewer',
  'contact.write': 'member',
  'contact.delete': 'admin',
  'account.read': 'viewer',
  'account.write': 'member',
  'account.delete': 'admin',
  'deal.read': 'viewer',
  'deal.write': 'member',
  'deal.delete': 'admin',
  // Generic fallback for objects without object-specific permissions.
  'record.read': 'viewer',
  'record.write': 'member',
  'record.delete': 'admin',
  // Data model — the single gate for all schema editing: objects, fields,
  // record types, global picklist sets, validation rules, format rules.
  'object.manage': 'admin',
  // Migration (the one-click Salesforce import)
  'migration.run': 'admin',
  // Automation — build, activate, and pause flows; inspect run history.
  'automation.manage': 'admin',
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

// Objects with a per-object permission set declared above. Resolution MUST go
// through this whitelist rather than probing PERMISSIONS at large: object keys
// are user/import controlled (e.g. Salesforce `View__c` imports as `view`), and
// a bare `${objectKey}.${verb}` lookup would collide with non-record permissions
// like 'org.delete' or 'view.write'. Revisit when the objectPermission table
// (keyed by object id, not key) lands.
const RECORD_PERMISSION_OBJECTS: ReadonlySet<string> = new Set(['contact', 'account', 'deal']);

/** Resolve the permission gating a record verb for a given object: the
 *  per-object key (`contact.write`) when one is declared, else the generic
 *  fallback (`record.write`). */
export function recordPermissionFor(
  objectKey: string,
  verb: 'read' | 'write' | 'delete',
): Permission {
  return RECORD_PERMISSION_OBJECTS.has(objectKey)
    ? (`${objectKey}.${verb}` as Permission)
    : `record.${verb}`;
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
      {
        key: 'org.roles.manage',
        label: 'Manage roles & permissions',
        description: 'Create custom roles and edit the per-object permission grid.',
      },
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
      {
        key: 'record.read',
        label: 'Read records',
        description: 'Default for objects without object-specific permissions.',
      },
      {
        key: 'record.write',
        label: 'Create / edit records',
        description: 'Default for objects without object-specific permissions.',
      },
      {
        key: 'record.delete',
        label: 'Delete records',
        description: 'Default for objects without object-specific permissions.',
      },
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
    id: 'automation',
    label: 'Automation',
    permissions: [
      {
        key: 'automation.manage',
        label: 'Manage automations',
        description: 'Build, activate, and pause flows; inspect run history.',
      },
    ],
  },
  {
    id: 'ai',
    label: 'AI',
    permissions: [
      {
        key: 'ai.agents.manage',
        label: 'Manage AI agents',
        description: 'Create and edit agent presets: prompt, models, tools, and role access.',
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

/* ────────────────────────────────────────────────────────────────────────────
   PER-OBJECT CRUD MODEL — Directus-style custom roles.

   Two axes of authorization now coexist:
     1. Org-level actions — the non-record Permission keys (settings, members,
        object.manage, migration.run, view.*, apikey.*, org.roles.manage).
        Stored on a role as an explicit set of granted keys.
     2. Per-object CRUD — create/read/update/delete on each object, resolved
        from a role's default grant plus per-object overrides (objectPermission
        rows). Replaces the coarse record.* / <object>.<verb> keys, which now
        exist only to SEED the four system roles from this file's static matrix.

   `Role` (the 4 system keys) is still the compile-time type for the built-ins,
   but a member's stored role is really a role KEY (string) that may name a
   custom org role. Resolution turns a key into a ResolvedPermissions bag.
   ──────────────────────────────────────────────────────────────────────── */

/** The four verbs of the per-object grid. */
export type ObjectAction = 'create' | 'read' | 'update' | 'delete';
export const OBJECT_ACTIONS: readonly ObjectAction[] = ['create', 'read', 'update', 'delete'];

/** A create/read/update/delete grant for one object (or a role's default). */
export type CrudGrant = { create: boolean; read: boolean; update: boolean; delete: boolean };
export const NO_CRUD: CrudGrant = { create: false, read: false, update: false, delete: false };
export const FULL_CRUD: CrudGrant = { create: true, read: true, update: true, delete: true };
export const READ_ONLY_CRUD: CrudGrant = {
  create: false,
  read: true,
  update: false,
  delete: false,
};

/** Record verb → CRUD axis. `write` covers both create and update at the call
 *  sites that predate the split (record.create / record.update handlers). */
export function objectActionFor(
  verb: 'read' | 'create' | 'write' | 'update' | 'delete',
): ObjectAction {
  if (verb === 'write') return 'update';
  return verb;
}

/** Permission keys that gate RECORD operations — superseded by the CRUD grid,
 *  kept only to seed the system roles. Everything else in PERMISSIONS is an
 *  org-level action a role can be granted. */
function isRecordPermission(key: Permission): boolean {
  return (
    key.startsWith('record.') ||
    key.startsWith('contact.') ||
    key.startsWith('account.') ||
    key.startsWith('deal.')
  );
}

/** The org-level (non-record) actions a role can hold. Drives both the role
 *  editor's org-permission toggles and seeding. */
export const ORG_PERMISSION_KEYS: readonly Permission[] = (
  Object.keys(PERMISSIONS) as Permission[]
).filter((k) => !isRecordPermission(k));

/** A per-object override: the CRUD grant plus an optional row-level (criteria)
 *  filter that scopes WHICH records of the object the role can touch. */
export type ObjectGrant = CrudGrant & { filter?: FilterEntry[] | null };

/** A role, resolved for authorization: its org-action set plus the object CRUD
 *  it can perform (a default grant + per-object overrides). Keyed by objectId
 *  server-side, by objectKey on the client — the map key is opaque here. */
export type ResolvedPermissions = {
  roleKey: string;
  /** Owner short-circuits every check — full access, always. */
  isOwner: boolean;
  org: ReadonlySet<Permission>;
  objectDefault: CrudGrant;
  objectOverrides: ReadonlyMap<string, ObjectGrant>;
};

/** Org-action check against a resolved role. */
export function canOrg(resolved: ResolvedPermissions, action: Permission): boolean {
  return resolved.isOwner || resolved.org.has(action);
}

/** Per-object CRUD check against a resolved role. `objectRef` is an objectId
 *  server-side or an objectKey client-side — whichever the overrides map uses.
 *  This is the yes/no gate; the row-level criteria filter (which records) is
 *  applied separately in SQL by RecordAccess — see `objectFilter`. */
export function canObject(
  resolved: ResolvedPermissions,
  objectRef: string,
  action: ObjectAction,
): boolean {
  if (resolved.isOwner) return true;
  const grant = resolved.objectOverrides.get(objectRef) ?? resolved.objectDefault;
  return grant[action];
}

/** The role's row-level (criteria) filter for an object, or null when the role
 *  has no per-object scope there (owner and default grants are unscoped). The
 *  facade compiles this into the ACL predicate so the role only touches
 *  matching records. */
export function objectFilter(
  resolved: ResolvedPermissions,
  objectRef: string,
): FilterEntry[] | null {
  if (resolved.isOwner) return null;
  return resolved.objectOverrides.get(objectRef)?.filter ?? null;
}

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

/** Static shape of a system role, computed once from the PERMISSIONS matrix so
 *  seeding a fresh org reproduces exactly today's rank-based behavior. Declared
 *  after ROLE_LABELS/ROLE_DESCRIPTIONS since it reads them. */
export type RoleSeed = {
  key: Role;
  name: string;
  description: string;
  rank: number;
  orgPermissions: Permission[];
  defaultGrant: CrudGrant;
};

/** The four built-in roles, derived from the static matrix. Seeded per-org into
 *  the `role` table on org create + backfilled for existing orgs. `owner` is
 *  granted everything and is additionally short-circuited at resolution time. */
export const SYSTEM_ROLE_SEEDS: readonly RoleSeed[] = ROLES.map((role) => ({
  key: role,
  name: ROLE_LABELS[role],
  description: ROLE_DESCRIPTIONS[role],
  rank: rankOf(role),
  orgPermissions: ORG_PERMISSION_KEYS.filter((k) => can(role, k)),
  defaultGrant: {
    create: can(role, 'record.write'),
    read: can(role, 'record.read'),
    update: can(role, 'record.write'),
    delete: can(role, 'record.delete'),
  },
}));

/** Stored system-role permission sets are snapshots taken at seed time, so a
 *  key added to PERMISSIONS later (e.g. 'automation.manage') would be missing
 *  forever in orgs seeded before it existed. Union the stored set with the
 *  current static seed at resolution time — the locked alternative to a
 *  backfill. Consequence: a seed-granted key cannot be revoked from a system
 *  role (use a custom role for that). Custom role keys pass through
 *  unchanged. */
export function withSystemSeedPermissions(
  roleKey: string,
  stored: readonly Permission[],
): Permission[] {
  const seed = SYSTEM_ROLE_SEEDS.find((s) => s.key === roleKey);
  if (!seed) return [...stored];
  return [...new Set([...stored, ...seed.orgPermissions])];
}

/** Build a ResolvedPermissions bag from a role's stored shape + object
 *  overrides. Shared by the API context (keyed by objectId) and me.bootstrap
 *  (re-keyed to objectKey for the client). Pure — no I/O. System-role
 *  permission sets are unioned with the static seed (see
 *  withSystemSeedPermissions). */
export function resolvePermissions(input: {
  roleKey: string;
  orgPermissions: Permission[];
  defaultGrant: CrudGrant;
  objectOverrides: ReadonlyMap<string, ObjectGrant>;
}): ResolvedPermissions {
  return {
    roleKey: input.roleKey,
    isOwner: input.roleKey === 'owner',
    org: new Set(withSystemSeedPermissions(input.roleKey, input.orgPermissions)),
    objectDefault: input.defaultGrant,
    objectOverrides: input.objectOverrides,
  };
}

/** Fallback resolution when no `role` row exists yet for a key (e.g. an org not
 *  yet backfilled). Reproduces the static matrix so authorization never breaks
 *  before seeding runs. Custom keys with no row resolve to no access. */
export function resolveFromStatic(roleKey: string): ResolvedPermissions {
  const seed = SYSTEM_ROLE_SEEDS.find((s) => s.key === roleKey);
  if (!seed) {
    return {
      roleKey,
      isOwner: false,
      org: new Set(),
      objectDefault: NO_CRUD,
      objectOverrides: new Map(),
    };
  }
  return resolvePermissions({
    roleKey,
    orgPermissions: seed.orgPermissions,
    defaultGrant: seed.defaultGrant,
    objectOverrides: new Map(),
  });
}
