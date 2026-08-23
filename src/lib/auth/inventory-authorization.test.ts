import { test } from "node:test";
import assert from "node:assert/strict";
import {
  canViewInventory,
  canCreateOrEditPart,
  canDeleteParts,
  canReceiveStock,
  canReturnStock,
  canSeeUseStockButton,
  canUseStock,
  canCreatePartRequest,
  canCancelOwnRequest,
  canProcessPartRequests,
  canViewPartRequests,
  canIssuePartRequest,
  canRejectPartRequest,
  canPartiallyCloseRequest,
  isRequestHoldable,
  isRequestHoldReleasable,
  statusAfterHoldRelease,
  isRequestIssuable,
  isRequestRejectable,
} from "./inventory-authorization";
import type { Role } from "@/lib/domain/types";

const ALL_ROLES: Role[] = ["SUPER_ADMIN", "ADMIN", "AS_ENGINEER", "SALES", "INVENTORY_MANAGER"];
const PRIVILEGED_ROLES = ["SUPER_ADMIN", "ADMIN", "INVENTORY_MANAGER"] as const;

test("canViewInventory: all 5 roles can view (unchanged existing behavior)", () => {
  for (const role of ALL_ROLES) assert.equal(canViewInventory(role), true, role);
});

test("canCreateOrEditPart: SUPER_ADMIN/ADMIN/INVENTORY_MANAGER only (unchanged existing behavior)", () => {
  assert.deepEqual(ALL_ROLES.filter(canCreateOrEditPart).sort(), ["ADMIN", "INVENTORY_MANAGER", "SUPER_ADMIN"]);
});

test("canReceiveStock: SUPER_ADMIN/ADMIN/INVENTORY_MANAGER only (unchanged existing behavior)", () => {
  assert.deepEqual(ALL_ROLES.filter(canReceiveStock).sort(), ["ADMIN", "INVENTORY_MANAGER", "SUPER_ADMIN"]);
});

test("canReturnStock: SUPER_ADMIN/ADMIN/INVENTORY_MANAGER only (unchanged existing behavior)", () => {
  assert.deepEqual(ALL_ROLES.filter(canReturnStock).sort(), ["ADMIN", "INVENTORY_MANAGER", "SUPER_ADMIN"]);
});

test("Phase 5B-3: canSeeUseStockButton narrows to the same three privileged roles as canReturnStock — AS_ENGINEER no longer sees 사용 at all", () => {
  assert.deepEqual(ALL_ROLES.filter(canSeeUseStockButton).sort(), ["ADMIN", "INVENTORY_MANAGER", "SUPER_ADMIN"]);
  assert.equal(canSeeUseStockButton("AS_ENGINEER"), false);
  assert.equal(canSeeUseStockButton("SALES"), false);
});

test("Phase 5B-3: canUseStock(\"AS_ENGINEER\", ...) is always false, regardless of case/assignment context", () => {
  assert.equal(canUseStock("AS_ENGINEER", { hasRepairCase: false, isCaseLocked: false }), false);
  assert.equal(canUseStock("AS_ENGINEER", { hasRepairCase: true, isCaseLocked: false }), false);
});

test("canUseStock: SUPER_ADMIN/ADMIN/INVENTORY_MANAGER behavior is unchanged — may USE with only a destination note (no repair case)", () => {
  for (const role of PRIVILEGED_ROLES) {
    assert.equal(canUseStock(role, { hasRepairCase: false, isCaseLocked: false }), true, role);
  }
});

test("canUseStock: shipment-lock removal policy — a shipped (locked) case no longer blocks USE for the privileged roles", () => {
  for (const role of PRIVILEGED_ROLES) {
    assert.equal(canUseStock(role, { hasRepairCase: true, isCaseLocked: true }), true, role);
  }
  assert.equal(canUseStock("AS_ENGINEER", { hasRepairCase: true, isCaseLocked: true }), false, "still denied by role, not by lock");
  assert.equal(canUseStock("SALES", { hasRepairCase: true, isCaseLocked: true }), false, "still denied by role, not by lock");
});

test("canUseStock: SALES is never authorized to USE, with or without a case — unchanged existing behavior", () => {
  assert.equal(canUseStock("SALES", { hasRepairCase: true, isCaseLocked: false }), false);
  assert.equal(canUseStock("SALES", { hasRepairCase: false, isCaseLocked: false }), false);
});

// ---- Phase 5B-3: Parts Request & Issue Workflow ----

test("canCreatePartRequest: AS_ENGINEER only, assignment NOT required (Parts Request permission checkpoint); shipment-lock removal policy — a shipped case no longer blocks", () => {
  assert.equal(canCreatePartRequest("AS_ENGINEER", { isCaseLocked: false }), true, "any AS_ENGINEER may request, not only the assigned one");
  assert.equal(canCreatePartRequest("AS_ENGINEER", { isCaseLocked: true }), true, "a shipped case no longer blocks an AS_ENGINEER");
  for (const role of ["SUPER_ADMIN", "ADMIN", "INVENTORY_MANAGER", "SALES"] as const) {
    assert.equal(canCreatePartRequest(role, { isCaseLocked: false }), false, `${role} cannot create a request (no on-behalf creation)`);
  }
});

test("canCancelOwnRequest: AS_ENGINEER only, own request only, PENDING only", () => {
  assert.equal(canCancelOwnRequest("AS_ENGINEER", { isOwnRequest: true, status: "PENDING" }), true);
  assert.equal(canCancelOwnRequest("AS_ENGINEER", { isOwnRequest: false, status: "PENDING" }), false, "not their own request");
  assert.equal(canCancelOwnRequest("AS_ENGINEER", { isOwnRequest: true, status: "PARTIALLY_ISSUED" }), false, "cannot cancel once anything has been issued");
  assert.equal(canCancelOwnRequest("SUPER_ADMIN", { isOwnRequest: true, status: "PENDING" }), false, "only AS_ENGINEER, never a privileged role, even for their own");
});

test("canProcessPartRequests / canViewPartRequests: SALES has zero access, AS_ENGINEER may view (own) but not process", () => {
  assert.deepEqual(ALL_ROLES.filter(canProcessPartRequests).sort(), ["ADMIN", "INVENTORY_MANAGER", "SUPER_ADMIN"]);
  assert.equal(canProcessPartRequests("SALES"), false);
  assert.equal(canProcessPartRequests("AS_ENGINEER"), false);

  assert.equal(canViewPartRequests("AS_ENGINEER"), true, "AS_ENGINEER can view (their own) requests");
  assert.equal(canViewPartRequests("SALES"), false, "SALES has no request-screen access at all");
  for (const role of PRIVILEGED_ROLES) assert.equal(canViewPartRequests(role), true, role);
});

test("canIssuePartRequest: same three privileged roles, only PENDING/PARTIALLY_ISSUED are issuable; shipment-lock removal policy — a shipped case no longer blocks", () => {
  for (const role of PRIVILEGED_ROLES) {
    assert.equal(canIssuePartRequest(role, { isCaseLocked: false, status: "PENDING" }), true, role);
    assert.equal(canIssuePartRequest(role, { isCaseLocked: false, status: "PARTIALLY_ISSUED" }), true, role);
    assert.equal(canIssuePartRequest(role, { isCaseLocked: true, status: "PENDING" }), true, `${role}: a shipped case no longer blocks issue`);
    for (const terminal of ["FULLY_ISSUED", "PARTIALLY_CLOSED", "REJECTED", "CANCELLED"] as const) {
      assert.equal(canIssuePartRequest(role, { isCaseLocked: false, status: terminal }), false, `${role}/${terminal}`);
    }
  }
  assert.equal(canIssuePartRequest("AS_ENGINEER", { isCaseLocked: false, status: "PENDING" }), false, "AS_ENGINEER can never issue");
  assert.equal(canIssuePartRequest("SALES", { isCaseLocked: false, status: "PENDING" }), false);
});

test("canRejectPartRequest: same three privileged roles, only a PENDING request with zero issued — no lock check (reject never deducts stock)", () => {
  for (const role of PRIVILEGED_ROLES) {
    assert.equal(canRejectPartRequest(role, { status: "PENDING", issuedQuantityAcrossItems: 0 }), true, role);
    assert.equal(canRejectPartRequest(role, { status: "PENDING", issuedQuantityAcrossItems: 1 }), false, `${role}: cannot reject once anything is issued`);
    assert.equal(canRejectPartRequest(role, { status: "PARTIALLY_ISSUED", issuedQuantityAcrossItems: 0 }), false, `${role}: status itself must be PENDING, not just zero-issued`);
    assert.equal(canRejectPartRequest(role, { status: "CANCELLED", issuedQuantityAcrossItems: 0 }), false, `${role}: an already-terminal request cannot be rejected`);
  }
  assert.equal(canRejectPartRequest("AS_ENGINEER", { status: "PENDING", issuedQuantityAcrossItems: 0 }), false);
  assert.equal(canRejectPartRequest("SALES", { status: "PENDING", issuedQuantityAcrossItems: 0 }), false);
});

test("canPartiallyCloseRequest: same three privileged roles, requires status PARTIALLY_ISSUED and issued>0 AND remaining>0 — no lock check (never deducts stock)", () => {
  for (const role of PRIVILEGED_ROLES) {
    assert.equal(canPartiallyCloseRequest(role, { status: "PARTIALLY_ISSUED", issuedQuantityAcrossItems: 6, remainingQuantityAcrossItems: 4 }), true, role);
    assert.equal(canPartiallyCloseRequest(role, { status: "PARTIALLY_ISSUED", issuedQuantityAcrossItems: 0, remainingQuantityAcrossItems: 10 }), false, "nothing issued yet");
    assert.equal(canPartiallyCloseRequest(role, { status: "PARTIALLY_ISSUED", issuedQuantityAcrossItems: 10, remainingQuantityAcrossItems: 0 }), false, "already fully issued");
    assert.equal(canPartiallyCloseRequest(role, { status: "PENDING", issuedQuantityAcrossItems: 6, remainingQuantityAcrossItems: 4 }), false, "status itself must be PARTIALLY_ISSUED");
  }
  assert.equal(canPartiallyCloseRequest("AS_ENGINEER", { status: "PARTIALLY_ISSUED", issuedQuantityAcrossItems: 6, remainingQuantityAcrossItems: 4 }), false);
  assert.equal(canPartiallyCloseRequest("SALES", { status: "PARTIALLY_ISSUED", issuedQuantityAcrossItems: 6, remainingQuantityAcrossItems: 4 }), false);
});

test("locked-case exception is scoped correctly: cancel/reject/partial-close never check lock state at all (still callable on a locked case)", () => {
  // These functions don't even accept an isCaseLocked parameter — this
  // test documents that omission is deliberate, not an oversight, by
  // exercising them in a way that would be blocked if a lock check existed.
  assert.equal(canCancelOwnRequest("AS_ENGINEER", { isOwnRequest: true, status: "PENDING" }), true);
  assert.equal(canRejectPartRequest("INVENTORY_MANAGER", { status: "PENDING", issuedQuantityAcrossItems: 0 }), true);
  assert.equal(canPartiallyCloseRequest("INVENTORY_MANAGER", { status: "PARTIALLY_ISSUED", issuedQuantityAcrossItems: 3, remainingQuantityAcrossItems: 2 }), true);
});

// ────────────────────────────────────────────────────────────────── 보류

test("보류는 아직 끝나지 않은 요청에만 걸린다", () => {
  assert.equal(isRequestHoldable({ status: "PENDING" }), true);
  assert.equal(isRequestHoldable({ status: "PARTIALLY_ISSUED" }), true);
  // 끝난 요청에는 멈출 것이 없다.
  assert.equal(isRequestHoldable({ status: "FULLY_ISSUED" }), false);
  assert.equal(isRequestHoldable({ status: "PARTIALLY_CLOSED" }), false);
  assert.equal(isRequestHoldable({ status: "REJECTED" }), false);
  assert.equal(isRequestHoldable({ status: "CANCELLED" }), false);
  // 이미 보류 중인 것을 또 보류하는 것도 뜻이 없다.
  assert.equal(isRequestHoldable({ status: "ON_HOLD" }), false);
});

test("보류 중에는 불출도 거절도 막힌다", () => {
  // 따로 조건을 넣지 않았다 — 두 술어의 상태 목록에 ON_HOLD가 없어서 저절로
  // 막힌다. 이 테스트는 그 사실이 우연이 아니라 의도임을 고정한다.
  assert.equal(isRequestIssuable({ status: "ON_HOLD" }), false);
  assert.equal(isRequestRejectable({ status: "ON_HOLD", issuedQuantityAcrossItems: 0 }), false);
});

test("해제는 보류 중일 때만 된다", () => {
  assert.equal(isRequestHoldReleasable({ status: "ON_HOLD" }), true);
  assert.equal(isRequestHoldReleasable({ status: "PENDING" }), false);
  assert.equal(isRequestHoldReleasable({ status: "PARTIALLY_ISSUED" }), false);
});

test("해제하면 나간 수량에 따라 돌아갈 상태가 정해진다", () => {
  // 보류 직전 상태를 저장하지 않는 이유다 — 그 사이 불출이 일어났다면 옛 상태로
  // 되돌리는 것이 오히려 틀린 답이 된다.
  assert.equal(statusAfterHoldRelease({ issuedQuantityAcrossItems: 0 }), "PENDING");
  assert.equal(statusAfterHoldRelease({ issuedQuantityAcrossItems: 3 }), "PARTIALLY_ISSUED");
});

test("canDeleteParts: SUPER_ADMIN/ADMIN only — 등록·수정이 되는 재고 담당자도 삭제는 안 된다", () => {
  assert.equal(canDeleteParts("SUPER_ADMIN"), true);
  assert.equal(canDeleteParts("ADMIN"), true);
  // 이 한 줄이 정책의 핵심이다 — 부품을 만들고 고치는 것은 재고 담당자까지지만,
  // 지우는 것은 관리자 이상이다("되돌리는 권한은 더 좁다"는 이 저장소의 규칙).
  assert.equal(canDeleteParts("INVENTORY_MANAGER"), false);
  assert.equal(canCreateOrEditPart("INVENTORY_MANAGER"), true);
  for (const role of ["AS_ENGINEER", "SALES"] as const) {
    assert.equal(canDeleteParts(role), false, `expected ${role} not to delete parts`);
  }
});
