import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { toNotificationBellItems } from "./notification-bell-items";
import { NOTIFICATION_KIND_META } from "./notification-settings";
import {
  NOTIFICATION_KINDS,
  countNotificationTargets,
  buildApprovalGrantedNotification,
  buildApprovalNotification,
  buildApprovalRejectedNotification,
  buildCustomerRepairRequestNotification,
  buildPartIssueApprovalNotification,
  buildPartStockBelowMinimumNotification,
  buildPendingPartRequestNotification,
  buildQuoteApprovalNotification,
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
    buildPendingPartRequestNotification({
      requestId: "req-1",
      intakeNumber: "D9705-100",
      requestedByName: "홍길동",
    }),
    buildPartStockBelowMinimumNotification({
      partId: "part-1",
      partName: "커넥터 SMA",
      owner: "DSS",
      currentQuantity: 15,
      minimumQuantity: 30,
    }),
    buildCustomerRepairRequestNotification({
      requestId: "req-c1",
      customerName: "주성 엔지니어링",
      productModelName: "MBK200-JS3",
      serialNumber: "1708075",
    }),
    buildPartIssueApprovalNotification({
      issueRequestId: "issue-1",
      intakeNumber: "D9705-200",
      destinationNote: null,
      routeStepOrder: 2,
      requestedByName: "홍길동",
    }),
    buildQuoteApprovalNotification({
      quoteId: "quote-1",
      quoteNumber: "Q-9705-001",
      routeStepOrder: 1,
      requestedByName: "박영업",
    }),
    buildApprovalGrantedNotification({
      source: "REPAIR_CASE",
      approvalId: "approval-g1",
      repairCaseId: "case-9",
      intakeNumber: "D9705-300",
      approvalType: "FINAL_SHIPMENT",
      decidedByName: "김결재",
    }),
    buildApprovalRejectedNotification({
      source: "PART_ISSUE",
      approvalId: "approval-r1",
      partRequestId: null,
      intakeNumber: null,
      destinationNote: "상해수리소",
      decisionReason: "수량 과다",
    }),
  ];
}

test("한 줄을 아홉 칸으로 옮긴다 — 값도 칸 이름도 묶음이 기다리는 그대로다", () => {
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
    assert.equal(row.key, item.id, `${item.kind}: 열쇠가 알림 id 가 아니다`);
    assert.equal(row.id, item.id, `${item.kind}: 확인 기록의 키가 알림 id 가 아니다`);
    assert.equal(row.kind, item.kind);
    assert.equal(
      row.kindLabel,
      NOTIFICATION_KIND_META[item.kind].label,
      `${item.kind}: 사람이 읽는 이름이 도메인 표와 다르다`
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

test("🔴 칸은 아홉 개다 — targetKey 를 실어 보내지 않는다", () => {
  // 실어 보내면 묶음이 그것으로 개수를 다시 셀 길이 열린다. 세는 규칙은 A/S
  // 안쪽 것이고(같은 대상은 한 번만), 두 곳이 세면 종과 배지가 다른 숫자를
  // 말하게 된다 — 개수는 옮겨 담기 **전** 원본에서 세어 따로 넘긴다(아래).
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

test("🔴 종류별 색(Tailwind 클래스)은 넘기지 않는다 — 묶음이 제 색을 고른다", () => {
  // 그대로 옮겨 오면 색이 **조용히 사라진다**: Tailwind v4 는 node_modules 를
  // 훑지 않아 묶음에서 건너간 클래스에는 규칙 자체가 없고, 오류도 나지 않는다.
  const tones = NOTIFICATION_KINDS.map((kind) => NOTIFICATION_KIND_META[kind].toneClassName);
  const rendered = JSON.stringify(toNotificationBellItems(oneOfEachKind()));
  for (const tone of tones) {
    assert.equal(rendered.includes(tone), false, `${tone} 이 묶음으로 건너간다`);
  }
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
