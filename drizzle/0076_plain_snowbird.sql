CREATE TYPE "public"."quote_work_scope_section" AS ENUM('INVESTIGATION', 'REPAIR', 'POWER_TEST');--> statement-breakpoint
CREATE TABLE "quote_work_scope_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"quote_id" uuid NOT NULL,
	"section" "quote_work_scope_section" NOT NULL,
	"line_no" integer NOT NULL,
	"text" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "quote_work_scope_lines" ADD CONSTRAINT "quote_work_scope_lines_quote_id_quotes_id_fk" FOREIGN KEY ("quote_id") REFERENCES "public"."quotes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "quote_work_scope_lines_quote_section_line_unique" ON "quote_work_scope_lines" USING btree ("quote_id","section","line_no");--> statement-breakpoint
CREATE INDEX "quote_work_scope_lines_quote_id_idx" ON "quote_work_scope_lines" USING btree ("quote_id");