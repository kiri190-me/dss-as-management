import { test } from "node:test";
import assert from "node:assert/strict";

import {
  NOTIFICATION_KIND_META,
  NO_NOTIFICATION_SETTINGS,
  buildNotificationSettingsScreenData,
  canReceiveLowStockNotifications,
  defaultNotificationKindEnabled,
  defaultRoleReceivesNotification,
  deliversNotification,
  isNotificationKind,
  isNotificationKindEnabled,
  isRoleEditableInNotificationSettings,
  roleReceivesNotification,
  type NotificationSettingsOverrides,
} from "./notification-settings";
import { APPROVAL_OUTCOME_NOTIFICATION_WINDOW_DAYS, NOTIFICATION_KINDS } from "./notifications";
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
 * 각 종류가 **누구에게 가야 하는가**를 이 파일 안에 손으로 다시 적은 것.
 *
 * 일부러 defaultRoleReceivesNotification을 부르지 않는다 — 그 함수를 그대로
 * 부르면 무엇을 고쳐도 늘 통과하는 시험이 된다. 앞의 두 종류는 알림 설정을
 * 만들기 **전**의 코드가 실제로 하던 일이 전부였다:
 *   · 결재 대기      — 역할로 막는 코드가 한 줄도 없었다(전원 통과)
 *   · 부품 요청 대기 — queries/notifications.ts가 canReceivePartRequestNotifications로 걸렀다
 *
 * 3단계에서 붙인 재고 부족은 그 이전에 존재하지 않았으므로 재현할 옛 동작이
 * 없다. 대신 **그때 내린 결정**을 여기 손으로 적는다 — 재고를 채우는 사람
 * 셋(재고관리자·관리자·최고관리자). 여전히 저쪽 함수를 부르지 않는 것이 요점이다.
 *
 * 모르는 종류는 계속 throw 한다. 종류만 늘리고 이 규칙을 적지 않으면, 아무도
 * 판정하지 않은 알림이 조용히 태어난다.
 */
function ruleBeforeNotificationSettings(kind: string, role: Role): boolean {
  if (kind === "REPAIR_CASE_APPROVAL") return true;
  if (kind === "PART_REQUEST_PENDING") return canReceivePartRequestNotifications(role);
  if (kind === "PART_STOCK_BELOW_MINIMUM") {
    return role === "SUPER_ADMIN" || role === "ADMIN" || role === "INVENTORY_MANAGER";
  }
  if (kind === "CUSTOMER_REPAIR_REQUEST_NEW") {
    // 재고 부족과 같이 재현할 옛 동작이 없어 **그때 내린 결정**을 손으로
    // 적는다 — 접수를 만들 수 있는 넷(최고관리자·관리자·A/S 엔지니어·영업).
    // 재고관리자만 빠지는 이유: 이 알림은 "고객이 기다리고 있다"는 신호인데
    // 그 사람에게는 접수를 만들 수단이 없다. 손댈 수 없는 사람에게 보내는
    // 알림은 끌 수도 없는 소음이 된다.
    //
    // 여전히 canReceiveCustomerRepairRequestNotifications를 부르지 않는 것이
    // 요점이다 — 부르면 무엇을 고쳐도 늘 통과하는 시험이 된다.
    return (
      role === "SUPER_ADMIN" ||
      role === "ADMIN" ||
      role === "AS_ENGINEER" ||
      role === "SALES"
    );
  }
  if (kind === "PART_ISSUE_APPROVAL_PENDING") {
    // 새로 태어난 종류라 재현할 옛 동작은 없고, **그때 내린 결정**을 손으로
    // 적는다 — 다섯 역할 전부. 결재 대기와 같은 이유다: 누가 받는지는 역할이
    // 아니라 결재선 지정(과 최고관리자 비상구)이 정하고, 결재선에는 역할 제한 없이
    // 누구든 올라간다. 역할을 하나라도 빼면 자기 차례인 결재자가 알림을 못 받는다.
    return true;
  }
  if (kind === "APPROVAL_GRANTED" || kind === "APPROVAL_REJECTED") {
    // 새로 태어난 종류라 재현할 옛 동작은 없고, **그때 내린 결정**을 손으로
    // 적는다 — 다섯 역할 전부. 요청자 본인에게만 가는 사람 단위 알림이라(조회가
    // requested_by_user_id = 나 로 정한다) 역할로 막을 것이 없고, 결재를 요청하는
    // 쪽은 역할이 여럿이다.
    return true;
  }
  throw new Error(`대상을 판정한 적 없는 종류다: ${kind}`);
}

test("등록된 종류마다 사람이 읽는 이름과 한 줄 설명과 글자색이 있다", () => {
  // 종류가 늘면 화면은 안 고치지만 이 표는 채워야 한다 — 이름 없는 줄이
  // 화면에 그려지면 관리자가 무엇을 끄는지 알 수 없다. 색도 같다: 화면은 이
  // 값을 읽기만 하므로, 여기가 비면 종 패널에 색 없는 줄이 그려진다.
  for (const kind of NOTIFICATION_KINDS) {
    const meta = NOTIFICATION_KIND_META[kind];
    assert.ok(meta, `${kind}의 이름·설명·색이 없다`);
    assert.ok(meta.label.length > 0, `${kind}의 이름이 비어 있다`);
    assert.ok(meta.description.length > 0, `${kind}의 설명이 비어 있다`);
    assert.ok(meta.toneClassName.length > 0, `${kind}의 글자색이 비어 있다`);
  }
});

test("🔴 종류마다 색이 서로 다르다 — 같은 색이면 갈라 보이지 않는다", () => {
  const tones = NOTIFICATION_KINDS.map((kind) => NOTIFICATION_KIND_META[kind].toneClassName);
  assert.equal(new Set(tones).size, tones.length, `색이 겹친다: ${tones.join(" / ")}`);
});

test("🔴 색은 밝은 화면과 어두운 화면 두 벌이고, 조립하지 않은 온전한 클래스 이름이다", () => {
  // Tailwind는 소스에 **글자 그대로** 적힌 클래스만 CSS로 만든다. 조각을 붙여
  // 만들면 빌드 결과에 그 클래스가 없어 화면에서 색이 아예 나오지 않는다
  // (customer-row-color.ts가 같은 이유로 같은 규칙을 지킨다). 어두운 화면 값이
  // 빠지면 한쪽 화면에서만 읽히는 색이 된다.
  for (const kind of NOTIFICATION_KINDS) {
    const tone = NOTIFICATION_KIND_META[kind].toneClassName;
    assert.match(tone, /^text-[a-z]+-\d{2,3} dark:text-[a-z]+-\d{2,3}$/, `${kind}: ${tone}`);
    assert.ok(!tone.includes("${"), `${kind}의 색을 조립하면 Tailwind가 만들지 않는다`);
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

test("🔴 설정이 하나도 없으면 다섯 역할의 알림이 손으로 적은 규칙 그대로다", () => {
  // 이 시험이 이번 작업의 성공 조건이다. 앞의 두 종류에서는 "1단계와 똑같다"가,
  // 재고 부족에서는 "정한 대로 간다"가 그 뜻이다.
  for (const kind of NOTIFICATION_KINDS) {
    for (const role of ROLE_CODES) {
      assert.equal(
        deliversNotification(kind, role, NO_NOTIFICATION_SETTINGS),
        ruleBeforeNotificationSettings(kind, role),
        `${kind} × ${role} 이 손으로 적은 규칙과 달라졌다`
      );
    }
  }
});

test("결재 대기의 기본값은 다섯 역할 전부 받음이다 — 지금 아무 역할도 막고 있지 않다", () => {
  for (const role of ROLE_CODES) {
    assert.equal(defaultRoleReceivesNotification("REPAIR_CASE_APPROVAL", role), true, role);
  }
});

test("🔴 불출 승인 대기의 기본값도 다섯 역할 전부 받음이다 — 누가 받는지는 결재선 지정이 정한다", () => {
  // 결재선에는 역할 제한 없이 누구든 올라간다(영업도). 여기서 어느 역할이
  // 빠지면 그 역할의 결재자는 자기 차례인데 알림을 못 받고, 그 실패는 화면에
  // 아무 표시도 남기지 않는다.
  for (const role of ROLE_CODES) {
    assert.equal(defaultRoleReceivesNotification("PART_ISSUE_APPROVAL_PENDING", role), true, role);
    assert.equal(deliversNotification("PART_ISSUE_APPROVAL_PENDING", role, NO_NOTIFICATION_SETTINGS), true, role);
  }
  assert.equal(defaultNotificationKindEnabled("PART_ISSUE_APPROVAL_PENDING"), true, "켜진 채로 태어난다");
});

test("불출 승인 대기는 결재 대기와 이름·색이 갈라진다 — 한 패널에 섞여도 구별된다", () => {
  const partIssue = NOTIFICATION_KIND_META.PART_ISSUE_APPROVAL_PENDING;
  const approval = NOTIFICATION_KIND_META.REPAIR_CASE_APPROVAL;
  assert.equal(partIssue.label, "불출 승인 대기");
  assert.notEqual(partIssue.label, approval.label);
  assert.notEqual(partIssue.toneClassName, approval.toneClassName);
  // 색상 이름까지 달라야 한다 — 같은 amber 의 진하기만 바꾸면 눈으로 갈라지지 않는다.
  const hueOf = (tone: string) => tone.match(/^text-([a-z]+)-/)?.[1];
  const hues = NOTIFICATION_KINDS.map((kind) => hueOf(NOTIFICATION_KIND_META[kind].toneClassName));
  assert.equal(new Set(hues).size, hues.length, `색상 이름이 겹친다: ${hues.join(" / ")}`);
});

test("🔴 승인 완료·반려됨의 기본값은 켜짐·다섯 역할 전부 받음이다 — 요청자 본인에게만 가는 알림이다", () => {
  for (const kind of ["APPROVAL_GRANTED", "APPROVAL_REJECTED"] as const) {
    assert.equal(defaultNotificationKindEnabled(kind), true, `${kind} 는 켜진 채로 태어난다`);
    for (const role of ROLE_CODES) {
      assert.equal(defaultRoleReceivesNotification(kind, role), true, `${kind}/${role}`);
      assert.equal(deliversNotification(kind, role, NO_NOTIFICATION_SETTINGS), true, `${kind}/${role}`);
    }
  }
});

test("승인 완료·반려됨의 이름과 설명 — 사람이 읽는 말로, 창의 날짜 수는 상수에서 온다", () => {
  const granted = NOTIFICATION_KIND_META.APPROVAL_GRANTED;
  const rejected = NOTIFICATION_KIND_META.APPROVAL_REJECTED;
  assert.equal(granted.label, "승인 완료");
  assert.equal(rejected.label, "반려됨");
  for (const meta of [granted, rejected]) {
    // 관리자가 이 설명만 읽고 무엇을 끄는지 알아야 한다 — 누구에게 가는가, 언제까지
    // 뜨는가, 어떻게 사라지는가.
    assert.ok(meta.description.includes("요청"), meta.description);
    assert.ok(meta.description.includes(`${APPROVAL_OUTCOME_NOTIFICATION_WINDOW_DAYS}일`), meta.description);
    assert.ok(meta.description.includes("확인하면 사라집니다"), meta.description);
  }
});

test("🔴 승인 완료·반려됨의 색은 기존 다섯 색과도, 서로도 갈라진다", () => {
  const hueOf = (tone: string) => tone.match(/^text-([a-z]+)-/)?.[1];
  const existing = ["amber", "sky", "red", "emerald", "violet"];
  const grantedHue = hueOf(NOTIFICATION_KIND_META.APPROVAL_GRANTED.toneClassName);
  const rejectedHue = hueOf(NOTIFICATION_KIND_META.APPROVAL_REJECTED.toneClassName);
  assert.ok(grantedHue && rejectedHue);
  assert.ok(!existing.includes(grantedHue), `승인 완료가 기존 색(${grantedHue})을 쓴다`);
  assert.ok(!existing.includes(rejectedHue), `반려됨이 기존 색(${rejectedHue})을 쓴다`);
  assert.notEqual(grantedHue, rejectedHue);
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

test("🔴 재고 부족의 기본값은 재고를 채우는 셋뿐이다 — 엔지니어·영업은 받지 않는다", () => {
  assert.deepEqual(
    ROLE_CODES.filter((role) => defaultRoleReceivesNotification("PART_STOCK_BELOW_MINIMUM", role)),
    ["SUPER_ADMIN", "ADMIN", "INVENTORY_MANAGER"]
  );
  assert.equal(defaultRoleReceivesNotification("PART_STOCK_BELOW_MINIMUM", "AS_ENGINEER"), false);
  assert.equal(defaultRoleReceivesNotification("PART_STOCK_BELOW_MINIMUM", "SALES"), false);
});

test("재고 부족의 판정 함수는 부품 요청의 것과 별개다 — 지금 답이 같을 뿐이다", () => {
  // 두 함수가 같은 셋을 내는 것은 지금의 사실이지 규칙이 아니다. 여기서 못 박는
  // 것은 재고 부족 쪽이 **자기 함수**로 답한다는 것이다 — 저쪽 명단이 바뀌어도
  // 이쪽이 따라 움직이면 안 된다.
  for (const role of ROLE_CODES) {
    assert.equal(
      defaultRoleReceivesNotification("PART_STOCK_BELOW_MINIMUM", role),
      canReceiveLowStockNotifications(role),
      role
    );
  }
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
      PART_STOCK_BELOW_MINIMUM: { SUPER_ADMIN: false },
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
