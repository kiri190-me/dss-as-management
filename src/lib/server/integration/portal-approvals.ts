/**
 * ============================================================================
 * 통합 승인함이 물어 올 때의 판단 — 라우트가 아니라 여기에 둔다
 * ============================================================================
 * 열째 사이트 `dss-approvals`(통합 승인함)는 사내 시스템마다 「내가 결재할 건」을
 * 물어 한 창에 모은다. [승인하기] 는 **그 시스템의 그 건 화면으로 건너가기만**
 * 하고, 승인·반려는 거기서 한다(2026-10-23 사용자 결정) — 그래서 이 통로는
 * **읽기 전용**이고, 이 파일에도 쓰는 함수가 하나도 없다.
 *
 * ── 🔴 왜 통합 알림 통로로 안 되는가 ────────────────────────────────────
 * 이미 있는 `/api/integration/notifications` 는 **종**을 위한 것이라 시스템마다
 * 알갱이가 다르다. 재고는 「결재할 불출 신청 3건」처럼 뭉쳐서 주고, 휴가는
 * 건별이지만 링크가 목록으로만 간다. 승인함은 **한 줄 = 한 결재 = 한 [승인하기]**
 * 여야 하므로 그 통로를 넓히지 않고 전용 통로를 따로 냈다.
 *
 * 🔴 **여기서 정한 모양이 나머지 둘(재고 · 휴가)의 본보기다.** 칸 이름과 뜻을
 * 바꾸려면 세 시스템을 함께 고쳐야 한다.
 *
 * ── 🔴 알림 설정(종 켜기·끄기)을 보지 않는다 ────────────────────────────
 * `listMyNotifications` 는 「사용자 관리 › 알림 설정」을 윗단 필터로 쓴다
 * (db/queries/notifications.ts 머리말). 이 통로는 **그 필터를 쓰지 않는다** —
 * 승인함은 사람이 일부러 여는 **일감 목록**이지 종이 아니다. 종 설정 하나를
 * 꺼서 결재할 건이 목록에서 사라지면, 그 결재는 아무 표시도 없이 영영 묻힌다.
 * A/S 자기 화면도 같게 동작한다(`/repair-cases` 의 결재 조건은 알림 설정을 보지
 * 않는다 — queries/repair-case-approvals-pending.ts 를 그냥 부른다).
 * 🔵 그래서 이 통로의 결과는 종의 결과보다 **넓을 수 있다.** 넓은 쪽이 남의
 * 자료를 주는 것은 아니다 — 아래 「자격 판정」 절 그대로 둘 다 같은 조회를 쓴다.
 *
 * ── 자격 판정을 새로 짓지 않는다 ────────────────────────────────────────
 * 「이 사람이 지금 이 건을 결재할 차례인가」는 **한 줄도 여기 적지 않는다.**
 * 조회 둘을 **인자로 받아** 그대로 부른다:
 *   · queries/repair-case-approvals-pending.ts 의 listRepairCasesPendingMyApproval
 *   · queries/quote-approvals-pending.ts 의 listQuoteApprovalsPendingMyApproval
 * 그 둘이 결재선 지정자 · 대표/위임 · 최고관리자 비상구(mayDecideAssignedApproval)
 * 까지 이미 가른다. 판정이 두 벌이 되면 한쪽만 고쳐지는 날이 오고, 그것은 권한
 * 구멍이다 — 그리고 **잘못 좁힌 쪽은 화면에 아무 표시도 남기지 않는다.**
 *
 * DB 를 여기서 부르지 않고 인자로 받는 것은 portal-notifications.ts 와 같은
 * 까닭이다: 판단을 DB 없이 그대로 시험할 수 있고, 라우트에는 「토큰 꺼내 검증하고
 * 이 함수 부르기」만 남는다.
 * ============================================================================
 */

import {
  buildApprovalNotification,
  buildQuoteApprovalNotification,
} from "@/lib/domain/notifications";
import { absoluteNotificationHref } from "@/lib/domain/notification-links";
import type { RepairCaseApprovalType } from "@/lib/validation/repair-case-approval-input";
import { portalActorCanWork, type FindActorBySsoSubject } from "./portal-notifications";

/**
 * 이 시스템이 내주는 결재의 갈래.
 *
 * 접수 건 쪽 둘은 `RepairCaseApprovalType` 에서 그대로 온다 — 글자를 다시 적지
 * 않는다. 접수 건 결재 종류가 하나 늘면 아래 이름표 Record 에서 컴파일러가
 * 빠진 자리를 잡는다(이름표 없는 갈래가 코드 값 그대로 포털 화면에 찍히지 않게).
 */
export type PortalApprovalKind = RepairCaseApprovalType | "QUOTE_APPROVAL";

/**
 * 사람이 읽는 갈래 이름. 받는 쪽은 A/S 의 코드가 무슨 뜻인지 모른다 — 어휘의
 * 주인은 각 시스템이라는 규칙이 여기도 그대로다(domain/notification-links.ts 의
 * `kindLabel` 주석, 설계서 F-4).
 *
 * 🔴 **사내 화면의 이름표와 일부러 다르다.** A/S 안에서는 「수리 검수 승인」·
 * 「최종 출하 승인」·「견적서 승인」이고 그 글자가 적힌 곳은 지금도 한 곳씩이다
 * (local/workflow/shipment-approval-checklist.ts 의 LABELS ·
 * domain/shipment-approval-route.ts 의 SHIPMENT_APPROVAL_ROUTE_SCOPE_LABELS).
 * 승인함의 한 줄은 **다른 시스템의 줄과 섞여 서므로** 「무엇에 대한 결재인가」
 * (접수건 · 견적서)까지 이름에 들어가야 한다 — 「최종 출하 승인」만 떠 있으면
 * 어느 시스템의 무엇인지 알 수 없다(2026-10-23 지시).
 * 🔴 그러니 **한쪽을 고칠 때 다른 쪽을 따라 고치지 마라.** 사내 화면의 말과
 * 승인함의 말은 서로 다른 자리에서 쓰이는 서로 다른 이름이다.
 */
export const PORTAL_APPROVAL_KIND_LABELS: Record<PortalApprovalKind, string> = {
  REPAIR_INSPECTION: "접수건 검수 결재",
  FINAL_SHIPMENT: "접수건 최종 출하 결재",
  QUOTE_APPROVAL: "견적서 결재",
};

/**
 * 승인함에 서는 한 줄. 🔴 **이 모양이 세 시스템의 계약이다.**
 */
export type PortalApprovalItem = {
  /**
   * 이 시스템 안에서 이 결재건을 가리키는 값 — 통합함이 목록의 열쇠로 쓴다.
   *
   * 🔴 **종 알림과 같은 열쇠를 쓴다**(domain/notifications.ts 의 빌더가 만든 id).
   * 같은 사람의 같은 결재가 종에도 뜨고 승인함에도 뜨는데, 열쇠가 다르면 포털은
   * 그 둘이 같은 것인지 알 수 없다. 포털은 거기에 자기 쪽 접두사를 붙여 쓴다
   * (`{client_id}:{id}` — domain/notification-bell-items.ts 의 notificationBellKey와
   * 같은 모양).
   *
   * 🔵 값이 **다시 물어도 같다**는 것이 요점이다: (건, 갈래) 또는 (견적서) 하나에
   * 열쇠가 하나라, 반려 뒤 다시 올려 결재 행이 새로 생겨도 열쇠는 그대로다.
   */
  id: string;
  /** 기계가 읽는 갈래. */
  kind: PortalApprovalKind;
  /** 사람이 읽는 갈래 이름(위 Record). */
  kindLabel: string;
  /** 한 줄 제목 — 무엇에 대한 결재인가(인수번호 · 견적서 발행번호). */
  subject: string;
  /**
   * 한 줄 보탬. 🔴 **비어도 된다.**
   *
   * 싣는 것은 위 두 조회가 **이미 들고 오는 값**뿐이다. 이 통로 하나 때문에 종과
   * 사이드바 배지가 매 화면에서 쓰는 조회에 조인을 더하지 않는다. 그래서 접수 건
   * 결재는 빈 글자다 — 그 조회가 더 들고 오는 것은 사내 이름표(「수리 검수 승인」)
   * 하나뿐이고, 그것은 `kindLabel` 이 이미 승인함의 말로 적고 있다.
   */
  detail: string;
  /**
   * ISO 8601. 🔴 통합함이 **오래 기다린 순**으로 세운다.
   *
   * 「지금 열려 있는 그 요청이 들어온 때」다 — 처음 요청한 때가 아니다(반려 뒤
   * 다시 올린 건은 다시 올린 때). 두 조회가 같은 규칙으로 들고 온다.
   */
  requestedAt: string;
  /**
   * 🔴 **절대 주소.** 누르면 그 건의 결재 화면으로 바로 간다.
   *
   * 상대 주소를 보내면 포털 화면에서 눌렀을 때 포털 안의 없는 주소로 간다
   * (domain/notification-links.ts 머리말). 기준 주소는 부르는 쪽이 환경에서
   * 읽어 넘긴다 — 요청의 Host 머리말이 아니다.
   */
  href: string;
};

export type PortalApprovalInbox = {
  items: PortalApprovalItem[];
  /**
   * 배지에 찍을 숫자.
   *
   * 🔴 **종의 셈과 다르다 — 여기서는 `items.length` 다.** 종은 같은 대상을 한 번만
   * 센다(countNotificationTargets): 한 접수 건에 검수·출하 결재가 둘 걸려 있어도
   * 사람에게는 「그 한 건」이라 1 로 센다. 승인함은 반대다 — 한 줄이 한 번의
   * [승인하기] 이고 결재는 둘 다 눌러야 끝나므로 2 가 맞다. 나머지 두 시스템이
   * 이 계약을 그대로 베낄 수 있게 하는 뜻도 있다: 「같은 대상」을 무엇으로 볼지는
   * 시스템마다 다르지만 줄 수는 어디서나 같은 뜻이다.
   */
  count: number;
};

/** 계정을 못 찾았을 때의 답. 🔴 오류가 아니다. */
const EMPTY_INBOX: PortalApprovalInbox = { items: [], count: 0 };

/**
 * 접수 건 결재 한 줄의 입력. queries/repair-case-approvals-pending.ts 의
 * `PendingApprovalItem` 이 구조적으로 그대로 들어맞는다(칸이 더 많은 것은 상관없다).
 */
export type PendingRepairCaseApprovalRow = {
  repairCaseId: string;
  intakeNumber: string;
  approvalType: RepairCaseApprovalType;
  requestedAt: string;
};

/**
 * 견적서 결재 한 줄의 입력. queries/quote-approvals-pending.ts 의
 * `PendingQuoteApprovalItem` 이 구조적으로 그대로 들어맞는다.
 */
export type PendingQuoteApprovalRow = {
  quoteId: string;
  quoteNumber: string;
  routeStepOrder: number | null;
  requestedByName: string;
  requestedAt: string;
};

/**
 * 접수 건 결재 한 줄 → 승인함 한 줄.
 *
 * 🔴 열쇠 · 제목 · 주소를 **새로 적지 않는다** — 종이 쓰는 빌더를 그대로 부르고
 * 필요한 칸만 가져온다. 주소를 손으로 적으면 상세 화면의 탭 주소가 바뀌는 날
 * 승인함만 404 가 되고, 그 실패는 포털 화면에서만 보인다.
 * (`repairCaseDetailHrefs(id).approval` = `/repair-cases/{id}/approval` —
 * 검수 승인과 출하 승인이 **같은 한 화면**에 있어 갈래로 나눌 필요가 없다.)
 */
export function buildRepairCaseApprovalItem(
  row: PendingRepairCaseApprovalRow,
  baseUrl: string
): PortalApprovalItem {
  const bell = buildApprovalNotification({
    repairCaseId: row.repairCaseId,
    intakeNumber: row.intakeNumber,
    approvalType: row.approvalType,
  });
  return {
    id: bell.id,
    kind: row.approvalType,
    kindLabel: PORTAL_APPROVAL_KIND_LABELS[row.approvalType],
    // 인수번호. 종이 굵게 적는 값 그대로다.
    subject: bell.subject,
    // 비어 있는 것이 의도다 — PortalApprovalItem.detail 주석 참조.
    detail: "",
    requestedAt: row.requestedAt,
    href: absoluteNotificationHref(bell.href, baseUrl),
  };
}

/**
 * 견적서 결재 한 줄 → 승인함 한 줄.
 *
 * 🔴 **이 통로가 견적서 결재를 내주는 유일한 자리다. PO(`dss-po`)에는 같은 통로를
 * 만들지 않는다.** 견적서 결재는 A/S 와 PO 가 **같은 DB 의 같은 표**(`quote_approvals`)
 * 를 본다 — PO 도 같은 통로를 내면 통합 승인함에서 **같은 건이 두 번 세어진다.**
 * [승인하기] 는 A/S 쪽 화면으로 보내기로 했으므로(2026-10-23 사용자 결정) 내주는
 * 쪽도 A/S 다. 🔵 PO 에 승인함 통로를 더할 일이 생기면 **견적서 결재만은 빼야 한다.**
 *
 * 열쇠 · 제목 · 보탬 · 주소를 새로 적지 않는 것은 접수 건 쪽과 같다. 보탬의 말
 * (「결재선 N단계 · 요청자 ○○○」)도 종이 쓰는 그 문장을 그대로 쓴다 — 같은 것을
 * 두 말로 부르지 않는다.
 */
export function buildQuoteApprovalItem(
  row: PendingQuoteApprovalRow,
  baseUrl: string
): PortalApprovalItem {
  const bell = buildQuoteApprovalNotification({
    quoteId: row.quoteId,
    quoteNumber: row.quoteNumber,
    routeStepOrder: row.routeStepOrder,
    requestedByName: row.requestedByName,
  });
  return {
    id: bell.id,
    kind: "QUOTE_APPROVAL",
    kindLabel: PORTAL_APPROVAL_KIND_LABELS.QUOTE_APPROVAL,
    // 발행번호. 종이 굵게 적는 값 그대로다.
    subject: bell.subject,
    detail: bell.detail,
    requestedAt: row.requestedAt,
    href: absoluteNotificationHref(bell.href, baseUrl),
  };
}

/**
 * 오래 기다린 것부터. 같은 시각이면 열쇠로 동점을 깬다 — 순서가 실행마다 흔들리면
 * 통합함의 줄이 새로고침할 때마다 자리를 바꾼다.
 *
 * 🔴 **통합함도 다시 세운다**(여러 시스템을 합쳐야 하므로). 그래도 여기서 한 번
 * 세우는 것은, 합치는 쪽이 정렬을 빠뜨려도 **한 시스템 안에서는** 차례가 맞게 하기
 * 위해서다. 받는 쪽의 정렬을 믿고 흐트러뜨려 보내면, 그 실수는 「줄 순서가 조금
 * 이상하다」로만 드러나 아무도 신고하지 않는다.
 *
 * 글자 비교로 세우는 것이 맞다 — ISO 8601 은 같은 시간대 표기끼리 사전순이 곧
 * 시간순이고, 두 조회 모두 `Date.toISOString()`(언제나 UTC `Z`)으로 만든다.
 */
export function sortPortalApprovalItems(items: PortalApprovalItem[]): PortalApprovalItem[] {
  return items.sort((a, b) =>
    a.requestedAt === b.requestedAt
      ? a.id.localeCompare(b.id)
      : a.requestedAt.localeCompare(b.requestedAt)
  );
}

/**
 * 「이 사람이 지금 결재해야 할 건」 전부.
 *
 * 🔴 대상 사람은 **`subject` 하나로만** 정해진다 — 토큰이 실어 온 값이고, 라우트는
 * 쿼리 문자열을 읽지 않는다. 되짚은 A/S 계정의 id 로만 두 조회를 부르므로, 부르는
 * 쪽이 남의 번호를 끼워 넣을 자리가 이 함수 안에 없다.
 *
 * 🔴 A/S 에 계정이 없는 사람(포털 계정과 이어지지 않은 로컬 계정 · 정지된 계정)은
 * **빈 목록**이다. 오류가 아니다 — 포털은 여러 시스템에 같은 질문을 던지고, A/S
 * 에만 계정이 없는 사람은 흔하다(설계서 F-3, 알림 통로와 같은 판단).
 */
export async function buildPortalApprovalInbox(params: {
  subject: string;
  baseUrl: string;
  findActor: FindActorBySsoSubject;
  listRepairCaseApprovals: (
    actorUserId: string
  ) => Promise<readonly PendingRepairCaseApprovalRow[]>;
  listQuoteApprovals: (actorUserId: string) => Promise<readonly PendingQuoteApprovalRow[]>;
}): Promise<PortalApprovalInbox> {
  const actor = await params.findActor(params.subject);
  // 「지금 이 계정으로 일할 수 있는가」(승인됨 · 활성 · 잠기지 않음)는 알림 통로와
  // **같은 판정 하나**를 부른다 — portal-notifications.ts 의 portalActorCanWork.
  // 정지된 사람의 밀린 결재가 승인함에 계속 서 있으면 안 된다.
  if (!actor || !portalActorCanWork(actor)) return EMPTY_INBOX;

  // 서로를 모르는 두 조회라 나란히 보낸다.
  const [repairCaseRows, quoteRows] = await Promise.all([
    params.listRepairCaseApprovals(actor.id),
    params.listQuoteApprovals(actor.id),
  ]);

  const items = sortPortalApprovalItems([
    ...repairCaseRows.map((row) => buildRepairCaseApprovalItem(row, params.baseUrl)),
    ...quoteRows.map((row) => buildQuoteApprovalItem(row, params.baseUrl)),
  ]);

  // 🔴 겹친 열쇠를 여기서 **접지 않는다.** 한 견적서에 열려 있는 결재 행은 표의
  // 부분 유니크(quote_approvals_one_active_request)가 하나로 못 박고, 접수 건은
  // 조회가 (건, 갈래)별 가장 최근 행 하나로 접은 뒤 내준다. 그래서 같은 열쇠가
  // 두 줄로 나오면 그것은 **표나 조회가 깨졌다는 뜻**이고, 여기서 조용히 접으면
  // 그 사실이 영영 드러나지 않는다.
  return { items, count: items.length };
}
