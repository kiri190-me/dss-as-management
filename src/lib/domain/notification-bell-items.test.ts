import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { notificationBellKey, toNotificationBellItems } from "./notification-bell-items";
import { NOTIFICATION_KIND_META } from "./notification-settings";
import {
  NOTIFICATION_KINDS,
  countNotificationTargets,
  buildApprovalGrantedNotification,
  buildApprovalNotification,
  buildApprovalRejectedNotification,
  buildQuoteApprovalNotification,
  buildRepairCaseDueDateNearNotification,
  type NotificationItem,
} from "./notifications";

/**
 * 머리말의 종이 @dss/ui 의 것으로 바뀌면서, A/S 의 NotificationItem 을 그 종이
 * 받는 모양으로 옮겨 담는 자리가 하나 생겼다. 화면이 아니라 여기서 시험한다 —
 * 순수 함수라 브라우저도 서버도 필요 없다.
 */

/**
 * 종류마다 한 줄씩. 종류를 늘리면 여기에도 한 줄을 더해야 하고, 빠뜨리면 아래
 * 「모든 종류를 옮긴다」가 곧바로 잡는다.
 */
function oneOfEachKind(): NotificationItem[] {
  return [
    buildApprovalNotification({
      repairCaseId: "case-1",
      intakeNumber: "D9705-012",
      approvalType: "REPAIR_INSPECTION",
    }),
    buildQuoteApprovalNotification({
      quoteId: "quote-1",
      quoteNumber: "Q-9705-001",
      routeStepOrder: 1,
      requestedByName: "박영업",
    }),
    buildRepairCaseDueDateNearNotification({
      repairCaseId: "case-due-1",
      intakeNumber: "D9705-400",
      dueDate: "2026-10-22",
      borrowed: true,
    }),
    buildApprovalGrantedNotification({
      source: "REPAIR_CASE",
      approvalId: "approval-g1",
      repairCaseId: "case-9",
      intakeNumber: "D9705-300",
      approvalType: "FINAL_SHIPMENT",
      decidedByName: "김결재",
    }),
    // 🔴 반려는 **승인 완료와 다른 표**를 표본으로 둔다 — 한 표만 쓰면 「두 갈래가
    // 각각 옮겨지는가」를 못 잰다. 2026-10-27 까지는 부품 불출이었고, 그 갈래를
    // 들어내면서(13-C4) 남은 둘 중 접수 건이 아닌 쪽인 견적서로 바꿨다.
    buildApprovalRejectedNotification({
      source: "QUOTE",
      approvalId: "approval-r1",
      quoteId: "quote-9",
      quoteNumber: "Q-9705-009",
      decisionReason: "금액 근거 보완 요망",
    }),
  ];
}

test("한 줄을 열 칸으로 옮긴다 — 값도 칸 이름도 묶음이 기다리는 그대로다", () => {
  const item = buildApprovalNotification({
    repairCaseId: "case-1",
    intakeNumber: "D9705-012",
    approvalType: "REPAIR_INSPECTION",
  });

  assert.deepEqual(toNotificationBellItems([item]), [
    {
      key: item.id,
      sourceId: "",
      sourceName: "",
      id: item.id,
      kind: item.kind,
      kindLabel: NOTIFICATION_KIND_META[item.kind].label,
      tone: NOTIFICATION_KIND_META[item.kind].toneIndex,
      subject: item.subject,
      detail: item.detail,
      href: item.href,
    },
  ]);
});

test("🔴 모든 종류를 옮긴다 — 종류가 늘어도 이 파일은 고치지 않는다", () => {
  const source = oneOfEachKind();
  // 대조 — 위 목록이 실제로 지금 있는 종류를 다 지난다. 빠진 종류가 있으면
  // 아래 단언이 「본 적 없는 종류」를 지나치게 된다.
  assert.deepEqual(
    [...new Set(source.map((item) => item.kind))].sort(),
    [...NOTIFICATION_KINDS].sort()
  );

  const mapped = toNotificationBellItems(source);
  assert.equal(mapped.length, source.length, "줄이 사라지거나 늘었다");

  for (const [index, item] of source.entries()) {
    const row = mapped[index];
    // 접두사를 안 넘겼으니 예전 모양이다 — 접두사가 붙은 모습은 아래 「열쇠의
    // 접두사」 묶음이 따로 본다.
    assert.equal(row.key, item.id, `${item.kind}: 접두사 없이 불렀는데 열쇠가 알림 id 가 아니다`);
    assert.equal(row.id, item.id, `${item.kind}: 확인 기록의 키가 알림 id 가 아니다`);
    assert.equal(row.kind, item.kind);
    assert.equal(
      row.kindLabel,
      NOTIFICATION_KIND_META[item.kind].label,
      `${item.kind}: 사람이 읽는 이름이 도메인 표와 다르다`
    );
    assert.equal(
      row.tone,
      NOTIFICATION_KIND_META[item.kind].toneIndex,
      `${item.kind}: 색 칸 번호가 도메인 표와 다르다 — 묶음이 해시로 아무 칸이나 집는다`
    );
    assert.equal(row.subject, item.subject);
    assert.equal(row.detail, item.detail);
    assert.equal(row.href, item.href);
  }
});

test("받은 차례 그대로 옮긴다 — 여기서 섞지 않는다", () => {
  const source = oneOfEachKind();
  assert.deepEqual(
    toNotificationBellItems(source).map((row) => row.id),
    source.map((item) => item.id)
  );
});

test("빈 목록은 빈 목록이다", () => {
  assert.deepEqual(toNotificationBellItems([]), []);
});

test("🔴 없는 값은 `undefined` 가 아니라 **빈 문자열**이다 — 묶음이 그래야 안 그린다", () => {
  // 여기가 A/S 다. 시스템 이름을 적으면 제 사이트 안에서 「A/S 관리」가 줄마다
  // 한 번씩 더 적힌다. 빈 문자열이면 묶음이 그 칸을 아예 안 그린다 —
  // `undefined` 로 두면 타입부터 어긋나고, 그리는 쪽이 빈 자리를 남긴다.
  for (const row of toNotificationBellItems(oneOfEachKind())) {
    assert.equal(row.sourceId, "");
    assert.equal(row.sourceName, "");
    assert.equal(typeof row.sourceId, "string");
    assert.equal(typeof row.sourceName, "string");
  }
});

test("🔴 칸은 열 개다 — targetKey 를 실어 보내지 않는다", () => {
  // 실어 보내면 묶음이 그것으로 개수를 다시 셀 길이 열린다. 세는 규칙은 A/S
  // 안쪽 것이고(같은 대상은 한 번만), 두 곳이 세면 종과 배지가 다른 숫자를
  // 말하게 된다 — 개수는 옮겨 담기 **전** 원본에서 세어 따로 넘긴다(아래).
  //
  // 🔴 2026-10-19 에 `tone`(색 칸 번호) 하나가 늘어 아홉에서 열이 됐다. 늘어난
  //    것이 **그 하나뿐**이라는 것이 이 목록의 뜻이다 — 묶음 타입에 없는 칸이
  //    섞이면 받는 쪽이 조용히 버리고, targetKey 같은 것이 섞이면 위의 사고가
  //    열린다.
  for (const row of toNotificationBellItems(oneOfEachKind())) {
    assert.deepEqual(Object.keys(row).sort(), [
      "detail",
      "href",
      "id",
      "key",
      "kind",
      "kindLabel",
      "sourceId",
      "sourceName",
      "subject",
      "tone",
    ]);
    assert.equal("targetKey" in row, false, "묶음 타입에 없는 칸을 실어 보낸다");
  }
});

test("🔴 옮겨 담은 뒤로는 「같은 대상은 한 번만」을 셀 수 없다 — 개수는 원본에서 센다", () => {
  // 한 건에 결재가 둘 걸리면 사람에게는 「그 한 건」이다. 그 정보(targetKey)는
  // 묶음으로 건너가지 않으므로, 배지 숫자는 반드시 이쪽에서 세어 넘겨야 한다.
  const items = [
    buildApprovalNotification({
      repairCaseId: "case-1",
      intakeNumber: "D9705-012",
      approvalType: "REPAIR_INSPECTION",
    }),
    buildApprovalNotification({
      repairCaseId: "case-1",
      intakeNumber: "D9705-012",
      approvalType: "FINAL_SHIPMENT",
    }),
  ];

  const mapped = toNotificationBellItems(items);
  assert.equal(mapped.length, 2, "줄은 둘 그대로 그린다");
  assert.equal(
    countNotificationTargets(items.map((item) => item.targetKey)),
    1,
    "원본에서 세면 1이다 — 이 값이 배지로 간다"
  );
});

test("🔴 종류별 색은 **클래스 이름이 아니라 칸 번호**로 넘어간다", () => {
  // 클래스 이름을 그대로 옮기면 색이 **조용히 사라진다**: Tailwind v4 는
  // node_modules 를 훑지 않아 묶음에서 건너간 클래스에는 규칙 자체가 없고,
  // 오류도 나지 않는다. 그래서 그 글자는 한 조각도 건너가면 안 된다.
  //
  // 🔴 2026-10-19 부터 색을 아예 안 넘기는 것은 아니다 — **숫자 하나**를 넘긴다.
  //    묶음의 CSS 가 제 변수로 그 칸을 칠하므로 Tailwind 와 상관이 없다. 이
  //    시험의 뜻은 「색을 안 보낸다」가 아니라 **「Tailwind 클래스를 안 보낸다」**다.
  const rendered = JSON.stringify(toNotificationBellItems(oneOfEachKind()));

  for (const kind of NOTIFICATION_KINDS) {
    const { toneClassName, toneIndex } = NOTIFICATION_KIND_META[kind];
    assert.equal(rendered.includes(toneClassName), false, `${toneClassName} 이 묶음으로 건너간다`);
    // 클래스 한 조각(색 이름 + 진하기)만 건너가도 같은 사고다.
    for (const piece of toneClassName.split(" ")) {
      assert.equal(rendered.includes(piece), false, `${piece} 이 묶음으로 건너간다`);
    }
    // 그 자리에 실제로 가는 것 — 칸 번호다.
    assert.equal(typeof toneIndex, "number", `${kind}: 칸 번호가 숫자가 아니다`);
  }
});

// ───────────────────────── 열쇠의 접두사 (2026-10-20)

/** 포털에 등록된 이 시스템의 식별자. 열쇠의 접두사가 되는 값이다. */
const CLIENT_ID = "rf-service-system";

test("🔴 제 줄의 열쇠는 `{client_id}:` 로 시작한다 — 어긋나면 포털이 조용히 버린다", () => {
  // 포털은 모르는 시스템의 열쇠를 **조용히 버린다**(규격서). 그래서 접두사가
  // 어긋나면 오류 없이 「지워지지 않는 알림」만 남는다. 같은 알림이 A/S 에서는
  // `{id}`, 계측기에서는 `rf-service-system:{id}` 이던 것이 이 조각에서 맞춰졌다.
  const source = oneOfEachKind();
  for (const [index, row] of toNotificationBellItems(source, CLIENT_ID).entries()) {
    const item = source[index];
    assert.equal(row.key, `${CLIENT_ID}:${item.id}`, `${item.kind}: 접두사가 안 붙었다`);
    // 🔴 여기가 이 조각에서 가장 위험한 자리다. id 가 함께 바뀌면 운영 DB 에
    //    쌓인 확인 기록과 모양이 달라져 **이미 확인한 알림이 전부 다시 뜬다.**
    assert.equal(row.id, item.id, `${item.kind}: id 가 함께 바뀌었다 — 확인 기록이 깨진다`);
    assert.notEqual(row.key, row.id, `${item.kind}: 둘이 같으면 이 시험이 아무것도 못 본다`);
  }
});

test("🔴 접두사를 못 읽으면 **예전 모양**으로 물러선다 — 종은 그대로 그려진다", () => {
  // 설정(SSO_CLIENT_ID)을 못 읽었을 때의 모습이다(config/sso.ts 의
  // getSsoClientIdOrEmpty). 잃는 것은 제 줄 지움이 포털과 안 통하는 것 하나뿐이고,
  // 🔴 물러서는 모습이 「알림 없음」이 아니라 **「접두사 없음」**이다.
  const source = oneOfEachKind();
  for (const fallback of [undefined, ""]) {
    const rows = toNotificationBellItems(source, fallback);
    assert.equal(rows.length, source.length, `${String(fallback)}: 줄이 사라졌다`);
    for (const [index, row] of rows.entries()) {
      assert.equal(row.key, source[index].id, `${String(fallback)} 에서 물러서지 않았다`);
      assert.equal(row.id, source[index].id);
    }
  }
});

test("🔴 열쇠를 짓는 자리는 하나다 — 거르는 쪽도 이 함수를 쓴다", () => {
  // 두 곳에서 따로 조립하면 갈라졌을 때 오류 없이 「지워지지 않는 알림」만
  // 남는다. 그래서 만드는 쪽(아래 첫 단언)과 거르는 쪽(화면의
  // selectVisibleNotifications)이 같은 함수를 부른다.
  assert.equal(notificationBellKey("APPROVAL:7", CLIENT_ID), "rf-service-system:APPROVAL:7");
  assert.equal(notificationBellKey("APPROVAL:7", ""), "APPROVAL:7");

  const [item] = oneOfEachKind();
  const [row] = toNotificationBellItems([item], CLIENT_ID);
  assert.equal(row.key, notificationBellKey(item.id, CLIENT_ID));
});

test("🔴 이 파일은 순수 계산이다 — server-only · 화면의 물건을 물지 않는다", () => {
  // 하나라도 물면 이 시험(npm test)부터 죽고, 옮겨 담기를 화면에서만 검사하게
  // 된다. 주석에는 그 이름들이 적혀 있으므로 **가져오는 것**과 **쓰는 것**을
  // 각각 본다.
  const source = readFileSync(new URL("./notification-bell-items.ts", import.meta.url), "utf8");

  const imported = [...source.matchAll(/from\s+"([^"]+)"/g)].map((match) => match[1]).sort();
  assert.deepEqual(
    imported,
    ["./notification-settings", "./notifications", "@dss/ui"],
    "가져오는 것이 늘었다 — 순수 계산 밖의 것이 섞이지 않았는지 보라"
  );

  const bare = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");
  for (const forbidden of ["server-only", "window", "navigator", "document", "localStorage"]) {
    assert.equal(bare.includes(forbidden), false, `${forbidden} 을 쓰고 있다`);
  }
});
