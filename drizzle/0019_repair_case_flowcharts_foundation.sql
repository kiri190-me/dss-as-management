CREATE TYPE "public"."repair_case_flowchart_node_type" AS ENUM('START', 'TASK', 'INSPECTION', 'DECISION', 'CORRECTIVE_ACTION', 'DOCUMENT_REFERENCE', 'END');--> statement-breakpoint
CREATE TYPE "public"."repair_case_flowchart_branch_type" AS ENUM('DEFAULT', 'NORMAL', 'NG', 'YES', 'NO', 'RETRY', 'LOOP_BACK', 'CUSTOM');--> statement-breakpoint
CREATE TYPE "public"."repair_case_flowchart_edit_action_type" AS ENUM('CREATE_FLOWCHART', 'UPDATE_FLOWCHART_METADATA', 'SOFT_DELETE_FLOWCHART', 'CREATE_NODE', 'UPDATE_NODE', 'CHANGE_NODE_TYPE', 'DELETE_NODE', 'CREATE_EDGE', 'UPDATE_EDGE', 'RETARGET_EDGE', 'DELETE_EDGE', 'SAVE_LAYOUT', 'SAVE_EDGE_ROUTE');--> statement-breakpoint
CREATE TYPE "public"."repair_case_flowchart_edit_history_origin" AS ENUM('USER_EDIT', 'UNDO', 'REDO', 'RESTORE');--> statement-breakpoint
CREATE TABLE "repair_case_flowcharts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"repair_case_id" uuid NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"created_by" uuid NOT NULL,
	"updated_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"is_deleted" boolean DEFAULT false NOT NULL,
	"deleted_at" timestamp with time zone,
	"deleted_by" uuid,
	"delete_reason" text
);
--> statement-breakpoint
CREATE TABLE "repair_case_flowchart_nodes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"flowchart_id" uuid NOT NULL,
	"node_type" "repair_case_flowchart_node_type" NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"position_x" double precision DEFAULT 0 NOT NULL,
	"position_y" double precision DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "repair_case_flowchart_edges" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"flowchart_id" uuid NOT NULL,
	"from_node_id" uuid NOT NULL,
	"to_node_id" uuid NOT NULL,
	"branch_type" "repair_case_flowchart_branch_type" NOT NULL,
	"branch_label" text,
	"route_points" jsonb
);
--> statement-breakpoint
CREATE TABLE "repair_case_flowchart_edit_history" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"flowchart_id" uuid NOT NULL,
	"action_type" "repair_case_flowchart_edit_action_type" NOT NULL,
	"node_id" uuid,
	"edge_id" uuid,
	"before_state" jsonb,
	"after_state" jsonb,
	"reason" text,
	"actor_user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"change_group_id" uuid NOT NULL,
	"sequence_number" bigint GENERATED ALWAYS AS IDENTITY (sequence name "repair_case_flowchart_edit_history_sequence_number_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"origin" "repair_case_flowchart_edit_history_origin" DEFAULT 'USER_EDIT' NOT NULL,
	"source_group_id" uuid,
	"restore_target_group_id" uuid,
	CONSTRAINT "repair_case_flowchart_edit_history_origin_consistency" CHECK (("repair_case_flowchart_edit_history"."origin" = 'USER_EDIT' AND "repair_case_flowchart_edit_history"."source_group_id" IS NULL AND "repair_case_flowchart_edit_history"."restore_target_group_id" IS NULL)
        OR ("repair_case_flowchart_edit_history"."origin" IN ('UNDO', 'REDO') AND "repair_case_flowchart_edit_history"."source_group_id" IS NOT NULL AND "repair_case_flowchart_edit_history"."restore_target_group_id" IS NULL)
        OR ("repair_case_flowchart_edit_history"."origin" = 'RESTORE' AND "repair_case_flowchart_edit_history"."source_group_id" IS NULL AND "repair_case_flowchart_edit_history"."restore_target_group_id" IS NOT NULL))
);
--> statement-breakpoint
ALTER TABLE "repair_case_flowcharts" ADD CONSTRAINT "repair_case_flowcharts_repair_case_id_repair_cases_id_fk" FOREIGN KEY ("repair_case_id") REFERENCES "public"."repair_cases"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "repair_case_flowcharts" ADD CONSTRAINT "repair_case_flowcharts_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "repair_case_flowcharts" ADD CONSTRAINT "repair_case_flowcharts_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "repair_case_flowcharts" ADD CONSTRAINT "repair_case_flowcharts_deleted_by_users_id_fk" FOREIGN KEY ("deleted_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "repair_case_flowchart_nodes" ADD CONSTRAINT "repair_case_flowchart_nodes_flowchart_id_repair_case_flowcharts_id_fk" FOREIGN KEY ("flowchart_id") REFERENCES "public"."repair_case_flowcharts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "repair_case_flowchart_edges" ADD CONSTRAINT "repair_case_flowchart_edges_flowchart_id_repair_case_flowcharts_id_fk" FOREIGN KEY ("flowchart_id") REFERENCES "public"."repair_case_flowcharts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "repair_case_flowcharts_repair_case_id_idx" ON "repair_case_flowcharts" USING btree ("repair_case_id");--> statement-breakpoint
CREATE INDEX "repair_case_flowcharts_repair_case_id_not_deleted_idx" ON "repair_case_flowcharts" USING btree ("repair_case_id") WHERE is_deleted = false;--> statement-breakpoint
CREATE INDEX "repair_case_flowchart_nodes_flowchart_id_idx" ON "repair_case_flowchart_nodes" USING btree ("flowchart_id");--> statement-breakpoint
CREATE UNIQUE INDEX "repair_case_flowchart_nodes_flowchart_id_id_unique" ON "repair_case_flowchart_nodes" USING btree ("flowchart_id","id");--> statement-breakpoint
ALTER TABLE "repair_case_flowchart_edges" ADD CONSTRAINT "repair_case_flowchart_edges_from_node_ownership_fk" FOREIGN KEY ("flowchart_id","from_node_id") REFERENCES "public"."repair_case_flowchart_nodes"("flowchart_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "repair_case_flowchart_edges" ADD CONSTRAINT "repair_case_flowchart_edges_to_node_ownership_fk" FOREIGN KEY ("flowchart_id","to_node_id") REFERENCES "public"."repair_case_flowchart_nodes"("flowchart_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "repair_case_flowchart_edit_history" ADD CONSTRAINT "repair_case_flowchart_edit_history_flowchart_id_repair_case_flowcharts_id_fk" FOREIGN KEY ("flowchart_id") REFERENCES "public"."repair_case_flowcharts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "repair_case_flowchart_edit_history" ADD CONSTRAINT "repair_case_flowchart_edit_history_node_id_repair_case_flowchart_nodes_id_fk" FOREIGN KEY ("node_id") REFERENCES "public"."repair_case_flowchart_nodes"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "repair_case_flowchart_edit_history" ADD CONSTRAINT "repair_case_flowchart_edit_history_edge_id_repair_case_flowchart_edges_id_fk" FOREIGN KEY ("edge_id") REFERENCES "public"."repair_case_flowchart_edges"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "repair_case_flowchart_edit_history" ADD CONSTRAINT "repair_case_flowchart_edit_history_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "repair_case_flowchart_edges_flowchart_id_idx" ON "repair_case_flowchart_edges" USING btree ("flowchart_id");--> statement-breakpoint
CREATE INDEX "repair_case_flowchart_edges_from_node_id_idx" ON "repair_case_flowchart_edges" USING btree ("from_node_id");--> statement-breakpoint
CREATE INDEX "repair_case_flowchart_edges_to_node_id_idx" ON "repair_case_flowchart_edges" USING btree ("to_node_id");--> statement-breakpoint
CREATE INDEX "repair_case_flowchart_edit_history_flowchart_id_idx" ON "repair_case_flowchart_edit_history" USING btree ("flowchart_id");--> statement-breakpoint
CREATE INDEX "repair_case_flowchart_edit_history_node_id_idx" ON "repair_case_flowchart_edit_history" USING btree ("node_id");--> statement-breakpoint
CREATE INDEX "repair_case_flowchart_edit_history_edge_id_idx" ON "repair_case_flowchart_edit_history" USING btree ("edge_id");--> statement-breakpoint
CREATE UNIQUE INDEX "repair_case_flowchart_edit_history_sequence_number_unique" ON "repair_case_flowchart_edit_history" USING btree ("sequence_number");--> statement-breakpoint
CREATE INDEX "repair_case_flowchart_edit_history_flowchart_sequence_idx" ON "repair_case_flowchart_edit_history" USING btree ("flowchart_id","sequence_number");