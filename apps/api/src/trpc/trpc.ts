// tRPC init + base procedures.
//   publicProcedure       — no auth required
//   protectedProcedure    — caller must have a session + active org membership
//   permissionProcedure   — protectedProcedure + a PERMISSIONS check

import { NorthbeamError, type NorthbeamErrorCode, type Permission, can } from '@northbeam/core';
import { TRPCError, type TRPC_ERROR_CODE_KEY, initTRPC } from '@trpc/server';
import superjson from 'superjson';
import { ZodError } from 'zod';
import type { Context } from './context.js';

const t = initTRPC.context<Context>().create({
  transformer: superjson,
  errorFormatter({ shape, error }) {
    return {
      ...shape,
      data: {
        ...shape.data,
        zodError: error.cause instanceof ZodError ? error.cause.flatten() : null,
      },
    };
  },
});

// Service-layer code throws NorthbeamError. Translate to TRPCError so shared
// services don't need to know about tRPC.
const TO_TRPC: Record<NorthbeamErrorCode, TRPC_ERROR_CODE_KEY> = {
  unauthorized: 'UNAUTHORIZED',
  forbidden: 'FORBIDDEN',
  not_found: 'NOT_FOUND',
  invalid_input: 'BAD_REQUEST',
  internal: 'INTERNAL_SERVER_ERROR',
};

const errorMapper = t.middleware(async ({ next }) => {
  try {
    return await next();
  } catch (err) {
    if (err instanceof NorthbeamError) {
      throw new TRPCError({
        code: TO_TRPC[err.code] ?? 'INTERNAL_SERVER_ERROR',
        message: err.message,
        cause: err,
      });
    }
    throw err;
  }
});

export const router = t.router;
export const publicProcedure = t.procedure.use(errorMapper);

export const protectedProcedure = publicProcedure.use(({ ctx, next }) => {
  if (!ctx.auth) {
    throw new TRPCError({
      code: 'UNAUTHORIZED',
      message: ctx.session ? 'no_active_org' : 'sign in required',
    });
  }
  return next({ ctx: { ...ctx, auth: ctx.auth } });
});

/** Build a procedure that requires a specific Permission. */
export function permissionProcedure(action: Permission) {
  return protectedProcedure.use(({ ctx, next }) => {
    if (!can(ctx.auth.role, action)) {
      throw new TRPCError({
        code: 'FORBIDDEN',
        message: `role '${ctx.auth.role}' cannot perform '${action}'`,
      });
    }
    return next({ ctx });
  });
}
