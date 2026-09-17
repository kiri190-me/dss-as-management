-- 손으로 더한 곳 (2026-09-17) — 🔴 **이 DELETE 는 drizzle 이 만들지 않았다.**
-- drizzle 은 스키마 두 장을 견줄 뿐이라 "이미 들어 있는 줄을 어떻게 합칠지"를
-- 모른다. 이 문장을 지우면 아래 UNIQUE 인덱스가 **중복 part_id 에 걸려
-- 마이그레이션이 통째로 실패한다** — 없어도 되는 줄이 아니다.
--
-- 왜 합치는가: part_unit_prices 가 (part_id, owner) 로 부품 × 소유구분마다
-- 단가를 갖고 있었는데, **소유구분에 따라 부품의 단가가 달라지지 않는다**는
-- 것이 업무상 사실이다(2026-09-17 사용자 정정, schema/part-unit-prices.ts
-- 머리말). 축이 아닌 것을 축으로 둔 탓에 같은 부품의 값이 소유구분마다
-- 어긋나 있고, 그 어긋난 줄들을 **부품당 하나로** 줄여야 한다.
--
-- 어느 줄을 남기는가: **가장 높은 값**을 남긴다(사용자 결정 2026-09-17).
-- 값이 같으면 id 가 작은 줄 하나만 남긴다 — 어느 쪽이든 값은 같으므로 줄을
-- 고르는 규칙만 있으면 되고, 그 규칙이 없으면 둘 다 살아남아 UNIQUE 에 걸린다.
-- 낮은 쪽을 남기지 않는 것은 덜 받는 실수가 더 받는 실수보다 되돌리기 어렵기
-- 때문이다(견적서가 이미 나간 뒤에는 올려 받지 못한다).
--
-- 🔴 지워지는 줄은 되돌릴 수 없다. 적용 전에 백업을 뜬다.
-- 개발 DB 에서 미리 확인한 결과: 5줄 → 3줄. VVC 는 350,000 이 남고 299,722 가
-- 사라지며, 스위칭 전원은 48,731 이 남고 47,987 이 사라진다.
--
-- 감사 로그를 남기지 않는다: 사람이 화면에서 지운 것이 아니라 스키마 이행이고,
-- 행위자로 적을 사용자가 없다. 무엇이 사라졌는지는 백업과 이 주석이 답한다.
DELETE FROM part_unit_prices a USING part_unit_prices b
WHERE a.part_id = b.part_id
  AND (b.unit_price > a.unit_price
       OR (b.unit_price = a.unit_price AND b.id < a.id));--> statement-breakpoint
DROP INDEX "part_unit_prices_part_owner_unique";--> statement-breakpoint
CREATE UNIQUE INDEX "part_unit_prices_part_unique" ON "part_unit_prices" USING btree ("part_id");--> statement-breakpoint
ALTER TABLE "part_unit_prices" DROP COLUMN "owner";
