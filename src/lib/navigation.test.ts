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
 */

test("navigation: procedures and inventory are the only role-gated items (unchanged default for everything else)", () => {
  const restricted = navItems.filter((item) => item.isVisibleForRole);
  assert.deepEqual(
    restricted.map((i) => i.key).sort(),
    ["inventory", "procedures"]
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

test("filterNavItemsForRole: unrestricted items remain visible to every role", () => {
  for (const role of ["SUPER_ADMIN", "ADMIN", "AS_ENGINEER", "SALES", "INVENTORY_MANAGER"] as const) {
    const visible = filterNavItemsForRole(navItems, role);
    assert.equal(visible.length, navItems.length - (role === "SALES" || role === "INVENTORY_MANAGER" ? 1 : 0));
    assert.ok(visible.some((i) => i.key === "dashboard"));
    assert.ok(visible.some((i) => i.key === "users"));
  }
});
