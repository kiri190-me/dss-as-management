import { test } from "node:test";
import assert from "node:assert/strict";
import { navItems, navGroups, childNavItems, filterNavItemsForAccess, type NavItem } from "./navigation";
import { baselinePermissionLevel } from "./auth/permission-baseline";
import { PERMISSION_AREAS } from "./auth/permission-areas";
import { PERMISSION_LEAF_KEYS } from "./auth/permission-features";
import type { Role } from "./domain/types";

/**
 * ============================================================================
 * 사이드바 노출 — 이제 **관리자가 정한 접근 권한 하나로만** 정해진다
 * ============================================================================
 * 예전에는 항목마다 역할 술어(isVisibleForRole)가 있었고 그 위에 설정이
 * 겹쳤다. 그래서 권한을 넓혀도 메뉴가 뜨지 않았다(2026-08-31 제거).
 *
 * 아래 시험들은 그때의 단언을 **그대로** 유지하되, 판정 경로만 지금 것으로
 * 바꿨다 — 기본 정책(설정을 아무도 건드리지 않은 상태)으로 어느 역할이 무엇을
 * 보는가. 통과한다는 것은 역할 술어를 떼면서 **기본 노출이 한 칸도 바뀌지
 * 않았다**는 뜻이다. 그게 이 변경의 안전 근거다.
 */

/**
 * 설정을 건드리지 않았을 때 이 역할에게 보이는 항목.
 *
 * 앱이 실제로 쓰는 경로와 같다 — listAccessibleAreaKeys 가 DB(없으면 기본
 * 정책)에서 키 목록을 만들고, filterNavItemsForAccess 가 그것으로 거른다.
 * 여기서는 DB 를 타지 않으려고 기본 정책을 직접 쓴다.
 *
 * 🔴 개발자 모드 관문은 **닫아 둔다**(셋째 인자 false). 이 함수가 답하는 질문은
 * 「역할과 접근 권한 설정만으로 무엇이 보이는가」이고, 개발자 모드는 그 축에
 * 아예 존재하지 않는다 — 어느 역할의 기본 노출에도 없는 것이 사실이다. 관문이
 * 열렸을 때의 답은 아래 「설정 밖의 길」 시험들이 따로 본다.
 */
function filterNavItemsForRole(items: NavItem[], role: Role): NavItem[] {
  const accessibleAreaKeys = items
    .map((item) => item.key)
    .filter((key) => baselinePermissionLevel(key, role) !== "NONE");
  return filterNavItemsForAccess(items, accessibleAreaKeys, false);
}

/** 다섯 역할 — 아래 시험들이 같은 목록을 돌게 한다. */
const ALL_ROLES = ["SUPER_ADMIN", "ADMIN", "AS_ENGINEER", "SALES", "INVENTORY_MANAGER"] as const;


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

/**
 * 🔴 항목에 역할 술어를 다시 붙이지 못하게 막는다.
 *
 * 하나라도 되살아나면 "권한을 넓혔는데 메뉴가 안 뜬다"가 그대로 돌아온다.
 * 노출을 좁혀야 하면 그 자리는 permission-baseline.ts 의 기본 정책이고,
 * 그러면 관리자가 설정으로 되돌릴 수 있다.
 */
test("navigation: 항목별 역할 술어가 없다 — 노출은 접근 권한 설정 하나로만 정해진다", () => {
  const withPredicate = navItems.filter(
    (item) => "isVisibleForRole" in item && typeof (item as Record<string, unknown>).isVisibleForRole === "function"
  );
  assert.deepEqual(withPredicate.map((i) => i.key), []);
});

/**
 * 🔴 역할 술어를 떼면서 **기본 노출이 바뀌지 않았는가.**
 *
 * 이 표가 이 변경의 안전 근거다. 예전 역할 술어가 내던 답과 기본 정책이 내는
 * 답이 모든 메뉴 × 모든 역할에서 같았기 때문에 뗄 수 있었다. 값이 바뀌면
 * 여기서 걸린다.
 */
test("navigation: 설정을 건드리지 않은 기본 상태의 역할별 노출", () => {
  // 🔴 developerMode 는 **다섯 역할 전부에서 빠진다**(2026-09-07). 약화가 아니라
  // 사실이다 — 그 항목은 PERMISSION_AREAS 에 없으므로 어느 역할의 기본 노출에도
  // 없고(baselinePermissionLevel 이 NONE 을 돌려준다), 노출은 오직 개발자 모드
  // 관문으로만 정해진다(auth/developer-mode-gate.ts). 다른 항목처럼 「이 역할만
  // 빠진다」로 적으면 나머지 역할에게 열린 것처럼 읽힌다.
  const expected: Record<string, string[]> = {
    SUPER_ADMIN: navItems.map((i) => i.key).filter((k) => !["myActiveWork", "developerMode"].includes(k)),
    ADMIN: navItems.map((i) => i.key).filter((k) => !["myActiveWork", "developerMode"].includes(k)),
    AS_ENGINEER: navItems
      .map((i) => i.key)
      .filter((k) => !["domesticOrders", "quotes", "repairLabor", "mailSettings", "developerMode"].includes(k)),
    SALES: navItems
      .map((i) => i.key)
      .filter(
        (k) =>
          !["myActiveWork", "technicalProcedures", "workflows", "mailSettings", "developerMode"].includes(k)
      ),
    INVENTORY_MANAGER: navItems
      .map((i) => i.key)
      .filter(
        (k) =>
          ![
            "myActiveWork", "technicalProcedures", "customers", "productModels", "workflows",
            "domesticOrders", "quotes", "repairLabor", "customerPortal", "mailSettings",
            "developerMode",
          ].includes(k)
      ),
  };

  for (const role of ALL_ROLES) {
    assert.deepEqual(
      filterNavItemsForRole(navItems, role).map((i) => i.key),
      expected[role],
      `${role} 의 기본 노출이 바뀌었다`
    );
  }
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

/**
 * ============================================================================
 * 🔴 설정 밖의 길 — **하나뿐이고, 하나로 남아야 한다**
 * ============================================================================
 * 위 「항목별 역할 술어가 없다」 단언은 그대로 서 있다(개발자 모드 항목에도
 * isVisibleForRole 을 붙이지 않았다). 그 불변식이 금지한 것은 **아무 항목에나
 * 붙일 수 있는 술어**이고, 여기 있는 것은 이름이 박힌 예외 하나다.
 *
 * 예외를 두는 근거: 역할별 접근 권한 설정 화면의 존재 목적이 「접근을 넓히는
 * 것」이라, 개발자 모드를 그 목록에 넣으면 최고관리자가 A/S 엔지니어나 영업
 * 담당자에게 그 화면을 열어 줄 수 있게 된다(developer-mode-gate.ts).
 *
 * 아래 시험들이 그 예외가 **퍼지지 못하게** 못 박는다.
 * ============================================================================
 */

test("🔴 설정 밖의 길로 보이는 항목은 정확히 하나이고 developerMode 다", () => {
  // 접근 권한을 통째로 비운 상태 = 설정이 아무것도 열어 주지 않은 상태.
  // 그런데도 남는 항목이 곧 「설정 밖의 길로 통과한 항목」이다.
  assert.deepEqual(
    filterNavItemsForAccess(navItems, [], true).map((i) => i.key),
    ["developerMode"],
    "설정 밖의 길로 통과하는 항목이 developerMode 하나가 아니다"
  );

  // 관문이 닫혀 있으면 그 하나까지 사라진다 — 예외가 「늘 열린 문」이 아니다.
  assert.deepEqual(filterNavItemsForAccess(navItems, [], false), []);
});

test("🔴 관문은 developerMode 하나만 움직인다 — 다른 항목의 노출을 건드리지 않는다", () => {
  // 접근 권한을 전부 연 상태에서 관문만 뒤집는다. 달라지는 항목이 하나뿐이어야
  // 한다 — 관문이 다른 줄에 새면 여기서 걸린다.
  const allKeys = navItems.map((i) => i.key);
  const open = filterNavItemsForAccess(navItems, allKeys, true).map((i) => i.key);
  const shut = filterNavItemsForAccess(navItems, allKeys, false).map((i) => i.key);

  assert.deepEqual(open, allKeys, "관문이 열렸는데 다른 항목이 사라졌다");
  assert.deepEqual(shut, allKeys.filter((k) => k !== "developerMode"));
});

test("🔴 developerMode 는 역할별 접근 권한 설정에 존재하지 않는다 — 그래서 열어 줄 수 없다", () => {
  // 영역 목록에 있으면 설정 화면에 줄이 하나 생기고, 최고관리자가 다른 역할에게
  // 개발자 모드를 열어 줄 수 있게 된다. 잎 키 쪽도 같은 이유다.
  assert.equal(PERMISSION_AREAS.some((area) => area.key === "developerMode"), false);
  assert.equal(PERMISSION_LEAF_KEYS.includes("developerMode"), false);
  assert.equal(
    PERMISSION_LEAF_KEYS.some((key) => key.startsWith("developerMode.")),
    false,
    "개발자 모드의 하위 기능 노드가 생겼다 — 설정으로 열 수 있게 됐다는 뜻이다"
  );

  // 그래서 기본 정책도 다섯 역할 전부 접근 불가다(목록에 없는 키는 NONE).
  for (const role of ALL_ROLES) {
    assert.equal(baselinePermissionLevel("developerMode", role), "NONE", role);
  }
});

test("🔴 개발자 모드 항목은 「설정」 그룹에 있고, 주소는 /settings/developer 다", () => {
  const item = navItems.find((i) => i.key === "developerMode");
  assert.equal(item?.href, "/settings/developer");
  assert.equal(item?.label, "개발자 모드");
  // 하위메뉴가 아니다 — parentKey 를 붙이면 그룹에서 빠져 사이드바가 다르게 그린다.
  assert.equal(item?.parentKey, undefined);

  const owning = navGroups.filter((g) => g.itemKeys.includes("developerMode")).map((g) => g.key);
  assert.deepEqual(owning, ["systemSettings"]);
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

test("filterNavItemsForRole: 견적서는 내자 정리와 정확히 같은 역할에게 보인다", () => {
  // 견적서에는 부품 단가·작업비·합계가 그대로 들어 있다. 금액이 이유가 되어
  // 엔지니어·재고 담당자가 빠지는 것은 내자 정리와 같은 판단이라, 술어도
  // canViewDomesticOrders 를 그대로 부른다(quote-authorization.ts). 두 항목이
  // 갈라지면 그쪽에서 판단이 바뀐 것이므로 여기서 걸린다.
  for (const role of ["SUPER_ADMIN", "ADMIN", "AS_ENGINEER", "SALES", "INVENTORY_MANAGER"] as const) {
    const visible = filterNavItemsForRole(navItems, role);
    assert.equal(
      visible.some((i) => i.key === "quotes"),
      visible.some((i) => i.key === "domesticOrders"),
      `quotes 와 domesticOrders 의 노출이 ${role} 에서 갈렸다`
    );
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
  assert.deepEqual(byKey.get("asOperations")?.itemKeys, ["repairCases", "myActiveWork", "repairCaseNew", "customerPortal", "diagnosisFlowcharts", "workflows", "excelKyosanIntakeList"]);
  assert.deepEqual(byKey.get("techResources")?.itemKeys, ["technicalProcedures", "inventory"]);
  // 내자 정리 1단계 — 수주·정산 흐름은 A/S 업무 그룹과 섞지 않는다(navigation.ts 주석).
  // 견적서가 둘째 항목으로 붙었다(2026-08-28). 내자 정리의 하위메뉴가 아니라
  // 나란한 항목이다 — 내자 줄 없이 견적서만 내는 경우가 있다(navigation.ts 주석).
  // 수리 작업 비용이 셋째로 붙었다(2026-08-31). 견적서 옆인 것은 견적을 내다가
  // "이 작업이 몇 시간이었지"를 확인하러 가는 일이 잦기 때문이다.
  assert.deepEqual(byKey.get("poDomestic")?.itemKeys, ["domesticOrders", "quotes", "repairLabor"]);
  // 사용자 관리·시스템 설정은 2026-08-28 에 '설정' 그룹으로 내려갔다 — '관리'에는
  // 업무용 마스터 자료만 남는다(navigation.ts 주석).
  assert.deepEqual(byKey.get("admin")?.itemKeys, ["customers", "productModels"]);
  // 메일 설정이 「설정」 그룹 세 번째로 붙었다(2026-08-31) — 사용자 관리와
  // 나란히 "누가 무엇을 받는가"를 정하는 자리다.
  // 개발자 모드가 「설정」 그룹 네 번째, 맨 끝으로 붙었다(2026-09-07) — 노출
  // 규칙이 다른 셋과 다른 유일한 줄이라 사이에 끼우지 않았다(navigation.ts 주석).
  assert.deepEqual(byKey.get("systemSettings")?.itemKeys, ["users", "settings", "mailSettings", "developerMode"]);
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
  // 🔴 developerMode(2026-09-07)가 다섯 줄 전부에서 하나씩 늘렸다 — 이 항목은
  // 역할·설정 축에 존재하지 않으므로 **모든 역할에게 감춰진다.** 그것이 이
  // 표에서 다섯 줄이 함께 늘어난 유일한 경우다.
  const hiddenCountByRole: Record<string, number> = {
    SUPER_ADMIN: 2, // myActiveWork + developerMode
    ADMIN: 2, // myActiveWork + developerMode
    // Excel 이관 메뉴가 사라지면서 역할별로 감춰지는 항목이 하나씩 줄었고,
    // 내자 정리가 생기면서 엔지니어에게 감춰지는 항목이 처음으로 하나 생겼다.
    // 견적서(2026-08-28)가 내자 정리와 똑같은 세 역할에게만 보이므로, 감춰지는
    // 항목이 엔지니어·재고 담당자 양쪽에서 하나씩 늘었다.
    // 수리 작업 비용(2026-08-31)이 견적서와 같은 판정이라, 견적서가 감춰지는
    // 두 역할에서 감춰지는 항목이 하나씩 더 늘었다.
    // 메일 설정(2026-08-31)은 관리자 이상만 본다 — 아래 세 역할에서 하나씩 늘었다.
    AS_ENGINEER: 5, // domesticOrders + quotes + repairLabor + mailSettings + developerMode
    SALES: 5, // myActiveWork + technicalProcedures + workflows + mailSettings + developerMode
    // 고객 안내 현황(2026-08-28)은 접수를 만들 수 있는 넷에게 보인다. 재고
    // 담당자만 빠지므로 그 줄에서만 감춰지는 항목이 하나 늘었다 — 고객에게
    // 나갈 안내를 정하는 화면인데 그 역할에는 접수를 만들 수단이 없다.
    INVENTORY_MANAGER: 11, // myActiveWork + technicalProcedures + customers + productModels + workflows + domesticOrders + quotes + repairLabor + customerPortal + mailSettings + developerMode
  };
  for (const role of ALL_ROLES) {
    const visible = filterNavItemsForRole(navItems, role);
    assert.equal(visible.length, navItems.length - hiddenCountByRole[role]);
    assert.ok(visible.some((i) => i.key === "dashboard"));
    assert.ok(visible.some((i) => i.key === "users"));
  }
});
