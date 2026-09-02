CREATE TYPE "public"."service_report_cause" AS ENUM('MANUFACTURING_DEFECT', 'PART_DEFECT', 'AGING', 'TRANSPORT_DAMAGE', 'STORAGE_DAMAGE', 'SPEC_SHORTFALL', 'INSPECTION_MISS', 'MISHANDLING', 'NOT_REPRODUCED', 'OTHER');--> statement-breakpoint
CREATE TYPE "public"."service_report_kind" AS ENUM('INSPECTION', 'REPAIR');--> statement-breakpoint
CREATE TYPE "public"."service_report_line_section" AS ENUM('FINDINGS', 'ACTIONS', 'SUMMARY', 'REMARK');--> statement-breakpoint
CREATE TYPE "public"."service_report_occurred_on_mode" AS ENUM('DATE', 'TEXT');--> statement-breakpoint
CREATE TABLE "service_report_causes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"service_report_id" uuid NOT NULL,
	"cause" "service_report_cause" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "service_report_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"service_report_id" uuid NOT NULL,
	"section" "service_report_line_section" NOT NULL,
	"line_no" integer NOT NULL,
	"text" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "service_reports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"repair_case_id" uuid NOT NULL,
	"kind" "service_report_kind" NOT NULL,
	"report_number_prefix" text,
	"report_number_middle" text NOT NULL,
	"report_number_tail" text NOT NULL,
	"issued_on" date NOT NULL,
	"customer_name_text" text NOT NULL,
	"customer_text" text,
	"received_on" date,
	"occurrence_place" text,
	"occurrence_place_detail" text,
	"occurred_on_mode" "service_report_occurred_on_mode",
	"occurred_on_date" date,
	"occurred_on_text" text,
	"product_name" text,
	"product_category" text,
	"model_name_text" text,
	"lot_number_text" text,
	"serial_number_text" text,
	"manufactured_year" integer,
	"manufactured_month" integer,
	"used_years" integer,
	"used_months" integer,
	"situation_request" text,
	"situation_detail" text,
	"on_site_repair" boolean DEFAULT false NOT NULL,
	"replacement_delivery" boolean DEFAULT false NOT NULL,
	"goods_receipt_checked" boolean DEFAULT false NOT NULL,
	"goods_receipt_on" date,
	"goods_receipt_number" text,
	"completion_checked" boolean DEFAULT false NOT NULL,
	"completion_on" date,
	"repair_number" text,
	"findings_intro" text,
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
ALTER TABLE "service_report_causes" ADD CONSTRAINT "service_report_causes_service_report_id_service_reports_id_fk" FOREIGN KEY ("service_report_id") REFERENCES "public"."service_reports"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_report_lines" ADD CONSTRAINT "service_report_lines_service_report_id_service_reports_id_fk" FOREIGN KEY ("service_report_id") REFERENCES "public"."service_reports"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_reports" ADD CONSTRAINT "service_reports_repair_case_id_repair_cases_id_fk" FOREIGN KEY ("repair_case_id") REFERENCES "public"."repair_cases"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_reports" ADD CONSTRAINT "service_reports_deleted_by_users_id_fk" FOREIGN KEY ("deleted_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_reports" ADD CONSTRAINT "service_reports_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_reports" ADD CONSTRAINT "service_reports_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "service_report_causes_report_cause_unique" ON "service_report_causes" USING btree ("service_report_id","cause");--> statement-breakpoint
CREATE INDEX "service_report_causes_service_report_id_idx" ON "service_report_causes" USING btree ("service_report_id");--> statement-breakpoint
CREATE UNIQUE INDEX "service_report_lines_report_section_line_unique" ON "service_report_lines" USING btree ("service_report_id","section","line_no");--> statement-breakpoint
CREATE INDEX "service_report_lines_service_report_id_idx" ON "service_report_lines" USING btree ("service_report_id");--> statement-breakpoint
CREATE INDEX "service_reports_repair_case_id_not_deleted_idx" ON "service_reports" USING btree ("repair_case_id") WHERE is_deleted = false;--> statement-breakpoint
CREATE INDEX "service_reports_issued_on_idx" ON "service_reports" USING btree ("issued_on");