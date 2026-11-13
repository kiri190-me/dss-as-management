import "../../../../scripts/load-env";

import { after, afterEach, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { eq, inArray, like } from "drizzle-orm";
import { db, pgClient } from "../connection";
import { auditLogs, badgeVisibilitySettings, users } from "../schema";
import {
  BADGE_VISIBILITY_AUDIT_ENTITY,
  saveBadgeVisibilitySettings,
} from "./badge-visibility-settings";
import {
  buildBadgeVisibilityView,
  loadStoredBadgeVisibilitySettings,
} from "../queries/badge-visibility-settings";
import { hasPermission } from "@/lib/auth/permission-resolver";
import { BADGES, BADGE_PLACEMENTS } from "@/lib/domain/badge-visibility";

/**
 * ============================================================================
 * 배지 표시 설정 저장 — 실제 DB (시험 DB) · 마이그레이션 0128 (2026-11-13, 조각 2)
 * ============================================================================
 * 본보기는 domestic-order-sheet-settings.integration.test.ts 다: 이 파일이 만든
 * "badgevis-test-" 계정만 쓰고, after() 에서 그 계정이 남긴 설정 행과 감사 기록까지
 * 지운다(badge_visibility_settings.updated_by → users 가 restrict 라 순서가 있다).
 *
 * 🔴 **빈 표를 전제로 한다.** 이 기능의 초기 상태가 빈 표이고, 시험이 남의 설정을
 * 덮어쓰거나 지우면 안 된다 — before() 가 비어 있는지 먼저 보고 아니면 멈춘다.
 *
 * 여기서 지키려는 것:
 *  1. 빈 표 = 전부 보임(편집 화면 자료가 배지 15 · 체크상자 29).
 *  2. 🔴 **끈 것만 행을 남긴다** — 체크를 풀면 false 행, 다시 켜면 **행이 지워진다.**
 *  3. 🔴 29쌍을 전부 켠 입력은 **빈 표**를 만든다(그 불변식이 이 기능의 바닥이다).
 *  4. 🔴 등록부에 없는 쌍은 거절되고, 같은 요청의 **멀쩡한 쌍도 안 들어간다.**
 *  5. 🔴 「바꿈」이 꺼진 역할은 저장이 거절된다 — 표본 계정은 개발자 표시가 꺼져 있다
 *     (켜져 있으면 최고관리자 권한이 더해져 「닫으면 막히는가」가 영영 통과한다).
 *  6. 감사 기록이 남는다(처음 끄기 = CREATE · 되돌리기 = UPDATE + revertedToDefault).
 *
 * 🔴 값은 전부 지어낸 것이다 — 접수 건도 고객사도 만들지 않는다(설정 표 하나뿐이다).
 * ============================================================================
 */

const TEST_EMAIL_PREFIX = "badgevis-test-";

let adminId: string;
/**
 * 🔴 **시스템 설정을 관리할 수 없는 사람의 표본.** 지키는 것은 「영업이 막힌다」가
 * 아니라 「**관리 권한이 없는 사람은 배지를 못 끈다**」이므로, 정책이 바뀌면 지키는
 * 대상은 그대로 두고 표본만 갈아 끼운다. 표본이 맞는지는 before() 가 hasPermission 으로
 * **먼저 확인한다** — 정책이 넓어지면 인가 시험이 조용히 뒤집히지 않고 거기서 멈춘다.
 *
 * 🔴 개발자 표시는 **꺼진 채로** 만든다(createTestUser 의 기본값). 켜면 최고관리자
 * 권한이 더해져(developer-promotion.ts) 이 묶음이 아무것도 안 잰다.
 */
let salesId: string;
let pendingAdminId: string;
const createdTestUserIds: string[] = [];

async function createTestUser(overrides: Partial<typeof users.$inferInsert> = {}): Promise<string> {
  const [row] = await db
    .insert(users)
    .values({
      email: `${TEST_EMAIL_PREFIX}${randomUUID().slice(0, 8)}@example.test`,
      name: "BadgeVisibility Test User",
      role: "SALES",
      approvalStatus: "APPROVED",
      isActive: true,
      ...overrides,
    })
    .returning({ id: users.id });
  createdTestUserIds.push(row.id);
  return row.id;
}

async function storedRows() {
  return db
    .select({
      id: badgeVisibilitySettings.id,
      badgeKey: badgeVisibilitySettings.badgeKey,
      placeKey: badgeVisibilitySettings.placeKey,
      isVisible: badgeVisibilitySettings.isVisible,
      updatedBy: badgeVisibilitySettings.updatedBy,
    })
    .from(badgeVisibilitySettings);
}

async function badgeAuditRows() {
  return db
    .select({
      actorUserId: auditLogs.actorUserId,
      actionType: auditLogs.actionType,
      targetRecordId: auditLogs.targetRecordId,
      previousValue: auditLogs.previousValue,
      newValue: auditLogs.newValue,
    })
    .from(auditLogs)
    .where(eq(auditLogs.targetEntity, BADGE_VISIBILITY_AUDIT_ENTITY));
}

/**
 * 이 파일의 계정과 그 계정이 남긴 설정 행·감사 기록을 지운다. 접두사로 고르므로
 * 이전 실행이 중간에 끊겨 남은 것까지 함께 걷는다.
 */
async function removeTestUsersByPrefix(): Promise<void> {
  const leftovers = await db
    .select({ id: users.id })
    .from(users)
    .where(like(users.email, `${TEST_EMAIL_PREFIX}%`));
  const ids = leftovers.map((row) => row.id);
  if (ids.length === 0) return;
  // badge_visibility_settings.updated_by → users (restrict): 설정 행이 먼저다.
  await db
    .delete(badgeVisibilitySettings)
    .where(inArray(badgeVisibilitySettings.updatedBy, ids));
  // audit_logs.actor_user_id → users (restrict): 행위자로만 고른다 —
  // target_record_id 로 고르는 모양은 test-cleanup-static-safety.test.ts 가 금지한다.
  await db.delete(auditLogs).where(inArray(auditLogs.actorUserId, ids));
  await db.delete(users).where(inArray(users.id, ids));
}

/** 이 파일의 계정이 저장한 설정 행만 지운다(시험마다 빈 표에서 시작하게). */
async function clearOwnRows(): Promise<void> {
  if (createdTestUserIds.length === 0) return;
  await db
    .delete(badgeVisibilitySettings)
    .where(inArray(badgeVisibilitySettings.updatedBy, createdTestUserIds));
}

before(async () => {
  await removeTestUsersByPrefix();

  assert.equal(
    (await storedRows()).length,
    0,
    "이 시험은 badge_visibility_settings 가 비어 있는 상태를 전제로 합니다 — 시험 DB 에 저장된 배지 설정이 있어 돌지 않습니다"
  );

  adminId = await createTestUser({ role: "ADMIN", name: "BadgeVisibility 관리자" });
  salesId = await createTestUser({ role: "SALES", name: "BadgeVisibility 영업" });
  pendingAdminId = await createTestUser({
    role: "ADMIN",
    approvalStatus: "PENDING",
    name: "BadgeVisibility 승인 대기 관리자",
  });

  // 전제: 시험 DB 의 권한 설정이 기본 정책과 같다 — 관리자는 시스템 설정을 관리할 수
  // 있고, 영업은 못 한다. 여기서 어긋나면 아래 인가 시험이 엉뚱한 이유로 실패한다.
  assert.equal(
    await hasPermission({ role: "ADMIN", isDeveloper: false }, "settings", "MANAGE"),
    true,
    "전제가 깨졌다: 시험 DB 에서 관리자가 시스템 설정을 관리할 수 없다"
  );
  assert.equal(
    await hasPermission({ role: "SALES", isDeveloper: false }, "settings", "MANAGE"),
    false,
    "전제가 깨졌다: 시험 DB 에서 영업이 시스템 설정을 관리할 수 있다 — 막히는 역할을 다시 골라야 한다"
  );
  // 🔴 보기는 닫히지 않았다 — 이 조각이 읽기를 함께 좁혔다면 여기서 멈춘다.
  assert.equal(
    await hasPermission({ role: "SALES", isDeveloper: false }, "settings", "READ"),
    true,
    "영업이 시스템 설정 화면에서 튕긴다 — 배지 설정을 넣으면서 읽기까지 좁혔다"
  );
});

afterEach(async () => {
  await clearOwnRows();
});

after(async () => {
  await removeTestUsersByPrefix();
  await pgClient.end({ timeout: 5 });
});

describe("① 빈 표 = 전부 보임", () => {
  test("1. 행이 없으면 저장된 것도 없다", async () => {
    assert.deepEqual(await loadStoredBadgeVisibilitySettings(), []);
  });

  test("2. 🔴 편집 화면 자료가 배지 15 · 체크상자 29 이고 전부 보임이다", async () => {
    const view = await buildBadgeVisibilityView();
    assert.equal(view.length, 15);
    assert.equal(view.length, BADGES.length);
    assert.equal(
      view.reduce((sum, badge) => sum + badge.places.length, 0),
      29
    );
    assert.equal(
      view.reduce((sum, badge) => sum + badge.places.length, 0),
      BADGE_PLACEMENTS.length
    );
    assert.equal(
      view.every((badge) => badge.places.every((place) => place.visible)),
      true
    );
  });

  test("3. 차례와 글자가 등록부 그대로다 — 화면이 다시 짓지 않는다", async () => {
    const view = await buildBadgeVisibilityView();
    assert.deepEqual(
      view.map((badge) => badge.badgeKey),
      BADGES.map((badge) => badge.key)
    );
    assert.deepEqual(
      view.map((badge) => badge.label),
      BADGES.map((badge) => badge.label)
    );
    assert.deepEqual(
      view.flatMap((badge) => badge.places.map((place) => place.placeKey)),
      BADGES.flatMap((badge) => [...badge.places])
    );
    // 자리 이름은 등록부의 자리 이름이다(「화면 이름 — 구역」 꼴).
    assert.equal(view[0].places[0].label, "전체 A/S 현황 — 목록");
  });
});

describe("② 끈 것만 행을 남긴다", () => {
  test("4. 🔴 체크를 풀면 `is_visible = false` 행 하나가 생긴다", async () => {
    const result = await saveBadgeVisibilitySettings({
      placements: [{ badgeKey: "repairStatus", placeKey: "repairCaseList", isVisible: false }],
      actorUserId: adminId,
    });
    assert.deepEqual(result, { ok: true, changedCount: 1 });

    const rows = await storedRows();
    assert.equal(rows.length, 1);
    assert.equal(rows[0].badgeKey, "repairStatus");
    assert.equal(rows[0].placeKey, "repairCaseList");
    assert.equal(rows[0].isVisible, false);
    assert.equal(rows[0].updatedBy, adminId);
  });

  test("5. 🔴 그 자리**만** 꺼진다 — 같은 배지의 다른 두 자리는 그대로다", async () => {
    await saveBadgeVisibilitySettings({
      placements: [{ badgeKey: "repairStatus", placeKey: "repairCaseList", isVisible: false }],
      actorUserId: adminId,
    });
    const view = await buildBadgeVisibilityView();
    const badge = view.find((one) => one.badgeKey === "repairStatus");
    assert.ok(badge);
    assert.equal(badge.places.length, 3, "표본이 비었다 — 자리가 하나면 이 시험이 아무것도 안 잰다");
    assert.equal(badge.places.find((place) => place.placeKey === "repairCaseList")?.visible, false);
    assert.equal(
      badge.places.filter((place) => place.placeKey !== "repairCaseList").every((p) => p.visible),
      true
    );
    // 다른 배지는 한 칸도 안 움직인다.
    assert.equal(
      view
        .filter((one) => one.badgeKey !== "repairStatus")
        .every((one) => one.places.every((place) => place.visible)),
      true
    );
  });

  test("6. 🔴 다시 켜면 **행이 지워진다** — true 행을 남기지 않는다", async () => {
    await saveBadgeVisibilitySettings({
      placements: [{ badgeKey: "hold", placeKey: "repairCaseList", isVisible: false }],
      actorUserId: adminId,
    });
    assert.equal((await storedRows()).length, 1);

    const result = await saveBadgeVisibilitySettings({
      placements: [{ badgeKey: "hold", placeKey: "repairCaseList", isVisible: true }],
      actorUserId: adminId,
    });
    assert.deepEqual(result, { ok: true, changedCount: 1 });
    assert.deepEqual(await storedRows(), [], "되돌렸는데 행이 남았다 — 빈 표 불변식이 깨진다");
  });

  test("7. 같은 값을 다시 저장하면 바뀐 것이 없다 — 기록도 안 늘어난다", async () => {
    await saveBadgeVisibilitySettings({
      placements: [{ badgeKey: "hold", placeKey: "repairCaseList", isVisible: false }],
      actorUserId: adminId,
    });
    const auditBefore = (await badgeAuditRows()).length;

    const again = await saveBadgeVisibilitySettings({
      placements: [{ badgeKey: "hold", placeKey: "repairCaseList", isVisible: false }],
      actorUserId: adminId,
    });
    assert.deepEqual(again, { ok: true, changedCount: 0 });
    assert.equal((await storedRows()).length, 1);
    assert.equal((await badgeAuditRows()).length, auditBefore);
  });

  test("8. 이미 보임인 자리를 켜도 아무 일이 없다(행이 안 생긴다)", async () => {
    const result = await saveBadgeVisibilitySettings({
      placements: [{ badgeKey: "priority", placeKey: "repairCaseList", isVisible: true }],
      actorUserId: adminId,
    });
    assert.deepEqual(result, { ok: true, changedCount: 0 });
    assert.deepEqual(await storedRows(), []);
  });

  test("9. 🔴 29쌍을 전부 끈 뒤 전부 켜면 **빈 표**로 돌아온다", async () => {
    const hideAll = await saveBadgeVisibilitySettings({
      placements: BADGE_PLACEMENTS.map((placement) => ({ ...placement, isVisible: false })),
      actorUserId: adminId,
    });
    assert.deepEqual(hideAll, { ok: true, changedCount: 29 });
    const hidden = await storedRows();
    assert.equal(hidden.length, 29);
    assert.equal(
      hidden.every((row) => row.isVisible === false),
      true
    );
    const hiddenView = await buildBadgeVisibilityView();
    assert.equal(
      hiddenView.every((badge) => badge.places.every((place) => !place.visible)),
      true
    );

    const showAll = await saveBadgeVisibilitySettings({
      placements: BADGE_PLACEMENTS.map((placement) => ({ ...placement, isVisible: true })),
      actorUserId: adminId,
    });
    assert.deepEqual(showAll, { ok: true, changedCount: 29 });
    assert.deepEqual(
      await storedRows(),
      [],
      "전부 켠 뒤에도 행이 남았다 — 「아무것도 안 건드린 시스템」과 달라진다"
    );
  });

  test("10. 빈 입력은 조용히 통과한다 — 바뀐 것 없음", async () => {
    assert.deepEqual(await saveBadgeVisibilitySettings({ placements: [], actorUserId: adminId }), {
      ok: true,
      changedCount: 0,
    });
  });
});

describe("③ 거절 — 등록부에 없는 쌍 · 중복", () => {
  test("11. 🔴 그 배지가 안 뜨는 자리는 거절된다", async () => {
    // 「수리 건 요청일」은 내자 정리에서만 뜬다. 전체 A/S 현황 쌍은 등록부에 없다.
    const result = await saveBadgeVisibilitySettings({
      placements: [
        { badgeKey: "dueDateFromRepairCase", placeKey: "repairCaseList", isVisible: false },
      ],
      actorUserId: adminId,
    });
    assert.equal(result.ok, false);
    assert.equal(result.ok === false && result.code, "INVALID_INPUT");
    assert.deepEqual(await storedRows(), []);
  });

  test("12. 모르는 배지 키·자리 키도 거절된다", async () => {
    for (const placement of [
      { badgeKey: "nosuchBadge", placeKey: "repairCaseList", isVisible: false },
      { badgeKey: "repairStatus", placeKey: "nosuchPlace", isVisible: false },
    ]) {
      const result = await saveBadgeVisibilitySettings({
        placements: [placement],
        actorUserId: adminId,
      });
      assert.equal(result.ok, false, `${placement.badgeKey}/${placement.placeKey}: 통과했다`);
    }
    assert.deepEqual(await storedRows(), []);
  });

  test("13. 🔴 한 요청에 섞여 있으면 **멀쩡한 쌍도 안 들어간다**", async () => {
    // 29개 중 몇 개만 반영된 상태를 만들지 않는다는 약속이 재어지는 자리다.
    const result = await saveBadgeVisibilitySettings({
      placements: [
        { badgeKey: "repairStatus", placeKey: "repairCaseList", isVisible: false },
        { badgeKey: "dueDateFromRepairCase", placeKey: "repairCaseList", isVisible: false },
      ],
      actorUserId: adminId,
    });
    assert.equal(result.ok, false);
    assert.deepEqual(await storedRows(), [], "앞줄이 저장된 채 남았다");
  });

  test("14. 같은 쌍이 두 번 오면 거절된다 — 어느 쪽이 뜻인지 알 수 없다", async () => {
    const result = await saveBadgeVisibilitySettings({
      placements: [
        { badgeKey: "source", placeKey: "repairCaseList", isVisible: false },
        { badgeKey: "source", placeKey: "repairCaseList", isVisible: true },
      ],
      actorUserId: adminId,
    });
    assert.equal(result.ok, false);
    assert.equal(result.ok === false && result.code, "INVALID_INPUT");
    assert.deepEqual(await storedRows(), []);
  });
});

describe("④ 🔴 권한 — 「바꿈」이 꺼진 역할은 거절된다", () => {
  test("15. 🔴 시스템 설정을 관리할 수 없는 사람은 못 끈다", async () => {
    const result = await saveBadgeVisibilitySettings({
      placements: [{ badgeKey: "repairStatus", placeKey: "repairCaseList", isVisible: false }],
      actorUserId: salesId,
    });
    assert.equal(result.ok, false);
    assert.equal(result.ok === false && result.code, "FORBIDDEN");
    assert.deepEqual(await storedRows(), []);
  });

  test("16. 🔵 표본이 공짜로 통과하지 않는다 — 같은 입력을 관리자가 보내면 저장된다", async () => {
    const result = await saveBadgeVisibilitySettings({
      placements: [{ badgeKey: "repairStatus", placeKey: "repairCaseList", isVisible: false }],
      actorUserId: adminId,
    });
    assert.deepEqual(result, { ok: true, changedCount: 1 });
    assert.equal((await storedRows()).length, 1);
  });

  test("17. 막히는 표본 계정은 **개발자 표시가 꺼져 있다**", async () => {
    // 🔴 켜져 있으면 최고관리자 권한이 더해져 위 15번이 영영 통과한다.
    const [row] = await db
      .select({ isDeveloper: users.isDeveloper })
      .from(users)
      .where(eq(users.id, salesId));
    assert.equal(row.isDeveloper, false);
  });

  test("18. 승인 대기 계정은 역할이 관리자여도 거절된다", async () => {
    const result = await saveBadgeVisibilitySettings({
      placements: [{ badgeKey: "repairStatus", placeKey: "repairCaseList", isVisible: false }],
      actorUserId: pendingAdminId,
    });
    assert.equal(result.ok, false);
    assert.equal(result.ok === false && result.code, "FORBIDDEN");
    assert.deepEqual(await storedRows(), []);
  });

  test("19. 없는 사용자도 거절된다", async () => {
    const result = await saveBadgeVisibilitySettings({
      placements: [{ badgeKey: "repairStatus", placeKey: "repairCaseList", isVisible: false }],
      actorUserId: randomUUID(),
    });
    assert.equal(result.ok, false);
    assert.equal(result.ok === false && result.code, "FORBIDDEN");
  });
});

describe("⑤ 감사 기록", () => {
  test("20. 처음 끄면 CREATE — 이전 값은 '보임'이다", async () => {
    await saveBadgeVisibilitySettings({
      placements: [{ badgeKey: "workflowOverride", placeKey: "repairCaseList", isVisible: false }],
      actorUserId: adminId,
    });
    const [row] = await storedRows();
    const logs = (await badgeAuditRows()).filter((log) => log.targetRecordId === row.id);
    assert.equal(logs.length, 1);
    assert.equal(logs[0].actionType, "CREATE");
    assert.equal(logs[0].actorUserId, adminId);
    assert.deepEqual(logs[0].previousValue, {
      badgeKey: "workflowOverride",
      placeKey: "repairCaseList",
      isVisible: true,
    });
    assert.deepEqual(logs[0].newValue, {
      badgeKey: "workflowOverride",
      placeKey: "repairCaseList",
      isVisible: false,
    });
  });

  test("21. 🔴 되돌리기는 **UPDATE** 다 — 자료가 없어진 것이 아니다", async () => {
    await saveBadgeVisibilitySettings({
      placements: [{ badgeKey: "workflowOverride", placeKey: "repairCaseList", isVisible: false }],
      actorUserId: adminId,
    });
    const [created] = await storedRows();
    await saveBadgeVisibilitySettings({
      placements: [{ badgeKey: "workflowOverride", placeKey: "repairCaseList", isVisible: true }],
      actorUserId: adminId,
    });

    const logs = (await badgeAuditRows()).filter((log) => log.targetRecordId === created.id);
    assert.equal(logs.length, 2);
    const revert = logs.find((log) => log.actionType === "UPDATE");
    assert.ok(revert, "되돌리기가 UPDATE 로 남지 않았다");
    assert.deepEqual(revert.newValue, {
      badgeKey: "workflowOverride",
      placeKey: "repairCaseList",
      isVisible: true,
      revertedToDefault: true,
    });
    // SOFT_DELETE/PURGE 로 남기면 로그를 읽는 사람이 "설정이 사라졌다"로 읽는다.
    assert.equal(
      logs.some((log) => log.actionType === "SOFT_DELETE" || log.actionType === "PURGE"),
      false
    );
  });
});
