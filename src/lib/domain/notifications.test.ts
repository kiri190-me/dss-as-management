import { test } from "node:test";
import assert from "node:assert/strict";
import {
  DELETED_REPAIR_CASE_SUBJECT,
  NOTIFICATION_KINDS,
  buildApprovalNotification,
  buildPartStockBelowMinimumNotification,
  buildPendingPartRequestNotification,
  countNotificationTargets,
  countNotificationTargetsByKind,
  type NotificationItem,
} from "./notifications";
import { inventoryPartRequestStatusLabels, stockOwnerLabels } from "./inventory-types";
import { LABELS as APPROVAL_TYPE_LABELS } from "./local/workflow/shipment-approval-checklist";
import { repairCaseDetailHrefs } from "./repair-case-detail-tabs";

test("결재 알림은 인수번호와 승인 종류 라벨을 내고, 검수/승인 화면으로 바로 링크한다", () => {
  const item = buildApprovalNotification({
    repairCaseId: "case-1",
    intakeNumber: "D9705-012",
    approvalType: "REPAIR_INSPECTION",
  });

  assert.equal(item.kind, "REPAIR_CASE_APPROVAL");
  assert.equal(item.subject, "D9705-012");
  assert.equal(item.detail, "수리 검수 승인");
  // 상세 첫 화면(`/repair-cases/case-1`)이 아니다 — 거기 내려놓으면 결재하려는
  // 사람이 "검수/승인" 탭을 한 번 더 눌러야 한다.
  assert.equal(item.href, "/repair-cases/case-1/approval");
  assert.equal(item.href, repairCaseDetailHrefs("case-1").approval, "주소는 탭 헬퍼와 같은 것을 써야 한다");
});

test("라벨은 새로 쓰지 않고 승인 체크리스트가 쓰는 것과 같은 문자열이어야 한다", () => {
  // 이 단정이 존재하는 이유: 문자열을 복사해 두면 상세 화면의 승인 카드와 종
  // 알림이 같은 결재를 서로 다른 이름으로 부르게 된다. 한쪽만 고쳐지는 순간
  // 여기서 깨져야 한다.
  for (const approvalType of ["REPAIR_INSPECTION", "FINAL_SHIPMENT"] as const) {
    const item = buildApprovalNotification({
      repairCaseId: "case-1",
      intakeNumber: "D9705-012",
      approvalType,
    });
    assert.equal(item.detail, APPROVAL_TYPE_LABELS[approvalType]);
  }
});

test("같은 접수 건에 두 종류가 걸리면 알림은 두 줄이지만 id는 서로 다르다", () => {
  const inspection = buildApprovalNotification({
    repairCaseId: "case-1",
    intakeNumber: "D9705-012",
    approvalType: "REPAIR_INSPECTION",
  });
  const shipment = buildApprovalNotification({
    repairCaseId: "case-1",
    intakeNumber: "D9705-012",
    approvalType: "FINAL_SHIPMENT",
  });

  assert.notEqual(inspection.id, shipment.id, "React key가 겹치면 한 줄이 사라진다");
  assert.equal(inspection.targetKey, shipment.targetKey, "세는 단위는 접수 건 하나여야 한다");
});

test("개수는 대상 단위로 센다 — 한 건에 두 종류가 걸려도 1이다", () => {
  // 사이드바 배지(countRepairCasesPendingMyApproval)와 종 배지가 이 함수를
  // 함께 쓴다. 규칙이 바뀌면 두 숫자가 함께 바뀌어야 한다.
  assert.equal(countNotificationTargets([]), 0);
  assert.equal(countNotificationTargets(["case-1"]), 1);
  assert.equal(countNotificationTargets(["case-1", "case-1"]), 1);
  assert.equal(countNotificationTargets(["case-1", "case-2", "case-1"]), 2);
});

function approvalItem(repairCaseId: string, approvalType: "REPAIR_INSPECTION" | "FINAL_SHIPMENT"): NotificationItem {
  return buildApprovalNotification({ repairCaseId, intakeNumber: `IN-${repairCaseId}`, approvalType });
}

test("종류별 개수도 대상 단위로 세고, 알림이 없는 종류는 0으로 나온다", () => {
  const counts = countNotificationTargetsByKind([
    approvalItem("case-1", "REPAIR_INSPECTION"),
    approvalItem("case-1", "FINAL_SHIPMENT"),
    approvalItem("case-2", "REPAIR_INSPECTION"),
  ]);
  assert.equal(counts.REPAIR_CASE_APPROVAL, 2);

  const empty = countNotificationTargetsByKind([]);
  assert.equal(empty.REPAIR_CASE_APPROVAL, 0);
});

test("등록된 모든 종류가 개수 표에 키로 들어 있다", () => {
  // 종류를 추가하면서 이 표에 넣는 것을 잊으면, 그 종류만 가리키는 배지가
  // undefined를 읽게 된다.
  const counts = countNotificationTargetsByKind([]);
  for (const kind of NOTIFICATION_KINDS) {
    assert.equal(typeof counts[kind], "number", `${kind}가 개수 표에 없다`);
  }
});

test("등록된 알림 종류는 결재 요청·부품 요청 대기·재고 부족·새 수리 의뢰 넷이다", () => {
  // 종류를 늘리는 것은 "누구에게 보여도 되는가"를 다시 판정해야 하는 일이라
  // 별도 작업으로 다룬다. 늘어난 것을 여기서 알아차리게 둔다 — 그래서 목록
  // 전체를 그대로 못 박는다(있는지만 보는 검사로 무르게 만들지 않는다).
  //
  // PART_REQUEST_PENDING은 그 판정을 세운 뒤 등록했다:
  // auth/inventory-authorization.ts의 canReceivePartRequestNotifications
  // (재고관리자·관리자·최고관리자).
  //
  // PART_STOCK_BELOW_MINIMUM도 마찬가지다:
  // domain/notification-settings.ts의 canReceiveLowStockNotifications
  // (같은 셋이지만 "재고를 채울 사람"이라는 다른 질문이라 따로 세웠다 —
  // 그 파일 머리말 참조).
  //
  // CUSTOMER_REPAIR_REQUEST_NEW도 판정을 세운 뒤 등록했다:
  // auth/customer-portal-authorization.ts의
  // canReceiveCustomerRepairRequestNotifications(최고관리자·관리자·A/S
  // 엔지니어·영업). 앞의 둘과 달리 명단이 넓은 이유는, 이 알림이 "고객이
  // 기다리고 있다"는 신호라 접수를 만들 수 있는 쪽이 모두 봐야 하기
  // 때문이다 — 재고관리자만 빠진다(접수를 만들지 않는다).
  assert.deepEqual(
    [...NOTIFICATION_KINDS],
    [
      "REPAIR_CASE_APPROVAL",
      "PART_REQUEST_PENDING",
      "PART_STOCK_BELOW_MINIMUM",
      "CUSTOMER_REPAIR_REQUEST_NEW",
    ]
  );
});

// ────────────────────────────────────── 처리 대기 중인 부품 요청 알림

test("부품 요청 알림은 인수번호와 상태 라벨·요청자를 내고, 부품 요청 관리 화면으로 링크한다", () => {
  const item = buildPendingPartRequestNotification({
    requestId: "req-1",
    intakeNumber: "D9705-012",
    requestedByName: "김엔지니어",
  });

  assert.equal(item.kind, "PART_REQUEST_PENDING");
  assert.equal(item.subject, "D9705-012");
  assert.equal(item.detail, "요청 대기 · 김엔지니어");
  // 요청에는 자기만의 상세 화면이 없다 — 실제로 불출/거절/보류를 누르는 자리가
  // 이 목록이다.
  assert.equal(item.href, "/inventory/requests");
  // 요청 하나가 사람에게도 한 건이다. 부품이 여러 개 들어 있어도 배지에 여러
  // 건으로 세면 안 된다.
  assert.equal(item.targetKey, "req-1");
});

test("부품 요청 알림의 라벨은 새로 쓴 것이 아니라 상태 라벨 표의 그 문자열이어야 한다", () => {
  // 결재 알림에 걸어 둔 것과 같은 단정이다 — 복사해 두면 부품 요청 관리
  // 목록과 종 알림이 같은 상태를 서로 다른 이름으로 부르게 되고, 한쪽만
  // 고쳐지는 순간 여기서 깨져야 한다.
  const item = buildPendingPartRequestNotification({
    requestId: "req-1",
    intakeNumber: "D9705-012",
    requestedByName: "김엔지니어",
  });
  assert.ok(
    item.detail.startsWith(inventoryPartRequestStatusLabels.PENDING),
    `detail이 상태 라벨로 시작해야 한다: ${item.detail}`
  );
});

test("접수 건이 영구 삭제된 요청도 알림에서 사라지지 않고 '삭제된 접수 건'으로 나온다", () => {
  // repair_case_id는 NULL이 될 수 있다(ON DELETE SET NULL). 굵은 글씨 자리가
  // 통째로 비면 무엇에 대한 알림인지 알 수 없다.
  const item = buildPendingPartRequestNotification({
    requestId: "req-2",
    intakeNumber: null,
    requestedByName: "김엔지니어",
  });
  assert.equal(item.subject, DELETED_REPAIR_CASE_SUBJECT);
  assert.equal(item.subject, "삭제된 접수 건", "부품 요청 관리 목록이 쓰는 문구와 같아야 한다");
  assert.equal(item.href, "/inventory/requests", "접수 건이 없어도 갈 곳은 그대로다");
});

test("요청이 여러 건이면 id가 서로 달라 한 줄도 사라지지 않는다", () => {
  const first = buildPendingPartRequestNotification({ requestId: "req-1", intakeNumber: "D9705-012", requestedByName: "김엔지니어" });
  const second = buildPendingPartRequestNotification({ requestId: "req-2", intakeNumber: "D9705-012", requestedByName: "김엔지니어" });

  // 같은 접수 건에 요청을 두 번 올릴 수 있다 — 인수번호가 같아도 React key가
  // 겹치면 안 되고, 세는 단위도 요청별로 둘이어야 한다.
  assert.notEqual(first.id, second.id);
  assert.equal(countNotificationTargetsByKind([first, second]).PART_REQUEST_PENDING, 2);
});

test("결재 배지는 부품 요청을 세지 않는다 — 종류별로 갈라 센다", () => {
  // 사이드바 배지는 countNotificationTargetsByKind(...).REPAIR_CASE_APPROVAL
  // 하나만 읽는다((app)/layout.tsx). 종류가 늘어난 지금 그 숫자가 조용히
  // 부품 요청까지 세기 시작하면 "결재 배지"가 거짓말을 하게 된다.
  const counts = countNotificationTargetsByKind([
    approvalItem("case-1", "REPAIR_INSPECTION"),
    approvalItem("case-2", "FINAL_SHIPMENT"),
    buildPendingPartRequestNotification({ requestId: "req-1", intakeNumber: "D9705-012", requestedByName: "김엔지니어" }),
    buildPendingPartRequestNotification({ requestId: "req-2", intakeNumber: null, requestedByName: "김엔지니어" }),
    buildPendingPartRequestNotification({ requestId: "req-3", intakeNumber: "D9705-013", requestedByName: "박엔지니어" }),
  ]);

  assert.equal(counts.REPAIR_CASE_APPROVAL, 2, "결재 배지는 결재 2건만 센다");
  assert.equal(counts.PART_REQUEST_PENDING, 3);

  // 종 배지는 반대로 전부 센다 — 두 숫자가 서로 다른 것이 정상이다.
  assert.equal(
    countNotificationTargets([
      "case-1",
      "case-2",
      "req-1",
      "req-2",
      "req-3",
    ]),
    5
  );
});

// ────────────────────────────────────────────── 한계수량 미만 재고 알림

test("재고 부족 알림은 품명을 굵게, 소유자와 두 숫자를 detail에 내고, 품목 상세로 링크한다", () => {
  const item = buildPartStockBelowMinimumNotification({
    partId: "part-1",
    partName: "RF 증폭기 모듈",
    owner: "SERVICE_SPARE",
    currentQuantity: 15,
    minimumQuantity: 30,
  });

  assert.equal(item.kind, "PART_STOCK_BELOW_MINIMUM");
  assert.equal(item.subject, "RF 증폭기 모듈");
  // 소유자를 빼면 같은 부품의 네 줄을 구별할 수 없고, 숫자를 빼면 상세를 열기
  // 전에는 급한지 아닌지를 알 수 없다.
  assert.equal(item.detail, "보수부재 · 15 / 한계 30");
  assert.equal(item.href, "/inventory/part-1");
});

test("재고 부족 알림의 소유자 이름은 새로 쓴 것이 아니라 소유 라벨 표의 그 문자열이어야 한다", () => {
  // 결재·부품 요청 알림에 걸어 둔 것과 같은 단정이다 — 복사해 두면 재고 보유
  // 표와 종 알림이 같은 소유자를 서로 다른 이름으로 부르게 된다.
  const item = buildPartStockBelowMinimumNotification({
    partId: "part-1",
    partName: "RF 증폭기 모듈",
    owner: "KYOSAN",
    currentQuantity: 0,
    minimumQuantity: 5,
  });
  assert.ok(
    item.detail.startsWith(stockOwnerLabels.KYOSAN),
    `detail이 소유 라벨로 시작해야 한다: ${item.detail}`
  );
});

test("재고가 0이어도 숫자 0이 그대로 보인다 — 빈 칸이 되면 안 된다", () => {
  // 재고 행이 아예 없는 소유자가 바로 이 경우다(조회가 0으로 만들어 준다).
  const item = buildPartStockBelowMinimumNotification({
    partId: "part-1",
    partName: "RF 증폭기 모듈",
    owner: "DSS",
    currentQuantity: 0,
    minimumQuantity: 3,
  });
  assert.equal(item.detail, "DSS · 0 / 한계 3");
});

test("🔴 부품 하나가 소유자 넷에서 부족하면 배지에 4로 센다 — 결재 알림과 반대 판단이다", () => {
  // 가르는 기준은 "한 번의 조치로 함께 사라지는가"다. DSS 재고를 채워도 교산
  // 부족은 그대로 남으므로, 넷은 실제로 해야 할 일 넷이다.
  const items = (["DSS", "KYOSAN", "SERVICE_SPARE", "TEST"] as const).map((owner) =>
    buildPartStockBelowMinimumNotification({
      partId: "part-1",
      partName: "RF 증폭기 모듈",
      owner,
      currentQuantity: 0,
      minimumQuantity: 1,
    })
  );

  // React key도 서로 달라야 한 줄도 사라지지 않는다.
  assert.equal(new Set(items.map((item) => item.id)).size, 4);
  assert.equal(countNotificationTargetsByKind(items).PART_STOCK_BELOW_MINIMUM, 4);

  // 대조 — 결재 알림은 같은 접수 건의 두 결재를 1로 센다(위쪽 시험과 같은 규칙).
  const approvals = [approvalItem("case-1", "REPAIR_INSPECTION"), approvalItem("case-1", "FINAL_SHIPMENT")];
  assert.equal(countNotificationTargetsByKind(approvals).REPAIR_CASE_APPROVAL, 1);
});

test("재고 부족은 다른 종류의 배지를 건드리지 않는다", () => {
  const counts = countNotificationTargetsByKind([
    approvalItem("case-1", "REPAIR_INSPECTION"),
    buildPendingPartRequestNotification({ requestId: "req-1", intakeNumber: "D9705-012", requestedByName: "김엔지니어" }),
    buildPartStockBelowMinimumNotification({
      partId: "part-1",
      partName: "RF 증폭기 모듈",
      owner: "DSS",
      currentQuantity: 1,
      minimumQuantity: 2,
    }),
  ]);

  assert.equal(counts.REPAIR_CASE_APPROVAL, 1);
  assert.equal(counts.PART_REQUEST_PENDING, 1);
  assert.equal(counts.PART_STOCK_BELOW_MINIMUM, 1);
});
