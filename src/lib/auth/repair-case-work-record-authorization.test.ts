import { test } from "node:test";
import assert from "node:assert/strict";
import {
  canViewWorkRecords,
  canCreateWorkRecord,
  canInvalidateWorkRecord,
} from "./repair-case-work-record-authorization";
import type { Role } from "@/lib/domain/types";

const ALL_ROLES: Role[] = ["SUPER_ADMIN", "ADMIN", "AS_ENGINEER", "SALES", "INVENTORY_MANAGER"];

// -------------------------------------------------------------------- view

test("all 5 roles may view work records", () => {
  for (const role of ALL_ROLES) {
    assert.equal(canViewWorkRecords(role), true, `${role} should be able to view`);
  }
});

// ------------------------------------------------------------------ create

test("SUPER_ADMIN and ADMIN may create on any unlocked case", () => {
  for (const role of ["SUPER_ADMIN", "ADMIN"] as const) {
    assert.equal(canCreateWorkRecord(role, { isAssignedToCase: false, isCaseLocked: false }), true);
  }
});

test("AS_ENGINEER may create only on their own assigned unlocked case", () => {
  assert.equal(canCreateWorkRecord("AS_ENGINEER", { isAssignedToCase: true, isCaseLocked: false }), true);
  assert.equal(canCreateWorkRecord("AS_ENGINEER", { isAssignedToCase: false, isCaseLocked: false }), false);
});

test("SALES and INVENTORY_MANAGER may never create, even unassigned/unlocked", () => {
  for (const role of ["SALES", "INVENTORY_MANAGER"] as const) {
    assert.equal(canCreateWorkRecord(role, { isAssignedToCase: true, isCaseLocked: false }), false);
  }
});

test("shipment-lock removal policy: isCaseLocked no longer blocks create, including on an already-shipped case", () => {
  for (const role of ["SUPER_ADMIN", "ADMIN", "AS_ENGINEER"] as const) {
    assert.equal(
      canCreateWorkRecord(role, { isAssignedToCase: true, isCaseLocked: true }),
      true,
      `${role} must stay able to create on a shipped case`
    );
  }
  for (const role of ["SALES", "INVENTORY_MANAGER"] as const) {
    assert.equal(canCreateWorkRecord(role, { isAssignedToCase: true, isCaseLocked: true }), false, `${role} is still denied by role, not by lock`);
  }
});

// -------------------------------------------------------------- invalidate

test("only SUPER_ADMIN and ADMIN may invalidate, never AS_ENGINEER even for their own record", () => {
  assert.equal(canInvalidateWorkRecord("SUPER_ADMIN", { isCaseLocked: false }), true);
  assert.equal(canInvalidateWorkRecord("ADMIN", { isCaseLocked: false }), true);
  assert.equal(canInvalidateWorkRecord("AS_ENGINEER", { isCaseLocked: false }), false);
  assert.equal(canInvalidateWorkRecord("SALES", { isCaseLocked: false }), false);
  assert.equal(canInvalidateWorkRecord("INVENTORY_MANAGER", { isCaseLocked: false }), false);
});

test("shipment-lock removal policy: isCaseLocked no longer blocks invalidate, including on an already-shipped case", () => {
  for (const role of ["SUPER_ADMIN", "ADMIN"] as const) {
    assert.equal(canInvalidateWorkRecord(role, { isCaseLocked: true }), true, `${role} must stay able to invalidate on a shipped case`);
  }
});
