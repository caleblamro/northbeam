-- RLS policies are now declared natively in schema.ts (so `drizzle-kit push` in
-- dev creates them too). The DROP POLICY IF EXISTS prefixes let this migration
-- converge databases that already created identically-named policies via the
-- hand-written 0005/0006/0008 migrations.

CREATE TABLE "ai_session" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"user_id" text NOT NULL,
	"object_key" text NOT NULL,
	"title" text NOT NULL,
	"messages" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"artifact" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "ai_session" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "audit_log" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "field_def" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "field_mapping" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "global_picklist" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "layout_def" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "migration_run" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "object_def" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "object_mapping" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "record_share" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "record_type" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "salesforce_connection" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "validation_rule" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "view" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "view" ALTER COLUMN "object_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "ai_session" ADD CONSTRAINT "ai_session_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_session" ADD CONSTRAINT "ai_session_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ai_session_owner_recency_idx" ON "ai_session" USING btree ("organization_id","user_id","updated_at");--> statement-breakpoint
DROP POLICY IF EXISTS "audit_log_org_isolation" ON "audit_log";--> statement-breakpoint
CREATE POLICY "audit_log_org_isolation" ON "audit_log" AS PERMISSIVE FOR ALL TO public USING (organization_id = current_setting('app.org_id', true)) WITH CHECK (organization_id = current_setting('app.org_id', true));--> statement-breakpoint
DROP POLICY IF EXISTS "field_def_org_isolation" ON "field_def";--> statement-breakpoint
CREATE POLICY "field_def_org_isolation" ON "field_def" AS PERMISSIVE FOR ALL TO public USING (organization_id = current_setting('app.org_id', true)) WITH CHECK (organization_id = current_setting('app.org_id', true));--> statement-breakpoint
DROP POLICY IF EXISTS "field_mapping_org_isolation" ON "field_mapping";--> statement-breakpoint
CREATE POLICY "field_mapping_org_isolation" ON "field_mapping" AS PERMISSIVE FOR ALL TO public USING (organization_id = current_setting('app.org_id', true)) WITH CHECK (organization_id = current_setting('app.org_id', true));--> statement-breakpoint
DROP POLICY IF EXISTS "global_picklist_org_isolation" ON "global_picklist";--> statement-breakpoint
CREATE POLICY "global_picklist_org_isolation" ON "global_picklist" AS PERMISSIVE FOR ALL TO public USING (organization_id = current_setting('app.org_id', true)) WITH CHECK (organization_id = current_setting('app.org_id', true));--> statement-breakpoint
DROP POLICY IF EXISTS "layout_def_org_isolation" ON "layout_def";--> statement-breakpoint
CREATE POLICY "layout_def_org_isolation" ON "layout_def" AS PERMISSIVE FOR ALL TO public USING (organization_id = current_setting('app.org_id', true)) WITH CHECK (organization_id = current_setting('app.org_id', true));--> statement-breakpoint
DROP POLICY IF EXISTS "migration_run_org_isolation" ON "migration_run";--> statement-breakpoint
CREATE POLICY "migration_run_org_isolation" ON "migration_run" AS PERMISSIVE FOR ALL TO public USING (organization_id = current_setting('app.org_id', true)) WITH CHECK (organization_id = current_setting('app.org_id', true));--> statement-breakpoint
DROP POLICY IF EXISTS "object_def_org_isolation" ON "object_def";--> statement-breakpoint
CREATE POLICY "object_def_org_isolation" ON "object_def" AS PERMISSIVE FOR ALL TO public USING (organization_id = current_setting('app.org_id', true)) WITH CHECK (organization_id = current_setting('app.org_id', true));--> statement-breakpoint
DROP POLICY IF EXISTS "object_mapping_org_isolation" ON "object_mapping";--> statement-breakpoint
CREATE POLICY "object_mapping_org_isolation" ON "object_mapping" AS PERMISSIVE FOR ALL TO public USING (organization_id = current_setting('app.org_id', true)) WITH CHECK (organization_id = current_setting('app.org_id', true));--> statement-breakpoint
DROP POLICY IF EXISTS "record_share_org_isolation" ON "record_share";--> statement-breakpoint
CREATE POLICY "record_share_org_isolation" ON "record_share" AS PERMISSIVE FOR ALL TO public USING (organization_id = current_setting('app.org_id', true)) WITH CHECK (organization_id = current_setting('app.org_id', true));--> statement-breakpoint
DROP POLICY IF EXISTS "record_type_org_isolation" ON "record_type";--> statement-breakpoint
CREATE POLICY "record_type_org_isolation" ON "record_type" AS PERMISSIVE FOR ALL TO public USING (organization_id = current_setting('app.org_id', true)) WITH CHECK (organization_id = current_setting('app.org_id', true));--> statement-breakpoint
DROP POLICY IF EXISTS "salesforce_connection_org_isolation" ON "salesforce_connection";--> statement-breakpoint
CREATE POLICY "salesforce_connection_org_isolation" ON "salesforce_connection" AS PERMISSIVE FOR ALL TO public USING (organization_id = current_setting('app.org_id', true)) WITH CHECK (organization_id = current_setting('app.org_id', true));--> statement-breakpoint
DROP POLICY IF EXISTS "validation_rule_org_isolation" ON "validation_rule";--> statement-breakpoint
CREATE POLICY "validation_rule_org_isolation" ON "validation_rule" AS PERMISSIVE FOR ALL TO public USING (organization_id = current_setting('app.org_id', true)) WITH CHECK (organization_id = current_setting('app.org_id', true));--> statement-breakpoint
DROP POLICY IF EXISTS "view_org_isolation" ON "view";--> statement-breakpoint
CREATE POLICY "view_org_isolation" ON "view" AS PERMISSIVE FOR ALL TO public USING (organization_id = current_setting('app.org_id', true)) WITH CHECK (organization_id = current_setting('app.org_id', true));--> statement-breakpoint
DROP POLICY IF EXISTS "ai_session_org_isolation" ON "ai_session";--> statement-breakpoint
CREATE POLICY "ai_session_org_isolation" ON "ai_session" AS PERMISSIVE FOR ALL TO public USING (organization_id = current_setting('app.org_id', true)) WITH CHECK (organization_id = current_setting('app.org_id', true));