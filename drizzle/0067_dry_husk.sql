CREATE TABLE "customer_portal_sync_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"customer_link_id" uuid NOT NULL,
	"item_count" integer NOT NULL,
	"synced_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "customer_repair_links" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"customer_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"label" text,
	"revoked_at" timestamp with time zone,
	"revoked_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid
);
--> statement-breakpoint
CREATE TABLE "customer_repair_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source_id" uuid NOT NULL,
	"customer_link_id" uuid NOT NULL,
	"customer_id" uuid NOT NULL,
	"form_kind" text DEFAULT 'RF' NOT NULL,
	"company_name" text NOT NULL,
	"contact_name" text NOT NULL,
	"contact_phone" text NOT NULL,
	"contact_email" text,
	"product_model_name" text NOT NULL,
	"lot_number" text NOT NULL,
	"serial_number" text NOT NULL,
	"end_user" text NOT NULL,
	"return_address" text,
	"chamber_info" text,
	"pc1_generator_lot_number" text,
	"pc1_generator_model" text,
	"pc1_matcher_lot_number" text,
	"pc1_matcher_model" text,
	"pc2_generator_lot_number" text,
	"pc2_generator_model" text,
	"pc2_matcher_lot_number" text,
	"pc2_matcher_model" text,
	"pc3_generator_lot_number" text,
	"pc3_generator_model" text,
	"pc3_matcher_lot_number" text,
	"pc3_matcher_model" text,
	"alarm_name" text,
	"symptom_description" text NOT NULL,
	"process_source_power" text,
	"process_bias_power" text,
	"issue_power" text,
	"normal_position" text,
	"issue_position" text,
	"customer_actions" text,
	"issue_process_scope" text,
	"issue_intermittency" text,
	"issue_timing" text,
	"issue_process_condition" text,
	"chamber_counts" text,
	"customer_inspection_detail" text,
	"status" text DEFAULT 'NEW' NOT NULL,
	"converted_repair_case_id" uuid,
	"converted_at" timestamp with time zone,
	"converted_by" uuid,
	"rejected_at" timestamp with time zone,
	"rejected_by" uuid,
	"reject_reason" text,
	"submitted_at" timestamp with time zone NOT NULL,
	"pulled_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "customer_repair_requests_status_check" CHECK ("customer_repair_requests"."status" IN ('NEW', 'CONVERTING', 'CONVERTED', 'REJECTED'))
);
--> statement-breakpoint
CREATE TABLE "customer_status_options" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"label" text NOT NULL,
	"display_order" integer DEFAULT 0 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid
);
--> statement-breakpoint
CREATE TABLE "repair_case_customer_status" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"repair_case_id" uuid NOT NULL,
	"status_option_id" uuid,
	"note" text,
	"version" integer DEFAULT 1 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid
);
--> statement-breakpoint
ALTER TABLE "customer_portal_sync_log" ADD CONSTRAINT "customer_portal_sync_log_customer_link_id_customer_repair_links_id_fk" FOREIGN KEY ("customer_link_id") REFERENCES "public"."customer_repair_links"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_repair_links" ADD CONSTRAINT "customer_repair_links_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_repair_links" ADD CONSTRAINT "customer_repair_links_revoked_by_users_id_fk" FOREIGN KEY ("revoked_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_repair_links" ADD CONSTRAINT "customer_repair_links_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_repair_requests" ADD CONSTRAINT "customer_repair_requests_customer_link_id_customer_repair_links_id_fk" FOREIGN KEY ("customer_link_id") REFERENCES "public"."customer_repair_links"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_repair_requests" ADD CONSTRAINT "customer_repair_requests_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_repair_requests" ADD CONSTRAINT "customer_repair_requests_converted_repair_case_id_repair_cases_id_fk" FOREIGN KEY ("converted_repair_case_id") REFERENCES "public"."repair_cases"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_repair_requests" ADD CONSTRAINT "customer_repair_requests_converted_by_users_id_fk" FOREIGN KEY ("converted_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_repair_requests" ADD CONSTRAINT "customer_repair_requests_rejected_by_users_id_fk" FOREIGN KEY ("rejected_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_status_options" ADD CONSTRAINT "customer_status_options_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_status_options" ADD CONSTRAINT "customer_status_options_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "repair_case_customer_status" ADD CONSTRAINT "repair_case_customer_status_repair_case_id_repair_cases_id_fk" FOREIGN KEY ("repair_case_id") REFERENCES "public"."repair_cases"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "repair_case_customer_status" ADD CONSTRAINT "repair_case_customer_status_status_option_id_customer_status_options_id_fk" FOREIGN KEY ("status_option_id") REFERENCES "public"."customer_status_options"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "repair_case_customer_status" ADD CONSTRAINT "repair_case_customer_status_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "customer_repair_links_token_hash_unique" ON "customer_repair_links" USING btree ("token_hash");--> statement-breakpoint
CREATE UNIQUE INDEX "customer_repair_links_active_customer_unique" ON "customer_repair_links" USING btree ("customer_id") WHERE revoked_at IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "customer_repair_requests_source_id_unique" ON "customer_repair_requests" USING btree ("source_id");--> statement-breakpoint
CREATE INDEX "customer_repair_requests_new_idx" ON "customer_repair_requests" USING btree ("submitted_at") WHERE status = 'NEW';--> statement-breakpoint
CREATE INDEX "customer_repair_requests_customer_id_idx" ON "customer_repair_requests" USING btree ("customer_id");--> statement-breakpoint
CREATE UNIQUE INDEX "customer_status_options_active_label_unique" ON "customer_status_options" USING btree ("label") WHERE is_active = true;--> statement-breakpoint
CREATE UNIQUE INDEX "repair_case_customer_status_case_unique" ON "repair_case_customer_status" USING btree ("repair_case_id");