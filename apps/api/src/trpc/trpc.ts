// tRPC init + base procedures.
//   publicProcedure       — no auth required
//   protectedProcedure    — caller must have a session + active org membership;
//                           runs inside a transaction with `app.org_id` set, so
//                           RLS policies on metadata tables apply automatically.
//   permissionProcedure   — protectedProcedure + a PERMISSIONS check

import {
  NorthbeamError,
  type NorthbeamErrorCode,
  type Permission,
  can,
  logger,
} from '@northbeam/core';
import { type Database, type DbExecutor, withOrgContext } from '@northbeam/db';
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

/** Per-procedure structured log. One line per call with userId/orgId/path/
 *  duration. Hono's requestLogger handles the outer HTTP shell; this surfaces
 *  the tRPC-specific signal (which procedure, who, how long). */
const procedureLogger = t.middleware(async ({ ctx, path, type, next }) => {
  const start = performance.now();
  const result = await next();
  const duration_ms = Math.round(performance.now() - start);
  const base = {
    path,
    type,
    duration_ms,
    userId: ctx.auth?.userId,
    organizationId: ctx.auth?.organizationId,
  };
  if (result.ok) {
    logger.info(base, 'trpc');
  } else {
    const err = result.error;
    logger.warn(
      { ...base, code: err.code, message: err.message, cause: err.cause },
      'trpc.error',
    );
  }
  return result;
});

export const router = t.router;
export const publicProcedure = t.procedure.use(errorMapper).use(procedureLogger);

/** Protected = authenticated + active org. The procedure body runs inside a
 *  short transaction that sets `app.org_id`; RLS policies on metadata tables
 *  enforce tenant isolation in Postgres, not just in app code.
 *
 *  Long-running background work kicked from a protected procedure must NOT
 *  rely on this — once the procedure returns, the transaction commits and the
 *  GUC is released. Background work establishes its own `withOrgContext`. */
export const protectedProcedure = publicProcedure.use(async ({ ctx, next }) => {
  if (!ctx.auth) {
    throw new TRPCError({
      code: 'UNAUTHORIZED',
      message: ctx.session ? 'no_active_org' : 'sign in required',
    });
  }
  // ctx.db at this layer is always the root Database (the publicProcedure path
  // didn't open a transaction). Cast back so we can call .transaction() on it —
  // DbExecutor is intentionally narrower in its public API to avoid leaking the
  // transaction handle to callers as if it could start sub-transactions.
  const rootDb = ctx.db as Database;
  const auth = ctx.auth;
  return withOrgContext(rootDb, auth.organizationId, (tx) =>
    next({ ctx: { ...ctx, db: tx as DbExecutor, auth } }),
  );
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
