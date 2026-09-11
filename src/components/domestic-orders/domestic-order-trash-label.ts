/**
 * 휴지통 확인 창에 나열할 **한 줄의 이름**(2026-09-11).
 *
 * 내자 정리 줄에는 이름 칸이 없다. 고객사 휴지통은 고객사명을, 견적서 휴지통은
 * 요약 한 줄을 창에 나열하는데, 이 표에서 사람이 줄을 알아보는 단서는 여럿으로
 * 흩어져 있다 — 인수번호 · 고객사 · 발주서번호 · 형식. 그래서 있는 것만 이어
 * 붙인다.
 *
 * ── 활성 줄과 휴지통 줄이 같은 함수를 쓴다 ───────────────────────────────
 * 보낼 때 창에 적힌 이름과 되살릴·완전 삭제할 때 창에 적힌 이름이 다르면 같은
 * 줄인지 알아볼 수 없다. 두 목록(DomesticOrderListItem · DeletedDomesticOrderRow)이
 * 모두 가진 네 칸만 받는다 — 둘 다 같은 규칙(이 행의 값이 먼저, 없으면 수리 건)
 * 으로 이미 정해진 값이다(queries/domestic-orders.ts).
 *
 * 순번을 쓰지 않는 이유: 순번은 사람이 바꾸는 표시 순서라, 지운 뒤에는 그 번호가
 * 다른 줄의 것이 되어 있을 수 있다.
 *
 * 서버 전용 모듈을 부르지 않는 순수 함수다 — 클라이언트 컴포넌트가 부른다.
 */
export type DomesticOrderTrashLabelSource = {
  displayIntakeNumber: string | null;
  customerName: string | null;
  purchaseOrderNumber: string | null;
  modelName: string | null;
};

/** 네 칸이 모두 비어 있을 때. 빈 목록 한 줄보다 "무엇이 비었는지"를 말한다. */
export const UNLABELED_DOMESTIC_ORDER = "(인수번호·고객사·발주서번호가 비어 있는 줄)";

function present(value: string | null): string | null {
  if (value === null) return null;
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

export function domesticOrderTrashLabel(row: DomesticOrderTrashLabelSource): string {
  const purchaseOrderNumber = present(row.purchaseOrderNumber);
  const parts = [
    present(row.displayIntakeNumber),
    present(row.customerName),
    // 번호만 덩그러니 있으면 인수번호와 헷갈린다 — 무슨 번호인지 붙인다.
    purchaseOrderNumber === null ? null : `발주 ${purchaseOrderNumber}`,
    present(row.modelName),
  ].filter((part): part is string => part !== null);
  return parts.length === 0 ? UNLABELED_DOMESTIC_ORDER : parts.join(" · ");
}
