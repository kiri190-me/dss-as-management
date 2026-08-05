CREATE TYPE "public"."repair_case_approval_status" AS ENUM('REQUESTED', 'APPROVED', 'REJECTED');--> statement-breakpoint
CREATE TYPE "public"."repair_case_approval_type" AS ENUM('REPAIR_INSPECTION', 'FINAL_SHIPMENT');--> statement-breakpoint
CREATE TABLE "repair_case_approvals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"repair_case_id" uuid NOT NULL,
	"approval_type" "repair_case_approval_type" NOT NULL,
	"status" "repair_case_approval_status" DEFAULT 'REQUESTED' NOT NULL,
	"requested_by_user_id" uuid NOT NULL,
	"requested_at" timestamp with time zone DEFAULT now() NOT NULL,
	"request_reason" text,
	"decided_by_user_id" uuid,
	"decided_at" timestamp with time zone,
	"decision_reason" text,
	"delegated_from_user_id" uuid,
	"repair_case_version_at_request" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "repair_case_approvals_decision_metadata" CHECK (
        (status = 'REQUESTED' AND decided_by_user_id IS NULL AND decided_at IS NULL AND decision_reason IS NULL)
        OR
        (status = 'APPROVED' AND decided_by_user_id IS NOT NULL AND decided_at IS NOT NULL)
        OR
        (status = 'REJECTED' AND decided_by_user_id IS NOT NULL AND decided_at IS NOT NULL AND decision_reason IS NOT NULL)
      ),
	CONSTRAINT "repair_case_approvals_delegation_only_for_final_shipment" CHECK (delegated_from_user_id IS NULL OR approval_type = 'FINAL_SHIPMENT')
);
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "is_shipment_representative" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "repair_case_approvals" ADD CONSTRAINT "repair_case_approvals_repair_case_id_repair_cases_id_fk" FOREIGN KEY ("repair_case_id") REFERENCES "public"."repair_cases"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "repair_case_approvals" ADD CONSTRAINT "repair_case_approvals_requested_by_user_id_users_id_fk" FOREIGN KEY ("requested_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "repair_case_approvals" ADD CONSTRAINT "repair_case_approvals_decided_by_user_id_users_id_fk" FOREIGN KEY ("decided_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "repair_case_approvals" ADD CONSTRAINT "repair_case_approvals_delegated_from_user_id_users_id_fk" FOREIGN KEY ("delegated_from_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "repair_case_approvals_one_active_request" ON "repair_case_approvals" USING btree ("repair_case_id","approval_type") WHERE status = 'REQUESTED';--> statement-breakpoint
CREATE INDEX "repair_case_approvals_repair_case_id_idx" ON "repair_case_approvals" USING btree ("repair_case_id");--> statement-breakpoint
CREATE INDEX "repair_case_approvals_requested_by_user_id_idx" ON "repair_case_approvals" USING btree ("requested_by_user_id");