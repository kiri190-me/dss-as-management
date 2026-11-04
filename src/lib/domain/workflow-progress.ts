export type WorkflowStepState = "completed" | "current" | "future";

/**
 * 이 셈이 한 단계에서 **실제로 읽는 칸**만 적는다. DB 규칙의 `WorkflowRuleStep`
 * (domain/workflow-rules-view.ts)도 mock-data 의 `WorkflowStep` 도 이 모양을
 * 구조적으로 만족하므로, 어느 쪽 목록이든 그대로 넘길 수 있다 — 칸을 더 들고
 * 있어도 여기서는 안 본다.
 */
export type WorkflowProgressStep = { key: string; label: string; order: number };

export type WorkflowProgressStepWithState = WorkflowProgressStep & { state: WorkflowStepState };

export type WorkflowProgressResult =
  | { valid: true; steps: WorkflowProgressStepWithState[] }
  | { valid: false; steps: WorkflowProgressStep[]; warning: string };

/**
 * currentWorkflowStepKey는 RepairStatus로부터 역산하지 않는다 — 이 함수는
 * 그 키가 **받은 단계 목록**에서 정확히 어느 위치에 있는지만으로 완료/현재/
 * 예정을 결정한다.
 *
 * ── 🔴 2026-11-04: 목록을 **이미 좁혀서** 받는다 ───────────────────────────
 * 예전에는 `(workflowType, key, allSteps)` 를 받아 workflowType 으로 걸러
 * 냈다. 그 걸러내기는 **mock-data.ts 의 통짜 배열**(아홉 워크플로 96단계가 한
 * 배열에 들어 있다)을 넘기기 위한 것이었고, 그래서 이 화면은 [워크플로 관리]
 * 에서 단계를 고쳐도 한 글자도 안 바뀌었다 — 코드에 박힌 표를 보고 있었다.
 *
 * 지금 넘어오는 목록은 **그 접수 건의 workflow_version_id 하나**에 달린 단계다
 * (db/queries/workflow-rules.ts 의 loadWorkflowRulesForCase). 워크플로 종류가
 * 아니라 **판본**으로 좁혀진 것이라 여기서 더 걸러낼 것이 없고, 걸러낼 칸
 * (workflowType)도 그 목록에는 없다.
 *
 * 받은 차례를 믿지 않고 `order` 로 다시 세운다 — DB 조회는 이미 정렬해서
 * 주지만, 이 함수의 답은 **차례에만** 기대고 있어서 부르는 쪽이 정렬을
 * 빠뜨리면 완료/예정이 통째로 뒤섞인다. 입력 배열은 건드리지 않는다(복사본을
 * 정렬한다) — 호출부가 쥔 목록을 이 함수가 바꿔 놓으면 안 된다.
 *
 * key가 그 목록에 없으면(데이터 정합성 오류) 임의로 단계를 추측하지 않고
 * valid:false + 한국어 경고 메시지를 반환한다.
 */
export function computeWorkflowProgress(
  allSteps: readonly WorkflowProgressStep[],
  currentWorkflowStepKey: string
): WorkflowProgressResult {
  const steps = [...allSteps].sort((a, b) => a.order - b.order);

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
