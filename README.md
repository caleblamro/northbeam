# Northbeam

A Stripe-inspired CRM platform — a Salesforce alternative with one-click migration. This repo houses the
**Northbeam design system** (foundations + components, ported from a Claude Design handoff) and the
application that wraps it (Better Auth + organizations on a Hono/tRPC/Drizzle stack).

The structure and conventions mirror the `brink` monorepo.

## Stack

- **TS everywhere** (Node 22+, pnpm workspaces, Turborepo)
- **Next.js 16** dashboard (`apps/web`) — React 19, Tailwind v4, shadcn-style primitives
- **Hono** API (`apps/api`) — Better Auth (magic-link) + tRPC
- **Drizzle** + **Postgres** (`packages/db`)
- **Biome** for lint + format

## Layout

```
apps/
  web/         Next.js dashboard + /system design-system gallery
  api/         Hono API — Better Auth + tRPC (auth/me/org)
  cli/         stub
  workflows/   stub
packages/
  db/          Drizzle schema (Better Auth + org tables) + client
  core/        roles, permissions, AuthContext, errors, logger
  config/      BRAND + env schema
  ui/          placeholder — primitives live in apps/web/src/components
  agents|llm|realtime|rpc-bridge|scope-proxy|integrations/*   stubs
docs/          architecture, conventions, decisions
infra/         docker-compose for local Postgres
design_handoff_northbeam/   the original Claude Design HTML/CSS/JS prototype (reference)
```

## Quickstart

```sh
pnpm install
pnpm dev
```

`pnpm dev` (→ `infra/dev.sh`) is a single idempotent entrypoint, same as brink: it generates
`.env.local` on first run (with a secure `BETTER_AUTH_SECRET`), brings up Postgres and waits for it,
syncs the schema with `drizzle-kit push`, then runs `turbo run dev` (web → :3000, api → :8000).
`pnpm dev:down` stops docker. For versioned prod migrations use `pnpm db:generate` + `pnpm db:migrate`.

Sign in is passwordless: submit your email at `/sign-in`, then grab the **magic link printed in the API
console** (no SMTP needed in dev). The design-system gallery lives at `/system`.
