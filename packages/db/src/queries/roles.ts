// Roles & per-object permissions — CRUD over the `role` + `object_permission`
// tables. The permission POLICY (which org actions exist, how system roles are
// computed) lives in @northbeam/core; this module is pure storage. All queries
// are org-scoped: `role`/`object_permission` are public-schema metadata, so
// every statement filters by organizationId (RLS backstops it — see client.ts).

import { and, eq, sql } from 'drizzle-orm';
import type { DbExecutor } from '../client.js';
import type { Role } from '../roles.js';
import * as schema from '../schema.js';
import type { FilterEntry } from '../views.js';

// member.role is column-typed to the 4 system keys but may hold a custom role
// key (it's a text column). Cast comparison values so the query builder accepts
// arbitrary keys — the DB comparison is plain text = text.
const asRoleKey = (k: string) => k as Role;

export type RoleRow = typeof schema.role.$inferSelect;
export type ObjectPermissionRow = typeof schema.objectPermission.$inferSelect;

/** CRUD grant — mirrors @northbeam/core's CrudGrant without importing it (db
 *  must not depend on core). */
export type Crud = { create: boolean; read: boolean; update: boolean; delete: boolean };

/** Shape the API passes when seeding system roles or creating a custom one. */
export type RoleSeedInput = {
  key: string;
  name: string;
  description: string;
  rank: number;
  isSystem: boolean;
  color?: string | null;
  orgPermissions: string[];
  defaultGrant: Crud;
};

function toColumns(orgId: string, seed: RoleSeedInput) {
  return {
    organizationId: orgId,
    key: seed.key,
    name: seed.name,
    description: seed.description,
    color: seed.color ?? null,
    isSystem: seed.isSystem,
    rank: seed.rank,
    orgPermissions: seed.orgPermissions,
    defaultCreate: seed.defaultGrant.create,
    defaultRead: seed.defaultGrant.read,
    defaultUpdate: seed.defaultGrant.update,
    defaultDelete: seed.defaultGrant.delete,
  };
}

/** Idempotently seed a set of roles (the 4 system roles on org create, or a
 *  backfill). Existing (org, key) rows are left untouched. */
export async function seedRoles(
  db: DbExecutor,
  orgId: string,
  seeds: readonly RoleSeedInput[],
): Promise<void> {
  if (seeds.length === 0) return;
  await db
    .insert(schema.role)
    .values(seeds.map((s) => toColumns(orgId, s)))
    .onConflictDoNothing({ target: [schema.role.organizationId, schema.role.key] });
}

/** All roles for an org, with a live member count per role, ordered by rank
 *  desc (owner first) then name. */
export async function listRoles(db: DbExecutor, orgId: string) {
  return db
    .select({
      id: schema.role.id,
      key: schema.role.key,
      name: schema.role.name,
      description: schema.role.description,
      color: schema.role.color,
      isSystem: schema.role.isSystem,
      rank: schema.role.rank,
      orgPermissions: schema.role.orgPermissions,
      defaultCreate: schema.role.defaultCreate,
      defaultRead: schema.role.defaultRead,
      defaultUpdate: schema.role.defaultUpdate,
      defaultDelete: schema.role.defaultDelete,
      memberCount: sql<number>`(
        select count(*)::int from ${schema.member}
        where ${schema.member.organizationId} = ${orgId}
          and ${schema.member.role} = ${schema.role.key}
      )`,
    })
    .from(schema.role)
    .where(eq(schema.role.organizationId, orgId))
    .orderBy(sql`${schema.role.rank} desc`, schema.role.name);
}

export async function getRoleById(db: DbExecutor, orgId: string, id: string) {
  const [row] = await db
    .select()
    .from(schema.role)
    .where(and(eq(schema.role.organizationId, orgId), eq(schema.role.id, id)))
    .limit(1);
  return row ?? null;
}

export async function getRoleByKey(db: DbExecutor, orgId: string, key: string) {
  const [row] = await db
    .select()
    .from(schema.role)
    .where(and(eq(schema.role.organizationId, orgId), eq(schema.role.key, key)))
    .limit(1);
  return row ?? null;
}

export async function createRole(
  db: DbExecutor,
  orgId: string,
  input: RoleSeedInput,
): Promise<RoleRow> {
  const [row] = await db.insert(schema.role).values(toColumns(orgId, input)).returning();
  if (!row) throw new Error('createRole: insert returned no row');
  return row;
}

export type RoleUpdate = {
  name?: string;
  description?: string;
  color?: string | null;
  orgPermissions?: string[];
  defaultGrant?: Crud;
};

export async function updateRole(
  db: DbExecutor,
  orgId: string,
  id: string,
  patch: RoleUpdate,
): Promise<RoleRow | null> {
  const set: Partial<typeof schema.role.$inferInsert> = { updatedAt: new Date() };
  if (patch.name !== undefined) set.name = patch.name;
  if (patch.description !== undefined) set.description = patch.description;
  if (patch.color !== undefined) set.color = patch.color;
  if (patch.orgPermissions !== undefined) set.orgPermissions = patch.orgPermissions;
  if (patch.defaultGrant !== undefined) {
    set.defaultCreate = patch.defaultGrant.create;
    set.defaultRead = patch.defaultGrant.read;
    set.defaultUpdate = patch.defaultGrant.update;
    set.defaultDelete = patch.defaultGrant.delete;
  }
  const [row] = await db
    .update(schema.role)
    .set(set)
    .where(and(eq(schema.role.organizationId, orgId), eq(schema.role.id, id)))
    .returning();
  return row ?? null;
}

/** Delete a custom role. Returns false if not found. Object-permission rows
 *  cascade. Callers must first ensure it's not a system role and has no members. */
export async function deleteRole(db: DbExecutor, orgId: string, id: string): Promise<boolean> {
  const deleted = await db
    .delete(schema.role)
    .where(and(eq(schema.role.organizationId, orgId), eq(schema.role.id, id)))
    .returning({ id: schema.role.id });
  return deleted.length > 0;
}

/** Object-permission override rows for a role, keyed by objectId. */
export async function listObjectPermissions(db: DbExecutor, orgId: string, roleId: string) {
  return db
    .select()
    .from(schema.objectPermission)
    .where(
      and(
        eq(schema.objectPermission.organizationId, orgId),
        eq(schema.objectPermission.roleId, roleId),
      ),
    );
}

/** Override rows joined to their object key — for the client bootstrap payload,
 *  which resolves grants by objectKey. */
export async function listObjectPermissionsWithKey(
  db: DbExecutor,
  orgId: string,
  roleId: string,
): Promise<
  Array<{ objectId: string; objectKey: string; grant: Crud; filter: FilterEntry[] | null }>
> {
  const rows = await db
    .select({
      objectId: schema.objectPermission.objectId,
      objectKey: schema.objectDef.key,
      canCreate: schema.objectPermission.canCreate,
      canRead: schema.objectPermission.canRead,
      canUpdate: schema.objectPermission.canUpdate,
      canDelete: schema.objectPermission.canDelete,
      filter: schema.objectPermission.filter,
    })
    .from(schema.objectPermission)
    .innerJoin(schema.objectDef, eq(schema.objectDef.id, schema.objectPermission.objectId))
    .where(
      and(
        eq(schema.objectPermission.organizationId, orgId),
        eq(schema.objectPermission.roleId, roleId),
      ),
    );
  return rows.map((r) => ({
    objectId: r.objectId,
    objectKey: r.objectKey,
    grant: { create: r.canCreate, read: r.canRead, update: r.canUpdate, delete: r.canDelete },
    filter: r.filter ?? null,
  }));
}

/** Upsert one object override for a role. The objectId must belong to the org
 *  (callers validate via getObjectById). `filter` is the optional row-level
 *  (criteria) scope — null/omitted clears it. */
export async function upsertObjectPermission(
  db: DbExecutor,
  orgId: string,
  input: { roleId: string; objectId: string; grant: Crud; filter?: FilterEntry[] | null },
): Promise<void> {
  const filter = input.filter && input.filter.length > 0 ? input.filter : null;
  await db
    .insert(schema.objectPermission)
    .values({
      organizationId: orgId,
      roleId: input.roleId,
      objectId: input.objectId,
      canCreate: input.grant.create,
      canRead: input.grant.read,
      canUpdate: input.grant.update,
      canDelete: input.grant.delete,
      filter,
    })
    .onConflictDoUpdate({
      target: [schema.objectPermission.roleId, schema.objectPermission.objectId],
      set: {
        canCreate: input.grant.create,
        canRead: input.grant.read,
        canUpdate: input.grant.update,
        canDelete: input.grant.delete,
        filter,
        updatedAt: new Date(),
      },
    });
}

/** Remove an override so the object falls back to the role's default grant. */
export async function clearObjectPermission(
  db: DbExecutor,
  orgId: string,
  roleId: string,
  objectId: string,
): Promise<void> {
  await db
    .delete(schema.objectPermission)
    .where(
      and(
        eq(schema.objectPermission.organizationId, orgId),
        eq(schema.objectPermission.roleId, roleId),
        eq(schema.objectPermission.objectId, objectId),
      ),
    );
}

/** How many members hold a given role key — blocks deletion of an in-use role. */
export async function countMembersWithRole(
  db: DbExecutor,
  orgId: string,
  roleKey: string,
): Promise<number> {
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(schema.member)
    .where(
      and(eq(schema.member.organizationId, orgId), eq(schema.member.role, asRoleKey(roleKey))),
    );
  return row?.n ?? 0;
}
