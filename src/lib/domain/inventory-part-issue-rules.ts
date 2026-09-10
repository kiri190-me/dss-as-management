import type { ShipmentApprovalRouteScope } from "./shipment-approval-route";

/**
 * ============================================================================
 * 부품 불출 승인 — 순수 규칙 (상태 판정 하나)
 * ============================================================================
 * DB 도 서버도 여기서 만지지 않는다. 화면·서버 액션·mutation·조회가 **같은 함수
 * 하나**를 보게 하려고 따로 뺀 자리다 — 규칙을 두 곳에 적으면 화면은 단추를
 * 열어 주는데 저장이 거절하거나(사람이 무엇을 고쳐야 할지 모른다), 반대로
 * 화면만 막고 저장은 열려 있는 상태가 된다.
 * domain/shipment-approval-route.ts · domain/inventory-part-request-rules.ts 와
 * 같은 자리다.
 *
 * 표 구조와 「승인이 끝나도 재고는 자동으로 빠지지 않는다」는 설계의 이유는
 * db/schema/inventory-part-issue-requests.ts 머리말에 있다.
 *
 * ── 🔴 결재선을 고르는 규칙은 여기에 없다 ───────────────────────────────
 * 「다음에 결재할 단계가 누구인가」는 이미 있는 순수 함수 하나가 쥐고 있다 —
 * domain/shipment-approval-route.ts 의 `findNextRouteStepToApprove`(요청자 본인
 * 단계는 건너뛴다). 출하 승인과 부품 불출이 **같은 결재선 표를 쓰므로** 그
 * 규칙도 한 벌이어야 한다. 여기에 다시 적으면 두 벌이 되고, 그때 한쪽만 고쳐진
 * 날에 「출하는 건너뛰는데 불출은 안 건너뛴다」가 된다.
 *
 * 이 파일이 답하는 것은 **신청 한 건의 지금 상태**뿐이다: 지금 실행할 수 있는가,
 * 지금 결재를 기다리는가, 이 상태에서 저 상태로 갈 수 있는가.
 * ============================================================================
 */

/**
 * 이 절차가 쓰는 결재선의 용도. 🔴 **`PART_ISSUE` 를 글자로 적는 자리를 하나로
 * 묶어 둔다** — 조각이 여럿으로 나뉘어 있어서, 저장 경로와 조회와 화면이 각자
 * 문자열을 적으면 오타 하나가 「판이 없다」로 조용히 보이고 그 순간 이 기능은
 * 통째로 꺼진다(그것이 안전장치의 동작이라 오류도 나지 않는다).
 *
 * 값 자체의 목록은 domain/shipment-approval-route.ts 가 쥐고 있고, 여기서는
 * 그중 하나를 골라 이름을 붙일 뿐이다 — 타입이 그것을 강제한다.
 */
export const PART_ISSUE_APPROVAL_ROUTE_SCOPE: ShipmentApprovalRouteScope = "PART_ISSUE";

/**
 * 「부품 불출」 판이 **지금 쓰이고 있는가** — 판이 있고 단계가 1개 이상이다.
 *
 * 🔴 **이 판정이 적힌 곳은 저장소에서 여기 하나여야 한다.** 보는 쪽이 넷이다:
 *  · 문(mutations/inventory.ts 의 isPartIssueApprovalRequired) — 그 자리에서
 *    빼는 두 길을 막을지 정한다.
 *  · 신청을 만드는 쪽(mutations/inventory-part-issue-requests.ts) — 반대 방향으로
 *    같은 질문을 한다(판이 없으면 ROUTE_NOT_CONFIGURED).
 *  · 재고 화면의 서버 컴포넌트 — [불출]·[사용]을 [불출 승인 요청]으로 바꿀지
 *    정해 프롭으로 내려보낸다.
 * 한쪽만 「단계 0개」를 절차로 치면 신청도 못 하고 불출도 못 하는 상태가 생기고,
 * 화면만 갈라지면 「단추는 보이는데 누르면 거절」(또는 그 반대 — 이쪽은 화면에
 * 아무 표시도 남기지 않아 더 나쁘다)이 된다.
 *
 * 🔴 **순수 자리에 둔 이유.** 원래 mutations/inventory.ts 에 있었는데 그 파일은
 * `server-only` 사슬을 물고 있어, 화면 쪽에서 같은 함수를 부르려면 판정을 한 벌
 * 더 적는 수밖에 없었다. 판을 **읽는** 것은 여전히 조회의 몫이고(그쪽은 트랜잭션
 * 안이냐 밖이냐가 다르다) 여기서는 읽어 온 판을 보고 답만 한다.
 *
 * 🔴 **판의 모양을 가리지 않는다**(`steps` 만 본다). 판을 읽는 조회가 둘이고
 * (사슬을 이을 최소 모양 · 화면에 그릴 모양) 돌려주는 타입이 서로 다른데, 이
 * 판정에 필요한 것은 양쪽에 똑같이 있는 단계 목록뿐이다. 타입 하나에 묶으면
 * 부르는 쪽이 맞추려고 값을 옮겨 담게 되고, 그 옮겨 담기가 곧 두 벌이다.
 * 타입 좁힘까지 겸한다 — 참이면 부르는 쪽이 그 판을 그대로 쓸 수 있다.
 */
export function isPartIssueApprovalRouteInForce<TRoute extends { steps: readonly unknown[] }>(
  route: TRoute | null
): route is TRoute {
  return route !== null && route.steps.length > 0;
}

/**
 * 결재 이력 한 줄이 **신청자가 스스로 물러서 닫힌 줄인가.**
 *
 * 🔴 취소로 닫힌 행은 표에 `REJECTED` 로 남는다 — 결정 상태에 닫는 값이 그것뿐
 * 이라 그렇게 했다(mutations/inventory-part-issue-requests.ts 의
 * cancelPartIssueRequest 머리말). 그래서 화면이 그대로 그리면 **신청자가 물린
 * 건이 「결재자가 반려함」으로 보인다.** 되짚을 때 가장 헷갈리는 자리다.
 *
 * 가르는 것은 **결정자가 신청자 자신인가** 하나다. 취소 경로는 신청한 사람만
 * 지날 수 있고(다른 사람은 FORBIDDEN), 결재 경로는 신청자 본인 단계를 건너뛰므로
 * (findNextRouteStepToApprove) 자기 신청을 자기가 반려하는 줄은 생기지 않는다.
 *
 * `requestedByUserId` 는 **그 사슬을 올린 사람**이다 — 단계가 나아가도 물려
 * 내려가므로(같은 파일의 사슬 잇는 자리) 2단계·3단계 행에서도 신청자를 가리킨다.
 *
 * 🔴 판정을 화면에 적지 않고 여기 두는 이유는 위와 같다: 이력을 그리는 자리가
 * 하나가 아니게 되는 날(재고 화면 · 부품 요청 상세) 한쪽만 고쳐지면 같은 줄이 두
 * 화면에서 다른 말을 한다.
 */
export function isPartIssueApprovalClosedByRequester(row: {
  status: "REQUESTED" | "APPROVED" | "REJECTED";
  requestedByUserId: string;
  decidedByUserId: string | null;
}): boolean {
  return (
    row.status === "REJECTED" &&
    row.decidedByUserId !== null &&
    row.decidedByUserId === row.requestedByUserId
  );
}

/**
 * 불출 신청이 지나가는 상태.
 *
 * 🔴 표의 enum(`inventory_part_issue_request_status`)과 **글자 그대로 같아야
 * 한다.** 이 저장소의 스키마 파일은 도메인 층을 가져오지 않으므로
 * (REPAIR_CASE_APPROVAL_TYPES ↔ repair_case_approval_type 과 같은 관례다) 두
 * 벌이 되고, 갈라지지 않도록 이 파일의 시험이 둘을 맞춰 본다.
 */
export const INVENTORY_PART_ISSUE_REQUEST_STATUSES = [
  /** 결재를 기다린다. 신청이 만들어진 직후의 상태다. */
  "PENDING_APPROVAL",
  /** 결재가 **전부** 끝났다. 🔴 아직 재고는 그대로다. */
  "APPROVED",
  /** 재고가 실제로 빠졌다. 여기서 끝이고 되돌리는 길은 없다. */
  "EXECUTED",
  /** 어느 단계에서 반려됐다. */
  "REJECTED",
  /** 신청한 쪽이 물렸다. */
  "CANCELLED",
] as const;

export type InventoryPartIssueRequestStatus =
  (typeof INVENTORY_PART_ISSUE_REQUEST_STATUSES)[number];

/**
 * 바깥에서 들어온 값이 쓸 수 있는 상태인가. 서버 액션이 **화면이 보낸 값을 그대로
 * 믿지 않기** 위해 부른다 — 형식만 본다.
 */
export function isInventoryPartIssueRequestStatus(
  value: unknown
): value is InventoryPartIssueRequestStatus {
  return (
    typeof value === "string" &&
    (INVENTORY_PART_ISSUE_REQUEST_STATUSES as readonly string[]).includes(value)
  );
}

/**
 * **지금 재고를 뺄 수 있는가** — 결재가 전부 끝났고, 아직 안 나갔고, 반려·취소도
 * 되지 않았다.
 *
 * 🔴 `APPROVED` 하나뿐이다. 다른 넷은 각각 이유가 다르다:
 *  · PENDING_APPROVAL — 아직 결재 중이다.
 *  · EXECUTED         — **이미 나갔다.** 여기서 참을 돌려주면 같은 승인으로 두 번
 *                       빼는 길이 열린다. 이 함수의 가장 중요한 거짓이다.
 *  · REJECTED/CANCELLED — 승인이 없다.
 *
 * 이것은 「그래도 되는가」의 절반이다. 실제로 뺄 때는 실행 mutation 이 자기
 * 트랜잭션 안에서 재고·잠금·권한을 전부 다시 본다 — 승인 시점의 재고와 실행
 * 시점의 재고는 다를 수 있다(그것이 승인과 실행을 나눈 이유이기도 하다).
 */
export function isPartIssueRequestExecutable(status: InventoryPartIssueRequestStatus): boolean {
  return status === "APPROVED";
}

/** **지금 결재를 기다리는가.** 결재자 화면과 알림이 이것으로 후보를 좁힌다. */
export function isPartIssueRequestAwaitingApproval(
  status: InventoryPartIssueRequestStatus
): boolean {
  return status === "PENDING_APPROVAL";
}

/**
 * 더 나아갈 곳이 없는 상태인가 — 실행됐거나, 반려됐거나, 물렀다.
 *
 * 화면이 「지금 할 수 있는 일」을 하나도 그리지 않아야 하는 자리를 이 함수 하나로
 * 판정한다. 아래 전이표의 「빈 목록」과 같은 말이고, 그래서 전이표에서 파생한다 —
 * 두 곳에 각자 적으면 상태를 하나 더할 때 한쪽만 고쳐진다.
 */
export function isPartIssueRequestTerminal(status: InventoryPartIssueRequestStatus): boolean {
  return ALLOWED_TRANSITIONS[status].length === 0;
}

/**
 * 이 상태에서 갈 수 있는 곳.
 *
 * 🔴 **EXECUTED 에서 나가는 길은 없다.** 이미 나간 부품을 「취소」로 되돌리면
 * 재고 장부(stock_transactions)와 신청이 서로 다른 말을 하게 된다. 나간 것을
 * 물리는 길은 이 표가 아니라 반품(RETURN)이고, 그것은 이미 있는 다른 절차다
 * (mutations/inventory.ts 의 returnStock).
 *
 * 🔴 **APPROVED → CANCELLED 는 열어 둔다.** 결재는 끝났지만 아직 안 나갔으므로
 * 물릴 수 있어야 한다 — 부품이 파손됐다거나 접수 건이 취소됐다거나 하는 일은
 * 결재가 끝난 뒤에도 일어난다. 이 길을 막으면 「승인은 났는데 실행하면 안 되는」
 * 신청이 영영 목록에 남는다.
 *
 * 같은 상태로 가는 것(PENDING_APPROVAL → PENDING_APPROVAL)은 **전이가 아니다.**
 * 허용하면 두 번 눌린 단추가 조용히 통과하고, 그때 이력에는 아무 일도 없었던 것처럼
 * 남는다.
 */
const ALLOWED_TRANSITIONS: Record<
  InventoryPartIssueRequestStatus,
  readonly InventoryPartIssueRequestStatus[]
> = {
  PENDING_APPROVAL: ["APPROVED", "REJECTED", "CANCELLED"],
  APPROVED: ["EXECUTED", "CANCELLED"],
  EXECUTED: [],
  REJECTED: [],
  CANCELLED: [],
};

/** `from` 에서 `to` 로 갈 수 있는가. 위 표가 규칙이 적힌 유일한 곳이다. */
export function canTransitionPartIssueRequestStatus(
  from: InventoryPartIssueRequestStatus,
  to: InventoryPartIssueRequestStatus
): boolean {
  return ALLOWED_TRANSITIONS[from].includes(to);
}

/**
 * 지금 이 신청을 무를 수 있는가 — 위 전이표에서 파생한다(규칙을 다시 적지 않는다).
 *
 * 따로 이름을 붙여 두는 이유: 화면의 [신청 취소] 단추가 이것 하나만 보면 되고,
 * 「취소로 갈 수 있는가」를 부르는 쪽마다 `canTransition...(status, "CANCELLED")`
 * 로 적으면 대상 상태 문자열이 여러 곳에 흩어진다.
 */
export function isPartIssueRequestCancellable(status: InventoryPartIssueRequestStatus): boolean {
  return canTransitionPartIssueRequestStatus(status, "CANCELLED");
}
