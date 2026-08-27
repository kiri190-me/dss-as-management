import assert from "node:assert/strict";
import { test } from "node:test";
import { decideSsoRole } from "./sso-role";

test("클레임이 없으면 기존 역할을 그대로 둔다", () => {
  assert.deepEqual(decideSsoRole(undefined), { kind: "KEEP" });
  assert.deepEqual(decideSsoRole(null), { kind: "KEEP" });
});

test("아는 역할이면 적용한다", () => {
  assert.deepEqual(decideSsoRole("SUPER_ADMIN"), {
    kind: "APPLY",
    role: "SUPER_ADMIN",
  });
  assert.deepEqual(decideSsoRole("AS_ENGINEER"), {
    kind: "APPLY",
    role: "AS_ENGINEER",
  });
  assert.deepEqual(decideSsoRole("INVENTORY_MANAGER"), {
    kind: "APPLY",
    role: "INVENTORY_MANAGER",
  });
});

test("모르는 값은 거절한다 — 기존 역할을 남기면 강등이 조용히 실패한다", () => {
  assert.deepEqual(decideSsoRole("SALES2"), { kind: "REJECT", received: "SALES2" });
  assert.deepEqual(decideSsoRole(""), { kind: "REJECT", received: "" });
  // DEVELOPER는 역할이 아니라 users.is_developer로 표현된다.
  assert.deepEqual(decideSsoRole("DEVELOPER"), {
    kind: "REJECT",
    received: "DEVELOPER",
  });
});

test("대소문자를 관대하게 봐주지 않는다", () => {
  assert.deepEqual(decideSsoRole("super_admin"), {
    kind: "REJECT",
    received: "super_admin",
  });
  assert.deepEqual(decideSsoRole(" SUPER_ADMIN "), {
    kind: "REJECT",
    received: " SUPER_ADMIN ",
  });
});

test("문자열이 아니면 형만 알리고 거절한다", () => {
  assert.deepEqual(decideSsoRole(1), { kind: "REJECT", received: "number" });
  assert.deepEqual(decideSsoRole(["SUPER_ADMIN"]), {
    kind: "REJECT",
    received: "object",
  });
  assert.deepEqual(decideSsoRole(true), { kind: "REJECT", received: "boolean" });
});
