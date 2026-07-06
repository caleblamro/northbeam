-- RLS for the flow-automation tables + notification. Same shape as
-- 0005/0006/0008 — USING + WITH CHECK against the per-request GUC
-- current_setting('app.org_id', true), set by withOrgContext. Hand-written
-- because drizzle-kit push creates the pgPolicy rows WITHOUT their
-- qualifiers (an unqualified policy is allow-all). Idempotent: ENABLE RLS is
-- a no-op when already on, and each policy is DROP IF EXISTS'd before CREATE
-- so a re-run is safe.

ALTER TABLE "flow" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "flow_version" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "flow_run" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "flow_run_step" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "notification" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint

-- FORCE so the owning role is also subject to the policies (0010 convention —
-- managed Postgres masters own tables without being true superusers).
ALTER TABLE "flow" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "flow_version" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "flow_run" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "flow_run_step" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "notification" FORCE ROW LEVEL SECURITY;--> statement-breakpoint

DROP POLICY IF EXISTS "flow_org_isolation" ON "flow";--> statement-breakpoint
CREATE POLICY "flow_org_isolation" ON "flow"
  USING ("organization_id" = current_setting('app.org_id', true))
  WITH CHECK ("organization_id" = current_setting('app.org_id', true));--> statement-breakpoint

DROP POLICY IF EXISTS "flow_version_org_isolation" ON "flow_version";--> statement-breakpoint
CREATE POLICY "flow_version_org_isolation" ON "flow_version"
  USING ("organization_id" = current_setting('app.org_id', true))
  WITH CHECK ("organization_id" = current_setting('app.org_id', true));--> statement-breakpoint

DROP POLICY IF EXISTS "flow_run_org_isolation" ON "flow_run";--> statement-breakpoint
CREATE POLICY "flow_run_org_isolation" ON "flow_run"
  USING ("organization_id" = current_setting('app.org_id', true))
  WITH CHECK ("organization_id" = current_setting('app.org_id', true));--> statement-breakpoint

DROP POLICY IF EXISTS "flow_run_step_org_isolation" ON "flow_run_step";--> statement-breakpoint
CREATE POLICY "flow_run_step_org_isolation" ON "flow_run_step"
  USING ("organization_id" = current_setting('app.org_id', true))
  WITH CHECK ("organization_id" = current_setting('app.org_id', true));--> statement-breakpoint

DROP POLICY IF EXISTS "notification_org_isolation" ON "notification";--> statement-breakpoint
CREATE POLICY "notification_org_isolation" ON "notification"
  USING ("organization_id" = current_setting('app.org_id', true))
  WITH CHECK ("organization_id" = current_setting('app.org_id', true));
