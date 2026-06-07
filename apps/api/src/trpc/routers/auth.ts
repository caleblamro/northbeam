// /trpc/auth — thin wrappers around Better Auth's server API so the dashboard
// never reaches for a separate client SDK. Magic-link verification still hits
// the Better Auth handler at /api/auth/* directly (it sets cookies via a
// browser redirect, which tRPC's request/response model can't represent
// cleanly), but everything else flows through here.

import { TRPCError } from '@trpc/server';
import { z } from 'zod';
import { signInMagicLink, signOut } from '../../auth/index.js';
import { env } from '../../lib/env.js';
import { protectedProcedure, publicProcedure, router } from '../trpc.js';

export const authRouter = router({
  /** Send a sign-in magic link. */
  requestMagicLink: publicProcedure
    .input(
      z.object({
        email: z.string().email(),
        callbackURL: z.string().url().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const callbackURL = input.callbackURL ?? `${env().PUBLIC_WEB_URL}/verify`;
      try {
        await signInMagicLink({ email: input.email, callbackURL }, ctx.req.headers);
        return { ok: true as const };
      } catch (err) {
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: err instanceof Error ? err.message : 'failed to send magic link',
        });
      }
    }),

  /** Sign out the current session. Returns set-cookie via the underlying
   * Better Auth API; the tRPC HTTP response carries it back to the browser. */
  signOut: protectedProcedure.mutation(async ({ ctx }) => {
    await signOut(ctx.req.headers);
    return { ok: true as const };
  }),
});
