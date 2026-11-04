import { describe, test } from "node:test";
import assert from "node:assert/strict";
import {
  computeWorkflowProgress,
  type WorkflowProgressResult,
  type WorkflowProgressStep,
  type WorkflowProgressStepWithState,
} from "./workflow-progress";
import { workflowSteps as mockWorkflowSteps } from "./mock-data";

/**
 * ============================================================================
 * 「워크플로 진행」의 셈 — 🔴 **받은 목록만 본다** (2026-11-04)
 * ============================================================================
 * 이 함수에는 2026-11-04 까지 시험이 한 줄도 없었다. 그 사이에 화면이 코드에 박힌
 * 표(mock-data.ts 의 workflowSteps)를 그리고 있었고, [워크플로 관리]에서 단계를
 * 고쳐도 한 글자도 안 바뀌었다 — **오류가 한 번도 안 났다.** 그림만 틀리면 아무것도
 * 실패하지 않는다.
 *
 * 그래서 여기서 못 박는 것은 둘이다.
 *   1. 🔴 **알맹이** — 넘긴 목록의 글자와 차례가 그대로 나오는가. 일부러
 *      mock-data 와 **다른 라벨**을 쓰고, 그 키의 mock 라벨과 다르다는 것을 같은
 *      시험 안에서 함께 단언한다. 함수가 몰래 mock 을 읽으면 여기서 깨진다.
 *   2. 🔴 **진행도 셈이 그대로인가** — 완료/현재/예정 가르기와 마지막 단계의
 *      전체 완료 처리. 목록의 출처를 바꿨을 뿐 이 규칙은 한 글자도 안 바뀌었다.
 * ============================================================================
 */

/**
 * 🔴 **일부러 mock-data 와 다른 라벨**을 쓴다. key 는 실제 쓰이는 것을 그대로 두어
 * "같은 단계인데 이름만 DB 에서 바뀐" 상황(사용자가 [워크플로 관리]에서 하는 일
 * 그대로)을 흉내 낸다.
 */
const DB_LIKE_STEPS: WorkflowProgressStep[] = [
  { key: "product_intake", label: "제품 받기(현장 이름)", order: 1 },
  { key: "intake_inspection", label: "입고 점검(현장 이름)", order: 2 },
  { key: "parts_supply", label: "부품 확보(현장 이름)", order: 3 },
  { key: "repair_in_progress", label: "수리 작업(현장 이름)", order: 4 },
  { key: "shipment_completed", label: "내보냄(현장 이름)", order: 5 },
];

/**
 * valid:true 를 단언하면서 상태가 붙은 목록을 꺼낸다. assert.equal 은 타입을 좁히지
 * 않아, 좁히는 일은 여기 한 곳에서만 한다.
 */
function validSteps(result: WorkflowProgressResult): WorkflowProgressStepWithState[] {
  assert.equal(result.valid, true);
  if (!result.valid) throw new Error("unreachable");
  return result.steps;
}

/** mock 표에서 같은 key 의 라벨 — 비교 상대가 비면 1번 단언이 공짜로 통과한다. */
function mockLabelOf(workflowType: string, key: string): string | null {
  const row = mockWorkflowSteps.find((s) => s.workflowType === workflowType && s.key === key);
  return row ? row.label : null;
}

describe("computeWorkflowProgress — 받은 목록만 본다", () => {
  test("🔴 표본 점검 — 비교 상대가 실제로 있고, 라벨이 실제로 다르다", () => {
    // 🔵 아래 두 시험이 "빈 표본으로 공짜 통과"하지 않는다는 근거.
    assert.ok(mockWorkflowSteps.length > 0, "mock 표가 비어 있으면 비교 자체가 성립하지 않는다");
    assert.equal(DB_LIKE_STEPS.length, 5);
    for (const step of DB_LIKE_STEPS) {
      const mockLabel = mockLabelOf("PAID_MATCHER", step.key);
      if (mockLabel === null) continue;
      assert.notEqual(
        step.label,
        mockLabel,
        `${step.key}: 시험 표본의 라벨이 mock 라벨과 같으면 "mock 을 읽었는지"를 가릴 수 없다`
      );
    }
    // product_intake · intake_inspection · parts_supply · repair_in_progress ·
    // shipment_completed 다섯 모두 PAID_MATCHER 에 존재한다 — 위 continue 가
    // 전부 걸러 내 아무것도 안 재는 일이 없게 수까지 센다.
    const covered = DB_LIKE_STEPS.filter((s) => mockLabelOf("PAID_MATCHER", s.key) !== null);
    assert.equal(covered.length, 5);
  });

  test("🔴 넘긴 목록의 라벨·차례가 그대로 나온다(mock 표를 안 읽는다)", () => {
    const steps = validSteps(computeWorkflowProgress(DB_LIKE_STEPS, "parts_supply"));
    assert.deepEqual(
      steps.map((s) => s.label),
      ["제품 받기(현장 이름)", "입고 점검(현장 이름)", "부품 확보(현장 이름)", "수리 작업(현장 이름)", "내보냄(현장 이름)"]
    );
    // mock 의 PAID_MATCHER 는 19단계다 — 몰래 그 표를 읽으면 길이부터 어긋난다.
    assert.equal(steps.length, 5);
    assert.notEqual(mockWorkflowSteps.filter((s) => s.workflowType === "PAID_MATCHER").length, 5);
  });

  test("🔴 단계가 하나 더 생긴 목록을 주면 그 단계도 그대로 나온다", () => {
    const added: WorkflowProgressStep[] = [
      ...DB_LIKE_STEPS.slice(0, 3),
      { key: "extra_field_check", label: "현장 추가 점검", order: 4 },
      { key: "repair_in_progress", label: "수리 작업(현장 이름)", order: 5 },
      { key: "shipment_completed", label: "내보냄(현장 이름)", order: 6 },
    ];
    const steps = validSteps(computeWorkflowProgress(added, "extra_field_check"));
    assert.equal(steps.length, 6);
    assert.deepEqual(
      steps.map((s) => s.key),
      ["product_intake", "intake_inspection", "parts_supply", "extra_field_check", "repair_in_progress", "shipment_completed"]
    );
    // mock 표에는 없는 key 다 — 코드 표를 읽는 구현이면 "존재하지 않습니다"가 된다.
    assert.equal(
      mockWorkflowSteps.some((s) => s.key === "extra_field_check"),
      false
    );
    assert.equal(steps[3].state, "current");
  });
});

describe("computeWorkflowProgress — 진행도 셈(완료/현재/예정)", () => {
  test("현재 단계 앞은 완료, 그 자리는 현재, 뒤는 예정", () => {
    const steps = validSteps(computeWorkflowProgress(DB_LIKE_STEPS, "parts_supply"));
    assert.deepEqual(
      steps.map((s) => s.state),
      ["completed", "completed", "current", "future", "future"]
    );
  });

  test("첫 단계면 현재 하나와 예정 넷", () => {
    const steps = validSteps(computeWorkflowProgress(DB_LIKE_STEPS, "product_intake"));
    assert.deepEqual(
      steps.map((s) => s.state),
      ["current", "future", "future", "future", "future"]
    );
  });

  test("🔴 마지막 단계에 닿으면 전체가 완료다(현재 단계가 없다)", () => {
    const steps = validSteps(computeWorkflowProgress(DB_LIKE_STEPS, "shipment_completed"));
    assert.deepEqual(
      steps.map((s) => s.state),
      ["completed", "completed", "completed", "completed", "completed"]
    );
    assert.equal(
      steps.some((s) => s.state === "current"),
      false
    );
  });

  test("🔴 마지막은 목록의 끝자리이지 key 이름이 아니다 — 단계를 더 붙이면 '출하 완료'도 현재가 된다", () => {
    const withTail: WorkflowProgressStep[] = [
      ...DB_LIKE_STEPS,
      { key: "post_shipment_followup", label: "출하 후 확인", order: 6 },
    ];
    const steps = validSteps(computeWorkflowProgress(withTail, "shipment_completed"));
    assert.deepEqual(
      steps.map((s) => s.state),
      ["completed", "completed", "completed", "completed", "current", "future"]
    );
  });

  test("차례는 order 로 다시 세운다 — 뒤섞어 줘도 같은 답", () => {
    const shuffled = [DB_LIKE_STEPS[3], DB_LIKE_STEPS[0], DB_LIKE_STEPS[4], DB_LIKE_STEPS[2], DB_LIKE_STEPS[1]];
    const steps = validSteps(computeWorkflowProgress(shuffled, "parts_supply"));
    assert.deepEqual(
      steps.map((s) => s.order),
      [1, 2, 3, 4, 5]
    );
    assert.deepEqual(
      steps.map((s) => s.state),
      ["completed", "completed", "current", "future", "future"]
    );
  });

  test("🔴 넘긴 배열을 바꿔 놓지 않는다(호출부가 그 목록을 그대로 쥐고 있다)", () => {
    const input: WorkflowProgressStep[] = [DB_LIKE_STEPS[2], DB_LIKE_STEPS[0], DB_LIKE_STEPS[1]];
    const before = input.map((s) => s.key);
    computeWorkflowProgress(input, "product_intake");
    assert.deepEqual(
      input.map((s) => s.key),
      before
    );
  });
});

describe("computeWorkflowProgress — 성립하지 않는 입력", () => {
  test("목록에 없는 key 면 추측하지 않고 경고를 돌려준다", () => {
    const result = computeWorkflowProgress(DB_LIKE_STEPS, "no_such_step");
    assert.equal(result.valid, false);
    assert.equal(result.valid === false && result.warning.includes("no_such_step"), true);
    // 경고를 줄 때도 단계 목록 자체는 (정렬된 채) 그대로 돌려준다.
    assert.equal(result.steps.length, 5);
  });

  test("🔴 목록이 비면 valid:false 다 — 화면은 이 글이 아니라 제 글을 띄운다", () => {
    const result = computeWorkflowProgress([], "intake_inspection");
    assert.equal(result.valid, false);
    assert.equal(result.steps.length, 0);
    // 🔴 이 경고문("현재 단계 정보(...)가 이 워크플로에 존재하지 않습니다")은
    // "단계 키가 틀렸다"는 뜻이라, 진짜 까닭이 "단계가 0개"일 때는 사람을 엉뚱한
    // 곳으로 보낸다. 그래서 WorkflowProgress.tsx 가 빈 목록을 여기 넘기기 전에
    // 가로채 제 글을 띄운다 — 그 약속을 재는 시험은 components 목록에 있다
    // (components/repair-cases/detail/workflow-progress-db-steps.test.tsx).
    assert.equal(result.valid === false && result.warning.includes("intake_inspection"), true);
  });
});
