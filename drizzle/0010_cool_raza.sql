CREATE TYPE "public"."procedure_template_edit_action_type" AS ENUM('CREATE_DRAFT_VERSION', 'UPDATE_NODE', 'CHANGE_NODE_TYPE', 'MOVE_NODE', 'UPDATE_EDGE', 'RETARGET_EDGE', 'CREATE_EDGE', 'SAVE_LAYOUT', 'DISCARD_DRAFT_CHANGES', 'VALIDATE_TEMPLATE');--> statement-breakpoint
CREATE TABLE "procedure_template_edit_history" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"procedure_template_id" uuid NOT NULL,
	"action_type" "procedure_template_edit_action_type" NOT NULL,
	"node_id" uuid,
	"edge_id" uuid,
	"before_state" jsonb,
	"after_state" jsonb,
	"reason" text,
	"related_validation_issue_id" uuid,
	"actor_user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "procedure_template_nodes" ADD COLUMN "user_position_x" double precision;--> statement-breakpoint
ALTER TABLE "procedure_template_nodes" ADD COLUMN "user_position_y" double precision;--> statement-breakpoint
ALTER TABLE "procedure_template_edges" ADD COLUMN "cloned_from_edge_id" uuid;--> statement-breakpoint
ALTER TABLE "procedure_template_edit_history" ADD CONSTRAINT "procedure_template_edit_history_procedure_template_id_procedure_templates_id_fk" FOREIGN KEY ("procedure_template_id") REFERENCES "public"."procedure_templates"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "procedure_template_edit_history" ADD CONSTRAINT "procedure_template_edit_history_node_id_procedure_template_nodes_id_fk" FOREIGN KEY ("node_id") REFERENCES "public"."procedure_template_nodes"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "procedure_template_edit_history" ADD CONSTRAINT "procedure_template_edit_history_edge_id_procedure_template_edges_id_fk" FOREIGN KEY ("edge_id") REFERENCES "public"."procedure_template_edges"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "procedure_template_edit_history" ADD CONSTRAINT "procedure_template_edit_history_related_validation_issue_id_procedure_template_validation_issues_id_fk" FOREIGN KEY ("related_validation_issue_id") REFERENCES "public"."procedure_template_validation_issues"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "procedure_template_edit_history" ADD CONSTRAINT "procedure_template_edit_history_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "procedure_template_edit_history_template_id_idx" ON "procedure_template_edit_history" USING btree ("procedure_template_id");--> statement-breakpoint
CREATE INDEX "procedure_template_edit_history_node_id_idx" ON "procedure_template_edit_history" USING btree ("node_id");--> statement-breakpoint
CREATE INDEX "procedure_template_edit_history_edge_id_idx" ON "procedure_template_edit_history" USING btree ("edge_id");--> statement-breakpoint
ALTER TABLE "procedure_template_edges" ADD CONSTRAINT "procedure_template_edges_cloned_from_edge_id_procedure_template_edges_id_fk" FOREIGN KEY ("cloned_from_edge_id") REFERENCES "public"."procedure_template_edges"("id") ON DELETE restrict ON UPDATE no action;