import { test } from "node:test";
import assert from "node:assert/strict";
import {
  canAddEndUserContact,
  canCreateEndUser,
  canEditCustomers,
  canEditEndUserContact,
  canRemoveEndUserContact,
  canRenameEndUser,
  canViewCustomers,
  canDeleteCustomers,
} from "./customer-authorization";

test("canViewCustomers: SUPER_ADMIN/ADMIN/AS_ENGINEER/SALES can view; INVENTORY_MANAGER cannot", () => {
  for (const role of ["SUPER_ADMIN", "ADMIN", "AS_ENGINEER", "SALES"] as const) {
    assert.equal(canViewCustomers(role), true, `expected ${role} to view customers`);
  }
  assert.equal(canViewCustomers("INVENTORY_MANAGER"), false);
});

test("canEditCustomers: SUPER_ADMIN/ADMIN only", () => {
  assert.equal(canEditCustomers("SUPER_ADMIN"), true);
  assert.equal(canEditCustomers("ADMIN"), true);
  for (const role of ["AS_ENGINEER", "SALES", "INVENTORY_MANAGER"] as const) {
    assert.equal(canEditCustomers(role), false, `expected ${role} not to edit customers`);
  }
});

test("canCreateEndUser: SUPER_ADMIN/ADMIN/AS_ENGINEER/SALES can create; INVENTORY_MANAGER cannot", () => {
  for (const role of ["SUPER_ADMIN", "ADMIN", "AS_ENGINEER", "SALES"] as const) {
    assert.equal(canCreateEndUser(role), true, `expected ${role} to create End-Users`);
  }
  assert.equal(canCreateEndUser("INVENTORY_MANAGER"), false);
});

test("canRenameEndUser: SUPER_ADMIN/ADMIN only — AS_ENGINEER/SALES may create but not rename", () => {
  assert.equal(canRenameEndUser("SUPER_ADMIN"), true);
  assert.equal(canRenameEndUser("ADMIN"), true);
  for (const role of ["AS_ENGINEER", "SALES", "INVENTORY_MANAGER"] as const) {
    assert.equal(canRenameEndUser(role), false, `expected ${role} not to rename End-Users`);
  }
});

test("canAddEndUserContact/canEditEndUserContact: SUPER_ADMIN/ADMIN/AS_ENGINEER/SALES; INVENTORY_MANAGER cannot", () => {
  for (const role of ["SUPER_ADMIN", "ADMIN", "AS_ENGINEER", "SALES"] as const) {
    assert.equal(canAddEndUserContact(role), true, `expected ${role} to add contacts`);
    assert.equal(canEditEndUserContact(role), true, `expected ${role} to edit contacts`);
  }
  assert.equal(canAddEndUserContact("INVENTORY_MANAGER"), false);
  assert.equal(canEditEndUserContact("INVENTORY_MANAGER"), false);
});

test("canRemoveEndUserContact: SUPER_ADMIN/ADMIN only — AS_ENGINEER/SALES may add/edit but not remove", () => {
  assert.equal(canRemoveEndUserContact("SUPER_ADMIN"), true);
  assert.equal(canRemoveEndUserContact("ADMIN"), true);
  for (const role of ["AS_ENGINEER", "SALES", "INVENTORY_MANAGER"] as const) {
    assert.equal(canRemoveEndUserContact(role), false, `expected ${role} not to remove contacts`);
  }
});

test("canDeleteCustomers: SUPER_ADMIN/ADMIN only — 조회·등록이 되는 역할도 삭제는 안 된다", () => {
  assert.equal(canDeleteCustomers("SUPER_ADMIN"), true);
  assert.equal(canDeleteCustomers("ADMIN"), true);
  for (const role of ["AS_ENGINEER", "SALES", "INVENTORY_MANAGER"] as const) {
    assert.equal(canDeleteCustomers(role), false, `expected ${role} not to delete customers`);
  }
});

test("canDeleteCustomers는 삭제·복원·완전삭제를 한 판정으로 묶는다", () => {
  // 셋을 따로 두면 "지울 수는 있는데 되돌릴 수는 없는" 역할이 만들어진다.
  // 이 테스트는 그 결정을 고정한다 — 나중에 셋을 쪼개려면 여기부터 고쳐야 한다.
  for (const role of ["SUPER_ADMIN", "ADMIN", "AS_ENGINEER", "SALES", "INVENTORY_MANAGER"] as const) {
    assert.equal(canDeleteCustomers(role), canEditCustomers(role), `${role}`);
  }
});
