# Northbeam — Claude conventions

A Stripe-inspired CRM (Salesforce alternative with one-click migration). Design system + app, structured
like the `brink` monorepo.

## Stack at a glance

- **TS everywhere** (Node 22+, pnpm workspaces, Turborepo)
- **Next.js 16** dashboard (`apps/web`), React 19, **Tailwind v4** (`@theme` tokens in `globals.css`)
- **Hono** API (`apps/api`) — tRPC procedures live here
- **Better Auth** (magic-link only at v1) + organization plugin
- **Drizzle** + **Postgres** (`packages/db`)
- **Biome** for lint + format (NOT ESLint, NOT Prettier)

## Conventions (short list)

- **Types at every boundary.** Zod for external input, Drizzle types internally. Never `any` without a comment.
- **No raw SQL — with one scoped exception.** Fixed-shape tables always go through Drizzle. The dynamic
  table-per-object record layer (`packages/db/src/dynamic/*`) is the ONLY place raw SQL is allowed: it
  builds DDL/DML for runtime-defined tables, with all identifiers passing through `identifiers.ts`
  (sanitize + quote) and all values parameterized. Don't write raw SQL anywhere else.
- **No fetching from React Server Components beyond `packages/db`.** tRPC procedures only.
- Design tokens live in `apps/web/src/app/globals.css` (`@theme`), NOT in config. Hex values needed elsewhere
  are inlined with a comment pointing back to the token.
- Two-tier components: shadcn-style primitives in `src/components/ui/*` (cva + `cn` + Radix), brand-faithful
  ports in `src/components/northbeam/*` (headed `// Direct port of design_handoff_northbeam/<file>`).
- Auth instance is module-private (`apps/api/src/auth/instance.ts`); callers use the typed wrappers in
  `auth/api.ts` exported from `auth/index.ts`.

## Source of truth

- Data model: `packages/db/src/schema.ts`
- Roles/permissions: `packages/core/src/roles.ts`
- Brand: `packages/config/src/brand.ts`
- Original design: `design_handoff_northbeam/`
