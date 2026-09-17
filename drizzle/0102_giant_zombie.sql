CREATE TABLE "repair_case_used_parts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"repair_case_id" uuid NOT NULL,
	"line_no" integer NOT NULL,
	"part_id" uuid,
	"part_name_text" text NOT NULL,
	"quantity" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "repair_case_used_parts_quantity_positive" CHECK ("repair_case_used_parts"."quantity" > 0)
);
--> statement-breakpoint
ALTER TABLE "repair_case_used_parts" ADD CONSTRAINT "repair_case_used_parts_repair_case_id_repair_cases_id_fk" FOREIGN KEY ("repair_case_id") REFERENCES "public"."repair_cases"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "repair_case_used_parts" ADD CONSTRAINT "repair_case_used_parts_part_id_parts_id_fk" FOREIGN KEY ("part_id") REFERENCES "public"."parts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "repair_case_used_parts_repair_case_id_line_no_unique" ON "repair_case_used_parts" USING btree ("repair_case_id","line_no");--> statement-breakpoint
CREATE INDEX "repair_case_used_parts_part_id_idx" ON "repair_case_used_parts" USING btree ("part_id");