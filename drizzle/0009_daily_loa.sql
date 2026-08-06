CREATE TYPE "public"."procedure_validation_resolution_status" AS ENUM('UNRESOLVED', 'RESOLVED_WITH_GRAPH_CHANGE', 'RESOLVED_NO_CHANGE', 'DEFERRED');--> statement-breakpoint
CREATE TYPE "public"."procedure_validation_resolution_action_type" AS ENUM('ADD_EDGE', 'BIND_SOURCE', 'BIND_TARGET', 'RETARGET_EDGE', 'RELABEL_EDGE', 'MARK_NO_CHANGE', 'DEFER', 'REOPEN', 'ROLLBACK_EDGE');--> statement-breakpoint
CREATE TABLE "procedure_validation_resolution_history" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"validation_issue_id" uuid NOT NULL,
	"procedure_template_id" uuid NOT NULL,
	"action_type" "procedure_validation_resolution_action_type" NOT NULL,
	"before_state" jsonb,
	"after_state" jsonb,
	"selected_node_id" uuid,
	"affected_edge_id" uuid,
	"branch_type" "procedure_template_branch_type",
	"note" text,
	"actor_user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DROP INDEX "procedure_template_validation_issues_unresolved_idx";--> statement-breakpoint
ALTER TABLE "procedure_template_validation_issues" ADD COLUMN "raw_evidence" jsonb;--> statement-breakpoint
ALTER TABLE "procedure_template_validation_issues" ADD COLUMN "resolution_status" "procedure_validation_resolution_status" DEFAULT 'UNRESOLVED' NOT NULL;--> statement-breakpoint
ALTER TABLE "procedure_validation_resolution_history" ADD CONSTRAINT "procedure_validation_resolution_history_validation_issue_id_procedure_template_validation_issues_id_fk" FOREIGN KEY ("validation_issue_id") REFERENCES "public"."procedure_template_validation_issues"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "procedure_validation_resolution_history" ADD CONSTRAINT "procedure_validation_resolution_history_procedure_template_id_procedure_templates_id_fk" FOREIGN KEY ("procedure_template_id") REFERENCES "public"."procedure_templates"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "procedure_validation_resolution_history" ADD CONSTRAINT "procedure_validation_resolution_history_selected_node_id_procedure_template_nodes_id_fk" FOREIGN KEY ("selected_node_id") REFERENCES "public"."procedure_template_nodes"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "procedure_validation_resolution_history" ADD CONSTRAINT "procedure_validation_resolution_history_affected_edge_id_procedure_template_edges_id_fk" FOREIGN KEY ("affected_edge_id") REFERENCES "public"."procedure_template_edges"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "procedure_validation_resolution_history" ADD CONSTRAINT "procedure_validation_resolution_history_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "procedure_validation_resolution_history_issue_id_idx" ON "procedure_validation_resolution_history" USING btree ("validation_issue_id");--> statement-breakpoint
CREATE INDEX "procedure_validation_resolution_history_template_id_idx" ON "procedure_validation_resolution_history" USING btree ("procedure_template_id");--> statement-breakpoint
CREATE INDEX "procedure_template_validation_issues_unresolved_idx" ON "procedure_template_validation_issues" USING btree ("procedure_template_id","severity","resolution_status");