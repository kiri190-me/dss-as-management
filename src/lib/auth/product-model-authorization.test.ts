import { test } from "node:test";
import assert from "node:assert/strict";
import {
  canDeleteProductModels,
  canEditProductModels,
  canManageProductModelFiles,
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

test("canManageProductModelFiles: SUPER_ADMIN/ADMIN/AS_ENGINEER — 영업·재고 담당자는 못 올린다", () => {
  for (const role of ["SUPER_ADMIN", "ADMIN", "AS_ENGINEER"] as const) {
    assert.equal(canManageProductModelFiles(role), true, `expected ${role} to manage product model files`);
  }
  for (const role of ["SALES", "INVENTORY_MANAGER"] as const) {
    assert.equal(
      canManageProductModelFiles(role),
      false,
      `expected ${role} not to manage product model files`
    );
  }
});

test("엔지니어에게 사진·도면을 열어도 제품 모델 수정은 새지 않는다", () => {
  // 이 한 줄이 이 변경의 핵심 증거다. canEditProductModels를 빌려 쓰지 않고
  // 별도 함수를 만든 이유가 정확히 이것 — 파일을 올리게 하려다 모델명·제조사·
  // 설명이 함께 열리면 마스터 자료가 열린 것이다.
  assert.equal(canManageProductModelFiles("AS_ENGINEER"), true);
  assert.equal(canEditProductModels("AS_ENGINEER"), false);
  assert.equal(canDeleteProductModels("AS_ENGINEER"), false);
});

test("사진·도면 권한은 조회 권한보다 좁다 — 볼 수 있다고 올릴 수 있는 것은 아니다", () => {
  // 영업은 제품 모델을 보지만 사진·도면은 올리지 못한다. 두 집합이 같아지면
  // 노드를 따로 둘 이유가 사라진 것이므로 그때 다시 판단해야 한다.
  assert.equal(canViewProductModels("SALES"), true);
  assert.equal(canManageProductModelFiles("SALES"), false);
  for (const role of ["SUPER_ADMIN", "ADMIN", "AS_ENGINEER", "SALES", "INVENTORY_MANAGER"] as const) {
    if (canManageProductModelFiles(role)) {
      assert.equal(canViewProductModels(role), true, `${role}: 못 보는데 올릴 수 있다`);
    }
  }
});
