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
