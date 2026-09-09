import { describe, test } from "node:test";
import assert from "node:assert/strict";

import {
  isSameRouteStepList,
  MAX_SHIPMENT_APPROVAL_ROUTE_STEPS,
  moveRouteStepDown,
  moveRouteStepUp,
  removeRouteStep,
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

/**
 * ============================================================================
 * 편집 도우미
 * ============================================================================
 * 편집 화면(ShipmentApprovalRouteSection.tsx)은 서버 액션을 물고 있어 렌더
 * 시험이 붙지 않는다. 그래서 실수가 나기 쉬운 부분만 순수 함수로 내려 두었고,
 * 여기서 못 박는 것 셋이다:
 *  1. **경계에서 던지지 않는다** — 맨 위에서 [▲], 맨 아래에서 [▼] 를 눌러도
 *     조용히 아무 일이 없어야 한다(오류 상자는 사람에게 「고장」이다).
 *  2. 🔴 **입력 배열을 절대 건드리지 않는다** — React 상태로 쓰이는 배열이라
 *     제자리에서 뒤집으면 화면은 안 바뀌는데 자료만 달라진다.
 *  3. 🔴 **순서가 다르면 다른 목록이다** — 저장 경로의 「바뀐 게 없으면 새 판을
 *     만들지 않는다」가 이 판정 하나에 걸려 있다.
 * ============================================================================
 */

/** 세 도우미가 모두 원본을 건드리지 않는지 한 자리에서 확인한다. */
function assertLeavesInputAlone(run: (list: readonly string[]) => string[]): void {
  const input = [approver(1), approver(2), approver(3)];
  const snapshot = [...input];
  const result = run(input);
  assert.deepEqual(input, snapshot, "입력 배열이 제자리에서 바뀌었다");
  assert.notEqual(result, input, "입력 배열을 그대로 돌려주면 화면이 다시 그려지지 않는다");
}

describe("moveRouteStepUp", () => {
  test("한 칸 위로 올라간다", () => {
    assert.deepEqual(moveRouteStepUp([approver(1), approver(2), approver(3)], 1), [
      approver(2),
      approver(1),
      approver(3),
    ]);
  });

  test("🔴 맨 위에서 더 올리려 하면 그대로다 — 던지지 않는다", () => {
    const list = [approver(1), approver(2)];
    assert.deepEqual(moveRouteStepUp(list, 0), list);
  });

  test("범위를 벗어난 자리도 그대로다", () => {
    const list = [approver(1), approver(2)];
    assert.deepEqual(moveRouteStepUp(list, 9), list);
    assert.deepEqual(moveRouteStepUp(list, -1), list);
    assert.deepEqual(moveRouteStepUp([], 0), []);
  });

  test("🔴 입력 배열을 바꾸지 않고 새 배열을 돌려준다", () => {
    assertLeavesInputAlone((list) => moveRouteStepUp(list, 2));
    // 아무 일도 일어나지 않는 경우에도 새 배열이어야 한다.
    assertLeavesInputAlone((list) => moveRouteStepUp(list, 0));
  });
});

describe("moveRouteStepDown", () => {
  test("한 칸 아래로 내려간다", () => {
    assert.deepEqual(moveRouteStepDown([approver(1), approver(2), approver(3)], 0), [
      approver(2),
      approver(1),
      approver(3),
    ]);
  });

  test("🔴 맨 아래에서 더 내리려 하면 그대로다 — 던지지 않는다", () => {
    const list = [approver(1), approver(2)];
    assert.deepEqual(moveRouteStepDown(list, 1), list);
  });

  test("범위를 벗어난 자리도 그대로다", () => {
    const list = [approver(1), approver(2)];
    assert.deepEqual(moveRouteStepDown(list, 9), list);
    assert.deepEqual(moveRouteStepDown(list, -1), list);
    assert.deepEqual(moveRouteStepDown([], 0), []);
  });

  test("위로 올린 것을 다시 내리면 처음으로 돌아온다", () => {
    const list = [approver(1), approver(2), approver(3)];
    assert.deepEqual(moveRouteStepDown(moveRouteStepUp(list, 2), 1), list);
  });

  test("🔴 입력 배열을 바꾸지 않고 새 배열을 돌려준다", () => {
    assertLeavesInputAlone((list) => moveRouteStepDown(list, 0));
    assertLeavesInputAlone((list) => moveRouteStepDown(list, 2));
  });
});

describe("removeRouteStep", () => {
  test("그 자리의 단계만 빠진다", () => {
    assert.deepEqual(removeRouteStep([approver(1), approver(2), approver(3)], 1), [
      approver(1),
      approver(3),
    ]);
  });

  test("마지막 하나를 빼면 빈 목록이 된다 — 0개는 정상이다", () => {
    assert.deepEqual(removeRouteStep([approver(1)], 0), []);
  });

  test("범위를 벗어나면 그대로다", () => {
    const list = [approver(1), approver(2)];
    assert.deepEqual(removeRouteStep(list, 2), list);
    assert.deepEqual(removeRouteStep(list, -1), list);
    assert.deepEqual(removeRouteStep([], 0), []);
  });

  test("🔴 입력 배열을 바꾸지 않고 새 배열을 돌려준다", () => {
    assertLeavesInputAlone((list) => removeRouteStep(list, 1));
    assertLeavesInputAlone((list) => removeRouteStep(list, 9));
  });
});

describe("isSameRouteStepList", () => {
  test("같은 사람이 같은 순서로 있으면 같다", () => {
    assert.equal(isSameRouteStepList([approver(1), approver(2)], [approver(1), approver(2)]), true);
  });

  test("빈 목록 둘은 같다 — 「절차를 쓰지 않겠다」가 두 번 저장돼도 판은 하나여야 한다", () => {
    assert.equal(isSameRouteStepList([], []), true);
  });

  test("🔴 순서만 달라도 다른 목록이다 — 누가 먼저 보느냐가 결재선의 뜻이다", () => {
    assert.equal(isSameRouteStepList([approver(1), approver(2)], [approver(2), approver(1)]), false);
  });

  test("길이가 다르면 다르다", () => {
    assert.equal(isSameRouteStepList([approver(1)], [approver(1), approver(2)]), false);
    assert.equal(isSameRouteStepList([], [approver(1)]), false);
  });

  test("한 자리만 다른 사람이어도 다르다", () => {
    assert.equal(
      isSameRouteStepList([approver(1), approver(2), approver(3)], [approver(1), approver(9), approver(3)]),
      false
    );
  });

  test("어느 배열도 건드리지 않는다", () => {
    const a = [approver(1), approver(2)];
    const b = [approver(2), approver(1)];
    const snapshotA = [...a];
    const snapshotB = [...b];
    isSameRouteStepList(a, b);
    assert.deepEqual(a, snapshotA);
    assert.deepEqual(b, snapshotB);
  });
});
