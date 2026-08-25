CREATE TABLE "domestic_orders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"repair_case_id" uuid,
	"intake_number_text" text,
	"customer_id" uuid,
	"display_order" integer,
	"purchase_order_number" text,
	"project_name" text,
	"order_issued_date" date,
	"requested_due_date" date,
	"quote_issued_date" date,
	"quote_number" text,
	"progress_note" text,
	"delivered_date" date,
	"delivered_by" text,
	"tax_invoice_date" date,
	"amount_excluding_vat" numeric(15, 2),
	"payment_completed" boolean DEFAULT false NOT NULL,
	"japan_remittance_note" text,
	"history_note" text,
	"etc_note" text,
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
ALTER TABLE "domestic_orders" ADD CONSTRAINT "domestic_orders_repair_case_id_repair_cases_id_fk" FOREIGN KEY ("repair_case_id") REFERENCES "public"."repair_cases"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "domestic_orders" ADD CONSTRAINT "domestic_orders_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "domestic_orders" ADD CONSTRAINT "domestic_orders_deleted_by_users_id_fk" FOREIGN KEY ("deleted_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "domestic_orders" ADD CONSTRAINT "domestic_orders_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "domestic_orders" ADD CONSTRAINT "domestic_orders_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "domestic_orders_repair_case_id_not_deleted_idx" ON "domestic_orders" USING btree ("repair_case_id") WHERE is_deleted = false;--> statement-breakpoint
CREATE INDEX "domestic_orders_order_issued_date_idx" ON "domestic_orders" USING btree ("order_issued_date");