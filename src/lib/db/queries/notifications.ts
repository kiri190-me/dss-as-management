import "server-only";
import { listRepairCasesPendingMyApproval } from "./repair-case-approvals-pending";
import { getPendingPartRequestsForNotification } from "./inventory-part-requests";
import { listPartsBelowMinimumQuantity } from "./part-minimum-quantities";
import { canReceivePartRequestNotifications } from "@/lib/auth/inventory-authorization";
import { loadNotificationSettings } from "./notification-settings";
import { canReceiveLowStockNotifications, deliversNotification } from "@/lib/domain/notification-settings";
import {
  buildApprovalNotification,
  buildPartStockBelowMinimumNotification,
  buildPendingPartRequestNotification,
  type NotificationItem,
  type NotificationKind,
  buildCustomerRepairRequestNotification,
  buildPartIssueApprovalNotification,
  buildApprovalGrantedNotification,
  buildApprovalRejectedNotification,
} from "@/lib/domain/notifications";
import type { Role } from "@/lib/domain/types";
import { canReceiveCustomerRepairRequestNotifications } from "@/lib/auth/customer-portal-authorization";
import { listNewCustomerRepairRequests } from "./customer-portal";
import { listPartIssueRequestsPendingMyApproval } from "./inventory-part-issue-requests";
import { listMyGrantedApprovalOutcomes, listMyRejectedApprovalOutcomes } from "./approval-outcome-notifications";
import { listAcknowledgedNotificationKeys } from "./notification-acknowledgements";

/**
 * ============================================================================
 * 종 알림 레지스트리 — 알림 "종류"를 등록해 두는 곳
 * ============================================================================
 * 이 파일에는 SQL이 없다. 각 종류는 **이미 있는 조회**를 부르고, 그 결과를
 * 화면이 아는 단 하나의 모양(NotificationItem)으로 바꿔 놓기만 한다.
 *
 * ── 인가 판정은 두 가지 모양 중 하나다 ─────────────────────────────────
 *  (가) 부르는 조회가 스스로 판정한다 — 결재 알림이 그렇다. 누가 결재자인지가
 *       사람 단위(대표 자격·위임)라 SQL 안에서 정해지고, 사용자 id 하나면
 *       충분하다(repair-case-approvals-pending.ts). 불출 승인 대기도 같은 모양이다
 *       — 결재선 지정(과 최고관리자 비상구)이 조회 안에서 정해진다
 *       (inventory-part-issue-requests.ts).
 *  (나) load가 **역할로** 먼저 거른다 — 부품 요청 알림이 그렇다. 대상이 사람이
 *       아니라 역할이고, 조회 자체는 "지금 처리 대기 중인 요청 전부"라 누가
 *       봐도 같은 결과다. 그래서 조회를 부르기 **전에** 역할을 보고, 아니면
 *       빈 배열로 끝낸다 — 권한 없는 사람 앞에서 그 조회는 아예 돌지 않는다.
 * 판정 자체는 이 파일이 쓰지 않는다. auth/inventory-authorization.ts의 순수
 * 함수를 부른다(화면·mutation이 쓰는 그 파일).
 *
 * 결재 결과(승인 완료·반려됨)도 (가)형이다 — 대상이 **요청자 본인**이고, 조회가
 * `requested_by_user_id = 나` 로 스스로 좁힌다(approval-outcome-notifications.ts).
 *
 * ── 눌러서 확인하는 종류는 확인 기록을 뺀다 ────────────────────────────
 * 할 일 알림은 처리하면 저절로 사라지지만, 결재 결과는 알려 주는 것이라 사람이
 * 눌러 확인해야 사라진다. 그 두 종류의 load 만 마지막에 확인 기록
 * (listAcknowledgedNotificationKeys — 언제나 이 사람 것만)을 대 보고 확인한 키를
 * 뺀다(withoutAcknowledged). 할 일 알림에는 대 보지 않는다 — 대 보면 처리하지 않은
 * 일을 「확인」으로 숨기는 길이 생긴다(적는 쪽 문도 그 키를 거절한다:
 * domain/notification-acknowledgement.ts).
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
 *
 * 알림 설정 조회도 같은 규율을 따른다 — listMyNotifications가 **한 번 읽어**
 * 모든 종류에 쓴다. 종류마다 부르면 종류가 늘어날수록 같은 조회가 그만큼 는다.
 *
 * ── 설정은 윗단 필터다 ─────────────────────────────────────────────────
 * `사용자 관리 › 알림 설정`이 정한 값(종류 켜기·끄기, 역할별 받기·안 받기)은
 * 아래 load를 부를지 말지만 정한다. 각 종류의 원래 판정 — 결재 알림이라면
 * "그 사람이 그 건의 결재자인가" — 은 종전 그대로 그 조회 안에 남아 있고,
 * **둘 다 참이어야** 알림이 간다. 설정을 넓게 열어도 남의 결재 건이 보이지
 * 않는다는 뜻이다. 자세한 근거는 domain/notification-settings.ts 머리말에 있다.
 *
 * 저장된 설정이 하나도 없으면 코드의 기본값이 답하고, 그 기본값은 이 화면을
 * 만들기 전의 규칙 그대로다 — 아무도 설정을 만지지 않은 상태에서는 동작이
 * 한 줄도 달라지지 않는다.
 * ============================================================================
 */

type NotificationSource = {
  kind: NotificationKind;
  /** 이 사용자에게 지금 보여야 할 그 종류의 알림 전부. */
  load: (actorUserId: string, actorRole: Role) => Promise<NotificationItem[]>;
};

/**
 * 이 사람이 이미 눌러 확인한 알림을 뺀다 — 눌러서 확인하는 종류의 load 끝에서만
 * 부른다(파일 머리말).
 *
 * 확인 기록은 언제나 **이 사람 것만** 읽는다(listAcknowledgedNotificationKeys 가
 * user_id 로 좁힌다). 같은 키를 남이 확인했다고 내 알림이 사라지면 안 된다. 지금
 * 띄우려는 알림의 키로만 묻고, 띄울 것이 없으면 DB 를 부르지 않는다.
 */
async function withoutAcknowledged(actorUserId: string, items: NotificationItem[]): Promise<NotificationItem[]> {
  if (items.length === 0) return items;
  const acknowledged = await listAcknowledgedNotificationKeys(
    actorUserId,
    items.map((item) => item.id)
  );
  return acknowledged.size === 0 ? items : items.filter((item) => !acknowledged.has(item.id));
}

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
  {
    kind: "PART_REQUEST_PENDING",
    load: async (_actorUserId, actorRole) => {
      // 역할 판정이 먼저다. 이 조회는 사용자별로 결과가 달라지지 않으므로
      // (처리 대기 중인 요청 전부), 자격이 없으면 부르지 않고 끝낸다 —
      // 걸러내는 것이 아니라 아예 읽지 않는 쪽이 인가 경계로도 맞고, 요청
      // 화면에 못 들어가는 사람 앞에서 DB를 건드리지도 않는다.
      //
      // 이 함수의 답이 알림 설정의 **기본값**이다
      // (domain/notification-settings.ts의 defaultRoleReceivesNotification).
      // 설정이 앞에서 이미 같은 판정을 했더라도 여기를 지우지 않는다 — 이
      // 조회를 부르는 자리가 나중에 늘었을 때 인가 경계가 설정 한 곳에만
      // 남아 있으면 안 된다.
      if (!canReceivePartRequestNotifications(actorRole)) return [];

      const pending = await getPendingPartRequestsForNotification();
      return pending.map((row) =>
        buildPendingPartRequestNotification({
          requestId: row.id,
          intakeNumber: row.intakeNumber,
          requestedByName: row.requestedByName,
        })
      );
    },
  },
  {
    kind: "PART_STOCK_BELOW_MINIMUM",
    load: async (_actorUserId, actorRole) => {
      // 부품 요청 알림과 같은 모양 (나) — 대상이 사람이 아니라 역할이고, 조회
      // 자체는 "지금 한계 밑으로 떨어진 것 전부"라 누가 봐도 같은 결과다.
      // 그래서 조회를 부르기 **전에** 역할을 본다. 판정 함수를 따로 둔 이유는
      // domain/notification-settings.ts 머리말에 있다(부품 요청과 명단은 같지만
      // 같은 질문이 아니다).
      if (!canReceiveLowStockNotifications(actorRole)) return [];

      // 한계수량이 정해진 짝만 돌아온다 — 아무도 한계수량을 정하지 않았다면 이
      // 조회는 빈 목록이고, 이 종류는 한 줄도 뜨지 않는다.
      const shortages = await listPartsBelowMinimumQuantity();
      return shortages.map((row) =>
        buildPartStockBelowMinimumNotification({
          partId: row.partId,
          partName: row.partName,
          owner: row.owner,
          currentQuantity: row.currentQuantity,
          minimumQuantity: row.minimumQuantity,
        })
      );
    },
  },
  {
    kind: "CUSTOMER_REPAIR_REQUEST_NEW",
    load: async (_actorUserId, actorRole) => {
      // 부품 요청·재고 부족과 같은 모양 — 대상이 사람이 아니라 역할이고,
      // 조회 자체는 "아직 처리 안 한 의뢰 전부"라 누가 봐도 결과가 같다.
      // 그래서 조회를 부르기 **전에** 역할을 본다.
      if (!canReceiveCustomerRepairRequestNotifications(actorRole)) return [];

      const pending = await listNewCustomerRepairRequests();
      return pending.map((row) =>
        buildCustomerRepairRequestNotification({
          requestId: row.id,
          customerName: row.customerName,
          productModelName: row.productModelName,
          serialNumber: row.serialNumber,
        })
      );
    },
  },
  {
    kind: "PART_ISSUE_APPROVAL_PENDING",
    load: async (actorUserId) => {
      // 결재 알림과 같은 모양 (가) — 대상이 역할이 아니라 **사람**이다. 그래서 역할로
      // 먼저 거르지 않는다: 결재선에는 역할 제한 없이 누구든 올라갈 수 있어서, 여기서
      // 역할을 보는 순간 자기 차례인 결재자가 알림을 못 받는다.
      //
      // 판정도 새로 적지 않는다 — [승인 요청건] 탭의 「내가 결재할 건」이 쓰는 바로
      // 그 조회다(지정된 사람 + 최고관리자 비상구, 지금 열린 단계만). 알림과 목록이
      // 서로 다른 말을 하면 안 된다. 여기서 하는 일은 모양 변환뿐이다.
      const pending = await listPartIssueRequestsPendingMyApproval(actorUserId);
      return pending.map((item) =>
        buildPartIssueApprovalNotification({
          issueRequestId: item.issueRequestId,
          intakeNumber: item.intakeNumber,
          destinationNote: item.destinationNote,
          routeStepOrder: item.routeStepOrder,
          requestedByName: item.requestedByName,
        })
      );
    },
  },
  {
    kind: "APPROVAL_GRANTED",
    load: async (actorUserId) => {
      // (가)형 — 대상이 역할이 아니라 **요청자 본인**이다. 역할로 먼저 거르지 않는다:
      // 결재를 요청하는 사람은 역할이 여럿이고, 받는 사람은 조회가
      // `requested_by_user_id = 나` 로 이미 정한다. 여기서 하는 일은 모양 변환과
      // 확인한 것 빼기뿐이다.
      const outcomes = await listMyGrantedApprovalOutcomes(actorUserId);
      return withoutAcknowledged(
        actorUserId,
        outcomes.map((outcome) => buildApprovalGrantedNotification(outcome))
      );
    },
  },
  {
    kind: "APPROVAL_REJECTED",
    load: async (actorUserId) => {
      // 승인 완료와 같은 모양이다 — 요청자 본인, 역할로 거르지 않는다, 확인한 것은 뺀다.
      const outcomes = await listMyRejectedApprovalOutcomes(actorUserId);
      return withoutAcknowledged(
        actorUserId,
        outcomes.map((outcome) => buildApprovalRejectedNotification(outcome))
      );
    },
  },
];

/**
 * 지금 로그인한 사람이 처리해야 할 일 전부(와, 아직 확인하지 않은 내 결재의 결과).
 * 등록된 종류를 모두 돌며 모은다. 종류를 섞어 다시 세우지 않는다 — 아래 소스 순서
 * 대로 종류별 묶음이 이어 붙는다.
 *
 * 인자는 서버가 세션에서 푼 사용자 id와 역할뿐이다 — 다른 사람의 알림을
 * 요구할 수 있는 입구가 없다. 역할도 부르는 쪽이 넘겨 주지만, 그 값은
 * (app)/layout.tsx가 세션 토큰이 아니라 **살아 있는 계정**에서 다시 푼
 * 것이다(resolveActingUserForSession) — 토큰에 박힌 옛 역할이 아니다.
 */
export async function listMyNotifications(actorUserId: string, actorRole: Role): Promise<NotificationItem[]> {
  // 설정은 여기서 딱 한 번 읽는다 — 종류마다 읽으면 종류 수만큼 같은 조회가
  // 돈다(이 파일 머리말). 표가 아직 없는 DB에서는 기본값이 답한다.
  const settings = await loadNotificationSettings();

  // 걸러진 종류는 load를 **부르지 않는다**. 결과를 받아 버리는 것이 아니라
  // 아예 읽지 않는 쪽이 맞다 — 알림에서 뺀 사람 앞에서 그 조회가 DB를
  // 건드리지도 않는다(PART_REQUEST_PENDING이 원래 쓰던 방식과 같다).
  const delivered = NOTIFICATION_SOURCES.filter((source) =>
    deliversNotification(source.kind, actorRole, settings)
  );
  const perKind = await Promise.all(delivered.map((source) => source.load(actorUserId, actorRole)));
  return perKind.flat();
}
