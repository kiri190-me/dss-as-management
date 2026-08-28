import type { Role } from "@/lib/domain/types";
import { canManageRolePermissions } from "./role-permission-authorization";

/**
 * 고객 안내 창구의 권한 판정.
 *
 * 다른 *-authorization.ts와 같은 관례를 따른다: Role만 보는 순수 함수이고,
 * 페이지와 서버 액션이 각자 독립적으로 다시 검사한다.
 *
 * ── 질문을 셋으로 나눈 이유 ─────────────────────────────────────────────
 * 지금은 답이 겹치는 것도 있지만, 세 가지는 위험의 크기가 다르다:
 *
 *  보기      고객이 무엇을 보는지 확인한다. 위험이 없다.
 *  안내 정하기  **고객 화면에 곧바로 나가는 글**을 정한다. 잘못 적으면 회사 밖에
 *            그대로 뜬다.
 *  링크 관리   **주소를 발급·회수**한다. 발급은 그 회사의 A/S 현황 전체를 볼 수
 *            있는 열쇠를 만드는 일이고, 회수는 고객이 쓰던 주소를 끊는 일이다.
 *
 * 한 함수로 합쳐 두면 나중에 "영업도 안내 문구는 적게 하되 링크는 못 만들게"
 * 같은 요구가 왔을 때 고칠 자리가 없다.
 */

/** 고객 안내 현황 화면을 볼 수 있는가. */
export function canViewCustomerPortal(role: Role): boolean {
  // 접수를 만들 수 있는 역할이면 고객에게 뭐라고 안내되는지도 볼 수 있어야
  // 한다 — 전화를 받는 사람과 접수를 넣는 사람이 같기 때문이다.
  return (
    role === "SUPER_ADMIN" ||
    role === "ADMIN" ||
    role === "AS_ENGINEER" ||
    role === "SALES"
  );
}

/** 고객에게 보이는 상태와 비고를 정할 수 있는가. */
export function canEditCustomerStatus(role: Role): boolean {
  // 보는 사람과 같다. 이 값은 담당 엔지니어가 물건을 보고 적는 것이 가장
  // 정확하고, 그 사람이 못 적으면 결국 아무도 안 적어 화면이 `-`로 남는다.
  return canViewCustomerPortal(role);
}

/**
 * 고객사 주소를 발급·회수할 수 있는가 — **관리자 이상.**
 *
 * 발급은 그 고객사의 A/S 현황 전체를 볼 수 있는 열쇠를 만드는 일이다. 주소
 * 하나가 곧 권한이고, 한번 나가면 회수 전까지 누구에게 전달됐는지 우리가 알
 * 수 없다. 그래서 여기만 좁게 둔다.
 */
export function canManageCustomerLinks(role: Role): boolean {
  return canManageRolePermissions(role);
}

/**
 * 고객 안내 상태 목록(설정)을 관리할 수 있는가 — **관리자 이상.**
 *
 * 여기서 정한 말이 그대로 고객 화면에 뜬다. 목록을 아무나 늘리면 비슷한 말이
 * 여럿 쌓이고("수리중"·"수리 중"·"수리중.."), 그게 전부 고객에게 보인다.
 */
export function canManageCustomerStatusOptions(role: Role): boolean {
  return canManageRolePermissions(role);
}

/**
 * 새 수리 의뢰 알림을 받는가.
 *
 * 알림은 "누가 이 일을 할 수 있는가"가 아니라 "누가 밀린 일을 봐야 하는가"다.
 * 이 저장소가 canReceivePartRequestNotifications를 처리 권한과 갈라 둔 것과
 * 같은 구분이라 이름을 따로 둔다.
 */
export function canReceiveCustomerRepairRequestNotifications(role: Role): boolean {
  return canViewCustomerPortal(role);
}
