import { test } from "node:test";
import assert from "node:assert/strict";
import { validateLocalRepairCase } from "./validation";

/**
 * 보고서번호(legacyReportNumber)는 로컬 데모 모드의 저장 레코드에 나중에
 * 추가된 필드다 — 그래서 "키가 아예 없는 기존 레코드"를 만나는 일이 정상
 * 경로에 존재한다. validateLocalRepairCase는 관계/보안에 민감한 값이 어긋나면
 * 레코드를 통째로 버리므로(다른 정체성으로 조용히 바꿔치기하지 않기 위함),
 * 이 필드 하나 때문에 기존 접수 건이 사라지지 않는지가 여기서 고정된다.
 */
function storedCase(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: "local-11111111-1111-4111-8111-111111111111",
    intakeNumber: "D260601",
    legacyReportNumber: null,
    workflowType: "PAID_MATCHER",
    billingType: "PAID",
    status: "WAITING_INTAKE_INSPECTION",
    priority: "NORMAL",
    currentWorkflowStepKey: "intake_inspection",
    receivedAt: "2026-08-01",
    customerRequestedDueDate: null,
    internalTargetShipmentDate: null,
    actualShipmentDate: null,
    exceptionStatus: null,
    createdAt: "2026-08-01T00:00:00.000Z",
    customerId: "c-001",
    customerNameSnapshot: "한빛전자(주)",
    endUserId: null,
    endUserNameSnapshot: null,
    assignedEngineerId: null,
    assignedEngineerNameSnapshot: null,
    modelName: "TG-100",
    lotNumber: "LOT-1",
    serialNumber: "SN-1",
    partNumber: null,
    accessoryList: null,
    externalConditionSummary: null,
    reasonForRemoval: null,
    reportedSymptom: null,
    intakeInspectionResult: null,
    currentDiagnosisSummary: null,
    nextPlannedAction: null,
    notes: null,
    contactName: null,
    contactPhone: null,
    contactEmail: null,
    ...overrides,
  };
}

test("로컬 레코드의 보고서번호는 그대로 보존된다", () => {
  const result = validateLocalRepairCase(storedCase({ legacyReportNumber: "R-2026-018" }));
  assert.notEqual(result, null);
  assert.equal(result?.legacyReportNumber, "R-2026-018");
});

test("보고서번호 키가 없는 기존 레코드는 버려지지 않고 null로 읽힌다", () => {
  const legacy = storedCase();
  delete legacy.legacyReportNumber;
  const result = validateLocalRepairCase(legacy);
  assert.notEqual(result, null, "이 필드 추가 이전에 저장된 접수 건이 사라지면 안 된다");
  assert.equal(result?.legacyReportNumber, null);
});

test("보고서번호가 문자열도 null도 아니면 레코드를 버린다", () => {
  assert.equal(validateLocalRepairCase(storedCase({ legacyReportNumber: 7 })), null);
  assert.equal(validateLocalRepairCase(storedCase({ legacyReportNumber: "   " })), null);
});
