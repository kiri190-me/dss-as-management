/**
 * ============================================================================
 * 종 알림 — 저장하지 않고 그때그때 파생시키는 "지금 내가 처리할 일"
 * ============================================================================
 * 알림 테이블이 없다. 알림 행을 따로 쌓지 않고, 이미 있는 업무 데이터에서 매
 * 요청마다 다시 계산한다.
 *
 * 그래도 되는 이유는 대부분이 **행동을 요구하는 알림**이기 때문이다.
 * 결재를 처리하면 그 건은 다음 조회에서 저절로 빠진다 — 사라지게 만드는 것이
 * 처리 그 자체라서 "읽음" 표시를 따로 저장할 것이 없다.
 *
 * ── 예외: 눌러서 확인하면 사라지는 정보성 알림 ─────────────────────────
 * 요청자에게 가는 결재 결과(「승인 완료」·「반려됨」)는 "무슨 일이 있었다"는
 * 알림이라 처리할 것이 없고, 그래서 저절로 사라지지 않는다. 이 둘만은 사람이
 * 눌러 확인한 사실을 notification_acknowledgements 표에 적고, 파생할 때 그 기록을
 * 빼고 그린다(db/queries/notifications.ts). 알림 자체는 여전히 저장하지 않는다 —
 * 결재 기록에서 매번 다시 계산하고, 표에 쌓이는 것은 「이 사람이 이 키를 눌렀다」
 * 뿐이다. 어느 종류가 눌러서 확인하는 종류인지는 domain/notification-acknowledgement.ts
 * 한 곳이 정한다.
 *
 * 이 파일은 순수 계산만 한다 — DB도, server-only도 여기 들어오지 않는다.
 * 화면(NotificationBell)과 서버 조회(db/queries/notifications.ts)가 **같은
 * 모양과 같은 세는 규칙**을 쓰게 하려고 가운데에 둔 것이고, 그래서 Node
 * 단위 테스트로 그대로 돌아간다.
 * ============================================================================
 */

import { addCalendarDays, toKstDateOnly } from "./date-only";
import { foldBlankToNull } from "./domestic-order-list";
/**
 * 🔵 **이 import 는 한때 고리(circular import)였다 — 2026-10-30 에 풀렸다.**
 * due-date-inversion.ts 가 이 파일의 isRepairCaseShipmentFinished 를 가져다 쓰고,
 * 이쪽이 그 파일의 글자 상수를 가져다 써서 **서로를 보고 있었다.** 고리를 받아들인
 * 까닭은 「같은 사실은 한 말로」가 더 중요해서였다: 화면에 뜨는 메모와 종에 뜨는 줄이
 * 다른 글자면 사람이 둘을 다른 경보로 읽는다.
 *
 * 🔴 **그 고리는 규율 하나로만 버티고 있었다** — 「이 상수를 모듈 최상위에서 읽지
 * 마라」. 저쪽이 먼저 실행되는 길이 있어(due-date-inversion.test.ts 가 바로 그
 * 길이다) 최상위에서 값을 읽으면 아직 초기화되지 않은 바인딩이라 ReferenceError 로
 * 죽었다 — 앱이 통째로 안 섰다. 글자 한 줄을 함수 밖으로 올리기만 해도 깨지는데
 * 그것을 막는 것이 사람의 기억뿐이라, 「상수 하나만 최상위로」로 언제든 되살아날 수
 * 있는 함정이었다.
 *
 * 🔵 **푼 방법은 제3의 파일이다.** 저쪽이 쓰던 isRepairCaseShipmentFinished 를
 * domain/shipment-finished.ts 로 옮겼다 — 「이 건이 나갔는가」는 애초에 알림의
 * 개념이 아니고, 부르는 자리도 알림 밖이 더 많았다(화면 · 조회 · PO 사본). 그래서
 * 사슬이 한 방향이 됐다: notifications → due-date-inversion → shipment-finished.
 *
 * 🔴 **고리를 되살리지 마라 — 이 파일에서 저 파일로 가는 화살표는 한 방향뿐이다.**
 * due-date-inversion.ts 가 이 파일에서 무엇이든(상수 하나라도) 가져오는 순간 고리가
 * 돌아오고, 그날부터 다시 「최상위에서 읽지 마라」라는 기억으로 버텨야 한다. 끊어져
 * 있다는 사실은 이제 domain/shipment-finished.test.ts 가 **글자로** 지킨다.
 */
import { DOMESTIC_ORDER_APPROVAL_LABEL } from "./domestic-order-approval-rules";
import { DOMESTIC_ORDER_NO_MODEL_LINK_LABEL } from "./domestic-order-detail-link";
import { domesticOrderDetailHrefs } from "./domestic-order-detail-tabs";
import { DUE_DATE_INVERSION_NOTE } from "./due-date-inversion";
import { LABELS as APPROVAL_TYPE_LABELS, type ShipmentApprovalType } from "./local/workflow/shipment-approval-checklist";
import { quoteEditHref } from "./quote-new-link";
import { repairCaseDetailHrefs } from "./repair-case-detail-tabs";
import {
  DUE_DATE_FROM_DOMESTIC_ORDER_LABEL,
  resolveRepairCaseRequestedDueDate,
} from "./requested-due-date-link";
import { SHIPMENT_APPROVAL_ROUTE_SCOPE_LABELS } from "./shipment-approval-route";
import { isRepairCaseShipmentFinished } from "./shipment-finished";
import type { RepairStatus, Role } from "./types";

/**
 * 등록된 알림 종류. 새 종류를 붙일 때 손대는 곳은 이 배열과
 * `db/queries/notifications.ts`의 소스 목록 둘뿐이고, 화면은 고치지 않는다 —
 * NotificationItem 한 모양만 그리기 때문이다.
 *
 * 🔴 **종류를 빼도 DB 는 건드리지 않는다.** 알림 설정은 `kind_key` 글자로
 * `notification_kind_settings` · `notification_role_settings` 에 저장돼 있어,
 * 여기서 빠진 종류의 행은 **읽히지 않을 뿐**이다(isNotificationKind 가 거른다).
 * 2026-10-04 에 CUSTOMER_REPAIR_REQUEST_NEW 를 이렇게 뺐다 — 고객이 의뢰를 넣던
 * 길(전용 주소)이 없어져 그 알림이 뜰 수 없게 됐다.
 *
 * 🔴 **2026-10-27(조각 13-C4): 재고 알림 셋을 같은 방식으로 뺐다** —
 * PART_REQUEST_PENDING · PART_STOCK_BELOW_MINIMUM · PART_ISSUE_APPROVAL_PENDING.
 * 까닭은 「뜰 수 없게 됐다」가 아니라 **두 번 오기 때문**이다: 재고 기능이 별도
 * 시스템(dss-inventory)으로 옮겨 갔고 그쪽이 제 알림을 포털로 직접 보낸다. A/S 에도
 * 두면 같은 일이 종에 두 줄로 선다. 🔵 A/S 가 이 배열에서 빼면 **포털 화면에서도
 * 조용히 사라진다** — 포털은 각 시스템이 내놓는 목록을 그리기만 하고, 사라진 종류의
 * 설정 행은 읽히지 않을 뿐 깨지지 않는다. 남은 DB 행을 치우는 SQL 은
 * NOTIFICATION_AND_IDENTITY_DESIGN.md 의 「재고 알림 3종 철거 — 고아 행 정리」 절에
 * 적어 두었다(표 셋, 포털 DB 하나 포함).
 *
 * 🔴 **키의 철자가 종 패널의 색을 정한다.** 종(@dss/ui 의 NotificationBell)은
 * 색표를 갖지 않고 이 코드를 해시해 열여섯 칸 중 하나를 집는다
 * (vendor/dss-ui/src/notification-bell/tone.ts 의 notificationToneIndex). 그래서
 * 새 종류의 키가 기존 종류와 같은 칸에 앉을 수 있고, 그러면 한 패널에서 두
 * 종류가 같은 색으로 보인다. 2026-10-19 에 실제로 겪었다 —
 * `REPAIR_CASE_DUE_DATE_SOON` 이 APPROVAL_REJECTED 와 겹쳐
 * `REPAIR_CASE_DUE_DATE_NEAR` 로 고쳐 적었다. 고칠 수 있는 것은 **이 키의
 * 철자뿐**이고(vendor 는 별도 저장소다), 겹침 자체는
 * components/layout/NotificationBell.test.tsx 의 「종류마다 다른 색 칸에
 * 앉는다」가 잡는다.
 */
export const NOTIFICATION_KINDS = [
  "REPAIR_CASE_APPROVAL",
  "QUOTE_APPROVAL_PENDING",
  "DOMESTIC_ORDER_APPROVAL_PENDING",
  "REPAIR_CASE_DUE_DATE_NEAR",
  // 🔵 「납기 임박」 바로 뒤에 둔다 — 같은 날짜 하나를 창만 달리해 보는 짝이라
  //    (오늘~+7일 ↔ 지났다) 종 패널에서도 나란히 서는 것이 읽기 쉽다. 기존 종류들의
  //    상대 차례는 한 칸도 바꾸지 않았다.
  "REPAIR_CASE_DUE_DATE_OVERDUE",
  "REPAIR_CASE_TARGET_SHIPMENT_MISSING",
  "REPAIR_CASE_DUE_DATE_INVERTED",
  "APPROVAL_GRANTED",
  "APPROVAL_REJECTED",
] as const;

export type NotificationKind = (typeof NOTIFICATION_KINDS)[number];

/**
 * 종 패널에 한 줄로 그려지는 알림 하나. 종류가 늘어도 화면이 아는 모양은 이것
 * 하나여야 한다 — 종류별 분기가 화면에 생기면 "종류를 추가해도 화면을 고치지
 * 않는다"가 곧바로 깨진다.
 */
export type NotificationItem = {
  /** React key. 같은 목록 안에서 유일하다. */
  id: string;
  kind: NotificationKind;
  /**
   * 개수를 셀 때 묶는 단위. 결재 알림에서는 접수 건 id다 — 한 건에 두 종류의
   * 결재가 걸려 있어도 사람에게는 "그 한 건"이다.
   *
   * 🔴 **이 값을 읽는 것은 사이드바의 결재 배지다** — 아래 두 세는 함수를 거쳐
   * (app)/layout.tsx 와 queries/repair-case-approvals-pending.ts 로 간다.
   *
   * 🔴 **종 배지는 2026-11-06 부터 이 값을 쓰지 않는다.** 이 자리에는 「배지에
   * 2로 세면 안 된다」고 적혀 있었다. 사용자가 그 설계를 뒤집었다 — 「종을
   * 눌렀을 때 나오는 알림의 수와 알림종의 숫자가 동일했으면 좋겠어」. 종은 이제
   * **보이는 줄**을 센다(components/layout/NotificationBell.tsx 의
   * selectVisibleNotifications 머리말에 그날 실제로 어긋난 숫자 셋이 적혀 있다).
   * 🔵 그래서 한 건에 결재가 둘 걸린 사람의 화면에서 **사이드바 1 · 종 2** 가
   * 정상이다. 두 숫자가 다르다는 신고를 받으면 먼저 이 갈림을 확인하라.
   */
  targetKey: string;
  /** 왼쪽에 굵게 오는 대상 식별자(인수번호 등). */
  subject: string;
  /** 무슨 일인가 — 이미 화면 어딘가에서 쓰고 있는 라벨을 그대로 가져온다. */
  detail: string;
  /** 누르면 갈 곳. */
  href: string;
};

/**
 * 알림 개수 — 같은 대상은 한 번만 센다.
 *
 * 🔴 **이 함수를 쓰는 것은 사이드바의 결재 배지뿐이다**(queries/
 * repair-case-approvals-pending.ts 의 countRepairCasesPendingMyApproval 과 바로
 * 아래 countNotificationTargetsByKind → (app)/layout.tsx). 사이드바가 말하는 것은
 * 「처리할 **건**이 몇인가」라, 한 건에 결재가 둘 걸려 있어도 1 이 맞다.
 *
 * 🔴 **종 배지는 2026-11-06 부터 이 함수를 쓰지 않는다.** 여기에는 「사이드바의
 * 결재 배지와 **종 배지**가 이 함수 하나를 쓴다」고 적혀 있었고 그것이 설계였다.
 * 사용자가 뒤집었다 — 「종을 눌렀을 때 나오는 알림의 수와 알림종의 숫자가
 * 동일했으면 좋겠어」. 종은 이제 **보이는 줄**을 센다(components/layout/
 * NotificationBell.tsx 의 selectVisibleNotifications).
 *
 * 🔴 **그래도 이 함수를 줄 수로 고치지 마라.** 고치면 사이드바의 「결재 N건」이
 * 한 건에 걸린 결재 둘을 2로 세기 시작하는데, 눌러서 가는 목록에는 그 건이
 * 하나뿐이라 숫자와 화면이 어긋난다. 종만 바뀌었다.
 */
export function countNotificationTargets(targetKeys: readonly string[]): number {
  return new Set(targetKeys).size;
}

/**
 * 종류별 개수. 🔴 **쓰는 곳은 사이드바의 결재 배지다** — (app)/layout.tsx 가
 * `.REPAIR_CASE_APPROVAL` 하나만 뽑아 쓴다. 종류가 늘었을 때 그 배지가 조용히
 * 남의 알림까지 세지 않게 하려고 종류별로 갈라서 돌려준다.
 *
 * 🔵 여기에는 「**종 배지는 전체를 세지만**, 사이드바 결재 배지처럼 한 종류만
 * 가리키는 자리도 있어서」라고 적혀 있었다. 2026-11-06 부터 종은 이 표도 위
 * countNotificationTargets 도 쓰지 않는다 — **보이는 줄**을 센다
 * (components/layout/NotificationBell.tsx 의 selectVisibleNotifications).
 */
export function countNotificationTargetsByKind(
  items: readonly NotificationItem[]
): Record<NotificationKind, number> {
  const targetsByKind = new Map<NotificationKind, Set<string>>(
    NOTIFICATION_KINDS.map((kind) => [kind, new Set<string>()] as const)
  );
  for (const item of items) {
    targetsByKind.get(item.kind)?.add(item.targetKey);
  }
  // NOTIFICATION_KINDS가 NotificationKind를 남김없이 덮으므로(타입이 이 배열에서
  // 나온다) 빠지는 키가 있을 수 없다.
  return Object.fromEntries(
    [...targetsByKind].map(([kind, targets]) => [kind, targets.size])
  ) as Record<NotificationKind, number>;
}

/**
 * "내게 온 결재 요청" 알림 한 줄.
 *
 * 라벨은 새로 쓰지 않고 shipment-approval-checklist.ts의 LABELS를 그대로
 * 가져온다 — 상세 화면의 승인 카드/체크리스트가 쓰는 바로 그 문자열이다.
 * 복사해 두면 한쪽만 고쳐졌을 때 같은 결재를 두 화면이 다른 이름으로 부른다.
 *
 * 링크는 상세 첫 화면이 아니라 **검수/승인 화면**으로 바로 보낸다. 알림을
 * 누르는 사람이 하려는 일은 그 결재를 처리하는 것인데, 상세 첫 화면에 내려
 * 놓으면 탭을 한 번 더 눌러야 했다. 검수 승인과 출하 승인이 둘 다 그 한
 * 화면에 있어서 승인 종류로 나눌 필요가 없다. 주소는 직접 적지 않고
 * repair-case-detail-tabs.ts의 헬퍼에서 가져온다.
 */
export function buildApprovalNotification(input: {
  repairCaseId: string;
  intakeNumber: string;
  approvalType: ShipmentApprovalType;
}): NotificationItem {
  return {
    id: `REPAIR_CASE_APPROVAL:${input.repairCaseId}:${input.approvalType}`,
    kind: "REPAIR_CASE_APPROVAL",
    targetKey: input.repairCaseId,
    subject: input.intakeNumber,
    detail: APPROVAL_TYPE_LABELS[input.approvalType],
    href: repairCaseDetailHrefs(input.repairCaseId).approval,
  };
}

/**
 * 견적서 결재의 이름 — 「견적서 승인」.
 *
 * 글자로 새로 적지 않고 결재선 용도 이름표(SHIPMENT_APPROVAL_ROUTE_SCOPE_LABELS)에서
 * 가져온다 — 절차 화면이 이 용도를 부르는 이름과 알림이 부르는 이름이 한쪽만 바뀌지
 * 않게 하려는 것이다. 접수 건 결재의 이름(「수리 검수 승인」·「최종 출하 승인」)이
 * 승인 체크리스트의 LABELS 에서 오는 것과 같은 자리다.
 * 🔴 뒤에 「 승인」을 붙이지 않는 것은 그 이름표가 이미
 * 「승인」으로 끝나기 때문이다 — 붙이면 「견적서 승인 승인」이 된다. 이름표 쪽 주석이
 * 왜 그렇게 끝맺었는지를 적고 있다.
 */
export const QUOTE_APPROVAL_LABEL = SHIPMENT_APPROVAL_ROUTE_SCOPE_LABELS.QUOTE;

/**
 * "지금 내 차례인 견적서 결재" 알림 한 줄.
 *
 * ── subject 는 발행번호다 ──────────────────────────────────────────────
 * 견적서를 가리키는 말 중 사람이 먼저 찾는 것이고, 목록·인쇄물·결재 화면이 모두
 * 그 번호로 한 장을 부른다. 제목(`subject` 칸)이 아니라 번호를 굵게 두는 것은
 * 접수 건 결재가 인수번호를 굵게 두는 것과 같은 갈림이다.
 *
 * ── detail 은 몇 단계의 결재인가 + 요청자 ──────────────────────────────
 * 「견적서 결재 대기」라는 종류 이름은 종 패널이 이 줄 **위에** 따로 적는다
 * (NOTIFICATION_KIND_META). 여기 또 적으면 잘리는 자리의 폭만 먹는다 — 불출 승인
 * 대기와 같은 갈림이고, 말의 모양도 그쪽과 맞춘다. 「요청자」라는 말은 결재 탭의
 * 같은 칸이 이미 쓰고 있다(QuoteApprovalPanel 의 Field label).
 *
 * 🔴 **견적서 결재는 언제나 결재선을 탄다** — 판이 없거나 단계가 0개면 요청 자체가
 * 거절된다(domain/quote-approval-rules.ts 의 isQuoteApprovalRouteInForce). 그래도
 * 단계 번호를 `null` 로 받을 수 있게 두는 것은 불출 알림과 같은 이유다: 표의 CHECK 이
 * 「판과 단계는 한 쌍」만 요구하므로 둘 다 비어 있는 행을 타입이 막지 못한다.
 *
 * ── href 는 그 견적서의 **[견적서 결재] 탭**이다 (2026-10-31) ─────────────
 * 🔵 예전에는 그 장의 [견적서 수정] 탭에서 멈췄다 — 탭이 브라우저 상태라 주소로
 * 가리킬 수 없었기 때문이다. 2026-10-31 에 **첫 그림의 기본 탭**을 주소로 정할 수
 * 있게 되면서(domain/quote-new-link.ts 의 QUOTE_EDIT_TAB_PARAM) 결재 대기 알림은
 * 곧장 결재 화면으로 간다 — 누른 사람이 할 일이 바로 거기 있다.
 *
 * 🔴 주소를 여기서 손으로 적지 않는다 — 목록이 한 줄을 열 때 쓰는 헬퍼 하나를
 * 그대로 부른다. 탭 이름도 글자로 적지 않는다(그 파일의 QUOTE_EDIT_TABS).
 *
 * targetKey 는 견적서 id 다. 한 견적서에 살아 있는 요청은 언제나 하나뿐이고
 * (quote_approvals_one_active_request 부분 유니크), 사람에게도 「그 한 장」이다.
 */
export function buildQuoteApprovalNotification(input: {
  quoteId: string;
  quoteNumber: string;
  /** 몇 번째 단계인가(1부터). 결재선을 타지 않는 행이면 `null`. */
  routeStepOrder: number | null;
  requestedByName: string;
}): NotificationItem {
  const step = input.routeStepOrder !== null ? `결재선 ${input.routeStepOrder}단계 · ` : "";
  return {
    id: `QUOTE_APPROVAL_PENDING:${input.quoteId}`,
    kind: "QUOTE_APPROVAL_PENDING",
    targetKey: input.quoteId,
    subject: input.quoteNumber,
    detail: `${step}요청자 ${input.requestedByName}`,
    href: quoteEditHref({ quoteId: input.quoteId, repairCaseId: null, tab: "approval" }),
  };
}

// ════════════════════════ 기타건 결재 대기 — 수리 건이 안 붙은 내자 줄의 출하 결재

/**
 * ────────────────────────────────────────────────────────────────────────────
 * 2026-11-06 사용자 요구: 「승인요청이 있을 때 **승인건에 있는 사람에게 알림이
 * 가도록**」. 기타건 최종 출하 승인(domain/domestic-order-approval-rules.ts)이
 * 2026-11-06 에 생겼는데 그때는 알림을 일부러 떼어 두었고, 이 절이 그 몫이다.
 *
 * ── 🔴 왜 `REPAIR_CASE_APPROVAL` 을 다시 쓰지 않았나 ────────────────────────
 * 기타건 결재 행은 **접수 건 결재와 같은 표**에 쌓이지만(`repair_case_approvals`),
 * 종에서는 갈래를 따로 둔다. 까닭 셋:
 *  1. 🔴 **주소가 다른 화면으로 간다** — 접수 건은 `/repair-cases/{id}/approval`,
 *     기타건은 `/domestic-orders/{id}/approval` 이다. 한 갈래에 두 주소를 담으면
 *     빌더 안에 분기가 생기고, 그 분기를 한 번 잘못 타면 **포털 화면에서만** 404 가
 *     난다(A/S 시험으로는 안 잡힌다 — server/integration/portal-approvals.ts 의
 *     그 경고).
 *  2. 🔴 **사이드바의 결재 배지가 조용히 늘어난다.** (app)/layout.tsx 는
 *     `countNotificationTargetsByKind(...).REPAIR_CASE_APPROVAL` 하나로 그 숫자를
 *     뽑는다 — 같은 갈래로 섞으면 「접수 건 결재 N건」 배지가 기타건까지 세고,
 *     눌러서 가는 곳에는 그 건이 없다.
 *  3. 종 패널은 갈래마다 이름표와 색을 따로 그린다. 견적서 결재가 이미 제 갈래를
 *     가진 것과 같은 자리다 — 「무엇에 대한 결재인가」가 한 줄에서 보여야 한다.
 * 🔵 접수 건 승인 종류 목록(`REPAIR_CASE_APPROVAL_TYPES`)은 **한 글자도 안 넓혔다.**
 *    그 보증은 db/schema/domestic-order-approval-safety.test.ts 가 지킨다.
 * ────────────────────────────────────────────────────────────────────────────
 */

/**
 * 기타건 한 줄을 가리키는 **굵은 글자** — 품명이고, 비어 있으면 `(형식 없음)`.
 *
 * 🔴 **빈 글자를 내보내면 그 줄이 통합 승인함에서 통째로 사라진다.** 승인함은 받은
 * 열 칸 가운데 `detail` 말고 하나라도 비면 그 줄을 빼고 「N건을 그리지 못했습니다」
 * 라고만 적는다(포털 lib/approvals/screen-inbox.ts 머리말에 그 계약이 있다). 기타건은
 * 품명이 실제로 비어 올 수 있는 줄이라(손으로 [행 추가] 한 줄 — 개발 DB 13건 중 품명이
 * 적힌 줄은 2건이다) 여기서 반드시 메운다.
 *
 * 🔴 **메우는 글자를 새로 짓지 않는다.** 내자 정리의 [형식] 칸과 기타건 현황의 [품명]
 * 칸이 이미 같은 자리에서 쓰는 글자를 그대로 가져온다
 * (domain/domestic-order-detail-link.ts 의 DOMESTIC_ORDER_NO_MODEL_LINK_LABEL). 알림만
 * 다른 말로 비어 있으면, 종을 눌러 들어간 사람이 방금 본 줄과 다른 줄이라고 읽는다.
 *
 * 공백만 적힌 값은 없는 것으로 접는다 — 목록·링크 판정이 쓰는 그 함수다(foldBlankToNull).
 */
export function domesticOrderApprovalSubject(modelName: string | null): string {
  return foldBlankToNull(modelName) ?? DOMESTIC_ORDER_NO_MODEL_LINK_LABEL;
}

/**
 * 「지금 내 차례인 기타건 결재」 알림 한 줄.
 *
 * ── subject 는 품명이다 ────────────────────────────────────────────────
 * 기타건 상세의 머리 카드가 **품명 · 공급처 · 발행일자 · 발행번호** 넷이고(2026-11-06
 * 사용자 지정), 기타건 현황 목록도 품명이 첫 칸이자 상세로 가는 링크다. 사람이 그 줄을
 * 찾을 때 먼저 보는 값이 품명이라는 판단을 두 화면이 이미 한 번 했으므로, 같은 값을
 * 쓴다. 접수 건 결재가 인수번호를, 견적서 결재가 발행번호를 굵게 두는 것과 같은 갈림이다.
 * 🔵 공급처·발행번호를 고르지 않은 까닭: 둘 다 **품명보다 더 자주 비어 있고**(개발 DB
 *    실측 2026-11-06 — 공급처 3/13 · 발행번호는 견적서를 안 이은 줄에서 빈다), 비면
 *    위 함수의 메우는 글자가 「(형식 없음)」이라 뜻이 어긋난다.
 *
 * ── detail 은 몇 단계의 결재인가 + 요청자 ──────────────────────────────
 * 「기타건 결재 대기」라는 종류 이름은 종 패널이 이 줄 **위에** 따로 적는다
 * (NOTIFICATION_KIND_META). 여기 또 적으면 잘리는 자리의 폭만 먹는다 — 견적서 결재
 * 대기와 같은 갈림이고, 말의 모양도 그쪽과 글자 그대로 맞춘다.
 *
 * 🔴 **기타건 결재는 언제나 결재선을 탄다** — 판이 없거나 단계가 0개면 요청 자체가
 * 거절된다(domain/domestic-order-approval-rules.ts 의
 * isDomesticOrderApprovalRouteInForce). 그래도 단계 번호를 `null` 로 받을 수 있게 두는
 * 것은 견적서 쪽과 같은 이유다: 표의 CHECK 이 「판과 단계는 한 쌍」만 요구하므로 둘 다
 * 비어 있는 행을 타입이 막지 못한다.
 *
 * ── 🔴 href 는 `/domestic-orders/{id}/approval` 이다 ────────────────────
 * 접수 건 헬퍼(`repairCaseDetailHrefs`)를 그대로 베끼면 `/repair-cases/{uuid}/approval`
 * 로 나가 **404** 다. 그 실패는 **포털 화면에서만** 보이고 A/S 안에서는 아무 표시도
 * 남지 않는다. 그래서 주소를 손으로 적지 않고 기타건 상세의 탭 헬퍼 하나를 부른다
 * (domain/domestic-order-detail-tabs.ts).
 *
 * ── 🔴 **id 에 회차가 붙는다** (2026-11-08) ─────────────────────────────
 * 여기에는 「한 줄에 살아 있는 요청은 언제나 하나뿐」이라고 적혀 있었다. 사용자 결정
 * 12 로 승인의 단위가 **납기요청일 회차**로 내려오면서 그 말이 거짓이 되었다 — 부분
 * 유니크(repair_case_approvals_one_active_domestic_request)에 칸이 하나 늘어, 이제
 * **회차마다** 하나다. 1차와 2차가 동시에 열려 있을 수 있다.
 *
 * 🔴 그래서 id 에 회차를 붙인다. 안 붙이면 같은 줄의 두 알림이 **글자가 같은 id** 를
 * 갖고, 종이 줄을 그릴 때 하나로 뭉개진다(React 의 key 가 겹친다) — 사람은 1차만
 * 처리하고 2차가 남은 것을 영영 모른다. 🔵 이 종류는 **확인 기록에 적히지 않으므로**
 * (ACKNOWLEDGEABLE_NOTIFICATION_KINDS 에 없다) id 모양을 바꿔도 쌓인 기록이 어긋나지
 * 않는다.
 *
 * 🔴 **targetKey 는 내자 줄 id 그대로다.** 그 값을 세는 자리는 「처리할 **건**이
 * 몇인가」를 말하고(countNotificationTargets 의 머리말 — 한 건에 결재가 둘이어도 1),
 * 사람에게도 그 줄은 하나다. 종 배지는 보이는 **줄**을 세므로 둘로 뜬다 — 그 갈림이
 * 2026-11-06 에 정해진 그대로다.
 */
export function buildDomesticOrderApprovalNotification(input: {
  domesticOrderId: string;
  /** 그 줄의 품명. 비어 있어도 된다 — 위 subject 함수가 메운다. */
  modelName: string | null;
  /** 몇 번째 단계인가(1부터). 결재선을 타지 않는 행이면 `null`. */
  routeStepOrder: number | null;
  requestedByName: string;
  /**
   * 🔴 **몇 번째 납기요청일 회차인가**(1부터). 기타건 결재 행에는 언제나 값이 있다
   * (표의 CHECK) — `null` 을 받는 것은 타입이 그 CHECK 을 모르기 때문이고, 그때는
   * 2026-11-07 의 id 모양을 그대로 쓴다.
   */
  dueDateRowOrder: number | null;
  /**
   * 🔴 사람에게 보여 줄 회차 이름 — 「2차 · 납기 2026-02-15 (2차분)」.
   * 🔵 **회차가 하나뿐인 기타건에서는 `null`** 이고, 그때 detail 은 2026-11-07 과
   * 한 글자도 다르지 않다(queries/domestic-order-approvals-pending.ts 가 가른다).
   */
  dueDateRowLabel: string | null;
}): NotificationItem {
  const step = input.routeStepOrder !== null ? `결재선 ${input.routeStepOrder}단계 · ` : "";
  const row = input.dueDateRowLabel !== null ? `${input.dueDateRowLabel} · ` : "";
  const idSuffix = input.dueDateRowOrder !== null ? `:${input.dueDateRowOrder}` : "";
  return {
    id: `DOMESTIC_ORDER_APPROVAL_PENDING:${input.domesticOrderId}${idSuffix}`,
    kind: "DOMESTIC_ORDER_APPROVAL_PENDING",
    targetKey: input.domesticOrderId,
    subject: domesticOrderApprovalSubject(input.modelName),
    // 🔴 회차를 **맨 앞**에 둔다 — 같은 품명이 두 줄 나란히 뜰 때 사람이 먼저 보는
    //    자리이고, 뒤에 두면 좁은 종 패널에서 잘린다.
    detail: `${row}${step}요청자 ${input.requestedByName}`,
    href: domesticOrderDetailHrefs(input.domesticOrderId).approval,
  };
}

// ═══════════════════════════════ 납기 임박 — 고객 요청 납기일이 다가온 수리 건

/**
 * 고객 요청 납기일이 **며칠 앞**으로 다가오면 종에 뜨는가. 오늘을 포함해 이만큼
 * 뒤까지가 창이다(2026-10-19 사용자 요구 — 「1주일 전에 알림이 뜨도록」).
 *
 * 이 숫자가 적힌 곳은 여기 하나다 — 조회(창의 마지막 날)와 알림 설정 화면의 설명
 * 문구가 이 값을 가져다 쓴다. 결재 결과의
 * APPROVAL_OUTCOME_NOTIFICATION_WINDOW_DAYS 와 같은 자리·같은 이유다.
 */
export const REPAIR_CASE_DUE_DATE_NOTIFICATION_WINDOW_DAYS = 7;

/**
 * `now` 기준 창의 **마지막 날**("YYYY-MM-DD", 한국 달력). 납기일이 이 날 이하이고
 * 오늘 이상이면 창 안이다.
 *
 * 날짜를 밀리초로 더하지 않는다 — `date` 칸에서 온 날짜를 Date 로 파싱하면 UTC
 * 자정이 되어 한국에서 하루가 밀린다(domain/date-only.ts 머리말). 한국 날짜로
 * 바꾼 뒤 달력 날짜로 더하고, 견주는 일도 끝까지 문자열로 한다("YYYY-MM-DD" 는
 * 자리수가 고정이라 사전순이 곧 날짜순이다).
 */
export function repairCaseDueDateNotificationWindowEnd(now: Date): string {
  return addCalendarDays(toKstDateOnly(now), REPAIR_CASE_DUE_DATE_NOTIFICATION_WINDOW_DAYS);
}

/**
 * 그 납기일이 지금 창 안인가 — **오늘 ≤ 납기일 ≤ 오늘 + 7일**.
 *
 * 🔴 **미기재면 거짓이다.** 납기일이 없는 건에는 알림이 뜨지 않는다(2026-10-19
 * 사용자 결정 — 「납기일 미기재 시 알림 없음」). 여기서 `null` 을 받는 이유는
 * 부르는 쪽이 resolveRepairCaseRequestedDueDate 의 답을 그대로 넘기기 때문이다 —
 * 그 함수가 `null` 을 주는 것이 곧 「화면에도 날짜가 안 보인다」는 뜻이다.
 *
 * 🔴 **이미 지난 납기는 창 밖이라 뜨지 않는다.** 이 알림은 「곧 온다」를 알리는
 * 것이고, 「지났다」는 이 저장소에 이미 따로 있다 —
 * domain/repair-case-overdue.ts 의 isRepairCaseOverdue 다. 둘을 섞지 않는다.
 * 🔵 **2026-11-03 까지 그 판정은 사내 목표 완료일로 쟀고**, 그때는 「다른 날짜를 보는
 *    다른 판정」이라는 것이 둘을 가르는 말이었다. 지금은 **같은 날짜를 보고 창만
 *    다르다**(오늘 ≤ 날짜 ≤ 오늘+7 ↔ 날짜 < 오늘). 그래서 두 창은 겹치지 않고,
 *    한 건에 임박과 지연이 동시에 뜨지 않는다. 🔴 이 절에 「사내 목표 완료일로 재는
 *    다른 판정」이라고 적혀 있던 문장은 2026-11-03 부터 거짓이었다(2026-11-07 에
 *    고쳤다).
 */
export function isRepairCaseDueDateWithinNotificationWindow(dueDate: string | null, now: Date): boolean {
  if (dueDate === null) return false;
  return dueDate >= toKstDateOnly(now) && dueDate <= repairCaseDueDateNotificationWindowEnd(now);
}

/**
 * 🔵 **「이 건은 이미 나갔는가」(isRepairCaseShipmentFinished)는 여기 있었다.**
 * 2026-10-30 에 domain/shipment-finished.ts 로 옮겼다 — 묻는 것이 출하 사실 하나라
 * 알림의 개념이 아니고, 그 함수가 여기 있던 탓에 due-date-inversion.ts 와 고리가
 * 져 있었다(파일 맨 위 import 주석). 부르는 쪽은 바뀐 것이 없다: 아래 두 판정도
 * 조회 셋도 **같은 함수 하나**를 그대로 부른다.
 */

/**
 * 이 수리 건에 **「납기 임박」 표시를 붙이는가** — 종 알림이 뜨는 조건과 같다.
 *
 * ── 🔴 왜 이 함수가 있나 ────────────────────────────────────────────────
 * 2026-10-19 사용자 요구로 같은 사실을 **종 말고도** 세 자리에서 그리게 됐다 —
 * 전체 A/S 현황의 표·카드 배지, 수리 건 상세 머리 줄의 배지, 그리고 네 목록과
 * 상세의 「고객 요청 납기일」 글자색. 조건을 그 자리마다 다시 적으면 언젠가 한
 * 곳만 고쳐져 **종과 표가 서로 다른 말을 한다.** 그래서 조건을 **새로 적지
 * 않고** 바로 위 세 함수를 한 줄로 묶기만 한다:
 *
 *   1. 화면에 보이는 날짜를 구한다 — resolveRepairCaseRequestedDueDate
 *      (자기 칸이 먼저, 비면 연결된 내자 정리에서 가장 이른 하루를 빌린다).
 *   2. 창을 잰다 — isRepairCaseDueDateWithinNotificationWindow
 *      (오늘 ≤ 날짜 ≤ 오늘 + 7일. 미기재도 지난 납기도 거짓이다).
 *   3. 🔴 이미 나간 건을 뺀다 — isRepairCaseShipmentFinished
 *      (domain/shipment-finished.ts — 경보 넷이 함께 쓰는 잣대다). 알림 조회가 빼고
 *      있으므로 배지도 빼야 한다. 안 그러면 출하가 끝난 건에 「납기 임박」이
 *      붙어 종에는 없는 경보가 표에만 선다.
 *
 * 종 알림 쪽은 이 함수를 부르지 않는다 — 그쪽은 날짜와 「빌려 왔는가」까지
 * 필요해서(알림 한 줄의 detail) 같은 세 함수를 자기 자리에서 펴 쓴다
 * (db/queries/repair-case-due-date-notifications.ts). 묶는 방식이 둘일 뿐
 * **판정하는 함수는 하나도 다르지 않다.**
 *
 * ── 🔴 `now` 를 받는다 — 화면에서 만들지 않는다 ─────────────────────────
 * 「오늘」을 그리는 쪽에서 `new Date()` 로 만들면 서버가 그린 HTML 과 어긋나
 * hydration 이 깨진다(app/(app)/repair-cases/page.tsx 의 longPendingPoCaseIds
 * 주석에 같은 함정이 적혀 있다). 그래서 이 함수를 부르는 자리는 **전부 서버**이고,
 * 화면은 그 결과(불리언·id 집합)만 받는다.
 */
export function isRepairCaseDueDateNear(
  row: {
    customerRequestedDueDate: string | null;
    domesticOrderDueDates: readonly string[];
    status: RepairStatus | null;
    actualShipmentDate: string | null;
  },
  now: Date
): boolean {
  if (isRepairCaseShipmentFinished(row)) return false;
  const { dueDate } = resolveRepairCaseRequestedDueDate({
    customerRequestedDueDate: row.customerRequestedDueDate,
    domesticOrderDueDates: row.domesticOrderDueDates,
  });
  return isRepairCaseDueDateWithinNotificationWindow(dueDate, now);
}

/**
 * 「고객 요청 납기일이 다가왔다」 알림 한 줄.
 *
 * ── subject 는 인수번호다 ──────────────────────────────────────────────
 * 접수 건을 가리키는 말 중 사람이 먼저 찾는 것이고, 결재 알림이 굵게 두는 것과
 * 같은 값이다.
 *
 * ── detail 은 **날짜**와, 빌려 온 값이면 그 표시다 ────────────────────
 * 「납기 임박」이라는 종류 이름은 종 패널이 이 줄 **위에** 따로 적는다
 * (NOTIFICATION_KIND_META). 여기 또 적으면 잘리는 자리의 폭만 먹는다 — 다른
 * 종류들과 같은 갈림이다. 사람이 알아야 하는 것은 「며칠인가」이고, 그 날짜가
 * 이 건에 적힌 값이 아니라 **연결된 내자에서 빌려 온 값**이면 그 사실이 함께
 * 드러나야 한다. 표시 글자는 새로 쓰지 않고 상세정보 화면이 이미 쓰는 것을
 * 그대로 가져온다(requested-due-date-link.ts 의
 * DUE_DATE_FROM_DOMESTIC_ORDER_LABEL) — 같은 것을 두 말로 부르지 않는다.
 *
 * ── href 는 상세 첫 화면이다 ──────────────────────────────────────────
 * 고객 요청 납기일이 그 화면의 「인수 정보」에 있고, 날짜를 고치는 자리도 거기다.
 * 주소는 직접 적지 않고 탭 헬퍼에서 가져온다.
 *
 * targetKey 는 접수 건 id 다. 한 건에 납기일은 하나뿐이고, 사람에게도 「그 한
 * 건」이다.
 */
export function buildRepairCaseDueDateNearNotification(input: {
  repairCaseId: string;
  intakeNumber: string;
  /** 화면에 보이는 그 날짜("YYYY-MM-DD"). 창 안이라고 이미 가려진 값이다. */
  dueDate: string;
  /** 이 건의 칸이 아니라 연결된 내자 정리에서 빌려 온 날짜인가. */
  borrowed: boolean;
}): NotificationItem {
  return {
    id: `REPAIR_CASE_DUE_DATE_NEAR:${input.repairCaseId}`,
    kind: "REPAIR_CASE_DUE_DATE_NEAR",
    targetKey: input.repairCaseId,
    subject: input.intakeNumber,
    detail: input.borrowed
      ? `${input.dueDate} · ${DUE_DATE_FROM_DOMESTIC_ORDER_LABEL}`
      : input.dueDate,
    href: repairCaseDetailHrefs(input.repairCaseId).root,
  };
}

// ════════════════════ 납기 지연 — 고객 요청 납기일이 이미 지났고 아직 안 나갔다

/**
 * ────────────────────────────────────────────────────────────────────────────
 * 2026-11-07 사용자 요구: 「[납기 지연]도 종으로 알림이 뜨도록」.
 *
 * ── 🔴 판정을 여기 적지 않는다. 한 줄도 ────────────────────────────────────
 * 뜨는 조건은 **이미 있다** — domain/repair-case-overdue.ts 의 isRepairCaseOverdue,
 * 곧 전체 A/S 현황의 표·카드와 수리 건 상세 머리 카드에 「납기 지연」 배지를 세우는
 * 바로 그 함수다. 같은 말을 두 벌로 적으면 **배지는 떴는데 종은 조용하거나 그 반대인**
 * 날이 온다. 그래서 이 절에는 판정 함수가 하나도 없고 아래 build 하나뿐이다(조건을
 * 부르는 자리는 조회다: queries/repair-case-overdue-notifications.ts).
 * 🔵 「납기 역전」이 같은 자리에서 같은 모양을 택했다(그 절의 그 문단).
 *
 * 🔴 **사내 목표 완료일이 아니다.** 2026-11-03 사용자 결정으로 이 경보의 기준은 고객
 * 요청 납기일 하나다 — 「사내 목표 완료일을 지났다고 해서 납기 지연 배지가 뜨지
 * 않도록 해줘」. 그 결정을 종에서 되살리면 같은 말이 화면과 종에서 두 뜻이 된다.
 * 🔵 그 칸이 비면 **연결된 내자 정리의 납기요청일을 빌려** 재는 것도 그 함수 안에
 * 들어 있다(2026-11-07 같은 요구의 앞 절반) — 여기서는 공짜로 따라온다.
 *
 * ── 🔴 확인 단추를 달지 않는다 ─────────────────────────────────────────────
 * ACKNOWLEDGEABLE_NOTIFICATION_KINDS 에 넣지 **않는다.** 넣으면 종에 확인 단추가 생기고,
 * 누르면 물건이 아직 안 나갔는데도 사라진다 — 「사과할 일」을 숨기는 길을 내는 셈이다.
 * 넣지 않으면 저절로 할 일 알림이 된다: 그 건이 나가거나(실제 출하일·출하 완료) 고객과
 * 협의해 날짜를 다시 잡으면 다음 조회에서 빠진다. 「납기 임박」·「납기 역전」·「사내 목표
 * 완료일 미등록」 셋이 모두 같은 자리에 선다.
 *
 * ── 받는 사람은 **전원**이다 ───────────────────────────────────────────────
 * 이웃한 둘(사내 목표 완료일 미등록 = 엔지니어, 납기 역전 = 엔지니어·영업·관리자)과
 * 갈린다. 까닭 둘을 알림 설정의 그 case 에 적어 두었고, 요점은 **지연이 임박의 바로
 * 다음 순간**이라는 것이다 — 같은 날짜를 창만 달리해 보므로, 명단이 갈리면 어제까지
 * 임박으로 보이던 건이 하루 지나는 순간 어떤 사람의 종에서 **말없이 사라진다.**
 * ────────────────────────────────────────────────────────────────────────────
 */

/**
 * 「납기 지연」 알림 한 줄.
 *
 * ── subject 는 인수번호다 ──────────────────────────────────────────────
 * 접수 건을 가리키는 말 중 사람이 먼저 찾는 것이고, 다른 종류들이 굵게 두는 것과
 * 같은 값이다.
 *
 * ── 🔴 detail 은 **「납기 임박」과 같은 모양**이다 ──────────────────────
 * 날짜 하나, 빌려 온 값이면 그 표시. 두 알림은 같은 칸(고객 요청 납기일)을 창만
 * 달리해 보는 짝이라, 종에서 모양이 다르면 사람이 둘을 다른 자료로 읽는다. 종류
 * 이름(「납기 지연」)은 종 패널이 이 줄 **위에** 따로 적으므로 여기 다시 적지
 * 않는다 — 잘리는 자리의 폭만 먹는다.
 *
 * 🔴 「며칠 지났는가」를 적지 않는다. 그 수를 내려면 「오늘」이 이 순수 함수로
 * 들어와야 하는데, 그러면 같은 알림이 **부르는 시각에 따라 다른 글자**가 되어 종과
 * 브라우저 알림창이 어긋날 수 있다(창을 재는 일은 조회가 한다). 날짜만 적어도 사람은
 * 오늘을 알고 있다.
 *
 * 표시 글자는 새로 쓰지 않고 상세정보 화면이 이미 쓰는 것을 그대로 가져온다
 * (requested-due-date-link.ts 의 DUE_DATE_FROM_DOMESTIC_ORDER_LABEL) — 「납기 임박」·
 * 「납기 역전」이 같은 자리에서 같은 상수를 쓴다.
 *
 * ── href 는 상세 첫 화면이다 ──────────────────────────────────────────
 * 고객 요청 납기일이 그 화면의 「인수 정보」에 있고, 날짜를 고치는 자리도 거기다.
 * 주소는 직접 적지 않고 탭 헬퍼에서 가져온다 — 이웃 셋과 같은 줄이다.
 *
 * targetKey 는 접수 건 id 다. 한 건에 납기일은 하나뿐이고, 사람에게도 「그 한 건」이다.
 */
export function buildRepairCaseDueDateOverdueNotification(input: {
  repairCaseId: string;
  intakeNumber: string;
  /** 화면에 보이는 그 날짜("YYYY-MM-DD"). 이미 지났다고 조회가 가린 값이다. */
  dueDate: string;
  /** 이 건의 칸이 아니라 연결된 내자 정리에서 빌려 온 날짜인가. */
  borrowed: boolean;
}): NotificationItem {
  return {
    id: `REPAIR_CASE_DUE_DATE_OVERDUE:${input.repairCaseId}`,
    kind: "REPAIR_CASE_DUE_DATE_OVERDUE",
    targetKey: input.repairCaseId,
    subject: input.intakeNumber,
    detail: input.borrowed
      ? `${input.dueDate} · ${DUE_DATE_FROM_DOMESTIC_ORDER_LABEL}`
      : input.dueDate,
    href: repairCaseDetailHrefs(input.repairCaseId).root,
  };
}

// ══════════════ 사내 목표 완료일 미등록 — PO 는 나갔는데 우리 날짜가 아직 비었다

/**
 * ────────────────────────────────────────────────────────────────────────────
 * 2026-10-29 사용자 요구: 「PO발행일이 등록되면 엔지니어들에게 **사내 목표 완료일을
 * 등록해 주세요** 라고 알림이 뜨도록」. 그리고 「이 알림은 승인용이야 — 해당 수리건에
 * 사내 목표 완료일이 등록되기 전까지는 **눌러서 확인해도 사라지지 않아**」.
 *
 * 🔴 **그래서 이 종류는 ACKNOWLEDGEABLE_NOTIFICATION_KINDS 에 넣지 않는다.** 거기
 * 들어가는 순간 종에 확인 단추가 생기고, 누르면 날짜를 안 적어도 사라진다 — 요구와
 * 정반대다. 넣지 않으면 저절로 「할 일 알림」이 된다: 날짜를 적으면 다음 조회에서
 * 빠지고, 안 적으면 계속 남는다(파일 머리말의 그 구조 그대로이고, 새 표는 하나도
 * 필요 없다). 적는 쪽 문도 이 종류의 키를 거절한다
 * (domain/notification-acknowledgement.ts 의 checkNotificationAcknowledgementKey).
 *
 * 🔵 **「지우기(✕)」는 그것과 다른 것이다.** 종의 ✕ 는 종류를 가리지 않고 모든 줄에
 * 열려 있고(domain/notification-dismissal.ts — 2026-10-20 결정), 기록은 포털에 남는다.
 * 그것으로 잠시 치울 수는 있지만 확인 기록처럼 영구가 아니다. 이번 조각에서 그 규칙을
 * 건드리지 않았다.
 *
 * ── 🔴 뜨는 조건 셋(2026-10-29·30 사용자 결정) ──────────────────────────────
 *   ① PO발행일이 있다            — domestic_orders.order_issued_date
 *   ② 사내 목표 완료일이 없다     — repair_cases.internal_target_shipment_date
 *   ③ 출하가 끝나지 않았다        — isRepairCaseShipmentFinished 가 거짓
 *                                   (domain/shipment-finished.ts)
 * 셋 다 **지금 자료에서 매번 다시 계산**하므로 「지난 건도 함께 뜬다」가 공짜로 따라
 * 온다 — PO발행일을 적는 자리가 셋(수리 건 상세 · A/S 내자 정리 · PO 쪽 내자 정리)인데
 * 전부 같은 칸이라, 어느 자리에서 적었든 다음 조회에서 똑같이 걸린다. 적는 자리마다
 * 훅을 걸었다면 하나는 반드시 빠뜨렸을 것이다.
 * ────────────────────────────────────────────────────────────────────────────
 */

/**
 * 이 건에 **PO발행일이 적혀 있는가** — 붙어 있는 내자 줄 가운데 하나라도 적혀 있으면 참.
 *
 * 한 수리 건에 내자 줄이 여럿일 수 있어서(분할 발주 — repair_case_id 에 유일 제약이
 * 없다) 날짜를 **묶음으로** 받는다. 「하나라도」인 까닭은 이 알림이 묻는 것이 「PO 가
 * 나가기 시작했는가」이기 때문이다 — 줄 하나라도 발행됐으면 그 건의 일정은 이미
 * 움직이고 있고, 그때가 우리 쪽 목표일을 적어야 하는 때다.
 *
 * 공백만 적힌 값은 없는 것으로 접는다(domestic-order-list.ts 의 foldBlankToNull —
 * 「납기 역전」·내자 목록이 같은 함수로 같은 판단을 한다). `date` 칸이라 실제로는
 * 공백이 들어올 수 없지만, 조회가 저장을 거치지 않은 값도 읽는다는 그 함수의 전제를
 * 여기서 뒤집지 않는다.
 */
export function hasDomesticOrderIssued(orderIssuedDates: readonly string[]): boolean {
  return orderIssuedDates.some((issuedDate) => foldBlankToNull(issuedDate) !== null);
}

/**
 * 그 건의 PO발행일 가운데 **가장 이른 하루**("YYYY-MM-DD"). 하나도 없으면 `null`.
 *
 * 알림 한 줄의 detail 에 실을 날짜다 — 「언제 나간 PO 인가」가 곧 「얼마나 오래 비워
 * 두었는가」라서, 여럿이면 가장 이른 것이 사람에게 더 급한 사실을 말한다.
 *
 * 🔵 셈은 납기요청일의 pickEarliestDueDate(weekly-report-delivery.ts)와 같은 문자열
 * min 이지만 **그 함수를 부르지 않는다.** 저쪽은 「입고 요청일을 고르는 규칙」이라는
 * 이름과 주석을 달고 있고 이쪽은 발주발행일이다 — 함수 하나를 두 뜻으로 쓰면 저쪽
 * 규칙이 바뀌는 날(예: 지난 날짜를 빼자) 이 알림의 날짜가 **아무 말 없이** 따라
 * 바뀐다. "YYYY-MM-DD" 가 자리수 고정이라 사전순이 곧 날짜순인 것은 두 곳이 같다
 * (domain/date-only.ts 머리말 — Date 로 파싱하면 한국에서 하루가 밀린다).
 */
export function earliestDomesticOrderIssuedDate(orderIssuedDates: readonly string[]): string | null {
  let earliest: string | null = null;
  for (const raw of orderIssuedDates) {
    const issuedDate = foldBlankToNull(raw);
    if (issuedDate === null) continue;
    if (earliest === null || issuedDate < earliest) earliest = issuedDate;
  }
  return earliest;
}

/**
 * 사내 목표 완료일이 **아직 비어 있는가**. 공백만 적힌 값도 「없음」이다 —
 * 「납기 역전」이 같은 칸을 같은 함수로 접는다(due-date-inversion.ts 의
 * isDueDateInverted). 한쪽이 공백을 값으로 치면 화면에는 빈칸인데 알림만 안 뜨는
 * 건이 생긴다.
 */
export function isInternalTargetShipmentDateMissing(internalTargetShipmentDate: string | null): boolean {
  return foldBlankToNull(internalTargetShipmentDate) === null;
}

/**
 * 이 수리 건에 **「사내 목표 완료일을 등록해 주세요」가 뜨는가** — 위 세 조건의 곱.
 *
 * 조건을 조회(SQL) 안에 적지 않고 여기 둔 까닭은 「납기 임박」과 같다
 * (isRepairCaseDueDateNear 의 주석): 같은 사실을 나중에 표·배지에서도 그리게 되면
 * 그 자리마다 조건을 다시 적게 되고, 언젠가 한 곳만 고쳐져 **종과 표가 서로 다른
 * 말을 한다.** 지금 이 함수를 부르는 곳은 조회 하나뿐이지만(queries/
 * repair-case-target-shipment-notifications.ts), 자리를 미리 하나로 정해 둔다.
 *
 * 🔴 **출하 완료는 「납기 임박」·「납기 지연」·「납기 역전」이 쓰는 그 함수로 가른다**
 * (isRepairCaseShipmentFinished). 넷이 「끝난 건」을 다르게 가르면 한쪽만 고쳐지는
 * 날이 온다. 상태가 `null` 인 건은 그 함수의 결정대로 「아직 안 나갔다」로 둔다.
 */
export function needsInternalTargetShipmentDate(row: {
  /** 붙어 있는 내자 줄의 PO발행일 전부(is_deleted = false 인 줄만). */
  orderIssuedDates: readonly string[];
  internalTargetShipmentDate: string | null;
  /** 평탄화된 지금 상태(workflow_steps.repair_status). 모르면 `null`. */
  status: RepairStatus | null;
  actualShipmentDate: string | null;
}): boolean {
  if (!hasDomesticOrderIssued(row.orderIssuedDates)) return false;
  if (!isInternalTargetShipmentDateMissing(row.internalTargetShipmentDate)) return false;
  return !isRepairCaseShipmentFinished(row);
}

/**
 * 사용자가 적어 준 그 문장 **그대로**(2026-10-29). 글자를 여기 한 곳에 두는 까닭은
 * 종 한 줄과 알림 설정 화면의 설명이 같은 말을 해야 하기 때문이다 — 두 곳에 손으로
 * 적으면 한쪽만 고쳐지는 날 「등록해 주세요」와 「등록 바랍니다」가 섞인다
 * (due-date-inversion.ts 의 DUE_DATE_INVERSION_NOTE 와 같은 규율).
 */
export const INTERNAL_TARGET_SHIPMENT_REQUEST_MESSAGE = "사내 목표 완료일을 등록해 주세요";

/**
 * 「사내 목표 완료일을 등록해 주세요」 알림 한 줄.
 *
 * ── subject 는 인수번호다 ──────────────────────────────────────────────
 * 접수 건을 가리키는 말 중 사람이 먼저 찾는 것이고, 결재 알림·납기 임박이 굵게
 * 두는 것과 같은 값이다.
 *
 * ── 🔴 detail 에 부탁 문장을 **그대로** 싣는다 ─────────────────────────
 * 다른 종류들은 종류 이름을 detail 에 다시 적지 않는다(잘리는 자리의 폭만 먹는다).
 * 여기만 예외인 까닭은 사용자가 요구한 것이 **그 문장 자체**이기 때문이다 —
 * 「[사내 목표 완료일을 등록해 주세요]라고 알림이 뜨도록」. 게다가 브라우저 알림창은
 * 제목에 종류 이름을, **본문에 detail 만** 싣는다(components/layout/
 * BrowserNotifications.tsx) — detail 에 없으면 알림창에서는 그 부탁이 아예 보이지
 * 않는다. 종 패널의 상세 칸은 한 줄에서 잘리므로(CSS truncate) 부탁을 **앞에** 두고
 * 날짜를 뒤에 붙인다.
 *
 * ── PO발행일을 함께 적는다 ─────────────────────────────────────────────
 * 「왜 지금 적어야 하는가」가 그 날짜다. 여럿이면 가장 이른 하루이고
 * (earliestDomesticOrderIssuedDate), 그래서 오래 비워 둔 건일수록 날짜가 멀어 보인다.
 *
 * ── href 는 상세 첫 화면이다 ──────────────────────────────────────────
 * 사내 목표 완료일을 적는 자리가 거기다(상세정보 → 인수 정보 → [수정] —
 * components/repair-cases/detail/edit/IntakeInfoEditForm.tsx 가 유일한 정상 편집
 * 경로다). 주소는 직접 적지 않고 탭 헬퍼에서 가져온다.
 *
 * targetKey 는 접수 건 id 다. 한 건에 목표 완료일은 하나뿐이고, 사람에게도 「그 한
 * 건」이다 — 내자 줄이 셋이어도 종에는 한 줄이다.
 */
export function buildRepairCaseTargetShipmentMissingNotification(input: {
  repairCaseId: string;
  intakeNumber: string;
  /** 가장 이른 PO발행일("YYYY-MM-DD"). 조회가 이미 「있다」를 가린 값이다. */
  orderIssuedDate: string;
}): NotificationItem {
  return {
    id: `REPAIR_CASE_TARGET_SHIPMENT_MISSING:${input.repairCaseId}`,
    kind: "REPAIR_CASE_TARGET_SHIPMENT_MISSING",
    targetKey: input.repairCaseId,
    subject: input.intakeNumber,
    detail: `${INTERNAL_TARGET_SHIPMENT_REQUEST_MESSAGE} · PO발행일 ${input.orderIssuedDate}`,
    href: repairCaseDetailHrefs(input.repairCaseId).root,
  };
}

// ══════════════ 납기 역전 — 우리가 잡아 둔 날이 고객이 달라고 한 날보다 뒤다

/**
 * ────────────────────────────────────────────────────────────────────────────
 * 2026-10-30 사용자 요구: 「[납기 요청일 협의가 필요합니다]도 주황색 계열로 알림을
 * 띄우도록 하자. 대상은 (엔지니어, 영업, 관리자)이고 마찬가지로 승인용으로 설정해 줘.
 * 해당 알림을 클릭하면 수리건 상세로 넘어가지도록 해 줘.」
 *
 * ── 🔴 판정을 여기 적지 않는다. 한 줄도 ────────────────────────────────────
 * 뜨는 조건은 **이미 있다** — domain/due-date-inversion.ts 의
 * isRepairCaseDueDateInverted 다. 그 파일이 생긴 까닭 자체가 「네 자리(수리 건 상세 ·
 * A/S 내자 정리 · PO 내자 정리 · 알림)가 같은 답을 내야 한다」이고, 이 알림이 그
 * 넷째다. 조건을 여기 베껴 적으면 그 파일의 존재 이유가 그 자리에서 사라진다 —
 * 빌려 온 날짜로 재는 규칙도, 같은 날은 역전이 아니라는 경계도, 출하가 끝난 건을
 * 빼는 일도 전부 그 함수 안에 들어 있어 **공짜로 따라온다.** 그래서 이 절에는
 * 판정 함수가 하나도 없고 아래 build 하나뿐이다(조건을 부르는 자리는 조회다:
 * queries/repair-case-due-date-inverted-notifications.ts).
 *
 * 🔵 바로 위 「사내 목표 완료일 미등록」에는 판정 함수가 셋 있었다. 그쪽은 묻는
 * 사실이 이 저장소에 없던 것이라 새로 지을 수밖에 없었고, 이쪽은 **이미 지어져
 * 화면 셋이 쓰고 있다.** 이웃한 두 절의 모양이 다른 까닭이 그것뿐이다.
 *
 * ── 🔴 확인 단추를 달지 않는다(사용자가 말한 「승인용」) ────────────────────
 * ACKNOWLEDGEABLE_NOTIFICATION_KINDS 에 넣지 **않는다.** 넣는 순간 종에 확인 단추가
 * 생기고, 누르면 날짜를 그대로 둔 채 사라진다 — 「승인용」이라는 말이 뜻한 것과
 * 정반대다. 넣지 않으면 저절로 할 일 알림이 된다: 두 날짜 중 하나를 고치거나(사내
 * 목표 완료일을 당기거나, 고객과 협의해 요청일을 미루거나) 그 건이 나가면 다음
 * 조회에서 빠진다. 적는 쪽 문도 이 종류의 키를 거절한다
 * (domain/notification-acknowledgement.ts 의 checkNotificationAcknowledgementKey).
 * 🔵 종의 ✕(지우기)는 그것과 다른 것이고, 종류를 가리지 않고 열려 있다
 * (domain/notification-dismissal.ts — 2026-10-20 결정). 이번 조각에서 안 건드렸다.
 *
 * ── 받는 사람은 엔지니어 · 영업 · 관리자 ───────────────────────────────────
 * 「사내 목표 완료일 미등록」이 **적는 사람**(엔지니어)에게만 가는 것과 갈린다 —
 * 역전은 날짜를 고쳐서 끝나는 일이 아니라 **고객에게 전화를 걸어야** 끝나는 일이라
 * 영업이 함께 받아야 한다. 가르는 자리는 여기가 아니라 알림 설정의 역할 기본값이다
 * (domain/notification-settings.ts — 그 case 주석에 까닭 셋).
 * ────────────────────────────────────────────────────────────────────────────
 */

/**
 * 「납기 요청일 협의가 필요합니다.」 알림 한 줄.
 *
 * ── subject 는 인수번호다 ──────────────────────────────────────────────
 * 접수 건을 가리키는 말 중 사람이 먼저 찾는 것이고, 결재 알림·납기 임박·사내 목표
 * 출하일 미등록이 굵게 두는 것과 같은 값이다.
 *
 * ── 🔴 detail 의 글자를 **여기서 짓지 않는다** ─────────────────────────
 * 메모 문장은 화면 넷이 이미 쓰는 상수를 그대로 가져온다(due-date-inversion.ts 의
 * DUE_DATE_INVERSION_NOTE). 같은 사실이 화면에서는 「협의가 필요합니다」, 종에서는
 * 「협의 바랍니다」로 읽히면 사람은 둘을 다른 경보로 센다. 종류 이름을 detail 에 다시
 * 적지 않는 다른 종류들과 갈리는 점도 바로 위 절(사내 목표 완료일 미등록)과 같다 —
 * 사용자가 요구한 것이 **그 문장 자체**이고, 브라우저 알림창은 제목에 종류 이름을
 * **본문에 detail 만** 싣는다(components/layout/BrowserNotifications.tsx).
 * 종 패널의 상세 칸은 한 줄에서 잘리므로(CSS truncate) 그 문장을 **맨 앞**에 둔다.
 *
 * ── 🔴 두 날짜를 **각각 이름 붙여** 싣는다 ─────────────────────────────
 * 「납기 임박」은 날짜가 하나뿐이라 숫자만 적어도 뜻이 분명하지만(그 build 함수),
 * 역전은 **둘을 견준 결과**다. 이름 없이 둘을 나란히 적으면 어느 쪽이 우리 날짜인지
 * 알 수 없고, 사람이 고쳐야 할 칸이 어느 것인지도 알 수 없다.
 *
 * ── 🔴 빌려 온 날짜에는 표시가 붙는다 ──────────────────────────────────
 * 고객 요청 납기일 칸이 비면 연결된 내자 정리의 납기요청일 중 가장 이른 하루로 재는
 * 것이 이 저장소의 규칙이고(requested-due-date-link.ts), 역전 판정도 그 값으로 한다.
 * 표시가 없으면 사람은 그 날짜를 **이 건에 자기가 적어 둔 값**으로 읽는다 — 그러면
 * 상세 화면에서 빈칸을 보고 「알림이 틀렸다」고 결론 낸다. 표시 글자는 새로 쓰지 않고
 * 상세정보 화면이 이미 쓰는 것을 그대로 가져온다(DUE_DATE_FROM_DOMESTIC_ORDER_LABEL)
 * — 「납기 임박」이 같은 자리에서 같은 상수를 쓴다. 날짜 뒤 괄호에 넣는 것은 내자
 * 정리의 날짜 줄이 메모를 붙이는 모양 그대로다("2026-01-05 (1차분)").
 *
 * ── href 는 상세 첫 화면이다 ──────────────────────────────────────────
 * 사용자가 「클릭하면 수리건 상세로 넘어가도록」이라고 못 박았고, 두 날짜를 고치는
 * 자리도 거기다(상세정보 → 인수 정보 → [수정]). 주소는 직접 적지 않고 탭 헬퍼에서
 * 가져온다 — 납기 임박·사내 목표 완료일 미등록과 같은 줄이다.
 *
 * targetKey 는 접수 건 id 다. 한 건에 역전은 하나뿐이고, 사람에게도 「그 한 건」이다.
 */
export function buildRepairCaseDueDateInvertedNotification(input: {
  repairCaseId: string;
  intakeNumber: string;
  /** 그 건의 사내 목표 완료일("YYYY-MM-DD"). 조회가 이미 「적혀 있다」를 가린 값이다. */
  internalTargetShipmentDate: string;
  /** 화면에 보이는 그 고객 요청 납기일("YYYY-MM-DD"). 빌려 온 값일 수 있다. */
  requestedDueDate: string;
  /** 이 건의 칸이 아니라 연결된 내자 정리에서 빌려 온 날짜인가. */
  borrowed: boolean;
}): NotificationItem {
  const requested = input.borrowed
    ? `${input.requestedDueDate} (${DUE_DATE_FROM_DOMESTIC_ORDER_LABEL})`
    : input.requestedDueDate;
  return {
    id: `REPAIR_CASE_DUE_DATE_INVERTED:${input.repairCaseId}`,
    kind: "REPAIR_CASE_DUE_DATE_INVERTED",
    targetKey: input.repairCaseId,
    subject: input.intakeNumber,
    detail:
      `${DUE_DATE_INVERSION_NOTE} · 사내 목표 완료일 ${input.internalTargetShipmentDate} · ` +
      `고객 요청 납기일 ${requested}`,
    href: repairCaseDetailHrefs(input.repairCaseId).root,
  };
}

// ═════════════════════════════════════ 결재 결과 — 요청자에게 가는 정보성 알림

/**
 * 결재 결과 알림이 종에 머무는 기간(일). **결정 시각**으로 잰다.
 *
 * 🔴 창이 있는 이유는 기능을 켜는 순간이다 — 창이 없으면 지금까지 쌓인 결재 결과가
 * 전부 한꺼번에 종에 쏟아지고, 사람은 그것을 하나씩 눌러 치워야 한다. 그보다 오래된
 * 것은 확인하지 않아도 뜨지 않는다(확인 기록도 필요 없다).
 *
 * 이 숫자가 적힌 곳은 여기 하나다 — 조회(창의 시작 시각)와 알림 설정 화면의 설명
 * 문구가 이 값을 가져다 쓴다.
 */
export const APPROVAL_OUTCOME_NOTIFICATION_WINDOW_DAYS = 7;

const MILLISECONDS_PER_DAY = 24 * 60 * 60 * 1000;

/** `now` 기준 창의 시작 시각. 결정 시각이 이 값 이상이면 창 안이다. */
export function approvalOutcomeNotificationWindowStart(now: Date): Date {
  return new Date(now.getTime() - APPROVAL_OUTCOME_NOTIFICATION_WINDOW_DAYS * MILLISECONDS_PER_DAY);
}

/**
 * 「승인 완료」를 **요청자 말고도** 받는 역할 — 영업 · 관리자 · 최고관리자.
 *
 * 2026-11-12 사용자 요구다 — 「[승인 완료] 알림이 승인 요청을 한 사람 외에도
 * [영업, 관리자]인 사람들에게도 뜨도록」.
 *
 * 🔴 **「반려됨」은 여기 걸리지 않는다 — 그쪽은 여전히 요청자 본인뿐이다.** 둘은 같은
 * 결재 사슬에서 같은 조회로 나오는 짝이라 「한쪽만 빠뜨렸다」로 읽기 아주 쉬운 자리인데,
 * 사용자 결정이 승인 완료 **하나**였다. 까닭도 있다: 반려는 사유가 실리고 「고쳐서 다시
 * 올릴 사람」에게 가는 알림이라, 명단을 넓히면 할 일 알림이 구경거리가 된다. 맞추지
 * 마라. 조회 쪽도 그 뜻대로 갈라 두었다 — listMyRejectedApprovalOutcomes 는 역할을
 * **인자로 받지도 않아서** 넓힐 길이 없다(db/queries/approval-outcome-notifications.ts).
 *
 * 🔴 **최고관리자를 함께 적는다.** 사용자가 말한 것은 「영업, 관리자」지만, 알림 설정에는
 * 종류를 가리지 않는 잠금이 따로 있어 최고관리자가 받는 것은 화면에서 끌 수 없다
 * (notification-settings.ts 의 isRoleEditableInNotificationSettings). 여기서 빼면
 * 「받음(잠김)」이라 적어 둔 그 화면이 거짓말이 된다 — 명단을 넓히는 결정이 아니라
 * 잠금이 이미 참으로 만들어 둔 것을 같은 말로 적는 것이다(같은 파일의 사내 목표 완료일
 * 미등록·납기 역전이 같은 문단을 달고 있다).
 *
 * 🔵 **A/S 엔지니어·재고 담당자는 넓히지 않는다** — 자기가 올린 결재의 결과만 받는
 * 종전 그대로다.
 *
 * 🔵 **이 판정이 역할 스위치를 대신하지 않는다.** 알림 설정에서 영업을 끄면 그 사람
 * 앞에서는 조회가 아예 돌지 않는다(db/queries/notifications.ts 의 deliversNotification).
 * 여기가 정하는 것은 「스위치를 지나온 사람이 **남의** 결과까지 보는가」 하나다.
 */
export const APPROVAL_GRANTED_BROAD_RECIPIENT_ROLES: readonly Role[] = ["SALES", "ADMIN", "SUPER_ADMIN"];

export function receivesOthersApprovalGrantedOutcomes(role: Role): boolean {
  return APPROVAL_GRANTED_BROAD_RECIPIENT_ROLES.includes(role);
}

/**
 * 반려 사유를 detail 에 몇 글자까지 보여 주는가.
 *
 * 종 패널의 상세 칸은 어차피 한 줄에서 잘리지만(CSS truncate), 같은 detail 이
 * 브라우저 알림창에도 그대로 실린다 — 거기서는 잘리지 않으므로 긴 사유가 알림창을
 * 통째로 덮는다. 사유 전문은 누르면 가는 화면(결재 이력)에 있다.
 */
export const APPROVAL_REJECTION_REASON_PREVIEW_LENGTH = 40;

/**
 * 반려 사유 미리보기 — 줄바꿈·연속 공백을 한 칸으로 펴고, 길면 잘라 말줄임표를
 * 붙인다. 글자 단위로 자른다(`Array.from` — 한 글자가 두 코드 단위인 문자를 반으로
 * 가르지 않는다).
 */
export function previewApprovalRejectionReason(reason: string | null): string {
  const flattened = (reason ?? "").replace(/\s+/g, " ").trim();
  const characters = Array.from(flattened);
  if (characters.length <= APPROVAL_REJECTION_REASON_PREVIEW_LENGTH) return flattened;
  return `${characters.slice(0, APPROVAL_REJECTION_REASON_PREVIEW_LENGTH).join("").trimEnd()}…`;
}

/**
 * 결재 결과 알림 하나가 가리키는 결재 행 — 두 표 중 하나다.
 *
 *  · REPAIR_CASE — `repair_case_approvals` 의 한 행(수리 검수 승인 · 최종 출하 승인).
 *    접수 건이 없거나 휴지통에 간 결재는 조회가 애초에 내놓지 않으므로 인수번호가
 *    언제나 있다.
 *  · QUOTE — `quote_approvals` 의 한 행(견적서 승인). 견적서가 없거나 휴지통에 간
 *    결재는 조회가 애초에 내놓지 않으므로 발행번호가 언제나 있다(접수 건 결재와
 *    같은 처리다 — 누르면 갈 화면이 없는 결재는 알리지 않는다).
 *  · DOMESTIC_ORDER — `repair_case_approvals` 의 한 행인데 **기타건** 쪽이다
 *    (2026-11-06, approval_type = 'DOMESTIC_ORDER_FINAL_SHIPMENT'). 🔴 REPAIR_CASE 와
 *    **같은 표**인데 갈래를 나눈 까닭은 누르면 갈 화면이 다르기 때문이다
 *    (`/domestic-orders/{id}/approval`). 품명은 비어 올 수 있어 조회가 들고 온 값을
 *    그대로 받고, 굵게 그릴 글자는 domesticOrderApprovalSubject 가 메운다.
 *
 * 🔴 **셋째 갈래 PART_ISSUE(`inventory_part_issue_approvals`, 부품 불출 승인)는
 * 2026-10-27(조각 13-C4)에 들어냈다.** 누르면 갈 세 주소(`/inventory` ·
 * `/inventory/approvals` · `/inventory/requests`)가 13-A 에서 전부 404 가 됐고,
 * 재고는 별도 시스템(dss-inventory)이 제 알림을 포털로 직접 보낸다. 🔵 **DB enum 과
 * 과거 결재 기록의 `PART_ISSUE` 는 그대로 산다** — 여기서 뺀 것은 「그 결과를 종에
 * 띄우는가」뿐이고, 결재선 용도 이름표(domain/shipment-approval-route.ts)는 영구
 * 유지다.
 */
export type ApprovalOutcomeTarget =
  | {
      source: "REPAIR_CASE";
      /** 결정된 결재 행의 id. 알림 키가 이 값으로 유일해진다. */
      approvalId: string;
      repairCaseId: string;
      intakeNumber: string;
      approvalType: ShipmentApprovalType;
    }
  | {
      source: "QUOTE";
      approvalId: string;
      quoteId: string;
      quoteNumber: string;
    }
  | {
      source: "DOMESTIC_ORDER";
      approvalId: string;
      domesticOrderId: string;
      /** 그 줄의 품명. 🔵 **`null` 이 정상이다** — 굵은 글자는 아래에서 메운다. */
      modelName: string | null;
    };

/**
 * 알림 키에서 결재 행이 어느 표의 것인지 가르는 짧은 표시. 두 표의 id 가 우연히
 * 겹쳐도(둘 다 uuid 라 실제로는 없다) 키가 겹치지 않게 하고, 키만 보고도 어느 표를
 * 봐야 하는지 알게 한다. 확인 키의 형식(`종류:나머지`, 영숫자·`:`·`-`·`_`)을 지킨다.
 *
 * 🔴 **빠진 `pia`(불출 결재) 자리를 다시 쓰지 마라.** 운영의
 * `notification_acknowledgements` 에는 `APPROVAL_GRANTED:pia:<uuid>` 로 적힌 과거
 * 확인 기록이 남아 있을 수 있다. 새 표에 그 글자를 물려주면 남이 눌러 둔 기록이
 * 엉뚱한 알림을 미리 지운다.
 */
const APPROVAL_OUTCOME_KEY_TABLE_TAG: Record<ApprovalOutcomeTarget["source"], string> = {
  REPAIR_CASE: "rca",
  QUOTE: "qa",
  // 🔴 `rca` 와 **같은 표**의 행인데 딱지를 가른다(2026-11-06). 행 id 가 uuid 라
  //    같은 딱지를 써도 열쇠가 겹치지는 않지만, 딱지가 갈려 있으면 확인 기록
  //    (`APPROVAL_GRANTED:doa:<uuid>`)만 보고도 어느 화면으로 가는 결재인지 알 수
  //    있다. 🔵 빠진 `pia`(불출 결재) 자리는 여전히 비워 둔다 — 위 주석 참조.
  DOMESTIC_ORDER: "doa",
};

function approvalOutcomeKeySuffix(target: ApprovalOutcomeTarget): string {
  return `${APPROVAL_OUTCOME_KEY_TABLE_TAG[target.source]}:${target.approvalId}`;
}

function approvalOutcomeSubject(target: ApprovalOutcomeTarget): string {
  if (target.source === "REPAIR_CASE") return target.intakeNumber;
  if (target.source === "QUOTE") return target.quoteNumber;
  // 🔴 기타건만 비어 올 수 있다 — 메우는 자리는 한 곳이다(domesticOrderApprovalSubject).
  return domesticOrderApprovalSubject(target.modelName);
}

function approvalOutcomeName(target: ApprovalOutcomeTarget): string {
  if (target.source === "REPAIR_CASE") return APPROVAL_TYPE_LABELS[target.approvalType];
  if (target.source === "QUOTE") return QUOTE_APPROVAL_LABEL;
  // 🔴 글자를 여기서 새로 적지 않는다 — 결재선 용도 이름표 한 곳에서 온다
  //    (domain/domestic-order-approval-rules.ts 의 DOMESTIC_ORDER_APPROVAL_LABEL).
  return DOMESTIC_ORDER_APPROVAL_LABEL;
}

/**
 * 기타건 결재 결과를 누르면 갈 곳 — 승인이든 반려든 그 줄의 [승인] 탭 하나다.
 *
 * 🔴 **접수 건 헬퍼를 쓰면 `/repair-cases/{uuid}/approval` 로 나가 404 다.** 같은 표의
 * 행이라 베끼기 쉬운 자리인데, 그 실패는 포털 화면에서만 보인다(위 대기 알림 빌더의
 * 같은 경고).
 */
function approvalOutcomeDomesticOrderHref(
  target: Extract<ApprovalOutcomeTarget, { source: "DOMESTIC_ORDER" }>
): string {
  return domesticOrderDetailHrefs(target.domesticOrderId).approval;
}

/** 결과 알림 한 줄이 누르면 갈 곳 — 세 갈래가 각자 제 화면으로 간다. */
function approvalOutcomeHref(target: ApprovalOutcomeTarget): string {
  if (target.source === "REPAIR_CASE") return repairCaseDetailHrefs(target.repairCaseId).approval;
  if (target.source === "QUOTE") return approvalOutcomeQuoteHref(target);
  return approvalOutcomeDomesticOrderHref(target);
}

/**
 * 결과 알림을 누르면 갈 곳 — 견적서는 승인이든 반려든 그 장 하나이므로 한 주소다.
 *
 * 🔴 **[견적서 결재] 탭으로 연다**(2026-10-31). 결과를 되짚는 이력도, 반려 뒤
 * 다시 올리는 단추도 그 탭에 있다 — 결재 대기 알림과 **같은 자리**다
 * (buildQuoteApprovalNotification 의 href 절에 그 까닭이 적혀 있다).
 *
 * 🔵 예전에는 이 자리에 「승인 완료와 반려됨이 서로 다르다」는 단서가 붙어 있었다.
 * 승인은 「결과를 확인하는 자리」, 반려는 「다시 올리는 자리」로 갈리던 것이 **불출
 * 하나뿐**이었고, 그 갈래를 2026-10-27 에 들어내면서 두 함수의 href 가 같아졌다.
 */
function approvalOutcomeQuoteHref(target: Extract<ApprovalOutcomeTarget, { source: "QUOTE" }>): string {
  return quoteEditHref({ quoteId: target.quoteId, repairCaseId: null, tab: "approval" });
}

/**
 * "내가 요청한 결재가 최종 승인됐다" 알림 한 줄.
 *
 * ── id 와 targetKey 는 결재 행 하나로 유일하다 ────────────────────────────
 * 이 알림은 할 일이 아니라 **사건**이다. 같은 접수 건에서 검수 승인과 출하 승인이
 * 둘 다 끝나면 사건도 둘이고, 하나를 눌러 확인해도 다른 하나는 남아야 한다. 그래서
 * targetKey 를 접수 건이 아니라 id 와 같게 둔다(배지도 사건 수로 센다). id 는 곧
 * 확인 기록의 키다 — domain/notification-acknowledgement.ts 의 형식을 지킨다.
 *
 * ── detail 은 무슨 결재인가 + 누가 승인했나 ──────────────────────────────
 * 「승인 완료」라는 종류 이름은 종 패널이 이 줄 **위에** 따로 적는다. 여기 또 적으면
 * 잘리는 자리의 폭만 먹는다 — 다른 종류들과 같은 갈림이다. 결정자는 **마지막 단계**를
 * 결재한 사람이다(중간 단계 승인은 이 알림이 되지 않는다 — 조회가 가른다).
 *
 * ── href 는 결과를 확인하는 자리 ────────────────────────────────────────
 *  · 접수 건 결재 → 그 건의 검수/승인 화면(결재 대기 알림과 같은 헬퍼).
 *  · 견적서 → 그 견적서의 **[견적서 결재] 탭** — 결재 이력이 거기 있다
 *    (2026-10-31, approvalOutcomeQuoteHref).
 *  · 🔴 기타건 → **그 내자 줄의 [승인] 탭**(2026-11-06). 접수 건과 같은 표의 행이라
 *    헬퍼를 베끼기 쉬운데, 베끼면 404 다(approvalOutcomeDomesticOrderHref).
 */
export function buildApprovalGrantedNotification(
  input: ApprovalOutcomeTarget & { decidedByName: string }
): NotificationItem {
  const id = `APPROVAL_GRANTED:${approvalOutcomeKeySuffix(input)}`;
  return {
    id,
    kind: "APPROVAL_GRANTED",
    targetKey: id,
    subject: approvalOutcomeSubject(input),
    detail: `${approvalOutcomeName(input)} · ${input.decidedByName}`,
    href: approvalOutcomeHref(input),
  };
}

/**
 * "내가 요청한 결재가 반려됐다" 알림 한 줄.
 *
 * id·targetKey·subject 의 규칙은 승인 완료와 같다(위 주석).
 *
 * detail 은 무슨 결재인가 + 반려 사유 앞부분이다. 반려된 사람이 다음에 할 일은
 * 사유를 읽고 고쳐서 다시 올리는 것이라, 누가 반려했는지보다 **왜**가 먼저다. 사유가
 * 비어 있으면(표 CHECK 가 NULL 은 막지만 공백만 있는 글은 막지 않는다) 결재 이름만
 * 적는다.
 *
 * href 는 다시 올리는 자리다:
 *  · 접수 건 결재 → 그 건의 검수/승인 화면(재요청 단추가 거기 있다).
 *  · 견적서 → 그 견적서의 **[견적서 결재] 탭** — 다시 올리는 단추가 거기 있다
 *    (2026-10-31). 고칠 것이 있으면 그 화면에서 [견적서 수정] 탭으로 건너간다.
 *  · 기타건 → 그 내자 줄의 **[승인] 탭** — 반려 뒤 다시 올리는 단추가 거기 있다
 *    (2026-11-06, DOMESTIC_ORDER_APPROVAL_REQUESTABLE_STATES 에 REJECTED 가 있다).
 */
export function buildApprovalRejectedNotification(
  input: ApprovalOutcomeTarget & { decisionReason: string | null }
): NotificationItem {
  const id = `APPROVAL_REJECTED:${approvalOutcomeKeySuffix(input)}`;
  const reason = previewApprovalRejectionReason(input.decisionReason);
  const name = approvalOutcomeName(input);
  return {
    id,
    kind: "APPROVAL_REJECTED",
    targetKey: id,
    subject: approvalOutcomeSubject(input),
    detail: reason.length > 0 ? `${name} · 사유: ${reason}` : name,
    href: approvalOutcomeHref(input),
  };
}
