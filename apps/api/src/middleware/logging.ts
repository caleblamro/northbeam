// Hono request logging: one structured line per request (after it completes)
// with method, path, status, duration_ms, and a correlation id. The id is
// surfaced on `c.set('requestId', ...)` so any downstream middleware (tRPC,
// auth, error handler) can use it as a child-logger field.

import { logger } from '@northbeam/core';
import { createMiddleware } from 'hono/factory';

type LoggingVariables = { requestId: string };

declare module 'hono' {
  interface ContextVariableMap extends LoggingVariables {}
}

export const requestLogger = createMiddleware<{ Variables: LoggingVariables }>(async (c, next) => {
  // Use the inbound header if a load balancer / client already tagged the
  // request; otherwise mint a new one. Browsers don't send these so the local
  // dev path always lands in the else branch.
  const requestId = c.req.header('x-request-id') ?? crypto.randomUUID();
  c.set('requestId', requestId);
  c.res.headers.set('x-request-id', requestId);

  const start = performance.now();
  let status = 0;
  try {
    await next();
    status = c.res.status;
  } catch (err) {
    status = 500;
    logger.error(
      { requestId, method: c.req.method, path: new URL(c.req.url).pathname, err },
      'request errored',
    );
    throw err;
  } finally {
    const duration_ms = Math.round(performance.now() - start);
    const path = new URL(c.req.url).pathname;
    // Drop health probes — they're noisy and the orchestrator already knows.
    if (path !== '/health' && path !== '/ready') {
      logger.info(
        { requestId, method: c.req.method, path, status, duration_ms },
        'request',
      );
    }
  }
});
