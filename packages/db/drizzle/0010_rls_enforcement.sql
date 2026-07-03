-- Make RLS actually enforce.
--
-- The policies (0005/0006/0008/0009) are inert while the app connects as the
-- table owner or a superuser — Postgres skips RLS for owners (without FORCE)
-- and always for superusers. Two mechanisms fix that:
--
--   1. A dedicated runtime role `northbeam_app` (NOSUPERUSER, NOBYPASSRLS,
--      not the owner of any public table). The app's DATABASE_URL connects as
--      it; migrations keep running as the owning role (DATABASE_ADMIN_URL).
--   2. FORCE ROW LEVEL SECURITY on every org-scoped table, so even the owner
--      role is subject to the policies on managed Postgres where the master
--      user owns tables but isn't a true superuser.
--
-- The role's password is set out-of-band (scripts/setup-app-role.ts in dev;
-- your secret manager in prod: ALTER ROLE northbeam_app PASSWORD '...').
-- Dev never runs this file — infra/dev.sh runs the setup script instead,
-- which executes the same statements idempotently.

DO $$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'northbeam_app') THEN
    CREATE ROLE northbeam_app LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;
  END IF;
END $$;--> statement-breakpoint

-- CREATE on the database: the app materializes per-org record schemas
-- (org_<id>) at runtime. Schema names are gated by dynamic/identifiers.ts.
DO $$ BEGIN
  EXECUTE format('GRANT CONNECT, CREATE ON DATABASE %I TO northbeam_app', current_database());
END $$;--> statement-breakpoint
GRANT USAGE ON SCHEMA public TO northbeam_app;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO northbeam_app;--> statement-breakpoint
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO northbeam_app;--> statement-breakpoint

-- Future public tables created by push/migrate (which run as the owning role)
-- get the same grants automatically.
DO $$ BEGIN
  EXECUTE format(
    'ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO northbeam_app',
    current_user
  );
  EXECUTE format(
    'ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO northbeam_app',
    current_user
  );
END $$;--> statement-breakpoint

ALTER TABLE "object_def" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "field_def" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "record_type" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "layout_def" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "global_picklist" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "validation_rule" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "record_share" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "view" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "audit_log" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "ai_session" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "salesforce_connection" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "migration_run" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "object_mapping" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "field_mapping" FORCE ROW LEVEL SECURITY;--> statement-breakpoint

-- Per-org record schemas created before the role split are owned by the old
-- superuser; runtime DDL (addField/dropField/dropOrgSchema) needs ownership.
DO $$ DECLARE s text; tbl text; BEGIN
  FOR s IN SELECT nspname FROM pg_namespace WHERE nspname LIKE 'org\_%' LOOP
    EXECUTE format('ALTER SCHEMA %I OWNER TO northbeam_app', s);
    FOR tbl IN SELECT tablename FROM pg_tables WHERE schemaname = s LOOP
      EXECUTE format('ALTER TABLE %I.%I OWNER TO northbeam_app', s, tbl);
    END LOOP;
  END LOOP;
END $$;
