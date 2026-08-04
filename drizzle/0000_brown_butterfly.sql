CREATE TYPE "public"."account_approval_status" AS ENUM('PENDING', 'APPROVED');--> statement-breakpoint
CREATE TYPE "public"."role_code" AS ENUM('SUPER_ADMIN', 'ADMIN', 'AS_ENGINEER', 'SALES', 'INVENTORY_MANAGER');--> statement-breakpoint
CREATE TYPE "public"."workflow_type" AS ENUM('MATCHER', 'PAID_GENERATOR', 'WARRANTY_GENERATOR');--> statement-breakpoint
CREATE TYPE "public"."workflow_version_status" AS ENUM('DRAFT', 'PUBLISHED', 'ARCHIVED');--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"password_hash" text,
	"name" text NOT NULL,
	"role" "role_code" NOT NULL,
	"approval_status" "account_approval_status" DEFAULT 'PENDING' NOT NULL,
	"is_developer" boolean DEFAULT false NOT NULL,
	"failed_login_count" integer DEFAULT 0 NOT NULL,
	"locked_at" timestamp with time zone,
	"is_active" boolean DEFAULT true NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"is_deleted" boolean DEFAULT false NOT NULL,
	"deleted_at" timestamp with time zone,
	"deleted_by" uuid,
	"delete_reason" text
);
--> statement-breakpoint
CREATE TABLE "customers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"contact_name" text NOT NULL,
	"contact_email" text NOT NULL,
	"contact_phone" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"is_deleted" boolean DEFAULT false NOT NULL,
	"deleted_at" timestamp with time zone,
	"deleted_by" uuid,
	"delete_reason" text
);
--> statement-breakpoint
CREATE TABLE "end_users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"customer_id" uuid NOT NULL,
	"name" text NOT NULL,
	"contact_name" text NOT NULL,
	"contact_email" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"is_deleted" boolean DEFAULT false NOT NULL,
	"deleted_at" timestamp with time zone,
	"deleted_by" uuid,
	"delete_reason" text
);
--> statement-breakpoint
CREATE TABLE "products" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"model_name" text NOT NULL,
	"serial_number" text,
	"lot_number" text,
	"part_number" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"is_deleted" boolean DEFAULT false NOT NULL,
	"deleted_at" timestamp with time zone,
	"deleted_by" uuid,
	"delete_reason" text
);
--> statement-breakpoint
CREATE TABLE "exception_statuses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"label" text NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "workflow_steps" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workflow_version_id" uuid NOT NULL,
	"step_order" integer NOT NULL,
	"key" text NOT NULL,
	"label" text NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "workflow_templates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" "workflow_type" NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "workflow_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workflow_template_id" uuid NOT NULL,
	"version_number" integer NOT NULL,
	"status" "workflow_version_status" DEFAULT 'DRAFT' NOT NULL,
	"is_current" boolean DEFAULT false NOT NULL,
	"published_at" timestamp with time zone,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "repair_cases" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"intake_number" text NOT NULL,
	"customer_id" uuid NOT NULL,
	"end_user_id" uuid,
	"product_id" uuid NOT NULL,
	"workflow_version_id" uuid NOT NULL,
	"current_workflow_step_id" uuid NOT NULL,
	"exception_status_id" uuid,
	"assigned_engineer_id" uuid,
	"received_at" date NOT NULL,
	"customer_requested_due_date" date,
	"internal_target_shipment_date" date,
	"actual_shipment_date" date,
	"is_locked" boolean DEFAULT false NOT NULL,
	"reported_symptom" text,
	"intake_inspection_result" text,
	"current_diagnosis_summary" text,
	"next_planned_action" text,
	"notes" text,
	"accessory_list" text,
	"external_condition_summary" text,
	"reason_for_removal" text,
	"contact_name_snapshot" text,
	"contact_phone_snapshot" text,
	"contact_email_snapshot" text,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"is_deleted" boolean DEFAULT false NOT NULL,
	"deleted_at" timestamp with time zone,
	"deleted_by" uuid,
	"delete_reason" text,
	CONSTRAINT "repair_cases_intake_number_format" CHECK ("repair_cases"."intake_number" ~ '^D[0-9]{2}(0[1-9]|1[0-2])[0-9]{2}$')
);
--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_deleted_by_users_id_fk" FOREIGN KEY ("deleted_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customers" ADD CONSTRAINT "customers_deleted_by_users_id_fk" FOREIGN KEY ("deleted_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "end_users" ADD CONSTRAINT "end_users_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "end_users" ADD CONSTRAINT "end_users_deleted_by_users_id_fk" FOREIGN KEY ("deleted_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_deleted_by_users_id_fk" FOREIGN KEY ("deleted_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_steps" ADD CONSTRAINT "workflow_steps_workflow_version_id_workflow_versions_id_fk" FOREIGN KEY ("workflow_version_id") REFERENCES "public"."workflow_versions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_versions" ADD CONSTRAINT "workflow_versions_workflow_template_id_workflow_templates_id_fk" FOREIGN KEY ("workflow_template_id") REFERENCES "public"."workflow_templates"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_versions" ADD CONSTRAINT "workflow_versions_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "repair_cases" ADD CONSTRAINT "repair_cases_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "repair_cases" ADD CONSTRAINT "repair_cases_end_user_id_end_users_id_fk" FOREIGN KEY ("end_user_id") REFERENCES "public"."end_users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "repair_cases" ADD CONSTRAINT "repair_cases_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "repair_cases" ADD CONSTRAINT "repair_cases_workflow_version_id_workflow_versions_id_fk" FOREIGN KEY ("workflow_version_id") REFERENCES "public"."workflow_versions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "repair_cases" ADD CONSTRAINT "repair_cases_current_workflow_step_id_workflow_steps_id_fk" FOREIGN KEY ("current_workflow_step_id") REFERENCES "public"."workflow_steps"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "repair_cases" ADD CONSTRAINT "repair_cases_exception_status_id_exception_statuses_id_fk" FOREIGN KEY ("exception_status_id") REFERENCES "public"."exception_statuses"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "repair_cases" ADD CONSTRAINT "repair_cases_assigned_engineer_id_users_id_fk" FOREIGN KEY ("assigned_engineer_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "repair_cases" ADD CONSTRAINT "repair_cases_deleted_by_users_id_fk" FOREIGN KEY ("deleted_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "users_email_unique" ON "users" USING btree ("email");--> statement-breakpoint
CREATE INDEX "users_not_deleted_idx" ON "users" USING btree ("is_deleted") WHERE is_deleted = false;--> statement-breakpoint
CREATE INDEX "customers_not_deleted_idx" ON "customers" USING btree ("is_deleted") WHERE is_deleted = false;--> statement-breakpoint
CREATE INDEX "end_users_customer_id_idx" ON "end_users" USING btree ("customer_id");--> statement-breakpoint
CREATE INDEX "end_users_not_deleted_idx" ON "end_users" USING btree ("is_deleted") WHERE is_deleted = false;--> statement-breakpoint
CREATE UNIQUE INDEX "products_model_lot_serial_unique" ON "products" USING btree ("model_name","lot_number","serial_number");--> statement-breakpoint
CREATE INDEX "products_model_name_idx" ON "products" USING btree ("model_name");--> statement-breakpoint
CREATE INDEX "products_not_deleted_idx" ON "products" USING btree ("is_deleted") WHERE is_deleted = false;--> statement-breakpoint
CREATE UNIQUE INDEX "exception_statuses_code_unique" ON "exception_statuses" USING btree ("code");--> statement-breakpoint
CREATE UNIQUE INDEX "workflow_steps_version_order_unique" ON "workflow_steps" USING btree ("workflow_version_id","step_order");--> statement-breakpoint
CREATE UNIQUE INDEX "workflow_steps_version_key_unique" ON "workflow_steps" USING btree ("workflow_version_id","key");--> statement-breakpoint
CREATE UNIQUE INDEX "workflow_templates_code_unique" ON "workflow_templates" USING btree ("code");--> statement-breakpoint
CREATE UNIQUE INDEX "workflow_versions_template_version_unique" ON "workflow_versions" USING btree ("workflow_template_id","version_number");--> statement-breakpoint
CREATE UNIQUE INDEX "workflow_versions_current_per_template_unique" ON "workflow_versions" USING btree ("workflow_template_id") WHERE status = 'PUBLISHED' AND is_current = true;--> statement-breakpoint
CREATE UNIQUE INDEX "repair_cases_intake_number_unique" ON "repair_cases" USING btree ("intake_number");--> statement-breakpoint
CREATE INDEX "repair_cases_customer_id_idx" ON "repair_cases" USING btree ("customer_id");--> statement-breakpoint
CREATE INDEX "repair_cases_end_user_id_idx" ON "repair_cases" USING btree ("end_user_id");--> statement-breakpoint
CREATE INDEX "repair_cases_product_id_idx" ON "repair_cases" USING btree ("product_id");--> statement-breakpoint
CREATE INDEX "repair_cases_workflow_version_id_idx" ON "repair_cases" USING btree ("workflow_version_id");--> statement-breakpoint
CREATE INDEX "repair_cases_current_workflow_step_id_idx" ON "repair_cases" USING btree ("current_workflow_step_id");--> statement-breakpoint
CREATE INDEX "repair_cases_exception_status_id_idx" ON "repair_cases" USING btree ("exception_status_id");--> statement-breakpoint
CREATE INDEX "repair_cases_assigned_engineer_id_idx" ON "repair_cases" USING btree ("assigned_engineer_id");--> statement-breakpoint
CREATE INDEX "repair_cases_created_at_idx" ON "repair_cases" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "repair_cases_not_deleted_idx" ON "repair_cases" USING btree ("is_deleted") WHERE is_deleted = false;