import {
  SHIPMENT_APPROVAL_ROUTE_SCOPE_LABELS,
  type ShipmentApprovalRouteScope,
} from "./shipment-approval-route";
import type { ShipmentApprovalState } from "./local/workflow/shipment-approval-checklist";

/**
 * ============================================================================
 * 기타건 최종 출하 승인 — 순수 규칙
 * ============================================================================
 * 「기타건」은 **내자 정리의 한 줄**이다(`domestic_orders`). 그 줄의 최종 출하
 * 승인을 올리고 · 처리하고 · 되짚는 규칙 중 **자료를 읽지 않고 답할 수 있는 것**만
 * 여기 둔다. 저장 경로(db/mutations/domestic-order-approvals.ts) · 조회
 * (db/queries/domestic-order-approvals.ts) · 화면이 **같은 함수 하나**를 보게 하려는
 * 것이고, domain/quote-approval-rules.ts 와 같은 자리다.
 *
 * ── 🔴 「기존에 만들어놨던 승인절차를 그대로 사용한다」 (2026-11-06 사용자) ──
 * 그래서 이 파일에 **새 규칙이 거의 없다.** 결재선 고르기 · 요청자 본인 단계
 * 건너뛰기 · 지정 관문 · 결재선 단계 위임 · 「요청 뒤에 바뀌면 무효」까지 전부 이미
 * 있는 함수를 그대로 부른다:
 *  · 다음 단계 고르기 → domain/shipment-approval-route.ts 의 findNextRouteStepToApprove
 *  · 지금 상태      → domain/local/workflow/shipment-approval-checklist.ts 의
 *                      resolveApprovalState (아래 타입을 그대로 쓴다)
 *  · 지정 관문·위임 → auth/approval-assignment.ts
 * 🔴 **여기에 같은 규칙을 한 벌 더 적지 말 것.** 두 벌이 되는 순간 수리 건과 기타건이
 * 서로 다른 결재선 규칙을 갖게 되고, 그 어긋남은 둘을 나란히 놓고 보기 전에는
 * 드러나지 않는다.
 *
 * ── 🔴 갈래를 따로 둔 까닭 ──────────────────────────────────────────────
 * 사용자가 한 번 뒤집어 정했다(2026-11-06): 처음엔 「기존 승인절차를 그대로」였다가
 * 바로 「**[기타건 최종 출하승인]으로 절차를 따로** 만들자」가 됐다. 뜻은 **결재하는
 * 사람이 다를 수 있다**는 것이다 — 'QUOTE' 를 출하와 갈라 둔 것과 같은 이유다.
 * 그래서 **절차(결재선)만 갈라지고 흐름은 한 벌**이다.
 *
 * ── 🔴 이 승인은 무엇을 막는가 — 아무것도 막지 않는다 ───────────────────
 * 기타건에는 워크플로가 없다. 수리 건 출하 승인은 다 끝나면 단계를 [출하 대기]로
 * 옮기지만(mutations/shipment-waiting-auto-advance.ts), **기타건에는 옮길 단계 자체가
 * 없다.** 내자 줄의 「완료 처리」도 이 승인을 보지 않는다 — 그 단추의 관문은
 * `domesticOrders` WRITE 하나이고 2026-11-06 에 한 줄도 건드리지 않았다.
 * 🔴 그러니 여기서 남는 것은 **「누가 언제 승인했나」라는 기록**뿐이다. 막아야 할
 * 필요가 생기면 코드를 고치기 전에 사용자에게 먼저 묻는다(견적서 결재와 같은 규율).
 * ============================================================================
 */

/**
 * 이 승인이 쓰는 결재선의 용도. 🔴 **글자를 적는 자리를 하나로 묶어 둔다** — 저장
 * 경로와 조회와 화면이 각자 문자열을 적으면 오타 하나가 「판이 없다」로 조용히
 * 보이고, 그 순간 이 기능은 통째로 꺼진다(그것이 안전장치의 정상 동작이라 오류도
 * 나지 않는다). QUOTE_APPROVAL_ROUTE_SCOPE 가 견적서 쪽에서 하는 일과 같다.
 */
export const DOMESTIC_ORDER_APPROVAL_ROUTE_SCOPE: ShipmentApprovalRouteScope =
  "DOMESTIC_ORDER_FINAL_SHIPMENT";

/**
 * 결재 행에 적히는 승인 종류(`repair_case_approvals.approval_type`).
 *
 * 🔴 **결재선 용도와 글자가 같지만 서로 다른 enum 이다** — 한쪽은
 * `shipment_approval_route_scope`, 다른 쪽은 `repair_case_approval_type` 이다. 같은
 * 값을 두 번 적는 대신 위 상수를 재활용하고 싶어지는 자리인데, 그렇게 묶어 두면 둘
 * 중 하나만 바뀌어야 하는 날 함께 끌려간다(출하 승인이 이미 그 모양이다 —
 * 'FINAL_SHIPMENT' 가 두 enum 에 각각 있다).
 */
export const DOMESTIC_ORDER_APPROVAL_TYPE = "DOMESTIC_ORDER_FINAL_SHIPMENT";
export type DomesticOrderApprovalType = typeof DOMESTIC_ORDER_APPROVAL_TYPE;

/**
 * 사람이 읽는 이름. 🔴 글자를 새로 적지 않고 **용도 이름표 한 곳**에서 가져온다 —
 * 같은 절차가 [사용자 관리] 의 고르개에서는 「기타건 최종 출하 승인」, 기타건 상세의
 * [승인] 탭에서는 다른 말로 불리면 관리자는 그것이 같은 것인지 알 수 없다.
 * domain/notifications.ts 의 QUOTE_APPROVAL_LABEL 과 같은 자리다.
 */
export const DOMESTIC_ORDER_APPROVAL_LABEL =
  SHIPMENT_APPROVAL_ROUTE_SCOPE_LABELS.DOMESTIC_ORDER_FINAL_SHIPMENT;

/**
 * 「기타건 최종 출하 승인」 판이 **지금 쓰이고 있는가** — 판이 있고 단계가 1개 이상.
 *
 * 🔴 단계 0개인 판은 **판이 아예 없는 것과 같게** 다룬다(스키마가 「단계 0개인 판도
 * 정상이다 — 절차를 쓰지 않겠다는 뜻」이라고 적어 둔 그대로다).
 *
 * 🔴 **거짓이면 요청을 거절한다.** 근거는 견적서 결재와 같고, 기타건에는 한 가지가
 * 더 있다:
 *  1. 용도의 빈 상태 문장이 그렇게 말한다 — SHIPMENT_APPROVAL_ROUTE_EMPTY_NOTICES
 *     의 이 용도는 「요청할 수 없습니다」이다.
 *  2. 지정이 NULL 인 행은 mayDecideAssignedApproval 이 **누구에게나 참**을 돌려주므로
 *     「아무나 눌러도 되는 승인」이 된다 — 기록으로서 뜻이 없다.
 *  3. 🔴 기타건에는 **「출하 대표」가 없다.** 접수 건 출하 승인이 판 없이도 도는 것은
 *     `users.is_shipment_representative` 라는 다른 결재자가 있기 때문인데, 그 깃발은
 *     수리 건 출하를 위해 세운 자리다. 기타건에 그대로 끌어다 쓰면 「출하 대표」의
 *     뜻이 소리 없이 넓어진다.
 *
 * 🔴 **판의 모양을 가리지 않는다**(`steps` 만 본다) — 판을 읽는 조회가 둘이고
 * 돌려주는 타입이 서로 다르다. 타입 좁힘까지 겸한다.
 */
export function isDomesticOrderApprovalRouteInForce<TRoute extends { steps: readonly unknown[] }>(
  route: TRoute | null
): route is TRoute {
  return route !== null && route.steps.length > 0;
}

/**
 * 🔴 결재를 **올릴 수 있는** 상태들.
 *
 * 서버가 막는 것은 「이미 처리 대기 중인 요청이 있을 때」 하나뿐이므로
 * (ALREADY_REQUESTED) 진행 중이 아니면 언제든 올릴 수 있다. 그런데도 `APPROVED` 를
 * 뺀 것은 **지금 이 내용 그대로 승인이 살아 있는** 상태라서다 — 거기서 또 올리면
 * 방금 받은 승인을 스스로 지우는 꼴이 된다. 줄을 고치면 상태가 `STALE` 로 넘어가고,
 * 그때 다시 열린다.
 *
 * 🔵 `STALE` 이 여기 있는 것이 수리 건 출하 카드와 같은 판단이다(그쪽도 STALE 에서
 * 재요청 단추를 연다 — DatabaseFinalShipmentCard).
 */
export const DOMESTIC_ORDER_APPROVAL_REQUESTABLE_STATES: readonly ShipmentApprovalState[] = [
  "NOT_REQUESTED",
  "REJECTED",
  "STALE",
];

/** 지금 상태에서 결재를 올릴 수 있는가 — 화면과 시험이 같은 함수를 본다. */
export function isDomesticOrderApprovalRequestable(state: ShipmentApprovalState): boolean {
  return DOMESTIC_ORDER_APPROVAL_REQUESTABLE_STATES.includes(state);
}

/**
 * 🔴 **결재선 판이 하나도 없을 때 화면이 하는 말.**
 *
 * 조용한 빈 화면으로 두지 않는다 — 단추도 없고 설명도 없으면 사람은 탭이 깨졌다고
 * 읽는다(DomesticOrderDetailNotice 머리말의 그 사고다). 그래서 **무엇이 없고 어디서
 * 만드는지**까지 적는다.
 *
 * 🔴 **저장 경로가 거절할 때 쓰는 말과 같은 한 줄이다** — 화면이 미리 말하는 것과
 * 서버가 거절하며 말하는 것이 다르면, 둘을 다 본 사람은 어느 쪽이 참인지 모른다.
 *
 * 이름표를 글자로 다시 적지 않는 것은 위 DOMESTIC_ORDER_APPROVAL_LABEL 과 같은
 * 까닭이다 — 관리자가 고르개에서 보는 이름과 **한 글자도 달라지면 안 된다.**
 */
export const DOMESTIC_ORDER_APPROVAL_ROUTE_MISSING_NOTICE = `${DOMESTIC_ORDER_APPROVAL_LABEL} 절차가 아직 없습니다. [사용자 관리] > [승인 절차] 탭에서 「${DOMESTIC_ORDER_APPROVAL_LABEL}」을 골라 결재선을 먼저 만들어 주세요.`;

/**
 * 🔵 **화면에만 쓰는 말은 여기 두지 않는다** — 배지 글자 · 상태 한 마디 · 빈 이력
 * 문구는 components/domestic-orders/detail/domestic-order-approval-texts.ts 에 있다
 * (견적서 결재가 quote-approval-texts.ts 에 두는 것과 같은 자리). 위
 * DOMESTIC_ORDER_APPROVAL_ROUTE_MISSING_NOTICE 만 여기 있는 것은 **저장 경로가 거절할
 * 때 같은 글자를 써야 하기 때문**이고, 서버 모듈이 components/ 를 가져오는 길은 이
 * 저장소에 없다.
 */
