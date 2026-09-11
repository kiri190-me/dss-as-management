import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import {
  ACKNOWLEDGEABLE_NOTIFICATION_KINDS,
  NOTIFICATION_ACKNOWLEDGEMENT_KEY_MAX_LENGTH,
  checkNotificationAcknowledgementKey,
  isAcknowledgeableNotificationKind,
} from "./notification-acknowledgement";
import {
  NOTIFICATION_KINDS,
  buildApprovalGrantedNotification,
  buildApprovalNotification,
  buildApprovalRejectedNotification,
  buildCustomerRepairRequestNotification,
  buildPartIssueApprovalNotification,
  buildPartStockBelowMinimumNotification,
  buildPendingPartRequestNotification,
  type NotificationItem,
} from "./notifications";

test("상한은 표의 CHECK 와 같은 200자다", () => {
  // 둘이 갈라지면 입구는 통과시키고 DB 가 23514 로 거절한다(또는 그 반대).
  assert.equal(NOTIFICATION_ACKNOWLEDGEMENT_KEY_MAX_LENGTH, 200);
});

test("🔴 눌러서 확인하는 종류는 결재 결과 둘뿐이고, 둘 다 등록된 종류다", () => {
  // 여기에 할 일 알림이 끼면 처리하지 않은 일을 「확인」으로 숨길 수 있게 된다.
  assert.deepEqual([...ACKNOWLEDGEABLE_NOTIFICATION_KINDS], ["APPROVAL_GRANTED", "APPROVAL_REJECTED"]);
  for (const kind of ACKNOWLEDGEABLE_NOTIFICATION_KINDS) {
    assert.ok((NOTIFICATION_KINDS as readonly string[]).includes(kind), `${kind} 는 등록된 종류가 아니다`);
  }
  for (const kind of NOTIFICATION_KINDS) {
    assert.equal(
      isAcknowledgeableNotificationKind(kind),
      kind === "APPROVAL_GRANTED" || kind === "APPROVAL_REJECTED",
      kind
    );
  }
  assert.equal(isAcknowledgeableNotificationKind(""), false);
  assert.equal(isAcknowledgeableNotificationKind("approval_granted"), false, "대소문자를 다듬지 않는다");
});

test("🔴 결재 결과 build 함수가 실제로 만드는 알림 id 는 전부 통과한다", () => {
  // 형식 규칙이 파생 쪽 id 보다 좁아지면, 확인 버튼을 눌러도 조용히 거절되는 알림이
  // 생긴다. 눌러서 확인하는 종류의 모든 갈래(두 표 × 승인·반려)의 실제 id 로 확인한다.
  const items: NotificationItem[] = [
    buildApprovalGrantedNotification({
      source: "REPAIR_CASE",
      approvalId: randomUUID(),
      repairCaseId: randomUUID(),
      intakeNumber: "D9705-012",
      approvalType: "FINAL_SHIPMENT",
      decidedByName: "김결재",
    }),
    buildApprovalGrantedNotification({
      source: "PART_ISSUE",
      approvalId: randomUUID(),
      partRequestId: null,
      intakeNumber: null,
      destinationNote: "사용처",
      decidedByName: "김결재",
    }),
    buildApprovalRejectedNotification({
      source: "REPAIR_CASE",
      approvalId: randomUUID(),
      repairCaseId: randomUUID(),
      intakeNumber: "D9705-012",
      approvalType: "REPAIR_INSPECTION",
      decisionReason: "사진 누락",
    }),
    buildApprovalRejectedNotification({
      source: "PART_ISSUE",
      approvalId: randomUUID(),
      partRequestId: randomUUID(),
      intakeNumber: "D9705-013",
      destinationNote: null,
      decisionReason: "수량 과다",
    }),
  ];

  for (const item of items) {
    const checked = checkNotificationAcknowledgementKey(item.id);
    assert.equal(checked.ok, true, `거절됐다: ${item.id}`);
    if (checked.ok) {
      assert.equal(checked.key, item.id, "키를 다듬거나 바꾸면 파생된 알림과 이어지지 않는다");
      assert.equal(checked.kind, item.kind, "종류 자리는 첫 `:` 앞이다");
    }
  }
});

test("🔴 할 일 알림의 실제 id 는 형식이 맞아도 거절한다 — 처리하지 않은 일을 「확인」으로 숨기지 못한다", () => {
  // 이 조각 전에는 이 id 들이 전부 통과했다(형식만 봤다). 이제는 종류가 걸린다.
  const repairCaseId = randomUUID();
  const items: NotificationItem[] = [
    buildApprovalNotification({
      repairCaseId,
      intakeNumber: "D9705-012",
      approvalType: "FINAL_SHIPMENT",
    }),
    buildPendingPartRequestNotification({
      requestId: randomUUID(),
      intakeNumber: null,
      requestedByName: "홍길동",
    }),
    buildPartStockBelowMinimumNotification({
      partId: randomUUID(),
      partName: "필터",
      owner: "DSS",
      currentQuantity: 1,
      minimumQuantity: 3,
    }),
    buildCustomerRepairRequestNotification({
      requestId: randomUUID(),
      customerName: "고객사",
      productModelName: "모델",
      serialNumber: "SN-1",
    }),
    buildPartIssueApprovalNotification({
      issueRequestId: randomUUID(),
      intakeNumber: null,
      destinationNote: "사용처",
      routeStepOrder: 2,
      requestedByName: "홍길동",
    }),
  ];

  // 지금 등록된 할 일 종류가 전부 여기 있어야 한다 — 빠진 종류가 생기면 그 종류의
  // 거절은 아무도 보지 않는다.
  assert.deepEqual(
    new Set(items.map((item) => item.kind)),
    new Set(NOTIFICATION_KINDS.filter((kind) => !isAcknowledgeableNotificationKind(kind))),
    "할 일 종류 하나가 이 시험에서 빠졌다"
  );

  for (const item of items) {
    const checked = checkNotificationAcknowledgementKey(item.id);
    assert.equal(checked.ok, false, `통과했다: ${item.id}`);
    if (!checked.ok) assert.ok(checked.message.length > 0, `${item.kind}: 사람에게 줄 말이 없다`);
  }
});

test("앞으로 생길 모양(`종류:uuid`, 여러 `:`)도 통과하고 종류 자리를 떼어 준다", () => {
  const id = randomUUID();
  const checked = checkNotificationAcknowledgementKey(`APPROVAL_GRANTED:${id}:FINAL_SHIPMENT`);
  assert.equal(checked.ok, true);
  if (checked.ok) {
    assert.equal(checked.kind, "APPROVAL_GRANTED");
    assert.equal(checked.key, `APPROVAL_GRANTED:${id}:FINAL_SHIPMENT`);
  }
});

test("🔴 형식은 맞지만 눌러서 확인하는 종류가 아니면 거절한다 — 등록되지 않은 종류 이름도", () => {
  // 앞 조각(5a)에서는 형식만 봐서 이 키가 통과했다. 그 시험의 주석대로 「확인할 수
  // 있는 종류」 목록이 생긴 지금 거절로 바꾼다.
  for (const raw of ["SOME_FUTURE_KIND:abc-123_x", "REPAIR_CASE_APPROVAL:abc", "APPROVAL_GRANTEDX:abc"]) {
    const checked = checkNotificationAcknowledgementKey(raw);
    assert.equal(checked.ok, false, `통과했다: ${raw}`);
    if (!checked.ok) assert.ok(checked.message.length > 0);
  }
});

test("200자까지는 통과하고 201자부터 거절한다", () => {
  const prefix = "APPROVAL_GRANTED:";
  const exact = prefix + "a".repeat(NOTIFICATION_ACKNOWLEDGEMENT_KEY_MAX_LENGTH - prefix.length);
  assert.equal(exact.length, 200);
  assert.equal(checkNotificationAcknowledgementKey(exact).ok, true);
  assert.equal(checkNotificationAcknowledgementKey(`${exact}a`).ok, false);
});

test("문자열이 아닌 입력은 거절한다 — 서버 액션 인자는 무엇이든 올 수 있다", () => {
  for (const raw of [undefined, null, 42, true, {}, [], ["APPROVAL_GRANTED:x"]]) {
    const checked = checkNotificationAcknowledgementKey(raw);
    assert.equal(checked.ok, false, `통과했다: ${JSON.stringify(raw)}`);
  }
});

test("형식이 틀린 키는 거절한다", () => {
  const cases: { label: string; raw: string }[] = [
    { label: "빈 문자열", raw: "" },
    { label: "`:` 가 없다", raw: "APPROVAL_GRANTED" },
    { label: "나머지가 비었다", raw: "APPROVAL_GRANTED:" },
    { label: "종류가 비었다", raw: ":abc" },
    { label: "종류가 소문자", raw: "approval_granted:abc" },
    { label: "종류가 숫자로 시작", raw: "1APPROVAL:abc" },
    { label: "종류에 하이픈", raw: "APPROVAL-GRANTED:abc" },
    { label: "앞 공백", raw: " APPROVAL_GRANTED:abc" },
    { label: "뒤 공백", raw: "APPROVAL_GRANTED:abc " },
    { label: "가운데 공백", raw: "APPROVAL_GRANTED:ab c" },
    { label: "줄바꿈", raw: `APPROVAL_GRANTED:abc${String.fromCharCode(10)}` },
    { label: "한글", raw: "APPROVAL_GRANTED:승인" },
    { label: "퍼센트(LIKE 와일드카드)", raw: "APPROVAL_GRANTED:%" },
    { label: "역슬래시", raw: "APPROVAL_GRANTED:a\\b" },
    { label: "따옴표", raw: "APPROVAL_GRANTED:a'b" },
    { label: "슬래시", raw: "APPROVAL_GRANTED:a/b" },
  ];
  for (const { label, raw } of cases) {
    const checked = checkNotificationAcknowledgementKey(raw);
    assert.equal(checked.ok, false, `${label}: 통과했다`);
    if (!checked.ok) assert.ok(checked.message.length > 0, `${label}: 사람에게 줄 말이 없다`);
  }
});
