CREATE TYPE "public"."attachment_category" AS ENUM('INTAKE_PHOTO', 'EXTERNAL_CONDITION', 'INSPECTION_REPORT', 'REPAIR_REPORT', 'KYOSAN_DOCUMENT', 'CUSTOMER_DOCUMENT', 'OSCILLOSCOPE_DATA', 'LOG_FILE', 'FIRMWARE', 'CIRCUIT_DIAGRAM', 'OTHER');--> statement-breakpoint
CREATE TYPE "public"."attachment_malware_scan_status" AS ENUM('NOT_SCANNED', 'PENDING', 'CLEAN', 'INFECTED', 'FAILED');--> statement-breakpoint
CREATE TABLE "attachments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"repair_case_id" uuid,
	"category" "attachment_category" NOT NULL,
	"original_file_name" text NOT NULL,
	"stored_path" text NOT NULL,
	"preview_path" text,
	"mime_type" text NOT NULL,
	"file_size" bigint NOT NULL,
	"checksum_sha256" text NOT NULL,
	"malware_scan_status" "attachment_malware_scan_status" DEFAULT 'NOT_SCANNED' NOT NULL,
	"description" text,
	"uploaded_by" uuid NOT NULL,
	"uploaded_at" timestamp with time zone DEFAULT now() NOT NULL,
	"is_deleted" boolean DEFAULT false NOT NULL,
	"deleted_at" timestamp with time zone,
	"deleted_by" uuid,
	"delete_reason" text
);
--> statement-breakpoint
ALTER TABLE "attachments" ADD CONSTRAINT "attachments_repair_case_id_repair_cases_id_fk" FOREIGN KEY ("repair_case_id") REFERENCES "public"."repair_cases"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attachments" ADD CONSTRAINT "attachments_uploaded_by_users_id_fk" FOREIGN KEY ("uploaded_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attachments" ADD CONSTRAINT "attachments_deleted_by_users_id_fk" FOREIGN KEY ("deleted_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "attachments_repair_case_id_not_deleted_idx" ON "attachments" USING btree ("repair_case_id") WHERE is_deleted = false;--> statement-breakpoint
CREATE INDEX "attachments_checksum_sha256_idx" ON "attachments" USING btree ("checksum_sha256");