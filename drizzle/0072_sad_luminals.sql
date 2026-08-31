CREATE TABLE "quote_repair_tasks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"quote_id" uuid NOT NULL,
	"line_no" integer NOT NULL,
	"task_id" uuid,
	"task_name_text" text NOT NULL,
	"hours" integer NOT NULL,
	"hourly_rate" numeric(15, 2) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "quote_repair_tasks_hours_positive" CHECK ("quote_repair_tasks"."hours" > 0),
	CONSTRAINT "quote_repair_tasks_hourly_rate_not_negative" CHECK ("quote_repair_tasks"."hourly_rate" >= 0)
);
--> statement-breakpoint
ALTER TABLE "repair_task_catalog" ADD COLUMN "is_overhaul" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "quotes" ADD COLUMN "labor_equipment_kind" "product_model_kind";--> statement-breakpoint
ALTER TABLE "quotes" ADD COLUMN "labor_base_cost" numeric(15, 2);--> statement-breakpoint
ALTER TABLE "quote_repair_tasks" ADD CONSTRAINT "quote_repair_tasks_quote_id_quotes_id_fk" FOREIGN KEY ("quote_id") REFERENCES "public"."quotes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quote_repair_tasks" ADD CONSTRAINT "quote_repair_tasks_task_id_repair_task_catalog_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."repair_task_catalog"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "quote_repair_tasks_quote_line_unique" ON "quote_repair_tasks" USING btree ("quote_id","line_no");--> statement-breakpoint
CREATE INDEX "quote_repair_tasks_quote_id_idx" ON "quote_repair_tasks" USING btree ("quote_id");