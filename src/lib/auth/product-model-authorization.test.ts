import { test } from "node:test";
import assert from "node:assert/strict";
import {
  canDeleteProductModels,
  canEditProductModels,
  canViewProductModels,
} from "./product-model-authorization";

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

test("canDeleteProductModels: SUPER_ADMIN/ADMIN only — 조회가 되는 역할도 삭제는 안 된다", () => {
  for (const role of ["SUPER_ADMIN", "ADMIN"] as const) {
    assert.equal(canDeleteProductModels(role), true, `expected ${role} to delete product models`);
  }
  for (const role of ["AS_ENGINEER", "SALES", "INVENTORY_MANAGER"] as const) {
    assert.equal(canDeleteProductModels(role), false, `expected ${role} not to delete product models`);
  }
});

test("canDeleteProductModels는 삭제·복원·완전삭제를 한 판정으로 묶는다", () => {
  // 고객사 쪽 canDeleteCustomers와 같은 결정. 셋을 쪼개려면 여기부터 고쳐야 한다.
  for (const role of ["SUPER_ADMIN", "ADMIN", "AS_ENGINEER", "SALES", "INVENTORY_MANAGER"] as const) {
    assert.equal(canDeleteProductModels(role), canEditProductModels(role), `${role}`);
  }
});
