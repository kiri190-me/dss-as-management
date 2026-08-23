import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildShipmentApprovalChecklist,
  isShipmentApprovalChecklistComplete,
} from "./shipment-approval-checklist";

function approval(type: string, status: string, versionAtRequest: number) {
  return { approvalType: type, latest: { status, repairCaseVersionAtRequest: versionAtRequest } };
}

test("결재 기록이 하나도 없으면 둘 다 미요청이고, 출하 승인은 앞 결재에 막혀 있다", () => {
  // 개발 DB에서 '출하 승인됨' 단계에 서 있던 9건이 정확히 이 상태였다 —
  // 단계 이름 때문에 결재를 받은 것으로 오해하기 쉬운 자리다.
  const items = buildShipmentApprovalChecklist({ approvals: [], currentVersion: 1 });

  assert.deepEqual(
    items.map((item) => [item.approvalType, item.state, item.blockedByPrevious]),
    [
      ["REPAIR_INSPECTION", "NOT_REQUESTED", false],
      ["FINAL_SHIPMENT", "NOT_REQUESTED", true],
    ]
  );
  assert.equal(isShipmentApprovalChecklistComplete(items), false);
});

test("검수 승인이 결재되면 최종 출하 승인을 요청할 수 있게 된다", () => {
  const items = buildShipmentApprovalChecklist({
    approvals: [approval("REPAIR_INSPECTION", "APPROVED", 2)],
    currentVersion: 2,
  });

  assert.equal(items[0].state, "APPROVED");
  assert.equal(items[1].state, "NOT_REQUESTED");
  assert.equal(items[1].blockedByPrevious, false);
});

test("검수 승인 후 단계를 진행하면 그 승인이 무효가 되고 출하 승인 요청이 다시 막힌다", () => {
  // version은 내용 수정뿐 아니라 단계 진행으로도 올라간다. 승인을 받아 두고
  // 다음 단계로 넘어간 사람에게는 "이미 승인받았는데 왜 막히지"로 보이므로,
  // 화면이 미요청이 아니라 STALE로 구분해 말해야 한다.
  const items = buildShipmentApprovalChecklist({
    approvals: [approval("REPAIR_INSPECTION", "APPROVED", 2)],
    currentVersion: 3,
  });

  assert.equal(items[0].state, "STALE");
  assert.equal(items[1].blockedByPrevious, true);
});

test("결재 대기 중은 미요청과 구분한다", () => {
  const items = buildShipmentApprovalChecklist({
    approvals: [approval("REPAIR_INSPECTION", "REQUESTED", 1)],
    currentVersion: 1,
  });

  assert.equal(items[0].state, "PENDING");
  // 아직 결재 전이므로 출하 승인 요청은 여전히 막힌다.
  assert.equal(items[1].blockedByPrevious, true);
});

test("반려는 미요청과 구분한다 — 다시 요청해야 한다는 사실이 달라진다", () => {
  const items = buildShipmentApprovalChecklist({
    approvals: [approval("REPAIR_INSPECTION", "REJECTED", 1)],
    currentVersion: 1,
  });

  assert.equal(items[0].state, "REJECTED");
  assert.equal(items[1].blockedByPrevious, true);
});

test("둘 다 결재되고 version도 맞으면 출하 완료를 누를 수 있다", () => {
  const items = buildShipmentApprovalChecklist({
    approvals: [approval("REPAIR_INSPECTION", "APPROVED", 2), approval("FINAL_SHIPMENT", "APPROVED", 2)],
    currentVersion: 2,
  });

  assert.equal(isShipmentApprovalChecklistComplete(items), true);
});

test("출하 승인을 이미 받아 뒀으면 앞 결재가 무효여도 '앞 단계에 막혔다'고 말하지 않는다", () => {
  // 검수 승인이 STALE인데 출하 승인은 현재 version으로 유효한 경우다. 이때
  // 필요한 것은 재요청이 아니라 그대로 출하 완료를 누르는 것이다.
  const items = buildShipmentApprovalChecklist({
    approvals: [approval("REPAIR_INSPECTION", "APPROVED", 1), approval("FINAL_SHIPMENT", "APPROVED", 2)],
    currentVersion: 2,
  });

  assert.equal(items[0].state, "STALE");
  assert.equal(items[1].state, "APPROVED");
  assert.equal(items[1].blockedByPrevious, false);
});
