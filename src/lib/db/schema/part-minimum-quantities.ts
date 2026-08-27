import { sql } from "drizzle-orm";
import { check, integer, pgTable, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { parts } from "./inventory";
import { stockOwnerEnum } from "./inventory-enums";
import { users } from "./users";

/**
 * ============================================================================
 * 한계수량 — 부품 × 소유자마다 "이 밑으로 떨어지면 알려 달라"
 * ============================================================================
 * 재고가 이 값 아래로 내려가면 종 알림이 뜬다(queries/part-minimum-quantities.ts의
 * listPartsBelowMinimumQuantity). 여기 저장하는 것은 재고가 아니라 **재고를 보는
 * 기준**이다.
 *
 * ── 왜 parts에 칸 넷을 만들지 않았나 ────────────────────────────────────
 * `한계_DSS`·`한계_교산`… 처럼 칸을 넷 두면 소유자가 하나 느는 순간 또
 * 마이그레이션이다. 소유자 목록은 이미 stock_owner enum으로 따로 있는데
 * (schema/inventory-enums.ts), 그 값들의 이름을 칸 이름에 다시 박아 넣게 되어
 * 같은 목록이 두 벌이 된다. 소유자는 **자료의 축**이지 부품의 속성이 아니다 —
 * part_stock_balances가 이미 같은 결론으로 (부품, 소유자, 위치) 행을 쓰고 있다.
 *
 * ── 🔴 왜 part_stock_balances에 칸을 더하지 않았나 (이 표가 따로 있는 진짜 이유) ─
 * part_stock_balances는 **재고가 있어야 행이 생긴다**. 입고가 한 번이라도 있어야
 * (부품, 소유자, 위치) 버킷이 만들어지므로, "DSS 것이 하나도 없다"는 상태는 그
 * 표에서 **행이 아예 없는 상태**다.
 *
 * 그런데 그것이 바로 알려야 할 경우다. 한계수량은 **재고가 없어도 있어야 한다** —
 * 0개인 부품에 한계 5를 걸어 두는 것이 이 기능의 가장 중요한 쓰임이고, 잔량 표에
 * 칸을 붙이면 그 경우를 표현할 자리가 없다(행이 없으니 붙일 칸도 없다). 그래서
 * 한계수량은 잔량과 **수명이 다른 자료**이고, 자기 표를 갖는다.
 *
 * 같은 이유로 부족 조회는 반드시 이 표에서 출발해 잔량 표로 LEFT JOIN 한다.
 * INNER JOIN 이면 "하나도 없는" 부품이 통째로 빠진다.
 *
 * ── 🔴 "행이 없다"와 "0을 저장했다"는 다른 뜻이다 ──────────────────────
 *   · **행이 없다**  = 한계수량을 정하지 않았다 = 그 소유자는 알림 대상이 아니다.
 *   · **0을 저장했다** = "하나도 없으면 알려 달라"는 뜻이다. 재고 0 < 한계 0은
 *     거짓이므로 0 자체로는 알림이 뜨지 않지만, 음수 재고가 구조적으로 불가능한
 *     이 시스템에서 0은 "재고가 남아 있는 한 조용히, 바닥나면 그때"라는 지시로
 *     읽힌다. 껐다는 뜻이 아니다.
 *
 * 그래서 화면에서 칸을 비우면 0을 저장하지 않고 **행을 지운다**
 * (mutations/part-minimum-quantities.ts). 비운 것을 0으로 저장해 버리면 "정하지
 * 않음"을 다시 표현할 방법이 사라진다.
 *
 * ── 부품이 지워질 때 — ON DELETE CASCADE ────────────────────────────────
 * part_stock_balances는 RESTRICT다(재고 원장의 뿌리라 부품과 함께 조용히 사라지면
 * 안 된다). 한계수량은 그만큼 무거운 자료가 아니다 — 사람이 다시 칠 수 있는
 * **설정값**이고, 부품 자체가 없어지면 그 밑으로 떨어질 재고도 없다.
 *
 * RESTRICT였다면 더 나쁘다: 한계수량을 한 번 적어 둔 부품은 완전삭제가 FK 오류로
 * 막힌다. 완전삭제 경로(mutations/inventory.ts의 permanentlyDeletePart,
 * mutations/master-data-purge.ts의 purgeExpiredPart)는 잔량 버킷만 지우고 부품을
 * 지우도록 되어 있어, 이 표를 모르는 채로 23503에 걸린다 — 자동 정리 작업 전체가
 * 거기서 멈춘다. CASCADE면 그 경로들을 한 줄도 고치지 않고 뜻대로 동작한다.
 *
 * ── 컬럼 관례 ───────────────────────────────────────────────────────────
 * role_permissions · notification_*_settings와 같다 — 대리 키 + updated_by /
 * updated_at. 대리 키를 쓰는 이유도 같다: 감사 로그의 target_record_id가 NOT NULL
 * uuid라, 누가 언제 기준을 바꿨는지 남기려면 행마다 uuid 하나가 있어야 한다.
 * 유일성은 아래 유니크 인덱스가 지킨다.
 * ============================================================================
 */
export const partMinimumQuantities = pgTable(
  "part_minimum_quantities",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    partId: uuid("part_id")
      .notNull()
      .references(() => parts.id, { onDelete: "cascade" }),
    owner: stockOwnerEnum("owner").notNull(),
    /**
     * 이 값 **미만**이면 부족이다(같으면 부족 아님 — "그 밑으로 떨어지면"이다).
     * 0 이상 정수이며, 그 규칙은 아래 CHECK가 DB에서 강제한다. 입력 검증
     * (validation/part-minimum-quantity-input.ts)도 같은 규칙을 따로 검사한다 —
     * 화면을 거치지 않고 부른 경우에도 음수·소수가 들어오지 못한다.
     */
    minimumQuantity: integer("minimum_quantity").notNull(),
    /** 누가 마지막으로 기준을 바꿨는지. 되돌릴 사람을 찾을 때 감사 로그보다 먼저 보게 된다. */
    updatedBy: uuid("updated_by")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    check("part_minimum_quantities_not_negative", sql`${table.minimumQuantity} >= 0`),
    uniqueIndex("part_minimum_quantities_part_owner_unique").on(table.partId, table.owner),
  ]
);
