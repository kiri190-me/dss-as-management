import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  APPROVAL_OUTCOME_NOTIFICATION_WINDOW_DAYS,
  APPROVAL_REJECTION_REASON_PREVIEW_LENGTH,
  DELETED_REPAIR_CASE_SUBJECT,
  NOTIFICATION_KINDS,
  PART_ISSUE_APPROVAL_LABEL,
  approvalOutcomeNotificationWindowStart,
  buildApprovalGrantedNotification,
  buildApprovalNotification,
  buildApprovalRejectedNotification,
  buildPartIssueApprovalNotification,
  buildPartStockBelowMinimumNotification,
  buildPendingPartRequestNotification,
  countNotificationTargets,
  countNotificationTargetsByKind,
  previewApprovalRejectionReason,
  type ApprovalOutcomeTarget,
  type NotificationItem,
} from "./notifications";
import { inventoryPartRequestStatusLabels, stockOwnerLabels } from "./inventory-types";
import { LABELS as APPROVAL_TYPE_LABELS } from "./local/workflow/shipment-approval-checklist";
import { repairCaseDetailHrefs } from "./repair-case-detail-tabs";
import { SHIPMENT_APPROVAL_ROUTE_SCOPE_LABELS } from "./shipment-approval-route";
import { checkNotificationAcknowledgementKey } from "./notification-acknowledgement";

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

test("등록된 알림 종류는 결재 요청·부품 요청 대기·재고 부족·새 수리 의뢰·불출 승인 대기·승인 완료·반려됨 일곱이다", () => {
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
  //
  // PART_ISSUE_APPROVAL_PENDING은 새 판정을 세우지 않고 **이미 있는 판정**을
  // 그대로 쓴다: [승인 요청건] 탭의 「내가 결재할 건」이 쓰는
  // listPartIssueRequestsPendingMyApproval(지정 관문 mayDecideAssignedApproval —
  // 그 단계에 지정된 사람과 최고관리자). 결재 요청과 같은 (가)형이라 역할로
  // 거르지 않는다(아래 레지스트리 시험이 그것을 못 박는다).
  //
  // APPROVAL_GRANTED·APPROVAL_REJECTED는 판정을 새로 세웠다: **요청자 본인**
  // (queries/approval-outcome-notifications.ts 의 `requested_by_user_id = 나`). 남의
  // 결재 결과를 요구할 입구가 없고, 역할로 거르지 않는 (가)형이다. 할 일이 아니라
  // 정보성이라 눌러서 확인하면 사라진다(domain/notification-acknowledgement.ts).
  assert.deepEqual(
    [...NOTIFICATION_KINDS],
    [
      "REPAIR_CASE_APPROVAL",
      "PART_REQUEST_PENDING",
      "PART_STOCK_BELOW_MINIMUM",
      "CUSTOMER_REPAIR_REQUEST_NEW",
      "PART_ISSUE_APPROVAL_PENDING",
      "APPROVAL_GRANTED",
      "APPROVAL_REJECTED",
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

// ────────────────────────────────────── 지금 내 차례인 부품 불출 결재 알림

function partIssueItem(overrides: Partial<Parameters<typeof buildPartIssueApprovalNotification>[0]> = {}) {
  return buildPartIssueApprovalNotification({
    issueRequestId: "issue-1",
    intakeNumber: null,
    destinationNote: null,
    routeStepOrder: 2,
    requestedByName: "홍길동",
    ...overrides,
  });
}

test("요청 기반 불출 알림은 인수번호를 굵게, 결재선 단계와 신청자를 detail에 내고, [승인 요청건] 탭으로 링크한다", () => {
  const item = partIssueItem({ intakeNumber: "D2609001" });

  assert.equal(item.kind, "PART_ISSUE_APPROVAL_PENDING");
  assert.equal(item.subject, "D2609001");
  // 종류 이름("불출 승인 대기")은 종 패널이 윗줄에 따로 적는다 — detail 에 또 넣지
  // 않는다. "결재선 N단계"는 신청 카드의 결재선 줄이 쓰는 말이다.
  assert.equal(item.detail, "결재선 2단계 · 신청자 홍길동");
  // 신청에는 자기만의 상세 화면이 없다 — 승인·반려를 누르는 자리가 이 탭이다.
  assert.equal(item.href, "/inventory/approvals");
  // 신청 하나가 사람에게도 한 건이다.
  assert.equal(item.targetKey, "issue-1");
});

test("직접 사용 불출 알림은 접수 건이 없으면 사용처를 굵게 적는다", () => {
  const item = partIssueItem({ destinationNote: "상해수리소" });
  assert.equal(item.subject, "상해수리소");
  assert.equal(item.href, "/inventory/approvals", "무엇에 대한 신청이든 갈 곳은 그대로다");
});

test("직접 사용이 접수 건과 사용처를 둘 다 가지면 인수번호가 먼저다 — 신청 카드와 같은 순서", () => {
  const item = partIssueItem({ intakeNumber: "D2609001", destinationNote: "상해수리소" });
  assert.equal(item.subject, "D2609001");
});

test("인수번호도 사용처도 없으면(요청 기반인데 접수 건이 영구 삭제됨) '삭제된 접수 건'으로 나온다", () => {
  // 굵은 글씨 자리가 통째로 비면 무엇에 대한 알림인지 알 수 없다. 문구는 부품
  // 요청 알림이 같은 상황에 쓰는 것과 같아야 한다.
  const item = partIssueItem();
  assert.equal(item.subject, DELETED_REPAIR_CASE_SUBJECT);
  assert.equal(item.subject, "삭제된 접수 건");
});

test("결재선을 타지 않는 행이면 단계 없이 신청자만 적는다", () => {
  const item = partIssueItem({ intakeNumber: "D2609001", routeStepOrder: null });
  assert.equal(item.detail, "신청자 홍길동");
  assert.ok(!item.detail.includes("단계"), `단계 번호가 없는데 단계를 말한다: ${item.detail}`);
});

test("1단계도 그대로 1단계로 적는다 — 0이나 빈 칸으로 새지 않는다", () => {
  assert.equal(partIssueItem({ routeStepOrder: 1 }).detail, "결재선 1단계 · 신청자 홍길동");
});

test("신청이 여러 건이면 id가 서로 달라 한 줄도 사라지지 않고, 배지는 신청 단위로 센다", () => {
  // 같은 부품 요청·같은 접수 건에 신청이 둘 걸릴 수 있다 — 인수번호가 같아도
  // React key가 겹치면 안 되고, 세는 단위도 신청별로 둘이어야 한다.
  const first = partIssueItem({ issueRequestId: "issue-1", intakeNumber: "D2609001" });
  const second = partIssueItem({ issueRequestId: "issue-2", intakeNumber: "D2609001" });

  assert.notEqual(first.id, second.id);
  assert.equal(countNotificationTargetsByKind([first, second]).PART_ISSUE_APPROVAL_PENDING, 2);
});

test("🔴 결재 배지는 불출 승인 대기를 세지 않는다 — 사이드바 배지는 접수 건 결재만 센다", () => {
  // 사이드바 배지는 countNotificationTargetsByKind(...).REPAIR_CASE_APPROVAL 하나만
  // 읽는다((app)/layout.tsx). 이름에 "결재"가 같이 들어 있어도 불출 결재까지 조용히
  // 세기 시작하면 그 숫자가 가리키는 목록(A/S 결재)과 어긋난다.
  const counts = countNotificationTargetsByKind([
    approvalItem("case-1", "REPAIR_INSPECTION"),
    partIssueItem({ issueRequestId: "issue-1", intakeNumber: "D2609001" }),
    partIssueItem({ issueRequestId: "issue-2", destinationNote: "상해수리소" }),
  ]);

  assert.equal(counts.REPAIR_CASE_APPROVAL, 1, "결재 배지는 접수 건 결재 1건만 센다");
  assert.equal(counts.PART_ISSUE_APPROVAL_PENDING, 2);
  assert.equal(counts.PART_REQUEST_PENDING, 0);
});

// ─────────────────────────── 레지스트리 — 불출 승인 대기는 역할로 거르지 않는다

/**
 * 레지스트리(db/queries/notifications.ts)는 server-only 와 DB 를 끌고 들어와 단위
 * 시험에서 부를 수 없다. 그래서 **소스를 읽어** 계약을 붙잡는다. 실제로 누구에게
 * 가는지는 queries/inventory-part-issue-requests.integration.test.ts 가
 * listMyNotifications 를 그대로 태워 본다.
 */
const registrySource = readFileSync(new URL("../db/queries/notifications.ts", import.meta.url), "utf8");

/** 레지스트리 배열에서 그 종류의 `{ kind, load }` 한 덩어리. 다음 종류나 배열 끝에서 자른다. */
function registryBlockFor(kind: string): string {
  const start = registrySource.indexOf(`kind: "${kind}",`);
  assert.ok(start >= 0, `레지스트리에 ${kind} 가 없다`);
  const arrayEnd = registrySource.indexOf("\n];", start);
  assert.ok(arrayEnd > start, "레지스트리 배열의 끝을 찾지 못했다");
  const nextKind = registrySource.indexOf('kind: "', start + 1);
  const end = nextKind >= 0 && nextKind < arrayEnd ? nextKind : arrayEnd;
  return registrySource.slice(start, end);
}

test("🔴 불출 승인 대기는 역할로 거르지 않는다 — 결재 요청과 같은 (가)형이다", () => {
  const block = registryBlockFor("PART_ISSUE_APPROVAL_PENDING");

  // load 가 역할을 **받지도** 않는다. 결재선에는 역할 제한 없이 누구든 올라가므로
  // 역할을 보는 순간 자기 차례인 결재자가 알림을 못 받는다.
  assert.match(block, /load:\s*async\s*\(\s*actorUserId\s*\)\s*=>/, "load 가 사용자 id 하나만 받아야 한다");
  assert.ok(!block.includes("actorRole"), "불출 승인 대기 load 가 역할을 본다");
  assert.ok(!/canReceive\w*\(/.test(block), "불출 승인 대기 load 가 역할 판정 함수를 부른다");

  // 대조 — 같은 방법으로 자른 (나)형(부품 요청)은 역할을 본다. 이 대조가 없으면
  // 자르는 경계가 틀려 빈 문자열을 검사해도 위 단언이 초록색으로 남는다.
  assert.ok(registryBlockFor("PART_REQUEST_PENDING").includes("actorRole"), "자르는 방법이 (나)형을 못 잡는다");
});

test("🔴 불출 승인 대기는 판정을 새로 적지 않고 [승인 요청건] 탭과 같은 조회를 부른다", () => {
  // 알림과 목록이 서로 다른 말을 하면 안 된다 — 목록에는 있는데 알림이 없거나,
  // 알림을 눌렀는데 목록이 비어 있는 어긋남이 생긴다.
  const block = registryBlockFor("PART_ISSUE_APPROVAL_PENDING");
  assert.ok(block.includes("listPartIssueRequestsPendingMyApproval(actorUserId)"), "같은 조회를 부르지 않는다");
  assert.ok(block.includes("buildPartIssueApprovalNotification("), "모양 변환은 도메인의 build 함수가 한다");
  assert.match(
    registrySource,
    /import \{[^}]*\blistPartIssueRequestsPendingMyApproval\b[^}]*\} from "\.\/inventory-part-issue-requests"/,
    "[승인 요청건] 탭이 쓰는 그 파일의 조회여야 한다"
  );
});

// ═════════════════════════════════════ 결재 결과 — 승인 완료 · 반려됨

const CASE_ID = "11111111-1111-4111-8111-111111111111";
const CASE_APPROVAL_ID = "22222222-2222-4222-8222-222222222222";
const ISSUE_APPROVAL_ID = "33333333-3333-4333-8333-333333333333";
const PART_REQUEST_ID = "44444444-4444-4444-8444-444444444444";

function caseTarget(approvalType: "REPAIR_INSPECTION" | "FINAL_SHIPMENT" = "FINAL_SHIPMENT"): ApprovalOutcomeTarget {
  return {
    source: "REPAIR_CASE",
    approvalId: CASE_APPROVAL_ID,
    repairCaseId: CASE_ID,
    intakeNumber: "D2609012",
    approvalType,
  };
}

function issueTarget(overrides: Partial<Extract<ApprovalOutcomeTarget, { source: "PART_ISSUE" }>> = {}): ApprovalOutcomeTarget {
  return {
    source: "PART_ISSUE",
    approvalId: ISSUE_APPROVAL_ID,
    partRequestId: null,
    intakeNumber: null,
    destinationNote: null,
    ...overrides,
  };
}

test("부품 불출 결재의 이름은 용도 이름표에서 만든 「부품 불출 승인」이다 — 글자를 새로 쓰지 않는다", () => {
  assert.equal(PART_ISSUE_APPROVAL_LABEL, "부품 불출 승인");
  assert.ok(PART_ISSUE_APPROVAL_LABEL.startsWith(SHIPMENT_APPROVAL_ROUTE_SCOPE_LABELS.PART_ISSUE));
});

test("창은 7일이고 결정 시각으로 잰다 — 시작 시각은 지금에서 정확히 7일 전이다", () => {
  assert.equal(APPROVAL_OUTCOME_NOTIFICATION_WINDOW_DAYS, 7);
  const now = new Date("2026-09-11T12:00:00.000Z");
  assert.equal(approvalOutcomeNotificationWindowStart(now).toISOString(), "2026-09-04T12:00:00.000Z");
});

test("승인 완료(검수·출하) — 인수번호를 굵게, 결재 이름·결정자를 detail 에, 검수/승인 화면으로 링크한다", () => {
  for (const approvalType of ["REPAIR_INSPECTION", "FINAL_SHIPMENT"] as const) {
    const item = buildApprovalGrantedNotification({ ...caseTarget(approvalType), decidedByName: "김결재" });
    assert.equal(item.kind, "APPROVAL_GRANTED");
    assert.equal(item.id, `APPROVAL_GRANTED:rca:${CASE_APPROVAL_ID}`);
    assert.equal(item.targetKey, item.id, "사건 하나가 한 건이다 — 접수 건으로 묶지 않는다");
    assert.equal(item.subject, "D2609012");
    assert.equal(item.detail, `${APPROVAL_TYPE_LABELS[approvalType]} · 김결재`);
    assert.ok(!item.detail.includes("승인 완료"), "종류 이름은 패널이 윗줄에 따로 적는다");
    assert.equal(item.href, repairCaseDetailHrefs(CASE_ID).approval);
  }
});

test("승인 완료(부품 불출) — 인수번호 → 사용처 → 삭제된 접수 건 순으로 굵게 적고, [승인 요청건] 탭으로 링크한다", () => {
  const withCase = buildApprovalGrantedNotification({
    ...issueTarget({ intakeNumber: "D2609013", destinationNote: "상해수리소" }),
    decidedByName: "박승인",
  });
  assert.equal(withCase.id, `APPROVAL_GRANTED:pia:${ISSUE_APPROVAL_ID}`);
  assert.equal(withCase.subject, "D2609013", "인수번호가 먼저다");
  assert.equal(withCase.detail, "부품 불출 승인 · 박승인");
  assert.equal(withCase.href, "/inventory/approvals");

  const destinationOnly = buildApprovalGrantedNotification({
    ...issueTarget({ destinationNote: "상해수리소" }),
    decidedByName: "박승인",
  });
  assert.equal(destinationOnly.subject, "상해수리소");

  const neither = buildApprovalGrantedNotification({ ...issueTarget(), decidedByName: "박승인" });
  assert.equal(neither.subject, DELETED_REPAIR_CASE_SUBJECT);

  // 요청 기반이어도 승인 완료는 같은 탭으로 간다(실행 대기로 보이는 곳).
  const requestBased = buildApprovalGrantedNotification({
    ...issueTarget({ partRequestId: PART_REQUEST_ID }),
    decidedByName: "박승인",
  });
  assert.equal(requestBased.href, "/inventory/approvals");
});

test("반려됨(검수·출하) — 결재 이름·사유를 detail 에, 다시 올리는 검수/승인 화면으로 링크한다", () => {
  const item = buildApprovalRejectedNotification({ ...caseTarget("REPAIR_INSPECTION"), decisionReason: "사진 누락" });
  assert.equal(item.kind, "APPROVAL_REJECTED");
  assert.equal(item.id, `APPROVAL_REJECTED:rca:${CASE_APPROVAL_ID}`);
  assert.equal(item.targetKey, item.id);
  assert.equal(item.subject, "D2609012");
  assert.equal(item.detail, "수리 검수 승인 · 사유: 사진 누락");
  assert.ok(!item.detail.includes("반려됨"), "종류 이름은 패널이 윗줄에 따로 적는다");
  assert.equal(item.href, repairCaseDetailHrefs(CASE_ID).approval);
});

test("반려됨(부품 불출) — 요청 기반이면 부품 요청 관리로, 직접 사용이면 재고 목록으로 링크한다", () => {
  const requestBased = buildApprovalRejectedNotification({
    ...issueTarget({ partRequestId: PART_REQUEST_ID, intakeNumber: "D2609014" }),
    decisionReason: "수량 과다",
  });
  assert.equal(requestBased.id, `APPROVAL_REJECTED:pia:${ISSUE_APPROVAL_ID}`);
  assert.equal(requestBased.subject, "D2609014");
  assert.equal(requestBased.detail, "부품 불출 승인 · 사유: 수량 과다");
  assert.equal(requestBased.href, "/inventory/requests", "요청 기반은 다시 올리는 곳이 부품 요청 관리다");

  const directUse = buildApprovalRejectedNotification({
    ...issueTarget({ destinationNote: "평택 창고" }),
    decisionReason: "수량 과다",
  });
  assert.equal(directUse.subject, "평택 창고");
  assert.equal(directUse.href, "/inventory", "직접 사용은 재고 목록의 [사용]에서 다시 시작한다");
});

test("반려 사유는 한 줄로 펴고, 길면 잘라 말줄임표를 붙인다 — 글자 단위로 자른다", () => {
  assert.equal(previewApprovalRejectionReason("  사진이\n빠졌습니다 \t 다시 올려 주세요 "), "사진이 빠졌습니다 다시 올려 주세요");

  const exact = "가".repeat(APPROVAL_REJECTION_REASON_PREVIEW_LENGTH);
  assert.equal(previewApprovalRejectionReason(exact), exact, "상한까지는 자르지 않는다");

  const long = "나".repeat(APPROVAL_REJECTION_REASON_PREVIEW_LENGTH + 5);
  const preview = previewApprovalRejectionReason(long);
  assert.ok(preview.endsWith("…"), "잘랐으면 말줄임표를 붙인다");
  assert.equal(Array.from(preview).length, APPROVAL_REJECTION_REASON_PREVIEW_LENGTH + 1);

  // 두 코드 단위짜리 글자를 반으로 가르지 않는다.
  const emoji = "😀".repeat(APPROVAL_REJECTION_REASON_PREVIEW_LENGTH + 1);
  const emojiPreview = previewApprovalRejectionReason(emoji);
  assert.equal(Array.from(emojiPreview).length, APPROVAL_REJECTION_REASON_PREVIEW_LENGTH + 1);
  assert.ok(!/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/.test(emojiPreview), "짝 잃은 서로게이트가 남았다");

  const item = buildApprovalRejectedNotification({ ...caseTarget(), decisionReason: long });
  assert.equal(item.detail, `최종 출하 승인 · 사유: ${preview}`);
});

test("반려 사유가 비어 있으면 「사유:」를 빈 채로 적지 않고 결재 이름만 적는다", () => {
  for (const decisionReason of [null, "", "   \n "]) {
    const item = buildApprovalRejectedNotification({ ...caseTarget(), decisionReason });
    assert.equal(item.detail, "최종 출하 승인", JSON.stringify(decisionReason));
  }
});

test("🔴 결재 결과 알림의 id 는 네 갈래 모두 확인 키 검증을 통과한다 — 눌러도 조용히 거절되지 않는다", () => {
  const items = [
    buildApprovalGrantedNotification({ ...caseTarget(), decidedByName: "김결재" }),
    buildApprovalGrantedNotification({ ...issueTarget(), decidedByName: "김결재" }),
    buildApprovalRejectedNotification({ ...caseTarget(), decisionReason: "사유" }),
    buildApprovalRejectedNotification({ ...issueTarget({ partRequestId: PART_REQUEST_ID }), decisionReason: "사유" }),
  ];
  for (const item of items) {
    const checked = checkNotificationAcknowledgementKey(item.id);
    assert.equal(checked.ok, true, `거절됐다: ${item.id}`);
    if (checked.ok) {
      assert.equal(checked.key, item.id);
      assert.equal(checked.kind, item.kind);
    }
  }
  assert.equal(new Set(items.map((item) => item.id)).size, items.length, "네 갈래의 id 가 서로 겹친다");
});

test("같은 행 id 여도 두 표(접수 건 결재·불출 결재)의 키는 겹치지 않는다", () => {
  const sameId = "55555555-5555-4555-8555-555555555555";
  const fromCase = buildApprovalGrantedNotification({ ...caseTarget(), approvalId: sameId, decidedByName: "a" });
  const fromIssue = buildApprovalGrantedNotification({ ...issueTarget(), approvalId: sameId, decidedByName: "a" });
  assert.notEqual(fromCase.id, fromIssue.id);
});

test("결재 결과는 사건 단위로 센다 — 같은 접수 건의 검수·출하 승인 완료는 배지에 2다", () => {
  const counts = countNotificationTargetsByKind([
    buildApprovalGrantedNotification({ ...caseTarget("REPAIR_INSPECTION"), approvalId: "a-1", decidedByName: "a" }),
    buildApprovalGrantedNotification({ ...caseTarget("FINAL_SHIPMENT"), approvalId: "a-2", decidedByName: "a" }),
  ]);
  assert.equal(counts.APPROVAL_GRANTED, 2, "하나를 확인해도 다른 하나는 남아야 하는 두 사건이다");
  assert.equal(counts.REPAIR_CASE_APPROVAL, 0, "사이드바 결재 배지는 결재 결과를 세지 않는다");
});

// ─────────────────────── 레지스트리 — 결재 결과는 요청자 본인 · 확인한 것은 뺀다

for (const kind of ["APPROVAL_GRANTED", "APPROVAL_REJECTED"] as const) {
  test(`🔴 ${kind} 는 역할로 거르지 않고, 새 조회를 부른 뒤 확인한 키를 뺀다`, () => {
    const block = registryBlockFor(kind);
    assert.match(block, /load:\s*async\s*\(\s*actorUserId\s*\)\s*=>/, "load 가 사용자 id 하나만 받아야 한다");
    assert.ok(!block.includes("actorRole"), `${kind} load 가 역할을 본다`);
    assert.ok(!/canReceive\w*\(/.test(block), `${kind} load 가 역할 판정 함수를 부른다`);
    assert.match(block, /withoutAcknowledged\(\s*actorUserId,/, "확인한 키를 빼지 않는다");
    const query = kind === "APPROVAL_GRANTED" ? "listMyGrantedApprovalOutcomes" : "listMyRejectedApprovalOutcomes";
    const build = kind === "APPROVAL_GRANTED" ? "buildApprovalGrantedNotification(" : "buildApprovalRejectedNotification(";
    assert.ok(block.includes(`${query}(actorUserId)`), "결과 사건 조회를 요청자 id 로 부르지 않는다");
    assert.ok(block.includes(build), "모양 변환은 도메인의 build 함수가 한다");
  });
}

test("🔴 확인 기록은 결재 결과 두 종류의 load 에서만 대 본다 — 할 일 알림에는 대 보지 않는다", () => {
  for (const kind of NOTIFICATION_KINDS) {
    const block = registryBlockFor(kind);
    const usesAcknowledgements = block.includes("withoutAcknowledged(");
    assert.equal(
      usesAcknowledgements,
      kind === "APPROVAL_GRANTED" || kind === "APPROVAL_REJECTED",
      `${kind}: 확인 기록을 대 보는지가 기대와 다르다`
    );
  }
  // 확인 기록은 언제나 이 사람 것만 묻는다 — 사람 id 없이 키로만 묻는 호출이 없다.
  assert.match(
    registrySource,
    /listAcknowledgedNotificationKeys\(\s*actorUserId,/,
    "확인 기록 조회에 사람 id 를 넘기지 않는다"
  );
});
