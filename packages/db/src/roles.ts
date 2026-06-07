// The set of role values that the `member.role` / `invitation.role` columns
// accept. Lives in @northbeam/db because the database schema is the source of
// truth for what values can be stored — packages/core re-exports these to
// build its authorization policy (PERMISSIONS, can, meetsRole) on top.
//
// Adding a role here requires a migration: bump this tuple, then ensure the
// permission matrix in `@northbeam/core` covers it.

export const ROLES = ['owner', 'admin', 'member', 'viewer'] as const;
export type Role = (typeof ROLES)[number];

/** Type predicate — narrows a raw string from a DOM event or HTTP query. */
export function isRole(value: unknown): value is Role {
  return typeof value === 'string' && (ROLES as readonly string[]).includes(value);
}
