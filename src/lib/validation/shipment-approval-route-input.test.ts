import { describe, test } from "node:test";
import assert from "node:assert/strict";

import { validateShipmentApprovalRouteInput } from "./shipment-approval-route-input";
import { MAX_SHIPMENT_APPROVAL_ROUTE_STEPS } from "@/lib/domain/shipment-approval-route";

/**
 * ============================================================================
 * 출하 승인 절차 입력 검증
 * ============================================================================
 * 여기서 못 박는 것 셋:
 *  1. **바깥에서 들어온 모양을 그대로 믿지 않는다** — 화면을 거치지 않고 서버
 *     액션을 부를 수 있으므로, 배열이 아닌 것·문자열이 아닌 원소·uuid 형식이
 *     아닌 값이 표까지 내려가면 안 된다.
 *  2. 🔴 **규칙 자체는 도메인 함수가 정한다** — 상한·중복·빈 자리는 그쪽 코드가
 *     내는 그대로 통과해야 한다. 여기에 같은 규칙을 다시 적으면 화면과 서버가
 *     다른 말을 하는 날이 온다.
 *  3. 🔴 **빈 배열은 정상이다** — 「절차를 쓰지 않겠다」는 뜻이라, 막으면 한 번
 *     만든 절차를 되돌릴 길이 없어진다(판은 지우지 않는다).
 * ============================================================================
 */

function approver(n: number): string {
  return `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
}

function approvers(count: number): string[] {
  return Array.from({ length: count }, (_, index) => approver(index + 1));
}

describe("validateShipmentApprovalRouteInput", () => {
  // ───────────────────────────────────────────────────── 통과하는 모양

  test("🔴 빈 목록은 통과한다 — 「절차를 쓰지 않겠다」는 정상적인 뜻이다", () => {
    const result = validateShipmentApprovalRouteInput({ approverUserIds: [] });
    assert.equal(result.ok, true);
    if (result.ok) assert.deepEqual(result.approverUserIds, []);
  });

  test("uuid 여럿은 순서 그대로 통과한다", () => {
    const ids = approvers(3);
    const result = validateShipmentApprovalRouteInput({ approverUserIds: ids });
    assert.equal(result.ok, true);
    if (result.ok) assert.deepEqual(result.approverUserIds, ids);
  });

  test("대문자 uuid 도 형식으로는 통과한다 — isValidUuid 가 대소문자를 가리지 않는다", () => {
    const result = validateShipmentApprovalRouteInput({
      approverUserIds: [approver(1).toUpperCase()],
    });
    assert.equal(result.ok, true);
  });

  test("돌려주는 배열은 새 배열이다 — 요청 객체와 자리를 나눠 쓰지 않는다", () => {
    const ids = approvers(2);
    const result = validateShipmentApprovalRouteInput({ approverUserIds: ids });
    assert.equal(result.ok, true);
    if (result.ok) assert.notEqual(result.approverUserIds, ids);
  });

  test("상한(10)까지는 통과한다 — 경계값이 열려 있어야 한다", () => {
    const result = validateShipmentApprovalRouteInput({
      approverUserIds: approvers(MAX_SHIPMENT_APPROVAL_ROUTE_STEPS),
    });
    assert.equal(result.ok, true);
  });

  // ────────────────────────────────────────────── 요청 모양이 아니다

  test("객체가 아니면 거절한다", () => {
    for (const bad of [null, undefined, "x", 3, true, [approver(1)]]) {
      const result = validateShipmentApprovalRouteInput(bad);
      assert.equal(result.ok, false, `${JSON.stringify(bad)} 가 통과했다`);
      if (!result.ok) assert.equal(result.code, "INVALID_INPUT");
    }
  });

  test("🔴 approverUserIds 가 배열이 아니면 거절한다", () => {
    for (const bad of [undefined, null, "abc", 3, {}]) {
      const result = validateShipmentApprovalRouteInput({ approverUserIds: bad });
      assert.equal(result.ok, false, `${JSON.stringify(bad)} 가 통과했다`);
      if (!result.ok) assert.equal(result.code, "INVALID_INPUT");
    }
  });

  test("🔴 원소가 문자열이 아니면 거절하고 몇 번째인지 알려 준다", () => {
    const result = validateShipmentApprovalRouteInput({
      approverUserIds: [approver(1), 42],
    });
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.code, "INVALID_INPUT");
    assert.match(result.message, /2번째/);
  });

  test("null 원소도 거절한다", () => {
    const result = validateShipmentApprovalRouteInput({ approverUserIds: [null] });
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.code, "INVALID_INPUT");
  });

  // ─────────────────────────────────────────────────── uuid 형식

  test("🔴 uuid 형식이 아닌 값은 거절한다 — 도메인 층은 형식을 보지 않는다", () => {
    for (const bad of ["u-001", "관리자", "00000000-0000-4000-8000-00000000000", `${approver(1)}x`]) {
      const result = validateShipmentApprovalRouteInput({ approverUserIds: [bad] });
      assert.equal(result.ok, false, `${bad} 가 통과했다`);
      if (!result.ok) {
        assert.equal(result.code, "INVALID_INPUT");
        assert.match(result.message, /1번째/);
      }
    }
  });

  test("앞뒤 공백이 붙은 uuid 도 형식이 아니다 — 다듬어 받아 주지 않는다", () => {
    // 다듬어 받으면 화면에서 본 값과 저장되는 값이 달라질 수 있고, 그 차이가
    // 「바뀐 게 없으면 새 판을 만들지 않는다」 판정을 흔든다.
    const result = validateShipmentApprovalRouteInput({ approverUserIds: [` ${approver(1)} `] });
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.code, "INVALID_INPUT");
  });

  // ───────────────────────────── 도메인 규칙이 그대로 나오는가

  test("🔴 빈 자리는 형식 오류가 아니라 「승인자를 선택해 주세요」로 걸린다", () => {
    // uuid 형식으로 먼저 거절해 버리면 관리자는 무엇을 고쳐야 하는지 모른다.
    const result = validateShipmentApprovalRouteInput({ approverUserIds: [approver(1), ""] });
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.code, "MISSING_APPROVER");
    assert.match(result.message, /2번째/);
  });

  test("공백만 든 자리도 빈 자리다", () => {
    const result = validateShipmentApprovalRouteInput({ approverUserIds: ["   "] });
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.code, "MISSING_APPROVER");
  });

  test("🔴 같은 사람이 두 번 들어 있으면 거절한다", () => {
    const result = validateShipmentApprovalRouteInput({
      approverUserIds: [approver(1), approver(2), approver(1)],
    });
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.code, "DUPLICATE_APPROVER");
    assert.match(result.message, /3번째/);
  });

  test("🔴 상한을 넘으면 거절한다", () => {
    const result = validateShipmentApprovalRouteInput({
      approverUserIds: approvers(MAX_SHIPMENT_APPROVAL_ROUTE_STEPS + 1),
    });
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.code, "TOO_MANY_STEPS");
    assert.match(result.message, /10/);
  });

  test("입력 배열을 바꾸지 않는다", () => {
    const ids = approvers(3);
    const snapshot = [...ids];
    validateShipmentApprovalRouteInput({ approverUserIds: ids });
    assert.deepEqual(ids, snapshot);
  });
});
