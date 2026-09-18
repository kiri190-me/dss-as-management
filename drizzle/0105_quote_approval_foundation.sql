CREATE TYPE "public"."quote_approval_status" AS ENUM('REQUESTED', 'APPROVED', 'REJECTED');--> statement-breakpoint
ALTER TYPE "public"."shipment_approval_route_scope" ADD VALUE 'QUOTE';--> statement-breakpoint
CREATE TABLE "quote_approvals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"quote_id" uuid,
	"status" "quote_approval_status" DEFAULT 'REQUESTED' NOT NULL,
	"requested_by_user_id" uuid NOT NULL,
	"requested_at" timestamp with time zone DEFAULT now() NOT NULL,
	"request_reason" text,
	"assigned_approver_user_id" uuid,
	"route_id" uuid,
	"route_step_order" integer,
	"decided_by_user_id" uuid,
	"decided_at" timestamp with time zone,
	"decision_reason" text,
	"quote_version_at_request" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "quote_approvals_decision_metadata" CHECK (
        (status = 'REQUESTED' AND decided_by_user_id IS NULL AND decided_at IS NULL AND decision_reason IS NULL)
        OR
        (status = 'APPROVED' AND decided_by_user_id IS NOT NULL AND decided_at IS NOT NULL)
        OR
        (status = 'REJECTED' AND decided_by_user_id IS NOT NULL AND decided_at IS NOT NULL AND decision_reason IS NOT NULL)
      ),
	CONSTRAINT "quote_approvals_route_columns_together" CHECK ((route_id IS NULL AND route_step_order IS NULL) OR (route_id IS NOT NULL AND route_step_order IS NOT NULL)),
	CONSTRAINT "quote_approvals_route_step_order_positive" CHECK (route_step_order IS NULL OR route_step_order >= 1),
	CONSTRAINT "quote_approvals_quote_version_positive" CHECK (quote_version_at_request >= 1)
);
--> statement-breakpoint
ALTER TABLE "quote_approvals" ADD CONSTRAINT "quote_approvals_quote_id_quotes_id_fk" FOREIGN KEY ("quote_id") REFERENCES "public"."quotes"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quote_approvals" ADD CONSTRAINT "quote_approvals_requested_by_user_id_users_id_fk" FOREIGN KEY ("requested_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quote_approvals" ADD CONSTRAINT "quote_approvals_assigned_approver_user_id_users_id_fk" FOREIGN KEY ("assigned_approver_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quote_approvals" ADD CONSTRAINT "quote_approvals_route_id_shipment_approval_routes_id_fk" FOREIGN KEY ("route_id") REFERENCES "public"."shipment_approval_routes"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quote_approvals" ADD CONSTRAINT "quote_approvals_decided_by_user_id_users_id_fk" FOREIGN KEY ("decided_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "quote_approvals_one_active_request" ON "quote_approvals" USING btree ("quote_id") WHERE status = 'REQUESTED';--> statement-breakpoint
CREATE INDEX "quote_approvals_quote_id_idx" ON "quote_approvals" USING btree ("quote_id");--> statement-breakpoint
CREATE INDEX "quote_approvals_requested_by_user_id_idx" ON "quote_approvals" USING btree ("requested_by_user_id");--> statement-breakpoint
CREATE INDEX "quote_approvals_assigned_approver_user_id_idx" ON "quote_approvals" USING btree ("assigned_approver_user_id");