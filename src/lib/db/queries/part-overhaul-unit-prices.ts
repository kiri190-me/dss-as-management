import "server-only";
import { inArray } from "drizzle-orm";
import { db } from "../client";
import { partOverhaulUnitPrices } from "../schema";

/**
 * ============================================================================
 * O/H 단가 읽기
 * ============================================================================
 * **읽기 전용이다.** 이 파일에는 mutation 이 없다
 * (queries/part-unit-prices.ts 와 같은 규약).
 * ============================================================================
 */

/**
 * 부품 여러 개의 O/H 단가. 부품 id → 단가 문자열.
 *
 * ── 🔴 왜 한 번에 여러 개를 받는가 ──────────────────────────────────────
 * 형제(getPartUnitPrices)는 부품 하나를 받는다 — 부품 상세 화면이 한 부품의
 * 소유자 넷을 그리기 때문이다. O/H 단가를 쓰는 화면은 반대다: **O/H 부품 템플릿
 * 한 장이 부품 열몇 개를 한 표에 그린다.** 부품마다 한 번씩 부르면 그 화면 한 장에
 * 질의가 열몇 번 열린다(N+1). 그래서 목록을 받는다.
 *
 * ── 🔴 정해진 것만 돌아온다 ─────────────────────────────────────────────
 * 없는 부품을 "0" 으로 채워 돌려주지 않는다. 채우면 "정하지 않음"과 "0원(무상)"이
 * **화면에 닿기도 전에** 같은 값이 되어 버리고, 그 뒤로는 어느 쪽이었는지 되찾을
 * 수 없다(schema/part-overhaul-unit-prices.ts 머리말). 부른 부품을 모두 줄로
 * 그리는 것은 화면의 일이고, 그 화면은 여기 없는 부품을 빈 칸으로 그린다.
 * 그래서 반환값이 배열이 아니라 Map 이다 — "없음"이 곧 키가 없는 것이다.
 *
 * ── 빈 목록이면 질의를 열지 않는다 ──────────────────────────────────────
 * Drizzle 의 inArray 에 빈 배열을 넘기면 SQL 이 이상해진다. 물어볼 것이 없을 때
 * DB 를 다녀올 이유도 없다.
 *
 * numeric 은 Drizzle 이 **문자열로 읽는다**. 화면까지 문자열로 옮긴다 — Number 를
 * 거치면 오차가 쌓이고, 그 오차가 견적서 합계와 세금계산서 사이의 1원 차이가 된다.
 */
export async function getPartOverhaulUnitPrices(partIds: string[]): Promise<Map<string, string>> {
  if (partIds.length === 0) return new Map();

  const rows = await db
    .select({ partId: partOverhaulUnitPrices.partId, unitPrice: partOverhaulUnitPrices.unitPrice })
    .from(partOverhaulUnitPrices)
    .where(inArray(partOverhaulUnitPrices.partId, partIds));

  return new Map(rows.map((row) => [row.partId, row.unitPrice]));
}
