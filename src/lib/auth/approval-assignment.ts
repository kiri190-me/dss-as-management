import { actorHasAllowedRole, type PromotableActor } from "./developer-promotion";

/**
 * ============================================================================
 * 「이 결재 요청을 누가 처리할 수 있는가」 — 지정 관문 하나
 * ============================================================================
 *
 * `repair_case_approvals.assigned_approver_user_id` 한 칸의 뜻을 판정하는
 * 함수다. **화면·서버 액션·mutation·알림 조회가 전부 이 함수 하나를 본다.**
 * 판정을 두 곳에 적으면 「단추는 보이는데 누르면 거절」이나 그 반대가 되고,
 * 후자는 화면에 아무 표시도 남기지 않아 더 나쁘다.
 *
 * ── 규칙 ────────────────────────────────────────────────────────────────
 *  - 지정이 NULL → **참**. 「지정 없음」은 정상값이고, 이 칸이 생기기 전과
 *    완전히 같은 동작을 뜻한다(자격 있는 사람 누구나 처리).
 *  - 지정이 나 자신 → 참.
 *  - 내가 최고관리자 → 참. 지정된 사람이 자리를 비워 영영 막히는 것을 막는
 *    비상구다.
 *  - 그 밖 → 거짓.
 *
 * ── 🔴 이 함수는 「자격이 있는가」를 보지 않는다 ─────────────────────────
 * 역할·계정 상태(승인됨·활성·잠기지 않음·삭제 안 됨)를 보는 것은 이미 있는
 * 검사들이고, 이 함수는 그 **다음** 관문이다. 순서가 중요하다:
 *
 *     자격 검사(먼저)  →  이 함수(나중)
 *
 * 반대로 두거나 이 함수 안으로 자격을 끌어들이면, **지정이 권한을 만들어
 * 낸다.** 자격 없는 사람을 지정해도 그 사람이 결재할 수 있게 되는 것이다.
 * 지정은 「자격 있는 사람들 중 누구」를 좁히는 것이지, 자격을 주는 것이 아니다.
 *
 * ── 최고관리자 판정을 직접 비교하지 않는 이유 ───────────────────────────
 * `actorHasAllowedRole(actor, ["SUPER_ADMIN"])`(developer-promotion.ts)로만
 * 본다. 개발자 표시(`users.is_developer`)가 켜진 계정은 역할 문자열이
 * SUPER_ADMIN 이 아니어도 최고관리자 권한을 더해 받는데, 그 규칙은 그 함수
 * 안에만 있다. `role === "SUPER_ADMIN"` 으로 적으면 개발자 계정이 조용히
 * 막힌다.
 *
 * ── 이름이 승인 종류를 가리지 않는 이유 ─────────────────────────────────
 * 최종 출하 승인의 순차 승인(여러 명이 차례로)도 같은 칸으로 푼다 — 단계마다
 * 요청 행을 하나씩 만들고 그 행의 지정된 사람이 그 단계의 승인자가 된다.
 * 「검수 전용」 이름으로 지으면 그때 함수를 하나 더 만들게 되고, 그 순간 위의
 * 「한 곳에서만 판정한다」가 깨진다.
 * ============================================================================
 */

/** 지정이 걸려 있어도 언제나 처리할 수 있는 역할 — 비상구 하나뿐이다. */
const ASSIGNMENT_OVERRIDE_ROLES = ["SUPER_ADMIN"] as const;

/**
 * 지정 관문을 통과하는가. **자격 검사를 통과한 뒤에** 부른다(위 주석 참조).
 *
 * @param assignedApproverUserId 요청 행의 지정 승인자. `null` 은 「지정 없음」.
 * @param actor 지금 처리하려는 사람. `id` 와 역할 승격에 필요한 값만 본다.
 */
export function mayDecideAssignedApproval(
  assignedApproverUserId: string | null,
  actor: { id: string } & PromotableActor<string>
): boolean {
  if (assignedApproverUserId === null) return true;
  if (assignedApproverUserId === actor.id) return true;
  return actorHasAllowedRole(actor, ASSIGNMENT_OVERRIDE_ROLES);
}

/**
 * 결재선(shipment_approval_routes)을 판정하는 데 필요한 요청 행의 두 칸.
 * 행 전체가 아니라 이 모양만 받으므로 조회·화면·mutation 이 각자 들고 있는
 * 서로 다른 행 타입을 그대로 넘길 수 있다.
 */
export type RouteFollowingApprovalRow = {
  routeId: string | null;
  assignedApproverUserId: string | null;
};

/**
 * 이 요청 행이 **결재선을 타는가** — 「누가 결재하는가」를 절차가 정하는가.
 *
 * 🔴 판정을 세 곳(mutation · 알림 조회 · 승인 카드)이 본다. 그래서 이 파일
 * 머리말의 이유 그대로 여기 한 곳에만 적는다 — 두 곳에 적으면 「단추는 보이는데
 * 누르면 거절」이나 그 반대가 되고, 후자는 화면에 아무 표시도 남기지 않는다.
 *
 * 참이면 대표·위임 판정을 건너뛰고 지정 관문(mayDecideAssignedApproval) 하나만
 * 본다 — 절차가 「출하 대표」를 **대신하는** 것이 이 기능의 설계다.
 *
 * ── 🔴 판만 보지 않고 **지정까지 함께** 보는 이유 ───────────────────────
 * 지정이 비어 있으면 결재선 경로로 보지 않는다. 요청 경로는 판 단계를 넣을 때
 * 지정을 언제나 함께 채우므로 정상적으로는 생기지 않는 조합이고, 만에 하나 그런
 * 행이 있어도 **넓어지는 쪽이 아니라 지금까지의 대표·위임 판정으로 되돌아간다**
 * — 판만 적히고 사람이 빈 행을 결재선으로 보면 대표 검사도 지정 검사도 없어져
 * 자격 있는 사람 아무나 결재하게 되기 때문이다.
 */
export function approvalFollowsRoute(row: RouteFollowingApprovalRow): boolean {
  return row.routeId !== null && row.assignedApproverUserId !== null;
}

/**
 * 이 사람이 **지정된 사람을 대신하고 있는가** — 지정이 걸린 자리에 다른 사람이
 * 서 있는가.
 *
 * 🔴 두 곳이 같은 물음을 묻는다. 시제만 다르다:
 *  - 승인 이력: 「지정은 김도윤인데 **처리한 사람**이 최희만이었다」 → 배지
 *  - 승인 카드: 「지정은 김도윤인데 **지금 보고 있는 사람**이 최희만이다」 → 안내
 * 그래서 파일 머리말의 이유 그대로 판정을 여기 한 곳에만 적는다. 두 곳에 적으면
 * 이력에는 대신 처리했다고 남는데 카드는 아무 말도 안 하는(또는 그 반대) 어긋남이
 * 생기고, 결재 기록에서 그 어긋남은 「누가 승인했지」를 되짚을 때 드러난다.
 *
 * ── 🔴 이 함수는 「그래도 되는가」를 보지 않는다 ─────────────────────────
 * 대신 설 수 있는지는 mayDecideAssignedApproval 이 판정한다. 이 함수는 **이미
 * 일어난(또는 일어나려는) 일의 모양**만 말한다 — 참이라고 해서 허용된다는 뜻이
 * 아니고, 거짓이라고 해서 막힌다는 뜻도 아니다.
 *
 * @param assignedApproverUserId 요청 행의 지정 승인자. `null` 이면 대신할 자리가
 *   애초에 없으므로 거짓이다 — 「지정 없음」은 정상값이고, 그때는 자격 있는
 *   사람 누구나 자기 자격으로 처리한다.
 * @param userId 그 자리에 서 있는 사람. 아직 처리되지 않은 행의 처리자처럼
 *   `null` 일 수 있고, 그때도 거짓이다(비교할 사람이 없다).
 */
export function standsInForAssignedApprover(
  assignedApproverUserId: string | null,
  userId: string | null
): boolean {
  if (assignedApproverUserId === null) return false;
  if (userId === null) return false;
  return assignedApproverUserId !== userId;
}
