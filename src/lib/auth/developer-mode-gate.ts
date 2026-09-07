import type { AccountApprovalStatus, Role } from "@/lib/domain/types";

/**
 * ============================================================================
 * 개발자 모드 관문 — **개발자 표시 자체를 묻는 유일한 자리**
 * ============================================================================
 * 뜻은 한 줄이다:
 *
 *     승인된 계정이고, 최고관리자이거나 개발자 표시가 켜져 있다
 *
 * ── 🔴 왜 actorMay 를 쓰지 않는가 ───────────────────────────────────────────
 * `actorMay`(developer-promotion.ts)는 「**최고관리자와 동급의 권한**이 필요한
 * 일을 해도 되는가」를 묻는 창구다. 지금 이 자리의 질문은 그것과 다르다 —
 * 「이 사람이 **개발자냐**」다. 개발자가 최고관리자 권한을 갖기 때문에 지금은
 * 두 답이 우연히 같지만, 뜻이 다르므로 섞지 않는다. 섞어 두면 승격 규칙을
 * 손보는 날 이 관문이 함께 움직인다 — 더미 데이터와 배포 도구를 다루게 될
 * 화면의 문이 다른 변경에 딸려 열리는 것은 있어서는 안 된다.
 *
 * 같은 이유로 `DEVELOPER_PROMOTED_ROLE` 도 부르지 않고 "SUPER_ADMIN" 을 그대로
 * 적는다. 그 상수는 「개발자를 어느 역할로 승격하는가」이고, 여기서 묻는 것은
 * 「누가 개발자 화면에 들어가는가」다.
 *
 * ── 🔴 왜 역할별 접근 권한 설정에 없는가 ────────────────────────────────────
 * 그 설정 화면의 **존재 목적이 「접근을 넓히는 것」**이다. 개발자 모드를 그
 * 목록(PERMISSION_AREAS)에 넣으면 최고관리자가 A/S 엔지니어나 영업 담당자에게
 * 개발자 모드를 열어 줄 수 있게 된다. 그래서 이 항목은 영역 목록에 없고
 * (`listAccessibleAreaKeys` 가 절대 돌려주지 않는다), 대신 이 함수 하나가
 * 사이드바·모바일 드로어·페이지 가드 세 곳의 답을 함께 정한다.
 *
 * ── 승인 상태를 반드시 본다 ─────────────────────────────────────────────────
 * 승인은 승격 대상이 아니다(developer-flag.test.ts 의 같은 판단). 승인되지 않은
 * 계정은 개발자 표시가 켜져 있어도 들어가지 못한다.
 * ============================================================================
 */

/** 개발자 모드의 메뉴 열쇠 = 라우트 한 곳. 문자열을 두 번 적지 않기 위한 상수다. */
export const DEVELOPER_MODE_NAV_KEY = "developerMode";

/**
 * 관문이 보는 것 — 역할·개발자 표시·승인 상태. `ActingUser` 가 그대로 들어맞는다
 * (구조적 타입).
 *
 * 역할 타입을 넓혀 둔 이유는 `PromotableActor` 와 같다 — prop 을 `role: string`
 * 으로 받는 화면에서도 같은 창구를 쓸 수 있게 한다.
 */
export type DeveloperModeActor<R extends string = Role> = {
  role: R;
  isDeveloper: boolean;
  approvalStatus: AccountApprovalStatus;
};

/** 이 사람이 개발자 모드에 들어갈 수 있는가. 이 질문의 답은 여기 한 곳에서만 나온다. */
export function mayEnterDeveloperMode(actor: DeveloperModeActor<string>): boolean {
  if (actor.approvalStatus !== "APPROVED") return false;
  return actor.role === "SUPER_ADMIN" || actor.isDeveloper;
}
