import { test } from "node:test";
import assert from "node:assert/strict";
import { navItems, navGroups, childNavItems, filterNavItemsForRole } from "./navigation";

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
 *
 * 주간보고(2026-08-25)는 "weeklyReport"를 더한다 — **역할 술어가 없는** 항목이다.
 * 대시보드의 하위메뉴이고, 볼 수 있는 역할을 대시보드와 같게 두기로 승인됐다.
 * 대시보드에 isVisibleForRole 이 없으므로 여기에도 없다 — 따로 좁히면 부모는
 * 보이는데 자식만 사라지는 사이드바가 된다.
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

test("filterNavItemsForRole: 주간보고는 대시보드와 정확히 같은 역할에게 보인다", () => {
  // 승인된 결정이다 — 하위메뉴를 부모보다 좁히면 부모는 보이는데 그 아래
  // 들여쓴 링크만 사라지는 사이드바가 되고, 넓히면 대시보드를 못 보는 사람에게
  // 대시보드 자료가 열린다.
  for (const role of ["SUPER_ADMIN", "ADMIN", "AS_ENGINEER", "SALES", "INVENTORY_MANAGER"] as const) {
    const visible = filterNavItemsForRole(navItems, role);
    assert.equal(
      visible.some((i) => i.key === "weeklyReport"),
      visible.some((i) => i.key === "dashboard"),
      `${role}: 주간보고와 대시보드의 표시 여부가 갈렸다`
    );
  }
});

/**
 * Checkpoint 2A — navGroups is a pure presentation grouping over navItems
 * (Sidebar's collapsible sections). "dashboard" is deliberately excluded
 * (rendered standalone) — every other navItems key must appear in exactly
 * one group, so a future new nav item can't silently end up ungrouped or
 * double-grouped, and no group can reference a key that doesn't exist.
 *
 * 2026-08-25 (주간보고) — 대시보드는 **여전히 단독이다.** 그 아래 붙은 주간보고는
 * 그룹이 아니라 하위메뉴(NavItem.parentKey)이고, Sidebar 가 부모 링크 바로
 * 아래에 들여써서 그린다. 그래서 그룹에 들어가지 않는 키가 이제 둘이다 —
 * 단독인 "dashboard" 와 그 하위메뉴. 아래 테스트는 그 둘을 뺀 나머지가 여전히
 * 정확히 한 그룹에 있음을 단언하고, 하위메뉴 쪽은 **그룹에 들어가면 안 된다**를
 * 따로 단언한다(들어가면 사이드바에 같은 링크가 두 번 나온다).
 */

/** 사이드바에서 그룹 밖에 그려지는 키 — 단독인 대시보드와 그 하위메뉴들. */
function ungroupedKeys(): string[] {
  return navItems.filter((i) => i.key === "dashboard" || i.parentKey !== undefined).map((i) => i.key);
}

test("navGroups: every navItem key except the standalone dashboard and its submenu appears in exactly one group", () => {
  const outsideGroups = new Set(ungroupedKeys());
  const groupableKeys = navItems.map((i) => i.key).filter((key) => !outsideGroups.has(key));
  const groupedKeys = navGroups.flatMap((g) => g.itemKeys);
  assert.deepEqual([...groupedKeys].sort(), [...groupableKeys].sort(), "every groupable item must be grouped exactly once, no orphans or duplicates");
});

test("navGroups: 그룹 밖에 그려지는 것은 대시보드와 그 하위메뉴뿐이다", () => {
  // 이 목록이 늘어나는 것은 IA 변경이므로, 늘어난 사실이 여기서 먼저 드러나야
  // 한다. 조용히 늘면 위 '정확히 한 그룹' 단언이 그만큼 약해진다.
  assert.deepEqual(ungroupedKeys().sort(), ["dashboard", "weeklyReport"]);
});

test("하위메뉴는 어느 그룹에도 들어가지 않는다 — 들어가면 사이드바에 두 번 나온다", () => {
  const groupedKeys = new Set(navGroups.flatMap((g) => g.itemKeys));
  for (const item of navItems.filter((i) => i.parentKey !== undefined)) {
    assert.equal(groupedKeys.has(item.key), false, `${item.key} 가 그룹에도 들어가 있다`);
  }
});

test("하위메뉴의 부모는 실재하는 navItems 키다", () => {
  const validKeys = new Set(navItems.map((i) => i.key));
  for (const item of navItems.filter((i) => i.parentKey !== undefined)) {
    assert.ok(validKeys.has(item.parentKey!), `${item.key} 의 부모 "${item.parentKey}" 를 찾을 수 없다`);
    assert.notEqual(item.parentKey, item.key, `${item.key} 가 자기 자신의 하위메뉴다`);
  }
});

test("childNavItems: 대시보드의 하위메뉴는 주간보고 하나다", () => {
  assert.deepEqual(
    childNavItems(navItems, "dashboard").map((i) => i.key),
    ["weeklyReport"]
  );
  // 하위메뉴가 없는 항목은 빈 배열이다 — Sidebar 가 빈 들여쓰기 칸을 그리지 않는 근거다.
  assert.deepEqual(childNavItems(navItems, "repairCases"), []);
});

test("주간보고는 대시보드 아래 주소를 쓴다 — 부모와 자식의 경로가 어긋나면 활성 표시가 엇갈린다", () => {
  const dashboard = navItems.find((i) => i.key === "dashboard");
  const weekly = navItems.find((i) => i.key === "weeklyReport");
  assert.equal(dashboard?.href, "/dashboard");
  assert.equal(weekly?.href, "/dashboard/weekly-report");
});

test("navGroups: every itemKey references a real navItems key", () => {
  const validKeys = new Set(navItems.map((i) => i.key));
  for (const group of navGroups) {
    for (const key of group.itemKeys) {
      assert.ok(validKeys.has(key), `navGroups["${group.key}"] references unknown item key "${key}"`);
    }
  }
});

test("navGroups: matches the approved A/S 업무 / 기술 / 자원 / PO / 내자 / 관리 / 설정 structure", () => {
  const byKey = new Map(navGroups.map((g) => [g.key, g]));
  assert.deepEqual(byKey.get("asOperations")?.itemKeys, ["repairCases", "myActiveWork", "repairCaseNew", "diagnosisFlowcharts", "workflows", "excelKyosanIntakeList"]);
  assert.deepEqual(byKey.get("techResources")?.itemKeys, ["technicalProcedures", "inventory"]);
  // 내자 정리 1단계 — 수주·정산 흐름은 A/S 업무 그룹과 섞지 않는다(navigation.ts 주석).
  assert.deepEqual(byKey.get("poDomestic")?.itemKeys, ["domesticOrders"]);
  // 사용자 관리·시스템 설정은 2026-08-28 에 '설정' 그룹으로 내려갔다 — '관리'에는
  // 업무용 마스터 자료만 남는다(navigation.ts 주석).
  assert.deepEqual(byKey.get("admin")?.itemKeys, ["customers", "productModels"]);
  assert.deepEqual(byKey.get("systemSettings")?.itemKeys, ["users", "settings"]);
});

test("navGroups: 그룹의 key·이름·차례 — '설정'은 '관리' 다음, 맨 끝이다", () => {
  // 사이드바에 구획이 나오는 차례가 곧 이 배열의 차례다. 값으로 못 박아 둔다:
  // 포함 검사로 두면 그룹이 하나 끼어들거나 순서가 뒤집혀도 조용히 지나간다.
  assert.deepEqual(
    navGroups.map((g) => [g.key, g.label]),
    [
      ["asOperations", "A/S 업무"],
      ["techResources", "기술 / 자원"],
      ["poDomestic", "PO / 내자"],
      ["admin", "관리"],
      ["systemSettings", "설정"],
    ]
  );
});

test("navGroups: 사용자 관리와 시스템 설정은 '관리'가 아니라 '설정' 그룹에 있다", () => {
  // 이번 변경의 요점이다(2026-08-28). 위 구조 단언과 겹쳐 보이지만 이쪽은 **두 항목이
  // 어느 구획에 있는가**만 말한다 — 그룹에 항목이 더 붙어 구조 단언이 갱신되더라도
  // 이 사실은 그대로 남아야 한다.
  const byKey = new Map(navGroups.map((g) => [g.key, g]));
  for (const key of ["users", "settings"]) {
    assert.ok(byKey.get("systemSettings")?.itemKeys.includes(key), `${key} 가 '설정' 그룹에 없다`);
    assert.equal(byKey.get("admin")?.itemKeys.includes(key), false, `${key} 가 아직 '관리' 그룹에 남아 있다`);
  }
  // 그룹 key 와 항목 key 는 이름 공간이 다르다 — navGroups 쪽은 "systemSettings",
  // navItems 쪽은 "settings" 로 갈라 두었다(navigation.ts 주석). 섞여 쓰이면
  // 여기서 걸린다.
  assert.equal(navGroups.some((g) => g.key === "settings"), false);
  assert.ok(navItems.some((i) => i.key === "settings"));
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
