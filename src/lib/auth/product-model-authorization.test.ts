import { test } from "node:test";
import assert from "node:assert/strict";
import { canEditProductModels, canViewProductModels } from "./product-model-authorization";

test("canViewProductModels: SUPER_ADMIN/ADMIN/AS_ENGINEER/SALES can view; INVENTORY_MANAGER cannot", () => {
  for (const role of ["SUPER_ADMIN", "ADMIN", "AS_ENGINEER", "SALES"] as const) {
    assert.equal(canViewProductModels(role), true, `expected ${role} to view product models`);
  }
  assert.equal(canViewProductModels("INVENTORY_MANAGER"), false);
});

test("canEditProductModels: SUPER_ADMIN/ADMIN only", () => {
  for (const role of ["SUPER_ADMIN", "ADMIN"] as const) {
    assert.equal(canEditProductModels(role), true, `expected ${role} to edit product models`);
  }
  for (const role of ["AS_ENGINEER", "SALES", "INVENTORY_MANAGER"] as const) {
    assert.equal(canEditProductModels(role), false, `expected ${role} not to edit product models`);
  }
});
