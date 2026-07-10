// Read once, validated, frozen.
import { z } from 'zod';

// Dev port layout:
//   apps/web   3000   (Next.js)
//   apps/api   8000
const DEV_API_PORT = 14301;
const DEV_API_URL = `http://localhost:${DEV_API_PORT}`;
const DEV_WEB_URL = 'http://localhost:14300';

const Schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().default(DEV_API_PORT),
  DATABASE_URL: z.string().url(),
  /** Owner connection for drizzle push/migrate + setup-app-role.ts ONLY.
   *  Request-path code must never use it — it bypasses RLS. */
  DATABASE_ADMIN_URL: z.string().url().optional(),
  /** BullMQ backing store. The Salesforce import queue + any future async work
   *  push here. Local dev uses the redis service from infra/docker-compose. */
  REDIS_URL: z.string().url().default('redis://localhost:14303'),

  // Better Auth — base URL the auth handler builds callback links against.
  // Defaults to the dev API URL so a fresh / partially-configured .env still
  // works out of the box.
  BETTER_AUTH_SECRET: z.string().min(16),
  BETTER_AUTH_URL: z.string().url().default(DEV_API_URL),
  PUBLIC_WEB_URL: z.string().url().default(DEV_WEB_URL),

  // Email (Resend) — magic links print to console when missing.
  RESEND_API_KEY: z.string().optional(),
  RESEND_FROM: z.string().default('Northbeam <no-reply@northbeam.localhost>'),

  // GitHub social — optional; only enabled when both are present.
  GITHUB_APP_CLIENT_ID: z.string().optional(),
  GITHUB_APP_CLIENT_SECRET: z.string().optional(),

  // Salesforce migration — OAuth web-server flow + token encryption. All optional;
  // the in-app "Connect Salesforce" button is enabled only when the Connected App
  // creds + SF_TOKEN_KEY are present. (Dev can seed a connection from the sf CLI
  // token instead — see apps/api/scripts/sf-dev-connect.ts.)
  SF_CLIENT_ID: z.string().optional(),
  SF_CLIENT_SECRET: z.string().optional(),
  SF_REDIRECT_URI: z.string().url().default(`${DEV_API_URL}/api/salesforce/oauth/callback`),
  SF_LOGIN_URL: z.string().url().default('https://login.salesforce.com'),
  SF_TOKEN_KEY: z.string().optional(),
});

export type ApiEnv = z.infer<typeof Schema>;

let cached: ApiEnv | undefined;

export function env(): ApiEnv {
  if (cached) return cached;
  const parsed = Schema.safeParse(process.env);
  if (!parsed.success) {
    // Friendly per-field failure list so the operator sees exactly which env
    // var is missing or malformed, not just zod's flat message string.
    const issues = parsed.error.issues
      .map((i) => `  - ${i.path.join('.') || '(root)'}: ${i.message}`)
      .join('\n');
    throw new Error(
      `Invalid API environment — fix .env.local or your container env vars:\n${issues}`,
    );
  }
  cached = parsed.data;
  return cached;
}
