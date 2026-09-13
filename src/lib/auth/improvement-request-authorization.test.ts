import { test } from "node:test";
import assert from "node:assert/strict";

import { ROLE_CODES, type Role } from "@/lib/domain/types";
import {
  canManageImprovementRequests,
  canViewImprovementRequests,
  canWriteImprovementRequests,
} from "./improvement-request-authorization";

/**
 * 역할 기본값 — 보기·적기는 모든 역할, 관리(상태 바꾸기 · 남의 글 지우기)는
 * 최고관리자 · 관리자. 개발자는 권한 판정이 최고관리자를 더해 읽으므로 여기서
 * 따로 보지 않는다(permission-resolver.ts 의 permissionRoles).
 */

test("보기는 모든 역할이다", () => {
  for (const role of ROLE_CODES) assert.equal(canViewImprovementRequests(role), true, role);
});

test("적기는 모든 역할이다", () => {
  for (const role of ROLE_CODES) assert.equal(canWriteImprovementRequests(role), true, role);
});

test("관리는 최고관리자 · 관리자뿐이다", () => {
  const managers = ROLE_CODES.filter(canManageImprovementRequests);
  assert.deepEqual(managers, ["SUPER_ADMIN", "ADMIN"]);
});

test("알 수 없는 역할 값에는 아무것도 열지 않는다", () => {
  const unknown = "DEVELOPER" as Role; // 개발자는 역할이 아니다(users.is_developer)
  assert.equal(canViewImprovementRequests(unknown), false);
  assert.equal(canWriteImprovementRequests(unknown), false);
  assert.equal(canManageImprovementRequests(unknown), false);
});
