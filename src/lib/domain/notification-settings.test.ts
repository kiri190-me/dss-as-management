import { test } from "node:test";
import assert from "node:assert/strict";

import {
  NOTIFICATION_KIND_META,
  NO_NOTIFICATION_SETTINGS,
  buildNotificationSettingsScreenData,
  defaultNotificationKindEnabled,
  defaultRoleReceivesNotification,
  deliversNotification,
  isNotificationKind,
  isNotificationKindEnabled,
  isRoleEditableInNotificationSettings,
  roleReceivesNotification,
  type NotificationSettingsOverrides,
} from "./notification-settings";
import { NOTIFICATION_KINDS } from "./notifications";
import { canReceivePartRequestNotifications } from "@/lib/auth/inventory-authorization";
import { ROLE_CODES, type Role } from "./types";

/**
 * ============================================================================
 * 알림 설정 — 기본값과 거르기 규칙
 * ============================================================================
 * 여기서 지키려는 것은 하나다: **설정이 하나도 저장돼 있지 않을 때 알림 설정을
 * 만들기 전과 한 줄도 다르지 않다.** 표를 만들었는데 기존 동작이 바뀌면 그것이
 * 가장 나쁜 결과이므로, 다섯 역할 × 두 종류 열 칸을 하나씩 못 박는다.
 * ============================================================================
 */

/**
 * 알림 설정을 만들기 **전**의 규칙을 이 파일 안에 손으로 다시 적은 것.
 *
 * 일부러 defaultRoleReceivesNotification을 부르지 않는다 — 그 함수를 그대로
 * 부르면 무엇을 고쳐도 늘 통과하는 시험이 된다. 1단계 코드가 실제로 하던 일은
 * 이 두 줄이 전부였다:
 *   · 결재 대기      — 역할로 막는 코드가 한 줄도 없었다(전원 통과)
 *   · 부품 요청 대기 — queries/notifications.ts가 canReceivePartRequestNotifications로 걸렀다
 */
function ruleBeforeNotificationSettings(kind: string, role: Role): boolean {
  if (kind === "REPAIR_CASE_APPROVAL") return true;
  if (kind === "PART_REQUEST_PENDING") return canReceivePartRequestNotifications(role);
  throw new Error(`1단계에 없던 종류다: ${kind}`);
}

test("등록된 종류마다 사람이 읽는 이름과 한 줄 설명이 있다", () => {
  // 종류가 늘면 화면은 안 고치지만 이 표는 채워야 한다 — 이름 없는 줄이
  // 화면에 그려지면 관리자가 무엇을 끄는지 알 수 없다.
  for (const kind of NOTIFICATION_KINDS) {
    const meta = NOTIFICATION_KIND_META[kind];
    assert.ok(meta, `${kind}의 이름·설명이 없다`);
    assert.ok(meta.label.length > 0, `${kind}의 이름이 비어 있다`);
    assert.ok(meta.description.length > 0, `${kind}의 설명이 비어 있다`);
  }
});

test("isNotificationKind는 등록된 종류만 통과시킨다", () => {
  for (const kind of NOTIFICATION_KINDS) {
    assert.equal(isNotificationKind(kind), true, kind);
  }
  assert.equal(isNotificationKind("INVENTORY_LOW_STOCK"), false, "아직 없는 종류");
  assert.equal(isNotificationKind(""), false);
});

test("종류 자체는 켜져 있는 것이 기본이다", () => {
  for (const kind of NOTIFICATION_KINDS) {
    assert.equal(defaultNotificationKindEnabled(kind), true, kind);
    assert.equal(isNotificationKindEnabled(kind, NO_NOTIFICATION_SETTINGS), true, kind);
  }
});

test("🔴 설정이 하나도 없으면 다섯 역할의 알림이 1단계와 똑같다", () => {
  // 이 시험이 이번 작업의 성공 조건이다.
  for (const kind of NOTIFICATION_KINDS) {
    for (const role of ROLE_CODES) {
      assert.equal(
        deliversNotification(kind, role, NO_NOTIFICATION_SETTINGS),
        ruleBeforeNotificationSettings(kind, role),
        `${kind} × ${role} 이 1단계와 달라졌다`
      );
    }
  }
});

test("결재 대기의 기본값은 다섯 역할 전부 받음이다 — 지금 아무 역할도 막고 있지 않다", () => {
  for (const role of ROLE_CODES) {
    assert.equal(defaultRoleReceivesNotification("REPAIR_CASE_APPROVAL", role), true, role);
  }
});

test("부품 요청 대기의 기본값은 명단을 옮겨 적지 않고 저쪽 함수를 부른 결과다", () => {
  // 명단이 저쪽에서 바뀌면 여기 기본값도 저절로 따라 바뀌어야 한다.
  for (const role of ROLE_CODES) {
    assert.equal(
      defaultRoleReceivesNotification("PART_REQUEST_PENDING", role),
      canReceivePartRequestNotifications(role),
      role
    );
  }
  // 지금 답을 그대로 못 박아 둔다 — 위 단언만으로는 양쪽이 함께 틀려도 통과한다.
  assert.deepEqual(
    ROLE_CODES.filter((role) => defaultRoleReceivesNotification("PART_REQUEST_PENDING", role)),
    ["SUPER_ADMIN", "ADMIN", "INVENTORY_MANAGER"]
  );
});

test("🔴 최고관리자가 받는 것은 끌 수 없다 — 저장된 false도 무시한다", () => {
  assert.equal(isRoleEditableInNotificationSettings("SUPER_ADMIN"), false);
  for (const role of ROLE_CODES.filter((candidate) => candidate !== "SUPER_ADMIN")) {
    assert.equal(isRoleEditableInNotificationSettings(role), true, role);
  }

  // DB를 직접 고쳤거나 옛 행이 남아 있는 상황. 판정에서도 한 번 더 막는다.
  const tampered: NotificationSettingsOverrides = {
    kindEnabled: {},
    roleReceives: {
      REPAIR_CASE_APPROVAL: { SUPER_ADMIN: false },
      PART_REQUEST_PENDING: { SUPER_ADMIN: false },
    },
  };
  for (const kind of NOTIFICATION_KINDS) {
    assert.equal(roleReceivesNotification(kind, "SUPER_ADMIN", tampered), true, kind);
    assert.equal(deliversNotification(kind, "SUPER_ADMIN", tampered), true, kind);
  }
});

test("🔴 종류를 끄면 그 종류만 사라지고 다른 종류는 그대로다", () => {
  const overrides: NotificationSettingsOverrides = {
    kindEnabled: { PART_REQUEST_PENDING: false },
    roleReceives: {},
  };

  for (const role of ROLE_CODES) {
    assert.equal(
      deliversNotification("PART_REQUEST_PENDING", role, overrides),
      false,
      `끈 종류가 ${role}에게 아직 간다`
    );
    assert.equal(
      deliversNotification("REPAIR_CASE_APPROVAL", role, overrides),
      deliversNotification("REPAIR_CASE_APPROVAL", role, NO_NOTIFICATION_SETTINGS),
      `다른 종류가 ${role}에게서 달라졌다`
    );
  }
});

test("종류를 껐다 켜면 역할 설정이 그대로 살아 있다 — '모든 역할 해제'와 갈라지는 지점", () => {
  // 관리자가 재고 담당자를 부품 요청 알림에서 뺀 상태.
  const roleReceives: NotificationSettingsOverrides["roleReceives"] = {
    PART_REQUEST_PENDING: { INVENTORY_MANAGER: false },
  };

  const off: NotificationSettingsOverrides = {
    kindEnabled: { PART_REQUEST_PENDING: false },
    roleReceives,
  };
  const backOn: NotificationSettingsOverrides = { kindEnabled: {}, roleReceives };

  assert.equal(deliversNotification("PART_REQUEST_PENDING", "ADMIN", off), false, "꺼 두면 관리자에게도 안 간다");
  // 다시 켰을 때 관리자는 돌아오고, 빼 두었던 재고 담당자는 여전히 빠져 있다.
  assert.equal(deliversNotification("PART_REQUEST_PENDING", "ADMIN", backOn), true);
  assert.equal(deliversNotification("PART_REQUEST_PENDING", "INVENTORY_MANAGER", backOn), false);
});

test("역할 스위치를 끄면 그 역할만 빠진다", () => {
  const overrides: NotificationSettingsOverrides = {
    kindEnabled: {},
    roleReceives: { REPAIR_CASE_APPROVAL: { SALES: false } },
  };

  assert.equal(deliversNotification("REPAIR_CASE_APPROVAL", "SALES", overrides), false);
  for (const role of ROLE_CODES.filter((candidate) => candidate !== "SALES")) {
    assert.equal(deliversNotification("REPAIR_CASE_APPROVAL", role, overrides), true, role);
  }
  // 다른 종류는 건드려지지 않는다.
  assert.equal(
    deliversNotification("PART_REQUEST_PENDING", "SALES", overrides),
    canReceivePartRequestNotifications("SALES")
  );
});

test("역할 스위치를 켜도 기본값에 없던 종류가 열린다 — 윗단 필터이지 원래 판정이 아니다", () => {
  // 영업을 부품 요청 알림 대상으로 넣는다. 이 설정만으로 알림이 가는 것이
  // 아니라, 그 종류의 원래 판정이 여전히 따로 돈다는 것이 설계다 — 여기서는
  // 필터가 통과시킨다는 사실까지만 확인한다(원래 판정은 통합 테스트에서 본다).
  const overrides: NotificationSettingsOverrides = {
    kindEnabled: {},
    roleReceives: { PART_REQUEST_PENDING: { SALES: true } },
  };
  assert.equal(canReceivePartRequestNotifications("SALES"), false, "기본값에서는 닫혀 있다");
  assert.equal(deliversNotification("PART_REQUEST_PENDING", "SALES", overrides), true);
});

// ─────────────────────────────────────────────────────── 화면이 그릴 자료

test("화면 자료는 등록 순서대로 종류를 내고, 칸마다 지금 값과 기본값을 함께 준다", () => {
  const data = buildNotificationSettingsScreenData(NO_NOTIFICATION_SETTINGS);

  assert.deepEqual(
    data.kinds.map((row) => row.kind),
    [...NOTIFICATION_KINDS]
  );

  for (const row of data.kinds) {
    assert.equal(row.label, NOTIFICATION_KIND_META[row.kind].label);
    assert.equal(row.enabled, true);
    assert.equal(row.defaultEnabled, true);
    for (const role of ROLE_CODES) {
      const cell = row.roles[role];
      assert.equal(cell.defaultReceives, defaultRoleReceivesNotification(row.kind, role), `${row.kind}/${role}`);
      // 설정이 없으므로 지금 값 = 기본값이다. 이 둘이 갈라지면 화면이 아무도
      // 만지지 않은 칸에 '기본값에서 바뀜' 표시를 붙이게 된다.
      assert.equal(cell.receives, cell.defaultReceives, `${row.kind}/${role}`);
    }
  }
});

test("화면 자료는 저장된 값을 반영하되 기본값 칸은 그대로 남긴다", () => {
  const data = buildNotificationSettingsScreenData({
    kindEnabled: { PART_REQUEST_PENDING: false },
    roleReceives: { REPAIR_CASE_APPROVAL: { SALES: false } },
  });

  const approval = data.kinds.find((row) => row.kind === "REPAIR_CASE_APPROVAL");
  const partRequest = data.kinds.find((row) => row.kind === "PART_REQUEST_PENDING");
  assert.ok(approval && partRequest);

  assert.equal(partRequest.enabled, false);
  assert.equal(partRequest.defaultEnabled, true, "기본값은 저장된 값과 무관하게 그대로다");

  assert.equal(approval.roles.SALES.receives, false);
  assert.equal(approval.roles.SALES.defaultReceives, true, "기본값은 그대로여야 화면이 '바뀐 칸'을 표시한다");
  assert.equal(approval.roles.AS_ENGINEER.receives, true, "건드리지 않은 칸은 기본값 그대로다");

  // 종류를 꺼도 역할 칸의 값은 남아 있다 — 다시 켜면 그대로 돌아온다.
  assert.equal(partRequest.roles.INVENTORY_MANAGER.receives, true);
});
