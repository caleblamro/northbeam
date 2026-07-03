// /trpc/org — organization lifecycle wrappers around Better Auth's org plugin.
// Lets the dashboard create, switch, list, update, delete orgs and manage
// members + pending invitations without a separate client SDK.

import { SYSTEM_ROLE_SEEDS } from '@northbeam/core';
import {
  ROLES,
  getObjectByKey,
  getRoleByKey,
  recomputeObjectPage,
  schema,
  seedRoles,
  seedSampleRecords,
  seedStandardObjects,
  withOrgContext,
  writeAuditEvent,
} from '@northbeam/db';
import { TRPCError } from '@trpc/server';
import { and, desc, eq } from 'drizzle-orm';
import { z } from 'zod';
import {
  cancelInvitation,
  createInvitation,
  createOrganization,
  deleteOrganization,
  removeMember,
  setActiveOrganization,
  updateMemberRole,
  updateOrganization,
} from '../../auth/index.js';
import { rootDb } from '../context.js';
import { invalidatePermissions } from '../permissions.js';
import { permissionProcedure, protectedProcedure, publicProcedure, router } from '../trpc.js';

const SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{0,46}[a-z0-9])?$/;
// Invitations go through Better Auth, which only knows the 4 system roles, so
// invites are limited to those (custom roles are assigned after join via
// setMemberRole, which writes member.role directly).
const InvitableRoleEnum = z.enum(ROLES);

type MemberRoleValue = (typeof schema.member.$inferInsert)['role'];

export const orgRouter = router({
  /** Create a new org. Caller becomes the owner and it's made active. */
  create: publicProcedure
    .input(
      z.object({
        name: z.string().min(1).max(80),
        slug: z.string().regex(SLUG_RE, 'lowercase letters, digits, dashes; 1-48 chars'),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      if (!ctx.session) {
        throw new TRPCError({ code: 'UNAUTHORIZED', message: 'sign in required' });
      }
      try {
        const result = await createOrganization(
          { name: input.name, slug: input.slug },
          ctx.req.headers,
        );
        if (!result) {
          throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'org creation failed' });
        }
        // Seed the standard objects (account/contact/deal/activity) so the new
        // workspace has its metadata + the targets SF standard objects map onto.
        //
        // org.create is publicProcedure, so we don't have an RLS-scoped tx yet
        // — open one explicitly for the seed so the object_def / field_def
        // INSERTs pass the RLS policy. We also get atomicity: if the seed
        // fails halfway through, none of the partial metadata sticks around.
        await withOrgContext(rootDb(), result.id, async (tx) => {
          // Seed the 4 system roles (owner/admin/member/viewer) so the roles
          // editor + custom-role assignment work out of the gate. Computed from
          // the static matrix, so behavior matches the pre-custom-roles model.
          await seedRoles(
            tx,
            result.id,
            SYSTEM_ROLE_SEEDS.map((s) => ({
              key: s.key,
              name: s.name,
              description: s.description,
              rank: s.rank,
              isSystem: true,
              orgPermissions: s.orgPermissions,
              defaultGrant: s.defaultGrant,
            })),
          );
          await seedStandardObjects(tx, result.id);
          // Sample records — accounts + contacts + deals + activities with
          // real references between them so dashboards / list views aren't
          // empty out of the gate. Best-effort: a failure here doesn't
          // un-create the org, since the metadata is already in place.
          try {
            await seedSampleRecords(tx, result.id);
            // Populate formula + rollup columns on the seeded records so the
            // workspace demonstrates the compute engine out of the gate (the
            // sample inserts skip computed fields, like any record write).
            const now = new Date();
            for (const key of ['deal', 'account']) {
              const owf = await getObjectByKey(tx, result.id, key);
              if (owf) {
                await recomputeObjectPage(tx, {
                  orgId: result.id,
                  object: owf.object,
                  fields: owf.fields,
                  now,
                });
              }
            }
          } catch (err) {
            // eslint-disable-next-line no-console
            console.warn('[org.create] sample records seed failed', err);
          }
        });
        await setActiveOrganization(result.id, ctx.req.headers);
        return result;
      } catch (err) {
        if (err instanceof TRPCError) throw err;
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: err instanceof Error ? err.message : 'failed to create organization',
        });
      }
    }),

  /** Orgs the caller belongs to. */
  list: protectedProcedure.query(async ({ ctx }) => {
    return ctx.db
      .select({
        id: schema.organization.id,
        name: schema.organization.name,
        slug: schema.organization.slug,
        role: schema.member.role,
      })
      .from(schema.member)
      .innerJoin(schema.organization, eq(schema.organization.id, schema.member.organizationId))
      .where(eq(schema.member.userId, ctx.auth.userId))
      .orderBy(desc(schema.organization.createdAt));
  }),

  /** Switch the active org for the current session. */
  setActive: protectedProcedure
    .input(z.object({ organizationId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      await setActiveOrganization(input.organizationId, ctx.req.headers);
      return { ok: true as const };
    }),

  /** Update org profile (name / slug / logo). Admin+. */
  update: permissionProcedure('org.settings.update')
    .input(
      z.object({
        name: z.string().min(1).max(80).optional(),
        slug: z.string().regex(SLUG_RE).optional(),
        logo: z.string().url().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await updateOrganization(
        { organizationId: ctx.auth.organizationId, data: input },
        ctx.req.headers,
      );
      return { ok: true as const };
    }),

  /** Members + pending invitations for the active org. */
  members: protectedProcedure.query(async ({ ctx }) => {
    const members = await ctx.db
      .select({
        id: schema.member.id,
        role: schema.member.role,
        userId: schema.user.id,
        name: schema.user.name,
        email: schema.user.email,
        createdAt: schema.member.createdAt,
      })
      .from(schema.member)
      .innerJoin(schema.user, eq(schema.user.id, schema.member.userId))
      .where(eq(schema.member.organizationId, ctx.auth.organizationId))
      .orderBy(desc(schema.member.createdAt));

    const invitations = await ctx.db
      .select({
        id: schema.invitation.id,
        email: schema.invitation.email,
        role: schema.invitation.role,
        status: schema.invitation.status,
        expiresAt: schema.invitation.expiresAt,
      })
      .from(schema.invitation)
      .where(
        and(
          eq(schema.invitation.organizationId, ctx.auth.organizationId),
          eq(schema.invitation.status, 'pending'),
        ),
      );

    return { members, invitations };
  }),

  /** Invite someone to the active org. Admin+. */
  invite: permissionProcedure('org.members.invite')
    .input(z.object({ email: z.string().email(), role: InvitableRoleEnum }))
    .mutation(async ({ ctx, input }) => {
      await createInvitation(
        { organizationId: ctx.auth.organizationId, email: input.email, role: input.role },
        ctx.req.headers,
      );
      return { ok: true as const };
    }),

  /** Cancel a pending invitation. Admin+. */
  cancelInvite: permissionProcedure('org.members.invite')
    .input(z.object({ invitationId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      await cancelInvitation(input.invitationId, ctx.req.headers);
      return { ok: true as const };
    }),

  /** Change a member's role to any role defined in the org — system or custom.
   *  Admin+. 'owner' can't be assigned here (use transferOwnership). Writes
   *  member.role directly rather than through Better Auth, whose org plugin
   *  only knows the statically-configured system roles and would reject a
   *  custom key. */
  setMemberRole: permissionProcedure('org.members.role')
    .input(z.object({ memberId: z.string(), role: z.string() }))
    .mutation(async ({ ctx, input }) => {
      if (input.role === 'owner') {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'assign ownership via transferOwnership, not setMemberRole',
        });
      }
      // The target role must exist in this org (system or custom).
      const target = await getRoleByKey(ctx.db, ctx.auth.organizationId, input.role);
      if (!target) {
        throw new TRPCError({ code: 'NOT_FOUND', message: `role '${input.role}' does not exist` });
      }
      const updated = await ctx.db
        .update(schema.member)
        // Column is typed to the 4 system keys, but holds custom keys too — the
        // value is validated above against the org's role table.
        .set({ role: input.role as MemberRoleValue })
        .where(
          and(
            eq(schema.member.organizationId, ctx.auth.organizationId),
            eq(schema.member.id, input.memberId),
          ),
        )
        .returning({ id: schema.member.id, userId: schema.member.userId });
      if (updated.length === 0) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'member not found' });
      }
      // Bust the grant cache so the member's next request sees the new role.
      invalidatePermissions(ctx.auth.organizationId);
      await writeAuditEvent(ctx.db, {
        organizationId: ctx.auth.organizationId,
        userId: ctx.auth.userId,
        action: 'member.role.changed',
        targetType: 'member',
        targetId: input.memberId,
        meta: { role: input.role, memberUserId: updated[0]?.userId },
      });
      return { ok: true as const };
    }),

  /** Transfer ownership of the workspace to another member. Atomic-ish:
   *  promotes the target to 'owner' first, then demotes the previous
   *  owner to 'admin'. If the demotion fails after promotion succeeds,
   *  the workspace temporarily has two owners — surfaces as a friendly
   *  error and the user can retry. Only the current owner can call this. */
  transferOwnership: permissionProcedure('org.transfer')
    .input(z.object({ memberId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const members = await ctx.db
        .select({
          id: schema.member.id,
          userId: schema.member.userId,
          role: schema.member.role,
        })
        .from(schema.member)
        .where(eq(schema.member.organizationId, ctx.auth.organizationId));
      const target = members.find((m) => m.id === input.memberId);
      const currentOwner = members.find((m) => m.userId === ctx.auth.userId);
      if (!target) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'target member not in workspace' });
      }
      if (!currentOwner) {
        throw new TRPCError({ code: 'FORBIDDEN', message: 'caller is not a workspace member' });
      }
      if (target.id === currentOwner.id) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'you already own this workspace',
        });
      }

      // Promote first so there's always at least one owner in flight; if the
      // demote fails the workspace ends up with two owners (recoverable by
      // re-running transferOwnership) rather than zero (which would lock
      // out admin-protected actions).
      await updateMemberRole(
        { organizationId: ctx.auth.organizationId, memberId: target.id, role: 'owner' },
        ctx.req.headers,
      );
      await updateMemberRole(
        { organizationId: ctx.auth.organizationId, memberId: currentOwner.id, role: 'admin' },
        ctx.req.headers,
      );

      await writeAuditEvent(ctx.db, {
        organizationId: ctx.auth.organizationId,
        userId: ctx.auth.userId,
        action: 'org.ownership.transferred',
        targetType: 'member',
        targetId: target.id,
        meta: { newOwnerUserId: target.userId, previousOwnerUserId: ctx.auth.userId },
      });
      return { ok: true as const };
    }),

  /** Remove a member. Admin+. */
  removeMember: permissionProcedure('org.members.remove')
    .input(z.object({ memberIdOrEmail: z.string() }))
    .mutation(async ({ ctx, input }) => {
      await removeMember(
        { organizationId: ctx.auth.organizationId, memberIdOrEmail: input.memberIdOrEmail },
        ctx.req.headers,
      );
      return { ok: true as const };
    }),

  /** Delete the active org. Owner only. */
  delete: permissionProcedure('org.delete').mutation(async ({ ctx }) => {
    await deleteOrganization(ctx.auth.organizationId, ctx.req.headers);
    return { ok: true as const };
  }),
});
