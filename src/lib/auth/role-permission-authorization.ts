import type { Role } from "@/lib/domain/types";

/**
 * 권한 설정 화면 자체에 대한 접근 권한 — 관리자 이상(2026-08-19 요구).
 *
 * 다른 *-authorization.ts와 같은 관례를 따른다: Role만 보는 순수 함수이고,
 * 메뉴/화면과 서버 액션이 각자 독립적으로 다시 검사한다.
 *
 * 이 검사는 role_permissions 설정을 **거치지 않는다**. 설정으로 이 화면의
 * 접근을 막을 수 있게 하면 잘못 저장한 순간 아무도 되돌릴 수 없다 —
 * 권한 설정 화면만은 설정보다 위에 있어야 한다. (설정 화면이 속한 '사용자 관리'
 * 영역 자체는 설정 대상이지만, 저장 시 assertNoLockout이 자기 역할의 사용자
 * 관리 권한을 낮추는 것을 막는다.)
 */
export function canManageRolePermissions(role: Role): boolean {
  return role === "SUPER_ADMIN" || role === "ADMIN";
}
