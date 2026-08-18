import type { RepairStatus } from "./types";
import type { StepCategory } from "./local/workflow/step-category";

/**
 * ============================================================================
 * 초안 발행 전 구조 검증 (Phase 4)
 * ============================================================================
 * 잘못된 구조가 발행되면 그 워크플로의 접수 건이 **전부 멈춘다.** 되돌리는
 * 방법은 있지만(이전 버전을 다시 current로), 그 사이 현장은 아무 작업도 하지
 * 못한다. 그래서 발행은 이 검증을 통과해야만 가능하다.
 *
 * 순수 함수인 이유는 두 곳에서 같은 판정을 해야 하기 때문이다 — 편집 화면이
 * 저장 전에 미리 보여 주고, 발행 mutation이 서버에서 다시 실행한다. 화면이
 * 무엇을 렌더했든 서버 판정이 최종이라는 이 프로젝트의 규율 그대로다.
 *
 * ── 왜 이 규칙들인가 ────────────────────────────────────────────────────
 * intake_inspection과 shipment_completed는 단순한 단계 이름이 아니라 **앱
 * 전반에 하드코딩된 키**다:
 *   - 신규 접수는 항상 intake_inspection에 배치된다(repair-cases.ts:148)
 *   - 유·무상 변경 시 대상 워크플로의 같은 키를 찾는다(:524)
 *   - Excel 이관의 목표 단계 판정이 두 키를 직접 비교한다
 *   - shipment_completed 도달 시 접수 건이 잠긴다(:278)
 * 이 둘이 사라지거나 이름이 바뀌면 접수 생성 자체가 실패한다. 편집자가 그걸
 * 알 방법이 없으므로 검증이 대신 막는다.
 * ============================================================================
 */

export const REQUIRED_START_STEP_KEY = "intake_inspection";
export const REQUIRED_TERMINAL_STEP_KEY = "shipment_completed";

export type DraftStep = {
  key: string;
  label: string;
  order: number;
  isActive: boolean;
  status: RepairStatus | null;
  category: StepCategory | null;
};

export type DraftTransition = {
  actionCode: "STEP_ADVANCED" | "STEP_RETURNED" | "SHIPMENT_COMPLETED";
  fromStepKey: string;
  toStepKey: string;
};

export type DraftValidationIssue = {
  code:
    | "MISSING_START_STEP"
    | "START_STEP_INACTIVE"
    | "MISSING_TERMINAL_STEP"
    | "STEP_WITHOUT_STATUS"
    | "DUPLICATE_STEP_KEY"
    | "DUPLICATE_STEP_ORDER"
    | "TRANSITION_UNKNOWN_STEP"
    | "DUPLICATE_TRANSITION"
    | "SELF_TRANSITION"
    | "UNREACHABLE_STEP"
    | "TERMINAL_UNREACHABLE"
    | "MULTIPLE_TERMINAL_TARGETS";
  message: string;
  /** 문제가 걸린 단계 key(있으면). 화면이 해당 행을 짚어 줄 수 있게 한다. */
  stepKey?: string;
};

export type DraftValidationResult = {
  ok: boolean;
  /** 발행을 막는 문제. */
  errors: DraftValidationIssue[];
  /** 발행은 되지만 확인이 필요한 것. */
  warnings: DraftValidationIssue[];
};

export type DraftValidationOptions = {
  /**
   * 이 워크플로의 접수 건이 워크플로 진행이 아닌 **다른 경로로 빠져나가는가.**
   * 추후결정(PENDING_*) 워크플로가 그렇다 — 단계가 접수·인수점검 둘뿐이고,
   * 유·무상을 확정하는 순간 해당 유상/무상 워크플로로 옮겨간다. 그래서 자체
   * 출하 완료 단계가 없는 것이 정상이며, 없다고 발행을 막으면 지금 운영 중인
   * 세 워크플로가 전부 부적합 판정을 받는다(실제 데이터로 확인함).
   *
   * 기본값은 false다 — 예외를 명시적으로 선언하게 해서, 평범한 워크플로가
   * 실수로 종료 경로를 잃는 것은 그대로 막는다.
   */
  exitsWithoutTerminalStep?: boolean;
};

export function validateWorkflowDraft(
  steps: DraftStep[],
  transitions: DraftTransition[],
  options: DraftValidationOptions = {}
): DraftValidationResult {
  const errors: DraftValidationIssue[] = [];
  const warnings: DraftValidationIssue[] = [];
  const stepByKey = new Map(steps.map((s) => [s.key, s]));

  // ── 단계 자체 ────────────────────────────────────────────────────────
  const seenKeys = new Set<string>();
  const seenOrders = new Set<number>();
  for (const step of steps) {
    if (seenKeys.has(step.key)) {
      errors.push({ code: "DUPLICATE_STEP_KEY", message: `단계 키가 중복됩니다: ${step.key}`, stepKey: step.key });
    }
    seenKeys.add(step.key);

    if (seenOrders.has(step.order)) {
      errors.push({
        code: "DUPLICATE_STEP_ORDER",
        message: `순서 ${step.order}이(가) 중복됩니다: ${step.label}`,
        stepKey: step.key,
      });
    }
    seenOrders.add(step.order);

    if (!step.status) {
      // 상태가 없으면 그 단계에 놓인 접수 건은 목록·대시보드를 읽을 때마다
      // 실패한다. 화면 하나가 아니라 전체가 깨진다.
      errors.push({
        code: "STEP_WITHOUT_STATUS",
        message: `"${step.label}" 단계에 상태가 지정되지 않았습니다.`,
        stepKey: step.key,
      });
    }
  }

  const startStep = stepByKey.get(REQUIRED_START_STEP_KEY);
  if (!startStep) {
    errors.push({
      code: "MISSING_START_STEP",
      message: `신규 접수가 배치되는 "${REQUIRED_START_STEP_KEY}" 단계가 없습니다. 이 단계가 없으면 A/S 접수 자체가 실패합니다.`,
    });
  } else if (!startStep.isActive) {
    errors.push({
      code: "START_STEP_INACTIVE",
      message: `신규 접수가 배치되는 "${startStep.label}" 단계가 비활성입니다.`,
      stepKey: startStep.key,
    });
  }

  const requiresTerminal = !options.exitsWithoutTerminalStep;
  if (requiresTerminal && !stepByKey.has(REQUIRED_TERMINAL_STEP_KEY)) {
    errors.push({
      code: "MISSING_TERMINAL_STEP",
      message: `출하 완료 단계("${REQUIRED_TERMINAL_STEP_KEY}")가 없습니다. 출하 처리와 잠금이 이 단계를 기준으로 동작합니다.`,
    });
  }

  // ── 전이 자체 ────────────────────────────────────────────────────────
  const seenTransitionKeys = new Set<string>();
  for (const transition of transitions) {
    if (!stepByKey.has(transition.fromStepKey) || !stepByKey.has(transition.toStepKey)) {
      errors.push({
        code: "TRANSITION_UNKNOWN_STEP",
        message: `없는 단계를 가리키는 이동 규칙이 있습니다: ${transition.fromStepKey} → ${transition.toStepKey}`,
      });
      continue;
    }
    if (transition.fromStepKey === transition.toStepKey) {
      errors.push({
        code: "SELF_TRANSITION",
        message: `같은 단계로 되돌아오는 이동 규칙이 있습니다: ${transition.fromStepKey}`,
        stepKey: transition.fromStepKey,
      });
    }
    const uniqueKey = `${transition.actionCode}::${transition.fromStepKey}`;
    if (seenTransitionKeys.has(uniqueKey)) {
      errors.push({
        code: "DUPLICATE_TRANSITION",
        message: `한 단계에서 같은 동작으로 갈 수 있는 곳은 하나뿐입니다: ${transition.fromStepKey}`,
        stepKey: transition.fromStepKey,
      });
    }
    seenTransitionKeys.add(uniqueKey);
  }

  // ── 도달 가능성 ──────────────────────────────────────────────────────
  // 정방향(STEP_ADVANCED)과 출하 완료(SHIPMENT_COMPLETED)만 따진다. 되돌리기는
  // 이미 도달한 곳에서만 쓰이므로 도달 경로를 만들어 주지 않는다 — 되돌리기로만
  // 닿을 수 있는 단계는 실제로는 아무도 갈 수 없는 단계다.
  if (startStep) {
    const forward = new Map<string, string[]>();
    for (const t of transitions) {
      if (t.actionCode === "STEP_RETURNED") continue;
      forward.set(t.fromStepKey, [...(forward.get(t.fromStepKey) ?? []), t.toStepKey]);
    }

    const reachable = new Set<string>([startStep.key]);
    const queue = [startStep.key];
    while (queue.length > 0) {
      const current = queue.shift()!;
      for (const next of forward.get(current) ?? []) {
        if (!reachable.has(next)) {
          reachable.add(next);
          queue.push(next);
        }
      }
    }

    for (const step of steps) {
      // 비활성 단계는 새 전이를 받지 않는 것이 정상이므로 도달 불가를 문제로
      // 보지 않는다. product_intake처럼 역사적으로 남아 있는 단계도 여기 해당한다.
      if (!step.isActive) continue;
      if (step.key === startStep.key) continue;
      if (!reachable.has(step.key)) {
        warnings.push({
          code: "UNREACHABLE_STEP",
          message: `"${step.label}" 단계에 도달할 방법이 없습니다. 이동 규칙을 추가하거나 비활성으로 두세요.`,
          stepKey: step.key,
        });
      }
    }

    if (requiresTerminal && stepByKey.has(REQUIRED_TERMINAL_STEP_KEY) && !reachable.has(REQUIRED_TERMINAL_STEP_KEY)) {
      errors.push({
        code: "TERMINAL_UNREACHABLE",
        message: "신규 접수 단계에서 출하 완료까지 이어지는 경로가 없습니다. 접수 건이 끝까지 진행될 수 없습니다.",
        stepKey: REQUIRED_TERMINAL_STEP_KEY,
      });
    }
  }

  const terminalTargets = new Set(
    transitions.filter((t) => t.actionCode === "SHIPMENT_COMPLETED").map((t) => t.toStepKey)
  );
  if (terminalTargets.size > 1) {
    errors.push({
      code: "MULTIPLE_TERMINAL_TARGETS",
      message: `출하 완료가 서로 다른 단계로 향합니다: ${[...terminalTargets].join(", ")}`,
    });
  }

  return { ok: errors.length === 0, errors, warnings };
}
