import {
  parseStockRequestLines,
  type ChargeType,
  type ParseStockRequestLinesResult,
} from "./inventory-gateway";

/**
 * ============================================================================
 * 재고 관리에 올릴 부품 담기 — 화면 상태의 순수 규칙
 * ============================================================================
 * 틀(React/Next)을 하나도 끌어오지 않는다. `PartRequestSection.tsx` 가 `useState` 를
 * 들고, 여기에는 **담고 고치고 빼는 규칙과 올리기 전 검사**만 둔다 — 이웃
 * `inventory-part-request-cart.ts`(A/S 제 표에 올리던 옛 장바구니)와 같은 방식이다.
 *
 * 🔴 **옛 장바구니와 가장 다른 점 둘**
 *  ① 열쇠가 **재고 관리의 부품 번호(`no`)** 다. A/S 의 `part_id`(uuid) 가 아니다.
 *  ② **소유를 고르지 않는다.** 재고 관리에서는 소유가 다르면 부품 번호가 다르므로,
 *     번호를 고르는 순간 소유가 정해진다 — 화면에는 **보여 주기만** 한다.
 *     대신 **유상/무상**을 줄마다 고르고, 🔴 **기본값을 두지 않는다**(청구에 걸리는 값이다).
 * ============================================================================
 */

export type StockRequestCartLine = {
  /** 재고 관리의 부품 번호. 장바구니 한 줄의 열쇠다. */
  no: number;
  name: string;
  /** 🔴 **보여 주기만 하는 값.** 고르는 칸이 아니다(머리말). */
  ownerLabel: string;
  /** 입력칸의 글자 그대로 들고 있는다 — 숫자로 바꾸는 자리는 `validateStockRequestCart` 하나다. */
  quantity: string;
  /** 🔴 **빈 글자가 기본이다.** 사람이 고르기 전에는 올리지 못한다. */
  chargeType: ChargeType | "";
  /**
   * **[O/H 부품 한 번에 담기]로 담긴 줄인가** (2026-10-22, 쓰는 분 요청).
   *
   * 🔴 **담는 그 순간에 정해지고, 그 뒤로 바뀌지 않는다.** 손으로 담으면 거짓, [한 번에 담기]로
   *    담기면 참이다 — 담은 **자리**가 정하는 값이라 사람이 고치는 칸이 아니고, 그래서 위
   *    `chargeType` 과 달리 **빈 상태가 없다.**
   * 🔴 **나중에 템플릿을 다시 보지 않는다.** 템플릿은 바뀐다 — 지금 템플릿에 있는지로 판정하면
   *    담아 둔 줄의 딱지가 **고치지도 않았는데** 달라진다.
   * 🔵 수량을 고치거나 유상/무상을 골라도 그대로다(`applyStockRequestCartPatch` 는 준 칸만 덮는다).
   */
  fromOhTemplate: boolean;
};

/** 한 칸만 고치는 패치가 그 줄의 다른 칸이나 다른 줄을 건드리면 안 된다. */
export function applyStockRequestCartPatch(
  cart: readonly StockRequestCartLine[],
  no: number,
  patch: Partial<StockRequestCartLine>
): StockRequestCartLine[] {
  return cart.map((line) => (line.no === no ? { ...line, ...patch } : line));
}

/**
 * 담는다. 🔴 **이미 담긴 부품은 두 줄이 되지 않는다** — 저쪽이 같은 번호 두 줄을 거절하고
 * (API.md 4-2절), 한 줄로 합쳐 보내야 한다. 이미 있으면 그대로 둔다(수량을 말없이 더하면
 * 사람이 모르는 사이에 요청 수량이 불어난다).
 */
export function addStockRequestCartLine(
  cart: readonly StockRequestCartLine[],
  line: StockRequestCartLine
): StockRequestCartLine[] {
  if (cart.some((existing) => existing.no === line.no)) return [...cart];
  return [...cart, line];
}

export function removeStockRequestCartLine(
  cart: readonly StockRequestCartLine[],
  no: number
): StockRequestCartLine[] {
  return cart.filter((line) => line.no !== no);
}

/**
 * 올리기 전 검사. 🔴 **규칙이 적힌 자리는 `parseStockRequestLines` 하나다** — 서버 액션도
 * 같은 함수를 쓴다. 여기서 따로 적으면 화면은 통과시키고 저쪽이 400 으로 돌려보낸다.
 *
 * 하는 일은 **글자를 숫자로 바꿔 넘기는 것**뿐이다(입력칸은 글자를 준다). 빈 칸·글자는
 * 숫자가 아니게 되어 수량 검사에서 걸린다.
 */
export function validateStockRequestCart(
  cart: readonly StockRequestCartLine[]
): ParseStockRequestLinesResult {
  const labels = new Map(cart.map((line) => [line.no, line.name]));
  return parseStockRequestLines(
    cart.map((line) => ({
      no: line.no,
      quantity: line.quantity.trim() === "" ? null : Number(line.quantity),
      chargeType: line.chargeType === "" ? null : line.chargeType,
      /* 🔴 **그대로 넘긴다** — 여기서 템플릿을 다시 보지 않는다(그 칸 주석). 넘기지 않으면
         올릴 때 조용히 거짓이 되어 **담는 중에만 보이던 딱지**가 된다. */
      fromOhTemplate: line.fromOhTemplate,
    })),
    labels
  );
}

/**
 * ============================================================================
 * 요청 번호 — 🔴 **같은 장바구니를 두 번 눌러도 같은 값이어야 한다**
 * ============================================================================
 * 저쪽은 이 값이 열쇠라서, 같은 열쇠로 두 번 오면 신청을 두 번 세우지 않고 **처음 만든
 * 신청을 그대로** 돌려준다(API.md 4-4절). 그러면 우리는 사람에게 「이미 올라갔습니다」로
 * 말해 주면 된다. 값이 매번 달라지면 그 보호가 통째로 사라져 **같은 요청이 두 줄** 선다.
 *
 * 들고 있는 자리는 화면의 `useRef` 다(`generateClientUuid()` 를 담아 쓰던 그 방식 그대로).
 * 🔴 **성공한 뒤에만 비운다** — 실패해서 다시 누르는 것은 **같은 요청**이다.
 *
 * 함수로 떼어 둔 까닭: `useRef` 그대로는 브라우저 없이 재 볼 수 없는데, 이 규칙은
 * 「두 번 눌러도 같은가」가 전부라 **실제로 두 번 불러 봐야** 지켜진 것을 안다.
 * ============================================================================
 */
export type RequestKeyHolder = { current: string | null };

export function getOrCreateRequestKey(holder: RequestKeyHolder, make: () => string): string {
  if (holder.current === null) holder.current = make();
  return holder.current;
}

/** 🔴 **성공한 뒤에만** 부른다. 다음 요청은 새 번호로 선다. */
export function resetRequestKey(holder: RequestKeyHolder): void {
  holder.current = null;
}
