import { describe, test } from "node:test";
import assert from "node:assert/strict";

import {
  MAX_SHIPMENT_APPROVAL_ROUTE_STEPS,
  stepOrderFromIndex,
  validateShipmentApprovalRouteSteps,
} from "./shipment-approval-route";

/**
 * ============================================================================
 * 출하 승인 절차 순수 규칙
 * ============================================================================
 * 여기서 못 박는 것 셋:
 *  1. **0개는 정상이다** — 「절차를 쓰지 않겠다」는 뜻이라, 막으면 한 번 만든
 *     절차를 되돌릴 길이 없어진다.
 *  2. **같은 사람이 두 번 나오면 거절한다** — 표의 유니크가 최종 방어선이고,
 *     여기가 사람에게 이유를 말해 주는 앞단이다.
 *  3. **상한을 넘으면 거절한다** — 상한이 없으면 실수 한 번으로 끝나지 않는
 *     결재선이 만들어진다.
 *
 * uuid 형식은 일부러 보지 않는다(저장 경로가 isValidUuid 로 본다) — 그 사실도
 * 아래에서 시험으로 못 박는다. 나중에 여기에 형식 검사가 슬그머니 들어오면
 * 그 시험이 깨진다.
 * ============================================================================
 */

/** 형식만 맞으면 되는 가짜 승인자 id — 이 층은 uuid 인지 보지 않는다. */
function approver(n: number): string {
  return `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
}

function approvers(count: number): string[] {
  return Array.from({ length: count }, (_, index) => approver(index + 1));
}

describe("stepOrderFromIndex", () => {
  test("배열의 자리 0 이 1번째 단계다 — 표의 CHECK (step_order >= 1) 과 짝이다", () => {
    assert.equal(stepOrderFromIndex(0), 1);
    assert.equal(stepOrderFromIndex(1), 2);
    assert.equal(stepOrderFromIndex(9), 10);
  });

  test("상한만큼 채워도 순서 번호가 1..10 으로 빈틈없이 나온다", () => {
    const orders = approvers(MAX_SHIPMENT_APPROVAL_ROUTE_STEPS).map((_, index) =>
      stepOrderFromIndex(index)
    );
    assert.deepEqual(orders, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  });
});

describe("validateShipmentApprovalRouteSteps", () => {
  // ─────────────────────────────────────────────────── 0개는 정상이다

  test("🔴 단계 0개는 통과한다 — 「절차를 쓰지 않겠다」는 정상적인 뜻이다", () => {
    assert.deepEqual(validateShipmentApprovalRouteSteps([]), { ok: true });
  });

  test("한 명짜리 절차도 통과한다", () => {
    assert.deepEqual(validateShipmentApprovalRouteSteps([approver(1)]), { ok: true });
  });

  test("서로 다른 사람 여럿은 통과한다", () => {
    assert.deepEqual(validateShipmentApprovalRouteSteps(approvers(4)), { ok: true });
  });

  // ─────────────────────────────────────────────────────────── 상한

  test("상한(10)까지는 통과한다 — 경계값이 열려 있어야 한다", () => {
    const atLimit = approvers(MAX_SHIPMENT_APPROVAL_ROUTE_STEPS);
    assert.equal(atLimit.length, 10, "상한이 바뀌면 이 시험의 전제를 다시 본다");
    assert.deepEqual(validateShipmentApprovalRouteSteps(atLimit), { ok: true });
  });

  test("🔴 상한을 하나라도 넘으면 거절한다", () => {
    const overLimit = approvers(MAX_SHIPMENT_APPROVAL_ROUTE_STEPS + 1);
    const result = validateShipmentApprovalRouteSteps(overLimit);

    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.code, "TOO_MANY_STEPS");
    // 사람이 무엇을 고쳐야 하는지 알 수 있어야 한다 — 상한과 지금 개수 둘 다.
    assert.match(result.message, /10/);
    assert.match(result.message, /11/);
  });

  test("한참 넘겨도 같은 코드로 거절한다 — 붙여넣기 사고를 그대로 받지 않는다", () => {
    const result = validateShipmentApprovalRouteSteps(approvers(60));
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.code, "TOO_MANY_STEPS");
  });

  // ───────────────────────────────────────────────────────── 중복

  test("🔴 같은 사람이 두 번 나오면 거절한다 — 표의 유니크 앞에서 이유를 말해 준다", () => {
    const result = validateShipmentApprovalRouteSteps([approver(1), approver(2), approver(1)]);

    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.code, "DUPLICATE_APPROVER");
    // 몇 번째 자리에서 걸렸는지 알려 준다(1부터 세는 번호).
    assert.match(result.message, /3번째/);
  });

  test("바로 옆자리에 같은 사람이 있어도 거절한다", () => {
    const result = validateShipmentApprovalRouteSteps([approver(1), approver(1)]);
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.code, "DUPLICATE_APPROVER");
  });

  test("앞뒤 공백만 다른 같은 id 도 중복이다 — 다듬은 값으로 비교한다", () => {
    const result = validateShipmentApprovalRouteSteps([approver(1), ` ${approver(1)} `]);
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.code, "DUPLICATE_APPROVER");
  });

  // ────────────────────────────────────────────────── 빈 자리

  test("🔴 빈 문자열은 거절한다 — 사람을 고르지 않은 줄이 그대로 넘어오는 길이 있다", () => {
    const result = validateShipmentApprovalRouteSteps([approver(1), ""]);

    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.code, "MISSING_APPROVER");
    assert.match(result.message, /2번째/);
  });

  test("공백만 든 값도 빈 자리다", () => {
    const result = validateShipmentApprovalRouteSteps(["   "]);
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.code, "MISSING_APPROVER");
    assert.match(result.message, /1번째/);
  });

  test("빈 자리가 중복보다 먼저 걸린다 — 빈 줄 둘을 「중복」이라고 말하면 오해를 준다", () => {
    const result = validateShipmentApprovalRouteSteps(["", ""]);
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.code, "MISSING_APPROVER");
  });

  // ────────────────────────────────────── 여기서 보지 않는 것

  test("🔴 uuid 형식은 보지 않는다 — 저장 경로가 isValidUuid 로 본다", () => {
    // 이 층이 형식까지 보기 시작하면 같은 정규식이 두 벌이 된다. 형식이 아닌
    // 값이 여기서 통과하는 것은 의도된 동작이다.
    assert.deepEqual(validateShipmentApprovalRouteSteps(["u-001", "관리자"]), { ok: true });
  });

  test("입력 배열을 바꾸지 않는다 — 순수 함수다", () => {
    const input = [approver(1), approver(2)];
    const snapshot = [...input];
    validateShipmentApprovalRouteSteps(input);
    assert.deepEqual(input, snapshot);
  });
});
