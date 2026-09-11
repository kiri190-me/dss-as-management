import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import {
  NOTIFICATION_ACKNOWLEDGEMENT_KEY_MAX_LENGTH,
  checkNotificationAcknowledgementKey,
} from "./notification-acknowledgement";
import {
  buildApprovalNotification,
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

test("🔴 이 저장소의 build 함수가 실제로 만드는 알림 id 는 전부 통과한다", () => {
  // 형식 규칙이 파생 쪽 id 보다 좁아지면, 다음 조각에서 확인 버튼을 눌러도
  // 조용히 거절되는 알림이 생긴다. 지금 있는 모든 종류의 실제 id 로 확인한다.
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

  for (const item of items) {
    const checked = checkNotificationAcknowledgementKey(item.id);
    assert.equal(checked.ok, true, `거절됐다: ${item.id}`);
    if (checked.ok) {
      assert.equal(checked.key, item.id, "키를 다듬거나 바꾸면 파생된 알림과 이어지지 않는다");
      assert.equal(checked.kind, item.kind, "종류 자리는 첫 `:` 앞이다");
    }
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

test("🔴 이 조각은 종류를 묻지 않는다 — 등록되지 않은 종류 이름도 형식만 맞으면 통과한다", () => {
  // 「확인할 수 있는 종류」 목록은 다음 조각에서 생긴다. 그때 이 시험을 그 목록에
  // 맞춰 바꾼다(형식은 맞지만 목록에 없는 종류 → 거절).
  const checked = checkNotificationAcknowledgementKey("SOME_FUTURE_KIND:abc-123_x");
  assert.equal(checked.ok, true);
  if (checked.ok) assert.equal(checked.kind, "SOME_FUTURE_KIND");
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
