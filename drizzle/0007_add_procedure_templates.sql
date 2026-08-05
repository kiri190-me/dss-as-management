CREATE TYPE "public"."procedure_equipment_type" AS ENUM('RFG', 'MB');--> statement-breakpoint
CREATE TYPE "public"."procedure_template_source_type" AS ENUM('MANUAL', 'EXCEL_IMPORT');--> statement-breakpoint
CREATE TYPE "public"."procedure_template_status" AS ENUM('DRAFT', 'PUBLISHED', 'ARCHIVED');--> statement-breakpoint
CREATE TYPE "public"."procedure_template_node_type" AS ENUM('START', 'TASK', 'INSPECTION', 'DECISION', 'CORRECTIVE_ACTION', 'CHECKLIST', 'TROUBLESHOOTING', 'DOCUMENT_REFERENCE', 'END');--> statement-breakpoint
CREATE TYPE "public"."procedure_template_branch_type" AS ENUM('DEFAULT', 'NORMAL', 'NG', 'YES', 'NO', 'RETRY', 'LOOP_BACK', 'CUSTOM');--> statement-breakpoint
CREATE TYPE "public"."procedure_validation_severity" AS ENUM('INFO', 'WARNING', 'ERROR');--> statement-breakpoint
CREATE TABLE "procedure_templates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"equipment_type" "procedure_equipment_type" NOT NULL,
	"description" text,
	"status" "procedure_template_status" DEFAULT 'DRAFT' NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"source_type" "procedure_template_source_type" NOT NULL,
	"source_file_name" text,
	"source_file_hash" text,
	"supersedes_template_id" uuid,
	"created_by_user_id" uuid NOT NULL,
	"published_by_user_id" uuid,
	"archived_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"published_at" timestamp with time zone,
	"archived_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "procedure_template_nodes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"procedure_template_id" uuid NOT NULL,
	"node_code" text NOT NULL,
	"node_type" "procedure_template_node_type" NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"objective" text,
	"preparation" text,
	"tools_and_equipment" text,
	"safety_caution" text,
	"instructions" text,
	"expected_normal_result" text,
	"ng_symptoms" text,
	"recommended_corrective_action" text,
	"acceptance_criteria" text,
	"worker_may_add_next_task" boolean DEFAULT true NOT NULL,
	"position_x" double precision DEFAULT 0 NOT NULL,
	"position_y" double precision DEFAULT 0 NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"source_worksheet" text,
	"source_shape_id" text,
	"source_cell_range" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "procedure_template_edges" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"procedure_template_id" uuid NOT NULL,
	"from_node_id" uuid NOT NULL,
	"to_node_id" uuid NOT NULL,
	"branch_type" "procedure_template_branch_type" NOT NULL,
	"branch_label" text,
	"condition_definition" jsonb,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"source_connector_id" text
);
--> statement-breakpoint
CREATE TABLE "procedure_checklist_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"section_id" uuid NOT NULL,
	"item_code" text NOT NULL,
	"title" text NOT NULL,
	"instructions" text,
	"measurement_type" text,
	"measurement_unit" text,
	"min_value" numeric,
	"max_value" numeric,
	"expected_text" text,
	"acceptance_rule" text,
	"required" boolean DEFAULT true NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"source_cell_range" text
);
--> statement-breakpoint
CREATE TABLE "procedure_checklist_sections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"node_id" uuid NOT NULL,
	"title" text NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"source_worksheet" text,
	"source_cell_range" text
);
--> statement-breakpoint
CREATE TABLE "procedure_troubleshooting_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"node_id" uuid NOT NULL,
	"symptom" text NOT NULL,
	"inspection_action" text,
	"normal_next_action" text,
	"ng_action" text,
	"retry_instruction" text,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"source_cell_range" text
);
--> statement-breakpoint
CREATE TABLE "procedure_template_validation_issues" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"procedure_template_id" uuid NOT NULL,
	"severity" "procedure_validation_severity" NOT NULL,
	"issue_type" text NOT NULL,
	"message" text NOT NULL,
	"source_worksheet" text,
	"source_reference" text,
	"resolved_at" timestamp with time zone,
	"resolved_by_user_id" uuid,
	"resolution_note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "procedure_templates" ADD CONSTRAINT "procedure_templates_supersedes_template_id_procedure_templates_id_fk" FOREIGN KEY ("supersedes_template_id") REFERENCES "public"."procedure_templates"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "procedure_templates" ADD CONSTRAINT "procedure_templates_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "procedure_templates" ADD CONSTRAINT "procedure_templates_published_by_user_id_users_id_fk" FOREIGN KEY ("published_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "procedure_templates" ADD CONSTRAINT "procedure_templates_archived_by_user_id_users_id_fk" FOREIGN KEY ("archived_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "procedure_template_nodes" ADD CONSTRAINT "procedure_template_nodes_procedure_template_id_procedure_templates_id_fk" FOREIGN KEY ("procedure_template_id") REFERENCES "public"."procedure_templates"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "procedure_template_edges" ADD CONSTRAINT "procedure_template_edges_procedure_template_id_procedure_templates_id_fk" FOREIGN KEY ("procedure_template_id") REFERENCES "public"."procedure_templates"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "procedure_template_edges" ADD CONSTRAINT "procedure_template_edges_from_node_id_procedure_template_nodes_id_fk" FOREIGN KEY ("from_node_id") REFERENCES "public"."procedure_template_nodes"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "procedure_template_edges" ADD CONSTRAINT "procedure_template_edges_to_node_id_procedure_template_nodes_id_fk" FOREIGN KEY ("to_node_id") REFERENCES "public"."procedure_template_nodes"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "procedure_checklist_items" ADD CONSTRAINT "procedure_checklist_items_section_id_procedure_checklist_sections_id_fk" FOREIGN KEY ("section_id") REFERENCES "public"."procedure_checklist_sections"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "procedure_checklist_sections" ADD CONSTRAINT "procedure_checklist_sections_node_id_procedure_template_nodes_id_fk" FOREIGN KEY ("node_id") REFERENCES "public"."procedure_template_nodes"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "procedure_troubleshooting_entries" ADD CONSTRAINT "procedure_troubleshooting_entries_node_id_procedure_template_nodes_id_fk" FOREIGN KEY ("node_id") REFERENCES "public"."procedure_template_nodes"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "procedure_template_validation_issues" ADD CONSTRAINT "procedure_template_validation_issues_procedure_template_id_procedure_templates_id_fk" FOREIGN KEY ("procedure_template_id") REFERENCES "public"."procedure_templates"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "procedure_template_validation_issues" ADD CONSTRAINT "procedure_template_validation_issues_resolved_by_user_id_users_id_fk" FOREIGN KEY ("resolved_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "procedure_templates_code_version_unique" ON "procedure_templates" USING btree ("code","version");--> statement-breakpoint
CREATE UNIQUE INDEX "procedure_template_nodes_template_code_unique" ON "procedure_template_nodes" USING btree ("procedure_template_id","node_code");--> statement-breakpoint
CREATE INDEX "procedure_template_nodes_template_id_idx" ON "procedure_template_nodes" USING btree ("procedure_template_id");--> statement-breakpoint
CREATE INDEX "procedure_template_edges_template_id_idx" ON "procedure_template_edges" USING btree ("procedure_template_id");--> statement-breakpoint
CREATE INDEX "procedure_template_edges_from_node_id_idx" ON "procedure_template_edges" USING btree ("from_node_id");--> statement-breakpoint
CREATE INDEX "procedure_template_edges_to_node_id_idx" ON "procedure_template_edges" USING btree ("to_node_id");--> statement-breakpoint
CREATE INDEX "procedure_checklist_items_section_id_idx" ON "procedure_checklist_items" USING btree ("section_id");--> statement-breakpoint
CREATE INDEX "procedure_checklist_sections_node_id_idx" ON "procedure_checklist_sections" USING btree ("node_id");--> statement-breakpoint
CREATE INDEX "procedure_troubleshooting_entries_node_id_idx" ON "procedure_troubleshooting_entries" USING btree ("node_id");--> statement-breakpoint
CREATE INDEX "procedure_template_validation_issues_template_id_idx" ON "procedure_template_validation_issues" USING btree ("procedure_template_id");--> statement-breakpoint
CREATE INDEX "procedure_template_validation_issues_unresolved_idx" ON "procedure_template_validation_issues" USING btree ("procedure_template_id","severity","resolved_at");