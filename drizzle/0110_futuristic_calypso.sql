CREATE TABLE "repair_case_work_record_edits" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"work_record_id" uuid NOT NULL,
	"previous_memo" text NOT NULL,
	"previous_record_kind" "repair_case_work_record_kind" NOT NULL,
	"edited_by" uuid NOT NULL,
	"edited_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "repair_case_work_record_edits" ADD CONSTRAINT "repair_case_work_record_edits_work_record_id_repair_case_work_records_id_fk" FOREIGN KEY ("work_record_id") REFERENCES "public"."repair_case_work_records"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "repair_case_work_record_edits" ADD CONSTRAINT "repair_case_work_record_edits_edited_by_users_id_fk" FOREIGN KEY ("edited_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "repair_case_work_record_edits_work_record_id_edited_at_idx" ON "repair_case_work_record_edits" USING btree ("work_record_id","edited_at");