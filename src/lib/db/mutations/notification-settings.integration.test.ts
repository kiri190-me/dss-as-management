import "../../../../scripts/load-env";

import { after, afterEach, before, test } from "node:test";
import assert from "node:assert/strict";
import { and, eq, inArray } from "drizzle-orm";
import { db, pgClient } from "../connection";
import { auditLogs, notificationKindSettings, notificationRoleSettings, users } from "../schema";
import { saveNotificationSettings } from "./notification-settings";
import { loadStoredNotificationSettings } from "../queries/notification-settings";
import {
  defaultRoleReceivesNotification,
  deliversNotification,
} from "@/lib/domain/notification-settings";
import { NOTIFICATION_KINDS } from "@/lib/domain/notifications";
import { ROLE_CODES, type Role } from "@/lib/domain/types";

/**
 * ============================================================================
 * 알림 설정 저장 — 실제 DB 통합 테스트
 * ============================================================================
 * 여기서 지키려는 것은 셋이다:
 *  1. **최고관리자가 받는 것은 끌 수 없다.** 이 관문이 무너지면 알림을 전부
 *     꺼서 밀린 일을 아무도 모르는 상태를 만들 수 있으므로, 단위 테스트가
 *     아니라 실제 저장 경로로 확인한다.
 *  2. **기본값과 같은 값은 행으로 남지 않는다.** 남으면 나중에 코드의 기본값이
 *     바뀌었을 때 그 칸만 옛 값에 묶인다.
 *  3. **한 종류가 거절되면 같이 보낸 종류도 저장되지 않는다.**
 *
 * 이 두 표는 픽스처로 격리할 수 없다(키가 종류+역할이라 전역이다). 그래서 매
 * 테스트가 끝날 때마다 이 파일이 건드린 종류의 행을 지운다. 감사 로그는 남는다
 * — append-only가 맞고, 지우는 쪽이 오히려 이력의 뜻을 해친다
 * (role-permissions.integration.test.ts와 같은 규약).
 * ============================================================================
 */

/** 이 파일이 건드리는 종류 — 등록된 전부다. */
const TOUCHED_KINDS = [...NOTIFICATION_KINDS];

let superAdminId: string;
let adminId: string;
let engineerId: string;

before(async () => {
  const rows = await db
    .select({ id: users.id, role: users.role })
    .from(users)
    .where(inArray(users.role, ["SUPER_ADMIN", "ADMIN", "AS_ENGINEER"]));

  const superAdmin = rows.find((row) => row.role === "SUPER_ADMIN");
  const admin = rows.find((row) => row.role === "ADMIN");
  const engineer = rows.find((row) => row.role === "AS_ENGINEER");
  assert.ok(superAdmin, "테스트 DB에 최고관리자 계정이 필요합니다 (npm run db:test:seed)");
  assert.ok(admin, "테스트 DB에 관리자 계정이 필요합니다 (npm run db:test:seed)");
  assert.ok(engineer, "테스트 DB에 A/S 엔지니어 계정이 필요합니다 (npm run db:test:seed)");
  superAdminId = superAdmin.id;
  adminId = admin.id;
  engineerId = engineer.id;

  const existingKinds = await db.select({ id: notificationKindSettings.id }).from(notificationKindSettings);
  const existingRoles = await db.select({ id: notificationRoleSettings.id }).from(notificationRoleSettings);
  assert.equal(existingKinds.length, 0, "이 테스트는 알림 설정이 비어 있는 상태를 전제로 합니다");
  assert.equal(existingRoles.length, 0, "이 테스트는 알림 설정이 비어 있는 상태를 전제로 합니다");
});

afterEach(async () => {
  await db.delete(notificationRoleSettings).where(inArray(notificationRoleSettings.kindKey, TOUCHED_KINDS));
  await db.delete(notificationKindSettings).where(inArray(notificationKindSettings.kindKey, TOUCHED_KINDS));
});

after(async () => {
  await pgClient.end({ timeout: 5 });
});

async function storedKindEnabled(kind: string): Promise<boolean | null> {
  const [row] = await db
    .select({ isEnabled: notificationKindSettings.isEnabled })
    .from(notificationKindSettings)
    .where(eq(notificationKindSettings.kindKey, kind));
  return row?.isEnabled ?? null;
}

async function storedRoleReceives(kind: string, role: Role): Promise<boolean | null> {
  const [row] = await db
    .select({ receives: notificationRoleSettings.receives })
    .from(notificationRoleSettings)
    .where(and(eq(notificationRoleSettings.kindKey, kind), eq(notificationRoleSettings.role, role)));
  return row?.receives ?? null;
}

/** 화면이 보내는 모양 그대로 — 다섯 역할 값을 전부 담아 되보낸다. */
function allDefaults(kind: (typeof NOTIFICATION_KINDS)[number], overrides: Partial<Record<Role, boolean>> = {}) {
  return {
    kind,
    enabled: true,
    roles: Object.fromEntries(
      ROLE_CODES.map((role) => [role, overrides[role] ?? defaultRoleReceivesNotification(kind, role)])
    ) as Record<string, boolean>,
  };
}

test("기본값 그대로 저장하면 행이 하나도 생기지 않는다", async () => {
  // "기본으로 되돌림"과 "기본과 같은 값을 굳이 적어 둠"이 구별되어야, 나중에
  // 코드의 기본값이 바뀌었을 때 옛 값에 묶이지 않는다.
  const result = await saveNotificationSettings({
    changes: NOTIFICATION_KINDS.map((kind) => allDefaults(kind)),
    actorUserId: superAdminId,
  });

  assert.equal(result.ok, true);
  if (result.ok) assert.equal(result.changedCount, 0);
  assert.equal((await db.select().from(notificationKindSettings)).length, 0);
  assert.equal((await db.select().from(notificationRoleSettings)).length, 0);
});

test("종류를 끄면 종류 표에만 행이 생긴다 — 역할 표는 한 줄도 건드리지 않는다", async () => {
  const result = await saveNotificationSettings({
    changes: [{ ...allDefaults("PART_REQUEST_PENDING"), enabled: false }],
    actorUserId: adminId,
  });

  assert.equal(result.ok, true);
  if (result.ok) assert.equal(result.changedCount, 1);
  assert.equal(await storedKindEnabled("PART_REQUEST_PENDING"), false);
  assert.equal(
    (await db.select().from(notificationRoleSettings)).length,
    0,
    "종류를 껐다고 역할 행이 생기면, 다시 켤 때 원래 누가 받았는지가 사라진다"
  );
});

test("기본값에서 뺀 역할만 행으로 남는다", async () => {
  assert.equal(defaultRoleReceivesNotification("PART_REQUEST_PENDING", "INVENTORY_MANAGER"), true);

  const result = await saveNotificationSettings({
    changes: [allDefaults("PART_REQUEST_PENDING", { INVENTORY_MANAGER: false })],
    actorUserId: adminId,
  });

  assert.equal(result.ok, true);
  if (result.ok) assert.equal(result.changedCount, 1);
  assert.equal(await storedRoleReceives("PART_REQUEST_PENDING", "INVENTORY_MANAGER"), false);
  // 나머지 넷은 기본값과 같으므로 행이 없다.
  assert.equal((await db.select().from(notificationRoleSettings)).length, 1);
});

test("기본값으로 되돌리면 행이 지워진다", async () => {
  await saveNotificationSettings({
    changes: [allDefaults("PART_REQUEST_PENDING", { INVENTORY_MANAGER: false })],
    actorUserId: adminId,
  });
  assert.equal(await storedRoleReceives("PART_REQUEST_PENDING", "INVENTORY_MANAGER"), false);

  const result = await saveNotificationSettings({
    changes: [allDefaults("PART_REQUEST_PENDING")],
    actorUserId: adminId,
  });

  assert.equal(result.ok, true);
  if (result.ok) assert.equal(result.changedCount, 1, "지운 것도 바뀐 것으로 센다");
  assert.equal(await storedRoleReceives("PART_REQUEST_PENDING", "INVENTORY_MANAGER"), null);
});

test("🔴 최고관리자가 받는 것은 끌 수 없다", async () => {
  const result = await saveNotificationSettings({
    changes: [allDefaults("REPAIR_CASE_APPROVAL", { SUPER_ADMIN: false })],
    actorUserId: superAdminId,
  });

  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.code, "FORBIDDEN");
    assert.match(result.message, /최고관리자/);
  }
  assert.equal(await storedRoleReceives("REPAIR_CASE_APPROVAL", "SUPER_ADMIN"), null);
});

test("최고관리자를 켠 채로 보내는 것은 통과하되, 행으로 남지 않는다", async () => {
  // 화면은 잠긴 체크박스를 켠 상태로 함께 되보낸다. 그 값 때문에 저장이 통째로
  // 실패하면 화면을 쓸 수 없다.
  const result = await saveNotificationSettings({
    changes: [allDefaults("REPAIR_CASE_APPROVAL", { SALES: false, SUPER_ADMIN: true })],
    actorUserId: superAdminId,
  });

  assert.equal(result.ok, true);
  assert.equal(await storedRoleReceives("REPAIR_CASE_APPROVAL", "SUPER_ADMIN"), null);
  assert.equal(await storedRoleReceives("REPAIR_CASE_APPROVAL", "SALES"), false);
});

test("같은 종류를 두 번 보내면 거절한다", async () => {
  const result = await saveNotificationSettings({
    changes: [
      allDefaults("PART_REQUEST_PENDING", { INVENTORY_MANAGER: false }),
      allDefaults("PART_REQUEST_PENDING"),
    ],
    actorUserId: superAdminId,
  });

  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.code, "INVALID_INPUT");
  assert.equal((await db.select().from(notificationRoleSettings)).length, 0);
});

test("🔴 한 종류가 거절되면 같이 보낸 다른 종류도 저장되지 않는다", async () => {
  // 두 종류를 한 표에서 편집하므로, 뒤엣것이 막혔는데 앞엣것만 저장되면 누가
  // 무엇을 받고 있는지 아무도 모르는 상태가 된다.
  const result = await saveNotificationSettings({
    changes: [
      allDefaults("PART_REQUEST_PENDING", { INVENTORY_MANAGER: false }), // 그 자체로는 정상
      allDefaults("REPAIR_CASE_APPROVAL", { SUPER_ADMIN: false }), // 거절 — 여기서 전체가 되돌아가야 한다
    ],
    actorUserId: superAdminId,
  });

  assert.equal(result.ok, false);
  assert.equal(await storedRoleReceives("PART_REQUEST_PENDING", "INVENTORY_MANAGER"), null);
});

test("등록되지 않은 종류는 저장되지 않는다", async () => {
  const result = await saveNotificationSettings({
    changes: [
      { kind: "INVENTORY_LOW_STOCK", enabled: false, roles: { SALES: true } },
      { kind: "옛날종류", enabled: true, roles: { ADMIN: false } },
    ],
    actorUserId: superAdminId,
  });

  assert.equal(result.ok, true);
  if (result.ok) assert.equal(result.changedCount, 0);
  assert.equal((await db.select().from(notificationKindSettings)).length, 0);
  assert.equal((await db.select().from(notificationRoleSettings)).length, 0);
});

test("관리자 미만은 저장할 수 없다 — 트랜잭션 안에서 다시 확인한다", async () => {
  const result = await saveNotificationSettings({
    changes: [allDefaults("PART_REQUEST_PENDING", { INVENTORY_MANAGER: false })],
    actorUserId: engineerId,
  });

  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.code, "FORBIDDEN");
  assert.equal((await db.select().from(notificationRoleSettings)).length, 0);
});

test("없는 사용자로는 저장할 수 없다", async () => {
  const result = await saveNotificationSettings({
    changes: [allDefaults("PART_REQUEST_PENDING", { INVENTORY_MANAGER: false })],
    actorUserId: "00000000-0000-0000-0000-000000000000",
  });

  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.code, "FORBIDDEN");
});

test("관리자도 좁히고 넓힐 수 있다 — 알림은 인가 경계가 아니다", async () => {
  // 권한 설정과 다른 점이다. 알림을 넓혀도 없던 권한이 생기지 않으므로
  // (설정은 윗단 필터일 뿐 원래 판정을 대신하지 않는다) 관리자에게도 연다.
  assert.equal(defaultRoleReceivesNotification("PART_REQUEST_PENDING", "SALES"), false);

  const result = await saveNotificationSettings({
    changes: [allDefaults("PART_REQUEST_PENDING", { SALES: true })],
    actorUserId: adminId,
  });

  assert.equal(result.ok, true);
  assert.equal(await storedRoleReceives("PART_REQUEST_PENDING", "SALES"), true);
});

test("🔴 종류를 껐다 켜도 역할 설정이 그대로 살아 있다", async () => {
  // 이것이 표를 둘로 나눈 이유다 — '모든 역할 해제'로 대신했다면 다시 켤 때
  // 원래 누가 받았는지가 남지 않는다.
  await saveNotificationSettings({
    changes: [allDefaults("PART_REQUEST_PENDING", { INVENTORY_MANAGER: false })],
    actorUserId: adminId,
  });

  await saveNotificationSettings({
    changes: [{ ...allDefaults("PART_REQUEST_PENDING", { INVENTORY_MANAGER: false }), enabled: false }],
    actorUserId: adminId,
  });
  assert.equal(await storedKindEnabled("PART_REQUEST_PENDING"), false);
  assert.equal(await storedRoleReceives("PART_REQUEST_PENDING", "INVENTORY_MANAGER"), false);

  await saveNotificationSettings({
    changes: [allDefaults("PART_REQUEST_PENDING", { INVENTORY_MANAGER: false })],
    actorUserId: adminId,
  });

  const stored = await loadStoredNotificationSettings();
  assert.equal(await storedKindEnabled("PART_REQUEST_PENDING"), null, "다시 켜면 종류 행이 지워진다");
  assert.equal(
    deliversNotification("PART_REQUEST_PENDING", "ADMIN", stored),
    true,
    "켜면 관리자는 그대로 돌아온다"
  );
  assert.equal(
    deliversNotification("PART_REQUEST_PENDING", "INVENTORY_MANAGER", stored),
    false,
    "빼 두었던 역할은 여전히 빠져 있다"
  );
});

test("감사 로그를 남긴다 — 만들 때·바꿀 때·기본값으로 되돌릴 때", async () => {
  const before = await countAuditLogs();

  await saveNotificationSettings({
    changes: [{ ...allDefaults("PART_REQUEST_PENDING", { INVENTORY_MANAGER: false }), enabled: false }],
    actorUserId: adminId,
  });
  const afterCreate = await countAuditLogs();
  assert.equal(afterCreate.kind, before.kind + 1, "종류 스위치 기록");
  assert.equal(afterCreate.role, before.role + 1, "역할 칸 기록");

  await saveNotificationSettings({
    changes: [allDefaults("PART_REQUEST_PENDING")],
    actorUserId: adminId,
  });
  const afterRevert = await countAuditLogs();
  assert.equal(afterRevert.kind, afterCreate.kind + 1, "기본값으로 되돌린 것도 기록된다");
  assert.equal(afterRevert.role, afterCreate.role + 1);

  const rows = await db
    .select({ actorUserId: auditLogs.actorUserId })
    .from(auditLogs)
    .where(eq(auditLogs.targetEntity, "notification_role_settings"));
  assert.ok(
    rows.some((row) => row.actorUserId === adminId),
    "누가 바꿨는지가 남아야 한다"
  );
});

async function countAuditLogs(): Promise<{ kind: number; role: number }> {
  const rows = await db
    .select({ targetEntity: auditLogs.targetEntity })
    .from(auditLogs)
    .where(
      inArray(auditLogs.targetEntity, ["notification_kind_settings", "notification_role_settings"])
    );
  return {
    kind: rows.filter((row) => row.targetEntity === "notification_kind_settings").length,
    role: rows.filter((row) => row.targetEntity === "notification_role_settings").length,
  };
}
