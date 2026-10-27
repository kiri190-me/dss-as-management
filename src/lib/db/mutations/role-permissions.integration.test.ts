import "../../../../scripts/load-env";

import { after, afterEach, before, test } from "node:test";
import assert from "node:assert/strict";
import { eq, inArray } from "drizzle-orm";
import { db, pgClient } from "../connection";
import { rolePermissions, users } from "../schema";
import { saveRolePermissions } from "./role-permissions";
import { hasPermission, roleOnlyActor } from "@/lib/auth/permission-resolver";
import { PERMISSION_LEAF_KEYS } from "@/lib/auth/permission-features";
import { baselineLeafLevel } from "@/lib/auth/permission-baseline";
import type { PermissionLevel } from "@/lib/auth/permission-areas";
import { ROLE_CODES, type Role } from "@/lib/domain/types";

/**
 * ============================================================================
 * 역할 권한 저장 — 실제 DB 통합 테스트
 * ============================================================================
 * 여기서 지키려는 것은 하나다: **관리자는 기본 정책보다 넓게 줄 수 없다.**
 * 이 관문이 무너지면 관리자 계정 하나로 자기 역할에 없던 권한을 만들어
 * 최고관리자까지 올라갈 수 있으므로, 단위 테스트가 아니라 실제 저장 경로로
 * 확인한다.
 *
 * role_permissions는 픽스처로 격리할 수 없다(키가 역할+기능이라 전역이다).
 * 그래서 매 테스트가 끝날 때마다 이 파일이 건드린 역할의 행을 지운다. 감사
 * 로그는 남는다 — append-only가 맞고, 지우는 쪽이 오히려 이력의 뜻을 해친다.
 * ============================================================================
 */

/** 이 파일이 건드리는 역할. 최고관리자는 편집 자체가 거절되므로 제외한다. */
const TOUCHED_ROLES: Role[] = ["SALES", "AS_ENGINEER", "INVENTORY_MANAGER"];

let superAdminId: string;
let adminId: string;

before(async () => {
  const rows = await db
    .select({ id: users.id, role: users.role })
    .from(users)
    .where(inArray(users.role, ["SUPER_ADMIN", "ADMIN"]));

  const superAdmin = rows.find((row) => row.role === "SUPER_ADMIN");
  const admin = rows.find((row) => row.role === "ADMIN");
  assert.ok(superAdmin, "테스트 DB에 최고관리자 계정이 필요합니다 (npm run db:test:seed)");
  assert.ok(admin, "테스트 DB에 관리자 계정이 필요합니다 (npm run db:test:seed)");
  superAdminId = superAdmin.id;
  adminId = admin.id;

  const existing = await db.select({ id: rolePermissions.id }).from(rolePermissions);
  assert.equal(existing.length, 0, "이 테스트는 role_permissions가 비어 있는 상태를 전제로 합니다");
});

afterEach(async () => {
  await db.delete(rolePermissions).where(inArray(rolePermissions.role, TOUCHED_ROLES));
});

after(async () => {
  await pgClient.end();
});

async function storedLevel(role: Role, leafKey: string): Promise<PermissionLevel | null> {
  const rows = await db
    .select({ level: rolePermissions.level, areaKey: rolePermissions.areaKey })
    .from(rolePermissions)
    .where(eq(rolePermissions.role, role));
  return rows.find((row) => row.areaKey === leafKey)?.level ?? null;
}

/** 이 역할에게 지금은 없는 권한 하나. 넓히기를 시험할 대상이다. */
const WIDENING_TARGET = { role: "SALES" as Role, leafKey: "inventory.requests", to: "WRITE" as const };

test("전제 확인 — 시험 대상은 지금 그 역할에게 닫혀 있다", () => {
  assert.equal(baselineLeafLevel(WIDENING_TARGET.leafKey, WIDENING_TARGET.role), "NONE");
});

test("관리자는 기본 정책보다 넓게 줄 수 없다 — 조용히 기본값으로 깎인다", async () => {
  const result = await saveRolePermissions({
    changes: [{ role: WIDENING_TARGET.role, levels: { [WIDENING_TARGET.leafKey]: WIDENING_TARGET.to } }],
    actorUserId: adminId,
  });

  assert.equal(result.ok, true);
  // 기본값과 같아졌으므로 행 자체가 남지 않는다(= 설정 없음).
  assert.equal(await storedLevel(WIDENING_TARGET.role, WIDENING_TARGET.leafKey), null);
});

test("최고관리자는 기본 정책보다 넓게 줄 수 있다", async () => {
  const result = await saveRolePermissions({
    changes: [{ role: WIDENING_TARGET.role, levels: { [WIDENING_TARGET.leafKey]: WIDENING_TARGET.to } }],
    actorUserId: superAdminId,
  });

  assert.equal(result.ok, true);
  assert.equal(await storedLevel(WIDENING_TARGET.role, WIDENING_TARGET.leafKey), WIDENING_TARGET.to);
});

test("관리자도 좁히는 것은 할 수 있다", async () => {
  // 넓히기만 막는다. 좁히기까지 최고관리자 전용이면 이 화면이 관리자에게
  // 아무 쓸모가 없어진다.
  assert.equal(baselineLeafLevel("customers.view", "SALES"), "READ");

  const result = await saveRolePermissions({
    changes: [{ role: "SALES", levels: { "customers.view": "NONE" } }],
    actorUserId: adminId,
  });

  assert.equal(result.ok, true);
  assert.equal(await storedLevel("SALES", "customers.view"), "NONE");
});

test("고정 노드는 저장되지 않는다", async () => {
  // '역할별 접근 권한 설정'을 설정으로 닫을 수 있게 하면, 잘못 저장한 순간
  // 되돌릴 사람이 남지 않는다.
  const result = await saveRolePermissions({
    changes: [{ role: "SALES", levels: { "users.rolePermissions": "MANAGE" } }],
    actorUserId: superAdminId,
  });

  assert.equal(result.ok, true);
  assert.equal(await storedLevel("SALES", "users.rolePermissions"), null);
});

test("최고관리자 역할은 편집할 수 없다", async () => {
  const result = await saveRolePermissions({
    changes: [{ role: "SUPER_ADMIN", levels: { "customers.view": "NONE" } }],
    actorUserId: superAdminId,
  });

  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.code, "FORBIDDEN");
});

test("갈 곳이 하나도 남지 않는 저장은 거절한다", async () => {
  const allClosed = Object.fromEntries(PERMISSION_LEAF_KEYS.map((key) => [key, "NONE"]));

  const result = await saveRolePermissions({
    changes: [{ role: "SALES", levels: allClosed }],
    actorUserId: superAdminId,
  });

  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.code, "LOCKOUT");
});

test("한 역할이 거절되면 같이 보낸 다른 역할도 저장되지 않는다", async () => {
  // 여러 역할을 한 화면에서 편집하므로, 뒤엣것이 막혔는데 앞엣것만 저장되면
  // 권한이 반쯤 적용된 상태가 된다 — 무엇이 통하는지 아무도 모르게 된다.
  const allClosed = Object.fromEntries(PERMISSION_LEAF_KEYS.map((key) => [key, "NONE"]));

  const result = await saveRolePermissions({
    changes: [
      { role: "AS_ENGINEER", levels: { "customers.view": "NONE" } }, // 그 자체로는 정상
      { role: "SALES", levels: allClosed }, // 잠금 — 여기서 전체가 되돌아가야 한다
    ],
    actorUserId: superAdminId,
  });

  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.code, "LOCKOUT");
  assert.equal(await storedLevel("AS_ENGINEER", "customers.view"), null);
});

test("같은 역할을 두 번 보내면 거절한다", async () => {
  const result = await saveRolePermissions({
    changes: [
      { role: "SALES", levels: { "customers.view": "NONE" } },
      { role: "SALES", levels: { "customers.view": "READ" } },
    ],
    actorUserId: superAdminId,
  });

  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.code, "INVALID_INPUT");
});

test("그 기능에서 고를 수 없는 수준은 접근 불가로 정규화된다", async () => {
  // '삭제·복원'은 접근 불가 아니면 관리뿐이다. 읽기가 저장되면 화면이 고를 수
  // 없는 값을 그리게 된다.
  const result = await saveRolePermissions({
    changes: [{ role: "AS_ENGINEER", levels: { "repairCases.lifecycle": "READ" } }],
    actorUserId: superAdminId,
  });

  assert.equal(result.ok, true);
  const stored = await storedLevel("AS_ENGINEER", "repairCases.lifecycle");
  // 엔지니어의 기본값이 이미 접근 불가라면 행이 남지 않고, 아니면 접근 불가로 남는다.
  assert.ok(stored === null || stored === "NONE", `읽기가 그대로 저장됐다: ${stored}`);
});

test("트리에 없는 키는 저장되지 않는다", async () => {
  const result = await saveRolePermissions({
    changes: [{ role: "SALES", levels: { "inventory.nonexistent": "MANAGE", "옛날키": "MANAGE" } }],
    actorUserId: superAdminId,
  });

  assert.equal(result.ok, true);
  const rows = await db.select().from(rolePermissions).where(eq(rolePermissions.role, "SALES"));
  assert.equal(rows.length, 0);
});

/**
 * ────────────────────────────────────────────────────────────────────────────
 * 🔴 여기 있던 「끝단 증거」는 자리를 옮겼다 — 없어진 것이 아니다
 * ────────────────────────────────────────────────────────────────────────────
 * 「설정으로 저장한 값이 **실제로 그 mutation 을 열어 주는가**」를 끝에서 끝까지
 * 재는 자리는 이제 mutations/repair-case-used-parts.integration.test.ts 의
 * 「🔴 [역할별 접근 권한]에서 넓히면 실제로 열리고, 좁히면 막힌다」 하나다.
 *
 * 2026-10-27 에 옮겼다(옛 재고 걷어내기 13-C1). 여기 있던 표본이 `createPart`
 * (mutations/inventory.ts)였는데 옛 재고 mutation 은 곧 지워질 것이라 밑자락으로
 * 둘 수 없었다. 저쪽은 원래 표에 행을 직접 넣어 「넓히기 · 좁히기 · 조회 판정」을
 * 재고 있었고, 이번에 저장 경로(saveRolePermissions)로 바꿔 이 이음새까지 품었다.
 * 🔵 여기에 다시 만들지 말고 저쪽을 고쳐라.
 * ────────────────────────────────────────────────────────────────────────────
 */

test("한 노드 안에서 쓰기와 관리가 갈린다 — End-User 등록 vs 이름 변경", async () => {
  // 이 구분이 하위 기능 권한을 만든 계기다. 메뉴 하나에 수준 하나만 붙이던
  // 시절에는 "고객사 = 읽기+쓰기"가 곧 이름 변경 허용이었다.
  assert.equal(baselineLeafLevel("customers.endUsers", "SALES"), "WRITE");

  // 기본 상태: 영업은 등록은 되고 이름 변경은 안 된다.
  assert.equal(await hasPermission(roleOnlyActor("SALES"), "customers.endUsers", "WRITE"), true);
  assert.equal(await hasPermission(roleOnlyActor("SALES"), "customers.endUsers", "MANAGE"), false);

  // 최고관리자가 영업에게 이름 변경까지 열어 준다.
  const widened = await saveRolePermissions({
    changes: [{ role: "SALES", levels: { "customers.endUsers": "MANAGE" } }],
    actorUserId: superAdminId,
  });
  assert.equal(widened.ok, true);
  assert.equal(await hasPermission(roleOnlyActor("SALES"), "customers.endUsers", "MANAGE"), true);
});

test("좁히면 그 노드의 위쪽 수준만 닫힌다 — 담당자 삭제만 회수", async () => {
  assert.equal(baselineLeafLevel("customers.contacts", "AS_ENGINEER"), "WRITE");

  // 엔지니어는 원래 추가·수정만 되고 삭제는 안 된다. 관리자가 추가·수정까지
  // 회수하면 그 노드가 통째로 닫힌다 — 조회는 customers.view가 따로 맡는다.
  const narrowed = await saveRolePermissions({
    changes: [{ role: "AS_ENGINEER", levels: { "customers.contacts": "NONE" } }],
    actorUserId: adminId,
  });
  assert.equal(narrowed.ok, true);
  assert.equal(await hasPermission(roleOnlyActor("AS_ENGINEER"), "customers.contacts", "WRITE"), false);
  assert.equal(await hasPermission(roleOnlyActor("AS_ENGINEER"), "customers.view", "READ"), true);
});

test("영업의 고객사 추가는 기본으로 열려 있고, 관리자가 설정으로 회수할 수 있다", async () => {
  // 2026-09-13 에 새로 연 권한이다. 기본값으로 열어 둔 것을 설정으로 닫을 수
  // 없으면 넓힌 것을 되돌릴 길이 없다.
  assert.equal(baselineLeafLevel("customers.create", "SALES"), "WRITE");
  assert.equal(await hasPermission(roleOnlyActor("SALES"), "customers.create", "WRITE"), true);

  const narrowed = await saveRolePermissions({
    changes: [{ role: "SALES", levels: { "customers.create": "NONE" } }],
    actorUserId: adminId,
  });
  assert.equal(narrowed.ok, true);
  assert.equal(await storedLevel("SALES", "customers.create"), "NONE");
  assert.equal(await hasPermission(roleOnlyActor("SALES"), "customers.create", "WRITE"), false);
  // 추가만 닫혔다 — 조회와 End-User 등록은 그대로다.
  assert.equal(await hasPermission(roleOnlyActor("SALES"), "customers.view", "READ"), true);
  assert.equal(await hasPermission(roleOnlyActor("SALES"), "customers.endUsers", "WRITE"), true);
});

test("모든 역할의 모든 잎에 대해 기본값 그대로 저장하면 행이 하나도 생기지 않는다", async () => {
  // "기본으로 되돌림"과 "기본과 같은 값을 굳이 적어 둠"이 구별되어야, 나중에
  // 코드의 정책이 넓어졌을 때 옛 값에 묶이지 않는다.
  const changes = ROLE_CODES.filter((role) => role !== "SUPER_ADMIN").map((role) => ({
    role,
    levels: Object.fromEntries(
      PERMISSION_LEAF_KEYS.map((key) => [key, baselineLeafLevel(key, role)])
    ) as Record<string, string>,
  }));

  const result = await saveRolePermissions({ changes, actorUserId: superAdminId });

  assert.equal(result.ok, true);
  if (result.ok) assert.equal(result.changedCount, 0);
  const rows = await db.select().from(rolePermissions);
  assert.equal(rows.length, 0);
});
