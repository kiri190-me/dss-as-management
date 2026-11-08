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
 * ── 🔴 이 승인은 무엇을 막는가 — **[완료] 처리를 막는다** (2026-11-07) ───
 * 사용자 결정이다: 「기타건의 경우도 [기타건 최종 출하 승인]이 되야 [내자정리]에서
 * [완료]처리를 할 수 있도록」. 하루 전(2026-11-06)까지 이 자리에는 「아무것도 막지
 * 않는다」가 적혀 있었다 — 뒤집힌 것은 **결정**이지 설계가 아니다.
 *
 * 🔴 **단계를 옮기는 일은 여전히 없다.** 기타건에는 워크플로가 없어서 옮길 단계 자체가
 * 없고(mutations/shipment-waiting-auto-advance.ts 를 부르지 않는다), 이 승인이 하는
 * 일은 「완료로 넘어가는 문 하나」를 여닫는 것뿐이다.
 *
 * 🔵 **수리 건이 붙은 내자 줄은 한 줄도 바뀌지 않았다.** 그쪽은 **예전부터** 승인을
 * 요구하고 있었다 — [완료 처리]가 붙은 수리 건을 출하 완료로 먼저 넘기는데
 * (server/services/complete-domestic-order.ts), 그 전이가 `required_approval_type` 으로
 * 최종 출하 승인을 요구한다(mutations/workflow-transitions.ts). 사용자가 「기타건의
 * **경우도**」라고 말한 것이 그 뜻이다 — 같은 규칙을 수리 건 없는 줄에도 세운다.
 *
 * 🔴 **판정은 아래 resolveMiscCaseCompletionGate 하나**다. 울타리는 저장 경로
 * (mutations/domestic-orders.ts 의 setDomesticOrderCompletion)가 **트랜잭션 안에서
 * 잠근 행을 보고** 치고, 화면은 그 결과를 사람 말로 보여 줄 뿐이다.
 *
 * ── 🔴 **단위가 한 칸 내려왔다 — 줄이 아니라 회차다** (2026-11-08) ───────
 * 사용자 결정 12·13: 「납기 요청일이 복수로 있다면 … **드롭다운으로 어느 납기 요청일에
 * 관한 출하승인 요청인지 선택**」 · 「**납기 요청일에 대한 최종출하승인이 완료되지
 * 않으면 납기 요청일에 대한 [완료 처리]가 안 되도록**」.
 *
 * 그래서 「기타건 하나에 승인 하나」가 「**회차 하나에 승인 하나**」가 되었다. 이 파일의
 * 규칙은 **한 글자도 달라지지 않았고**(어느 상태가 통과인가 · 언제 다시 올릴 수 있나 ·
 * 판이 없으면 어떻게 되나), 달라진 것은 **그 규칙을 몇 번 적용하는가**뿐이다. 그 셈을
 * 아래 domesticOrderApprovalUnitCount 하나가 쥔다.
 *
 * 🔵 **회차가 하나뿐이면 어제와 글자 그대로 같다** — 단위가 하나이므로 드롭다운도 회차
 * 머리도 뜨지 않고, 관문도 한 번만 선다. 수리 건이 붙은 줄은 납기요청일이 하나로
 * 제한되어 있어(결정 9 울타리) **언제나** 그쪽이다.
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
 * ============================================================================
 * 🔴 **승인 단위가 몇 개인가** — 그 기타건의 회차 수 (2026-11-08)
 * ============================================================================
 * 사용자 결정 12·13 이 「줄 하나에 승인 하나」를 「**회차 하나에 승인 하나**」로
 * 내렸다. 그 셈을 **이 함수 하나**가 쥔다 — 화면(드롭다운에 몇 줄을 세울까) ·
 * 저장 경로(요청한 회차 번호가 범위 안인가) · 완료 관문(몇 개를 봐야 하나)이
 * 같은 답을 봐야 하기 때문이다.
 *
 * ── 🔴 **납기요청일이 0행인 기타건도 단위는 하나**다 ────────────────────
 * 가장 중요한 갈림이다. 「행이 없으면 승인할 것도 없다」로 두면 **살아 있는 기타건
 * 15건 중 11건**(개발 DB 실측 2026-11-08)이 승인도 완료도 할 수 없는 줄이 된다 —
 * 기타건은 손으로 [행 추가]한 줄이 많아 납기요청일이 비어 있는 것이 오히려 보통이다.
 * 그 11건은 **어제까지 멀쩡히 승인을 올리고 완료하던 줄**이고, 이 조각이 그것을
 * 깨뜨리면 안 된다.
 *
 * 🔵 그래서 0행과 1행이 **똑같이 단위 하나**다. 어느 쪽이든 드롭다운이 뜨지 않고,
 * 관문도 한 번만 서고, 승인 행의 회차 번호는 1이다 — 2026-11-07 의 동작과 글자
 * 그대로 같다(그래서 마이그레이션 0126 이 옛 행을 전부 1로 메울 수 있었다).
 *
 * 🔴 **음수·소수를 받지 않는다.** 행 수는 조회가 센 값이라 정상 경로로는 언제나
 * 0 이상의 정수지만, 이 함수가 돌려주는 값이 곧 「올릴 수 있는 회차 번호의 위끝」이라
 * 한 번 어긋나면 **있지도 않은 회차에 승인이 붙는다.**
 * ============================================================================
 */
export function domesticOrderApprovalUnitCount(dueDateRowCount: number): number {
  if (!Number.isFinite(dueDateRowCount)) return 1;
  return Math.max(1, Math.floor(dueDateRowCount));
}

/**
 * 보내온 회차 번호가 **그 줄에 실제로 있는 단위**인가 — 1 이상이고 단위 수 이하.
 *
 * 🔴 저장 경로가 쓴다. 화면이 보낸 값은 형식 말고는 아무것도 믿지 않는다는 규칙
 * (actions/domestic-order-approvals.ts 머리말) 그대로이고, 여기서 막지 않으면
 * 「3차에 대한 승인」이 회차가 둘뿐인 줄에 붙어 **아무도 열 수 없는 문**이 된다
 * (관문은 1·2차만 보므로 그 승인은 영영 쓰이지 않는다).
 */
export function isDomesticOrderApprovalUnit(
  rowOrder: number,
  dueDateRowCount: number
): boolean {
  if (!Number.isInteger(rowOrder)) return false;
  return rowOrder >= 1 && rowOrder <= domesticOrderApprovalUnitCount(dueDateRowCount);
}

/**
 * 🔴 회차 상태 여럿을 **줄 하나의 상태**로 접는다 (2026-11-08).
 *
 * 승인이 회차마다 서면서 「이 기타건의 승인 상태는?」이라는 물음에 답하는 자리가
 * 셋이 되었다 — 기타건 현황 목록의 배지 · 상세 머리 카드의 배지 · [완료] 관문.
 * 셋이 각자 접으면 같은 줄이 **목록에서는 「출하 대기」인데 눌러 보면 안 되는** 상태가
 * 된다. 그래서 접는 규칙을 여기 한 곳에 둔다.
 *
 * ── 규칙 — **차례대로 보고 처음 걸린 것** ──────────────────────────────
 * 전부 `APPROVED` 여야 줄이 `APPROVED` 다. 하나라도 아니면 **그 첫 번째 상태**를
 * 그대로 돌려준다(가장 나쁜 상태가 아니다). 까닭은 그 값이 곧 **사람이 다음에 할
 * 일**이기 때문이다 — 1차가 아직 안 올라갔으면 할 일은 「1차를 올려라」이고, 2차가
 * 반려된 사실은 1차를 끝낸 뒤에 보면 된다. 관문이 말하는 문장도 같은 회차를 가리킨다.
 *
 * 🔵 **빈 목록은 `NOT_REQUESTED`** — 단위가 0개인 줄은 없지만(단위 수는 언제나 1
 * 이상이다) 타입이 그것을 모른다. 「아무 승인도 없다」가 빈 목록의 정직한 답이다.
 */
export function foldDomesticOrderApprovalStates(
  states: readonly ShipmentApprovalState[]
): ShipmentApprovalState {
  if (states.length === 0) return "NOT_REQUESTED";
  return states.find((state) => state !== "APPROVED") ?? "APPROVED";
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
 * ============================================================================
 * 🔴 **[완료] 처리의 관문** — 이 기타건을 지금 완료로 표시할 수 있는가 (2026-11-07)
 * ============================================================================
 * 사용자 요구 그대로다(파일 머리말). 판정을 여기 한 곳에 두는 까닭은 **같은 물음에
 * 답하는 자리가 둘이기 때문**이다:
 *  · 저장 경로 — 잠근 행을 보고 거절한다(울타리).
 *  · 화면     — 거절당한 까닭을 사람에게 보여 준다.
 * 두 곳이 각자 판정하면 「되는 줄 알았는데 안 되는」 또는 그 반대가 생긴다.
 *
 * ── 🔴 통과시키는 상태는 `APPROVED` **하나**다 ──────────────────────────
 * 넷을 전부 막는 까닭이 서로 다르다:
 *  · `NOT_REQUESTED` — 승인을 올린 적이 없다. 막는 것이 기능 그 자체다.
 *  · `PENDING`       — 아직 결재자가 누르지 않았다. 여기서 통과시키면 「요청만 하면
 *                      된다」가 되어 결재가 형식이 된다.
 *  · `REJECTED`      — 반려다. 통과시킬 까닭이 없다.
 *  · 🔴 `STALE`      — **승인은 났는데 그 뒤에 줄이 바뀌었다.** 가장 헷갈리는 자리라
 *    따로 적는다: 승인한 사람이 본 내용과 지금 내용이 다르다는 뜻이므로, 통과시키면
 *    「금액을 고친 뒤 옛 승인으로 완료하는」 길이 열린다. 접수 건 쪽이 같은 자리에서
 *    같은 답을 낸다(mutations/workflow-transitions.ts 의 APPROVAL_STALE) — 두 결재가
 *    한 벌이라는 전제(2026-11-06)가 상태 어휘뿐 아니라 **통과 조건에도** 걸린다.
 *    기타건은 [승인] 탭에서 STALE 일 때 다시 올릴 수 있으므로 막다른 길이 아니다
 *    (위 DOMESTIC_ORDER_APPROVAL_REQUESTABLE_STATES).
 *
 * ── 🔴 결재선 판이 0개면 **아무도 완료할 수 없다** ─────────────────────
 * 그 갈래의 판은 사람이 [사용자 관리]에서 세워야 생긴다. 판이 없으면 요청 자체가
 * 거절되므로(mutations/domestic-order-approvals.ts 의 ROUTE_NOT_CONFIGURED) 상태는
 * 영영 `NOT_REQUESTED` 이고, 그래서 완료도 영영 막힌다. 🔴 **그 막다른 길을 열어 주지
 * 않는다** — 판이 없을 때 관문을 통과시키면 「절차를 지우면 승인 없이 완료되는」 길이
 * 되고, 그것은 이 기능을 끄는 스위치가 [사용자 관리]에 숨어 있는 것과 같다.
 * 🔴 대신 **무엇이 없고 어디서 만드는지**를 말한다. 「완료할 수 없습니다」만 뜨면
 * 사람은 [승인] 탭에 가서 두 번째로 막히고, 거기서도 길을 못 찾는다.
 *
 * ── 🔵 이미 완료된 줄은 여기까지 오지 않는다 ────────────────────────────
 * 그 갈림은 저장 경로가 쥔다(setDomesticOrderCompletion). 운영에 승인 없이 완료된
 * 기타건이 이미 있고(2026-11-07 개발 DB 실측 1건), 그 줄들이 이 규칙 때문에 오류를
 * 내거나 되돌려지면 안 된다 — 관문은 **지금 완료로 넘어가는 줄**에만 선다.
 * ============================================================================
 */
export type MiscCaseCompletionGate =
  | { allowed: true }
  /** 🔴 `message` 는 **사람에게 그대로 보여 줄 글**이다 — 서버가 거절하며 싣고, 화면이 띄운다. */
  | { allowed: false; message: string };

/**
 * 승인이 없을 때 하는 말의 **앞머리**. 뒤에 「그래서 지금 무엇을 해야 하는가」가 붙는다.
 * 🔴 이름표를 글자로 다시 적지 않는다(위 DOMESTIC_ORDER_APPROVAL_LABEL 과 같은 까닭).
 */
const COMPLETION_BLOCKED_PREFIX = `${DOMESTIC_ORDER_APPROVAL_LABEL}이 완료되어야 [완료] 처리를 할 수 있습니다.`;

/** 🔴 화면 시험과 서버가 같은 글자를 보도록 내보낸다. 글자를 베껴 적지 말 것. */
export const MISC_CASE_COMPLETION_BLOCKED_MESSAGES: Record<
  Exclude<ShipmentApprovalState, "APPROVED"> | "ROUTE_MISSING",
  string
> = {
  // 판이 없을 때는 「승인을 올려라」가 거짓말이다 — 올릴 수가 없다. 그래서 요청 경로가
  // 거절할 때 쓰는 **같은 한 줄**을 그대로 뒤에 붙인다.
  ROUTE_MISSING: `${COMPLETION_BLOCKED_PREFIX} ${DOMESTIC_ORDER_APPROVAL_ROUTE_MISSING_NOTICE}`,
  NOT_REQUESTED: `${COMPLETION_BLOCKED_PREFIX} 기타건 상세의 [승인] 탭에서 승인을 먼저 올려 주세요.`,
  PENDING: `${COMPLETION_BLOCKED_PREFIX} 올린 승인이 아직 처리되지 않았습니다.`,
  REJECTED: `${COMPLETION_BLOCKED_PREFIX} 올린 승인이 반려되었습니다. [승인] 탭에서 다시 올려 주세요.`,
  STALE: `${COMPLETION_BLOCKED_PREFIX} 승인 이후 이 기타건이 수정되어 그 승인은 지금 내용에 대한 것이 아닙니다. [승인] 탭에서 다시 올려 주세요.`,
};

export function resolveMiscCaseCompletionGate(params: {
  approvalState: ShipmentApprovalState;
  /**
   * 「기타건 최종 출하 승인」 판이 지금 쓰이고 있는가(isDomesticOrderApprovalRouteInForce).
   *
   * 🔵 **`NOT_REQUESTED` 일 때만 쓴다.** 나머지 셋은 결재 행이 이미 있다는 뜻이고, 그
   * 행은 판 없이는 생기지 않는다 — 그 뒤 관리자가 판을 지웠더라도 사람이 해야 할 다음
   * 행동은 「승인을 다시 받아라」이지 「판을 만들어라」가 아니다(옛 판은 요청 행에
   * 붙잡혀 있어 진행 중인 건은 그대로 굴러간다).
   */
  routeInForce: boolean;
  /**
   * 🔴 **어느 회차가 막혔는가** — 「2차 · 납기 2026-02-15 (2차분)」(2026-11-08).
   *
   * 🔵 **회차가 하나뿐인 기타건에서는 넘기지 않는다.** 그때는 막힌 것이 줄 하나뿐이라
   * 붙일 말이 없고, 붙이면 2026-11-07 부터 쓰던 문장이 까닭 없이 길어진다(그 문장을
   * 글자로 재는 시험도 그대로 남는다). 회차가 둘 이상일 때만 **어느 회차인지**를
   * 앞에 세운다 — 그러지 않으면 단추 셋이 전부 같은 말을 하고, 사람은 어느 회차를
   * 승인받아야 하는지 모른다.
   *
   * 🔴 글자는 지어내지 않는다 — domain/domestic-order-due-date-label.ts 의
   * domesticOrderDueDateRowLabel 이 만든 그 한 줄을 그대로 받는다(드롭다운·카드
   * 머리와 **한 글자도 달라지면 안 된다**).
   */
  dueDateRowLabel?: string | null;
}): MiscCaseCompletionGate {
  if (params.approvalState === "APPROVED") return { allowed: true };
  const base =
    params.approvalState === "NOT_REQUESTED" && !params.routeInForce
      ? MISC_CASE_COMPLETION_BLOCKED_MESSAGES.ROUTE_MISSING
      : MISC_CASE_COMPLETION_BLOCKED_MESSAGES[params.approvalState];
  const label = (params.dueDateRowLabel ?? "").trim();
  return { allowed: false, message: label === "" ? base : `「${label}」 — ${base}` };
}

/**
 * 🔵 **화면에만 쓰는 말은 여기 두지 않는다** — 배지 글자 · 상태 한 마디 · 빈 이력
 * 문구는 components/domestic-orders/detail/domestic-order-approval-texts.ts 에 있다
 * (견적서 결재가 quote-approval-texts.ts 에 두는 것과 같은 자리). 위
 * DOMESTIC_ORDER_APPROVAL_ROUTE_MISSING_NOTICE 만 여기 있는 것은 **저장 경로가 거절할
 * 때 같은 글자를 써야 하기 때문**이고, 서버 모듈이 components/ 를 가져오는 길은 이
 * 저장소에 없다.
 */
