import { test } from "node:test";
import assert from "node:assert/strict";
import {
  NOTIFICATION_KINDS,
  buildApprovalNotification,
  countNotificationTargets,
  countNotificationTargetsByKind,
  type NotificationItem,
} from "./notifications";
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

test("이번에 등록된 알림 종류는 결재 요청 하나뿐이다", () => {
  // 종류를 늘리는 것은 "누구에게 보여도 되는가"를 다시 판정해야 하는 일이라
  // 별도 작업으로 다룬다. 늘어난 것을 여기서 알아차리게 둔다.
  assert.deepEqual([...NOTIFICATION_KINDS], ["REPAIR_CASE_APPROVAL"]);
});
