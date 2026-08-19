ALTER TYPE "public"."inventory_part_request_action_type" ADD VALUE 'HELD';--> statement-breakpoint
ALTER TYPE "public"."inventory_part_request_action_type" ADD VALUE 'HOLD_RELEASED';--> statement-breakpoint
ALTER TYPE "public"."inventory_part_request_idempotency_operation" ADD VALUE 'HOLD';--> statement-breakpoint
ALTER TYPE "public"."inventory_part_request_idempotency_operation" ADD VALUE 'RELEASE_HOLD';--> statement-breakpoint
ALTER TYPE "public"."inventory_part_request_status" ADD VALUE 'ON_HOLD';--> statement-breakpoint
ALTER TABLE "inventory_part_request_history" DROP CONSTRAINT "inventory_part_request_history_reason_required_for_terminal_actions";--> statement-breakpoint
ALTER TABLE "inventory_part_request_history" ADD CONSTRAINT "inventory_part_request_history_reason_required_actions" CHECK ("inventory_part_request_history"."action_type"::text NOT IN ('REJECTED', 'CANCELLED', 'PARTIALLY_CLOSED', 'HELD') OR ("inventory_part_request_history"."reason" IS NOT NULL AND btrim("inventory_part_request_history"."reason") <> ''));