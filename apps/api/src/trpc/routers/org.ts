// /trpc/org — organization lifecycle wrappers around Better Auth's org plugin.
// Lets the dashboard create, switch, list, update, delete orgs and manage
// members + pending invitations without a separate client SDK.

import { ROLES, schema, seedStandardObjects, withOrgContext } from '@northbeam/db';
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
import { permissionProcedure, protectedProcedure, publicProcedure, router } from '../trpc.js';

const SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{0,46}[a-z0-9])?$/;
const InvitableRoleEnum = z.enum(ROLES);

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
        await withOrgContext(rootDb(), result.id, (tx) => seedStandardObjects(tx, result.id));
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

  /** Change a member's role. Admin+. */
  setMemberRole: permissionProcedure('org.members.role')
    .input(z.object({ memberId: z.string(), role: InvitableRoleEnum }))
    .mutation(async ({ ctx, input }) => {
      await updateMemberRole(
        { organizationId: ctx.auth.organizationId, memberId: input.memberId, role: input.role },
        ctx.req.headers,
      );
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
