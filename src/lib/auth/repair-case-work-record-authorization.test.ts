import { test } from "node:test";
import assert from "node:assert/strict";
import {
  canViewWorkRecords,
  canCreateWorkRecord,
  canEditWorkRecord,
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

// -------------------------------------------------------------------- edit
//
// 2026-10-02 — 엔지니어가 자기가 쓴 기록의 글·기록 구분을 고칠 수 있게 되었다.
// 여기서 못 박는 것은 「되는가」보다 **안 되는 경우**다: 남의 기록은 누구도
// 못 고친다(관리자도), 엔지니어는 담당 건이 아니면 제 기록도 못 고친다.

test("🔴 작성자 본인이 아니면 어떤 역할도 고칠 수 없다 — 관리자·최고관리자도", () => {
  for (const role of ALL_ROLES) {
    assert.equal(
      canEditWorkRecord(role, { isAuthor: false, isAssignedToCase: true, isCaseLocked: false }),
      false,
      `${role} 은 남이 쓴 기록을 고칠 수 없어야 한다`
    );
  }
});

test("SUPER_ADMIN·ADMIN 은 자기가 쓴 기록이면 담당 여부를 묻지 않는다", () => {
  for (const role of ["SUPER_ADMIN", "ADMIN"] as const) {
    assert.equal(canEditWorkRecord(role, { isAuthor: true, isAssignedToCase: false, isCaseLocked: false }), true);
    assert.equal(canEditWorkRecord(role, { isAuthor: true, isAssignedToCase: true, isCaseLocked: false }), true);
  }
});

test("AS_ENGINEER 는 자기가 쓴 기록이면서 자기 담당 건일 때만 고친다", () => {
  assert.equal(canEditWorkRecord("AS_ENGINEER", { isAuthor: true, isAssignedToCase: true, isCaseLocked: false }), true);
  assert.equal(
    canEditWorkRecord("AS_ENGINEER", { isAuthor: true, isAssignedToCase: false, isCaseLocked: false }),
    false,
    "담당이 바뀐 건의 제 기록은 고칠 수 없다 — 남길 수도 없는 건이다"
  );
});

test("SALES·INVENTORY_MANAGER 는 자기가 쓴 기록이어도 고칠 수 없다", () => {
  for (const role of ["SALES", "INVENTORY_MANAGER"] as const) {
    assert.equal(canEditWorkRecord(role, { isAuthor: true, isAssignedToCase: true, isCaseLocked: false }), false);
  }
});

test("🔴 출하 잠금은 고치기를 막지 않는다 — 남기기·무효 처리와 같게 맞춘 것이다", () => {
  for (const role of ["SUPER_ADMIN", "ADMIN", "AS_ENGINEER"] as const) {
    assert.equal(
      canEditWorkRecord(role, { isAuthor: true, isAssignedToCase: true, isCaseLocked: true }),
      true,
      `${role} 은 출하된 건에서도 제 기록을 고칠 수 있어야 한다`
    );
  }
  // 막히는 쪽의 까닭은 잠금이 아니라 역할·작성자다.
  assert.equal(canEditWorkRecord("SALES", { isAuthor: true, isAssignedToCase: true, isCaseLocked: true }), false);
  assert.equal(canEditWorkRecord("SUPER_ADMIN", { isAuthor: false, isAssignedToCase: true, isCaseLocked: false }), false);
});

test("🔴 고치기를 열었다고 무효 처리가 함께 열리지 않는다 — 둘은 별개의 권한이다", () => {
  // 엔지니어는 제 기록을 고칠 수 있지만, 무효 처리는 여전히 못 한다.
  assert.equal(canEditWorkRecord("AS_ENGINEER", { isAuthor: true, isAssignedToCase: true, isCaseLocked: false }), true);
  assert.equal(canInvalidateWorkRecord("AS_ENGINEER", { isCaseLocked: false }), false);
});
