CREATE TYPE "public"."procedure_reference_item_type" AS ENUM('NAV_LINK', 'EXTERNAL_FILE_LINK', 'CROSS_REFERENCE_ID', 'TEXT_NOTE');--> statement-breakpoint
ALTER TYPE "public"."procedure_equipment_type" ADD VALUE 'COMMON';--> statement-breakpoint
CREATE TABLE "procedure_reference_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"procedure_template_id" uuid NOT NULL,
	"item_type" "procedure_reference_item_type" NOT NULL,
	"label" text NOT NULL,
	"source_worksheet" text NOT NULL,
	"source_cell_range" text,
	"hyperlink_target" text,
	"cross_reference_number" text,
	"sort_order" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
ALTER TABLE "procedure_templates" ADD COLUMN "is_reference_only" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "procedure_reference_items" ADD CONSTRAINT "procedure_reference_items_procedure_template_id_procedure_templates_id_fk" FOREIGN KEY ("procedure_template_id") REFERENCES "public"."procedure_templates"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "procedure_reference_items_template_id_idx" ON "procedure_reference_items" USING btree ("procedure_template_id");