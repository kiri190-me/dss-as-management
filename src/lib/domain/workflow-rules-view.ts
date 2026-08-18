import type { TransitionDefinition } from "./local/workflow/transition-definitions";
import type { ActionCode } from "./local/workflow/workflow-types";
import type { StepCategory } from "./local/workflow/step-category";
import type { RepairStatus, WorkflowType } from "./types";

/**
 * ============================================================================
 * 워크플로 규칙의 "화면에서도 쓰는" 부분 — 클라이언트 안전 모듈
 * ============================================================================
 * DB에서 규칙을 읽는 쪽(db/queries/workflow-rules.ts)에는 `server-only`가
 * 붙어 있어 클라이언트 컴포넌트가 import할 수 없다. 그런데 Phase 2d에서
 * DatabaseWorkflowControlPanel(클라이언트)이 서버가 내려준 규칙을 조회해야
 * 하므로, 타입과 순수 조회 함수만 여기로 분리한다.
 *
 * 이 파일에는 DB 접근이 없다 — 이미 읽어 온 값을 다루는 타입과 순수 함수뿐이다.
 * ============================================================================
 */

export type WorkflowRuleStep = {
  id: string;
  key: string;
  label: string;
  order: number;
  isActive: boolean;
  status: RepairStatus;
  category: StepCategory | null;
};

/**
 * 서버 → 클라이언트 경계를 넘길 수 있는 형태. 서버 쪽 WorkflowRules에는 조회
 * 편의를 위한 Map이 들어 있는데 그건 직렬화되지 않으므로, 여기에는 평범한
 * 배열만 담는다.
 */
export type WorkflowRulesDto = {
  workflowType: WorkflowType;
  steps: WorkflowRuleStep[];
  transitions: TransitionDefinition[];
};

/**
 * (actionCode, fromStepKey)로 전이를 찾는다. 서버의 findTransitionInRules와
 * 같은 규칙이며, 그 조합이 유일하다는 것은 workflow_transitions의 유니크
 * 인덱스가 보장한다.
 */
export function findTransitionInDto(
  dto: WorkflowRulesDto,
  actionCode: ActionCode,
  fromStepKey: string
): TransitionDefinition | null {
  return dto.transitions.find((t) => t.actionCode === actionCode && t.fromStepKey === fromStepKey) ?? null;
}

/** 단계 라벨·순서 조회. 없으면 key를 그대로 보여준다(빈 칸보다 낫다). */
export function stepLabelAndOrderInDto(dto: WorkflowRulesDto, stepKey: string) {
  const step = dto.steps.find((s) => s.key === stepKey);
  return { label: step?.label ?? stepKey, order: step?.order ?? null };
}
