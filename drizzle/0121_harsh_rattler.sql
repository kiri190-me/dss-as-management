CREATE TABLE "procedure_case_execution_edges" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"execution_id" uuid NOT NULL,
	"from_node_id" uuid NOT NULL,
	"to_node_id" uuid NOT NULL,
	"branch_type" "procedure_template_branch_type" NOT NULL,
	"branch_label" text,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"is_deleted" boolean DEFAULT false NOT NULL,
	"deleted_at" timestamp with time zone,
	"deleted_by" uuid,
	"delete_reason" text,
	CONSTRAINT "procedure_case_execution_edges_no_self_loop" CHECK (from_node_id <> to_node_id)
);
--> statement-breakpoint
ALTER TABLE "procedure_case_execution_nodes" ADD COLUMN "extra_task_node_type" "procedure_template_node_type";--> statement-breakpoint
ALTER TABLE "procedure_case_execution_nodes" ADD COLUMN "is_deleted" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "procedure_case_execution_nodes" ADD COLUMN "deleted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "procedure_case_execution_nodes" ADD COLUMN "deleted_by" uuid;--> statement-breakpoint
ALTER TABLE "procedure_case_execution_nodes" ADD COLUMN "delete_reason" text;--> statement-breakpoint
ALTER TABLE "procedure_case_execution_edges" ADD CONSTRAINT "procedure_case_execution_edges_execution_id_procedure_case_executions_id_fk" FOREIGN KEY ("execution_id") REFERENCES "public"."procedure_case_executions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "procedure_case_execution_edges" ADD CONSTRAINT "procedure_case_execution_edges_from_node_id_procedure_case_execution_nodes_id_fk" FOREIGN KEY ("from_node_id") REFERENCES "public"."procedure_case_execution_nodes"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "procedure_case_execution_edges" ADD CONSTRAINT "procedure_case_execution_edges_to_node_id_procedure_case_execution_nodes_id_fk" FOREIGN KEY ("to_node_id") REFERENCES "public"."procedure_case_execution_nodes"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "procedure_case_execution_edges" ADD CONSTRAINT "procedure_case_execution_edges_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "procedure_case_execution_edges" ADD CONSTRAINT "procedure_case_execution_edges_deleted_by_users_id_fk" FOREIGN KEY ("deleted_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "procedure_case_execution_edges_execution_id_idx" ON "procedure_case_execution_edges" USING btree ("execution_id");--> statement-breakpoint
CREATE INDEX "procedure_case_execution_edges_from_node_id_idx" ON "procedure_case_execution_edges" USING btree ("from_node_id");--> statement-breakpoint
CREATE INDEX "procedure_case_execution_edges_to_node_id_idx" ON "procedure_case_execution_edges" USING btree ("to_node_id");--> statement-breakpoint
ALTER TABLE "procedure_case_execution_nodes" ADD CONSTRAINT "procedure_case_execution_nodes_deleted_by_users_id_fk" FOREIGN KEY ("deleted_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;