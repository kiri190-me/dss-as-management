ALTER TYPE "public"."workflow_type" ADD VALUE 'PENDING_MATCHER';--> statement-breakpoint
ALTER TYPE "public"."workflow_type" ADD VALUE 'PENDING_GENERATOR';--> statement-breakpoint
ALTER TYPE "public"."workflow_type" ADD VALUE 'PENDING_TOTAL_CONTROLLER';--> statement-breakpoint
ALTER TYPE "public"."billing_type" ADD VALUE 'PARTIAL_PAID' BEFORE 'WARRANTY';--> statement-breakpoint
ALTER TYPE "public"."billing_type" ADD VALUE 'PENDING_DECISION';