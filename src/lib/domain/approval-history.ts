import {
  approvalOutcomeHref,
  approvalOutcomeName,
  approvalOutcomeSubject,
  type ApprovalOutcomeTarget,
} from "./notifications";

/**
 * ============================================================================
 * 결재 내역 한 줄 — 「내가 했던 결재 · 나를 대신해서 한 결재」의 모양
 * ============================================================================
 * 사용자 요구(2026-11-17): 「내가 했던 결재나 **나를 대신해서** 어떤 결재를 했는지도
 * 확인할 수 있도록 (특정 날짜 혹은 기간을 선택해서)」. 자료를 읽는 자리는
 * db/queries/approval-history.ts 이고, **한 줄의 모양과 뜻은 여기 한 곳**에 있다.
 *
 * ── 🔴 왜 모양을 여기서 정하는가 ────────────────────────────────────────
 * 결재가 쌓이는 표가 둘이고 갈래가 셋이다(접수 건 · 기타건 · 견적서). 승인함은
 * 그 셋을 **한 목록**으로 그리므로 어딘가에서 한 모양으로 합쳐야 하는데, 합치는
 * 일을 조회 쪽 세 함수가 각자 하면 「제목을 무엇으로 잡나」·「주소를 어떻게 만드나」
 * 가 세 벌이 되고 **한 벌만 고쳐지는 날**이 온다. 그 어긋남은 포털 화면에서만
 * 보인다(기타건 주소를 접수 건 헬퍼로 만들면 404 가 나던 그 자리와 같은 종류다).
 *
 * ── 🔴 제목 · 결재 이름 · 주소를 **새로 적지 않는다** ────────────────────
 * 셋 다 결과 알림(종)이 쓰는 함수를 그대로 부른다 — domain/notifications.ts 의
 * approvalOutcomeSubject · approvalOutcomeName · approvalOutcomeHref. 그래서 같은
 * 결재가 종에서는 「D2511-003 · 최종 출하 승인」인데 내역에서는 다른 말로 서는 일이
 * 없다. 🔵 그 셋은 2026-11-17 에 이 모듈 때문에 밖으로 열렸다.
 *
 * ── 🔴 주소는 **상대 주소**다 ───────────────────────────────────────────
 * 포털에 내줄 때는 절대 주소여야 하지만(상대 주소를 보내면 포털 안의 없는 주소로
 * 간다 — domain/notification-links.ts), 기준 주소는 환경에서 읽는 값이라 통로가
 * 쥔다. 「결재할 건」을 내주는 통로가 이미 그 모양이다:
 * server/integration/portal-approvals.ts 가 absoluteNotificationHref 로 감싼다.
 * **같은 자리에서 같은 함수로** 감쌀 것.
 * ============================================================================
 */

/** 결재 한 건이 어느 표·어느 갈래의 것인가. 결과 알림의 갈래와 글자가 같다. */
export type ApprovalHistorySource = ApprovalOutcomeTarget["source"];

/**
 * 🔴 **이 기능의 심장 — 「누가 눌렀나」를 보는 사람 기준으로 셋으로 가른다.**
 *
 *  · `SELF`        — 내가 **내 자격으로** 눌렀다.
 *  · `ON_BEHALF`   — 내가 **남의 자리를 대신** 눌렀다(`delegated_from` 이 남).
 *  · `BY_DELEGATE` — **내 자리를 남이 대신** 눌렀다(`delegated_from` 이 나).
 *
 * 🔴 **값이 보는 사람에 따라 달라진다.** 같은 결재 한 줄이 대리인에게는
 * `ON_BEHALF` 이고 맡긴 사람에게는 `BY_DELEGATE` 다. 그래서 이 값은 행의 성질이
 * 아니라 **행과 보는 사람의 관계**이고, 아래 함수가 언제나 `viewerUserId` 를 함께
 * 받는 까닭이 그것이다.
 *
 * 🔴 **「어느 위임으로 누른 것인가」는 가르지 않는다**(설계 B-16, 2026-11-17 사용자
 * — 「구별 없이 간단히」). A/S 의 `delegated_from_user_id` 한 칸에는 위임 두 제도가
 * 함께 적히고(결재선을 타지 않는 행은 옛 「출하 대표」 위임, 타는 행은 결재선 단계
 * 위임 — 표의 칸 주석) 포털 위임까지 그 한 칸으로 들어온다. 가르려면 출처 칸이
 * 있어야 하는데 **만들지 않기로 했다.** 그래서 이 유니온에 넷째 값을 더하지 마라.
 */
export type ApprovalHistoryRelation = "SELF" | "ON_BEHALF" | "BY_DELEGATE";

/**
 * 사람이 읽을 말. 🔴 **보는 사람 기준의 말**이라 「내」가 들어간다 — 이 줄은 언제나
 * 「누구의 내역인가」가 정해진 화면에서만 그려진다.
 *
 * 🔵 어휘의 주인은 각 시스템이라는 규칙 그대로다(server/integration/portal-approvals.ts
 * 의 PORTAL_APPROVAL_KIND_LABELS 주석). 재고관리·휴가도 같은 뜻의 셋을 내주지만 그
 * 글자는 그 집이 정한다 — 포털이 받아 그대로 그린다.
 */
export const APPROVAL_HISTORY_RELATION_LABELS: Record<ApprovalHistoryRelation, string> = {
  SELF: "직접 결재",
  ON_BEHALF: "내가 대신 결재",
  BY_DELEGATE: "내 자리를 남이 결재",
};

/** 결재 내역에 설 수 있는 결정. 🔴 요청 상태(REQUESTED)는 내역이 아니다. */
export type ApprovalHistoryDecision = "APPROVED" | "REJECTED";

/**
 * 셋 가운데 어느 것인가.
 *
 * 🔴 **차례가 곧 규칙이다.**
 *  1. 내가 누른 줄인가 — 아니면 남은 길은 「내 자리를 남이 눌렀다」뿐이다(조회가
 *     그 둘 말고는 내놓지 않는다 — 아래 「받는 것」 절).
 *  2. 내가 눌렀는데 대신한 자리가 **남의 것**이면 `ON_BEHALF`.
 *  3. 내가 눌렀고 대신한 자리가 없으면(또는 **내 자리면**) `SELF`.
 *
 * 🔵 셋째의 괄호 — `decided_by` 와 `delegated_from` 이 **둘 다 나**인 줄은 정상
 * 경로로는 생기지 않는다. 그 칸을 채우는 함수 하나가 「자리의 주인이 누른 사람
 * 본인이면 NULL」로 답하기 때문이다(auth/approval-assignment.ts 의
 * delegatedFromUserIdFor). 그래도 들어오면 **직접 누른 것으로 본다** — 손을 댄 것도
 * 나고 자리도 내 것이라 「대신」이라고 부를 상대가 없다.
 *
 * ── 받는 것 ────────────────────────────────────────────────────────────
 * 🔴 **이 함수는 「이 줄이 내 내역인가」를 묻지 않는다.** 거르는 일은 조회의 WHERE
 * 가 한다(`decided_by = 나 OR delegated_from = 나`). 여기서 한 번 더 거르면 같은
 * 판정이 두 벌이 되고, 둘이 갈리면 **남의 결재가 섞이거나**(비싸다) 내 결재가
 * 조용히 사라진다. 그 대신 둘 다 아닌 줄이 들어오면 `BY_DELEGATE` 로 떨어지므로,
 * **조회 쪽 WHERE 를 느슨하게 만들지 마라.**
 */
export function resolveApprovalHistoryRelation(input: {
  viewerUserId: string;
  decidedByUserId: string;
  delegatedFromUserId: string | null;
}): ApprovalHistoryRelation {
  if (input.decidedByUserId !== input.viewerUserId) return "BY_DELEGATE";
  if (input.delegatedFromUserId !== null && input.delegatedFromUserId !== input.viewerUserId) {
    return "ON_BEHALF";
  }
  return "SELF";
}

/**
 * 결재 내역 한 줄. 🔴 **표 둘 · 갈래 셋이 이 한 모양으로 합쳐진다.**
 *
 * 🔵 칸 이름은 「결재할 건」을 내주는 통로의 줄(PortalApprovalItem)과 겹치는 데가
 * 많지만 **같은 타입이 아니다** — 그쪽은 아직 결정되지 않은 건이라 `requestedAt`
 * 이 핵심이고, 이쪽은 끝난 건이라 `decidedAt` 과 `relation` 이 핵심이다. 한 타입에
 * 담으면 어느 칸이 언제 비는지를 받는 쪽이 매번 다시 가려야 한다.
 */
export type ApprovalHistoryEntry = {
  source: ApprovalHistorySource;
  /** 결재 행 하나의 id. 🔴 목록의 열쇠다 — 같은 건의 단계가 여럿이면 줄도 여럿이다. */
  approvalId: string;
  /**
   * 그 건·장·줄의 id. 🔴 **뜻은 `source` 가 정한다** — 접수 건 id · 견적서 id ·
   * 내자 줄 id. 받는 쪽이 줄을 접거나(같은 건의 여러 단계) 그 건으로 다시 물을 때
   * 쓴다. 🔵 누르면 갈 곳은 아래 `href` 가 이미 들고 있다 — 이 값으로 주소를 조립
   * 하지 마라(갈래마다 주소 모양이 다르고, 틀리면 404 가 포털 화면에서만 보인다).
   */
  targetId: string;
  /** 사람이 읽을 제목 — 인수번호 · 견적서 발행번호 · 기타건 품명. 🔴 비지 않는다. */
  subject: string;
  /** 무슨 결재인가 — 「수리 검수 승인」·「최종 출하 승인」·「견적서 승인」… */
  approvalName: string;
  /** 🔴 셋을 가르는 칸. 보는 사람 기준이다(위 유니온 주석). */
  relation: ApprovalHistoryRelation;
  /** 위 값의 사람이 읽을 말. 받는 쪽이 제 말로 다시 짓지 않게 함께 싣는다. */
  relationLabel: string;
  status: ApprovalHistoryDecision;
  /** ISO 8601(UTC `Z`). 🔴 결정 시각이다 — 요청 시각이 아니다. */
  decidedAt: string;
  decidedByUserId: string;
  decidedByName: string;
  /** 🔴 `relation` 이 `SELF` 면 `null` 이고, 나머지 둘이면 값이 있다. */
  delegatedFromUserId: string | null;
  delegatedFromName: string | null;
  /** 이 결재를 올린 사람의 이름. 「무엇에 대한 결재인가」를 읽는 데 보탬이 된다. */
  requestedByName: string;
  /** 올리며 적은 말. 비어도 된다. */
  requestReason: string | null;
  /** 결정하며 적은 말. 🔴 반려면 표 CHECK 가 빈 값을 막는다. */
  decisionReason: string | null;
  /** 🔴 **상대 주소**다 — 절대 주소로 바꾸는 자리는 통로다(파일 머리말). */
  href: string;
};

/** 그 건·장·줄의 id — 갈래마다 다른 칸에 들어 있다. */
function approvalHistoryTargetId(target: ApprovalOutcomeTarget): string {
  if (target.source === "REPAIR_CASE") return target.repairCaseId;
  if (target.source === "QUOTE") return target.quoteId;
  return target.domesticOrderId;
}

/**
 * 읽어 온 결재 행 하나 → 내역 한 줄. 🔴 **세 갈래가 여기 한 곳에서 합쳐진다.**
 *
 * 무엇에 대한 결재인가(`target`)만 갈래별로 다르고, 나머지 칸은 두 표가 **글자
 * 그대로 같은 모양**이라 그대로 흐른다(견적서 표의 delegated_from 칸 주석:
 * 「모양은 repair_case_approvals 의 그것과 글자 그대로 같다」).
 */
export function buildApprovalHistoryEntry(input: {
  target: ApprovalOutcomeTarget;
  viewerUserId: string;
  status: ApprovalHistoryDecision;
  decidedAt: Date;
  decidedByUserId: string;
  decidedByName: string;
  delegatedFromUserId: string | null;
  delegatedFromName: string | null;
  requestedByName: string;
  requestReason: string | null;
  decisionReason: string | null;
}): ApprovalHistoryEntry {
  const relation = resolveApprovalHistoryRelation({
    viewerUserId: input.viewerUserId,
    decidedByUserId: input.decidedByUserId,
    delegatedFromUserId: input.delegatedFromUserId,
  });
  return {
    source: input.target.source,
    approvalId: input.target.approvalId,
    targetId: approvalHistoryTargetId(input.target),
    subject: approvalOutcomeSubject(input.target),
    approvalName: approvalOutcomeName(input.target),
    relation,
    relationLabel: APPROVAL_HISTORY_RELATION_LABELS[relation],
    status: input.status,
    decidedAt: input.decidedAt.toISOString(),
    decidedByUserId: input.decidedByUserId,
    decidedByName: input.decidedByName,
    delegatedFromUserId: input.delegatedFromUserId,
    delegatedFromName: input.delegatedFromName,
    requestedByName: input.requestedByName,
    requestReason: input.requestReason,
    decisionReason: input.decisionReason,
    href: approvalOutcomeHref(input.target),
  };
}

/**
 * 결정이 **늦은 것부터**. 같은 시각이면 결재 행 id 로 동점을 깬다 — 실행마다
 * 차례가 흔들리면 받는 쪽이 새로고침할 때마다 줄이 자리를 바꾼다.
 *
 * 🔵 글자 비교로 세우는 것이 맞다 — ISO 8601 은 같은 시간대 표기끼리 사전순이 곧
 * 시간순이고, 위 빌더가 언제나 `Date.toISOString()`(UTC `Z`)으로 만든다.
 */
export function compareApprovalHistoryNewestFirst(
  a: ApprovalHistoryEntry,
  b: ApprovalHistoryEntry
): number {
  if (a.decidedAt !== b.decidedAt) return b.decidedAt.localeCompare(a.decidedAt);
  return b.approvalId.localeCompare(a.approvalId);
}
