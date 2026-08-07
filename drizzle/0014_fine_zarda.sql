CREATE TYPE "public"."inventory_part_request_action_type" AS ENUM('SUBMITTED', 'ISSUED', 'REJECTED', 'CANCELLED', 'PARTIALLY_CLOSED');--> statement-breakpoint
CREATE TYPE "public"."inventory_part_request_idempotency_operation" AS ENUM('CREATE_REQUEST', 'ISSUE', 'CANCEL', 'REJECT', 'PARTIALLY_CLOSE');--> statement-breakpoint
CREATE TYPE "public"."inventory_part_request_status" AS ENUM('PENDING', 'PARTIALLY_ISSUED', 'FULLY_ISSUED', 'PARTIALLY_CLOSED', 'REJECTED', 'CANCELLED');--> statement-breakpoint
CREATE TABLE "inventory_part_request_history" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"request_id" uuid NOT NULL,
	"request_issue_id" uuid,
	"action_type" "inventory_part_request_action_type" NOT NULL,
	"before_state" jsonb,
	"after_state" jsonb,
	"reason" text,
	"actor_user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "inventory_part_request_history_issue_linkage_consistent" CHECK (("inventory_part_request_history"."action_type" = 'ISSUED') = ("inventory_part_request_history"."request_issue_id" IS NOT NULL)),
	CONSTRAINT "inventory_part_request_history_reason_required_for_terminal_actions" CHECK ("inventory_part_request_history"."action_type" NOT IN ('REJECTED', 'CANCELLED', 'PARTIALLY_CLOSED') OR ("inventory_part_request_history"."reason" IS NOT NULL AND btrim("inventory_part_request_history"."reason") <> ''))
);
--> statement-breakpoint
CREATE TABLE "inventory_part_request_idempotency_keys" (
	"idempotency_key" uuid PRIMARY KEY NOT NULL,
	"requester_user_id" uuid NOT NULL,
	"operation_type" "inventory_part_request_idempotency_operation" NOT NULL,
	"status" "idempotency_key_status" DEFAULT 'PROCESSING' NOT NULL,
	"request_fingerprint" text NOT NULL,
	"request_id" uuid,
	"response_snapshot" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	CONSTRAINT "inventory_part_request_idempotency_keys_succeeded_has_request" CHECK ("inventory_part_request_idempotency_keys"."status" <> 'SUCCEEDED' OR ("inventory_part_request_idempotency_keys"."request_id" IS NOT NULL AND "inventory_part_request_idempotency_keys"."response_snapshot" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "inventory_part_request_issues" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"request_id" uuid NOT NULL,
	"issued_by_user_id" uuid NOT NULL,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "inventory_part_request_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"request_id" uuid NOT NULL,
	"part_id" uuid NOT NULL,
	"requested_quantity" integer NOT NULL,
	"issued_quantity" integer DEFAULT 0 NOT NULL,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "inventory_part_request_items_requested_quantity_positive" CHECK ("inventory_part_request_items"."requested_quantity" > 0),
	CONSTRAINT "inventory_part_request_items_issued_quantity_not_negative" CHECK ("inventory_part_request_items"."issued_quantity" >= 0),
	CONSTRAINT "inventory_part_request_items_issued_not_over_requested" CHECK ("inventory_part_request_items"."issued_quantity" <= "inventory_part_request_items"."requested_quantity")
);
--> statement-breakpoint
CREATE TABLE "inventory_part_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"repair_case_id" uuid NOT NULL,
	"requested_by_user_id" uuid NOT NULL,
	"status" "inventory_part_request_status" DEFAULT 'PENDING' NOT NULL,
	"note" text,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "stock_transactions" ADD COLUMN "request_item_id" uuid;--> statement-breakpoint
ALTER TABLE "stock_transactions" ADD COLUMN "request_issue_id" uuid;--> statement-breakpoint
ALTER TABLE "inventory_part_request_history" ADD CONSTRAINT "inventory_part_request_history_request_id_inventory_part_requests_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."inventory_part_requests"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_part_request_history" ADD CONSTRAINT "inventory_part_request_history_request_issue_id_inventory_part_request_issues_id_fk" FOREIGN KEY ("request_issue_id") REFERENCES "public"."inventory_part_request_issues"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_part_request_history" ADD CONSTRAINT "inventory_part_request_history_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_part_request_idempotency_keys" ADD CONSTRAINT "inventory_part_request_idempotency_keys_requester_user_id_users_id_fk" FOREIGN KEY ("requester_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_part_request_idempotency_keys" ADD CONSTRAINT "inventory_part_request_idempotency_keys_request_id_inventory_part_requests_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."inventory_part_requests"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_part_request_issues" ADD CONSTRAINT "inventory_part_request_issues_request_id_inventory_part_requests_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."inventory_part_requests"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_part_request_issues" ADD CONSTRAINT "inventory_part_request_issues_issued_by_user_id_users_id_fk" FOREIGN KEY ("issued_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_part_request_items" ADD CONSTRAINT "inventory_part_request_items_request_id_inventory_part_requests_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."inventory_part_requests"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_part_request_items" ADD CONSTRAINT "inventory_part_request_items_part_id_parts_id_fk" FOREIGN KEY ("part_id") REFERENCES "public"."parts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_part_requests" ADD CONSTRAINT "inventory_part_requests_repair_case_id_repair_cases_id_fk" FOREIGN KEY ("repair_case_id") REFERENCES "public"."repair_cases"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_part_requests" ADD CONSTRAINT "inventory_part_requests_requested_by_user_id_users_id_fk" FOREIGN KEY ("requested_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "inventory_part_request_history_request_id_idx" ON "inventory_part_request_history" USING btree ("request_id");--> statement-breakpoint
CREATE INDEX "inventory_part_request_history_created_at_idx" ON "inventory_part_request_history" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "inventory_part_request_idempotency_keys_requester_user_id_idx" ON "inventory_part_request_idempotency_keys" USING btree ("requester_user_id");--> statement-breakpoint
CREATE INDEX "inventory_part_request_idempotency_keys_expires_at_idx" ON "inventory_part_request_idempotency_keys" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "inventory_part_request_issues_request_id_idx" ON "inventory_part_request_issues" USING btree ("request_id");--> statement-breakpoint
CREATE INDEX "inventory_part_request_issues_created_at_idx" ON "inventory_part_request_issues" USING btree ("created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "inventory_part_request_items_request_part_unique" ON "inventory_part_request_items" USING btree ("request_id","part_id");--> statement-breakpoint
CREATE INDEX "inventory_part_request_items_part_id_idx" ON "inventory_part_request_items" USING btree ("part_id");--> statement-breakpoint
CREATE INDEX "inventory_part_requests_repair_case_id_idx" ON "inventory_part_requests" USING btree ("repair_case_id");--> statement-breakpoint
CREATE INDEX "inventory_part_requests_requested_by_user_id_idx" ON "inventory_part_requests" USING btree ("requested_by_user_id");--> statement-breakpoint
CREATE INDEX "inventory_part_requests_status_idx" ON "inventory_part_requests" USING btree ("status");--> statement-breakpoint
ALTER TABLE "stock_transactions" ADD CONSTRAINT "stock_transactions_request_item_id_inventory_part_request_items_id_fk" FOREIGN KEY ("request_item_id") REFERENCES "public"."inventory_part_request_items"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_transactions" ADD CONSTRAINT "stock_transactions_request_issue_id_inventory_part_request_issues_id_fk" FOREIGN KEY ("request_issue_id") REFERENCES "public"."inventory_part_request_issues"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "stock_transactions_request_item_id_idx" ON "stock_transactions" USING btree ("request_item_id");--> statement-breakpoint
CREATE INDEX "stock_transactions_request_issue_id_idx" ON "stock_transactions" USING btree ("request_issue_id");--> statement-breakpoint
ALTER TABLE "stock_transactions" ADD CONSTRAINT "stock_transactions_request_item_only_on_use" CHECK ("stock_transactions"."request_item_id" IS NULL OR "stock_transactions"."transaction_type" = 'USE');--> statement-breakpoint
ALTER TABLE "stock_transactions" ADD CONSTRAINT "stock_transactions_request_issue_only_on_use" CHECK ("stock_transactions"."request_issue_id" IS NULL OR "stock_transactions"."transaction_type" = 'USE');--> statement-breakpoint
ALTER TABLE "stock_transactions" ADD CONSTRAINT "stock_transactions_request_linkage_consistent" CHECK (("stock_transactions"."request_item_id" IS NULL) = ("stock_transactions"."request_issue_id" IS NULL));