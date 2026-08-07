import { test } from "node:test";
import assert from "node:assert/strict";
import {
  canViewInventory,
  canCreateOrEditPart,
  canReceiveStock,
  canReturnStock,
  canSeeUseStockButton,
  canUseStock,
} from "./inventory-authorization";
import type { Role } from "@/lib/domain/types";

const ALL_ROLES: Role[] = ["SUPER_ADMIN", "ADMIN", "AS_ENGINEER", "SALES", "INVENTORY_MANAGER"];

test("canViewInventory: all 5 roles can view (unchanged existing behavior)", () => {
  for (const role of ALL_ROLES) assert.equal(canViewInventory(role), true, role);
});

test("canCreateOrEditPart: SUPER_ADMIN/ADMIN/INVENTORY_MANAGER only (unchanged existing behavior)", () => {
  assert.deepEqual(ALL_ROLES.filter(canCreateOrEditPart).sort(), ["ADMIN", "INVENTORY_MANAGER", "SUPER_ADMIN"]);
});

test("canReceiveStock: SUPER_ADMIN/ADMIN/INVENTORY_MANAGER only (unchanged existing behavior)", () => {
  assert.deepEqual(ALL_ROLES.filter(canReceiveStock).sort(), ["ADMIN", "INVENTORY_MANAGER", "SUPER_ADMIN"]);
});

test("canReturnStock: SUPER_ADMIN/ADMIN/INVENTORY_MANAGER only — this is also the exact RETURN-button visibility rule (unchanged existing behavior)", () => {
  assert.deepEqual(ALL_ROLES.filter(canReturnStock).sort(), ["ADMIN", "INVENTORY_MANAGER", "SUPER_ADMIN"]);
});

test("canSeeUseStockButton: every role except SALES", () => {
  assert.deepEqual(
    ALL_ROLES.filter(canSeeUseStockButton).sort(),
    ["ADMIN", "AS_ENGINEER", "INVENTORY_MANAGER", "SUPER_ADMIN"]
  );
  assert.equal(canSeeUseStockButton("SALES"), false);
});

test("USE button visibility matrix matches the approved Phase 5B-2 UI permission table", () => {
  // SUPER_ADMIN / ADMIN / INVENTORY_MANAGER: show 사용, show 반환
  for (const role of ["SUPER_ADMIN", "ADMIN", "INVENTORY_MANAGER"] as const) {
    assert.equal(canSeeUseStockButton(role), true, `${role} should see 사용`);
    assert.equal(canReturnStock(role), true, `${role} should see 반환`);
  }
  // AS_ENGINEER: show 사용, hide 반환
  assert.equal(canSeeUseStockButton("AS_ENGINEER"), true, "AS_ENGINEER should see 사용");
  assert.equal(canReturnStock("AS_ENGINEER"), false, "AS_ENGINEER should not see 반환");
  // SALES: hide both
  assert.equal(canSeeUseStockButton("SALES"), false, "SALES should not see 사용");
  assert.equal(canReturnStock("SALES"), false, "SALES should not see 반환");
});

test("canSeeUseStockButton is a visibility helper only — it does not replace canUseStock's live-context authorization", () => {
  // AS_ENGINEER passes the visibility check unconditionally...
  assert.equal(canSeeUseStockButton("AS_ENGINEER"), true);
  // ...but canUseStock (the real authorization check) still rejects an
  // AS_ENGINEER with no repair case, or one not assigned to it — the
  // button being visible never implies the mutation will succeed.
  assert.equal(
    canUseStock("AS_ENGINEER", {
      hasRepairCase: false,
      isCaseLocked: false,
      isAssignedToCase: false,
      isEffectiveAssigneeOfSuppliedNode: false,
    }),
    false,
    "AS_ENGINEER with no repair case is never authorized, regardless of button visibility"
  );
  assert.equal(
    canUseStock("AS_ENGINEER", {
      hasRepairCase: true,
      isCaseLocked: false,
      isAssignedToCase: false,
      isEffectiveAssigneeOfSuppliedNode: false,
    }),
    false,
    "AS_ENGINEER not assigned to the case is never authorized, regardless of button visibility"
  );
});

test("canUseStock: SUPER_ADMIN/ADMIN/INVENTORY_MANAGER may USE with only a destination note (no repair case) — unchanged existing behavior", () => {
  for (const role of ["SUPER_ADMIN", "ADMIN", "INVENTORY_MANAGER"] as const) {
    assert.equal(
      canUseStock(role, { hasRepairCase: false, isCaseLocked: false, isAssignedToCase: false, isEffectiveAssigneeOfSuppliedNode: false }),
      true,
      role
    );
  }
});

test("canUseStock: a locked case blocks USE unconditionally, for every role including SUPER_ADMIN — unchanged existing behavior", () => {
  for (const role of ALL_ROLES) {
    assert.equal(
      canUseStock(role, { hasRepairCase: true, isCaseLocked: true, isAssignedToCase: true, isEffectiveAssigneeOfSuppliedNode: true }),
      false,
      role
    );
  }
});

test("canUseStock: SALES is never authorized to USE, with or without a case — unchanged existing behavior", () => {
  assert.equal(
    canUseStock("SALES", { hasRepairCase: true, isCaseLocked: false, isAssignedToCase: true, isEffectiveAssigneeOfSuppliedNode: true }),
    false
  );
  assert.equal(
    canUseStock("SALES", { hasRepairCase: false, isCaseLocked: false, isAssignedToCase: false, isEffectiveAssigneeOfSuppliedNode: false }),
    false
  );
});
