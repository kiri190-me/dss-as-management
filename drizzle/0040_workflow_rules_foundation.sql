CREATE TYPE "public"."repair_status" AS ENUM('WAITING_INTAKE_INSPECTION', 'WAITING_KYOSAN_REPLY', 'WAITING_PO', 'WAITING_PARTS_SUPPLY', 'IN_REPAIR', 'WAITING_SHIPMENT_APPROVAL', 'WAITING_SHIPMENT', 'SHIPMENT_COMPLETED');--> statement-breakpoint
CREATE TYPE "public"."workflow_step_category" AS ENUM('TECHNICAL', 'BUSINESS', 'PARTS_SHIPMENT');--> statement-breakpoint
CREATE TYPE "public"."workflow_transition_action" AS ENUM('STEP_ADVANCED', 'STEP_RETURNED', 'SHIPMENT_COMPLETED');--> statement-breakpoint
CREATE TABLE "workflow_transitions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workflow_version_id" uuid NOT NULL,
	"action_code" "workflow_transition_action" NOT NULL,
	"from_step_id" uuid NOT NULL,
	"to_step_id" uuid NOT NULL,
	"allowed_roles" "role_code"[] NOT NULL,
	"requires_assigned_engineer" boolean DEFAULT false NOT NULL,
	"requires_reason" boolean DEFAULT false NOT NULL,
	"required_approval_type" "repair_case_approval_type",
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "workflow_transitions_allowed_roles_not_empty" CHECK (array_length("workflow_transitions"."allowed_roles", 1) >= 1)
);
--> statement-breakpoint
ALTER TABLE "workflow_steps" ADD COLUMN "repair_status" "repair_status";--> statement-breakpoint
ALTER TABLE "workflow_steps" ADD COLUMN "category" "workflow_step_category";--> statement-breakpoint
ALTER TABLE "workflow_transitions" ADD CONSTRAINT "workflow_transitions_workflow_version_id_workflow_versions_id_fk" FOREIGN KEY ("workflow_version_id") REFERENCES "public"."workflow_versions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_transitions" ADD CONSTRAINT "workflow_transitions_from_step_id_workflow_steps_id_fk" FOREIGN KEY ("from_step_id") REFERENCES "public"."workflow_steps"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_transitions" ADD CONSTRAINT "workflow_transitions_to_step_id_workflow_steps_id_fk" FOREIGN KEY ("to_step_id") REFERENCES "public"."workflow_steps"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "workflow_transitions_version_action_from_unique" ON "workflow_transitions" USING btree ("workflow_version_id","action_code","from_step_id");--> statement-breakpoint
CREATE INDEX "workflow_transitions_version_idx" ON "workflow_transitions" USING btree ("workflow_version_id");