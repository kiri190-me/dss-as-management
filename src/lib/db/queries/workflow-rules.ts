import "server-only";

import { eq } from "drizzle-orm";
import type { db } from "../client";
import { repairCases, workflowSteps, workflowTemplates, workflowTransitions, workflowVersions } from "../schema";
import type {
  TransitionDefinition,
  TransitionDirection,
} from "@/lib/domain/local/workflow/transition-definitions";
import type { ActionCode } from "@/lib/domain/local/workflow/workflow-types";
import type { RepairStatus, WorkflowType } from "@/lib/domain/types";
import type { StepCategory } from "@/lib/domain/local/workflow/step-category";
import type { WorkflowRuleStep, WorkflowRulesDto } from "@/lib/domain/workflow-rules-view";

/**
 * 트랜잭션 핸들과 최상위 db 양쪽을 받는다 — mutation은 트랜잭션 안에서,
 * 서버 컴포넌트(페이지)는 트랜잭션 없이 읽기 때문이다. 읽기 전용이라 둘 중
 * 무엇으로 실행하든 의미가 같다.
 */
type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0] | typeof db;

export type { WorkflowRuleStep, WorkflowRulesDto } from "@/lib/domain/workflow-rules-view";

export type WorkflowRules = {
  workflowVersionId: string;
  workflowType: WorkflowType;
  steps: WorkflowRuleStep[];
  stepByKey: Map<string, WorkflowRuleStep>;
  /**
   * transition-definitions.ts의 TransitionDefinition과 **같은 모양**이다.
   * 그래야 permissions.ts / workflow-action-availability.ts 같은 순수 판정
   * 함수를 한 줄도 고치지 않고 그대로 쓸 수 있다 — 그 함수들은 규칙이 어디서
   * 왔는지 알 필요가 없다.
   */
  transitions: TransitionDefinition[];
};

/**
 * ============================================================================
 * Phase 2 — 워크플로 규칙을 DB에서 읽는 단일 진입점
 * ============================================================================
 * 지금까지 규칙의 출처는 transition-definitions.ts(183행)였고, 런타임의 모든
 * 판정이 그 배열을 조회했다. 이 함수가 그 자리를 대신한다 — DB 모드에서는
 * 여기를 거쳐야 하며, 다른 곳에서 TS 표를 직접 조회하면 안 된다.
 *
 * 접수 건의 workflow_version_id 단위로 읽는 이유는, 규칙이 버전에 종속되기
 * 때문이다. 접수 시점에 고정된 버전의 규칙으로 계속 흘러가야 하고, 새 버전이
 * 발행돼도 진행 중인 건은 영향을 받지 않는다(DATABASE_DESIGN.md #13).
 *
 * 캐시는 두지 않는다. 발행된 버전의 규칙은 불변이라 캐시해도 안전하지만,
 * Phase 4 이후 DRAFT 버전을 편집하게 되면 그 전제가 깨진다. 전이 한 번당
 * 질의 한 번이 늘어날 뿐이고(그 트랜잭션은 이미 여러 번 질의한다), 필요해지면
 * "PUBLISHED 버전만 캐시"로 나중에 좁히는 편이 낫다.
 *
 * 로컬(mock) 데모 모드는 이 함수를 쓸 수 없다 — 브라우저에서 DB를 읽지
 * 못한다. 그쪽은 계속 TS 표를 쓰며, 그 파일의 역할은 "로컬 데모 전용
 * 기본값"으로 바뀐다.
 * ============================================================================
 */
export async function loadWorkflowRules(tx: Tx, workflowVersionId: string): Promise<WorkflowRules | null> {
  const [version] = await tx
    .select({ id: workflowVersions.id, workflowType: workflowTemplates.code })
    .from(workflowVersions)
    .innerJoin(workflowTemplates, eq(workflowTemplates.id, workflowVersions.workflowTemplateId))
    .where(eq(workflowVersions.id, workflowVersionId));
  if (!version) return null;

  const stepRows = await tx
    .select({
      id: workflowSteps.id,
      key: workflowSteps.key,
      label: workflowSteps.label,
      order: workflowSteps.stepOrder,
      isActive: workflowSteps.isActive,
      status: workflowSteps.repairStatus,
      category: workflowSteps.category,
    })
    .from(workflowSteps)
    .where(eq(workflowSteps.workflowVersionId, workflowVersionId));

  const steps: WorkflowRuleStep[] = stepRows
    .map((row) => ({
      id: row.id,
      key: row.key,
      label: row.label,
      order: row.order,
      isActive: row.isActive,
      // repair_status가 비어 있으면 그 단계의 접수 건은 상태를 만들 수 없다.
      // Phase 1의 이관·시드·정합성 테스트가 이 값을 보장하므로 여기서는
      // 비정상 상태로 간주하고 그 단계를 제외하지 않는다 — 조용히 빼면
      // "왜 이 단계로 못 가지"를 런타임에서 쫓게 된다. 아래에서 명시적으로
      // 걸러 내고 호출부가 알 수 있게 한다.
      status: row.status as RepairStatus | null,
      category: row.category as StepCategory | null,
    }))
    .filter((step): step is WorkflowRuleStep => step.status !== null)
    .sort((a, b) => a.order - b.order);

  const stepById = new Map(steps.map((s) => [s.id, s]));
  const stepByKey = new Map(steps.map((s) => [s.key, s]));

  const transitionRows = await tx
    .select({
      id: workflowTransitions.id,
      actionCode: workflowTransitions.actionCode,
      fromStepId: workflowTransitions.fromStepId,
      toStepId: workflowTransitions.toStepId,
      allowedRoles: workflowTransitions.allowedRoles,
      requiresAssignedEngineer: workflowTransitions.requiresAssignedEngineer,
      requiresReason: workflowTransitions.requiresReason,
      requiredApprovalType: workflowTransitions.requiredApprovalType,
    })
    .from(workflowTransitions)
    .where(eq(workflowTransitions.workflowVersionId, workflowVersionId));

  const transitions: TransitionDefinition[] = [];
  for (const row of transitionRows) {
    const from = stepById.get(row.fromStepId);
    const to = stepById.get(row.toStepId);
    // 출발/도착 단계를 해석할 수 없는 행은 규칙으로 성립하지 않는다. FK가
    // 있으므로 정상적으로는 발생할 수 없고, 발생했다면 상태 컬럼이 빈 단계를
    // 가리키는 경우다(위 filter에서 빠진 단계).
    if (!from || !to) continue;
    transitions.push({
      id: `db:${row.id}`,
      workflowType: version.workflowType as WorkflowType,
      actionCode: row.actionCode as ActionCode,
      fromStepKey: from.key,
      toStepKey: to.key,
      toStatus: to.status,
      direction: directionOf(row.actionCode),
      allowedRoles: row.allowedRoles,
      requiresAssignedEngineer: row.requiresAssignedEngineer,
      requiresReason: row.requiresReason,
      requiredApprovalType: row.requiredApprovalType,
    });
  }

  return {
    workflowVersionId,
    workflowType: version.workflowType as WorkflowType,
    steps,
    stepByKey,
    transitions,
  };
}

/**
 * direction은 컬럼으로 저장하지 않는다 — action_code에서 그대로 나오기
 * 때문이다(둘 다 저장하면 언젠가 어긋난다). 여기가 그 파생의 유일한 지점이다.
 */
function directionOf(actionCode: string): TransitionDirection {
  if (actionCode === "STEP_ADVANCED") return "FORWARD";
  if (actionCode === "STEP_RETURNED") return "RETURN";
  return "TERMINAL";
}

/**
 * findTransitionDefinition(TS 표 조회)의 DB판. 같은 키
 * (actionCode, fromStepKey)로 찾으며, 그 조합이 유일하다는 것은
 * workflow_transitions의 유니크 인덱스가 보장한다.
 */
export function findTransitionInRules(
  rules: WorkflowRules,
  actionCode: ActionCode,
  fromStepKey: string
): TransitionDefinition | null {
  return (
    rules.transitions.find((t) => t.actionCode === actionCode && t.fromStepKey === fromStepKey) ?? null
  );
}

/**
 * manual-step-options.ts(TS 표 기반)의 DB판. 규칙은 그 파일과 동일하다:
 *   - 승인 게이트가 걸린 단계는 제외한다. 열어두면 최종 출하 승인·수리 검수
 *     승인을 건너뛰고 도달할 수 있어 승인 절차가 무력화된다. 제외 대상은
 *     하드코딩하지 않고 전이의 required_approval_type에서 매번 산출하므로,
 *     승인 요건이 바뀌면 후보 목록도 자동으로 따라간다.
 *   - 상태가 없는 단계는 애초에 rules.steps에 들어오지 않는다(loadWorkflowRules).
 *
 * 두 구현이 존재하는 동안(로컬 데모 모드는 TS판을 계속 쓴다) 규칙이 갈라지지
 * 않도록, 어느 쪽을 고치든 다른 쪽도 함께 고쳐야 한다.
 */
export function listManuallySelectableStepsFromRules(rules: WorkflowRules): WorkflowRuleStep[] {
  const approvalGatedStepKeys = new Set(
    rules.transitions.filter((t) => t.requiredApprovalType !== null).map((t) => t.toStepKey)
  );
  return rules.steps.filter((step) => !approvalGatedStepKeys.has(step.key));
}

/** 서버가 클라이언트가 보낸 단계 키를 다시 검증할 때 쓰는 술어. */
export function isManuallySelectableStepInRules(rules: WorkflowRules, stepKey: string): boolean {
  return listManuallySelectableStepsFromRules(rules).some((step) => step.key === stepKey);
}

/**
 * 접수 건 하나의 규칙을 읽는다. 페이지(서버 컴포넌트)용 진입점이며,
 * ResolvedRepairCase가 workflow_version_id를 담지 않기 때문에 필요하다.
 * 그 값을 ResolvedRepairCase에 얹지 않은 것은 로컬(mock) 모드의 접수 건에는
 * 대응하는 DB 버전이 존재하지 않기 때문이다.
 */
export async function loadWorkflowRulesForCase(tx: Tx, repairCaseId: string): Promise<WorkflowRules | null> {
  const [row] = await tx
    .select({ workflowVersionId: repairCases.workflowVersionId })
    .from(repairCases)
    .where(eq(repairCases.id, repairCaseId));
  if (!row) return null;
  return loadWorkflowRules(tx, row.workflowVersionId);
}

/**
 * 클라이언트로 넘길 수 있는 형태로 좁힌다(Map 제거). 타입과 조회 함수는
 * domain/workflow-rules-view.ts에 있다 — 이 파일에는 server-only가 붙어 있어
 * 클라이언트 컴포넌트가 import할 수 없기 때문이다.
 */
export function toWorkflowRulesDto(rules: WorkflowRules): WorkflowRulesDto {
  return { workflowType: rules.workflowType, steps: rules.steps, transitions: rules.transitions };
}

