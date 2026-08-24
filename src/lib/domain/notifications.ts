/**
 * ============================================================================
 * 종 알림 — 저장하지 않고 그때그때 파생시키는 "지금 내가 처리할 일"
 * ============================================================================
 * 알림 테이블이 없다. 알림 행을 따로 쌓지 않고, 이미 있는 업무 데이터에서 매
 * 요청마다 다시 계산한다.
 *
 * 그래도 되는 이유는 이번에 담는 것이 **행동을 요구하는 알림**뿐이기 때문이다.
 * 결재를 처리하면 그 건은 다음 조회에서 저절로 빠진다 — 사라지게 만드는 것이
 * 처리 그 자체라서 "읽음" 표시를 따로 저장할 것이 없다. (반대로 "무슨 일이
 * 있었다"는 정보성 알림은 읽어도 사라지지 않으므로 읽음 상태를 어딘가 적어
 * 둬야 한다. 그런 종류가 실제로 필요해질 때 저장 테이블을 붙인다.)
 *
 * 이 파일은 순수 계산만 한다 — DB도, server-only도 여기 들어오지 않는다.
 * 화면(NotificationBell)과 서버 조회(db/queries/notifications.ts)가 **같은
 * 모양과 같은 세는 규칙**을 쓰게 하려고 가운데에 둔 것이고, 그래서 Node
 * 단위 테스트로 그대로 돌아간다.
 * ============================================================================
 */

import { LABELS as APPROVAL_TYPE_LABELS, type ShipmentApprovalType } from "./local/workflow/shipment-approval-checklist";
import { repairCaseDetailHrefs } from "./repair-case-detail-tabs";

/**
 * 등록된 알림 종류. 새 종류를 붙일 때 손대는 곳은 이 배열과
 * `db/queries/notifications.ts`의 소스 목록 둘뿐이고, 화면은 고치지 않는다 —
 * NotificationItem 한 모양만 그리기 때문이다.
 */
export const NOTIFICATION_KINDS = ["REPAIR_CASE_APPROVAL"] as const;

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
