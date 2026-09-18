import type { ShipmentApprovalRouteScope } from "./shipment-approval-route";

/**
 * ============================================================================
 * 견적서 결재 — 순수 규칙
 * ============================================================================
 * DB 도 서버도 여기서 만지지 않는다. 저장 경로(mutations/quote-approvals.ts) ·
 * 조회(queries/quote-approvals.ts) · 다음 조각의 화면이 **같은 함수 하나**를 보게
 * 하려고 따로 뺀 자리다. domain/inventory-part-issue-rules.ts ·
 * domain/shipment-approval-route.ts 와 같은 자리이고, 규칙을 두 곳에 적으면
 * 화면은 「승인 완료」라는데 서버는 「낡은 승인」이라고 답하는 날이 온다.
 *
 * 표 구조와 설계의 이유는 db/schema/quote-approvals.ts 머리말에 있다.
 *
 * ── 🔴 이 규칙들은 아무것도 막지 않는다 ─────────────────────────────────
 * **결재가 끝나기 전에도 견적서를 발행할 수 있다**(2026-09-18 사용자 결정).
 * 여기서 답하는 것은 「지금 어디까지 왔나」라는 **표시**뿐이다. 이 파일의 어떤
 * 값도 발행 통로(server/services/quote-issue.ts · api/quotes/[id]/…)의 문지기로
 * 쓰지 말 것 — 그것은 빠뜨린 것이 아니라 정해진 것이다.
 *
 * ── 🔴 「다음에 결재할 단계가 누구인가」는 여기에 없다 ───────────────────
 * 이미 있는 순수 함수 하나가 쥐고 있다 — domain/shipment-approval-route.ts 의
 * `findNextRouteStepToApprove`(요청자 본인 단계는 건너뛴다). 출하 승인 · 부품
 * 불출 · 견적서 승인이 **같은 결재선 표를 쓰므로** 그 규칙도 한 벌이어야 한다.
 * ============================================================================
 */

/**
 * 이 절차가 쓰는 결재선의 용도. 🔴 **`QUOTE` 를 글자로 적는 자리를 하나로 묶어
 * 둔다** — 저장 경로와 조회와 화면이 각자 문자열을 적으면 오타 하나가 「판이
 * 없다」로 조용히 보이고, 그 순간 이 기능은 통째로 꺼진다(그것이 안전장치의
 * 동작이라 오류도 나지 않는다). PART_ISSUE_APPROVAL_ROUTE_SCOPE 가 부품 불출
 * 쪽에서 하는 일과 같다.
 *
 * 값 자체의 목록은 domain/shipment-approval-route.ts 가 쥐고 있고, 여기서는
 * 그중 하나를 골라 이름을 붙일 뿐이다 — 타입이 그것을 강제한다.
 */
export const QUOTE_APPROVAL_ROUTE_SCOPE: ShipmentApprovalRouteScope = "QUOTE";

/**
 * 「견적서 승인」 판이 **지금 쓰이고 있는가** — 판이 있고 단계가 1개 이상이다.
 *
 * 🔴 단계 0개인 판은 **판이 아예 없는 것과 같게** 다룬다. 스키마가 「단계 0개인
 * 판도 정상이다 — 절차를 쓰지 않겠다는 뜻」이라고 적어 둔 그대로다.
 *
 * 🔴 **거짓일 때 요청을 거절하는 것**이 이 기능의 규칙이다. 근거는 두 가지다:
 *  1. 용도의 빈 상태 문장이 그렇게 말한다 — SHIPMENT_APPROVAL_ROUTE_EMPTY_NOTICES
 *     의 QUOTE 는 「지금은 결재 없이 견적서를 발행하며, **승인 기록도 남지
 *     않습니다**」이다. 지정 없는 요청 행을 하나 두면 그 문장이 거짓이 된다.
 *  2. 견적서에는 「출하 대표」 같은 대신할 사람이 없다. 지정이 NULL 인 행은
 *     mayDecideAssignedApproval 이 **누구에게나 참**을 돌려주므로, 그 행은
 *     「아무나 눌러도 되는 승인」이 된다 — 기록으로서 뜻이 없다.
 *  (출하 승인이 판 없을 때 요청을 받아 주는 것은 대표·위임이라는 **다른
 *   결재자**가 있기 때문이고, 그 자리가 없는 부품 불출은 이쪽과 똑같이
 *   ROUTE_NOT_CONFIGURED 로 거절한다.)
 *
 * 🔴 **판의 모양을 가리지 않는다**(`steps` 만 본다) — 판을 읽는 조회가 둘이고
 * (사슬을 이을 최소 모양 · 화면에 그릴 모양) 돌려주는 타입이 서로 다르다.
 * 타입 좁힘까지 겸한다: 참이면 부르는 쪽이 그 판을 그대로 쓸 수 있다.
 */
export function isQuoteApprovalRouteInForce<TRoute extends { steps: readonly unknown[] }>(
  route: TRoute | null
): route is TRoute {
  return route !== null && route.steps.length > 0;
}

/**
 * 결재 한 줄의 상태. 🔴 값 목록을 여기 베껴 적는 것은 표의 enum
 * (schema/quote-approvals.ts 의 quoteApprovalStatusEnum)과 **같은 셋**이어야
 * 한다는 뜻이고, 이 저장소의 스키마 파일은 도메인 층을 가져오지 않으므로
 * (REPAIR_CASE_APPROVAL_TYPES ↔ 표의 enum 과 같은 관례) 두 벌이 된다. 갈라지지
 * 않도록 이 파일의 시험이 둘을 맞대어 본다.
 */
export const QUOTE_APPROVAL_STATUSES = ["REQUESTED", "APPROVED", "REJECTED"] as const;
export type QuoteApprovalStatus = (typeof QUOTE_APPROVAL_STATUSES)[number];

/**
 * 「이 결재가 **지금 이 내용**에 대한 것인가」 — 요청 시점의 판 번호와 지금 판
 * 번호를 견준다.
 *
 * 🔴 **이 저장소에서 이 비교가 적힌 유일한 곳이다.** 화면 · 조회 · (나중에
 * 생길지 모를) 알림이 전부 같은 물음을 묻는데, 두 곳에 적으면 한쪽만 고쳐진
 * 날에 「화면은 승인 완료라는데 기록은 낡았다고 답하는」 어긋남이 생긴다.
 * queries/repair-case-approvals.ts 의 resolveApprovalValidity 가 접수 건에
 * 대해 하는 비교와 같은 자리다 — 그쪽은 출하 문을 여닫는 데 쓰지만, 이쪽은
 * **아무 문도 여닫지 않는다**(파일 머리말).
 */
export function isApprovalForCurrentQuote(
  quoteVersionAtRequest: number,
  currentQuoteVersion: number
): boolean {
  return quoteVersionAtRequest === currentQuoteVersion;
}

/**
 * 「이 견적서의 결재가 지금 어디까지 왔나」 — 화면이 묻는 그 물음의 답.
 *
 *  - `NOT_REQUESTED` 한 번도 올린 적이 없다. **행이 없는 것**이 곧 이 상태다
 *    (표에 저장하는 값이 아니다 — repair_case_approvals 의 같은 규약).
 *  - `PENDING`   지금 누군가의 결재를 기다리고 있다(가장 최근 행이 REQUESTED).
 *  - `APPROVED`  결재가 끝났고, **그 승인이 지금 내용에 대한 것**이다.
 *  - `APPROVED_OUTDATED` 🔴 승인은 있었지만 **그 뒤 견적서가 바뀌었다.**
 *    화면은 이것을 「승인 완료」로 그려서는 안 된다.
 *  - `REJECTED`  반려로 끝났다. 다시 받으려면 **새 요청**을 올린다.
 */
export const QUOTE_APPROVAL_STATES = [
  "NOT_REQUESTED",
  "PENDING",
  "APPROVED",
  "APPROVED_OUTDATED",
  "REJECTED",
] as const;
export type QuoteApprovalState = (typeof QUOTE_APPROVAL_STATES)[number];

/**
 * 가장 최근 결재 행 하나와 지금 판 번호로 위 상태를 정한다.
 *
 * 🔴 **가장 최근 행 하나만 본다.** 다단계 결재선은 단계마다 행을 하나씩 잇는
 * 구조라(스키마 머리말), 사슬의 지금 상태는 언제나 마지막 행이 말한다 —
 * 1단계가 APPROVED 이고 2단계가 REQUESTED 면 답은 PENDING 이다.
 *
 * 🔴 **낡은 승인을 조용히 재사용하지 않는다.** APPROVED 행이라도 요청 시점의
 * 판 번호가 지금과 다르면 APPROVED_OUTDATED 다. 이 갈림이 없으면 승인을 받은
 * 뒤 금액을 고쳐도 화면에 「승인 완료」가 그대로 남는다.
 *
 * 반려는 낡았는지 따지지 않는다 — 반려는 **그때 그 내용을 물린 사실**이고,
 * 그 뒤에 내용이 바뀌었다고 해서 없던 일이 되지 않는다. 고쳐서 다시 받으려면
 * 새 요청을 올리는 것이 이 표의 설계다(CHANGES_REQUESTED 를 두지 않은 이유).
 */
export function resolveQuoteApprovalState(
  latest: { status: QuoteApprovalStatus; quoteVersionAtRequest: number } | null,
  currentQuoteVersion: number
): QuoteApprovalState {
  if (latest === null) return "NOT_REQUESTED";
  if (latest.status === "REQUESTED") return "PENDING";
  if (latest.status === "REJECTED") return "REJECTED";
  return isApprovalForCurrentQuote(latest.quoteVersionAtRequest, currentQuoteVersion)
    ? "APPROVED"
    : "APPROVED_OUTDATED";
}
