import { sql } from "drizzle-orm";
import { check, numeric, pgTable, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { parts } from "./inventory";
import { stockOwnerEnum } from "./inventory-enums";
import { users } from "./users";

/**
 * ============================================================================
 * 단가 — 부품 × 소유구분마다 "이건 얼마짜리인가"
 * ============================================================================
 * part_minimum_quantities 와 **구조가 같다.** 그 표가 이미 "부품 × 소유구분"
 * 축의 설정값을 담는 선례이고, 왜 그 모양이어야 하는지가 그 파일 머리말에
 * 전부 적혀 있다. 여기서는 단가에만 해당하는 것을 적는다.
 *
 * ── 왜 parts 에 칸 넷을 만들지 않았나 ───────────────────────────────────
 * `단가_DSS`·`단가_교산`… 처럼 두면 소유구분이 하나 느는 순간 또 마이그레이션이고,
 * stock_owner enum 에 이미 있는 목록을 칸 이름에 다시 박아 넣게 된다. 소유구분은
 * **자료의 축**이지 부품의 속성이 아니다.
 *
 * ── 🔴 왜 part_stock_balances 에 칸을 더하지 않았나 ─────────────────────
 * 그 표는 **입고가 있어야 행이 생긴다**. 재고가 0인 부품에는 붙일 칸 자체가
 * 없는데, 단가를 적어 두고 싶은 때가 바로 그때다 — 아직 없어서 사야 하거나,
 * 없는 채로 견적을 내야 하는 부품이다. 한계수량이 같은 이유로 자기 표를 갖는다.
 *
 * ── 🔴 "행이 없다"와 "0을 저장했다"는 다른 뜻이다 ──────────────────────
 *   · **행이 없다**   = 단가를 정하지 않았다. 견적서는 그 칸을 **비워 두고**
 *                      사람이 채우게 한다.
 *   · **0을 저장했다** = 무상 부품이다. 견적서에 0원으로 적어 보인다(실제로
 *                      무상 교체 부품을 견적서에 올려 보이는 일이 있다).
 *
 * 그래서 화면에서 칸을 비우면 0을 저장하지 않고 **행을 지운다**
 * (mutations/part-unit-prices.ts). 비운 것을 0으로 저장해 버리면 "정하지 않음"을
 * 다시 표현할 방법이 사라지고, 견적서가 정하지 않은 부품을 0원으로 청구하게 된다.
 *
 * ── 원화다. 통화 칸을 두지 않는다 ───────────────────────────────────────
 * 교산(일본 본사) 부품은 엔화로 매입할 수 있지만, 이 칸에 적는 것은 **우리가
 * 청구하는 값**이고 견적서는 원화로 나간다(양식의 `"₩"#,##0`). 통화를 담기
 * 시작하면 견적서로 가져올 때의 환율을 함께 정해야 하고(저장할 것인가, 매번
 * 입력할 것인가), 그것은 이 칸 하나가 감당할 결정이 아니다. 외화 매입분은
 * 사람이 환산해서 적는다(2026-08-28 승인).
 *
 * ── 금액은 numeric 이다 ─────────────────────────────────────────────────
 * double precision 으로 두면 오차가 쌓여 합계가 세금계산서와 1원씩 어긋난다.
 * Drizzle 은 이 컬럼을 **문자열로 읽는다** — quotes.work_cost 와 같은 규칙이고,
 * 숫자로 바꾸는 자리는 견적서 xlsx 를 만드는 그 한 지점뿐이다.
 *
 * ── 부품이 지워질 때 — ON DELETE CASCADE ────────────────────────────────
 * 한계수량과 같다. 사람이 다시 칠 수 있는 **설정값**이고, 부품 자체가 없어지면
 * 그 단가로 청구할 것도 없다. RESTRICT 였다면 단가를 한 번 적어 둔 부품은
 * 완전삭제가 FK 오류로 막히고, 자동 정리 작업(purgeExpiredPart)이 통째로 멈춘다.
 *
 * ── 컬럼 관례 ───────────────────────────────────────────────────────────
 * part_minimum_quantities 와 같다 — 대리 키 + updated_by / updated_at. 대리 키를
 * 쓰는 이유도 같다: 감사 로그의 target_record_id 가 NOT NULL uuid 라, 누가 언제
 * 값을 바꿨는지 남기려면 행마다 uuid 하나가 있어야 한다.
 * ============================================================================
 */
export const partUnitPrices = pgTable(
  "part_unit_prices",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    partId: uuid("part_id")
      .notNull()
      .references(() => parts.id, { onDelete: "cascade" }),
    owner: stockOwnerEnum("owner").notNull(),
    /**
     * 원화 단가(부가세 별도). 0 이상이며 그 규칙은 아래 CHECK 가 DB 에서
     * 강제한다. 입력 검증(validation/part-unit-price-input.ts)도 같은 규칙을 따로
     * 검사한다 — 화면을 거치지 않고 부른 경우에도 음수가 들어오지 못한다.
     *
     * numeric(15,2) 는 quotes.work_cost · quote_items.unit_price 와 같은 폭이다.
     * 견적서로 그대로 옮겨 가는 값이라 폭이 다르면 옮기다 잘린다.
     */
    unitPrice: numeric("unit_price", { precision: 15, scale: 2 }).notNull(),
    /** 누가 마지막으로 값을 바꿨는지. 되돌릴 사람을 찾을 때 감사 로그보다 먼저 보게 된다. */
    updatedBy: uuid("updated_by")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    check("part_unit_prices_not_negative", sql`${table.unitPrice} >= 0`),
    uniqueIndex("part_unit_prices_part_owner_unique").on(table.partId, table.owner),
  ]
);
