# apps/api — Claude conventions

Hono server hosting Better Auth, tRPC, and Salesforce OAuth callbacks. Runs on `:8000`.

## Where to put a new thing

- **New tRPC procedure**: add to an existing router under `src/trpc/routers/<router>.ts`, or create `src/trpc/routers/<new>.ts` and mount it in `src/trpc/index.ts`'s `appRouter`. Web client picks up the type automatically.
- **New auth helper**: add to `src/auth/api.ts` (the typed wrapper layer). Never re-export the raw `auth` instance from `instance.ts` — that's module-private on purpose.
- **New Salesforce surface**: add to `src/salesforce/*`. The OAuth flow is in `routes.ts`; the import engine in `import.ts`; the mapper in `mapper.ts`.

## Procedure shapes

Three flavors live in `src/trpc/trpc.ts`:

- `publicProcedure` — no auth. Use for `auth.requestMagicLink`, `me.bootstrap`, `org.create`.
- `protectedProcedure` — `ctx.auth` is guaranteed (`{ userId, organizationId, role }`). All record/object/home queries.
- `permissionProcedure('action')` — protected + `can(role, action)` check. Mutations that need admin+ (org.update, org.delete, members.invite, migration.run).

Always pull `ctx.auth.organizationId` and pass it down — every query must be org-scoped.

## Multi-tenant scoping

Records live in per-org Postgres schemas (`org_<id>.t_<key>`), so most queries don't need a `where organizationId = ?` clause — the schema name does the isolation. But the metadata tables (`objectDef`, `fieldDef`, `salesforceConnection`, etc.) are in the `public` schema and DO need explicit `where organizationId = ctx.auth.organizationId` filters.

## Raw SQL rule

**No raw SQL in this app.** All record-table operations go through `@northbeam/db`'s `listRecords / getRecord / createRecord / updateRecord / deleteRecord / countRecords / sumField / listRelated / resolveRefLabels`. If you need a new dynamic-table operation (e.g., aggregation), add the helper in `packages/db/src/dynamic/records.ts` and re-export from `packages/db/src/index.ts`.

## Test the change

- `pnpm --filter @northbeam/api typecheck` — must be clean.
- `pnpm --filter @northbeam/api dev` — tsx watch on `:8000`. Requires Postgres and `BETTER_AUTH_SECRET` in `.env.local`.
- Magic links print to the API console in dev unless `RESEND_API_KEY` is set.

## Common pitfalls

- **Better Auth headers**: `createOrganization`, `setActiveOrganization`, etc. require `ctx.req.headers` — pass them through, don't construct a new headers object.
- **superjson transformer**: `Date` and other rich types pass through correctly; don't manually `.toISOString()` server-side.
- **TRPCError mapping**: throw `NorthbeamError` from service code; the tRPC layer (`trpc.ts`) maps it to the right HTTP code.
