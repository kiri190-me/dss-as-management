import "server-only";
import { eq } from "drizzle-orm";
import { db } from "../client";
import { partUnitPrices } from "../schema";
import type { StockOwner } from "@/lib/domain/inventory-types";

/**
 * ============================================================================
 * 단가 읽기
 * ============================================================================
 * **읽기 전용이다.** 이 파일에는 mutation 이 없다.
 * ============================================================================
 */

export type PartUnitPriceRow = {
  owner: StockOwner;
  /** numeric 은 Drizzle 이 문자열로 읽는다. 화면까지 문자열로 옮긴다. */
  unitPrice: string;
};

/**
 * 부품 하나의 소유구분별 단가. **정해진 것만 돌아온다** — 소유자 넷을 채워 주지
 * 않는다.
 *
 * 행이 없는 소유자를 "0" 으로 채워 돌려주면 "정하지 않음"과 "0원(무상)"이 화면에
 * 닿기 전에 같은 값이 되어 버린다(schema/part-unit-prices.ts 머리말). 넷을 모두
 * 줄로 그리는 것은 화면의 일이고, 그 화면은 여기 없는 소유자를 빈 칸으로 그린다.
 */
export async function getPartUnitPrices(partId: string): Promise<PartUnitPriceRow[]> {
  return db
    .select({ owner: partUnitPrices.owner, unitPrice: partUnitPrices.unitPrice })
    .from(partUnitPrices)
    .where(eq(partUnitPrices.partId, partId))
    .orderBy(partUnitPrices.owner);
}
