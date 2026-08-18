ALTER TYPE "public"."repair_case_flowchart_edit_action_type" ADD VALUE 'PURGE_FLOWCHART' BEFORE 'CREATE_NODE';--> statement-breakpoint
ALTER TABLE "repair_case_flowchart_edit_history" DROP CONSTRAINT "repair_case_flowchart_edit_history_flowchart_id_repair_case_flowcharts_id_fk";
--> statement-breakpoint
ALTER TABLE "repair_case_flowchart_edit_history" ALTER COLUMN "flowchart_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "repair_case_flowchart_edit_history" ADD CONSTRAINT "repair_case_flowchart_edit_history_flowchart_id_repair_case_flowcharts_id_fk" FOREIGN KEY ("flowchart_id") REFERENCES "public"."repair_case_flowcharts"("id") ON DELETE set null ON UPDATE no action;