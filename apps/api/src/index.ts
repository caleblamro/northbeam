import { serve } from '@hono/node-server';
import { trpcServer } from '@hono/trpc-server';
import { logger } from '@northbeam/core';
import { assertRlsEnforced, createDb } from '@northbeam/db';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { handleAuthRequest } from './auth/index.js';
import { mountFlowWebhookRoutes } from './automation/webhook-route.js';
import { env } from './lib/env.js';
import { onError } from './middleware/error.js';
import { requestLogger } from './middleware/logging.js';
import type { Variables } from './middleware/session.js';
import { mountSalesforceRoutes } from './salesforce/routes.js';
import { appRouter, createContext } from './trpc/index.js';

const e = env();
const app = new Hono<{ Variables: Variables }>();

// Request logging first so every other middleware's errors land in a logged
// request line. Health probes are filtered out inside the middleware.
app.use('*', requestLogger);

// CORS:
//   prod → only PUBLIC_WEB_URL
//   dev  → any localhost / 127.0.0.1 / *.localhost origin (any port), so
//          changing the web dev port doesn't break cookie-based login.
const isDev = e.NODE_ENV !== 'production';
app.use(
  '*',
  cors({
    origin: (incoming) => {
      if (!incoming) return null;
      if (incoming === e.PUBLIC_WEB_URL) return incoming;
      if (isDev) {
        try {
          const u = new URL(incoming);
          if (
            u.hostname === 'localhost' ||
            u.hostname === '127.0.0.1' ||
            u.hostname.endsWith('.localhost')
          ) {
            return incoming;
          }
        } catch {
          // fall through
        }
      }
      return null;
    },
    credentials: true,
    allowMethods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
    // trpc-accept: sent by httpBatchStreamLink on EVERY request to negotiate
    // JSONL streaming (ai.preview) — without it the preflight rejects all
    // tRPC calls from the web app.
    allowHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'Cookie', 'trpc-accept'],
  }),
);

app.onError(onError);

// Better Auth — magic link, optional GitHub OAuth, sessions, org plugin.
// Handles everything under /api/auth/* relative to BETTER_AUTH_URL.
app.on(['GET', 'POST'], '/api/auth/*', (c) => handleAuthRequest(c.req.raw));

// Salesforce OAuth web-server flow (/api/salesforce/oauth/*).
mountSalesforceRoutes(app);

// Inbound flow webhooks (/api/hooks/flows/:orgId/:flowId) — HMAC-signed,
// no session; the handler establishes its own org context.
mountFlowWebhookRoutes(app);

// Health probes
app.get('/health', (c) => c.json({ ok: true, service: 'northbeam-api' }));
app.get('/ready', (c) => c.json({ ok: true }));

// /trpc — the dashboard talks to the API exclusively through here. Public
// procedures don't require a session; protected ones enforce auth in the
// procedure builder.
app.use(
  '/trpc/*',
  trpcServer({
    router: appRouter,
    createContext: (_opts, c) => createContext({ req: c.req.raw }),
    endpoint: '/trpc',
  }),
);

// Refuse to serve on a connection that bypasses RLS (superuser / table owner
// without FORCE) — org isolation on the metadata tables would be silently off.
await assertRlsEnforced(createDb(e.DATABASE_URL));

serve({ fetch: app.fetch, port: e.PORT }, (info) => {
  logger.info({ port: info.port, baseUrl: e.BETTER_AUTH_URL }, 'northbeam-api listening');

  // Self-diagnose common .env drift — don't fail-start, but loudly warn so a
  // misconfig doesn't silently break magic links / CORS / cookies.
  try {
    const bau = new URL(e.BETTER_AUTH_URL);
    const bauPort = Number(bau.port || (bau.protocol === 'https:' ? 443 : 80));
    if (bauPort !== info.port) {
      logger.warn(
        { listening: info.port, BETTER_AUTH_URL: e.BETTER_AUTH_URL },
        '⚠ BETTER_AUTH_URL port does not match the listening port. Magic-link callbacks will hit the wrong origin.',
      );
    }
  } catch {
    /* zod already validated this */
  }
});
