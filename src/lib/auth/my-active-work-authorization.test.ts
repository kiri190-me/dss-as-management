import { test } from "node:test";
import assert from "node:assert/strict";
import { canViewMyActiveWork } from "./my-active-work-authorization";
import type { Role } from "@/lib/domain/types";

const ALL_ROLES: Role[] = ["SUPER_ADMIN", "ADMIN", "AS_ENGINEER", "SALES", "INVENTORY_MANAGER"];

test("only AS_ENGINEER may view My Active Work", () => {
  assert.equal(canViewMyActiveWork("AS_ENGINEER"), true);
});

test("every other role is blocked, including ADMIN and SUPER_ADMIN", () => {
  for (const role of ALL_ROLES.filter((r) => r !== "AS_ENGINEER")) {
    assert.equal(canViewMyActiveWork(role), false, `${role} should be blocked`);
  }
});
