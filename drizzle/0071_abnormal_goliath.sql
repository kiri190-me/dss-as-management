CREATE TABLE "repair_labor_settings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"equipment_kind" "product_model_kind" NOT NULL,
	"hourly_rate" numeric(15, 2) NOT NULL,
	"base_cost" numeric(15, 2),
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	CONSTRAINT "repair_labor_settings_hourly_rate_not_negative" CHECK ("repair_labor_settings"."hourly_rate" >= 0),
	CONSTRAINT "repair_labor_settings_base_cost_not_negative" CHECK ("repair_labor_settings"."base_cost" >= 0)
);
--> statement-breakpoint
CREATE TABLE "repair_task_catalog" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"equipment_kind" "product_model_kind" NOT NULL,
	"task_name" text NOT NULL,
	"hours" integer NOT NULL,
	"display_order" integer NOT NULL,
	"is_deleted" boolean DEFAULT false NOT NULL,
	"deleted_at" timestamp with time zone,
	"deleted_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	CONSTRAINT "repair_task_catalog_hours_positive" CHECK ("repair_task_catalog"."hours" > 0)
);
--> statement-breakpoint
ALTER TABLE "repair_labor_settings" ADD CONSTRAINT "repair_labor_settings_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "repair_task_catalog" ADD CONSTRAINT "repair_task_catalog_deleted_by_users_id_fk" FOREIGN KEY ("deleted_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "repair_task_catalog" ADD CONSTRAINT "repair_task_catalog_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "repair_task_catalog" ADD CONSTRAINT "repair_task_catalog_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "repair_labor_settings_kind_unique" ON "repair_labor_settings" USING btree ("equipment_kind");--> statement-breakpoint
CREATE UNIQUE INDEX "repair_task_catalog_kind_name_not_deleted_unique" ON "repair_task_catalog" USING btree ("equipment_kind","task_name") WHERE is_deleted = false;--> statement-breakpoint
CREATE INDEX "repair_task_catalog_kind_idx" ON "repair_task_catalog" USING btree ("equipment_kind");