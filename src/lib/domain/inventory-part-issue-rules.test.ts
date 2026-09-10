import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  INVENTORY_PART_ISSUE_REQUEST_STATUSES,
  PART_ISSUE_APPROVAL_ROUTE_SCOPE,
  canTransitionPartIssueRequestStatus,
  isInventoryPartIssueRequestStatus,
  isPartIssueRequestAwaitingApproval,
  isPartIssueRequestCancellable,
  isPartIssueRequestExecutable,
  isPartIssueRequestTerminal,
  type InventoryPartIssueRequestStatus,
} from "./inventory-part-issue-rules";
import { SHIPMENT_APPROVAL_ROUTE_SCOPES } from "./shipment-approval-route";
import { inventoryPartIssueRequestStatusEnum } from "@/lib/db/schema/inventory-part-issue-requests";

/**
 * ============================================================================
 * 부품 불출 승인 — 순수 규칙
 * ============================================================================
 * 여기서 지키려는 것 넷:
 *  1. 🔴 **표의 enum 과 도메인 목록이 갈라지지 않는다.** 두 벌인 것은 이 저장소의
 *     관례이고(스키마 파일이 도메인 층을 가져오지 않는다), 그래서 맞춰 보는
 *     시험이 반드시 있어야 한다.
 *  2. 🔴 **이미 나간 것(EXECUTED)은 다시 나갈 수도, 물릴 수도 없다.** 이 두 거짓이
 *     이 파일에서 가장 중요하다 — 참이 되는 순간 같은 승인으로 두 번 빼는 길이
 *     열리고, 재고 장부와 신청이 서로 다른 말을 하게 된다.
 *  3. **승인과 실행은 다른 사건이다.** APPROVED 는 「지금 실행할 수 있다」이지
 *     「이미 나갔다」가 아니다.
 *  4. 결재선 용도는 새로 만든 값이 아니라 이미 있는 목록의 하나다.
 * ============================================================================
 */

const ALL_STATUSES = INVENTORY_PART_ISSUE_REQUEST_STATUSES;

describe("표의 enum 과 같은 목록인가", () => {
  test("도메인 목록과 inventory_part_issue_request_status 가 글자 그대로 같다", () => {
    assert.deepEqual(
      [...inventoryPartIssueRequestStatusEnum.enumValues],
      [...INVENTORY_PART_ISSUE_REQUEST_STATUSES]
    );
  });

  test("APPROVED 와 EXECUTED 가 둘 다 있다 — 이 둘을 뭉개면 설계가 무너진다", () => {
    assert.ok(ALL_STATUSES.includes("APPROVED"));
    assert.ok(ALL_STATUSES.includes("EXECUTED"));
  });

  test("결재선 용도는 이미 있는 목록의 값이다 — 새로 만든 것이 아니다", () => {
    assert.equal(PART_ISSUE_APPROVAL_ROUTE_SCOPE, "PART_ISSUE");
    assert.ok(
      (SHIPMENT_APPROVAL_ROUTE_SCOPES as readonly string[]).includes(
        PART_ISSUE_APPROVAL_ROUTE_SCOPE
      )
    );
  });
});

describe("isInventoryPartIssueRequestStatus", () => {
  test("목록에 있는 값만 받는다", () => {
    for (const status of ALL_STATUSES) {
      assert.equal(isInventoryPartIssueRequestStatus(status), true, status);
    }
  });

  test("화면이 보낸 엉뚱한 값은 거절한다", () => {
    for (const value of ["", "PENDING", "approved", "EXECUTE", null, undefined, 3, {}]) {
      assert.equal(isInventoryPartIssueRequestStatus(value), false, JSON.stringify(value));
    }
  });
});

describe("isPartIssueRequestExecutable — 지금 재고를 뺄 수 있는가", () => {
  test("APPROVED 하나뿐이다", () => {
    assert.equal(isPartIssueRequestExecutable("APPROVED"), true);
  });

  test("🔴 이미 나간 것(EXECUTED)은 다시 뺄 수 없다", () => {
    assert.equal(isPartIssueRequestExecutable("EXECUTED"), false);
  });

  test("결재 중·반려·취소도 뺄 수 없다", () => {
    assert.equal(isPartIssueRequestExecutable("PENDING_APPROVAL"), false);
    assert.equal(isPartIssueRequestExecutable("REJECTED"), false);
    assert.equal(isPartIssueRequestExecutable("CANCELLED"), false);
  });
});

describe("isPartIssueRequestAwaitingApproval — 지금 결재를 기다리는가", () => {
  test("PENDING_APPROVAL 하나뿐이다", () => {
    for (const status of ALL_STATUSES) {
      assert.equal(
        isPartIssueRequestAwaitingApproval(status),
        status === "PENDING_APPROVAL",
        status
      );
    }
  });

  test("결재를 기다리는 것과 실행할 수 있는 것은 동시에 참이 되지 않는다", () => {
    for (const status of ALL_STATUSES) {
      assert.equal(
        isPartIssueRequestAwaitingApproval(status) && isPartIssueRequestExecutable(status),
        false,
        status
      );
    }
  });
});

describe("상태 전이", () => {
  const cases: [InventoryPartIssueRequestStatus, InventoryPartIssueRequestStatus, boolean][] = [
    ["PENDING_APPROVAL", "APPROVED", true],
    ["PENDING_APPROVAL", "REJECTED", true],
    ["PENDING_APPROVAL", "CANCELLED", true],
    // 결재를 건너뛰고 바로 나가는 길은 없다.
    ["PENDING_APPROVAL", "EXECUTED", false],
    ["APPROVED", "EXECUTED", true],
    // 승인은 났지만 아직 안 나갔으므로 물릴 수 있다.
    ["APPROVED", "CANCELLED", true],
    // 결재가 끝난 뒤에 반려로 되돌아가지 않는다 — 반려는 결재 중에만 있다.
    ["APPROVED", "REJECTED", false],
    ["APPROVED", "PENDING_APPROVAL", false],
    // 🔴 나간 것은 어디로도 가지 않는다.
    ["EXECUTED", "CANCELLED", false],
    ["EXECUTED", "REJECTED", false],
    ["EXECUTED", "APPROVED", false],
    ["EXECUTED", "PENDING_APPROVAL", false],
    // 끝난 것을 되살리지 않는다 — 다시 하려면 새 신청이다.
    ["REJECTED", "PENDING_APPROVAL", false],
    ["REJECTED", "APPROVED", false],
    ["CANCELLED", "PENDING_APPROVAL", false],
    ["CANCELLED", "APPROVED", false],
  ];

  for (const [from, to, expected] of cases) {
    test(`${from} → ${to} : ${expected}`, () => {
      assert.equal(canTransitionPartIssueRequestStatus(from, to), expected);
    });
  }

  test("같은 상태로 가는 것은 전이가 아니다 — 두 번 눌린 단추가 조용히 통과하면 안 된다", () => {
    for (const status of ALL_STATUSES) {
      assert.equal(canTransitionPartIssueRequestStatus(status, status), false, status);
    }
  });
});

describe("isPartIssueRequestTerminal", () => {
  test("실행·반려·취소가 끝이다", () => {
    assert.equal(isPartIssueRequestTerminal("EXECUTED"), true);
    assert.equal(isPartIssueRequestTerminal("REJECTED"), true);
    assert.equal(isPartIssueRequestTerminal("CANCELLED"), true);
  });

  test("결재 중·승인됨은 아직 갈 곳이 있다", () => {
    assert.equal(isPartIssueRequestTerminal("PENDING_APPROVAL"), false);
    assert.equal(isPartIssueRequestTerminal("APPROVED"), false);
  });

  test("끝난 상태에서는 어디로도 갈 수 없다 — 전이표와 같은 말이다", () => {
    for (const status of ALL_STATUSES) {
      if (!isPartIssueRequestTerminal(status)) continue;
      for (const target of ALL_STATUSES) {
        assert.equal(
          canTransitionPartIssueRequestStatus(status, target),
          false,
          `${status} → ${target}`
        );
      }
    }
  });
});

describe("isPartIssueRequestCancellable", () => {
  test("결재 중이거나 승인만 난 것은 물릴 수 있다", () => {
    assert.equal(isPartIssueRequestCancellable("PENDING_APPROVAL"), true);
    assert.equal(isPartIssueRequestCancellable("APPROVED"), true);
  });

  test("🔴 이미 실행된 것은 취소할 수 없다", () => {
    assert.equal(isPartIssueRequestCancellable("EXECUTED"), false);
  });

  test("이미 끝난 것은 다시 물릴 것이 없다", () => {
    assert.equal(isPartIssueRequestCancellable("REJECTED"), false);
    assert.equal(isPartIssueRequestCancellable("CANCELLED"), false);
  });

  test("전이표에서 파생한다 — 두 곳에 각자 적혀 있지 않다", () => {
    for (const status of ALL_STATUSES) {
      assert.equal(
        isPartIssueRequestCancellable(status),
        canTransitionPartIssueRequestStatus(status, "CANCELLED"),
        status
      );
    }
  });
});
