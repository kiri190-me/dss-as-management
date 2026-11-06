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
import { SHIPMENT_WAITING_REPAIR_STATUS } from "@/lib/domain/shipment-waiting-auto-advance";
import type { StepCategory } from "@/lib/domain/local/workflow/step-category";
import type { WorkflowRuleStep, WorkflowRulesDto } from "@/lib/domain/workflow-rules-view";
import { isValidApprovalType } from "@/lib/validation/repair-case-approval-input";

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
      // 🔴 접수 건 결재 종류만 전이 조건이 될 수 있다. 2026-11-06 부터 그 enum 에
      // **기타건** 결재 종류가 하나 더 있는데(같은 표를 쓰므로 같은 enum 이다),
      // 기타건에는 워크플로 자체가 없어 전이 조건으로 설 자리가 없다. 정상 경로로는
      // 그 값이 여기 들어올 수 없지만, 들어왔다면 **조건 없음**으로 본다 —
      // 전이 게이트가 영영 열리지 않는 단계를 만들지 않기 위해서다.
      requiredApprovalType: isValidApprovalType(row.requiredApprovalType)
        ? row.requiredApprovalType
        : null,
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
 * 단계를 직접 변경할 때 고를 수 있는 후보 목록. 규칙은 셋이다:
 *   - 승인 게이트가 걸린 단계는 제외한다. 열어두면 최종 출하 승인·수리 검수
 *     승인을 건너뛰고 도달할 수 있어 승인 절차가 무력화된다. 제외 대상은
 *     하드코딩하지 않고 전이의 required_approval_type에서 매번 산출하므로,
 *     승인 요건이 바뀌면 후보 목록도 자동으로 따라간다.
 *   - 🔴 **상태가 「출하 대기」인 단계는 제외한다**(2026-11-03 사용자 결정 —
 *     「출하대기는 자동으로만 넘어가도록 해줘. [단계 직접 변경]에서 [출하대기]는
 *     보이지 않도록 해줘」). 그 자리는 이제 **최종 출하 승인이 모두 끝날 때
 *     시스템이 옮긴다**(db/mutations/shipment-waiting-auto-advance.ts).
 *     🔴 **들어가는 길만 닫는다 — 나가는 길은 그대로다.** 이 목록은 「어디로
 *     갈 수 있는가」이지 「어디에서 갈 수 있는가」가 아니라서, 출하 대기에 서 있는
 *     건은 여전히 다른 아무 단계나 골라 빠져나올 수 있다(되돌리기·출하 완료도
 *     그대로다). 그리고 정규 진행 [다음 단계] 로 들어가는 길도 막지 않는다 —
 *     막으면 자동 전환이 못 닿은 건이 출하 완료까지 갈 길을 잃는다.
 *   - 상태가 없는 단계는 애초에 rules.steps에 들어오지 않는다(loadWorkflowRules).
 *
 * 예전에는 같은 규칙을 TS 표로 들고 있는 구현이 하나 더 있었고 둘이 갈라질
 * 위험이 있었지만, 지금은 이 함수가 유일한 실체다 — UI 목록도(execution
 * page -> ManualStepSetPanel), 서버 재검증도(isManuallySelectableStepInRules)
 * 모두 여기를 거친다.
 *
 * 🔴 **주간보고 상세표의 `현 상태` 고르개도 이 목록을 쓴다**
 * (db/mutations/weekly-report-status.ts). 그래서 출하 대기 제외가 그쪽에도
 * 함께 걸린다 — 의도한 것이다(「자동으로만 닿는 단계」는 문이 하나만 닫혀서는
 * 성립하지 않는다). 🔵 그쪽 고르개의 「출하 대기」 칸이 죽지는 않는다: 그 칸은
 * WAITING_SHIPMENT 와 WAITING_SHIPMENT_APPROVAL 을 함께 덮으므로
 * (domain/weekly-report.ts 의 classifyWeeklyReportStatus), 고르면 가장 가까운
 * 「출하 승인」 단계로 간다 — 실측(PAID_MATCHER, 인수점검에서 고를 때)으로는 이
 * 변경 전에도 그 단계가 뽑히고 있었다.
 */
export function listManuallySelectableStepsFromRules(rules: WorkflowRules): WorkflowRuleStep[] {
  const approvalGatedStepKeys = new Set(
    rules.transitions.filter((t) => t.requiredApprovalType !== null).map((t) => t.toStepKey)
  );
  return rules.steps.filter(
    (step) =>
      !approvalGatedStepKeys.has(step.key) && step.status !== SHIPMENT_WAITING_REPAIR_STATUS
  );
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

