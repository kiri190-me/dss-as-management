import { test } from "node:test";
import assert from "node:assert/strict";
import { computeDashboardSummary } from "./dashboard-metrics";
import type { EffectiveRepairCase } from "./local/workflow/effective-repair-case";

/**
 * 대시보드 카드는 전부 effectiveStatus/effectiveActualShipmentDate/
 * effectiveIsOverdue만 읽는다(원본 status/actualShipmentDate/isOverdue가
 * 아니다). "금월 출하 완료"의 "금월"은 한국 달력 월이다 — UTC 월로 세면
 * 매달 1일 한국시간 0~9시 사이에 지난달로 새어 나간다.
 */

function row(overrides: Partial<EffectiveRepairCase> = {}): EffectiveRepairCase {
  return {
    id: "case-1",
    version: 1,
    source: "DATABASE",
    productId: null,
    intakeNumber: "D260813",
    legacyReportNumber: null,
    workflowType: "PAID_GENERATOR",
    status: "IN_REPAIR",
    priority: "NORMAL",
    exceptionStatus: null,
    currentWorkflowStepKey: "repair",
    receivedAt: "2026-08-03",
    customerRequestedDueDate: null,
    internalTargetInspectionCompletionDate: null,
    internalTargetShipmentDate: null,
    actualShipmentDate: null,
    createdAt: "2026-08-03T00:00:00.000Z",
    isOverdue: false,
    productCategory: "Generator",
    paidOrWarranty: "유상",
    billingType: "PAID",
    modelName: "TG-350",
    lotNumber: "LN-1",
    serialNumber: "SN-1",
    partNumber: null,
    customerId: "cust-1",
    customerName: "대성RF시스템",
    endUserId: null,
    endUserName: null,
    assignedEngineerId: null,
    engineerName: null,
    reportedSymptom: null,
    intakeInspectionResult: null,
    currentDiagnosisSummary: null,
    nextPlannedAction: null,
    accessoryList: null,
    externalConditionSummary: null,
    reasonForRemoval: null,
    notes: null,
    contactName: null,
    contactPhone: null,
    contactEmail: null,
    effectiveStatus: "IN_REPAIR",
    effectiveWorkflowStepKey: "repair",
    effectiveActualShipmentDate: null,
    effectiveIsOverdue: false,
    holdState: null,
    hasWorkflowOverride: false,
    ...overrides,
  };
}

function shipped(id: string, effectiveActualShipmentDate: string): EffectiveRepairCase {
  return row({
    id,
    effectiveStatus: "SHIPMENT_COMPLETED",
    effectiveWorkflowStepKey: "shipment",
    effectiveActualShipmentDate,
  });
}

// ─────────────────────────────────────────────── 금월 출하 완료

test("completedThisMonth: 기준 시각과 같은 한국 월에 출하된 건만 센다", () => {
  const now = new Date("2026-08-25T05:00:00.000Z"); // 2026-08-25 14:00 KST
  const summary = computeDashboardSummary(
    [
      shipped("aug-1", "2026-08-01"),
      shipped("aug-2", "2026-08-31"),
      shipped("jul", "2026-07-31"),
      shipped("sep", "2026-09-01"),
    ],
    now
  );
  assert.equal(summary.completedThisMonth, 2);
});

test("completedThisMonth: 한국 9월 1일 새벽이면 8월 출하 건은 이번 달이 아니다", () => {
  // 2026-08-31T15:30:00Z = 한국 2026-09-01 00:30. UTC 달력으로는 아직 8월이라
  // getUTCMonth() 기반 구현이라면 8월 출하 건을 틀리게 "금월"로 센다.
  const now = new Date("2026-08-31T15:30:00.000Z");
  const summary = computeDashboardSummary(
    [shipped("aug", "2026-08-31"), shipped("sep", "2026-09-01")],
    now
  );
  assert.equal(summary.completedThisMonth, 1);
});

test("completedThisMonth: 한국 8월 31일 23:30이면 8월 출하 건이 이번 달이다", () => {
  // 2026-08-31T14:30:00Z = 한국 2026-08-31 23:30.
  const now = new Date("2026-08-31T14:30:00.000Z");
  const summary = computeDashboardSummary(
    [shipped("aug", "2026-08-31"), shipped("sep", "2026-09-01")],
    now
  );
  assert.equal(summary.completedThisMonth, 1);
});

test("completedThisMonth: 출하일이 없으면 출하 완료 상태여도 세지 않는다", () => {
  const now = new Date("2026-08-25T05:00:00.000Z");
  const summary = computeDashboardSummary(
    [row({ id: "no-date", effectiveStatus: "SHIPMENT_COMPLETED", effectiveActualShipmentDate: null })],
    now
  );
  assert.equal(summary.completedThisMonth, 0);
});

// ─────────────────────────────────────────────── 납기 지연

test("overdueCount: 원본 isOverdue가 아니라 effectiveIsOverdue를 센다", () => {
  const now = new Date("2026-08-25T05:00:00.000Z");
  const summary = computeDashboardSummary(
    [
      row({ id: "a", isOverdue: false, effectiveIsOverdue: true }),
      row({ id: "b", isOverdue: true, effectiveIsOverdue: false }),
      row({ id: "c", isOverdue: true, effectiveIsOverdue: true }),
    ],
    now
  );
  assert.equal(summary.overdueCount, 2);
});

// ─────────────────────────────────────────────── 상태별 카운트 (회귀 보호)

test("상태별 카드는 원본 status가 아니라 effectiveStatus를 읽는다", () => {
  const now = new Date("2026-08-25T05:00:00.000Z");
  const summary = computeDashboardSummary(
    [
      row({ id: "a", status: "IN_REPAIR", effectiveStatus: "WAITING_INTAKE_INSPECTION" }),
      row({ id: "b", status: "IN_REPAIR", effectiveStatus: "WAITING_KYOSAN_REPLY" }),
      row({ id: "c", status: "WAITING_PO", effectiveStatus: "WAITING_PO" }),
      row({ id: "d", status: "IN_REPAIR", effectiveStatus: "WAITING_PARTS_SUPPLY" }),
      row({ id: "e", status: "WAITING_SHIPMENT", effectiveStatus: "IN_REPAIR" }),
      row({ id: "f", status: "IN_REPAIR", effectiveStatus: "WAITING_SHIPMENT_APPROVAL" }),
      row({ id: "g", status: "IN_REPAIR", effectiveStatus: "WAITING_SHIPMENT" }),
      shipped("h", "2026-08-10"),
    ],
    now
  );

  assert.equal(summary.waitingIntakeInspection, 1);
  assert.equal(summary.waitingKyosanReply, 1);
  assert.equal(summary.waitingPo, 1);
  assert.equal(summary.waitingPartsSupply, 1);
  assert.equal(summary.inRepair, 1);
  assert.equal(summary.waitingShipmentApproval, 1);
  assert.equal(summary.waitingShipment, 1);
  // 현재 입고 수 = 출하 완료가 아닌 건 전부(effectiveStatus 기준).
  assert.equal(summary.currentIntakeCount, 7);
  assert.equal(summary.completedThisMonth, 1);
});
