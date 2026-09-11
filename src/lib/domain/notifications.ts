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

import { inventoryPartRequestStatusLabels, stockOwnerLabels, type StockOwner } from "./inventory-types";
import { LABELS as APPROVAL_TYPE_LABELS, type ShipmentApprovalType } from "./local/workflow/shipment-approval-checklist";
import { repairCaseDetailHrefs } from "./repair-case-detail-tabs";
import { SHIPMENT_APPROVAL_ROUTE_SCOPE_LABELS } from "./shipment-approval-route";

/**
 * 등록된 알림 종류. 새 종류를 붙일 때 손대는 곳은 이 배열과
 * `db/queries/notifications.ts`의 소스 목록 둘뿐이고, 화면은 고치지 않는다 —
 * NotificationItem 한 모양만 그리기 때문이다.
 */
export const NOTIFICATION_KINDS = [
  "REPAIR_CASE_APPROVAL",
  "PART_REQUEST_PENDING",
  "PART_STOCK_BELOW_MINIMUM",
  "CUSTOMER_REPAIR_REQUEST_NEW",
  "PART_ISSUE_APPROVAL_PENDING",
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
   * 결재가 걸려 있어도 사람에게는 "그 한 건"이므로 배지에 2로 세면 안 된다.
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
 * 사이드바의 결재 배지(countRepairCasesPendingMyApproval)와 종 배지가 **이
 * 함수 하나**를 쓴다. 두 곳에 `new Set(...).size`를 각각 적어 두면 한쪽만
 * 고쳐졌을 때 같은 화면의 두 숫자가 서로 다른 말을 하게 된다.
 */
export function countNotificationTargets(targetKeys: readonly string[]): number {
  return new Set(targetKeys).size;
}

/**
 * 종류별 개수. 종 배지는 전체를 세지만, 사이드바 결재 배지처럼 **한 종류만**
 * 가리키는 자리도 있어서 나눠서 돌려준다 — 종류가 늘었을 때 결재 배지가 조용히
 * 남의 알림까지 세게 두지 않기 위한 것이다.
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
 * 접수 건이 사라진 부품 요청의 subject.
 *
 * repair_case_id는 NULL이 될 수 있다(접수 건 영구 삭제 시 ON DELETE SET NULL).
 * 요청 행 자체는 재고 회계 기록이라 남고, 알림에도 계속 나와야 한다 — 인수번호
 * 자리가 비면 굵은 글씨가 통째로 사라져 무엇에 대한 알림인지 알 수 없다.
 *
 * 문구는 부품 요청 관리 목록(getPartRequestsForManager)이 같은 상황에 이미
 * 쓰고 있는 것을 그대로 따른다 — 같은 것을 두 가지 말로 부르지 않는다.
 */
export const DELETED_REPAIR_CASE_SUBJECT = "삭제된 접수 건";

/**
 * "처리 대기 중인 부품 요청" 알림 한 줄.
 *
 * detail 라벨은 새로 쓰지 않고 inventory-types.ts의
 * inventoryPartRequestStatusLabels를 그대로 가져온다 — 부품 요청 관리 목록과
 * 내 작업 화면이 이미 그 문자열("요청 대기")로 이 상태를 부르고 있다. 뒤에
 * 요청자를 붙이는 것은 목록을 열기 전에 "누구 요청인지"까지 보이게 하기
 * 위한 것이다(관리자가 처리 순서를 정할 때 먼저 보는 값).
 *
 * href는 건별 상세가 아니라 부품 요청 관리 목록이다 — 요청에는 자기만의 상세
 * 화면이 없고, 실제로 불출/거절/보류를 누르는 자리가 그 목록이다.
 *
 * targetKey는 요청 id다. 요청 하나가 사람에게도 한 건이고, 한 요청에 부품이
 * 여러 개 들어 있어도 배지에 여러 건으로 세면 안 된다.
 */
export function buildPendingPartRequestNotification(input: {
  requestId: string;
  /** NULL이면 접수 건이 영구 삭제된 요청이다 — DELETED_REPAIR_CASE_SUBJECT로 대신한다. */
  intakeNumber: string | null;
  requestedByName: string;
}): NotificationItem {
  return {
    id: `PART_REQUEST_PENDING:${input.requestId}`,
    kind: "PART_REQUEST_PENDING",
    targetKey: input.requestId,
    subject: input.intakeNumber ?? DELETED_REPAIR_CASE_SUBJECT,
    detail: `${inventoryPartRequestStatusLabels.PENDING} · ${input.requestedByName}`,
    href: "/inventory/requests",
  };
}

/**
 * "재고가 한계수량 아래로 떨어졌다" 알림 한 줄.
 *
 * subject 는 품명이다 — 이 알림에서 사람이 먼저 찾는 것은 "어느 부품인가"다.
 *
 * detail 에는 **소유자 이름과 두 숫자가 모두** 드러난다("DSS · 15 / 한계 30").
 * 소유자를 빼면 같은 부품의 네 줄을 구별할 수 없고, 숫자를 빼면 상세를 열기 전에는
 * 급한지 아닌지를 알 수 없다 — 15/30 과 29/30 은 같은 알림이 아니다. 소유자 라벨은
 * 새로 쓰지 않고 inventory-types.ts 의 stockOwnerLabels 를 그대로 가져온다(재고
 * 보유 표·부품 요청 화면이 이미 그 문자열로 이 소유자를 부른다).
 *
 * href 는 그 품목 상세다. 한계수량 구역이 거기 있고, 지금 수량을 보면서 기준을
 * 고치거나 입고를 잡는 일이 전부 그 화면에서 일어난다.
 *
 * ── targetKey 는 (부품, 소유자)다 — 부품 하나가 넷으로 셀 수 있다 ────────
 * 결재 알림은 한 접수 건에 결재가 둘 걸려 있어도 targetKey 가 접수 건 id 라
 * 배지에 1 로 센다. 여기서는 반대로 정했다. 가르는 기준은 **한 번의 조치로 함께
 * 사라지는가**다 — 결재는 한 화면에서 둘 다 처리하면 함께 사라지지만, DSS 재고를
 * 채워도 교산 부족은 그대로 남는다. 소유자마다 채우는 경로도 상대도 다르다. 넷이
 * 동시에 부족하면 실제로 해야 할 일이 넷이므로 배지도 4 로 센다.
 */
export function buildPartStockBelowMinimumNotification(input: {
  partId: string;
  partName: string;
  owner: StockOwner;
  currentQuantity: number;
  minimumQuantity: number;
}): NotificationItem {
  return {
    id: `PART_STOCK_BELOW_MINIMUM:${input.partId}:${input.owner}`,
    kind: "PART_STOCK_BELOW_MINIMUM",
    targetKey: `${input.partId}:${input.owner}`,
    subject: input.partName,
    detail: `${stockOwnerLabels[input.owner]} · ${input.currentQuantity} / 한계 ${input.minimumQuantity}`,
    href: `/inventory/${input.partId}`,
  };
}

/**
 * "고객사가 새 수리 의뢰를 보냈다" 알림 한 줄.
 *
 * subject 는 고객사 이름이다 — 이 알림에서 사람이 먼저 찾는 것은 "어디서
 * 왔나"다. 접수번호는 아직 없다(접수로 만들기 전이라 존재하지 않는다).
 *
 * detail 에 모델명과 S/N 을 함께 둔다. 같은 고객사가 여러 건을 보냈을 때
 * 목록에서 구별되어야 하고, 담당자가 상세를 열기 전에 "내가 아는 그 물건"
 * 인지 알아볼 수 있어야 한다.
 *
 * targetKey 는 의뢰 id 다. 의뢰 하나가 곧 처리해야 할 일 하나이므로 배지도
 * 그렇게 센다.
 */
export function buildCustomerRepairRequestNotification(input: {
  requestId: string;
  customerName: string;
  productModelName: string;
  serialNumber: string;
}): NotificationItem {
  return {
    id: `CUSTOMER_REPAIR_REQUEST_NEW:${input.requestId}`,
    kind: "CUSTOMER_REPAIR_REQUEST_NEW",
    targetKey: input.requestId,
    subject: input.customerName,
    detail: `${input.productModelName} · S/N ${input.serialNumber}`,
    href: "/customer-portal/requests",
  };
}

/**
 * "지금 내 차례인 부품 불출 결재" 알림 한 줄.
 *
 * ── subject 는 무엇에 대한 신청인가 ────────────────────────────────────
 * [승인 요청건] 탭의 신청 카드가 굵게 적는 것과 같은 순서다 — 접수 건이 있으면
 * 그 인수번호, 없으면 직접 사용의 사용처. 인수번호는 헤더가 직접 가리키는 접수
 * 건이거나(직접 사용) 부품 요청이 가리키는 접수 건이다(요청 기반). 둘 중 어느
 * 쪽인지를 가려 읽는 것은 조회의 몫이고, 여기는 받은 값을 순서대로 고르기만 한다.
 *
 * 둘 다 없는 행은 **요청 기반인데 그 접수 건이 영구 삭제된 것**뿐이다. 직접
 * 사용은 표 CHECK(direct_use_has_destination)가 접수 건이나 사용처 중 하나를
 * 요구하고, 부품 요청은 접수 건 없이 만들어지지 않는다. 그래서 대신하는 문구는
 * 부품 요청 알림과 같은 DELETED_REPAIR_CASE_SUBJECT 다 — 같은 상황을 두 말로
 * 부르지 않는다.
 *
 * ── detail 은 몇 단계의 결재인가 + 신청자 ──────────────────────────────
 * "불출 승인 대기"라는 종류 이름은 종 패널이 이 줄 **위에** 따로 적는다
 * (NOTIFICATION_KIND_META). detail 에 같은 말을 또 넣으면 잘리는 자리의 폭만
 * 먹는다 — 결재 알림이 detail 에 "무슨 결재인가"(수리 검수 승인)만 적는 것과 같은
 * 갈림이다. "결재선 N단계"는 신청 카드의 결재선 줄이 이미 쓰는 말이고, 결재선을
 * 타지 않는 행(단계 번호가 없는 행)이면 단계 없이 신청자만 적는다.
 *
 * href 는 건별 상세가 아니라 [승인 요청건] 탭이다 — 신청에는 자기만의 상세 화면이
 * 없고, 실제로 승인·반려를 누르는 자리가 그 탭의 「내가 결재할 건」이다.
 *
 * targetKey 는 불출 신청 id 다. 한 신청에 열린 결재는 언제나 하나이고(표의 부분
 * 유니크), 신청 하나가 사람에게도 한 건이다.
 */
export function buildPartIssueApprovalNotification(input: {
  issueRequestId: string;
  /** 그 신청이 향하는 접수 건의 인수번호. 없으면(사용처만 있는 직접 사용 등) `null`. */
  intakeNumber: string | null;
  /** 직접 사용의 사용처. 요청 기반이면 언제나 `null`. */
  destinationNote: string | null;
  /** 몇 번째 단계인가(1부터). 결재선을 타지 않는 행이면 `null`. */
  routeStepOrder: number | null;
  requestedByName: string;
}): NotificationItem {
  const step = input.routeStepOrder !== null ? `결재선 ${input.routeStepOrder}단계 · ` : "";
  return {
    id: `PART_ISSUE_APPROVAL_PENDING:${input.issueRequestId}`,
    kind: "PART_ISSUE_APPROVAL_PENDING",
    targetKey: input.issueRequestId,
    subject: input.intakeNumber ?? input.destinationNote ?? DELETED_REPAIR_CASE_SUBJECT,
    detail: `${step}신청자 ${input.requestedByName}`,
    href: "/inventory/approvals",
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
 * 부품 불출 결재의 이름 — 「부품 불출 승인」.
 *
 * 글자로 새로 적지 않고 결재선 용도 이름표(「부품 불출」)에서 만든다. 절차 화면이
 * 이 용도를 부르는 이름과 알림이 부르는 이름이 한쪽만 바뀌지 않게 하려는 것이다.
 * 접수 건 결재의 이름(「수리 검수 승인」·「최종 출하 승인」)이 승인 체크리스트의
 * LABELS 에서 오는 것과 같은 자리다.
 */
export const PART_ISSUE_APPROVAL_LABEL = `${SHIPMENT_APPROVAL_ROUTE_SCOPE_LABELS.PART_ISSUE} 승인`;

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
 *  · PART_ISSUE — `inventory_part_issue_approvals` 의 한 행(부품 불출 승인). 무엇에
 *    대한 신청인가는 「불출 승인 대기」 알림과 같은 규칙으로 고른다(인수번호 → 사용처
 *    → 삭제된 접수 건). `partRequestId` 가 있으면 요청 기반, 없으면 직접 사용이다.
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
      source: "PART_ISSUE";
      approvalId: string;
      /** 요청 기반 불출이면 그 부품 요청. 직접 사용이면 `null`. */
      partRequestId: string | null;
      intakeNumber: string | null;
      destinationNote: string | null;
    };

/**
 * 알림 키에서 결재 행이 어느 표의 것인지 가르는 짧은 표시. 두 표의 id 가 우연히
 * 겹쳐도(둘 다 uuid 라 실제로는 없다) 키가 겹치지 않게 하고, 키만 보고도 어느 표를
 * 봐야 하는지 알게 한다. 확인 키의 형식(`종류:나머지`, 영숫자·`:`·`-`·`_`)을 지킨다.
 */
const APPROVAL_OUTCOME_KEY_TABLE_TAG: Record<ApprovalOutcomeTarget["source"], string> = {
  REPAIR_CASE: "rca",
  PART_ISSUE: "pia",
};

function approvalOutcomeKeySuffix(target: ApprovalOutcomeTarget): string {
  return `${APPROVAL_OUTCOME_KEY_TABLE_TAG[target.source]}:${target.approvalId}`;
}

function approvalOutcomeSubject(target: ApprovalOutcomeTarget): string {
  if (target.source === "REPAIR_CASE") return target.intakeNumber;
  return target.intakeNumber ?? target.destinationNote ?? DELETED_REPAIR_CASE_SUBJECT;
}

function approvalOutcomeName(target: ApprovalOutcomeTarget): string {
  return target.source === "REPAIR_CASE" ? APPROVAL_TYPE_LABELS[target.approvalType] : PART_ISSUE_APPROVAL_LABEL;
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
 *  · 부품 불출 → [승인 요청건] 탭. 승인이 끝난 신청이 「실행 대기」로 보이는 곳이다.
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
    href: input.source === "REPAIR_CASE" ? repairCaseDetailHrefs(input.repairCaseId).approval : "/inventory/approvals",
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
 *  · 요청 기반 불출 → 부품 요청 관리 목록(반려된 요청을 거기서 다시 불출 신청한다).
 *  · 직접 사용 불출 → 재고 목록(직접 사용은 품목의 [사용]에서 다시 시작한다).
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
    href:
      input.source === "REPAIR_CASE"
        ? repairCaseDetailHrefs(input.repairCaseId).approval
        : input.partRequestId !== null
          ? "/inventory/requests"
          : "/inventory",
  };
}
