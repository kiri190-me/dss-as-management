import { describe, test } from "node:test";
import assert from "node:assert/strict";

import {
  validateEditableShipmentApprovalRouteInput,
  validateShipmentApprovalRouteInput,
} from "./shipment-approval-route-input";
import {
  EDITABLE_SHIPMENT_APPROVAL_ROUTE_SCOPES,
  MAX_SHIPMENT_APPROVAL_ROUTE_STEPS,
  SHIPMENT_APPROVAL_ROUTE_SCOPES,
} from "@/lib/domain/shipment-approval-route";
import { PART_ISSUE_APPROVAL_ROUTE_SCOPE } from "@/lib/domain/inventory-part-issue-rules";

/**
 * ============================================================================
 * 승인 절차 입력 검증
 * ============================================================================
 * 여기서 못 박는 것 넷:
 *  1. **바깥에서 들어온 모양을 그대로 믿지 않는다** — 화면을 거치지 않고 서버
 *     액션을 부를 수 있으므로, 배열이 아닌 것·문자열이 아닌 원소·uuid 형식이
 *     아닌 값이 표까지 내려가면 안 된다.
 *  2. 🔴 **규칙 자체는 도메인 함수가 정한다** — 상한·중복·빈 자리는 그쪽 코드가
 *     내는 그대로 통과해야 한다. 여기에 같은 규칙을 다시 적으면 화면과 서버가
 *     다른 말을 하는 날이 온다.
 *  3. 🔴 **빈 배열은 정상이다** — 「절차를 쓰지 않겠다」는 뜻이라, 막으면 한 번
 *     만든 절차를 되돌릴 길이 없어진다(판은 지우지 않는다).
 *  4. 🔴 **용도(scope)는 반드시 적혀 있어야 하고, 목록에 있는 값이어야 한다** —
 *     「없으면 출하」로 채워 주면 용도를 빠뜨린 요청이 조용히 출하 절차를 덮어쓴다.
 *
 * ── 🔴 입구가 둘이다 (2026-10-18) ───────────────────────────────────────
 * `validateShipmentApprovalRouteInput` 은 **표에 넣을 수 있는 값 전부**를 받는다 —
 * mutation 이 이것을 쓰고, 사용자 삭제가 지울 사람이 올라 있던 결재선마다 새 판을
 * 얹을 때 `PART_ISSUE` 를 그대로 넘긴다.
 * `validateEditableShipmentApprovalRouteInput` 은 **[승인 절차] 탭이 저장할 때**
 * 쓰는 입구고, 거기서 「부품 불출」이 빠졌다. 아래에서 **둘을 따로** 시험한다 —
 * 하나로 합치면 사용자 삭제가 조용히 깨진다(입력이 `unknown` 이라 타입 검사에
 * 걸리지 않는다).
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
    const result = validateShipmentApprovalRouteInput({ scope: "FINAL_SHIPMENT", approverUserIds: [] });
    assert.equal(result.ok, true);
    if (result.ok) assert.deepEqual(result.approverUserIds, []);
  });

  test("uuid 여럿은 순서 그대로 통과한다", () => {
    const ids = approvers(3);
    const result = validateShipmentApprovalRouteInput({ scope: "FINAL_SHIPMENT", approverUserIds: ids });
    assert.equal(result.ok, true);
    if (result.ok) assert.deepEqual(result.approverUserIds, ids);
  });

  test("대문자 uuid 도 형식으로는 통과한다 — isValidUuid 가 대소문자를 가리지 않는다", () => {
    const result = validateShipmentApprovalRouteInput({
      scope: "FINAL_SHIPMENT",
      approverUserIds: [approver(1).toUpperCase()],
    });
    assert.equal(result.ok, true);
  });

  test("돌려주는 배열은 새 배열이다 — 요청 객체와 자리를 나눠 쓰지 않는다", () => {
    const ids = approvers(2);
    const result = validateShipmentApprovalRouteInput({ scope: "FINAL_SHIPMENT", approverUserIds: ids });
    assert.equal(result.ok, true);
    if (result.ok) assert.notEqual(result.approverUserIds, ids);
  });

  test("상한(10)까지는 통과한다 — 경계값이 열려 있어야 한다", () => {
    const result = validateShipmentApprovalRouteInput({
      scope: "FINAL_SHIPMENT",
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
      const result = validateShipmentApprovalRouteInput({ scope: "FINAL_SHIPMENT", approverUserIds: bad });
      assert.equal(result.ok, false, `${JSON.stringify(bad)} 가 통과했다`);
      if (!result.ok) assert.equal(result.code, "INVALID_INPUT");
    }
  });

  test("🔴 원소가 문자열이 아니면 거절하고 몇 번째인지 알려 준다", () => {
    const result = validateShipmentApprovalRouteInput({
      scope: "FINAL_SHIPMENT",
      approverUserIds: [approver(1), 42],
    });
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.code, "INVALID_INPUT");
    assert.match(result.message, /2번째/);
  });

  test("null 원소도 거절한다", () => {
    const result = validateShipmentApprovalRouteInput({ scope: "FINAL_SHIPMENT", approverUserIds: [null] });
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.code, "INVALID_INPUT");
  });

  // ─────────────────────────────────────────────────── uuid 형식

  test("🔴 uuid 형식이 아닌 값은 거절한다 — 도메인 층은 형식을 보지 않는다", () => {
    for (const bad of ["u-001", "관리자", "00000000-0000-4000-8000-00000000000", `${approver(1)}x`]) {
      const result = validateShipmentApprovalRouteInput({ scope: "FINAL_SHIPMENT", approverUserIds: [bad] });
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
    const result = validateShipmentApprovalRouteInput({ scope: "FINAL_SHIPMENT", approverUserIds: [` ${approver(1)} `] });
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.code, "INVALID_INPUT");
  });

  // ───────────────────────────── 도메인 규칙이 그대로 나오는가

  test("🔴 빈 자리는 형식 오류가 아니라 「승인자를 선택해 주세요」로 걸린다", () => {
    // uuid 형식으로 먼저 거절해 버리면 관리자는 무엇을 고쳐야 하는지 모른다.
    const result = validateShipmentApprovalRouteInput({ scope: "FINAL_SHIPMENT", approverUserIds: [approver(1), ""] });
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.code, "MISSING_APPROVER");
    assert.match(result.message, /2번째/);
  });

  test("공백만 든 자리도 빈 자리다", () => {
    const result = validateShipmentApprovalRouteInput({ scope: "FINAL_SHIPMENT", approverUserIds: ["   "] });
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.code, "MISSING_APPROVER");
  });

  test("🔴 같은 사람이 두 번 들어 있으면 거절한다", () => {
    const result = validateShipmentApprovalRouteInput({
      scope: "FINAL_SHIPMENT",
      approverUserIds: [approver(1), approver(2), approver(1)],
    });
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.code, "DUPLICATE_APPROVER");
    assert.match(result.message, /3번째/);
  });

  test("🔴 상한을 넘으면 거절한다", () => {
    const result = validateShipmentApprovalRouteInput({
      scope: "FINAL_SHIPMENT",
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
    validateShipmentApprovalRouteInput({ scope: "FINAL_SHIPMENT", approverUserIds: ids });
    assert.deepEqual(ids, snapshot);
  });

  // ───────────────────────────────────────────────────────── 용도(scope)

  test("🔴 용도를 적지 않으면 거절한다 — 「없으면 출하」로 채워 주지 않는다", () => {
    // 채워 주면 용도를 빠뜨린 요청이 조용히 출하 절차를 덮어쓴다.
    const result = validateShipmentApprovalRouteInput({ approverUserIds: [approver(1)] });
    assert.equal(result.ok, false, "용도 없이 통과했다");
    if (!result.ok) assert.equal(result.code, "INVALID_INPUT");
  });

  test("🔴 목록에 없는 용도는 거절한다", () => {
    for (const bad of ["", "final_shipment", "SHIPMENT", 3, null, {}]) {
      const result = validateShipmentApprovalRouteInput({
        scope: bad,
        approverUserIds: [approver(1)],
      });
      assert.equal(result.ok, false, `${JSON.stringify(bad)} 가 통과했다`);
      if (!result.ok) assert.equal(result.code, "INVALID_INPUT");
    }
  });

  test("허용된 용도는 그대로 돌아온다 — 부르는 쪽이 검증을 지난 값을 쓴다", () => {
    for (const scope of SHIPMENT_APPROVAL_ROUTE_SCOPES) {
      const result = validateShipmentApprovalRouteInput({ scope, approverUserIds: [approver(1)] });
      assert.equal(result.ok, true, `${scope} 가 막혔다`);
      if (result.ok) assert.equal(result.scope, scope);
    }
  });

  test("🔴 「부품 불출」은 여기서 막지 않는다 — 사용자 삭제가 그 판을 이어 쓴다", () => {
    // 계정을 지우면 그 사람이 올라 있던 결재선마다 새 판을 얹는데
    // (db/mutations/user-deletion.ts → saveShipmentApprovalRouteInTx → 이 함수),
    // 그 결재선에는 'PART_ISSUE' 가 섞여 있다. 여기를 좁히면 그 길이 끊어지고,
    // 입력이 unknown 이라 **타입 검사로는 드러나지 않는다** — 실제 삭제에서야
    // 터진다. 탭에서 들어오는 길을 막는 것은 아래 「고칠 수 있는 용도만」 쪽이다.
    const result = validateShipmentApprovalRouteInput({
      scope: PART_ISSUE_APPROVAL_ROUTE_SCOPE,
      approverUserIds: [approver(1)],
    });
    assert.equal(result.ok, true, "사용자 삭제가 쓰는 길이 막혔다");
  });

  test("🔴 용도를 승인자 목록보다 **먼저** 본다 — 둘 다 틀렸을 때 용도부터 말한다", () => {
    // 어느 절차인지 모르는 채로 「2번째 단계의 승인자를…」이라고 말하면, 사람은
    // 엉뚱한 화면에서 고칠 곳을 찾게 된다.
    const result = validateShipmentApprovalRouteInput({ scope: "NOPE", approverUserIds: "x" });
    assert.equal(result.ok, false);
    if (!result.ok) assert.match(result.message, /승인 절차/);
  });
});

/**
 * ============================================================================
 * 🔴 [승인 절차] 탭이 저장할 때 쓰는 입구 — 「부품 불출」은 들어올 수 없다
 * ============================================================================
 * 2026-10-18: 재고 관리가 별도 시스템으로 떨어져 나가면서 부품 불출 결재선은
 * 그쪽에서 돈다. A/S 의 고르개에서만 치우고 저장을 열어 두면 **손으로 만든 요청이
 * 그대로 통과해** A/S 가 다시 덮어쓴다 — 서버 액션은 네트워크 경계 너머에서
 * 불리므로 타입은 거기서 아무것도 막지 못한다.
 * ============================================================================
 */
describe("validateEditableShipmentApprovalRouteInput", () => {
  test("🔴 부품 불출은 거절한다", () => {
    const result = validateEditableShipmentApprovalRouteInput({
      scope: PART_ISSUE_APPROVAL_ROUTE_SCOPE,
      approverUserIds: [approver(1)],
    });
    assert.equal(result.ok, false, "부품 불출이 탭의 저장 경로를 통과했다");
    if (!result.ok) assert.equal(result.code, "INVALID_INPUT");
  });

  test("🔴 거절 문구가 「모르는 용도」와 같다 — 어떤 값이 있는지 알려 주지 않는다", () => {
    const blocked = validateEditableShipmentApprovalRouteInput({
      scope: PART_ISSUE_APPROVAL_ROUTE_SCOPE,
      approverUserIds: [approver(1)],
    });
    const unknown = validateEditableShipmentApprovalRouteInput({
      scope: "NOPE",
      approverUserIds: [approver(1)],
    });
    assert.equal(blocked.ok, false);
    assert.equal(unknown.ok, false);
    if (!blocked.ok && !unknown.ok) assert.equal(blocked.message, unknown.message);
  });

  test("🔴 출하·견적은 그대로 통과하고 값이 그대로 돌아온다", () => {
    for (const scope of EDITABLE_SHIPMENT_APPROVAL_ROUTE_SCOPES) {
      const ids = [approver(1), approver(2)];
      const result = validateEditableShipmentApprovalRouteInput({
        scope,
        approverUserIds: ids,
      });
      assert.equal(result.ok, true, `${scope} 가 막혔다`);
      if (result.ok) {
        assert.equal(result.scope, scope);
        assert.deepEqual(result.approverUserIds, ids);
      }
    }
  });

  test("🔴 빈 배열은 그대로 정상이다 — 절차를 끄는 유일한 출구를 막지 않는다", () => {
    for (const scope of EDITABLE_SHIPMENT_APPROVAL_ROUTE_SCOPES) {
      const result = validateEditableShipmentApprovalRouteInput({ scope, approverUserIds: [] });
      assert.equal(result.ok, true, `${scope}: 0개짜리 판을 막았다`);
      if (result.ok) assert.deepEqual(result.approverUserIds, []);
    }
  });

  test("바깥쪽 검사는 그대로 지난다 — 규칙을 다시 적지 않았다", () => {
    const duplicated = validateEditableShipmentApprovalRouteInput({
      scope: "FINAL_SHIPMENT",
      approverUserIds: [approver(1), approver(1)],
    });
    assert.equal(duplicated.ok, false);
    if (!duplicated.ok) assert.equal(duplicated.code, "DUPLICATE_APPROVER");

    const tooMany = validateEditableShipmentApprovalRouteInput({
      scope: "FINAL_SHIPMENT",
      approverUserIds: approvers(MAX_SHIPMENT_APPROVAL_ROUTE_STEPS + 1),
    });
    assert.equal(tooMany.ok, false);
    if (!tooMany.ok) assert.equal(tooMany.code, "TOO_MANY_STEPS");
  });
});
