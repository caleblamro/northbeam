// Provision the RLS-enforced runtime role: `pnpm --filter @northbeam/db setup:rls`.
// (Named setup:rls because bare `setup` collides with pnpm's builtin command.)
//
// Runs the same statements as drizzle/0010_rls_enforcement.sql, idempotently,
// plus sets the role's password from POSTGRES_APP_PASSWORD. Dev never applies
// migration files (`pnpm dev` uses drizzle-kit push), so infra/dev.sh calls
// this after every push instead. Safe to re-run any time.
//
// Connects as the OWNER role (DATABASE_ADMIN_URL) — the app role can't grant
// itself privileges. See client.ts assertRlsEnforced for why the split exists.

import postgres from 'postgres';

const APP_ROLE = 'northbeam_app';

// Org-scoped tables are discovered dynamically (any public table with an
// `organization_id` column) rather than hand-listed, so a new metadata table
// is enforced automatically instead of relying on someone updating a list.
// These two are Better Auth-managed and queried WITHOUT the `app.org_id` GUC
// (context.ts / session.ts), so they must NOT get an RLS policy — enforcing
// one would return 0 rows and break auth. They filter by org explicitly.
const RLS_EXCLUDE = ['member', 'invitation'];

async function main() {
  const url = process.env.DATABASE_ADMIN_URL ?? process.env.DATABASE_URL;
  if (!url) {
    console.error('DATABASE_ADMIN_URL (or DATABASE_URL) is required');
    process.exit(1);
  }
  const password = process.env.POSTGRES_APP_PASSWORD ?? 'northbeam_app';

  const sql = postgres(url, { max: 1 });
  try {
    await sql.unsafe(`
      DO $$ BEGIN
        IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = '${APP_ROLE}') THEN
          CREATE ROLE ${APP_ROLE} LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;
        END IF;
      END $$;
    `);
    await sql.unsafe(`ALTER ROLE ${APP_ROLE} PASSWORD '${password.replace(/'/g, "''")}'`);

    await sql.unsafe(`
      DO $$ BEGIN
        EXECUTE format('GRANT CONNECT, CREATE ON DATABASE %I TO ${APP_ROLE}', current_database());
      END $$;
      GRANT USAGE ON SCHEMA public TO ${APP_ROLE};
      GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO ${APP_ROLE};
      GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO ${APP_ROLE};
      DO $$ BEGIN
        EXECUTE format(
          'ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO ${APP_ROLE}',
          current_user
        );
        EXECUTE format(
          'ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO ${APP_ROLE}',
          current_user
        );
      END $$;
    `);

    // Enable RLS + FORCE + (re)create the org-isolation policy on EVERY
    // org-scoped table (any public table with an `organization_id` column),
    // minus the Better Auth denylist. Discovering them dynamically means new
    // metadata tables are enforced without editing this script.
    //
    // Why recreate policies every run: `drizzle-kit push` (dev's schema sync)
    // creates the policy shell but drops the USING/WITH CHECK expressions — an
    // empty policy denies every row. Idempotent via DROP POLICY IF EXISTS.
    await sql.unsafe(`
      DO $$ DECLARE t text; p text; BEGIN
        FOR t IN
          SELECT c.table_name
          FROM information_schema.columns c
          WHERE c.table_schema = 'public'
            AND c.column_name = 'organization_id'
            AND c.table_name NOT IN (${RLS_EXCLUDE.map((x) => `'${x}'`).join(', ')})
        LOOP
          p := t || '_org_isolation';
          EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
          EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY', t);
          EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', p, t);
          EXECUTE format(
            'CREATE POLICY %I ON public.%I USING (organization_id = current_setting(''app.org_id'', true)) WITH CHECK (organization_id = current_setting(''app.org_id'', true))',
            p, t
          );
        END LOOP;
      END $$;
    `);

    // Per-org record schemas created before the role split (as the old
    // superuser) must be handed to the app role — runtime DDL
    // (addField/dropField/dropOrgSchema) requires ownership.
    await sql.unsafe(`
      DO $$ DECLARE s text; tbl text; BEGIN
        FOR s IN SELECT nspname FROM pg_namespace WHERE nspname LIKE 'org\\_%' LOOP
          EXECUTE format('ALTER SCHEMA %I OWNER TO ${APP_ROLE}', s);
          FOR tbl IN SELECT tablename FROM pg_tables WHERE schemaname = s LOOP
            EXECUTE format('ALTER TABLE %I.%I OWNER TO ${APP_ROLE}', s, tbl);
          END LOOP;
        END LOOP;
      END $$;
    `);

    const [check] = await sql<{ policies: number; forced: number }[]>`
      SELECT
        (SELECT count(*)::int FROM pg_policies WHERE schemaname = 'public') AS policies,
        (SELECT count(*)::int FROM pg_class c
           JOIN pg_namespace n ON n.oid = c.relnamespace
          WHERE n.nspname = 'public' AND c.relforcerowsecurity) AS forced
    `;
    console.log(
      `[db:setup] role '${APP_ROLE}' ready — ${check?.policies ?? 0} policies, ` +
        `${check?.forced ?? 0} tables with FORCE ROW LEVEL SECURITY`,
    );
  } finally {
    await sql.end({ timeout: 5 });
  }
}

main().catch((err) => {
  console.error('[db:setup] failed:', err);
  process.exit(1);
});
