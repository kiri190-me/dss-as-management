import assert from "node:assert/strict";
import { test } from "node:test";

import {
  REQUIRED_START_STEP_KEY,
  REQUIRED_TERMINAL_STEP_KEY,
  validateWorkflowDraft,
  type DraftStep,
  type DraftTransition,
} from "./workflow-draft-validation";

/**
 * 이 테스트가 지키는 것은 "잘못된 워크플로가 발행되지 않는다"이다. 발행이
 * 잘못되면 그 워크플로의 접수 건이 전부 멈추므로, 각 규칙마다 "막아야 할
 * 구조"를 하나씩 만들어 실제로 막히는지 확인한다.
 */

function step(key: string, order: number, over: Partial<DraftStep> = {}): DraftStep {
  return {
    key,
    label: key,
    order,
    isActive: true,
    status: "IN_REPAIR",
    category: "TECHNICAL",
    ...over,
  };
}

function advance(from: string, to: string): DraftTransition {
  return { actionCode: "STEP_ADVANCED", fromStepKey: from, toStepKey: to };
}

/** 통과해야 하는 최소 구조: 접수 → 중간 → 출하 완료. */
function validDraft() {
  const steps = [
    step(REQUIRED_START_STEP_KEY, 1),
    step("repair", 2),
    step(REQUIRED_TERMINAL_STEP_KEY, 3, { status: "SHIPMENT_COMPLETED", category: null }),
  ];
  const transitions: DraftTransition[] = [
    advance(REQUIRED_START_STEP_KEY, "repair"),
    { actionCode: "SHIPMENT_COMPLETED", fromStepKey: "repair", toStepKey: REQUIRED_TERMINAL_STEP_KEY },
    { actionCode: "STEP_RETURNED", fromStepKey: "repair", toStepKey: REQUIRED_START_STEP_KEY },
  ];
  return { steps, transitions };
}

test("정상 구조는 통과한다", () => {
  const { steps, transitions } = validDraft();
  const result = validateWorkflowDraft(steps, transitions);
  assert.deepEqual(result.errors, []);
  assert.deepEqual(result.warnings, []);
  assert.equal(result.ok, true);
});

test("신규 접수 단계가 없으면 발행을 막는다", () => {
  const { steps, transitions } = validDraft();
  const without = steps.filter((s) => s.key !== REQUIRED_START_STEP_KEY);
  const result = validateWorkflowDraft(without, transitions);
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => e.code === "MISSING_START_STEP"));
});

test("신규 접수 단계가 비활성이면 발행을 막는다", () => {
  const { steps, transitions } = validDraft();
  const inactive = steps.map((s) => (s.key === REQUIRED_START_STEP_KEY ? { ...s, isActive: false } : s));
  const result = validateWorkflowDraft(inactive, transitions);
  assert.ok(result.errors.some((e) => e.code === "START_STEP_INACTIVE"));
});

test("출하 완료 단계가 없으면 발행을 막는다", () => {
  const steps = [step(REQUIRED_START_STEP_KEY, 1), step("repair", 2)];
  const result = validateWorkflowDraft(steps, [advance(REQUIRED_START_STEP_KEY, "repair")]);
  assert.ok(result.errors.some((e) => e.code === "MISSING_TERMINAL_STEP"));
});

test("상태가 없는 단계가 있으면 발행을 막는다", () => {
  const { steps, transitions } = validDraft();
  const broken = steps.map((s) => (s.key === "repair" ? { ...s, status: null } : s));
  const result = validateWorkflowDraft(broken, transitions);
  assert.ok(result.errors.some((e) => e.code === "STEP_WITHOUT_STATUS" && e.stepKey === "repair"));
});

test("출하 완료까지 이어지는 경로가 없으면 발행을 막는다", () => {
  const { steps } = validDraft();
  // 출하 완료로 가는 전이를 빼면 접수 건이 끝까지 갈 수 없다.
  const transitions = [advance(REQUIRED_START_STEP_KEY, "repair")];
  const result = validateWorkflowDraft(steps, transitions);
  assert.ok(result.errors.some((e) => e.code === "TERMINAL_UNREACHABLE"));
});

test("되돌리기만으로 닿는 단계는 도달 가능으로 치지 않는다", () => {
  // 되돌리기는 이미 도달한 곳에서만 쓰이므로 도달 경로를 만들어 주지 않는다.
  const steps = [
    step(REQUIRED_START_STEP_KEY, 1),
    step("orphan", 2),
    step(REQUIRED_TERMINAL_STEP_KEY, 3, { status: "SHIPMENT_COMPLETED", category: null }),
  ];
  const transitions: DraftTransition[] = [
    { actionCode: "SHIPMENT_COMPLETED", fromStepKey: REQUIRED_START_STEP_KEY, toStepKey: REQUIRED_TERMINAL_STEP_KEY },
    { actionCode: "STEP_RETURNED", fromStepKey: "orphan", toStepKey: REQUIRED_START_STEP_KEY },
  ];
  const result = validateWorkflowDraft(steps, transitions);
  assert.ok(result.warnings.some((w) => w.code === "UNREACHABLE_STEP" && w.stepKey === "orphan"));
  // 경고이지 오류는 아니다 — 발행 자체는 가능하다.
  assert.equal(result.ok, true);
});

test("비활성 단계의 도달 불가는 문제 삼지 않는다", () => {
  const { steps, transitions } = validDraft();
  const withInactive = [...steps, step("legacy", 9, { isActive: false })];
  const result = validateWorkflowDraft(withInactive, transitions);
  assert.equal(result.warnings.filter((w) => w.code === "UNREACHABLE_STEP").length, 0);
});

test("한 단계에서 같은 동작으로 두 곳에 갈 수 없다", () => {
  const { steps, transitions } = validDraft();
  const duplicated = [...transitions, advance(REQUIRED_START_STEP_KEY, REQUIRED_TERMINAL_STEP_KEY)];
  const result = validateWorkflowDraft(steps, duplicated);
  assert.ok(result.errors.some((e) => e.code === "DUPLICATE_TRANSITION"));
});

test("없는 단계를 가리키는 이동 규칙을 막는다", () => {
  const { steps, transitions } = validDraft();
  const result = validateWorkflowDraft(steps, [...transitions, advance("repair", "존재하지_않음")]);
  assert.ok(result.errors.some((e) => e.code === "TRANSITION_UNKNOWN_STEP"));
});

test("자기 자신으로 가는 이동 규칙을 막는다", () => {
  const { steps, transitions } = validDraft();
  const result = validateWorkflowDraft(steps, [...transitions, advance("repair", "repair")]);
  assert.ok(result.errors.some((e) => e.code === "SELF_TRANSITION"));
});

test("단계 키·순서 중복을 막는다", () => {
  const steps = [
    step(REQUIRED_START_STEP_KEY, 1),
    step("repair", 2),
    step("repair", 2),
    step(REQUIRED_TERMINAL_STEP_KEY, 3, { status: "SHIPMENT_COMPLETED", category: null }),
  ];
  const result = validateWorkflowDraft(steps, validDraft().transitions);
  assert.ok(result.errors.some((e) => e.code === "DUPLICATE_STEP_KEY"));
  assert.ok(result.errors.some((e) => e.code === "DUPLICATE_STEP_ORDER"));
});

test("출하 완료가 서로 다른 단계로 향하면 막는다", () => {
  const { steps, transitions } = validDraft();
  const extra: DraftTransition = {
    actionCode: "SHIPMENT_COMPLETED",
    fromStepKey: REQUIRED_START_STEP_KEY,
    toStepKey: "repair",
  };
  const result = validateWorkflowDraft(steps, [...transitions, extra]);
  assert.ok(result.errors.some((e) => e.code === "MULTIPLE_TERMINAL_TARGETS"));
});

test("빈 초안은 통과하지 못한다", () => {
  const result = validateWorkflowDraft([], []);
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => e.code === "MISSING_START_STEP"));
  assert.ok(result.errors.some((e) => e.code === "MISSING_TERMINAL_STEP"));
});

test("다른 경로로 빠져나가는 워크플로는 출하 완료 단계가 없어도 통과한다", () => {
  // 추후결정(PENDING_*) 워크플로가 실제로 이 모양이다 — 접수·인수점검 두
  // 단계뿐이고, 유·무상을 확정하면 해당 유상/무상 워크플로로 옮겨간다.
  // 이 예외가 없으면 운영 중인 세 워크플로가 전부 부적합 판정을 받는다.
  const steps = [step("product_intake", 1, { isActive: false }), step(REQUIRED_START_STEP_KEY, 2)];
  const result = validateWorkflowDraft(steps, [], { exitsWithoutTerminalStep: true });
  assert.deepEqual(result.errors, []);
  assert.equal(result.ok, true);
});

test("예외를 선언하지 않으면 종료 경로 상실은 그대로 막힌다", () => {
  const steps = [step("product_intake", 1, { isActive: false }), step(REQUIRED_START_STEP_KEY, 2)];
  const result = validateWorkflowDraft(steps, []);
  assert.ok(result.errors.some((e) => e.code === "MISSING_TERMINAL_STEP"));
});
