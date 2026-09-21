import { describe, test } from "node:test";
import assert from "node:assert/strict";
import {
  buildPortalNotificationFeed,
  parseNotificationSettingsChanges,
  portalActorCanWork,
  portalNotificationRoles,
  readPortalNotificationSettings,
  writePortalNotificationSettings,
  type PortalActor,
} from "./portal-notifications";
import { buildApprovalNotification, type NotificationItem } from "@/lib/domain/notifications";
import { buildNotificationSettingsScreenData, NO_NOTIFICATION_SETTINGS } from "@/lib/domain/notification-settings";
import { roleLabels, type Role } from "@/lib/domain/types";

/**
 * ============================================================================
 * 포털이 물어 올 때의 판단 — DB 없이 그대로 돌려 본다
 * ============================================================================
 * 여기서 지키는 것:
 *  · 대상 사용자는 **토큰이 실어 온 sub** 로만 정해진다.
 *  · sso_subject 가 없는 사람은 **빈 목록**(오류 아님).
 *  · 설정 읽기·쓰기에 **기존 권한 판정**이 걸린다.
 * ============================================================================
 */

const BASE = "http://192.168.0.13:3000";
const SUBJECT = "portal-user-0001";
const LOCAL_ID = "33333333-3333-4333-8333-333333333333";

function actor(overrides: Partial<PortalActor> = {}): PortalActor {
  return {
    id: LOCAL_ID,
    role: "ADMIN",
    isDeveloper: false,
    approvalStatus: "APPROVED",
    isActive: true,
    lockedAt: null,
    ...overrides,
  };
}

const sampleNotification: NotificationItem = buildApprovalNotification({
  repairCaseId: "44444444-4444-4444-8444-444444444444",
  intakeNumber: "DSS-2026-0007",
  approvalType: "REPAIR_INSPECTION",
});

describe("portalActorCanWork", () => {
  test("승인 대기·비활성·잠긴 계정은 일할 수 없다", () => {
    assert.equal(portalActorCanWork(actor()), true);
    assert.equal(portalActorCanWork(actor({ approvalStatus: "PENDING" })), false);
    assert.equal(portalActorCanWork(actor({ isActive: false })), false);
    assert.equal(portalActorCanWork(actor({ lockedAt: new Date() })), false);
  });
});

describe("buildPortalNotificationFeed", () => {
  test("🔴 되짚는 열쇠는 토큰의 sub 다 — 다른 값이 끼어들 자리가 없다", async () => {
    const asked: string[] = [];
    await buildPortalNotificationFeed({
      subject: SUBJECT,
      baseUrl: BASE,
      findActor: async (subject) => {
        asked.push(subject);
        return actor();
      },
      listNotifications: async () => [],
    });
    assert.deepEqual(asked, [SUBJECT]);
  });

  test("🔴 A/S 계정이 없는 사람은 빈 목록이다 — 오류가 아니고, 조회를 부르지도 않는다", async () => {
    let called = false;
    const feed = await buildPortalNotificationFeed({
      subject: SUBJECT,
      baseUrl: BASE,
      findActor: async () => null,
      listNotifications: async () => {
        called = true;
        return [sampleNotification];
      },
    });
    assert.deepEqual(feed, { items: [], count: 0 });
    assert.equal(called, false);
  });

  test("정지·잠금·미승인 계정도 빈 목록이다", async () => {
    for (const broken of [
      actor({ approvalStatus: "PENDING" }),
      actor({ isActive: false }),
      actor({ lockedAt: new Date() }),
    ]) {
      const feed = await buildPortalNotificationFeed({
        subject: SUBJECT,
        baseUrl: BASE,
        findActor: async () => broken,
        listNotifications: async () => [sampleNotification],
      });
      assert.deepEqual(feed, { items: [], count: 0 });
    }
  });

  test("조회에는 **A/S 쪽 id 와 진짜 역할**이 넘어간다 — 포털 id 가 아니다", async () => {
    const seen: { userId: string; role: Role }[] = [];
    await buildPortalNotificationFeed({
      subject: SUBJECT,
      baseUrl: BASE,
      findActor: async () => actor({ role: "AS_ENGINEER", isDeveloper: true }),
      listNotifications: async (userId, role) => {
        seen.push({ userId, role });
        return [];
      },
    });
    // 승격하지 않은 진짜 역할 — (app)/layout.tsx 가 user.role 을 그대로 넘기는 것과 같다.
    assert.deepEqual(seen, [{ userId: LOCAL_ID, role: "AS_ENGINEER" }]);
  });

  test("🔴 링크가 절대 주소로 나가고, 개수는 대상 기준으로 센다", async () => {
    const repairCaseId = "55555555-5555-4555-8555-555555555555";
    const feed = await buildPortalNotificationFeed({
      subject: SUBJECT,
      baseUrl: BASE,
      findActor: async () => actor(),
      listNotifications: async () => [
        buildApprovalNotification({ repairCaseId, intakeNumber: "DSS-1", approvalType: "REPAIR_INSPECTION" }),
        buildApprovalNotification({ repairCaseId, intakeNumber: "DSS-1", approvalType: "FINAL_SHIPMENT" }),
      ],
    });
    assert.equal(feed.items.length, 2);
    for (const item of feed.items) {
      assert.ok(item.href.startsWith(`${BASE}/`), `상대경로가 그대로 나갔다: ${item.href}`);
    }
    assert.equal(feed.count, 1);
  });
});

describe("알림 설정 읽기", () => {
  const loadView = async () => buildNotificationSettingsScreenData(NO_NOTIFICATION_SETTINGS);

  test("🔴 역할 목록을 함께 내준다 — 포털은 A/S 의 역할을 모른다", async () => {
    const result = await readPortalNotificationSettings({
      subject: SUBJECT,
      findActor: async () => actor(),
      loadView,
    });
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.deepEqual(
      result.value.roles.map((one) => one.code),
      ["SUPER_ADMIN", "ADMIN", "AS_ENGINEER", "SALES", "INVENTORY_MANAGER"]
    );
    assert.equal(result.value.roles[0].label, roleLabels.SUPER_ADMIN);
    // 최고관리자 줄은 잠겨 있다는 사실도 함께 나간다.
    assert.equal(result.value.roles[0].editable, false);
    assert.equal(result.value.roles[1].editable, true);
  });

  test("종류마다 사람이 읽는 이름·설명과 기본값이 함께 나간다", async () => {
    const result = await readPortalNotificationSettings({
      subject: SUBJECT,
      findActor: async () => actor(),
      loadView,
    });
    assert.ok(result.ok);
    if (!result.ok) return;
    const first = result.value.kinds[0];
    assert.equal(first.kind, "REPAIR_CASE_APPROVAL");
    assert.ok(first.label.length > 0);
    assert.ok(first.description.length > 0);
    assert.equal(typeof first.enabled, "boolean");
    assert.equal(typeof first.defaultEnabled, "boolean");
    assert.equal(typeof first.roles.ADMIN.receives, "boolean");
    assert.equal(typeof first.roles.ADMIN.defaultReceives, "boolean");
  });

  test("🔴 관리자 미만은 읽지도 못한다 — 어느 역할이 무엇을 받는지가 조직 정보다", async () => {
    let loaded = false;
    const result = await readPortalNotificationSettings({
      subject: SUBJECT,
      findActor: async () => actor({ role: "AS_ENGINEER" }),
      loadView: async () => {
        loaded = true;
        return buildNotificationSettingsScreenData(NO_NOTIFICATION_SETTINGS);
      },
    });
    assert.equal(result.ok, false);
    assert.equal(result.ok === false && result.status, 403);
    assert.equal(loaded, false);
  });

  test("A/S 계정이 없으면 403 — 설정은 빈 목록으로 답할 수 있는 것이 아니다", async () => {
    const result = await readPortalNotificationSettings({
      subject: SUBJECT,
      findActor: async () => null,
      loadView,
    });
    assert.equal(result.ok, false);
    assert.equal(result.ok === false && result.status, 403);
  });

  test("개발자 표시는 기존 규칙대로 최고관리자 권한을 더한다", async () => {
    const result = await readPortalNotificationSettings({
      subject: SUBJECT,
      findActor: async () => actor({ role: "AS_ENGINEER", isDeveloper: true }),
      loadView,
    });
    assert.equal(result.ok, true);
  });
});

describe("알림 설정 쓰기", () => {
  const changes = [{ kind: "REPAIR_CASE_APPROVAL", enabled: true, roles: { ADMIN: false } }];

  test("🔴 관리자 미만이면 저장 함수를 부르지도 않는다", async () => {
    let saved = false;
    const result = await writePortalNotificationSettings({
      subject: SUBJECT,
      changes,
      findActor: async () => actor({ role: "SALES" }),
      save: async () => {
        saved = true;
        return { ok: true, changedCount: 1 };
      },
    });
    assert.equal(result.ok, false);
    assert.equal(result.ok === false && result.status, 403);
    assert.equal(saved, false);
  });

  test("🔴 저장은 **토큰에서 되짚은 A/S 사람**의 이름으로 남는다", async () => {
    const seen: { actorUserId: string }[] = [];
    const result = await writePortalNotificationSettings({
      subject: SUBJECT,
      changes,
      findActor: async () => actor(),
      save: async (input) => {
        seen.push({ actorUserId: input.actorUserId });
        assert.deepEqual(input.changes, changes);
        return { ok: true, changedCount: 2 };
      },
    });
    assert.deepEqual(seen, [{ actorUserId: LOCAL_ID }]);
    assert.deepEqual(result, { ok: true, value: { changedCount: 2 } });
  });

  test("저장 쪽이 거절하면 그 까닭대로 상태를 가른다", async () => {
    const forbidden = await writePortalNotificationSettings({
      subject: SUBJECT,
      changes,
      findActor: async () => actor(),
      save: async () => ({ ok: false, code: "FORBIDDEN", message: "안 된다" }),
    });
    assert.equal(forbidden.ok === false && forbidden.status, 403);

    const invalid = await writePortalNotificationSettings({
      subject: SUBJECT,
      changes,
      findActor: async () => actor(),
      save: async () => ({ ok: false, code: "INVALID_INPUT", message: "모양이 틀렸다" }),
    });
    assert.equal(invalid.ok === false && invalid.status, 400);
  });

  test("A/S 계정이 없으면 403", async () => {
    const result = await writePortalNotificationSettings({
      subject: SUBJECT,
      changes,
      findActor: async () => null,
      save: async () => ({ ok: true, changedCount: 0 }),
    });
    assert.equal(result.ok === false && result.status, 403);
  });
});

describe("parseNotificationSettingsChanges", () => {
  test("제대로 된 본문은 통과한다", () => {
    const result = parseNotificationSettingsChanges({
      changes: [{ kind: "REPAIR_CASE_APPROVAL", enabled: true, roles: { ADMIN: false } }],
    });
    assert.equal(result.ok, true);
  });

  test("빈 배열도 통과한다 — 바꿀 것이 없다는 뜻이다", () => {
    assert.equal(parseNotificationSettingsChanges({ changes: [] }).ok, true);
  });

  test("모양이 틀린 본문은 거절한다", () => {
    for (const body of [
      null,
      "changes",
      {},
      { changes: "x" },
      { changes: [null] },
      { changes: [{ enabled: true, roles: {} }] },
      { changes: [{ kind: "K", enabled: "yes", roles: {} }] },
      { changes: [{ kind: "K", enabled: true, roles: [] }] },
      { changes: [{ kind: "K", enabled: true, roles: null }] },
      { changes: [{ kind: "K", enabled: true, roles: { ADMIN: "no" } }] },
    ]) {
      assert.equal(parseNotificationSettingsChanges(body).ok, false, JSON.stringify(body));
    }
  });
});

describe("portalNotificationRoles", () => {
  test("코드와 이름이 한 쌍으로 나간다", () => {
    for (const role of portalNotificationRoles()) {
      assert.equal(role.label, roleLabels[role.code]);
    }
  });
});
