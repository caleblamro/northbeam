# packages/db — Claude conventions

Drizzle schema + dynamic record layer. The single source of truth for the data model.

## Two layers

**1. Fixed schema** (`src/schema.ts`): users, sessions, organizations, members, invitations, `objectDef`, `fieldDef`, `recordType`, Salesforce connection/migration tables. All go through Drizzle's typed query builder — no raw SQL allowed.

**2. Dynamic record layer** (`src/dynamic/*`): per-org Postgres schemas (`org_<id>`) with table-per-object (`t_<key>`) and column-per-field (`f_<key>`). The ONLY place raw SQL is allowed in the codebase. All identifiers pass through `identifiers.ts` (sanitize + quote); all values are parameterized.

## Where to put a new thing

- **New fixed table** (e.g., `auditLog`, `apiKey`): add to `src/schema.ts`, run `pnpm push` in dev (or generate a migration with `pnpm generate` for prod). Add a typed-query helper under `src/queries/<topic>.ts` and re-export from `src/index.ts`.
- **New record operation** (e.g., aggregation, bulk update): add to `src/dynamic/records.ts` or `src/dynamic/bulk.ts`. Re-export from `src/index.ts`. Use `qualified(orgId, tableName)` + `qid(columnName)` for SQL identifiers, and Drizzle's `sql` template for parameterization. NEVER concatenate raw column/table names into the SQL string — always go through `identifiers.ts`.
- **New field type** (e.g., richtext, geo): add to `FIELD_TYPES` in `src/field-types.ts`, add to `pgTypeFor`, `toDb`, `fromDb` in `src/dynamic/pgtypes.ts`. Update `mapSalesforceType` if it has a SF equivalent.

## Schema management

- **Dev**: `pnpm push` — instantly syncs `schema.ts` to the local Postgres. Fast, no migration files. This is the default workflow.
- **Prod migration**: `pnpm generate` first to produce a migration file in `drizzle/`, then `pnpm migrate` to apply. Do NOT reach for `generate` during routine dev — it just creates noise.
- **Drizzle Studio**: `pnpm studio` for a web UI to inspect rows.

## Per-org schema lifecycle

- `seedStandardObjects(db, orgId)` runs on org creation (called from `org.create` tRPC procedure). Idempotent — safe to re-run.
- `ensureSchema(db, orgId)` creates the `org_<id>` Postgres schema if missing.
- `createObjectTable(db, orgId, object, fields)` materializes a record table.
- `dropOrgSchema(db, orgId)` deletes everything for an org (used by `org.delete`).

## Test the change

- `pnpm --filter @northbeam/db typecheck` — must be clean.
- After editing `schema.ts`, run `pnpm --filter @northbeam/db push` to sync local DB.

## Common pitfalls

- **CASCADE on org delete**: the dynamic-table cleanup uses `DROP SCHEMA org_<id> CASCADE`. If you add a fixed table that references org records, make sure its FK has `onDelete: 'cascade'`.
- **Identifier collisions**: never call a field `id`, `name`, `owner_id`, `record_type_id`, `salesforce_id`, `created_at`, `updated_at`, `created_by_id` — those are system columns. The `f_` column prefix in `fieldColumnName` prevents accidental collision, but the metadata key should still avoid system names.
- **Computed types (formula/rollup/ai/autonumber)**: marked `COMPUTED` in `pgtypes.ts`. `updateRecord` skips them silently — the engine that computes them lives elsewhere (and is not yet built for formula/rollup; see `docs/architecture-plan.md` §A0).
