CREATE TABLE "repair_case_work_records" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"repair_case_id" uuid NOT NULL,
	"author_user_id" uuid NOT NULL,
	"memo" text NOT NULL,
	"related_workflow_step_id" uuid,
	"related_procedure_execution_node_id" uuid,
	"client_request_id" uuid,
	"invalidated_at" timestamp with time zone,
	"invalidated_by" uuid,
	"invalidation_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "repair_case_work_records_memo_not_blank" CHECK (btrim("repair_case_work_records"."memo") <> ''),
	CONSTRAINT "repair_case_work_records_invalidation_all_or_nothing" CHECK (("repair_case_work_records"."invalidated_at" IS NULL AND "repair_case_work_records"."invalidated_by" IS NULL AND "repair_case_work_records"."invalidation_reason" IS NULL)
        OR ("repair_case_work_records"."invalidated_at" IS NOT NULL AND "repair_case_work_records"."invalidated_by" IS NOT NULL AND "repair_case_work_records"."invalidation_reason" IS NOT NULL AND btrim("repair_case_work_records"."invalidation_reason") <> ''))
);
--> statement-breakpoint
ALTER TABLE "repair_case_work_records" ADD CONSTRAINT "repair_case_work_records_repair_case_id_repair_cases_id_fk" FOREIGN KEY ("repair_case_id") REFERENCES "public"."repair_cases"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "repair_case_work_records" ADD CONSTRAINT "repair_case_work_records_author_user_id_users_id_fk" FOREIGN KEY ("author_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "repair_case_work_records" ADD CONSTRAINT "repair_case_work_records_related_workflow_step_id_workflow_steps_id_fk" FOREIGN KEY ("related_workflow_step_id") REFERENCES "public"."workflow_steps"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "repair_case_work_records" ADD CONSTRAINT "repair_case_work_records_related_procedure_execution_node_id_procedure_case_execution_nodes_id_fk" FOREIGN KEY ("related_procedure_execution_node_id") REFERENCES "public"."procedure_case_execution_nodes"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "repair_case_work_records" ADD CONSTRAINT "repair_case_work_records_invalidated_by_users_id_fk" FOREIGN KEY ("invalidated_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "repair_case_work_records_repair_case_client_request_unique" ON "repair_case_work_records" USING btree ("repair_case_id","client_request_id") WHERE client_request_id is not null;--> statement-breakpoint
CREATE INDEX "repair_case_work_records_repair_case_id_created_at_idx" ON "repair_case_work_records" USING btree ("repair_case_id","created_at");--> statement-breakpoint
CREATE INDEX "repair_case_work_records_author_user_id_idx" ON "repair_case_work_records" USING btree ("author_user_id");--> statement-breakpoint
CREATE INDEX "repair_case_work_records_procedure_execution_node_id_idx" ON "repair_case_work_records" USING btree ("related_procedure_execution_node_id") WHERE related_procedure_execution_node_id is not null;