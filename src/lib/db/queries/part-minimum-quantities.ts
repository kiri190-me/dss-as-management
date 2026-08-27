import "server-only";
import { and, eq, sql } from "drizzle-orm";
import { db } from "../client";
import { partMinimumQuantities, partStockBalances, parts } from "../schema";
import type { StockOwner } from "@/lib/domain/inventory-types";

/**
 * ============================================================================
 * 한계수량 읽기 — 그리고 "지금 그 밑으로 떨어진 것"
 * ============================================================================
 * **읽기 전용이다.** 이 파일에는 mutation 이 없다.
 * ============================================================================
 */

export type PartMinimumQuantityRow = {
  owner: StockOwner;
  minimumQuantity: number;
};

/**
 * 부품 하나의 한계수량. **정해진 것만 돌아온다** — 소유자 넷을 채워 주지 않는다.
 *
 * 행이 없는 소유자를 0 으로 채워 돌려주면 "정하지 않음"과 "0 으로 정함"이 화면에
 * 닿기 전에 같은 값이 되어 버린다(schema/part-minimum-quantities.ts 머리말).
 * 넷을 모두 줄로 그리는 것은 화면의 일이고, 그 화면은 여기 없는 소유자를 빈 칸으로
 * 그린다.
 */
export async function getPartMinimumQuantities(partId: string): Promise<PartMinimumQuantityRow[]> {
  return db
    .select({
      owner: partMinimumQuantities.owner,
      minimumQuantity: partMinimumQuantities.minimumQuantity,
    })
    .from(partMinimumQuantities)
    .where(eq(partMinimumQuantities.partId, partId))
    .orderBy(partMinimumQuantities.owner);
}

export type PartBelowMinimumRow = {
  partId: string;
  partName: string;
  owner: StockOwner;
  /** 그 소유자의 **위치를 모두 합한** 수량. 재고 행이 아예 없으면 0 이다. */
  currentQuantity: number;
  minimumQuantity: number;
};

/**
 * 지금 한계수량 밑으로 떨어진 (부품, 소유자) 짝 전부.
 *
 * ── 🔴 이 조회에서 가장 틀리기 쉬운 곳 ──────────────────────────────────
 * **출발점이 한계수량 표이고, 재고 표로 LEFT JOIN 한다.** 순서를 뒤집거나
 * INNER JOIN 을 쓰면 재고 행이 **아예 없는** 소유자가 통째로 빠지는데, 그것이
 * 바로 가장 알려야 할 경우다 — part_stock_balances 는 입고가 한 번이라도 있어야
 * 행이 생기므로 "DSS 것이 하나도 없다"는 상태가 곧 행이 없는 상태다. LEFT JOIN
 * 이라 그 짝은 NULL 로 붙고, coalesce(sum(...), 0) 이 0 으로 만든다.
 *
 * ── 견주는 규칙 ─────────────────────────────────────────────────────────
 *   · 한계수량이 **정해진** 짝만 본다(이 표에 행이 있는 것만). 행이 없으면 알림
 *     대상이 아니다 — 그래서 한계수량을 하나도 정하지 않은 상태에서는 이 조회가
 *     언제나 빈 목록이고, 종 알림도 지금과 한 줄도 달라지지 않는다.
 *   · 한 소유자의 **위치를 모두 합해서** 견준다. A창고 3 + B창고 4 = 7 이지,
 *     위치마다 따로 견주지 않는다.
 *   · 합계 **<** 한계수량이면 부족이다. **같으면 부족이 아니다** — "그 밑으로
 *     떨어지면"이므로 경계값은 아직 괜찮다.
 *   · 지워진 부품(is_deleted)은 보지 않는다. 휴지통에 있는 부품을 채우라는
 *     알림은 할 일이 아니다.
 *
 * 알림 한 줄에 필요한 값만 읽는다(부품 id · 품명 · 소유자 · 지금 수량 · 한계수량).
 * 도번·분류 같은 것은 알림에 나오지 않으므로 싣지 않는다.
 */
export async function listPartsBelowMinimumQuantity(): Promise<PartBelowMinimumRow[]> {
  return db
    .select({
      partId: parts.id,
      partName: parts.partName,
      owner: partMinimumQuantities.owner,
      currentQuantity: sql<number>`coalesce(sum(${partStockBalances.currentQuantity}), 0)::int`,
      minimumQuantity: partMinimumQuantities.minimumQuantity,
    })
    .from(partMinimumQuantities)
    .innerJoin(parts, eq(parts.id, partMinimumQuantities.partId))
    // 🔴 LEFT JOIN — 재고 행이 없는 소유자를 0 으로 보기 위한 것이다(위 머리말).
    .leftJoin(
      partStockBalances,
      and(
        eq(partStockBalances.partId, partMinimumQuantities.partId),
        eq(partStockBalances.owner, partMinimumQuantities.owner)
      )
    )
    .where(eq(parts.isDeleted, false))
    .groupBy(
      parts.id,
      parts.partName,
      partMinimumQuantities.id,
      partMinimumQuantities.owner,
      partMinimumQuantities.minimumQuantity
    )
    .having(
      sql`coalesce(sum(${partStockBalances.currentQuantity}), 0) < ${partMinimumQuantities.minimumQuantity}`
    )
    .orderBy(parts.partName, partMinimumQuantities.owner);
}
