import "server-only";
import { eq } from "drizzle-orm";
import { db } from "../client";
import { partUnitPrices } from "../schema";

/**
 * ============================================================================
 * 단가 읽기
 * ============================================================================
 * **읽기 전용이다.** 이 파일에는 mutation 이 없다.
 * ============================================================================
 */

/**
 * 부품 하나의 단가. **없으면 null 이다** — "0" 으로 채우지 않는다.
 *
 * 🔴 소유구분(owner)을 보지 않는다. 부품 하나에 단가 하나다
 * (schema/part-unit-prices.ts 머리말, 2026-09-17 사용자 정정). 예전에는 소유자별
 * 줄을 배열로 돌려주고 화면이 넷을 그렸는데, 이제 돌려줄 값이 하나뿐이다.
 *
 * 행이 없는 것을 "0" 으로 채워 돌려주면 "정하지 않음"과 "0원(무상)"이 화면에
 * 닿기 전에 같은 값이 되어 버린다(그 머리말의 그 구분). null 은 화면에서 빈
 * 칸이 되고, "0" 은 0원으로 보인다.
 */
export async function getPartUnitPrice(partId: string): Promise<string | null> {
  const [row] = await db
    .select({ unitPrice: partUnitPrices.unitPrice })
    .from(partUnitPrices)
    .where(eq(partUnitPrices.partId, partId))
    .limit(1);
  return row?.unitPrice ?? null;
}
