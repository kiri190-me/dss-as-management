ALTER TABLE "status_change_histories" DROP CONSTRAINT "status_change_histories_repair_case_id_repair_cases_id_fk";
--> statement-breakpoint
ALTER TABLE "repair_case_approvals" DROP CONSTRAINT "repair_case_approvals_repair_case_id_repair_cases_id_fk";
--> statement-breakpoint
ALTER TABLE "procedure_case_executions" DROP CONSTRAINT "procedure_case_executions_repair_case_id_repair_cases_id_fk";
--> statement-breakpoint
ALTER TABLE "stock_transactions" DROP CONSTRAINT "stock_transactions_repair_case_id_repair_cases_id_fk";
--> statement-breakpoint
ALTER TABLE "inventory_part_requests" DROP CONSTRAINT "inventory_part_requests_repair_case_id_repair_cases_id_fk";
--> statement-breakpoint
ALTER TABLE "repair_case_work_records" DROP CONSTRAINT "repair_case_work_records_repair_case_id_repair_cases_id_fk";
--> statement-breakpoint
ALTER TABLE "status_change_histories" ALTER COLUMN "repair_case_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "repair_case_approvals" ALTER COLUMN "repair_case_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "procedure_case_executions" ALTER COLUMN "repair_case_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "inventory_part_requests" ALTER COLUMN "repair_case_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "repair_case_work_records" ALTER COLUMN "repair_case_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "status_change_histories" ADD CONSTRAINT "status_change_histories_repair_case_id_repair_cases_id_fk" FOREIGN KEY ("repair_case_id") REFERENCES "public"."repair_cases"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "repair_case_approvals" ADD CONSTRAINT "repair_case_approvals_repair_case_id_repair_cases_id_fk" FOREIGN KEY ("repair_case_id") REFERENCES "public"."repair_cases"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "procedure_case_executions" ADD CONSTRAINT "procedure_case_executions_repair_case_id_repair_cases_id_fk" FOREIGN KEY ("repair_case_id") REFERENCES "public"."repair_cases"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_transactions" ADD CONSTRAINT "stock_transactions_repair_case_id_repair_cases_id_fk" FOREIGN KEY ("repair_case_id") REFERENCES "public"."repair_cases"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_part_requests" ADD CONSTRAINT "inventory_part_requests_repair_case_id_repair_cases_id_fk" FOREIGN KEY ("repair_case_id") REFERENCES "public"."repair_cases"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "repair_case_work_records" ADD CONSTRAINT "repair_case_work_records_repair_case_id_repair_cases_id_fk" FOREIGN KEY ("repair_case_id") REFERENCES "public"."repair_cases"("id") ON DELETE set null ON UPDATE no action;