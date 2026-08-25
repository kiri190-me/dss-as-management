CREATE TABLE "weekly_report_deliveries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"week_start_date" date NOT NULL,
	"repair_case_id" uuid NOT NULL,
	"note" text,
	"display_order" integer,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid
);
--> statement-breakpoint
ALTER TABLE "weekly_report_deliveries" ADD CONSTRAINT "weekly_report_deliveries_repair_case_id_repair_cases_id_fk" FOREIGN KEY ("repair_case_id") REFERENCES "public"."repair_cases"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "weekly_report_deliveries" ADD CONSTRAINT "weekly_report_deliveries_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "weekly_report_deliveries" ADD CONSTRAINT "weekly_report_deliveries_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "weekly_report_deliveries_week_start_date_idx" ON "weekly_report_deliveries" USING btree ("week_start_date");--> statement-breakpoint
CREATE INDEX "weekly_report_deliveries_repair_case_id_idx" ON "weekly_report_deliveries" USING btree ("repair_case_id");