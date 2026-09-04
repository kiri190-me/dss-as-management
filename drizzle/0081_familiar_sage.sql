CREATE TABLE "power_test_tasks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"equipment_kind" "product_model_kind" NOT NULL,
	"task_name" text NOT NULL,
	"display_order" integer NOT NULL,
	"is_deleted" boolean DEFAULT false NOT NULL,
	"deleted_at" timestamp with time zone,
	"deleted_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid
);
--> statement-breakpoint
ALTER TABLE "power_test_tasks" ADD CONSTRAINT "power_test_tasks_deleted_by_users_id_fk" FOREIGN KEY ("deleted_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "power_test_tasks" ADD CONSTRAINT "power_test_tasks_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "power_test_tasks" ADD CONSTRAINT "power_test_tasks_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "power_test_tasks_kind_name_not_deleted_unique" ON "power_test_tasks" USING btree ("equipment_kind","task_name") WHERE is_deleted = false;--> statement-breakpoint
CREATE INDEX "power_test_tasks_kind_idx" ON "power_test_tasks" USING btree ("equipment_kind");