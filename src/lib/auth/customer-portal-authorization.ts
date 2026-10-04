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
 *  보기      고객사에 무엇이 나가는지 확인한다. 위험이 없다.
 *  안내 정하기  **고객사에 보내는 엑셀에 그대로 적히는 글**을 정한다. 잘못 적으면
 *            회사 밖으로 그대로 나간다.
 *  목록 관리   **고를 수 있는 상태 말 자체**를 늘리고 줄인다. 여기서 정한 말이
 *            모든 담당자의 드롭다운에 서고, 그대로 고객사에 나간다.
 *
 * 한 함수로 합쳐 두면 나중에 "영업도 안내 문구는 적게 하되 목록은 못 고치게"
 * 같은 요구가 왔을 때 고칠 자리가 없다.
 *
 * ⚠️ 2026-10-04 에 고객사 전용 주소를 걷어내면서 canManageCustomerLinks(주소
 * 발급·회수)와 canReceiveCustomerRepairRequestNotifications(새 수리 의뢰 알림)가
 * 없어졌다. 🔴 **권한 영역 `customerPortal` 과 그 세 단계는 그대로다** — 운영
 * DB 의 role_permissions 에 저장된 값이 있을 수 있어, 단계를 없애면 그 값이
 * 조용히 무효가 된다. 「관리」가 뜻하는 일만 상태 목록 하나로 줄었다.
 */

/** 고객 안내 현황 화면을 볼 수 있는가. */
export function canViewCustomerPortal(role: Role): boolean {
  // 접수를 만들 수 있는 역할이면 고객사에 뭐라고 안내되는지도 볼 수 있어야
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
 * 고객 안내 상태 목록(설정)을 관리할 수 있는가 — **관리자 이상.**
 *
 * 여기서 정한 말이 그대로 고객사에 보내는 표에 적힌다. 목록을 아무나 늘리면
 * 비슷한 말이 여럿 쌓이고("수리중"·"수리 중"·"수리중.."), 그게 전부 밖으로
 * 나간다.
 *
 * 🔴 권한 영역 `customerPortal` 의 「관리」가 뜻하는 일이 이것 하나다
 * (permission-baseline.ts 가 이 함수를 그대로 부른다).
 */
export function canManageCustomerStatusOptions(role: Role): boolean {
  return canManageRolePermissions(role);
}
