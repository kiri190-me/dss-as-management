import type { Role } from "@/lib/domain/types";
import { canManageRolePermissions } from "./role-permission-authorization";

/**
 * 접수 알림 메일 설정 권한 — 다른 *-authorization.ts 와 같은 관례를 따른다:
 * Role 만 보는 순수 함수이고, 페이지와 서버 액션이 각자 독립적으로 검사한다.
 *
 * ── 왜 관리자 이상만인가 ────────────────────────────────────────────────
 * 여기서 정한 문구가 **전사원 메일로 그대로 나가고**, 수신자 목록이 곧
 * "누가 고객사·S/N·증상을 받아 보는가"다. 한 번 나간 메일은 되돌릴 수 없다.
 * 고객사 전용 주소를 발급·회수하는 권한(canManageCustomerLinks)과 같은
 * 무게라 같은 선에 둔다.
 *
 * 보기와 고치기를 가르지 않은 이유: 이 화면은 설정을 고치러 오는 곳이고,
 * 읽기만 해서 할 수 있는 일이 없다. 나중에 "영업도 문구는 보게" 같은 요구가
 * 오면 그때 canView 를 갈라 만든다.
 */
export function canManageIntakeMailSettings(role: Role): boolean {
  return canManageRolePermissions(role);
}
