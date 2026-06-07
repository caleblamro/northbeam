# Architecture

Mirrors the `brink` monorepo layout.

- **apps/web** (Next.js 16) — the dashboard. Talks to the API exclusively over tRPC
  (`src/lib/api`). Renders the `(auth)` → `(onboarding)` → `(app)` flow plus the
  `/system` design-system gallery.
- **apps/api** (Hono) — hosts Better Auth at `/api/auth/*` and tRPC at `/trpc`.
  Auth instance is module-private; callers use the typed wrappers in `auth/api.ts`.
- **packages/db** (Drizzle/Postgres) — Better Auth + organization tables. Single
  source of truth for the data model.
- **packages/core** — roles, permission map, `AuthContext`, errors, logger.
- **packages/config** — `BRAND` + env schema.

Request flow: browser → tRPC (`httpBatchLink`, cookies) → Hono `/trpc` → session
middleware resolves `{ user, activeOrg, role }` → procedure → Drizzle.
