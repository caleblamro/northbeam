-- RLS for the two tables 0007 introduced: global_picklist and validation_rule.
-- Same shape as 0005/0006 — USING + WITH CHECK against the per-request GUC
-- current_setting('app.org_id', true), set by withOrgContext. Idempotent:
-- ENABLE RLS is a no-op when already on, and each policy is DROP IF EXISTS'd
-- before CREATE so a re-run is safe.

ALTER TABLE "global_picklist" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "validation_rule" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint

DROP POLICY IF EXISTS "global_picklist_org_isolation" ON "global_picklist";--> statement-breakpoint
CREATE POLICY "global_picklist_org_isolation" ON "global_picklist"
  USING ("organization_id" = current_setting('app.org_id', true))
  WITH CHECK ("organization_id" = current_setting('app.org_id', true));--> statement-breakpoint

DROP POLICY IF EXISTS "validation_rule_org_isolation" ON "validation_rule";--> statement-breakpoint
CREATE POLICY "validation_rule_org_isolation" ON "validation_rule"
  USING ("organization_id" = current_setting('app.org_id', true))
  WITH CHECK ("organization_id" = current_setting('app.org_id', true));
