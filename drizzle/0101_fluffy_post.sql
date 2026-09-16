CREATE TYPE "public"."quote_item_kind" AS ENUM('ITEM', 'NOTE');--> statement-breakpoint
ALTER TYPE "public"."quote_kind" ADD VALUE 'CABLE';--> statement-breakpoint
-- 손으로 더한 곳 ① (2026-09-16) — 아래 넷은 **한 덩어리로 읽어야 한다.**
-- 따로 보면 "수량·단가의 필수 규칙을 풀었다"로 읽히는데, 그게 아니다:
-- 규칙은 이 파일 끝의 CHECK 넷에서 **줄 종류에 걸리도록 좁혀 다시 걸린다.**
--  · 품목 줄(kind = 'ITEM')  → 수량·단가가 반드시 있고, 수량은 0보다 커야 한다
--  · 그 밖의 줄(설명 줄)      → 수량·단가가 둘 다 NULL 이어야 한다
-- 그냥 풀지 않은 까닭은 schema/quotes.ts 의 quoteItemKindEnum 머리말에 있다 —
-- 풀면 **수량 0짜리 품목 줄**이 들어올 길이 함께 열리고, 그런 줄은 0원으로
-- 문서에 박히는데 합계는 멀쩡해서 아무도 알아채지 못한다.
--
-- 이 네 문장과 그 CHECK 넷 사이에 기존 행이 규칙 없이 놓이는 순간이 있지만,
-- 한 트랜잭션 안이라 밖에서는 보이지 않는다.
ALTER TABLE "quote_items" DROP CONSTRAINT "quote_items_quantity_positive";--> statement-breakpoint
ALTER TABLE "quote_items" DROP CONSTRAINT "quote_items_unit_price_not_negative";--> statement-breakpoint
ALTER TABLE "quote_items" ALTER COLUMN "quantity" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "quote_items" ALTER COLUMN "unit_price" DROP NOT NULL;--> statement-breakpoint
-- 손으로 더한 곳 ② (2026-09-16) — **기존 값 이행은 이 한 줄이 한다.**
-- `DEFAULT 'ITEM'` 이 붙은 ADD COLUMN 이라 이미 있던 줄이 전부 그 자리에서
-- 품목 줄로 채워진다(개발 DB 기준 견적서 11건에 딸린 줄 전부). 이 칸이 생기기
-- 전의 줄은 수량·단가가 NOT NULL 이었으므로 전부 품목 줄인 것이 사실 그대로다.
-- 따로 UPDATE 를 두지 않은 것은 그 문장이 한 줄도 건드리지 못하는 빈 문장이기
-- 때문이다 — 있으면 "기본값으로는 안 채워진다"고 잘못 읽힌다.
--
-- 🔴 0100 이 power_test_tasks.scope 에서 기본값을 곧바로 **뗀 것과 반대로**,
-- 여기서는 기본값을 남긴다. 그쪽이 위험했던 것은 갈래를 적지 않은 줄이 **조용히**
-- 한쪽 목록에 끼기 때문이었다. 여기서는 조용할 수가 없다: 종류를 적지 않은 줄은
-- ITEM 이 되고, ITEM 은 수량·단가가 반드시 있어야 하므로(아래
-- quote_items_item_line_amounts_required) 설명 줄이 잘못 끼면 지나가는 대신
-- 거절된다. 스키마 파일에도 `.default("ITEM")` 이 선언돼 있어 스냅샷과 맞는다.
ALTER TABLE "quote_items" ADD COLUMN "kind" "quote_item_kind" DEFAULT 'ITEM' NOT NULL;--> statement-breakpoint
-- 규격 · 특이사항은 **없던 자료라 NULL 로 둔다.** 지어내지 않는다 — 기존 견적서의
-- 금액도 문구도 이 마이그레이션으로 바뀌지 않는다.
ALTER TABLE "quote_items" ADD COLUMN "part_spec_text" text;--> statement-breakpoint
ALTER TABLE "quotes" ADD COLUMN "remarks" text;--> statement-breakpoint
ALTER TABLE "quote_items" ADD CONSTRAINT "quote_items_item_line_amounts_required" CHECK ("quote_items"."kind" <> 'ITEM' OR ("quote_items"."quantity" IS NOT NULL AND "quote_items"."unit_price" IS NOT NULL));--> statement-breakpoint
ALTER TABLE "quote_items" ADD CONSTRAINT "quote_items_amounts_item_line_only" CHECK ("quote_items"."kind" = 'ITEM' OR ("quote_items"."quantity" IS NULL AND "quote_items"."unit_price" IS NULL));--> statement-breakpoint
ALTER TABLE "quote_items" ADD CONSTRAINT "quote_items_quantity_positive" CHECK ("quote_items"."quantity" IS NULL OR "quote_items"."quantity" > 0);--> statement-breakpoint
ALTER TABLE "quote_items" ADD CONSTRAINT "quote_items_unit_price_not_negative" CHECK ("quote_items"."unit_price" IS NULL OR "quote_items"."unit_price" >= 0);
