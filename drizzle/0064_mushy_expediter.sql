CREATE TYPE "public"."quote_kind" AS ENUM('DOMESTIC', 'OVERHAUL');--> statement-breakpoint
CREATE TABLE "oh_part_template_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"template_id" uuid NOT NULL,
	"display_order" integer NOT NULL,
	"part_id" uuid,
	"part_name_text" text NOT NULL,
	"quantity" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "oh_part_template_items_quantity_positive" CHECK ("oh_part_template_items"."quantity" > 0)
);
--> statement-breakpoint
CREATE TABLE "oh_part_template_models" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"template_id" uuid NOT NULL,
	"product_model_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid
);
--> statement-breakpoint
CREATE TABLE "oh_part_templates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"note" text,
	"version" integer DEFAULT 1 NOT NULL,
	"is_deleted" boolean DEFAULT false NOT NULL,
	"deleted_at" timestamp with time zone,
	"deleted_by" uuid,
	"delete_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid
);
--> statement-breakpoint
ALTER TABLE "quotes" ADD COLUMN "kind" "quote_kind" DEFAULT 'DOMESTIC' NOT NULL;--> statement-breakpoint
ALTER TABLE "oh_part_template_items" ADD CONSTRAINT "oh_part_template_items_template_id_oh_part_templates_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."oh_part_templates"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "oh_part_template_items" ADD CONSTRAINT "oh_part_template_items_part_id_parts_id_fk" FOREIGN KEY ("part_id") REFERENCES "public"."parts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "oh_part_template_models" ADD CONSTRAINT "oh_part_template_models_template_id_oh_part_templates_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."oh_part_templates"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "oh_part_template_models" ADD CONSTRAINT "oh_part_template_models_product_model_id_product_models_id_fk" FOREIGN KEY ("product_model_id") REFERENCES "public"."product_models"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "oh_part_template_models" ADD CONSTRAINT "oh_part_template_models_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "oh_part_templates" ADD CONSTRAINT "oh_part_templates_deleted_by_users_id_fk" FOREIGN KEY ("deleted_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "oh_part_templates" ADD CONSTRAINT "oh_part_templates_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "oh_part_templates" ADD CONSTRAINT "oh_part_templates_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "oh_part_template_items_template_order_unique" ON "oh_part_template_items" USING btree ("template_id","display_order");--> statement-breakpoint
CREATE INDEX "oh_part_template_items_template_id_idx" ON "oh_part_template_items" USING btree ("template_id");--> statement-breakpoint
CREATE INDEX "oh_part_template_items_part_id_idx" ON "oh_part_template_items" USING btree ("part_id");--> statement-breakpoint
CREATE UNIQUE INDEX "oh_part_template_models_model_unique" ON "oh_part_template_models" USING btree ("product_model_id");--> statement-breakpoint
CREATE INDEX "oh_part_template_models_template_id_idx" ON "oh_part_template_models" USING btree ("template_id");--> statement-breakpoint
CREATE UNIQUE INDEX "oh_part_templates_code_not_deleted_unique" ON "oh_part_templates" USING btree ("code") WHERE is_deleted = false;