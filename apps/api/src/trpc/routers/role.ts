// /trpc/role — custom roles + the per-object CRUD permission grid (Directus
// style). Roles are org-scoped rows; the 4 system roles are seeded and can't be
// deleted (owner is fully immutable). All mutations gate on 'org.roles.manage'.
//
// A role carries an org-action set (orgPermissions) plus a default CRUD grant;
// object_permission rows override the default per object. After any edit we bust
// the per-(org,role) grant cache so the change takes effect immediately.

import { ORG_PERMISSION_KEYS, type Permission, READ_ONLY_CRUD, may } from '@northbeam/core';
import {
  clearObjectPermission,
  countMembersWithRole,
  createRole,
  deleteRole,
  getObjectById,
  getRoleById,
  getRoleByKey,
  listObjectPermissions,
  listObjects,
  listRoles,
  updateRole,
  upsertObjectPermission,
  writeAuditEvent,
} from '@northbeam/db';
import { TRPCError } from '@trpc/server';
import { z } from 'zod';
import type { Context } from '../context.js';
import { invalidatePermissions } from '../permissions.js';
import { permissionProcedure, protectedProcedure, router } from '../trpc.js';

const ORG_PERMISSION_SET = new Set<string>(ORG_PERMISSION_KEYS);
const CrudSchema = z.object({
  create: z.boolean(),
  read: z.boolean(),
  update: z.boolean(),
  delete: z.boolean(),
});
/** Only known, non-record permission keys can be granted to a role. */
const OrgPermissionsSchema = z
  .array(z.string())
  .transform((keys) => keys.filter((k) => ORG_PERMISSION_SET.has(k)) as Permission[]);

function slugify(name: string): string {
  return (
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40) || 'role'
  );
}

/** A unique per-org role key derived from a name (appends -2, -3, … on clash). */
async function uniqueKey(ctx: Context, orgId: string, base: string): Promise<string> {
  const slug = slugify(base);
  for (let i = 0; i < 50; i++) {
    const candidate = i === 0 ? slug : `${slug}-${i + 1}`;
    if (!(await getRoleByKey(ctx.db, orgId, candidate))) return candidate;
  }
  return `${slug}-${Date.now().toString(36)}`;
}

export const roleRouter = router({
  /** Roles for the active org with member counts. Available to anyone who can
   *  assign roles OR manage them, so the members picker and the roles editor
   *  both work. */
  list: protectedProcedure.query(async ({ ctx }) => {
    if (!may(ctx.auth, 'org.members.role') && !may(ctx.auth, 'org.roles.manage')) {
      throw new TRPCError({ code: 'FORBIDDEN' });
    }
    return listRoles(ctx.db, ctx.auth.organizationId);
  }),

  /** One role + every object with the role's resolved CRUD (override or the
   *  role default), for the grid editor. */
  get: permissionProcedure('org.roles.manage')
    .input(z.object({ id: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const role = await getRoleById(ctx.db, ctx.auth.organizationId, input.id);
      if (!role) throw new TRPCError({ code: 'NOT_FOUND' });
      const objects = await listObjects(ctx.db, ctx.auth.organizationId);
      const overrides = await listObjectPermissions(ctx.db, ctx.auth.organizationId, role.id);
      const overrideByObject = new Map(overrides.map((o) => [o.objectId, o]));
      const def = {
        create: role.defaultCreate,
        read: role.defaultRead,
        update: role.defaultUpdate,
        delete: role.defaultDelete,
      };
      return {
        role: {
          id: role.id,
          key: role.key,
          name: role.name,
          description: role.description,
          color: role.color,
          isSystem: role.isSystem,
          orgPermissions: role.orgPermissions,
          defaultGrant: def,
        },
        objects: objects.map((o) => {
          const ov = overrideByObject.get(o.id);
          return {
            id: o.id,
            key: o.key,
            label: o.label,
            labelPlural: o.labelPlural,
            icon: o.icon,
            color: o.color,
            /** Whether the grid cell is an explicit override vs the role default. */
            overridden: Boolean(ov),
            grant: ov
              ? {
                  create: ov.canCreate,
                  read: ov.canRead,
                  update: ov.canUpdate,
                  delete: ov.canDelete,
                }
              : def,
          };
        }),
      };
    }),

  /** Create a custom role, optionally copying another role's grants. */
  create: permissionProcedure('org.roles.manage')
    .input(
      z.object({
        name: z.string().min(1).max(60),
        description: z.string().max(280).optional(),
        color: z.string().max(20).optional(),
        copyFromRoleId: z.string().uuid().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const orgId = ctx.auth.organizationId;
      let orgPermissions: Permission[] = [];
      let defaultGrant = READ_ONLY_CRUD;
      let copyOverridesFrom: string | null = null;
      if (input.copyFromRoleId) {
        const src = await getRoleById(ctx.db, orgId, input.copyFromRoleId);
        if (!src) throw new TRPCError({ code: 'NOT_FOUND', message: 'role to copy not found' });
        orgPermissions = src.orgPermissions as Permission[];
        defaultGrant = {
          create: src.defaultCreate,
          read: src.defaultRead,
          update: src.defaultUpdate,
          delete: src.defaultDelete,
        };
        copyOverridesFrom = src.id;
      }
      const key = await uniqueKey(ctx, orgId, input.name);
      const created = await createRole(ctx.db, orgId, {
        key,
        name: input.name,
        description: input.description ?? '',
        color: input.color ?? null,
        isSystem: false,
        rank: 1,
        orgPermissions,
        defaultGrant,
      });
      if (copyOverridesFrom) {
        const overrides = await listObjectPermissions(ctx.db, orgId, copyOverridesFrom);
        for (const o of overrides) {
          await upsertObjectPermission(ctx.db, orgId, {
            roleId: created.id,
            objectId: o.objectId,
            grant: {
              create: o.canCreate,
              read: o.canRead,
              update: o.canUpdate,
              delete: o.canDelete,
            },
          });
        }
      }
      await writeAuditEvent(ctx.db, {
        organizationId: orgId,
        userId: ctx.auth.userId,
        action: 'role.created',
        targetType: 'role',
        targetId: created.id,
        meta: { key, name: input.name },
      });
      return { id: created.id, key };
    }),

  /** Edit a role's name/description/color, org-action set, and default CRUD.
   *  Owner is immutable; other system roles are editable but not renamable-key. */
  update: permissionProcedure('org.roles.manage')
    .input(
      z.object({
        id: z.string().uuid(),
        name: z.string().min(1).max(60).optional(),
        description: z.string().max(280).optional(),
        color: z.string().max(20).nullable().optional(),
        orgPermissions: OrgPermissionsSchema.optional(),
        defaultGrant: CrudSchema.optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const orgId = ctx.auth.organizationId;
      const role = await getRoleById(ctx.db, orgId, input.id);
      if (!role) throw new TRPCError({ code: 'NOT_FOUND' });
      if (role.key === 'owner') {
        throw new TRPCError({ code: 'FORBIDDEN', message: 'the Owner role is immutable' });
      }
      const updated = await updateRole(ctx.db, orgId, input.id, {
        name: input.name,
        description: input.description,
        color: input.color,
        orgPermissions: input.orgPermissions,
        defaultGrant: input.defaultGrant,
      });
      if (!updated) throw new TRPCError({ code: 'NOT_FOUND' });
      invalidatePermissions(orgId, role.key);
      return { ok: true as const };
    }),

  /** Delete a custom role. System roles and in-use roles are protected. */
  delete: permissionProcedure('org.roles.manage')
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const orgId = ctx.auth.organizationId;
      const role = await getRoleById(ctx.db, orgId, input.id);
      if (!role) throw new TRPCError({ code: 'NOT_FOUND' });
      if (role.isSystem) {
        throw new TRPCError({ code: 'FORBIDDEN', message: 'system roles cannot be deleted' });
      }
      const inUse = await countMembersWithRole(ctx.db, orgId, role.key);
      if (inUse > 0) {
        throw new TRPCError({
          code: 'CONFLICT',
          message: `${inUse} member${inUse === 1 ? '' : 's'} still have this role — reassign them first`,
        });
      }
      await deleteRole(ctx.db, orgId, input.id);
      invalidatePermissions(orgId, role.key);
      await writeAuditEvent(ctx.db, {
        organizationId: orgId,
        userId: ctx.auth.userId,
        action: 'role.deleted',
        targetType: 'role',
        targetId: input.id,
        meta: { key: role.key, name: role.name },
      });
      return { ok: true as const };
    }),

  /** Set (or clear) a role's CRUD override for one object. Clearing falls the
   *  object back to the role's default grant. Owner is immutable. */
  setObjectPermission: permissionProcedure('org.roles.manage')
    .input(
      z.object({
        roleId: z.string().uuid(),
        objectId: z.string().uuid(),
        grant: CrudSchema.nullable(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const orgId = ctx.auth.organizationId;
      const role = await getRoleById(ctx.db, orgId, input.roleId);
      if (!role) throw new TRPCError({ code: 'NOT_FOUND', message: 'role not found' });
      if (role.key === 'owner') {
        throw new TRPCError({ code: 'FORBIDDEN', message: 'the Owner role is immutable' });
      }
      const object = await getObjectById(ctx.db, orgId, input.objectId);
      if (!object) throw new TRPCError({ code: 'NOT_FOUND', message: 'object not found' });
      if (input.grant) {
        await upsertObjectPermission(ctx.db, orgId, {
          roleId: input.roleId,
          objectId: input.objectId,
          grant: input.grant,
        });
      } else {
        await clearObjectPermission(ctx.db, orgId, input.roleId, input.objectId);
      }
      invalidatePermissions(orgId, role.key);
      return { ok: true as const };
    }),
});
