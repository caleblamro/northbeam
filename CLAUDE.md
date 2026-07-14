# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

Northbeam — a Stripe-inspired CRM (Salesforce alternative with one-click migration). Metadata-driven
object model with native per-org Postgres tables, structured like the `brink` monorepo.

**Directory-specific guides (read the one for the area you're editing):** `apps/api/CLAUDE.md`,
`apps/web/CLAUDE.md`, `packages/db/CLAUDE.md`. Design rationale lives in `docs/architecture-plan.md`;
current priorities in `ROADMAP.md`.

## Commands

- `pnpm dev` — the one entrypoint (`infra/dev.sh`, idempotent): generates `.env.local` on first run,
  starts Postgres + Redis via docker compose, syncs schema with `drizzle-kit push`, then `turbo run dev`
  (web → :14300, api → :14301). `pnpm dev:down` stops docker.
- `pnpm dev:worker` — the BullMQ worker process (Salesforce import + compute jobs). Separate from the
  API; jobs enqueue but never run without it.
- `pnpm lint` / `pnpm lint:fix` — Biome (NOT ESLint/Prettier). `pnpm typecheck`, `pnpm build`, `pnpm test`.
- Tests (Vitest; only `apps/api` and `packages/db` have suites, in `tests/` dirs, not colocated):
  - One package: `pnpm --filter @northbeam/db test`
  - One file: `pnpm --filter @northbeam/db test -- tests/formula/formula.test.ts`
  - One case: add `-t "test name"`; watch mode: `test:watch`
- DB: `pnpm --filter @northbeam/db push` is the dev workflow (instant sync, no migration files).
  `pnpm db:generate` + `pnpm db:migrate` only for versioned prod migrations. `pnpm db:studio` to inspect.
- Salesforce dev (needs the `sf` CLI): `pnpm --filter @northbeam/api sf:dry-run-map <SObject>` prints a
  proposed mapping with no DB/server; `sf:dev-connect <orgId>` seeds a connection from a local sf token.

## Architecture

Turborepo + pnpm workspaces, Node 22+, TS everywhere. Real code: `apps/web`, `apps/api`, `packages/db`,
`packages/core`, `packages/config`, `packages/salesforce`. Everything else (`apps/cli`, `apps/workflows`,
`packages/{agents,llm,realtime,rpc-bridge,scope-proxy,ui,integrations}`, `evals`) is a 3-line stub kept
for parity with brink — don't document or import them.

**Request flow:** browser → tRPC React client (`apps/web/src/lib/api/`; httpBatchLink + superjson,
`credentials: 'include'`) → Hono `/trpc` (`apps/api`) → context resolves `{userId, organizationId, role}`
→ procedure → `packages/db`. End-to-end typed via the `AppRouter` type imported from
`@northbeam/api/trpc` — no codegen. Auth cookies live on the API origin (:8000), so the web app
bootstraps auth client-side (`trpc.me.bootstrap`); RSCs never fetch.

**tRPC procedure tiers** (`apps/api/src/trpc/trpc.ts`): `publicProcedure`, `protectedProcedure`
(guarantees `ctx.auth` and runs the body in a transaction that sets the `app.org_id` GUC for RLS), and
`permissionProcedure(action)` (adds a `can(role, action)` check from `packages/core/src/roles.ts`).

**Multi-tenancy, two mechanisms:** records live in per-org Postgres schemas (`org_<id>` schema,
`t_<key>` tables, `f_<key>` columns) — the schema name is the isolation. Metadata tables (`objectDef`,
`fieldDef`, `salesforceConnection`, …) live in `public` and DO need explicit
`where organizationId = ctx.auth.organizationId` filters.

**Metadata-driven data model** (`packages/db`): `objectDef`/`fieldDef`/`recordType` rows describe each
org's objects; `src/dynamic/*` materializes them as real tables at runtime (DDL) and provides all record
CRUD. This is the ONLY place raw SQL is allowed — every identifier passes through
`dynamic/identifiers.ts`, every value is parameterized. Field types are registered in
`src/field-types.ts` + `src/dynamic/pgtypes.ts` (adding a type touches both, plus `SF_TYPE_MAP` if it
has a Salesforce equivalent). Formula fields: `src/formula/` (tokenize→parse→evaluate) + `src/compute/`
— same-record recompute happens synchronously in the write transaction; bulk backfills fan out through
the compute worker.

**Background jobs:** BullMQ + Redis. Queues in `apps/api/src/queue/` (`sf-import`, `compute`), workers
in `apps/api/src/workers/` run as a separate process (`pnpm dev:worker`).

**Salesforce migration:** `packages/salesforce` is the pure REST/OAuth transport; `apps/api/src/salesforce/`
has the OAuth routes, `mapper.ts` (pure describe→mapping, unit-testable — this is what `sf:dry-run-map`
exercises), and `import.ts` (`executeRun`: DDL → paged SOQL → bulk insert → reference resolution →
enqueue compute).

**Auth:** Better Auth, magic-link only (links print to the API console in dev unless `RESEND_API_KEY` is
set) + organization plugin. The instance is module-private (`apps/api/src/auth/instance.ts`); callers use
the typed wrappers in `auth/api.ts` exported from `auth/index.ts`.

**AI:** Vercel AI SDK + `@ai-sdk/anthropic` in `apps/api/src/ai/` (NL → dashboard artifact trees).
Optional — degrades gracefully without `ANTHROPIC_API_KEY`.

## Conventions

- **Types at every boundary.** Zod for external input, Drizzle types internally. Never `any` without a
  comment (Biome errors on it). tsconfig is strict + `noUncheckedIndexedAccess` + `verbatimModuleSyntax`.
- **No raw SQL — with one scoped exception.** Fixed-shape tables always go through Drizzle. The dynamic
  record layer (`packages/db/src/dynamic/*`) is the ONLY place raw SQL is allowed.
- **No fetching from React Server Components beyond `packages/db`.** tRPC procedures only.
- Design tokens live in `apps/web/src/app/globals.css` (`@theme`), NOT in config. Hex values needed
  elsewhere are inlined with a comment pointing back to the token.
- Two-tier components: DiceUI/shadcn-style primitives in `src/components/ui/*` (the target stack — new
  code uses these) and brand-faithful wrappers in `src/components/northbeam/*`. Don't add new imports of
  `*-legacy.tsx` files.
- Auth instance is module-private; go through `auth/api.ts`.
- Biome formatting: single quotes, semicolons, trailing commas, 2-space indent, 100 cols.

## Environment

`.env.local` at the repo root (gitignored), generated by the first `pnpm dev`. Env is validated fail-fast
with zod (`apps/api/src/lib/env.ts`). Required: `DATABASE_URL`, `BETTER_AUTH_SECRET`. Notable optional:
`ANTHROPIC_API_KEY` (AI features), `RESEND_API_KEY` (real email), `SF_CLIENT_ID/SECRET/TOKEN_KEY`
(Salesforce OAuth), `REDIS_URL` (defaults to localhost:14303).

## Source of truth

- Data model: `packages/db/src/schema.ts` (fixed) + `packages/db/src/dynamic/` (records)
- Roles/permissions: `packages/core/src/roles.ts` (role values from `@northbeam/db/roles`)
- Brand: `packages/config/src/brand.ts` (colors intentionally live in web `globals.css`, not here)
- Original design prototype: `design/design_handoff_northbeam/`
