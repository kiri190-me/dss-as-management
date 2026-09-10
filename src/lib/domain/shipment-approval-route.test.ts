import { describe, test } from "node:test";
import assert from "node:assert/strict";

import {
  findNextRouteStepToApprove,
  isRouteStepSkippedForRequester,
  isSameRouteStepList,
  isShipmentApprovalRouteScope,
  MAX_SHIPMENT_APPROVAL_ROUTE_STEPS,
  moveRouteStepDown,
  moveRouteStepUp,
  removeRouteStep,
  SHIPMENT_APPROVAL_ROUTE_EMPTY_NOTICES,
  SHIPMENT_APPROVAL_ROUTE_SCOPE_LABELS,
  SHIPMENT_APPROVAL_ROUTE_SCOPES,
  stepOrderFromIndex,
  validateShipmentApprovalRouteSteps,
} from "./shipment-approval-route";
import { shipmentApprovalRouteScopeEnum } from "@/lib/db/schema/shipment-approval-routes";

/**
 * ============================================================================
 * 승인 절차 순수 규칙
 * ============================================================================
 * 여기서 못 박는 것 넷:
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
 *
 * 넷째는 용도(scope)다: **값 목록이 표의 enum 과 글자 그대로 같아야 한다.** 두 곳에
 * 적혀 있고(이 저장소의 스키마 파일은 도메인 층을 가져오지 않는다), 갈라지면
 * 화면은 받아 주는데 저장이 22P02 로 터지거나 그 반대가 된다.
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
 * 🔴 요청자 본인 단계는 건너뛴다
 * ============================================================================
 * 자기가 올린 것을 자기가 결재하는 칸을 없앤다. 요청 경로와 사슬 잇는 자리가
 * **같은 함수 하나**를 보므로, 여기서 못 박는 것이 곧 두 자리의 동작이다.
 *
 * 여기서 지키는 것 넷:
 *  1. 요청자가 결재선에 없으면 **지금까지와 똑같이** 1단계부터다.
 *  2. 요청자인 단계는 처음이든 중간이든 마지막이든 건너뛴다.
 *  3. 🔴 **번호를 고쳐 적지 않는다** — 건너뛴 뒤의 실제 번호를 그대로 돌려준다.
 *     1로 바꿔 적으면 그 번호로 옛 판의 다음 단계를 찾을 때 어긋난다.
 *  4. 남는 단계가 없으면 `null` 이다. 그 뜻(요청 거절 / 사슬 끝)은 부르는 쪽이
 *     정한다 — 여기서 가르면 규칙 하나가 둘로 갈라진다.
 * ============================================================================
 */

/** 승인자 id 목록을 1부터 번호 매긴 단계 목록으로. */
function steps(approverUserIds: string[]): Array<{ stepOrder: number; approverUserId: string }> {
  return approverUserIds.map((approverUserId, index) => ({
    stepOrder: stepOrderFromIndex(index),
    approverUserId,
  }));
}

describe("isRouteStepSkippedForRequester", () => {
  test("승인자가 요청자면 건너뛴다", () => {
    assert.equal(isRouteStepSkippedForRequester(approver(1), approver(1)), true);
  });

  test("다른 사람이면 건너뛰지 않는다", () => {
    assert.equal(isRouteStepSkippedForRequester(approver(1), approver(2)), false);
  });

  test("🔴 요청자를 모르면 건너뛰지 않는다 — 근거 없이 단계를 지우지 않는다", () => {
    assert.equal(isRouteStepSkippedForRequester(approver(1), null), false);
  });
});

describe("findNextRouteStepToApprove", () => {
  // ────────────────────────────────── 요청자가 결재선에 없을 때 (어제와 같다)

  test("🔴 요청자가 결재선에 없으면 1단계부터다 — 이 규칙이 생기기 전과 같다", () => {
    const next = findNextRouteStepToApprove(steps([approver(1), approver(2)]), 0, approver(9));
    assert.deepEqual(next, { stepOrder: 1, approverUserId: approver(1) });
  });

  test("사슬도 그대로 한 칸씩 나아간다", () => {
    const list = steps([approver(1), approver(2), approver(3)]);
    assert.equal(findNextRouteStepToApprove(list, 1, approver(9))?.stepOrder, 2);
    assert.equal(findNextRouteStepToApprove(list, 2, approver(9))?.stepOrder, 3);
    assert.equal(findNextRouteStepToApprove(list, 3, approver(9)), null, "마지막 뒤에는 없다");
  });

  test("요청자를 모르면(null) 아무 단계도 건너뛰지 않는다", () => {
    const next = findNextRouteStepToApprove(steps([approver(1), approver(2)]), 0, null);
    assert.deepEqual(next, { stepOrder: 1, approverUserId: approver(1) });
  });

  // ────────────────────────────────────────────────── 건너뛰기

  test("🔴 1단계가 요청자면 2단계 사람에게 간다 — 번호도 2다", () => {
    const next = findNextRouteStepToApprove(
      steps([approver(1), approver(2), approver(3)]),
      0,
      approver(1)
    );
    assert.deepEqual(
      next,
      { stepOrder: 2, approverUserId: approver(2) },
      "🔴 번호를 1로 고쳐 적으면 다음 단계를 찾을 때 옛 판에서 어긋난다"
    );
  });

  test("🔴 중간 단계가 요청자면 사슬이 그 단계를 건너뛴다 — 1단계 다음은 3단계다", () => {
    const next = findNextRouteStepToApprove(
      steps([approver(1), approver(2), approver(3)]),
      1,
      approver(2)
    );
    assert.deepEqual(next, { stepOrder: 3, approverUserId: approver(3) });
  });

  test("요청자인 단계가 연달아 있어도 그 뒤까지 건너뛴다", () => {
    const next = findNextRouteStepToApprove(
      steps([approver(1), approver(1), approver(3)]),
      0,
      approver(1)
    );
    assert.deepEqual(next, { stepOrder: 3, approverUserId: approver(3) });
  });

  test("🔴 마지막 단계가 요청자면 null 이다 — 사슬이 거기서 끝난다", () => {
    const next = findNextRouteStepToApprove(
      steps([approver(1), approver(2)]),
      1,
      approver(2)
    );
    assert.equal(next, null);
  });

  test("🔴 모든 단계가 요청자면 null 이다 — 요청 경로는 이때 거절한다", () => {
    assert.equal(findNextRouteStepToApprove(steps([approver(1)]), 0, approver(1)), null);
    assert.equal(
      findNextRouteStepToApprove(steps([approver(1), approver(1)]), 0, approver(1)),
      null
    );
  });

  // ─────────────────────────────────────────────── 경계와 순수함

  test("단계가 0개면 null 이다 — 「절차를 쓰지 않겠다」는 뜻이다", () => {
    assert.equal(findNextRouteStepToApprove([], 0, approver(1)), null);
  });

  test("🔴 지금까지 온 단계보다 뒤만 본다 — 이미 지나온 단계로 되돌아가지 않는다", () => {
    const next = findNextRouteStepToApprove(
      steps([approver(1), approver(2), approver(3)]),
      2,
      approver(9)
    );
    assert.deepEqual(next, { stepOrder: 3, approverUserId: approver(3) });
  });

  test("순서가 뒤섞여 들어와도 번호가 가장 작은 단계를 고른다", () => {
    // 부르는 쪽의 정렬에 기대면, 조회가 ORDER BY 를 잃는 날 사슬이 뒤로 간다.
    const shuffled = [
      { stepOrder: 3, approverUserId: approver(3) },
      { stepOrder: 1, approverUserId: approver(1) },
      { stepOrder: 2, approverUserId: approver(2) },
    ];
    assert.deepEqual(findNextRouteStepToApprove(shuffled, 0, approver(9)), {
      stepOrder: 1,
      approverUserId: approver(1),
    });
    assert.deepEqual(findNextRouteStepToApprove(shuffled, 1, approver(2)), {
      stepOrder: 3,
      approverUserId: approver(3),
    });
  });

  test("입력 배열을 바꾸지 않는다 — 순수 함수다", () => {
    const list = steps([approver(1), approver(2)]);
    const snapshot = JSON.stringify(list);
    findNextRouteStepToApprove(list, 0, approver(1));
    assert.equal(JSON.stringify(list), snapshot);
  });

  test("돌려주는 것은 그 단계 원본이다 — 부르는 쪽의 다른 칸이 붙어 있어도 살아 남는다", () => {
    // 표를 읽는 층은 단계에 칸을 더 실어 보낼 수 있다(승인자 이름 등).
    const list = [{ stepOrder: 1, approverUserId: approver(1), approverName: "김철수" }];
    const next = findNextRouteStepToApprove(list, 0, approver(9));
    assert.equal(next?.approverName, "김철수");
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

describe("용도(scope)", () => {
  test("🔴 값 목록이 표의 enum 과 글자 그대로 같다 — 순서까지", () => {
    // 순서까지 맞추는 이유: enum 값은 ALTER TYPE ... ADD VALUE 로 뒤에 붙으므로,
    // 배열 순서가 실제 DB 의 순서와 어긋나면 다음 db:generate 가 있지도 않은
    // 차이를 감지한다(manual-step-set.test.ts 가 세운 선례다).
    assert.deepEqual(
      [...shipmentApprovalRouteScopeEnum.enumValues],
      [...SHIPMENT_APPROVAL_ROUTE_SCOPES]
    );
  });

  test("목록에 있는 값만 통과한다", () => {
    for (const scope of SHIPMENT_APPROVAL_ROUTE_SCOPES) {
      assert.equal(isShipmentApprovalRouteScope(scope), true, `${scope} 가 막혔다`);
    }
  });

  test("🔴 모르는 값·빈 값·다른 타입은 거절한다", () => {
    for (const bad of ["", " ", "final_shipment", "SHIPMENT", "PART", 0, 1, null, undefined, {}, []]) {
      assert.equal(
        isShipmentApprovalRouteScope(bad),
        false,
        `${JSON.stringify(bad)} 가 통과했다`
      );
    }
  });
});

/**
 * ============================================================================
 * 🔴 용도의 이름표와 「비었을 때」 안내 — 한 곳에만 적힌다
 * ============================================================================
 * 편집 화면(components/users/ShipmentApprovalRouteSection.tsx)의 고르는 자리·
 * 설명 문장·빈 상태와, 저장 결과 문구(server/actions/shipment-approval-routes.ts)가
 * 전부 아래 두 표를 본다. 두 곳에 적히면 같은 절차가 화면마다 다른 이름으로
 * 불리거나, 화면은 「대표가 처리합니다」라는데 저장은 다른 말을 하게 된다.
 * ============================================================================
 */
describe("용도의 이름표 · 빈 절차 안내", () => {
  test("🔴 모든 용도에 이름표가 있다 — 빠진 용도가 코드 값으로 새어 나가지 않는다", () => {
    assert.deepEqual(
      Object.keys(SHIPMENT_APPROVAL_ROUTE_SCOPE_LABELS).sort(),
      [...SHIPMENT_APPROVAL_ROUTE_SCOPES].sort()
    );
    for (const scope of SHIPMENT_APPROVAL_ROUTE_SCOPES) {
      const label = SHIPMENT_APPROVAL_ROUTE_SCOPE_LABELS[scope];
      assert.ok(label.trim().length > 0, `${scope}: 이름표가 비어 있다`);
      // 🔴 코드 값을 그대로 보여 주는 것은 이름표가 아니다.
      assert.notEqual(label, scope, `${scope}: 코드 값을 그대로 이름표로 썼다`);
      assert.ok(!/[A-Z_]{4,}/.test(label), `${scope}: 이름표에 코드 값이 섞여 있다 — ${label}`);
    }
  });

  test("🔴 이름표는 용도마다 다르다 — 같으면 화면에서 둘을 고를 수 없다", () => {
    const labels = SHIPMENT_APPROVAL_ROUTE_SCOPES.map(
      (scope) => SHIPMENT_APPROVAL_ROUTE_SCOPE_LABELS[scope]
    );
    assert.equal(new Set(labels).size, labels.length, `이름표가 겹친다: ${labels.join(" / ")}`);
  });

  test("🔴 「절차가 비었을 때」 안내가 용도마다 있고, 서로 다르다", () => {
    // 단계 0개는 「절차를 쓰지 않겠다」는 정상적인 뜻이고, 그때 **무엇이 그 일을
    // 대신하는지는 용도마다 다르다**. 한 문장으로 뭉뚱그리면 둘 중 하나에게는
    // 거짓말이 된다 — 실제로 출하만을 말하던 문장이 그렇게 틀린 말이 됐다.
    assert.deepEqual(
      Object.keys(SHIPMENT_APPROVAL_ROUTE_EMPTY_NOTICES).sort(),
      [...SHIPMENT_APPROVAL_ROUTE_SCOPES].sort()
    );
    const notices = SHIPMENT_APPROVAL_ROUTE_SCOPES.map(
      (scope) => SHIPMENT_APPROVAL_ROUTE_EMPTY_NOTICES[scope]
    );
    for (const [index, notice] of notices.entries()) {
      assert.ok(
        notice.trim().length > 0,
        `${SHIPMENT_APPROVAL_ROUTE_SCOPES[index]}: 안내가 비어 있다`
      );
    }
    assert.equal(new Set(notices).size, notices.length, "용도마다 같은 말을 하고 있다");
  });

  test("최종 출하 승인의 안내는 예전 문장 그대로다 — 출하 쪽 동작은 달라지지 않았다", () => {
    // 이 조각에서 출하 쪽은 한 글자도 바뀌지 않는다는 약속을 문구에서도 지킨다.
    assert.equal(
      SHIPMENT_APPROVAL_ROUTE_EMPTY_NOTICES.FINAL_SHIPMENT,
      "지금은 출하 대표로 지정된 사용자가 최종 출하 승인을 처리합니다."
    );
  });
});
