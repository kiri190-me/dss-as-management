ALTER TYPE "public"."product_model_kind" ADD VALUE 'TOTAL_CONTROLLER';--> statement-breakpoint
ALTER TYPE "public"."workflow_type" ADD VALUE 'PAID_MATCHER' BEFORE 'PAID_GENERATOR';--> statement-breakpoint
ALTER TYPE "public"."workflow_type" ADD VALUE 'WARRANTY_MATCHER' BEFORE 'PAID_GENERATOR';--> statement-breakpoint
ALTER TYPE "public"."workflow_type" ADD VALUE 'PAID_TOTAL_CONTROLLER';--> statement-breakpoint
ALTER TYPE "public"."workflow_type" ADD VALUE 'WARRANTY_TOTAL_CONTROLLER';