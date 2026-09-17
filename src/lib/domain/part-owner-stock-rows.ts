/**
 * ============================================================================
 * 부품 상세의 「소유 구분별 재고 · 한계수량」 표 — 줄 만들기
 * ============================================================================
 * 화면(PartBalanceGrid)이 그릴 줄을 만드는 **순수 함수**다. 프레임워크도
 * `server-only` 도 물지 않아 시험이 그대로 부를 수 있다 — 아래 두 규칙이 화면
 * 안에 숨어 있으면 못 박을 방법이 없어서 밖으로 꺼냈다.
 *
 * 🔴 **줄은 소유구분 넷 고정이다.** 재고 행(part_stock_balances)이 하나도 없는
 * 소유구분도 `현재 수량 0` 인 줄로 나온다. 그 표는 입고가 있어야 행이 생기므로,
 * 재고가 있는 것만 그리면 "아직 우리 것이 없다"는 소유구분에 한계수량을 걸 자리
 * 자체가 사라진다.
 *
 * 🔴 **현재 수량은 그 소유의 위치를 모두 합한 값이다.** 위치별로 줄을 쪼개지
 * 않는다. part_stock_balances 의 유일 제약이 `(part_id, owner, location)` 이라
 * 한 소유에 위치가 여럿일 수 있는데, 그때 줄을 쪼개면 ⑴ 한계수량이 위치마다
 * 있는 것처럼 보이고 ⑵ 부족 배지의 뜻이 깨지며 ⑶ 부족 조회가 DB 에서 쓰는
 * 셈법(소유별 SUM)과 갈라져 화면의 숫자와 종 알림의 숫자가 다른 말을 한다.
 * ============================================================================
 */
import { STOCK_OWNER_CODES, type StockOwner } from "./inventory-types";

/** 이 함수가 보는 최소한의 재고 행. 실제 인자는 이보다 칸이 많아도 된다. */
export type PartOwnerStockBalance = {
  owner: StockOwner;
  currentQuantity: number;
};

/** 표의 한 줄 = 소유구분 하나. 재고 행은 `balances` 에 원래 모양 그대로 담긴다. */
export type PartOwnerStockRowOf<B extends PartOwnerStockBalance> = {
  owner: StockOwner;
  /** 그 소유구분의 재고 행 — 위치마다 하나. 없으면 빈 배열이다. */
  balances: B[];
  /** 🔴 위치를 모두 합한 지금 수량. 재고 행이 없으면 0 이다. */
  currentQuantity: number;
  /** 저장된 한계수량. null 이면 **정하지 않음**이고 0(바닥나면 알려 달라)과 다르다. */
  minimumQuantity: number | null;
};

export function buildPartOwnerStockRows<B extends PartOwnerStockBalance>(
  balances: readonly B[],
  /** 정해진 소유자만 들어 있다 — 없는 소유자는 "정하지 않음"(null)이다. */
  minimumQuantityByOwner: ReadonlyMap<StockOwner, number>
): PartOwnerStockRowOf<B>[] {
  const byOwner = new Map<StockOwner, B[]>();
  for (const balance of balances) {
    const bucket = byOwner.get(balance.owner);
    if (bucket) bucket.push(balance);
    else byOwner.set(balance.owner, [balance]);
  }

  return STOCK_OWNER_CODES.map((owner) => {
    const ownerBalances = byOwner.get(owner) ?? [];
    return {
      owner,
      balances: ownerBalances,
      currentQuantity: ownerBalances.reduce((sum, balance) => sum + balance.currentQuantity, 0),
      minimumQuantity: minimumQuantityByOwner.get(owner) ?? null,
    };
  });
}
