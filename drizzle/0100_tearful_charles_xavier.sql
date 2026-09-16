CREATE TYPE "public"."repair_labor_scope" AS ENUM('INVESTIGATION', 'POWER_TEST', 'DOCUMENT');--> statement-breakpoint
DROP INDEX "power_test_tasks_kind_name_not_deleted_unique";--> statement-breakpoint
-- 손으로 고친 곳 ① (2026-09-16). drizzle-kit 이 낸 원본은 아래 한 줄이었다:
--   ALTER TABLE "power_test_tasks" ADD COLUMN "scope" "repair_labor_scope" NOT NULL;
-- 이 표에는 이미 통전 작업 건명이 들어 있어서(개발 DB 기준 제너레이터 7건 ·
-- 매쳐 6건) 그대로 두면 NOT NULL 위반으로 적용이 실패한다. 0089 가 결재선 scope
-- 에서 한 것과 같은 두 걸음으로 나눈다.
--  1) 기본값 'POWER_TEST' 를 달아 칸을 넣는다 — 이 칸이 생기기 전의 줄은 전부
--     통전 작업 건명이었으므로 그 값이 사실 그대로다.
--  2) 곧바로 그 기본값을 뗀다. 남겨 두면 앞으로 갈래를 적지 않은 줄이 조용히
--     통전 목록으로 들어가고, 그러면 「조사 건명을 저장했는데 통전 화면에 떴다」가
--     된다. 스키마 파일에도 기본값이 선언돼 있지 않으므로, 떼어야 drizzle 스냅샷과
--     맞는다.
ALTER TABLE "power_test_tasks" ADD COLUMN "scope" "repair_labor_scope" DEFAULT 'POWER_TEST' NOT NULL;--> statement-breakpoint
ALTER TABLE "power_test_tasks" ALTER COLUMN "scope" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "repair_labor_settings" ADD COLUMN "investigation_hours" integer;--> statement-breakpoint
ALTER TABLE "repair_labor_settings" ADD COLUMN "document_hours" integer;--> statement-breakpoint
ALTER TABLE "quotes" ADD COLUMN "document_excluded" boolean DEFAULT false NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "power_test_tasks_kind_scope_name_not_deleted_unique" ON "power_test_tasks" USING btree ("equipment_kind","scope","task_name") WHERE is_deleted = false;--> statement-breakpoint
ALTER TABLE "repair_labor_settings" ADD CONSTRAINT "repair_labor_settings_investigation_hours_positive" CHECK ("repair_labor_settings"."investigation_hours" > 0);--> statement-breakpoint
ALTER TABLE "repair_labor_settings" ADD CONSTRAINT "repair_labor_settings_document_hours_not_negative" CHECK ("repair_labor_settings"."document_hours" >= 0);--> statement-breakpoint
-- 손으로 더한 곳 ② (2026-09-16) — 기존 값 옮기기. drizzle-kit 은 칸만 만들고
-- 값은 옮기지 않는다.
--
-- 🔴 **지금 청구되는 금액이 그대로 유지되어야 한다.** 조사작업 몫은 지금까지
-- 「기본 작업비 − 통전 몫」이라는 **나머지**였다(schema/repair-labor.ts). 새
-- 구조에서는 조사 몫이 제 공수시간을 갖는다. 그래서 그 나머지를 시간으로 되돌려
-- 적어 둔다:
--
--   조사 시간 = (base_cost − COALESCE(power_test_hours, 0) × hourly_rate) ÷ hourly_rate
--
-- COALESCE 가 핵심이다 — T/C 는 통전 시간이 아직 NULL 이다. 통전을 0 으로 보아
-- 기본 작업비 전부를 조사 몫으로 옮긴다. 그러지 않으면 T/C 의 기본 작업비가
-- 통째로 사라진다. 나중에 사람이 T/C 통전 시간을 정할 때 조사 시간을 그만큼
-- 줄이면 된다.
--
-- 🔴 **옮기지 않는 세 경우는 NULL 로 둔다**(사람이 화면에서 채운다):
--  1. base_cost 가 NULL 이거나 hourly_rate 가 0 인 줄 — 계산이 서지 않는다.
--     (WHERE 절의 두 조건)
--  2. 정수로 딱 떨어지지 않는 줄 — 공수시간은 정수 칸이다. 반올림해서 청구
--     금액을 조용히 바꾸지 않는다. (hours = trunc(hours))
--  3. 0 이하가 되는 줄 — 통전 몫이 기본 작업비보다 크거나 같은 경우다. 음수는
--     말할 것도 없고, 0 도 옮기지 않는다: 조사 시간은 CHECK (> 0) 이고, 「조사
--     몫이 0원」은 「정하지 않았다」와 실질이 같으면서 금액은 어느 쪽이든 0 이다.
--     (hours > 0)
--
-- 🔴 운영(NAS) DB 의 값은 개발 DB 와 다를 수 있다. 그래서 숫자를 박지 않고
-- 계산식으로 쓴다. 참고로 개발 DB 세 줄은 이 문장으로 GENERATOR 21 · MATCHER 21 ·
-- TOTAL_CONTROLLER 22 가 된다.
--
-- 서류 시간(document_hours)은 **전부 NULL 로 둔다** — 새 개념이라 정해진 값이
-- 없다. 0 으로 채우면 「서류작업이 없는 장비」와 구별되지 않는다
-- (schema/repair-labor.ts 의 그 칸 설명).
WITH computed AS (
  SELECT
    "id",
    ("base_cost" - COALESCE("power_test_hours", 0) * "hourly_rate") / "hourly_rate" AS hours
  FROM "repair_labor_settings"
  WHERE "base_cost" IS NOT NULL
    AND "hourly_rate" <> 0
)
UPDATE "repair_labor_settings" AS s
SET "investigation_hours" = c.hours::integer
FROM computed AS c
WHERE s."id" = c."id"
  AND c.hours > 0
  AND c.hours = trunc(c.hours);
