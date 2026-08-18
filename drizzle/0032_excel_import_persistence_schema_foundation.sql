CREATE TYPE "public"."excel_import_attempt_status" AS ENUM('STARTED', 'SUCCEEDED', 'FAILED', 'ABORTED');--> statement-breakpoint
CREATE TYPE "public"."excel_import_batch_status" AS ENUM('PREVIEWED', 'REVIEW_REQUIRED', 'READY', 'IMPORTING', 'PARTIAL_SUCCESS', 'COMPLETED', 'FAILED', 'EXPIRED');--> statement-breakpoint
CREATE TYPE "public"."excel_import_row_status" AS ENUM('PENDING_REVIEW', 'MAPPING_REQUIRED', 'IMPORT_READY', 'IMPORTING', 'IMPORTED', 'FAILED', 'SKIPPED_EXISTING', 'EXCLUDED', 'EXPIRED');--> statement-breakpoint
CREATE TYPE "public"."excel_import_source_classification" AS ENUM('SOURCE_READY', 'SOURCE_REVIEW');--> statement-breakpoint
CREATE TABLE "excel_import_batches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source_file_sha256" text NOT NULL,
	"parser_version" text NOT NULL,
	"source_sheet" text NOT NULL,
	"header_fingerprint" text NOT NULL,
	"original_file_name" text NOT NULL,
	"file_size_bytes" bigint NOT NULL,
	"mime_type" text NOT NULL,
	"status" "excel_import_batch_status" NOT NULL,
	"summary" jsonb NOT NULL,
	"uploaded_by" uuid NOT NULL,
	"uploaded_at" timestamp with time zone DEFAULT now() NOT NULL,
	"confirmed_by" uuid,
	"confirmed_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"preview_expires_at" timestamp with time zone NOT NULL,
	"sensitive_data_retain_until" timestamp with time zone,
	"sensitive_data_purged_at" timestamp with time zone,
	"source_file_deleted_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "excel_import_batches_source_sha256_format" CHECK ("excel_import_batches"."source_file_sha256" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "excel_import_batches_source_sheet" CHECK ("excel_import_batches"."source_sheet" = '목록'),
	CONSTRAINT "excel_import_batches_nonblank_metadata" CHECK (btrim("excel_import_batches"."parser_version") <> '' and btrim("excel_import_batches"."header_fingerprint") <> '' and btrim("excel_import_batches"."original_file_name") <> '' and btrim("excel_import_batches"."mime_type") <> ''),
	CONSTRAINT "excel_import_batches_sanitized_file_name" CHECK ("excel_import_batches"."original_file_name" not in ('.', '..') and position('/' in "excel_import_batches"."original_file_name") = 0 and position(chr(92) in "excel_import_batches"."original_file_name") = 0),
	CONSTRAINT "excel_import_batches_file_size_nonnegative" CHECK ("excel_import_batches"."file_size_bytes" >= 0),
	CONSTRAINT "excel_import_batches_version_positive" CHECK ("excel_import_batches"."version" > 0),
	CONSTRAINT "excel_import_batches_confirmation_pair" CHECK (("excel_import_batches"."confirmed_by" is null) = ("excel_import_batches"."confirmed_at" is null)),
	CONSTRAINT "excel_import_batches_status_confirmation" CHECK (("excel_import_batches"."status" in ('PREVIEWED', 'REVIEW_REQUIRED', 'READY', 'EXPIRED') and "excel_import_batches"."confirmed_at" is null) or ("excel_import_batches"."status" in ('IMPORTING', 'PARTIAL_SUCCESS', 'COMPLETED', 'FAILED') and "excel_import_batches"."confirmed_at" is not null)),
	CONSTRAINT "excel_import_batches_status_completion" CHECK (("excel_import_batches"."status" in ('PARTIAL_SUCCESS', 'COMPLETED', 'FAILED') and "excel_import_batches"."completed_at" is not null) or ("excel_import_batches"."status" in ('PREVIEWED', 'REVIEW_REQUIRED', 'READY', 'IMPORTING', 'EXPIRED') and "excel_import_batches"."completed_at" is null)),
	CONSTRAINT "excel_import_batches_preview_expiration_after_upload" CHECK ("excel_import_batches"."preview_expires_at" > "excel_import_batches"."uploaded_at"),
	CONSTRAINT "excel_import_batches_source_deletion_after_upload" CHECK ("excel_import_batches"."source_file_deleted_at" is null or "excel_import_batches"."source_file_deleted_at" >= "excel_import_batches"."uploaded_at"),
	CONSTRAINT "excel_import_batches_retention_after_completion" CHECK ("excel_import_batches"."sensitive_data_retain_until" is null or "excel_import_batches"."completed_at" is null or "excel_import_batches"."sensitive_data_retain_until" >= "excel_import_batches"."completed_at"),
	CONSTRAINT "excel_import_batches_sensitive_purge_timing" CHECK ("excel_import_batches"."sensitive_data_purged_at" is null or ("excel_import_batches"."sensitive_data_retain_until" is not null and "excel_import_batches"."sensitive_data_purged_at" >= "excel_import_batches"."sensitive_data_retain_until"))
);
--> statement-breakpoint
CREATE TABLE "excel_import_row_attempts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"import_row_id" uuid NOT NULL,
	"attempt_number" integer NOT NULL,
	"status" "excel_import_attempt_status" NOT NULL,
	"requested_by" uuid NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	"error_code" text,
	"result_repair_case_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "excel_import_row_attempts_number_positive" CHECK ("excel_import_row_attempts"."attempt_number" > 0),
	CONSTRAINT "excel_import_row_attempts_state_shape" CHECK (("excel_import_row_attempts"."status" = 'STARTED' and "excel_import_row_attempts"."completed_at" is null and "excel_import_row_attempts"."error_code" is null and "excel_import_row_attempts"."result_repair_case_id" is null) or ("excel_import_row_attempts"."status" = 'SUCCEEDED' and "excel_import_row_attempts"."completed_at" is not null and "excel_import_row_attempts"."error_code" is null) or ("excel_import_row_attempts"."status" = 'FAILED' and "excel_import_row_attempts"."completed_at" is not null and "excel_import_row_attempts"."error_code" is not null and btrim("excel_import_row_attempts"."error_code") <> '' and "excel_import_row_attempts"."result_repair_case_id" is null) or ("excel_import_row_attempts"."status" = 'ABORTED' and "excel_import_row_attempts"."completed_at" is not null and "excel_import_row_attempts"."result_repair_case_id" is null))
);
--> statement-breakpoint
CREATE TABLE "excel_import_rows" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"batch_id" uuid NOT NULL,
	"source_sheet" text NOT NULL,
	"source_row_number" integer NOT NULL,
	"source_row_fingerprint" text NOT NULL,
	"raw_data" jsonb,
	"normalized_data" jsonb,
	"issues" jsonb NOT NULL,
	"corrections" jsonb,
	"decisions" jsonb,
	"source_classification" "excel_import_source_classification" NOT NULL,
	"import_status" "excel_import_row_status" NOT NULL,
	"customer_id" uuid,
	"end_user_id" uuid,
	"product_model_id" uuid,
	"product_id" uuid,
	"assigned_engineer_id" uuid,
	"workflow_version_id" uuid,
	"workflow_step_id" uuid,
	"exception_status_id" uuid,
	"matched_existing_repair_case_id" uuid,
	"result_repair_case_id" uuid,
	"last_error_code" text,
	"last_error_at" timestamp with time zone,
	"imported_by" uuid,
	"imported_at" timestamp with time zone,
	"sensitive_data_purged_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "excel_import_rows_source_row_minimum" CHECK ("excel_import_rows"."source_row_number" >= 4),
	CONSTRAINT "excel_import_rows_source_sheet" CHECK ("excel_import_rows"."source_sheet" = '목록'),
	CONSTRAINT "excel_import_rows_fingerprint_format" CHECK ("excel_import_rows"."source_row_fingerprint" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "excel_import_rows_version_positive" CHECK ("excel_import_rows"."version" > 0),
	CONSTRAINT "excel_import_rows_imported_fields" CHECK (("excel_import_rows"."import_status" = 'IMPORTED' and "excel_import_rows"."imported_by" is not null and "excel_import_rows"."imported_at" is not null) or ("excel_import_rows"."import_status" <> 'IMPORTED' and "excel_import_rows"."result_repair_case_id" is null and "excel_import_rows"."imported_by" is null and "excel_import_rows"."imported_at" is null)),
	CONSTRAINT "excel_import_rows_failed_error" CHECK ("excel_import_rows"."import_status" <> 'FAILED' or ("excel_import_rows"."last_error_code" is not null and btrim("excel_import_rows"."last_error_code") <> '' and "excel_import_rows"."last_error_at" is not null)),
	CONSTRAINT "excel_import_rows_sensitive_purge" CHECK ("excel_import_rows"."sensitive_data_purged_at" is null or ("excel_import_rows"."raw_data" is null and "excel_import_rows"."normalized_data" is null and "excel_import_rows"."corrections" is null and "excel_import_rows"."decisions" is null))
);
--> statement-breakpoint
ALTER TABLE "excel_import_batches" ADD CONSTRAINT "excel_import_batches_uploaded_by_users_id_fk" FOREIGN KEY ("uploaded_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "excel_import_batches" ADD CONSTRAINT "excel_import_batches_confirmed_by_users_id_fk" FOREIGN KEY ("confirmed_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "excel_import_row_attempts" ADD CONSTRAINT "excel_import_row_attempts_import_row_id_excel_import_rows_id_fk" FOREIGN KEY ("import_row_id") REFERENCES "public"."excel_import_rows"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "excel_import_row_attempts" ADD CONSTRAINT "excel_import_row_attempts_requested_by_users_id_fk" FOREIGN KEY ("requested_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "excel_import_row_attempts" ADD CONSTRAINT "excel_import_row_attempts_result_repair_case_id_repair_cases_id_fk" FOREIGN KEY ("result_repair_case_id") REFERENCES "public"."repair_cases"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "excel_import_rows" ADD CONSTRAINT "excel_import_rows_batch_id_excel_import_batches_id_fk" FOREIGN KEY ("batch_id") REFERENCES "public"."excel_import_batches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "excel_import_rows" ADD CONSTRAINT "excel_import_rows_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "excel_import_rows" ADD CONSTRAINT "excel_import_rows_end_user_id_end_users_id_fk" FOREIGN KEY ("end_user_id") REFERENCES "public"."end_users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "excel_import_rows" ADD CONSTRAINT "excel_import_rows_product_model_id_product_models_id_fk" FOREIGN KEY ("product_model_id") REFERENCES "public"."product_models"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "excel_import_rows" ADD CONSTRAINT "excel_import_rows_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "excel_import_rows" ADD CONSTRAINT "excel_import_rows_assigned_engineer_id_users_id_fk" FOREIGN KEY ("assigned_engineer_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "excel_import_rows" ADD CONSTRAINT "excel_import_rows_workflow_version_id_workflow_versions_id_fk" FOREIGN KEY ("workflow_version_id") REFERENCES "public"."workflow_versions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "excel_import_rows" ADD CONSTRAINT "excel_import_rows_workflow_step_id_workflow_steps_id_fk" FOREIGN KEY ("workflow_step_id") REFERENCES "public"."workflow_steps"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "excel_import_rows" ADD CONSTRAINT "excel_import_rows_exception_status_id_exception_statuses_id_fk" FOREIGN KEY ("exception_status_id") REFERENCES "public"."exception_statuses"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "excel_import_rows" ADD CONSTRAINT "excel_import_rows_matched_existing_repair_case_id_repair_cases_id_fk" FOREIGN KEY ("matched_existing_repair_case_id") REFERENCES "public"."repair_cases"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "excel_import_rows" ADD CONSTRAINT "excel_import_rows_result_repair_case_id_repair_cases_id_fk" FOREIGN KEY ("result_repair_case_id") REFERENCES "public"."repair_cases"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "excel_import_rows" ADD CONSTRAINT "excel_import_rows_imported_by_users_id_fk" FOREIGN KEY ("imported_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "excel_import_batches_source_unique" ON "excel_import_batches" USING btree ("source_file_sha256","source_sheet");--> statement-breakpoint
CREATE INDEX "excel_import_batches_status_uploaded_at_idx" ON "excel_import_batches" USING btree ("status","uploaded_at");--> statement-breakpoint
CREATE INDEX "excel_import_batches_uploaded_by_uploaded_at_idx" ON "excel_import_batches" USING btree ("uploaded_by","uploaded_at");--> statement-breakpoint
CREATE INDEX "excel_import_batches_preview_expires_at_idx" ON "excel_import_batches" USING btree ("preview_expires_at");--> statement-breakpoint
CREATE INDEX "excel_import_batches_sensitive_retention_idx" ON "excel_import_batches" USING btree ("sensitive_data_retain_until","sensitive_data_purged_at");--> statement-breakpoint
CREATE UNIQUE INDEX "excel_import_row_attempts_row_number_unique" ON "excel_import_row_attempts" USING btree ("import_row_id","attempt_number");--> statement-breakpoint
CREATE INDEX "excel_import_row_attempts_status_started_at_idx" ON "excel_import_row_attempts" USING btree ("status","started_at");--> statement-breakpoint
CREATE INDEX "excel_import_row_attempts_result_repair_case_idx" ON "excel_import_row_attempts" USING btree ("result_repair_case_id");--> statement-breakpoint
CREATE UNIQUE INDEX "excel_import_rows_batch_sheet_row_unique" ON "excel_import_rows" USING btree ("batch_id","source_sheet","source_row_number");--> statement-breakpoint
CREATE UNIQUE INDEX "excel_import_rows_result_repair_case_unique" ON "excel_import_rows" USING btree ("result_repair_case_id") WHERE result_repair_case_id is not null;--> statement-breakpoint
CREATE INDEX "excel_import_rows_batch_status_idx" ON "excel_import_rows" USING btree ("batch_id","import_status");--> statement-breakpoint
CREATE INDEX "excel_import_rows_batch_source_classification_idx" ON "excel_import_rows" USING btree ("batch_id","source_classification");--> statement-breakpoint
CREATE INDEX "excel_import_rows_source_fingerprint_idx" ON "excel_import_rows" USING btree ("source_row_fingerprint");--> statement-breakpoint
CREATE INDEX "excel_import_rows_matched_repair_case_idx" ON "excel_import_rows" USING btree ("matched_existing_repair_case_id");--> statement-breakpoint
CREATE INDEX "excel_import_rows_sensitive_purge_idx" ON "excel_import_rows" USING btree ("sensitive_data_purged_at");