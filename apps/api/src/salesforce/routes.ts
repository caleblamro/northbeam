// Salesforce OAuth web-server flow, mounted on the Hono app.
//   GET /api/salesforce/oauth/start    → redirect to Salesforce consent
//   GET /api/salesforce/oauth/callback → exchange code, store encrypted, bounce to /migrate
//
// The current session + active org are resolved with the same createContext() the
// tRPC layer uses, so the connection is attached to the right workspace. `state`
// carries the org id and is checked against the live session on callback.

import { upsertConnection } from '@northbeam/db';
import { authorizeUrl, exchangeCode } from '@northbeam/salesforce';
import type { Hono } from 'hono';
import { encryptSecret } from '../lib/crypto.js';
import { env } from '../lib/env.js';
import type { Variables } from '../middleware/session.js';
import { createContext } from '../trpc/index.js';

function b64urlEncode(s: string): string {
  return Buffer.from(s, 'utf8').toString('base64url');
}
function b64urlDecode(s: string): string {
  return Buffer.from(s, 'base64url').toString('utf8');
}

export function mountSalesforceRoutes(app: Hono<{ Variables: Variables }>): void {
  const e = env();
  const webUrl = e.PUBLIC_WEB_URL;
  const migrate = (q: string) => `${webUrl}/migrate${q}`;

  app.get('/api/salesforce/oauth/start', async (c) => {
    if (!e.SF_CLIENT_ID || !e.SF_TOKEN_KEY) {
      return c.redirect(migrate('?error=not_configured'));
    }
    const ctx = await createContext({ req: c.req.raw });
    if (!ctx.auth) return c.redirect(`${webUrl}/sign-in`);
    const state = b64urlEncode(
      JSON.stringify({ org: ctx.auth.organizationId, t: ctx.auth.userId }),
    );
    return c.redirect(
      authorizeUrl({
        loginUrl: e.SF_LOGIN_URL,
        clientId: e.SF_CLIENT_ID,
        redirectUri: e.SF_REDIRECT_URI,
        state,
      }),
    );
  });

  app.get('/api/salesforce/oauth/callback', async (c) => {
    const code = c.req.query('code');
    const state = c.req.query('state');
    if (c.req.query('error')) return c.redirect(migrate(`?error=${c.req.query('error')}`));
    if (!code || !state || !e.SF_CLIENT_ID || !e.SF_CLIENT_SECRET || !e.SF_TOKEN_KEY) {
      return c.redirect(migrate('?error=oauth'));
    }
    const ctx = await createContext({ req: c.req.raw });
    if (!ctx.auth) return c.redirect(`${webUrl}/sign-in`);

    let parsed: { org?: string };
    try {
      parsed = JSON.parse(b64urlDecode(state));
    } catch {
      return c.redirect(migrate('?error=state'));
    }
    if (parsed.org !== ctx.auth.organizationId) return c.redirect(migrate('?error=state'));

    try {
      const tok = await exchangeCode({
        loginUrl: e.SF_LOGIN_URL,
        clientId: e.SF_CLIENT_ID,
        clientSecret: e.SF_CLIENT_SECRET,
        redirectUri: e.SF_REDIRECT_URI,
        code,
      });
      await upsertConnection(ctx.db, {
        orgId: ctx.auth.organizationId,
        instanceUrl: tok.instance_url,
        accessTokenEnc: encryptSecret(tok.access_token),
        refreshTokenEnc: tok.refresh_token ? encryptSecret(tok.refresh_token) : null,
        connectedBy: ctx.auth.userId,
      });
    } catch {
      return c.redirect(migrate('?error=exchange'));
    }
    return c.redirect(migrate('?connected=1'));
  });
}
