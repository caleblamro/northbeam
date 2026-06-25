-- Close the RLS gap left by 0005: layout_def, record_share, audit_log, and
-- view all carry organization_id but were unprotected. Same shape as the 0005
-- policies: USING + WITH CHECK against current_setting('app.org_id', true).
--
-- This migration is fully idempotent — DROP POLICY IF EXISTS before each
-- CREATE, and ENABLE RLS is a no-op when already on. We also retroactively
-- guard the 0005 policies the same way so a re-run of either migration is
-- safe (a small gift to future-self running prod incident recovery).

-- ── 0005 policies, made idempotent in place ─────────────────────────────────
DROP POLICY IF EXISTS "object_def_org_isolation" ON "object_def";--> statement-breakpoint
CREATE POLICY "object_def_org_isolation" ON "object_def"
  USING ("organization_id" = current_setting('app.org_id', true))
  WITH CHECK ("organization_id" = current_setting('app.org_id', true));--> statement-breakpoint

DROP POLICY IF EXISTS "field_def_org_isolation" ON "field_def";--> statement-breakpoint
CREATE POLICY "field_def_org_isolation" ON "field_def"
  USING ("organization_id" = current_setting('app.org_id', true))
  WITH CHECK ("organization_id" = current_setting('app.org_id', true));--> statement-breakpoint

DROP POLICY IF EXISTS "record_type_org_isolation" ON "record_type";--> statement-breakpoint
CREATE POLICY "record_type_org_isolation" ON "record_type"
  USING ("organization_id" = current_setting('app.org_id', true))
  WITH CHECK ("organization_id" = current_setting('app.org_id', true));--> statement-breakpoint

DROP POLICY IF EXISTS "salesforce_connection_org_isolation" ON "salesforce_connection";--> statement-breakpoint
CREATE POLICY "salesforce_connection_org_isolation" ON "salesforce_connection"
  USING ("organization_id" = current_setting('app.org_id', true))
  WITH CHECK ("organization_id" = current_setting('app.org_id', true));--> statement-breakpoint

DROP POLICY IF EXISTS "migration_run_org_isolation" ON "migration_run";--> statement-breakpoint
CREATE POLICY "migration_run_org_isolation" ON "migration_run"
  USING ("organization_id" = current_setting('app.org_id', true))
  WITH CHECK ("organization_id" = current_setting('app.org_id', true));--> statement-breakpoint

DROP POLICY IF EXISTS "object_mapping_org_isolation" ON "object_mapping";--> statement-breakpoint
CREATE POLICY "object_mapping_org_isolation" ON "object_mapping"
  USING ("organization_id" = current_setting('app.org_id', true))
  WITH CHECK ("organization_id" = current_setting('app.org_id', true));--> statement-breakpoint

DROP POLICY IF EXISTS "field_mapping_org_isolation" ON "field_mapping";--> statement-breakpoint
CREATE POLICY "field_mapping_org_isolation" ON "field_mapping"
  USING ("organization_id" = current_setting('app.org_id', true))
  WITH CHECK ("organization_id" = current_setting('app.org_id', true));--> statement-breakpoint

-- ── New tables that 0005 missed ─────────────────────────────────────────────
ALTER TABLE "layout_def" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "record_share" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "audit_log" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "view" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint

DROP POLICY IF EXISTS "layout_def_org_isolation" ON "layout_def";--> statement-breakpoint
CREATE POLICY "layout_def_org_isolation" ON "layout_def"
  USING ("organization_id" = current_setting('app.org_id', true))
  WITH CHECK ("organization_id" = current_setting('app.org_id', true));--> statement-breakpoint

DROP POLICY IF EXISTS "record_share_org_isolation" ON "record_share";--> statement-breakpoint
CREATE POLICY "record_share_org_isolation" ON "record_share"
  USING ("organization_id" = current_setting('app.org_id', true))
  WITH CHECK ("organization_id" = current_setting('app.org_id', true));--> statement-breakpoint

DROP POLICY IF EXISTS "audit_log_org_isolation" ON "audit_log";--> statement-breakpoint
CREATE POLICY "audit_log_org_isolation" ON "audit_log"
  USING ("organization_id" = current_setting('app.org_id', true))
  WITH CHECK ("organization_id" = current_setting('app.org_id', true));--> statement-breakpoint

DROP POLICY IF EXISTS "view_org_isolation" ON "view";--> statement-breakpoint
CREATE POLICY "view_org_isolation" ON "view"
  USING ("organization_id" = current_setting('app.org_id', true))
  WITH CHECK ("organization_id" = current_setting('app.org_id', true));
