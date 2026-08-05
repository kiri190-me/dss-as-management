CREATE TYPE "public"."status_change_action_type" AS ENUM('STEP_ADVANCED', 'STEP_RETURNED', 'HOLD_STARTED', 'HOLD_RELEASED', 'SHIPMENT_COMPLETED');--> statement-breakpoint
CREATE TABLE "status_change_histories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"repair_case_id" uuid NOT NULL,
	"workflow_version_id" uuid NOT NULL,
	"from_step_id" uuid,
	"to_step_id" uuid,
	"action_type" "status_change_action_type" NOT NULL,
	"actor_user_id" uuid NOT NULL,
	"reason" text,
	"metadata" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "status_change_histories" ADD CONSTRAINT "status_change_histories_repair_case_id_repair_cases_id_fk" FOREIGN KEY ("repair_case_id") REFERENCES "public"."repair_cases"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "status_change_histories" ADD CONSTRAINT "status_change_histories_workflow_version_id_workflow_versions_id_fk" FOREIGN KEY ("workflow_version_id") REFERENCES "public"."workflow_versions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "status_change_histories" ADD CONSTRAINT "status_change_histories_from_step_id_workflow_steps_id_fk" FOREIGN KEY ("from_step_id") REFERENCES "public"."workflow_steps"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "status_change_histories" ADD CONSTRAINT "status_change_histories_to_step_id_workflow_steps_id_fk" FOREIGN KEY ("to_step_id") REFERENCES "public"."workflow_steps"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "status_change_histories" ADD CONSTRAINT "status_change_histories_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "status_change_histories_repair_case_id_created_at_idx" ON "status_change_histories" USING btree ("repair_case_id","created_at");--> statement-breakpoint
CREATE INDEX "status_change_histories_actor_user_id_idx" ON "status_change_histories" USING btree ("actor_user_id");