-- Global picklist sets + validation rules, and two object_def columns:
-- format_rules (conditional-formatting JSONB) and archived_at (soft archive).
--
-- Hand-trimmed from the drizzle-kit output: the meta snapshot had been stale
-- since 0004, so generate also re-emitted tables/columns that 0005/0006-era
-- pushes already own (layout_def, record_share, audit_log, view,
-- name_expression, default_visibility). Those are dropped here — the 0007
-- snapshot still captures the full current schema, so future generates diff
-- cleanly. RLS for the two new tables lands in 0008.

CREATE TABLE "global_picklist" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"values" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "validation_rule" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"object_id" uuid NOT NULL,
	"name" text NOT NULL,
	"condition" text NOT NULL,
	"error_message" text NOT NULL,
	"error_field_key" text,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "object_def" ADD COLUMN "format_rules" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "object_def" ADD COLUMN "archived_at" timestamp;--> statement-breakpoint
ALTER TABLE "global_picklist" ADD CONSTRAINT "global_picklist_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "validation_rule" ADD CONSTRAINT "validation_rule_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "validation_rule" ADD CONSTRAINT "validation_rule_object_id_object_def_id_fk" FOREIGN KEY ("object_id") REFERENCES "public"."object_def"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "global_picklist_org_name_uq" ON "global_picklist" USING btree ("organization_id","name");--> statement-breakpoint
CREATE UNIQUE INDEX "validation_rule_obj_name_uq" ON "validation_rule" USING btree ("object_id","name");
