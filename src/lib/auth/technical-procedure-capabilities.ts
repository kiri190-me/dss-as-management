import "server-only";

import type { Role } from "@/lib/domain/types";
import type { ProcedureTemplateCategory } from "@/lib/domain/procedure-template-types";
import { hasPermission } from "./permission-resolver";
import {
  canEditProcedureTemplateDraft,
  canPublishProcedureTemplates,
  canCreateProcedureTemplateDraft,
} from "./procedure-template-authorization";

/**
 * ============================================================================
 * 절차 템플릿 권한 — 카테고리에 따라 다른 정책으로 갈린다
 * ============================================================================
 * 이 영역에는 4단계 사다리로 표현되지 않는 차원이 하나 더 있다: 템플릿의
 * **카테고리**다. TECHNICAL_TASK는 '기술 작업 절차' 메뉴의 소관이지만,
 * FULL_SERVICE와 REFERENCE는 애초에 다른 정책 파일(procedure-template-
 * authorization.ts)이 지배한다. 같은 "편집" 조작인데 어느 정책을 따를지가
 * 카테고리로 갈리는 것이다.
 *
 * 그래서 이 영역의 전환은 **TECHNICAL_TASK 가지만** 설정으로 옮긴다. 나머지
 * 가지를 함께 옮기면 '기술 작업 절차' 노드가 자기 메뉴가 아닌 템플릿까지
 * 지배하게 되고, 관리자는 기술 절차를 열어 준 줄 알았는데 전체 서비스 절차가
 * 함께 열리는 일이 생긴다.
 *
 * 분기 규칙을 여기 한 번만 적는 이유도 같다 — 호출부마다 삼항 연산자를
 * 되풀이하면 한 곳만 고쳐지는 날이 오고, 권한에서 그런 어긋남은 조용히 뚫리는
 * 쪽으로 기운다.
 * ============================================================================
 */

/** 이 템플릿을 편집할 수 있는가. TECHNICAL_TASK만 설정이 판정한다. */
export async function mayEditTemplateOfCategory(
  role: Role,
  category: ProcedureTemplateCategory
): Promise<boolean> {
  return category === "TECHNICAL_TASK"
    ? hasPermission(role, "technicalProcedures.editDraft", "WRITE")
    : canEditProcedureTemplateDraft(role);
}

/** 이 템플릿을 발행할 수 있는가. */
export async function mayPublishTemplateOfCategory(
  role: Role,
  category: ProcedureTemplateCategory
): Promise<boolean> {
  return category === "TECHNICAL_TASK"
    ? hasPermission(role, "technicalProcedures.publish", "MANAGE")
    : canPublishProcedureTemplates(role);
}

/** 이 템플릿의 새 초안 버전을 만들 수 있는가. */
export async function mayCreateDraftVersionOfCategory(
  role: Role,
  category: ProcedureTemplateCategory
): Promise<boolean> {
  return category === "TECHNICAL_TASK"
    ? hasPermission(role, "technicalProcedures.editDraft", "WRITE")
    : canCreateProcedureTemplateDraft(role);
}

/**
 * 노드·연결선의 구조 편집(생성·삭제)을 할 수 있는가.
 *
 * 원래부터 TECHNICAL_TASK 전용이다 — FULL_SERVICE/REFERENCE에는 어느 역할에도
 * 열어 주지 않는 것이 이 기능의 요구사항이었고(technical-procedure-template-
 * authorization.ts의 canActorManageTechnicalTemplateGraph 주석), 설정으로
 * 옮기면서도 그 성질은 그대로 둔다. 카테고리 조건이 먼저이고 설정은 그다음이다.
 */
export async function mayManageTemplateGraph(
  role: Role,
  category: ProcedureTemplateCategory
): Promise<boolean> {
  if (category !== "TECHNICAL_TASK") return false;
  return hasPermission(role, "technicalProcedures.editDraft", "WRITE");
}

/**
 * 카테고리를 알기 전 단계의 문지기 — 편집기 진입 자체를 거른다.
 *
 * 템플릿 행을 읽기 전이라 카테고리를 모르므로, 여기서는 '기술 작업 절차'의
 * 초안 편집 권한만 본다. 카테고리별 정밀 판정은 행을 읽은 뒤 위의 함수들이
 * 다시 한다 — 종전 구조(canManageTechnicalTemplates로 먼저 거르고
 * assertEditableDraft가 다시 보는 것)와 같은 두 겹이다.
 */
export async function mayEnterTemplateEditor(role: Role): Promise<boolean> {
  return hasPermission(role, "technicalProcedures.editDraft", "WRITE");
}
