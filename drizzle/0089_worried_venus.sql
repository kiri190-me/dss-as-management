CREATE TYPE "public"."shipment_approval_route_scope" AS ENUM('FINAL_SHIPMENT', 'PART_ISSUE');--> statement-breakpoint
DROP INDEX "shipment_approval_routes_version_unique";--> statement-breakpoint
-- 손으로 고친 곳 (2026-09-10). drizzle-kit 이 낸 원본은 아래 한 줄이었다:
--   ALTER TABLE "shipment_approval_routes" ADD COLUMN "scope" ... NOT NULL;
-- 이 표에는 이미 판 3개가 들어 있어서 그대로 두면 NOT NULL 위반으로 적용이
-- 실패한다. 그래서 두 걸음으로 나눈다.
--  1) 기본값 'FINAL_SHIPMENT' 를 달아 칸을 넣는다 — 기존 판은 전부 출하 전용이었으므로
--     그 값이 사실 그대로다.
--  2) 곧바로 그 기본값을 뗀다. 남겨 두면 앞으로 용도를 적지 않은 판이 조용히 출하
--     절차로 들어가고, 그러면 「불출 절차를 저장했는데 출하가 바뀌었다」가 된다.
--     스키마 파일에도 기본값이 선언돼 있지 않으므로, 떼어야 drizzle 스냅샷과 맞는다.
ALTER TABLE "shipment_approval_routes" ADD COLUMN "scope" "shipment_approval_route_scope" DEFAULT 'FINAL_SHIPMENT' NOT NULL;--> statement-breakpoint
ALTER TABLE "shipment_approval_routes" ALTER COLUMN "scope" DROP DEFAULT;--> statement-breakpoint
CREATE UNIQUE INDEX "shipment_approval_routes_scope_version_unique" ON "shipment_approval_routes" USING btree ("scope","version");
