import { test } from "node:test";
import assert from "node:assert/strict";
import { navItems, navGroups, filterNavItemsForRole } from "./navigation";

/**
 * Regression test for nav-visibility gating. This is a UX check only;
 * server-side rejection for a direct URL hit is covered separately by each
 * gated page's own role checks.
 *
 * Phase 5B-2 adds a gated entry, "inventory" — its predicate
 * (canViewInventory) currently returns true for all 5 roles, so it never
 * actually hides for anyone, but it still counts as "restricted" (has an
 * isVisibleForRole predicate at all) for the purposes of these tests.
 *
 * Phase 5C-3 adds a second gated entry, "myActiveWork" — unlike the other
 * two, its predicate (canViewMyActiveWork) is AS_ENGINEER-only, deliberately
 * excluding ADMIN/SUPER_ADMIN (see my-active-work-authorization.ts).
 *
 * Phase 5C-5B adds a third gated entry, "technicalProcedures" — its
 * predicate (canViewPublishedTechnicalTemplates) is defined as exactly
 * canViewPublishedProcedureTemplates, so it hides for SALES/INVENTORY_MANAGER.
 *
 * Checkpoint 1 (기술 절차 템플릿 IA removal) removed the "procedures"
 * (all-category list) nav entry entirely — /procedures now redirects to
 * /procedures/technical instead of having its own nav item, so it no longer
 * appears in navItems at all.
 *
 * Checkpoint 2 adds "diagnosisFlowcharts" — its predicate
 * (canViewRepairCaseFlowcharts) currently returns true for all 5 roles
 * (same "restricted but never actually hides for anyone yet" shape as
 * "inventory"), kept explicit for correctness if the view policy ever
 * narrows later.
 *
 * Customer Management phase 1 adds "customers" — its predicate
 * (canViewCustomers) is SUPER_ADMIN/ADMIN/AS_ENGINEER/SALES, deliberately
 * excluding INVENTORY_MANAGER (see customer-authorization.ts) — a genuinely
 * new shape, distinct from every other gated item's role set.
 *
 * Product Model Management phase 1 adds "productModels" — its predicate
 * (canViewProductModels) is the exact same SUPER_ADMIN/ADMIN/AS_ENGINEER/
 * SALES shape as canViewCustomers (see product-model-authorization.ts).
 *
 * 내자 정리 1단계는 "domesticOrders"를 더한다 — 그 술어
 * (canViewDomesticOrders)는 SUPER_ADMIN/ADMIN/SALES 로, 이 목록에서 처음
 * 나오는 모양이다. 금액과 입금 정보가 있는 화면이라 고객사·제품 모델과 달리
 * AS_ENGINEER 까지 빠진다(domestic-order-authorization.ts).
 */

test("navigation: the approved feature entries are the only role-gated items", () => {
  const restricted = navItems.filter((item) => item.isVisibleForRole);
  assert.deepEqual(
    restricted.map((i) => i.key).sort(),
    ["customers", "diagnosisFlowcharts", "domesticOrders", "inventory", "myActiveWork", "productModels", "technicalProcedures", "workflows"]
  );
});

// 워크플로 관리는 규칙 자체를 바꾸는 화면이라 엔지니어 이상만 본다
// (2026-08-18 결정). 영업·재고 담당자는 자기 담당 구간을 정규 워크플로로
// 진행하는 것은 그대로 가능하며, 여기서 막는 것은 규칙 편집뿐이다.
test("filterNavItemsForRole: SUPER_ADMIN / ADMIN / AS_ENGINEER see the workflows entry; SALES / INVENTORY_MANAGER do not", () => {
  for (const role of ["SUPER_ADMIN", "ADMIN", "AS_ENGINEER"] as const) {
    assert.ok(
      filterNavItemsForRole(navItems, role).some((i) => i.key === "workflows"),
      `expected workflows visible for ${role}`
    );
  }
  for (const role of ["SALES", "INVENTORY_MANAGER"] as const) {
    assert.equal(
      filterNavItemsForRole(navItems, role).some((i) => i.key === "workflows"),
      false,
      `expected workflows hidden for ${role}`
    );
  }
});

test("navigation: no 'procedures' (all-category list) entry exists", () => {
  assert.equal(navItems.some((i) => i.key === "procedures"), false);
});

test("filterNavItemsForRole: every role sees the inventory entry", () => {
  for (const role of ["SUPER_ADMIN", "ADMIN", "AS_ENGINEER", "SALES", "INVENTORY_MANAGER"] as const) {
    const visible = filterNavItemsForRole(navItems, role);
    assert.ok(visible.some((i) => i.key === "inventory"), `expected inventory visible for ${role}`);
  }
});

test("filterNavItemsForRole: every role sees the diagnosisFlowcharts entry", () => {
  for (const role of ["SUPER_ADMIN", "ADMIN", "AS_ENGINEER", "SALES", "INVENTORY_MANAGER"] as const) {
    const visible = filterNavItemsForRole(navItems, role);
    assert.ok(visible.some((i) => i.key === "diagnosisFlowcharts"), `expected diagnosisFlowcharts visible for ${role}`);
  }
});

test("filterNavItemsForRole: only AS_ENGINEER sees the myActiveWork entry", () => {
  assert.ok(filterNavItemsForRole(navItems, "AS_ENGINEER").some((i) => i.key === "myActiveWork"));
  for (const role of ["SUPER_ADMIN", "ADMIN", "SALES", "INVENTORY_MANAGER"] as const) {
    const visible = filterNavItemsForRole(navItems, role);
    assert.equal(visible.some((i) => i.key === "myActiveWork"), false, `expected myActiveWork hidden for ${role}`);
  }
});

test("filterNavItemsForRole: SUPER_ADMIN / ADMIN / AS_ENGINEER see the technicalProcedures entry; SALES / INVENTORY_MANAGER do not", () => {
  for (const role of ["SUPER_ADMIN", "ADMIN", "AS_ENGINEER"] as const) {
    assert.ok(filterNavItemsForRole(navItems, role).some((i) => i.key === "technicalProcedures"), `expected technicalProcedures visible for ${role}`);
  }
  for (const role of ["SALES", "INVENTORY_MANAGER"] as const) {
    assert.equal(filterNavItemsForRole(navItems, role).some((i) => i.key === "technicalProcedures"), false, `expected technicalProcedures hidden for ${role}`);
  }
});

test("filterNavItemsForRole: SUPER_ADMIN / ADMIN / AS_ENGINEER / SALES see the customers entry; INVENTORY_MANAGER does not", () => {
  for (const role of ["SUPER_ADMIN", "ADMIN", "AS_ENGINEER", "SALES"] as const) {
    assert.ok(filterNavItemsForRole(navItems, role).some((i) => i.key === "customers"), `expected customers visible for ${role}`);
  }
  assert.equal(filterNavItemsForRole(navItems, "INVENTORY_MANAGER").some((i) => i.key === "customers"), false);
});

test("filterNavItemsForRole: SUPER_ADMIN / ADMIN / AS_ENGINEER / SALES see the productModels entry; INVENTORY_MANAGER does not", () => {
  for (const role of ["SUPER_ADMIN", "ADMIN", "AS_ENGINEER", "SALES"] as const) {
    assert.ok(filterNavItemsForRole(navItems, role).some((i) => i.key === "productModels"), `expected productModels visible for ${role}`);
  }
  assert.equal(filterNavItemsForRole(navItems, "INVENTORY_MANAGER").some((i) => i.key === "productModels"), false);
});

test("filterNavItemsForRole: SUPER_ADMIN / ADMIN / SALES see the domesticOrders entry; AS_ENGINEER / INVENTORY_MANAGER do not", () => {
  // 금액(VAT별도)과 입금완료 여부가 있는 화면이다 — 고객사·제품 모델과 달리
  // 엔지니어까지 빠지는 유일한 항목이라 여기서 못 박아 둔다.
  for (const role of ["SUPER_ADMIN", "ADMIN", "SALES"] as const) {
    assert.ok(filterNavItemsForRole(navItems, role).some((i) => i.key === "domesticOrders"), `expected domesticOrders visible for ${role}`);
  }
  for (const role of ["AS_ENGINEER", "INVENTORY_MANAGER"] as const) {
    assert.equal(filterNavItemsForRole(navItems, role).some((i) => i.key === "domesticOrders"), false, `expected domesticOrders hidden for ${role}`);
  }
});

/**
 * Checkpoint 2A — navGroups is a pure presentation grouping over navItems
 * (Sidebar's collapsible sections). "dashboard" is deliberately excluded
 * (rendered standalone) — every other navItems key must appear in exactly
 * one group, so a future new nav item can't silently end up ungrouped or
 * double-grouped, and no group can reference a key that doesn't exist.
 */

test("navGroups: every non-dashboard navItem key appears in exactly one group", () => {
  const nonDashboardKeys = navItems.map((i) => i.key).filter((key) => key !== "dashboard");
  const groupedKeys = navGroups.flatMap((g) => g.itemKeys);
  assert.deepEqual([...groupedKeys].sort(), [...nonDashboardKeys].sort(), "every non-dashboard item must be grouped exactly once, no orphans or duplicates");
});

test("navGroups: every itemKey references a real navItems key", () => {
  const validKeys = new Set(navItems.map((i) => i.key));
  for (const group of navGroups) {
    for (const key of group.itemKeys) {
      assert.ok(validKeys.has(key), `navGroups["${group.key}"] references unknown item key "${key}"`);
    }
  }
});

test("navGroups: matches the approved A/S 업무 / 기술 / 자원 / PO / 내자 / 관리 structure", () => {
  const byKey = new Map(navGroups.map((g) => [g.key, g]));
  assert.deepEqual(byKey.get("asOperations")?.itemKeys, ["repairCases", "myActiveWork", "repairCaseNew", "diagnosisFlowcharts", "workflows", "excelKyosanIntakeList"]);
  assert.deepEqual(byKey.get("techResources")?.itemKeys, ["technicalProcedures", "inventory"]);
  // 내자 정리 1단계 — 수주·정산 흐름은 A/S 업무 그룹과 섞지 않는다(navigation.ts 주석).
  assert.deepEqual(byKey.get("poDomestic")?.itemKeys, ["domesticOrders"]);
  assert.deepEqual(byKey.get("admin")?.itemKeys, ["users", "customers", "productModels", "settings"]);
});

test("filterNavItemsForRole: unrestricted items remain visible to every role", () => {
  const hiddenCountByRole: Record<string, number> = {
    SUPER_ADMIN: 1, // myActiveWork
    ADMIN: 1, // myActiveWork
    // Excel 이관 메뉴가 사라지면서 역할별로 감춰지는 항목이 하나씩 줄었고,
    // 내자 정리가 생기면서 엔지니어에게 감춰지는 항목이 처음으로 하나 생겼다.
    AS_ENGINEER: 1, // domesticOrders
    SALES: 3, // myActiveWork + technicalProcedures + workflows
    INVENTORY_MANAGER: 6, // myActiveWork + technicalProcedures + customers + productModels + workflows + domesticOrders
  };
  for (const role of ["SUPER_ADMIN", "ADMIN", "AS_ENGINEER", "SALES", "INVENTORY_MANAGER"] as const) {
    const visible = filterNavItemsForRole(navItems, role);
    assert.equal(visible.length, navItems.length - hiddenCountByRole[role]);
    assert.ok(visible.some((i) => i.key === "dashboard"));
    assert.ok(visible.some((i) => i.key === "users"));
  }
});
