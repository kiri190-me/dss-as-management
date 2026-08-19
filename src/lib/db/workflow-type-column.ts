import "server-only";

import { sql } from "drizzle-orm";
import { workflowTemplates } from "./schema";
import type { WorkflowType } from "@/lib/domain/types";

/**
 * workflow_templates.code를 도메인 WorkflowType으로 읽는 단일 지점.
 *
 * DB의 workflow_type enum에는 도메인에 없는 값이 하나 남아 있다 — 레거시
 * "MATCHER"(Matcher (기존 이력)). 2026-08-19에 도메인·화면에서 없앴지만
 * postgres가 enum 값 제거를 지원하지 않고, 그 값을 쓰는 workflow_templates
 * 행과 그 단계를 가리키는 감사 이력이 남아 있어 지울 수도 없다
 * (schema/workflow.ts의 workflowTypeEnum 주석 참조).
 *
 * 접수 건 쪽에서는 그 값이 나올 수 없다. 그 워크플로에 걸린 접수 건은 0건이고
 * (2026-08-19 실측), 버전은 ARCHIVED라 신규 접수에 배정되지 않으며, 종류·유무상
 * 재배정 경로 어느 쪽도 그 코드를 대상으로 삼지 않는다. 이 좁힘은 그 사실을
 * 타입에 적어 두는 것이다.
 *
 * 그래도 만에 하나 그런 행이 생기면 라벨 조회가 빈 값이 되므로, 이것을 쓰는
 * 매퍼는 라벨을 찾지 못했을 때 "-"로 떨어지게 해 두었다(mappers/repair-case.ts).
 * 조용히 다른 워크플로인 척하는 것보다 낫다.
 */
export function workflowTypeCodeColumn() {
  return sql<WorkflowType>`${workflowTemplates.code}`;
}
