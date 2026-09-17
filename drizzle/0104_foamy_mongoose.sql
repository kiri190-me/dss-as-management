DELETE FROM attachments WHERE improvement_request_id IS NOT NULL;--> statement-breakpoint
ALTER TABLE "attachments" DROP CONSTRAINT "attachments_improvement_request_id_improvement_requests_id_fk";
--> statement-breakpoint
ALTER TABLE "improvement_requests" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
DROP TABLE "improvement_requests" CASCADE;--> statement-breakpoint
ALTER TABLE "attachments" DROP CONSTRAINT "attachments_improvement_owner_alone";--> statement-breakpoint
ALTER TABLE "attachments" DROP CONSTRAINT "attachments_quote_owner_alone";--> statement-breakpoint
DROP INDEX "attachments_improvement_request_id_not_deleted_idx";--> statement-breakpoint
ALTER TABLE "attachments" DROP COLUMN "improvement_request_id";--> statement-breakpoint
ALTER TABLE "attachments" ADD CONSTRAINT "attachments_quote_owner_alone" CHECK ("attachments"."quote_id" IS NULL OR ("attachments"."repair_case_id" IS NULL AND "attachments"."product_model_id" IS NULL));--> statement-breakpoint
DROP TYPE "public"."improvement_request_status";
