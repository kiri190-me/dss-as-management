import { test } from "node:test";
import assert from "node:assert/strict";
import { canViewRepairCaseFlowcharts, canMutateRepairCaseFlowchart } from "./repair-case-flowchart-authorization";
import type { Role } from "@/lib/domain/types";

const ALL_ROLES: Role[] = ["SUPER_ADMIN", "ADMIN", "AS_ENGINEER", "SALES", "INVENTORY_MANAGER"];

test("all 5 roles may view repair-case flowcharts", () => {
  for (const role of ALL_ROLES) {
    assert.equal(canViewRepairCaseFlowcharts(role), true, `${role} should be able to view`);
  }
});

test("SUPER_ADMIN and ADMIN may mutate on any unlocked case, regardless of assignment", () => {
  for (const role of ["SUPER_ADMIN", "ADMIN"] as const) {
    assert.equal(canMutateRepairCaseFlowchart(role, { isAssignedToCase: false, isCaseLocked: false }), true);
  }
});

test("AS_ENGINEER may mutate only on their own assigned unlocked case", () => {
  assert.equal(canMutateRepairCaseFlowchart("AS_ENGINEER", { isAssignedToCase: true, isCaseLocked: false }), true);
  assert.equal(canMutateRepairCaseFlowchart("AS_ENGINEER", { isAssignedToCase: false, isCaseLocked: false }), false);
});

test("SALES and INVENTORY_MANAGER may never mutate, even assigned/unlocked", () => {
  for (const role of ["SALES", "INVENTORY_MANAGER"] as const) {
    assert.equal(canMutateRepairCaseFlowchart(role, { isAssignedToCase: true, isCaseLocked: false }), false);
  }
});

test("the lock check is unconditional — no role bypass, including SUPER_ADMIN", () => {
  for (const role of ALL_ROLES) {
    assert.equal(
      canMutateRepairCaseFlowchart(role, { isAssignedToCase: true, isCaseLocked: true }),
      false,
      `${role} must be blocked on a locked case`
    );
  }
});
