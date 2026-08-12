import { test } from "node:test";
import assert from "node:assert/strict";
import { navItems, filterNavItemsForRole } from "./navigation";

/**
 * Regression test for the /procedures nav-visibility fix: the entry must
 * be shown to every role that can view procedure templates and hidden
 * from every role that can't — reusing
 * procedure-template-authorization.ts's own predicate, so this test also
 * guards against the two ever drifting apart. This is a UX check only;
 * server-side rejection for a direct URL hit is covered separately by
 * procedures/page.tsx and procedures/[id]/page.tsx's own role checks.
 *
 * Phase 5B-2 adds a second gated entry, "inventory" — its predicate
 * (canViewInventory) currently returns true for all 5 roles, so it never
 * actually hides for anyone, but it still counts as "restricted" (has an
 * isVisibleForRole predicate at all) for the purposes of these tests.
 *
 * Phase 5C-3 adds a third gated entry, "myActiveWork" — unlike the other
 * two, its predicate (canViewMyActiveWork) is AS_ENGINEER-only, deliberately
 * excluding ADMIN/SUPER_ADMIN (see my-active-work-authorization.ts).
 *
 * Phase 5C-5B adds a fourth gated entry, "technicalProcedures" — its
 * predicate (canViewPublishedTechnicalTemplates) is defined as exactly
 * canViewPublishedProcedureTemplates, so it hides for the same roles as
 * "procedures" (SALES/INVENTORY_MANAGER).
 */

test("navigation: procedures, inventory, myActiveWork, and technicalProcedures are the only role-gated items (unchanged default for everything else)", () => {
  const restricted = navItems.filter((item) => item.isVisibleForRole);
  assert.deepEqual(
    restricted.map((i) => i.key).sort(),
    ["inventory", "myActiveWork", "procedures", "technicalProcedures"]
  );
});

test("filterNavItemsForRole: SUPER_ADMIN / ADMIN / AS_ENGINEER see the procedures entry", () => {
  for (const role of ["SUPER_ADMIN", "ADMIN", "AS_ENGINEER"] as const) {
    const visible = filterNavItemsForRole(navItems, role);
    assert.ok(visible.some((i) => i.key === "procedures"), `expected procedures visible for ${role}`);
  }
});

test("filterNavItemsForRole: SALES / INVENTORY_MANAGER do not see the procedures entry", () => {
  for (const role of ["SALES", "INVENTORY_MANAGER"] as const) {
    const visible = filterNavItemsForRole(navItems, role);
    assert.equal(visible.some((i) => i.key === "procedures"), false, `expected procedures hidden for ${role}`);
  }
});

test("filterNavItemsForRole: every role sees the inventory entry", () => {
  for (const role of ["SUPER_ADMIN", "ADMIN", "AS_ENGINEER", "SALES", "INVENTORY_MANAGER"] as const) {
    const visible = filterNavItemsForRole(navItems, role);
    assert.ok(visible.some((i) => i.key === "inventory"), `expected inventory visible for ${role}`);
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

test("filterNavItemsForRole: unrestricted items remain visible to every role", () => {
  const hiddenCountByRole: Record<string, number> = {
    SUPER_ADMIN: 1, // myActiveWork
    ADMIN: 1, // myActiveWork
    AS_ENGINEER: 0,
    SALES: 3, // procedures + myActiveWork + technicalProcedures
    INVENTORY_MANAGER: 3, // procedures + myActiveWork + technicalProcedures
  };
  for (const role of ["SUPER_ADMIN", "ADMIN", "AS_ENGINEER", "SALES", "INVENTORY_MANAGER"] as const) {
    const visible = filterNavItemsForRole(navItems, role);
    assert.equal(visible.length, navItems.length - hiddenCountByRole[role]);
    assert.ok(visible.some((i) => i.key === "dashboard"));
    assert.ok(visible.some((i) => i.key === "users"));
  }
});
