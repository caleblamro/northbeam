DROP TABLE "record" CASCADE;--> statement-breakpoint
ALTER TABLE "field_def" ADD COLUMN "column_name" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "field_def" ADD COLUMN "pg_type" text DEFAULT 'text' NOT NULL;--> statement-breakpoint
ALTER TABLE "field_def" ADD COLUMN "indexed" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "object_def" ADD COLUMN "table_name" text DEFAULT '' NOT NULL;