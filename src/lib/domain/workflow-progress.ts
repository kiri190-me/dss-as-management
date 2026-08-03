import type { WorkflowStep, WorkflowType } from "./types";

export type WorkflowStepState = "completed" | "current" | "future";

export type WorkflowProgressStep = WorkflowStep & { state: WorkflowStepState };

export type WorkflowProgressResult =
  | { valid: true; steps: WorkflowProgressStep[] }
  | { valid: false; steps: WorkflowStep[]; warning: string };

/**
 * currentWorkflowStepKey는 RepairStatus로부터 역산하지 않는다 — 이 함수는
 * RepairCase.currentWorkflowStepKey가 해당 워크플로 유형의 단계 목록에서
 * 정확히 어느 위치에 있는지만으로 완료/현재/예정을 결정한다.
 * 이는 DATABASE_DESIGN.md의 향후 `repair_cases.current_step_id` FK 관계를
 * 단순화하여 흉내 낸 데모 로직이며, 실제 DB 구현이 아니다.
 *
 * key가 해당 워크플로에 존재하지 않으면(데이터 정합성 오류) 임의로 단계를
 * 추측하지 않고 valid:false + 한국어 경고 메시지를 반환한다.
 */
export function computeWorkflowProgress(
  workflowType: WorkflowType,
  currentWorkflowStepKey: string,
  allSteps: WorkflowStep[]
): WorkflowProgressResult {
  const steps = allSteps
    .filter((step) => step.workflowType === workflowType)
    .sort((a, b) => a.order - b.order);

  const currentIndex = steps.findIndex((step) => step.key === currentWorkflowStepKey);

  if (currentIndex === -1) {
    return {
      valid: false,
      steps,
      warning: `현재 단계 정보(${currentWorkflowStepKey})가 이 워크플로에 존재하지 않습니다. 데이터 정합성을 확인해 주세요.`,
    };
  }

  // 마지막 단계(각 워크플로의 "출하 완료")에 도달한 경우는 전체 완료로 표시한다.
  const isTerminalStep = currentIndex === steps.length - 1;

  return {
    valid: true,
    steps: steps.map((step, index) => ({
      ...step,
      state: isTerminalStep
        ? "completed"
        : index < currentIndex
          ? "completed"
          : index === currentIndex
            ? "current"
            : "future",
    })),
  };
}
