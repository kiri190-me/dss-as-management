import type { Role } from "@/lib/domain/types";

/**
 * 과거 인수품 가져오기(A/S 업무 › 「과거 인수품 가져오기」) 권한의 **역할 기본값** — 다른
 * *-authorization.ts 와 같은 관례를 따른다: Role 만 보는 순수 함수다. 권한 영역
 * `kyosanIntakeImport` 의 역할별 기본 수준을 permission-baseline.ts 가 이 함수로 정한다
 * (그 밖에는 아무 데서도 부르지 않는다).
 *
 * 막는 곳은 여기가 아니다. 서버 액션(server/actions/kyosan-intake-import.ts)과 서비스가
 * 관리자 설정(role_permissions)까지 함께 본 실효 권한(hasPermission … "MANAGE")으로 각자
 * 다시 검사한다.
 *
 * 정책(2026-09-15): **최고관리자 · 관리자만.** 교산 인수품 리스트 한 장으로 수리 건이 한 번에
 * 수백 건 생기고, 출하 완료 건은 잠긴 채로 들어간다 — 잘못 가져오면 사람이 한 건씩 휴지통으로
 * 보내야 한다. 새 고객사 · 모델도 함께 만들어질 수 있어 마스터 자료를 여는 것과 같은 무게다.
 *
 * 개발자는 여기서 따로 다루지 않는다 — 권한 판정이 진짜 역할에 최고관리자를 더해 읽는다
 * (permission-resolver.ts 의 permissionRoles). 알 수 없는 역할 값에는 거짓을 답한다.
 */
export function canImportKyosanIntakeList(role: Role): boolean {
  return role === "SUPER_ADMIN" || role === "ADMIN";
}
