ALTER TYPE "public"."attachment_category" ADD VALUE 'SIGNED_QUOTE_PDF' BEFORE 'OTHER';--> statement-breakpoint
ALTER TYPE "public"."attachment_category" ADD VALUE 'QUOTE_EXCEL' BEFORE 'OTHER';--> statement-breakpoint
ALTER TABLE "attachments" ADD COLUMN "quote_id" uuid;--> statement-breakpoint
ALTER TABLE "quotes" ADD COLUMN "is_excel_only" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "quotes" ADD COLUMN "manual_supply_amount" numeric(15, 2);--> statement-breakpoint
ALTER TABLE "attachments" ADD CONSTRAINT "attachments_quote_id_quotes_id_fk" FOREIGN KEY ("quote_id") REFERENCES "public"."quotes"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "attachments_quote_id_not_deleted_idx" ON "attachments" USING btree ("quote_id") WHERE is_deleted = false;--> statement-breakpoint
ALTER TABLE "attachments" ADD CONSTRAINT "attachments_quote_owner_alone" CHECK ("attachments"."quote_id" IS NULL OR ("attachments"."repair_case_id" IS NULL AND "attachments"."product_model_id" IS NULL AND "attachments"."improvement_request_id" IS NULL));--> statement-breakpoint
ALTER TABLE "quotes" ADD CONSTRAINT "quotes_manual_supply_amount_excel_only" CHECK ("quotes"."is_excel_only" OR "quotes"."manual_supply_amount" IS NULL);--> statement-breakpoint
ALTER TABLE "quotes" ADD CONSTRAINT "quotes_manual_supply_amount_not_negative" CHECK ("quotes"."manual_supply_amount" IS NULL OR "quotes"."manual_supply_amount" >= 0);