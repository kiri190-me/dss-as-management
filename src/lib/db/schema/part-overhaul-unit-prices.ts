import { sql } from "drizzle-orm";
import { check, numeric, pgTable, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { parts } from "./inventory";
import { users } from "./users";

/**
 * ============================================================================
 * O/H 단가 — 오버홀 작업일 때 그 부품을 얼마로 청구하는가
 * ============================================================================
 * 같은 부품이라도 **오버홀(O/H) 작업의 견적서에 오를 때와 일반 수리 견적서에
 * 오를 때 청구 단가가 다르다.** part_unit_prices 한 벌만 두면 O/H 견적서도 일반
 * 단가로 나간다. 그래서 O/H 쪽 값을 담을 표를 따로 둔다.
 *
 * ── 🔴 왜 part_unit_prices 에 칸을 더하지 않았나 ────────────────────────
 * **그 표에는 소유구분(owner) 축이 있고, O/H 단가에는 그 축이 없다.**
 * O/H 단가는 소유구분과 무관하게 부품마다 하나다(2026-08-31 사용자 확인).
 * 그 표에 `overhaul_unit_price` 칸을 더하면 값이 하나뿐인 것을 DSS 줄·교산 줄·
 * 보수부재 줄·시험 줄에 **같은 수로 네 번** 적게 된다. 그러면
 *   · 한 줄만 고치고 나머지를 잊는 사고가 반드시 난다. 그때 어느 줄이 옳은지
 *     DB 는 알려 주지 못한다 — 넷 다 형식상 정상이다.
 *   · 소유구분 줄이 하나도 없는 부품(단가를 아직 안 정한 부품)에는 O/H 단가를
 *     적을 자리 자체가 없다. 없는 소유자 줄을 만들어 넣으면 그 줄의 일반 단가는
 *     "정하지 않음"이 아니라 무언가가 되어야 한다.
 * 축이 다른 값은 표를 나눈다 — part_minimum_quantities 와 part_unit_prices 가
 * part_stock_balances 에 얹히지 않고 각자 표를 가진 것과 같은 이유다.
 *
 * ── 🔴 "행이 없다"와 "0을 저장했다"는 다른 뜻이다 ──────────────────────
 *   · **행이 없다**   = O/H 단가를 정하지 않았다. O/H 견적서는 그 칸을 **비워
 *                      두고** 사람이 채우게 한다.
 *   · **0을 저장했다** = 오버홀 때는 무상으로 주는 부품이다. 견적서에 0원으로
 *                      적어 보인다.
 * 그래서 화면에서 칸을 비우면 0을 저장하지 않고 **행을 지운다**
 * (mutations/part-overhaul-unit-prices.ts). 비운 것을 0으로 저장해 버리면
 * "정하지 않음"을 다시 표현할 방법이 사라지고, O/H 견적서가 정하지 않은 부품을
 * 0원으로 청구하게 된다. 읽기(queries/part-overhaul-unit-prices.ts)도 없는 부품을
 * "0" 으로 채우지 않는다.
 *
 * ── 금액은 numeric 이다 ─────────────────────────────────────────────────
 * double precision 으로 두면 오차가 쌓여 합계가 세금계산서와 1원씩 어긋난다.
 * 폭도 numeric(15,2) 로 일반 단가·quote_items.unit_price 와 **똑같이** 맞췄다 —
 * O/H 견적서는 일반 견적서와 같은 양식·같은 칸으로 나가므로, 폭이 다르면 옮기다
 * 잘린다. Drizzle 은 이 컬럼을 **문자열로 읽는다**(저장·비교·화면까지 문자열).
 *
 * ⚠️ 문자열로 읽힌다는 것이 비교에서 함정이 된다 — DB 는 "125000.00" 을
 * 돌려주는데 사람은 "125000" 이라고 친다. 저장 쪽은 Number 로 견준다.
 *
 * ── 부품이 지워질 때 — ON DELETE CASCADE ────────────────────────────────
 * 형제 표 둘과 같다. 사람이 다시 칠 수 있는 **설정값**이고, 부품 자체가 없어지면
 * 그 부품을 O/H 로 청구할 일도 없다. RESTRICT 였다면 O/H 단가를 한 번 적어 둔
 * 부품은 완전삭제가 FK 오류로 막히고, 자동 정리 작업(purgeExpiredPart)이 통째로
 * 멈춘다 — 이 표는 그 정리를 막을 만한 업무 기록이 아니다.
 *
 * ── 컬럼 관례 ───────────────────────────────────────────────────────────
 * 형제 표 둘과 같다 — 대리 키 + updated_by / updated_at. 부품마다 한 줄뿐이라
 * part_id 자체를 기본 키로 삼을 수도 있었지만 그러지 않았다: 감사 로그의
 * target_record_id 가 NOT NULL uuid 라, 누가 언제 값을 바꿨는지 남기려면 행마다
 * uuid 하나가 있어야 하고, 그 uuid 는 부품 id 와 구별돼야 감사 로그에서 "부품을
 * 고쳤다"와 "그 부품의 O/H 단가를 고쳤다"가 섞이지 않는다.
 *
 * "부품마다 한 줄"은 part_id 의 UNIQUE 로 DB 가 지킨다. 형제 표들이
 * (part_id, owner) 로 UNIQUE 를 거는 자리이고, 여기서는 owner 가 없으니 한 칸이다.
 * ============================================================================
 */
export const partOverhaulUnitPrices = pgTable(
  "part_overhaul_unit_prices",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    partId: uuid("part_id")
      .notNull()
      .references(() => parts.id, { onDelete: "cascade" }),
    /**
     * 오버홀 작업 때의 원화 단가(부가세 별도). 0 이상이며 그 규칙은 아래 CHECK 가
     * DB 에서 강제한다. 입력 검증(validation/part-overhaul-unit-price-input.ts)도
     * 같은 규칙을 따로 검사한다 — 화면을 거치지 않고 부른 경우에도 음수가
     * 들어오지 못한다.
     */
    unitPrice: numeric("unit_price", { precision: 15, scale: 2 }).notNull(),
    /** 누가 마지막으로 값을 바꿨는지. 되돌릴 사람을 찾을 때 감사 로그보다 먼저 보게 된다. */
    updatedBy: uuid("updated_by")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    check("part_overhaul_unit_prices_not_negative", sql`${table.unitPrice} >= 0`),
    uniqueIndex("part_overhaul_unit_prices_part_unique").on(table.partId),
  ]
);
