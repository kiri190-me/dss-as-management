import {
  inventoryUnreachableMessage,
  type InventoryPart,
  type InventoryUnreachableReason,
} from "./inventory-gateway";

/**
 * ============================================================================
 * [고장 부품] 조각을 누르면 펼치는 것 — **그 부품의 재고 관리 줄** (2026-10-29)
 * ============================================================================
 * 사용자 요청: 「고장 부품을 누르면 그 아랫부분에 **그 부품의 전체 이름과 현재 재고 등을
 * 구체적으로** 확인할 수 있도록 해줘.」 그리고 같은 날 결정 — 🔴 **소유구분을 나눠서
 * 보여 준다. 합치지 않는다.**
 *
 *     WR10775AA321F — 종단 AMP 게이트 기판
 *        KYOSAN   수량 1
 *        DSS      수량 153
 *
 * 🔴 **합치면 안 되는 까닭**: 재고 관리에서는 **소유가 다르면 부품 번호가 다르다**
 *    (`domain/inventory-gateway.ts` 머리말 — 번호를 고르는 순간 소유가 정해진다). 「154개」로
 *    합쳐 적으면 반출 신청을 올릴 때 고를 수 없는 수가 되고, 남의 소유 재고를 제 것으로
 *    세게 된다. 같은 품번에 줄이 여럿인 것은 **고장이 아니라 그 시스템의 모양**이다.
 *
 * ── 🔴 여기에 망도 DB 도 없다 ───────────────────────────────────────────
 * 받아 온 부품 목록을 **맞대어 고르는 규칙**만 있다. 실제로 묻는 일은
 * `server/inventory-gateway.ts` 가 화면 한 장에 한 번 하고(그 한 번은 이름표를 만드느라
 * 이미 돌고 있다 — 새 조회를 더하지 않았다), 열쇠로 지도를 짜는 일은
 * `domain/product-model-fault-parts.ts` 가 **서버에서** 한다(그쪽이 연락서 판독기를 무는
 * `used-part-display.ts` 를 물기 때문이다). 🔵 이 파일은 그 둘 다 안 물어서 `"use client"`
 * 인 화면이 그대로 import 할 수 있다.
 *
 * ── 🔴 「못 받아 왔다」 · 「못 찾았다」 · 「품번이 없다」는 **다 다른 말**이다 ──
 * 셋 다 줄이 하나도 없는 결과지만 사람이 할 일이 다르다. 하나로 뭉뚱그려 빈 칸을 그리면
 * **「재고가 0개다」로 읽히고**, 그 말을 믿은 사람은 멀쩡히 있는 부품을 두고 다른 길을
 * 찾는다(`domain/inventory-gateway.ts` 머리말의 그 규칙이 여기 걸리는 자리다).
 * 🔵 그래서 아래 `lookupFaultPartInventory` 가 **갈래를 넷으로 갈라** 할 말을 함께 돌려준다 —
 *    화면은 받은 것을 놓기만 한다. 글자를 화면에서 지으면 자리마다 다른 말이 된다.
 * ============================================================================
 */

/**
 * 펼친 자리에 그리는 재고 관리 줄 하나.
 *
 * ── 🔴 **무엇을 싣고 무엇을 뺐는가** (2026-10-29) ───────────────────────
 * 이 값은 `"use client"` 인 화면으로 넘어가므로 **브라우저까지 그대로 나간다.** 그래서
 * 고를 때 기준이 둘이다 — ① 사용자가 말한 것(전체 이름 · 현재 재고 · 소유구분),
 * ② 같은 품번에 줄이 여럿일 때 **사람이 어느 줄인지 가를 수 있는 값**.
 *
 * 🔵 **싣는 것**: 부품 번호(저쪽에서 그대로 찾는 값이고, 반출 신청도 이 번호로 건다) ·
 *    고객사 품명 · 품명 · 품명2 · 교산 품번 · 도번(= 「전체 이름」) · 재고 수 · 소유구분 ·
 *    **비고 첫 줄**(같은 품명인 부품 묶음이 16개라 비고가 유일한 가름 단서다 — 저쪽
 *    API.md 2절, `inventoryPartNoteFirstLine` 머리말).
 * 🔴 **안 싣는 것 — 견적가 · O/H 견적가.** 이 화면의 문은 `productModels.view`(읽기)
 *    하나인데, 지금 A/S 에서 부품 단가가 브라우저로 나가는 길은 **견적서의 단가 자동
 *    채우기 한 곳**뿐이다(`toPartPickerPriceRows` — 견적 화면만 받는다. 2026-10-29 실측으로
 *    금액을 **이름표 달아 그리는** 자리는 하나도 없다). 여기에 달면 제품 모델을 볼 수 있는
 *    모든 사람에게 단가가 새 나가는 **새 길**이 된다. 🔴 돈을 누가 볼 수 있어야 하는지는
 *    이 조각이 정할 일이 아니라, 넣지 않았다 — 필요하면 권한을 정하고 따로 더한다.
 * 🔴 **비고 전문도 안 싣는다**(첫 줄만). 재고 담당이 적는 칸이라 무엇이 적혀 있는지
 *    알 수 없고, 가르는 데 쓰는 것은 첫 줄이다.
 *
 * 🔵 칸 이름을 `InventoryPart` 에서 **그대로** 가져온 까닭: 화면이 이미 있는 그리개
 *    (`inventoryPartCustomerName` · `inventoryPartSpec` · `inventoryPartIdLabels` ·
 *    `inventoryStockText`)에 이 줄을 그대로 넘길 수 있다. 이름을 바꾸면 그 규칙들을
 *    여기서 다시 적게 되고, 「`-` 는 값이 아니다」 같은 자가 두 벌이 된다.
 * 🔵 **소유만 글자로 눕힌다**(`{ code, label }` 이 아니다) — 화면이 하는 일이
 *    `label || code` 하나뿐이라 그 판단을 서버에서 끝낸다.
 */
export type FaultPartInventoryRow = Pick<
  InventoryPart,
  "no" | "name" | "name2" | "customerName" | "kyosanPartNo" | "drawingNo" | "quantity"
> & {
  /** 소유구분. 🔴 **이 줄을 가르는 값**이다(사용자 결정 — 합치지 않는다). */
  ownerLabel: string;
  /** 비고의 첫 줄. 없으면 빈 글자다. */
  noteFirstLine: string;
};

/**
 * 열쇠 → 그 열쇠의 재고 관리 줄들.
 *
 * 🔴 **지도는 「지금 그래프에 떠 있는 부품」만 담는다**(`product-model-fault-parts.ts` 의
 *    `buildFaultPartInventoryIndex`). 재고 관리 부품 전부를 싣지 않는 까닭: 이 값이
 *    브라우저로 그대로 나가는데, 쓰는 것은 조각에 뜬 몇 가지뿐이다.
 * 🔴 **`Map` 이 아니라 평범한 객체**다. 서버 화면에서 `"use client"` 로 넘어가는 값이라
 *    그대로 실려 나갈 수 있는 모양이어야 한다.
 * 🔵 **열쇠가 없는 것과 빈 배열은 같은 뜻**이다(둘 다 「못 찾았다」). 그래서 빈 배열은
 *    애초에 담지 않는다.
 */
export type FaultPartInventoryIndex =
  | { status: "ok"; rowsByKey: Record<string, FaultPartInventoryRow[]> }
  /** 🔴 **「재고가 없다」가 아니라 「못 물어봤다」**다(`InventoryResult` 와 같은 가름). */
  | { status: "unreachable"; reason: InventoryUnreachableReason };

/**
 * 재고 관리에 그 품번이 **없을 때**. 🔴 「재고 0개」로 읽히지 않게 그 말을 **직접 부정**한다.
 *
 * 🔵 이 갈래는 드문 일이 아니다 — 연락서에서 읽은 품번과 재고 관리 도번의 겹침이
 *    30.3% 다(`used-part-display.ts` 머리말의 실측표). 열에 일곱은 여기로 온다.
 */
export const FAULT_PART_INVENTORY_NOT_FOUND =
  "재고 관리에 이 품번으로 등록된 부품이 없습니다 — 재고가 0개라는 뜻이 아닙니다.";

/**
 * 줄에 **품번 자체가 없을 때**. 🔵 `미입력` 조각이 이 갈래다(네 칸이 다 비었거나 `-` 뿐).
 *
 * 🔴 위 「없습니다」와 **다른 말**이어야 한다. 이쪽은 재고 관리에 물어볼 글자조차 없었던
 *    것이라, 고칠 자리가 재고 관리가 아니라 **그 부품 줄**이다.
 */
export const FAULT_PART_INVENTORY_NO_KEY =
  "이 줄에는 품번이 적혀 있지 않아 재고 관리에서 찾을 수 없습니다.";

/**
 * 재고 관리에 **못 물어봤을 때**. 🔴 까닭까지 적는다 — 「불러오지 못했습니다」만 적으면
 * 새로고침하면 될 일인지 설정을 고쳐야 할 일인지 알 수 없다. 까닭 글자는 이 저장소에
 * 이미 한 벌 있다(`inventoryUnreachableMessage`, 다섯 가지).
 */
export function faultPartInventoryUnreachableNotice(reason: InventoryUnreachableReason): string {
  return `재고 관리에서 이 부품을 확인하지 못했습니다 — ${inventoryUnreachableMessage(reason)} 재고가 없는 것이 아니라 확인하지 못한 것입니다.`;
}

/**
 * 펼친 자리가 그릴 것 — **줄들**이거나 **할 말** 하나다.
 *
 * 🔴 빈 줄 목록을 돌려주지 않는다. 그러면 화면이 「없음」을 제 손으로 짓게 되고, 그 말이
 *    곧 이 파일이 막으려는 거짓말이다.
 */
export type FaultPartInventoryLookup =
  | { status: "rows"; rows: FaultPartInventoryRow[] }
  | { status: "notice"; notice: string };

/**
 * 열쇠 하나로 재고 관리 줄을 찾는다 — 🔴 **갈래가 넷이고 차례가 뜻이 있다.**
 *
 *   ① 열쇠가 비었다        → 품번이 없다. 🔴 **재고 관리 형편과 무관하게 참**이라 맨 앞이다.
 *   ② 못 물어봤다          → 모른다. 아래 ③④ 를 **말할 수 없다.**
 *   ③ 줄을 찾았다          → 그 줄들(소유별로 여러 줄일 수 있다).
 *   ④ 물어봤는데 없다      → 재고 관리에 그 품번이 없다.
 *
 * 🔴 ② 를 ① 보다 뒤에 두는 까닭: 품번이 없는 줄은 통로가 멀쩡해도 못 찾는다. 그때
 *    「재고 관리가 응답하지 않습니다」라고 적으면 멀쩡한 통로를 의심하게 된다.
 * 🔴 ④ 를 「0개」로 그리지 않는 까닭은 위 `FAULT_PART_INVENTORY_NOT_FOUND` 머리말에 있다.
 */
export function lookupFaultPartInventory(
  index: FaultPartInventoryIndex,
  matchKey: string
): FaultPartInventoryLookup {
  if (matchKey === "") return { status: "notice", notice: FAULT_PART_INVENTORY_NO_KEY };
  if (index.status !== "ok") {
    return { status: "notice", notice: faultPartInventoryUnreachableNotice(index.reason) };
  }
  const rows = index.rowsByKey[matchKey];
  if (rows && rows.length > 0) return { status: "rows", rows };
  return { status: "notice", notice: FAULT_PART_INVENTORY_NOT_FOUND };
}
