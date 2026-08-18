import type { Role } from "@/lib/domain/types";

/**
 * 워크플로 기본 틀 관리(/workflows) 권한. Role만 받는 순수 함수이며, 메뉴
 * 노출과 페이지 게이트가 함께 쓰고, 쓰기 경로는 화면이 무엇을 렌더했든
 * 독립적으로 다시 확인한다 — 이 프로젝트의 다른 모든 권한 술어와 같은 규율이다.
 *
 * 정책(2026-08-18 사용자 결정):
 *  - 조회·편집·발행 모두 **엔지니어 이상**(SUPER_ADMIN/ADMIN/AS_ENGINEER).
 *    현장 지식을 가진 엔지니어가 직접 절차를 고칠 수 있어야 한다는 요구다.
 *  - SALES/INVENTORY_MANAGER는 접근하지 않는다. 자기 담당 구간을 정규
 *    워크플로로 진행하는 것은 그대로 가능하며, 여기서 막는 것은 "규칙 자체를
 *    바꾸는 것"뿐이다.
 *
 * 편집과 발행을 나누자는 제안(초안은 엔지니어, 발행은 관리자)은 검토했으나
 * 사용자가 명시적으로 엔지니어도 발행 가능하도록 결정했다. 그래서 현재 세
 * 술어의 역할 집합이 같다 — 나중에 정책이 갈리면 여기만 고치면 되도록
 * 호출부는 각각의 이름으로 부른다.
 */
const WORKFLOW_TEMPLATE_ROLES: readonly Role[] = ["SUPER_ADMIN", "ADMIN", "AS_ENGINEER"];

export function canViewWorkflowTemplates(role: Role): boolean {
  return WORKFLOW_TEMPLATE_ROLES.includes(role);
}

/** 초안 생성·단계/전이 편집. Phase 4 이후의 쓰기 경로가 쓴다. */
export function canEditWorkflowTemplates(role: Role): boolean {
  return WORKFLOW_TEMPLATE_ROLES.includes(role);
}

/** 초안을 발행해 전사에 적용. Phase 4 이후의 쓰기 경로가 쓴다. */
export function canPublishWorkflowTemplates(role: Role): boolean {
  return WORKFLOW_TEMPLATE_ROLES.includes(role);
}
