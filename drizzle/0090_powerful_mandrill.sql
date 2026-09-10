CREATE TYPE "public"."inventory_part_issue_approval_status" AS ENUM('REQUESTED', 'APPROVED', 'REJECTED');--> statement-breakpoint
CREATE TYPE "public"."inventory_part_issue_request_status" AS ENUM('PENDING_APPROVAL', 'APPROVED', 'EXECUTED', 'REJECTED', 'CANCELLED');--> statement-breakpoint
CREATE TABLE "inventory_part_issue_approvals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"issue_request_id" uuid NOT NULL,
	"status" "inventory_part_issue_approval_status" DEFAULT 'REQUESTED' NOT NULL,
	"route_id" uuid,
	"route_step_order" integer,
	"assigned_approver_user_id" uuid,
	"requested_by_user_id" uuid NOT NULL,
	"requested_at" timestamp with time zone DEFAULT now() NOT NULL,
	"request_reason" text,
	"decided_by_user_id" uuid,
	"decided_at" timestamp with time zone,
	"decision_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "inventory_part_issue_approvals_decision_metadata" CHECK (
        (status = 'REQUESTED' AND decided_by_user_id IS NULL AND decided_at IS NULL AND decision_reason IS NULL)
        OR
        (status = 'APPROVED' AND decided_by_user_id IS NOT NULL AND decided_at IS NOT NULL)
        OR
        (status = 'REJECTED' AND decided_by_user_id IS NOT NULL AND decided_at IS NOT NULL AND decision_reason IS NOT NULL)
      ),
	CONSTRAINT "inventory_part_issue_approvals_route_columns_together" CHECK ((route_id IS NULL AND route_step_order IS NULL) OR (route_id IS NOT NULL AND route_step_order IS NOT NULL)),
	CONSTRAINT "inventory_part_issue_approvals_route_step_order_positive" CHECK (route_step_order IS NULL OR route_step_order >= 1)
);
--> statement-breakpoint
CREATE TABLE "inventory_part_issue_request_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"issue_request_id" uuid NOT NULL,
	"request_item_id" uuid,
	"part_stock_balance_id" uuid NOT NULL,
	"quantity" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "inventory_part_issue_request_items_quantity_positive" CHECK (quantity >= 1)
);
--> statement-breakpoint
CREATE TABLE "inventory_part_issue_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"part_request_id" uuid,
	"repair_case_id" uuid,
	"status" "inventory_part_issue_request_status" DEFAULT 'PENDING_APPROVAL' NOT NULL,
	"requested_by_user_id" uuid NOT NULL,
	"requested_at" timestamp with time zone DEFAULT now() NOT NULL,
	"request_reason" text,
	"destination_note" text,
	"procedure_execution_node_id" uuid,
	"executed_by_user_id" uuid,
	"executed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "inventory_part_issue_requests_execution_metadata" CHECK (
        (status <> 'EXECUTED' AND executed_by_user_id IS NULL AND executed_at IS NULL)
        OR
        (status = 'EXECUTED' AND executed_by_user_id IS NOT NULL AND executed_at IS NOT NULL)
      ),
	CONSTRAINT "inventory_part_issue_requests_direct_use_columns_only_when_direct" CHECK (part_request_id IS NULL OR (repair_case_id IS NULL AND destination_note IS NULL AND procedure_execution_node_id IS NULL)),
	CONSTRAINT "inventory_part_issue_requests_direct_use_has_destination" CHECK (part_request_id IS NOT NULL OR repair_case_id IS NOT NULL OR destination_note IS NOT NULL)
);
--> statement-breakpoint
ALTER TABLE "inventory_part_issue_approvals" ADD CONSTRAINT "inventory_part_issue_approvals_issue_request_id_inventory_part_issue_requests_id_fk" FOREIGN KEY ("issue_request_id") REFERENCES "public"."inventory_part_issue_requests"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_part_issue_approvals" ADD CONSTRAINT "inventory_part_issue_approvals_route_id_shipment_approval_routes_id_fk" FOREIGN KEY ("route_id") REFERENCES "public"."shipment_approval_routes"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_part_issue_approvals" ADD CONSTRAINT "inventory_part_issue_approvals_assigned_approver_user_id_users_id_fk" FOREIGN KEY ("assigned_approver_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_part_issue_approvals" ADD CONSTRAINT "inventory_part_issue_approvals_requested_by_user_id_users_id_fk" FOREIGN KEY ("requested_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_part_issue_approvals" ADD CONSTRAINT "inventory_part_issue_approvals_decided_by_user_id_users_id_fk" FOREIGN KEY ("decided_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_part_issue_request_items" ADD CONSTRAINT "inventory_part_issue_request_items_issue_request_id_inventory_part_issue_requests_id_fk" FOREIGN KEY ("issue_request_id") REFERENCES "public"."inventory_part_issue_requests"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_part_issue_request_items" ADD CONSTRAINT "inventory_part_issue_request_items_request_item_id_inventory_part_request_items_id_fk" FOREIGN KEY ("request_item_id") REFERENCES "public"."inventory_part_request_items"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_part_issue_request_items" ADD CONSTRAINT "inventory_part_issue_request_items_part_stock_balance_id_part_stock_balances_id_fk" FOREIGN KEY ("part_stock_balance_id") REFERENCES "public"."part_stock_balances"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_part_issue_requests" ADD CONSTRAINT "inventory_part_issue_requests_part_request_id_inventory_part_requests_id_fk" FOREIGN KEY ("part_request_id") REFERENCES "public"."inventory_part_requests"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_part_issue_requests" ADD CONSTRAINT "inventory_part_issue_requests_repair_case_id_repair_cases_id_fk" FOREIGN KEY ("repair_case_id") REFERENCES "public"."repair_cases"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_part_issue_requests" ADD CONSTRAINT "inventory_part_issue_requests_requested_by_user_id_users_id_fk" FOREIGN KEY ("requested_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_part_issue_requests" ADD CONSTRAINT "inventory_part_issue_requests_procedure_execution_node_id_procedure_case_execution_nodes_id_fk" FOREIGN KEY ("procedure_execution_node_id") REFERENCES "public"."procedure_case_execution_nodes"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_part_issue_requests" ADD CONSTRAINT "inventory_part_issue_requests_executed_by_user_id_users_id_fk" FOREIGN KEY ("executed_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "inventory_part_issue_approvals_one_active_request" ON "inventory_part_issue_approvals" USING btree ("issue_request_id") WHERE status = 'REQUESTED';--> statement-breakpoint
CREATE INDEX "inventory_part_issue_approvals_issue_request_id_idx" ON "inventory_part_issue_approvals" USING btree ("issue_request_id");--> statement-breakpoint
CREATE INDEX "inventory_part_issue_approvals_requested_by_user_id_idx" ON "inventory_part_issue_approvals" USING btree ("requested_by_user_id");--> statement-breakpoint
CREATE INDEX "inventory_part_issue_approvals_assigned_approver_user_id_idx" ON "inventory_part_issue_approvals" USING btree ("assigned_approver_user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "inventory_part_issue_request_items_balance_unique" ON "inventory_part_issue_request_items" USING btree ("issue_request_id","part_stock_balance_id");--> statement-breakpoint
CREATE INDEX "inventory_part_issue_request_items_issue_request_id_idx" ON "inventory_part_issue_request_items" USING btree ("issue_request_id");--> statement-breakpoint
CREATE INDEX "inventory_part_issue_request_items_request_item_id_idx" ON "inventory_part_issue_request_items" USING btree ("request_item_id");--> statement-breakpoint
CREATE INDEX "inventory_part_issue_request_items_part_stock_balance_id_idx" ON "inventory_part_issue_request_items" USING btree ("part_stock_balance_id");--> statement-breakpoint
CREATE INDEX "inventory_part_issue_requests_part_request_id_idx" ON "inventory_part_issue_requests" USING btree ("part_request_id");--> statement-breakpoint
CREATE INDEX "inventory_part_issue_requests_repair_case_id_idx" ON "inventory_part_issue_requests" USING btree ("repair_case_id");--> statement-breakpoint
CREATE INDEX "inventory_part_issue_requests_requested_by_user_id_idx" ON "inventory_part_issue_requests" USING btree ("requested_by_user_id");--> statement-breakpoint
CREATE INDEX "inventory_part_issue_requests_status_idx" ON "inventory_part_issue_requests" USING btree ("status");