DROP INDEX "repair_case_approvals_one_active_domestic_request";--> statement-breakpoint
ALTER TABLE "repair_case_approvals" ADD COLUMN "due_date_row_order" integer;--> statement-breakpoint
--
-- 🔴 손으로 더한 문장이다(drizzle-kit 이 만들지 않는다). 아래
-- "repair_case_approvals_domestic_type_has_due_date_row" CHECK 이 서기 **전에**
-- 이미 쌓여 있는 기타건 결재 행에 회차 번호를 메운다 — 메우지 않으면 그 CHECK
-- 때문에 마이그레이션 적용 자체가 실패한다.
--
-- 왜 1인가: 2026-11-07 ~ 11-08 까지 기타건 승인의 단위는 **줄 전체**였다. 그 행들이
-- 붙어 있는 내자 줄의 납기요청일 행 수를 세어 보면(개발 DB 실측 2026-11-08 — 3행이
-- 각각 1행·0행·0행) 셋 다 회차가 하나뿐이라 「줄 전체」와 「1차」가 같은 것을 가리킨다.
-- 회차가 0개인 줄도 1번 하나를 단위로 보므로(domain/domestic-order-approval-rules.ts
-- 의 domesticOrderApprovalUnitCount) 그쪽도 1이 맞다.
--
-- 🔵 지우는 문장이 아니다 — NULL 인 칸만 메운다(방금 더한 칸이라 전부 NULL 이다).
UPDATE "repair_case_approvals"
   SET "due_date_row_order" = 1
 WHERE "approval_type"::text = 'DOMESTIC_ORDER_FINAL_SHIPMENT'
   AND "due_date_row_order" IS NULL;--> statement-breakpoint
ALTER TABLE "domestic_order_due_dates" ADD COLUMN "completed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "domestic_order_due_dates" ADD COLUMN "completed_by" uuid;--> statement-breakpoint
ALTER TABLE "domestic_order_due_dates" ADD CONSTRAINT "domestic_order_due_dates_completed_by_users_id_fk" FOREIGN KEY ("completed_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "repair_case_approvals_one_active_domestic_request" ON "repair_case_approvals" USING btree ("domestic_order_id","approval_type","due_date_row_order") WHERE status = 'REQUESTED';--> statement-breakpoint
ALTER TABLE "repair_case_approvals" ADD CONSTRAINT "repair_case_approvals_due_date_row_only_for_domestic_type" CHECK (due_date_row_order IS NULL OR approval_type::text = 'DOMESTIC_ORDER_FINAL_SHIPMENT');--> statement-breakpoint
ALTER TABLE "repair_case_approvals" ADD CONSTRAINT "repair_case_approvals_domestic_type_has_due_date_row" CHECK (approval_type::text <> 'DOMESTIC_ORDER_FINAL_SHIPMENT' OR (due_date_row_order IS NOT NULL AND due_date_row_order >= 1));--> statement-breakpoint
ALTER TABLE "domestic_order_due_dates" ADD CONSTRAINT "domestic_order_due_dates_completed_columns_together" CHECK ((completed_at IS NULL AND completed_by IS NULL) OR (completed_at IS NOT NULL AND completed_by IS NOT NULL));