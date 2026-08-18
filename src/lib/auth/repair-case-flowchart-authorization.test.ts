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

test("SUPER_ADMIN, ADMIN, and AS_ENGINEER may mutate any repair case's flowcharts (Checkpoint 3A — no assignment scoping)", () => {
  for (const role of ["SUPER_ADMIN", "ADMIN", "AS_ENGINEER"] as const) {
    assert.equal(canMutateRepairCaseFlowchart(role, { isCaseLocked: false }), true, `${role} should be able to mutate any case`);
  }
});

test("SALES and INVENTORY_MANAGER may never mutate", () => {
  for (const role of ["SALES", "INVENTORY_MANAGER"] as const) {
    assert.equal(canMutateRepairCaseFlowchart(role, { isCaseLocked: false }), false);
  }
});

test("shipment-lock removal policy: isCaseLocked no longer blocks any role, including on an already-shipped case", () => {
  for (const role of ["SUPER_ADMIN", "ADMIN", "AS_ENGINEER"] as const) {
    assert.equal(canMutateRepairCaseFlowchart(role, { isCaseLocked: true }), true, `${role} must stay able to mutate a shipped case`);
  }
  for (const role of ["SALES", "INVENTORY_MANAGER"] as const) {
    assert.equal(canMutateRepairCaseFlowchart(role, { isCaseLocked: true }), false, `${role} is still denied by role, not by lock`);
  }
});
