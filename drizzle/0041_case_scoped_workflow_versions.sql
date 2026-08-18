ALTER TABLE "workflow_versions" ADD COLUMN "is_case_scoped" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "workflow_versions" ADD COLUMN "repair_case_id" uuid;--> statement-breakpoint
CREATE INDEX "workflow_versions_case_scoped_idx" ON "workflow_versions" USING btree ("repair_case_id");