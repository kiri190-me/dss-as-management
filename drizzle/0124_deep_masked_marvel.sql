ALTER TYPE "public"."repair_case_approval_type" ADD VALUE 'DOMESTIC_ORDER_FINAL_SHIPMENT';--> statement-breakpoint
ALTER TYPE "public"."shipment_approval_route_scope" ADD VALUE 'DOMESTIC_ORDER_FINAL_SHIPMENT';--> statement-breakpoint
ALTER TABLE "repair_case_approvals" DROP CONSTRAINT "repair_case_approvals_delegation_only_for_final_shipment";--> statement-breakpoint
ALTER TABLE "repair_case_approvals" DROP CONSTRAINT "repair_case_approvals_route_only_for_final_shipment";--> statement-breakpoint
ALTER TABLE "repair_case_approvals" ADD COLUMN "domestic_order_id" uuid;--> statement-breakpoint
ALTER TABLE "repair_case_approvals" ADD CONSTRAINT "repair_case_approvals_domestic_order_id_domestic_orders_id_fk" FOREIGN KEY ("domestic_order_id") REFERENCES "public"."domestic_orders"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "repair_case_approvals_one_active_domestic_request" ON "repair_case_approvals" USING btree ("domestic_order_id","approval_type") WHERE status = 'REQUESTED';--> statement-breakpoint
CREATE INDEX "repair_case_approvals_domestic_order_id_idx" ON "repair_case_approvals" USING btree ("domestic_order_id");--> statement-breakpoint
ALTER TABLE "repair_case_approvals" ADD CONSTRAINT "repair_case_approvals_domestic_order_only_for_domestic_type" CHECK (domestic_order_id IS NULL OR approval_type::text = 'DOMESTIC_ORDER_FINAL_SHIPMENT');--> statement-breakpoint
ALTER TABLE "repair_case_approvals" ADD CONSTRAINT "repair_case_approvals_domestic_type_has_no_repair_case" CHECK (approval_type::text <> 'DOMESTIC_ORDER_FINAL_SHIPMENT' OR repair_case_id IS NULL);--> statement-breakpoint
ALTER TABLE "repair_case_approvals" ADD CONSTRAINT "repair_case_approvals_delegation_only_for_final_shipment" CHECK (delegated_from_user_id IS NULL OR approval_type::text IN ('FINAL_SHIPMENT', 'DOMESTIC_ORDER_FINAL_SHIPMENT'));--> statement-breakpoint
ALTER TABLE "repair_case_approvals" ADD CONSTRAINT "repair_case_approvals_route_only_for_final_shipment" CHECK (route_id IS NULL OR approval_type::text IN ('FINAL_SHIPMENT', 'DOMESTIC_ORDER_FINAL_SHIPMENT'));