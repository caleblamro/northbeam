CREATE TABLE "object_permission" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"role_id" uuid NOT NULL,
	"object_id" uuid NOT NULL,
	"can_create" boolean DEFAULT false NOT NULL,
	"can_read" boolean DEFAULT false NOT NULL,
	"can_update" boolean DEFAULT false NOT NULL,
	"can_delete" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "object_permission" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "role" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"key" text NOT NULL,
	"name" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"color" text,
	"is_system" boolean DEFAULT false NOT NULL,
	"rank" integer DEFAULT 1 NOT NULL,
	"org_permissions" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"default_create" boolean DEFAULT false NOT NULL,
	"default_read" boolean DEFAULT true NOT NULL,
	"default_update" boolean DEFAULT false NOT NULL,
	"default_delete" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "role" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "object_permission" ADD CONSTRAINT "object_permission_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "object_permission" ADD CONSTRAINT "object_permission_role_id_role_id_fk" FOREIGN KEY ("role_id") REFERENCES "public"."role"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "object_permission" ADD CONSTRAINT "object_permission_object_id_object_def_id_fk" FOREIGN KEY ("object_id") REFERENCES "public"."object_def"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "role" ADD CONSTRAINT "role_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "object_permission_role_object_uq" ON "object_permission" USING btree ("role_id","object_id");--> statement-breakpoint
CREATE UNIQUE INDEX "role_org_key_uq" ON "role" USING btree ("organization_id","key");--> statement-breakpoint
CREATE POLICY "object_permission_org_isolation" ON "object_permission" AS PERMISSIVE FOR ALL TO public USING (organization_id = current_setting('app.org_id', true)) WITH CHECK (organization_id = current_setting('app.org_id', true));--> statement-breakpoint
CREATE POLICY "role_org_isolation" ON "role" AS PERMISSIVE FOR ALL TO public USING (organization_id = current_setting('app.org_id', true)) WITH CHECK (organization_id = current_setting('app.org_id', true));