-- Defense-in-depth multi-tenancy for metadata tables.
--
-- App code in `protectedProcedure` and `withOrgContext` sets the per-request
-- GUC `app.org_id`. RLS policies on every org-scoped metadata table check that
-- value, so a forgotten `where organization_id = ?` clause can never read or
-- write across tenants — Postgres rejects the row.
--
-- The `current_setting('app.org_id', true)` second argument makes the call
-- return NULL instead of erroring when the GUC isn't set; the policy then
-- denies the row. To run a script or migration that needs to touch these
-- tables without a per-org context (e.g. backups, ad-hoc admin queries),
-- connect as a role with BYPASSRLS or set the GUC manually.

ALTER TABLE "object_def" ADD COLUMN "name_expression" text;--> statement-breakpoint

-- Backfill name_expression for the seeded standard objects. The seed updates
-- this on the next call to seedStandardObjects() too, but doing it here lets
-- existing orgs migrate without a forced re-seed.
UPDATE "object_def" SET "name_expression" = 'name' WHERE "key" IN ('account', 'deal') AND "name_expression" IS NULL;--> statement-breakpoint
UPDATE "object_def" SET "name_expression" = 'first_name|last_name' WHERE "key" = 'contact' AND "name_expression" IS NULL;--> statement-breakpoint
UPDATE "object_def" SET "name_expression" = 'subject' WHERE "key" = 'activity' AND "name_expression" IS NULL;--> statement-breakpoint

-- RLS on metadata tables. The seven tables below all carry organization_id
-- and are touched by request-path code (no cross-org reads expected).
ALTER TABLE "object_def" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "field_def" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "record_type" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "salesforce_connection" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "migration_run" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "object_mapping" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "field_mapping" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint

-- One policy per table. USING applies to SELECT/UPDATE/DELETE, WITH CHECK to
-- INSERT/UPDATE — both must match the current request's org. Policies are
-- identical in shape; we still declare one per table because the comparison
-- column is `organization_id` on each.
CREATE POLICY "object_def_org_isolation" ON "object_def"
  USING ("organization_id" = current_setting('app.org_id', true))
  WITH CHECK ("organization_id" = current_setting('app.org_id', true));--> statement-breakpoint
CREATE POLICY "field_def_org_isolation" ON "field_def"
  USING ("organization_id" = current_setting('app.org_id', true))
  WITH CHECK ("organization_id" = current_setting('app.org_id', true));--> statement-breakpoint
CREATE POLICY "record_type_org_isolation" ON "record_type"
  USING ("organization_id" = current_setting('app.org_id', true))
  WITH CHECK ("organization_id" = current_setting('app.org_id', true));--> statement-breakpoint
CREATE POLICY "salesforce_connection_org_isolation" ON "salesforce_connection"
  USING ("organization_id" = current_setting('app.org_id', true))
  WITH CHECK ("organization_id" = current_setting('app.org_id', true));--> statement-breakpoint
CREATE POLICY "migration_run_org_isolation" ON "migration_run"
  USING ("organization_id" = current_setting('app.org_id', true))
  WITH CHECK ("organization_id" = current_setting('app.org_id', true));--> statement-breakpoint
CREATE POLICY "object_mapping_org_isolation" ON "object_mapping"
  USING ("organization_id" = current_setting('app.org_id', true))
  WITH CHECK ("organization_id" = current_setting('app.org_id', true));--> statement-breakpoint
CREATE POLICY "field_mapping_org_isolation" ON "field_mapping"
  USING ("organization_id" = current_setting('app.org_id', true))
  WITH CHECK ("organization_id" = current_setting('app.org_id', true));
