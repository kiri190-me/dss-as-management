CREATE TYPE "public"."procedure_case_execution_action_type" AS ENUM('EXECUTION_STARTED', 'NODE_ADDED', 'NODE_STARTED', 'NODE_COMPLETED', 'NODE_SKIPPED', 'NODE_BLOCKED', 'NODE_REOPENED', 'NODE_MEMO_UPDATED');--> statement-breakpoint
CREATE TYPE "public"."procedure_case_execution_node_status" AS ENUM('PENDING', 'IN_PROGRESS', 'COMPLETED', 'SKIPPED', 'BLOCKED');--> statement-breakpoint
CREATE TABLE "procedure_case_execution_history" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"execution_id" uuid NOT NULL,
	"execution_node_id" uuid,
	"action_type" "procedure_case_execution_action_type" NOT NULL,
	"before_state" jsonb,
	"after_state" jsonb,
	"reason" text,
	"actor_user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "procedure_case_execution_nodes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"execution_id" uuid NOT NULL,
	"procedure_template_node_id" uuid,
	"extra_task_title" text,
	"extra_task_instructions" text,
	"status" "procedure_case_execution_node_status" DEFAULT 'PENDING' NOT NULL,
	"selected_outgoing_edge_id" uuid,
	"assigned_engineer_id" uuid,
	"started_by" uuid,
	"started_at" timestamp with time zone,
	"completed_by" uuid,
	"completed_at" timestamp with time zone,
	"work_memo" text,
	"last_action_reason" text,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "procedure_case_execution_nodes_extra_task_needs_title" CHECK ("procedure_case_execution_nodes"."procedure_template_node_id" is not null or "procedure_case_execution_nodes"."extra_task_title" is not null)
);
--> statement-breakpoint
CREATE TABLE "procedure_case_executions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"repair_case_id" uuid NOT NULL,
	"procedure_template_id" uuid NOT NULL,
	"started_by" uuid NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"is_deleted" boolean DEFAULT false NOT NULL,
	"deleted_at" timestamp with time zone,
	"deleted_by" uuid,
	"delete_reason" text
);
--> statement-breakpoint
ALTER TABLE "procedure_case_execution_history" ADD CONSTRAINT "procedure_case_execution_history_execution_id_procedure_case_executions_id_fk" FOREIGN KEY ("execution_id") REFERENCES "public"."procedure_case_executions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "procedure_case_execution_history" ADD CONSTRAINT "procedure_case_execution_history_execution_node_id_procedure_case_execution_nodes_id_fk" FOREIGN KEY ("execution_node_id") REFERENCES "public"."procedure_case_execution_nodes"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "procedure_case_execution_history" ADD CONSTRAINT "procedure_case_execution_history_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "procedure_case_execution_nodes" ADD CONSTRAINT "procedure_case_execution_nodes_execution_id_procedure_case_executions_id_fk" FOREIGN KEY ("execution_id") REFERENCES "public"."procedure_case_executions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "procedure_case_execution_nodes" ADD CONSTRAINT "procedure_case_execution_nodes_procedure_template_node_id_procedure_template_nodes_id_fk" FOREIGN KEY ("procedure_template_node_id") REFERENCES "public"."procedure_template_nodes"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "procedure_case_execution_nodes" ADD CONSTRAINT "procedure_case_execution_nodes_selected_outgoing_edge_id_procedure_template_edges_id_fk" FOREIGN KEY ("selected_outgoing_edge_id") REFERENCES "public"."procedure_template_edges"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "procedure_case_execution_nodes" ADD CONSTRAINT "procedure_case_execution_nodes_assigned_engineer_id_users_id_fk" FOREIGN KEY ("assigned_engineer_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "procedure_case_execution_nodes" ADD CONSTRAINT "procedure_case_execution_nodes_started_by_users_id_fk" FOREIGN KEY ("started_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "procedure_case_execution_nodes" ADD CONSTRAINT "procedure_case_execution_nodes_completed_by_users_id_fk" FOREIGN KEY ("completed_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "procedure_case_executions" ADD CONSTRAINT "procedure_case_executions_repair_case_id_repair_cases_id_fk" FOREIGN KEY ("repair_case_id") REFERENCES "public"."repair_cases"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "procedure_case_executions" ADD CONSTRAINT "procedure_case_executions_procedure_template_id_procedure_templates_id_fk" FOREIGN KEY ("procedure_template_id") REFERENCES "public"."procedure_templates"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "procedure_case_executions" ADD CONSTRAINT "procedure_case_executions_started_by_users_id_fk" FOREIGN KEY ("started_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "procedure_case_executions" ADD CONSTRAINT "procedure_case_executions_deleted_by_users_id_fk" FOREIGN KEY ("deleted_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "procedure_case_execution_history_execution_id_idx" ON "procedure_case_execution_history" USING btree ("execution_id");--> statement-breakpoint
CREATE INDEX "procedure_case_execution_history_execution_node_id_idx" ON "procedure_case_execution_history" USING btree ("execution_node_id");--> statement-breakpoint
CREATE UNIQUE INDEX "procedure_case_execution_nodes_one_per_template_node" ON "procedure_case_execution_nodes" USING btree ("execution_id","procedure_template_node_id") WHERE procedure_template_node_id is not null;--> statement-breakpoint
CREATE INDEX "procedure_case_execution_nodes_execution_id_idx" ON "procedure_case_execution_nodes" USING btree ("execution_id");--> statement-breakpoint
CREATE INDEX "procedure_case_execution_nodes_status_idx" ON "procedure_case_execution_nodes" USING btree ("execution_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "procedure_case_executions_one_active_per_case" ON "procedure_case_executions" USING btree ("repair_case_id") WHERE is_deleted = false;--> statement-breakpoint
CREATE INDEX "procedure_case_executions_repair_case_id_idx" ON "procedure_case_executions" USING btree ("repair_case_id");--> statement-breakpoint
CREATE INDEX "procedure_case_executions_procedure_template_id_idx" ON "procedure_case_executions" USING btree ("procedure_template_id");