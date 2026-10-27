import "server-only";
import { listRepairCasesPendingMyApproval } from "./repair-case-approvals-pending";
import { loadNotificationSettings } from "./notification-settings";
import { deliversNotification } from "@/lib/domain/notification-settings";
import {
  buildApprovalNotification,
  type NotificationItem,
  type NotificationKind,
  buildQuoteApprovalNotification,
  buildApprovalGrantedNotification,
  buildApprovalRejectedNotification,
  buildRepairCaseDueDateNearNotification,
} from "@/lib/domain/notifications";
import type { Role } from "@/lib/domain/types";
import { listQuoteApprovalsPendingMyApproval } from "./quote-approvals-pending";
import { listMyGrantedApprovalOutcomes, listMyRejectedApprovalOutcomes } from "./approval-outcome-notifications";
import { listRepairCasesWithDueDateNear } from "./repair-case-due-date-notifications";
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
 *       충분하다(repair-case-approvals-pending.ts). 견적서 결재 대기도 같은
 *       모양이다 — 결재선 지정(과 최고관리자 비상구)이 조회 안에서 정해진다
 *       (quote-approvals-pending.ts).
 *  (다) **아무도 거르지 않는다** — 납기 임박이 그렇다. 조회는 "지금 납기가
 *       다가온 건 전부"라 누가 봐도 같은 결과인데, **받을 사람을 가를 축이
 *       없다**: 납기가 다가온 건은 엔지니어·관리자·영업에게 각자 다른 모양으로
 *       걸린다(2026-10-19 사용자 결정 — 모두에게). 그래서 load 가 사용자 id 도
 *       역할도 받지 않는다. 좁히는 일은 알림 설정 화면이 한다 — 아래 「설정은
 *       윗단 필터다」 절 그대로다.
 *
 * 🔴 **(나)형은 지금 하나도 없다 — 번호를 다시 매기지 않았다.** (나)는 「load 가
 *    **역할로** 먼저 걸러, 자격 없는 사람 앞에서는 그 조회가 아예 돌지 않는다」는
 *    모양이고, 표본이 부품 요청 대기 · 재고 부족 둘뿐이었다. 그 셋(불출 승인 대기
 *    포함)을 2026-10-27(조각 13-C4)에 걷어내면서 자리가 비었다. 🔵 번호를 (가)·(나)
 *    로 당기지 않는 까닭은 이 저장소의 다른 주석 여럿이 「(나)형」이라는 말로 이
 *    모양을 가리키고 있어서다 — 역할로 거르는 종류를 다시 붙일 때 그대로 쓴다.
 *    그때 쓸 본보기: 조회를 부르기 **전에** 역할을 보고 아니면 빈 배열로 끝낸다
 *    (걸러 내는 것이 아니라 아예 읽지 않는 쪽이 인가 경계로도 맞다).
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
 *  4. domain/notification-settings.ts의 NOTIFICATION_KIND_META에 이름·설명·색을
 *     채우고,
 *  5. 같은 파일의 defaultNotificationKindEnabled·defaultRoleReceivesNotification
 *     에 case 를 더한다. 🔴 4·5를 빠뜨리면 기본값이 false로 떨어져 **등록해 두고
 *     한 줄도 안 뜨는** 종류가 된다(두 함수의 default 절). 빠뜨림 자체는
 *     domain/notification-settings.test.ts가 곧바로 잡는다.
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
    kind: "QUOTE_APPROVAL_PENDING",
    load: async (actorUserId) => {
      // 결재 요청·불출 승인 대기와 같은 모양 (가) — 대상이 역할이 아니라 **사람**이다.
      // 역할로 먼저 거르지 않는다: 결재선에는 역할 제한 없이 누구든 올라갈 수 있어서
      // (listSelectableApproverCandidates), 여기서 역할을 보는 순간 자기 차례인
      // 결재자가 알림을 못 받는다. 결재를 실제로 막는 decideQuoteApproval 도 같은
      // 이유로 권한 영역을 묻지 않는다(mutations/quote-approvals.ts 머리말).
      //
      // 판정도 새로 적지 않는다 — 지정 관문(지정된 사람 + 최고관리자 비상구)을 그대로
      // 쓰는 조회 하나를 부르고, 여기서 하는 일은 모양 변환뿐이다.
      const pending = await listQuoteApprovalsPendingMyApproval(actorUserId);
      return pending.map((item) =>
        buildQuoteApprovalNotification({
          quoteId: item.quoteId,
          quoteNumber: item.quoteNumber,
          routeStepOrder: item.routeStepOrder,
          requestedByName: item.requestedByName,
        })
      );
    },
  },
  {
    kind: "REPAIR_CASE_DUE_DATE_NEAR",
    load: async () => {
      // 🔴 역할로 거르지 않는다 — **모두에게 간다**(2026-10-19 사용자 결정).
      // 「지금 상태가 그러한 건 전부」를 내놓는 조회라는 점은 걷어낸 재고 부족
      // 알림과 같았지만, 그쪽은 재고를 채울 사람이 정해져 있어 조회를 부르기
      // 전에 역할을 보는 (나)형이었다(이 파일 머리말의 빈 자리). 납기가 다가온
      // 건은 엔지니어·관리자·영업에게 각자 다른 모양으로 걸려 가를 축이 없다.
      // 그래서 load 가 역할을 **받지도** 않는다. 좁히고 싶으면 알림 설정 화면에서
      // 역할 스위치를 끈다(윗단 필터 — 이 파일 머리말).
      //
      // 「무엇을 알릴 것인가」도 여기서 정하지 않는다 — 화면이 쓰는 그 함수로
      // 날짜를 구하고 창·출하 완료·휴지통을 거르는 일은 전부 저 조회 안에 있다
      // (queries/repair-case-due-date-notifications.ts). 여기서 하는 일은 모양
      // 변환뿐이다.
      const soon = await listRepairCasesWithDueDateNear();
      return soon.map((row) =>
        buildRepairCaseDueDateNearNotification({
          repairCaseId: row.repairCaseId,
          intakeNumber: row.intakeNumber,
          dueDate: row.dueDate,
          borrowed: row.borrowed,
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
  // 건드리지도 않는다(머리말 (나)형의 자리가 원래 쓰던 방식과 같다).
  const delivered = NOTIFICATION_SOURCES.filter((source) =>
    deliversNotification(source.kind, actorRole, settings)
  );
  const perKind = await Promise.all(delivered.map((source) => source.load(actorUserId, actorRole)));
  return perKind.flat();
}
