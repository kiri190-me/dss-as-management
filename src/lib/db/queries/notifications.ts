import "server-only";
import { listRepairCasesPendingMyApproval } from "./repair-case-approvals-pending";
import { buildApprovalNotification, type NotificationItem, type NotificationKind } from "@/lib/domain/notifications";

/**
 * ============================================================================
 * 종 알림 레지스트리 — 알림 "종류"를 등록해 두는 곳
 * ============================================================================
 * 이 파일에는 SQL이 없다. 각 종류는 **이미 있는 조회**를 부르고, 그 결과를
 * 화면이 아는 단 하나의 모양(NotificationItem)으로 바꿔 놓기만 한다. 인가
 * 판정도 여기서 하지 않는다 — 부르는 조회가 서버에서 스스로 한다
 * (repair-case-approvals-pending.ts의 역할/대표 자격·위임 판정).
 *
 * ── 종류를 하나 더 붙이려면 ────────────────────────────────────────────
 *  1. domain/notifications.ts의 NOTIFICATION_KINDS에 키를 추가하고
 *  2. 그 종류를 NotificationItem으로 바꾸는 순수 build 함수를 같은 파일에 두고
 *  3. 아래 NOTIFICATION_SOURCES에 { kind, load } 하나를 더 넣는다.
 * 화면(NotificationBell)은 손대지 않는다. 그것이 이 구조의 목적이다.
 *
 * 다만 종류를 늘리는 일은 UI 작업이 아니라 **"이 알림을 누구에게 보여도
 * 되는가"를 판정하는 작업**이다. 부품 요청·가입 승인 대기처럼 대상이 넓은
 * 것들은 그 판정을 새로 세운 뒤에 등록한다.
 *
 * ── 같은 조회를 한 화면에서 두 번 돌리지 않는다 ────────────────────────
 * 사이드바 결재 배지와 종 알림은 같은 조회(listRepairCasesPendingMyApproval)를
 * 원본으로 쓴다. 그래서 (app)/layout.tsx는 이 함수를 **한 번만** 부르고,
 * 배지 숫자는 그 결과에서 countNotificationTargetsByKind로 뽑아 쓴다. 배지가
 * 따로 count 조회를 부르면 모든 페이지 로드마다 같은 조회가 두 번 돈다.
 * ============================================================================
 */

type NotificationSource = {
  kind: NotificationKind;
  /** 이 사용자에게 지금 보여야 할 그 종류의 알림 전부. */
  load: (actorUserId: string) => Promise<NotificationItem[]>;
};

const NOTIFICATION_SOURCES: readonly NotificationSource[] = [
  {
    kind: "REPAIR_CASE_APPROVAL",
    load: async (actorUserId) => {
      // 새 조회를 만들지 않는다 — 사이드바 배지가 이미 쓰고 있고 통합 테스트로
      // 검증된 조회를 그대로 부른다. 여기서 하는 일은 모양 변환뿐이다.
      const pending = await listRepairCasesPendingMyApproval(actorUserId);
      return pending.map((item) =>
        buildApprovalNotification({
          repairCaseId: item.repairCaseId,
          intakeNumber: item.intakeNumber,
          approvalType: item.approvalType,
        })
      );
    },
  },
];

/**
 * 지금 로그인한 사람이 처리해야 할 일 전부. 등록된 종류를 모두 돌며 모은다.
 *
 * 인자는 서버가 세션에서 푼 사용자 id 하나뿐이다 — 다른 사람의 알림을 요구할
 * 수 있는 입구가 없다.
 */
export async function listMyNotifications(actorUserId: string): Promise<NotificationItem[]> {
  const perKind = await Promise.all(NOTIFICATION_SOURCES.map((source) => source.load(actorUserId)));
  return perKind.flat();
}
