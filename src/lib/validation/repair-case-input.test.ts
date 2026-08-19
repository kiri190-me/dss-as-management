import { test } from "node:test";
import assert from "node:assert/strict";
import { isValidIdempotencyKey, validateCreateRepairCaseInput } from "./repair-case-input";
import type { IntakeSubmissionInput } from "@/lib/domain/local/submit-intake";

function validInput(overrides: Partial<IntakeSubmissionInput> = {}): IntakeSubmissionInput {
  return {
    workflowType: "PAID_MATCHER",
    billingType: "PAID",
    customerId: "11111111-1111-4111-8111-111111111111",
    endUserId: null,
    assignedEngineerId: "22222222-2222-4222-8222-222222222222",
    priority: "NORMAL",
    receivedAt: "2026-08-04",
    customerRequestedDueDate: null,
    internalTargetShipmentDate: "2026-08-20",
    modelName: "TG-100",
    productModelId: "33333333-3333-4333-8333-333333333333",
    newProductModelName: null,
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

test("valid input passes", () => {
  const result = validateCreateRepairCaseInput(validInput());
  assert.equal(result.ok, true);
});

test("missing customerId fails with a field error", () => {
  const result = validateCreateRepairCaseInput(validInput({ customerId: "" }));
  assert.equal(result.ok, false);
  if (!result.ok) assert.ok(result.fieldErrors.customerId);
});

test("empty assignedEngineerId is accepted (optional field) and normalizes to null", () => {
  const result = validateCreateRepairCaseInput(validInput({ assignedEngineerId: "" }));
  assert.equal(result.ok, true);
  if (result.ok) assert.equal(result.data.assignedEngineerId, null);
});

test("null assignedEngineerId is accepted (optional field)", () => {
  const result = validateCreateRepairCaseInput(validInput({ assignedEngineerId: null }));
  assert.equal(result.ok, true);
  if (result.ok) assert.equal(result.data.assignedEngineerId, null);
});

test("invalid workflowType fails", () => {
  const result = validateCreateRepairCaseInput(
    validInput({ workflowType: "NOT_A_WORKFLOW" as IntakeSubmissionInput["workflowType"] })
  );
  assert.equal(result.ok, false);
  if (!result.ok) assert.ok(result.fieldErrors.workflowType);
});

test("invalid billingType fails with a field error", () => {
  const result = validateCreateRepairCaseInput(
    validInput({ billingType: "NOT_A_BILLING_TYPE" as IntakeSubmissionInput["billingType"] })
  );
  assert.equal(result.ok, false);
  if (!result.ok) assert.ok(result.fieldErrors.billingType);
});

// "레거시 MATCHER는 신규 접수에 쓸 수 없다"를 확인하던 테스트가 여기 있었다.
// 2026-08-19에 그 workflowType 자체가 없어지면서 검증이 아니라 타입이 막는
// 일이 되었다 — 남겨 두면 아래 "유·무상과 workflowType은 맞아야 한다"와 같은
// 것을 이름만 다르게 두 번 확인하게 된다.

test("billingType and workflowType must agree for new intake", () => {
  const result = validateCreateRepairCaseInput(
    validInput({ workflowType: "PAID_GENERATOR", billingType: "WARRANTY" })
  );
  assert.equal(result.ok, false);
  if (!result.ok) assert.ok(result.fieldErrors.workflowType);
});

test("manual intake rejects PENDING_DECISION", () => {
  const result = validateCreateRepairCaseInput(
    validInput({ workflowType: "PENDING_MATCHER", billingType: "PENDING_DECISION" })
  );
  assert.equal(result.ok, false);
  if (!result.ok) assert.ok(result.fieldErrors.billingType);
});

test("Excel intake explicitly permits matching PENDING_DECISION workflow", () => {
  const result = validateCreateRepairCaseInput(
    validInput({ workflowType: "PENDING_MATCHER", billingType: "PENDING_DECISION" }),
    { allowPendingBilling: true }
  );
  assert.equal(result.ok, true);
});

test("PARTIAL_PAID uses the paid workflow", () => {
  const result = validateCreateRepairCaseInput(
    validInput({ workflowType: "PAID_MATCHER", billingType: "PARTIAL_PAID" })
  );
  assert.equal(result.ok, true);
});

test("invalid receivedAt fails", () => {
  const result = validateCreateRepairCaseInput(validInput({ receivedAt: "not-a-date" }));
  assert.equal(result.ok, false);
  if (!result.ok) assert.ok(result.fieldErrors.receivedAt);
});

test("empty internalTargetShipmentDate is accepted (optional field) and normalizes to null", () => {
  const result = validateCreateRepairCaseInput(validInput({ internalTargetShipmentDate: "" }));
  assert.equal(result.ok, true);
  if (result.ok) assert.equal(result.data.internalTargetShipmentDate, null);
});

test("null internalTargetShipmentDate is accepted (optional field)", () => {
  const result = validateCreateRepairCaseInput(validInput({ internalTargetShipmentDate: null }));
  assert.equal(result.ok, true);
  if (result.ok) assert.equal(result.data.internalTargetShipmentDate, null);
});

test("invalid (non-date) internalTargetShipmentDate still fails when provided", () => {
  const result = validateCreateRepairCaseInput(validInput({ internalTargetShipmentDate: "not-a-date" }));
  assert.equal(result.ok, false);
  if (!result.ok) assert.ok(result.fieldErrors.internalTargetShipmentDate);
});

test("internalTargetShipmentDate earlier than receivedAt fails", () => {
  const result = validateCreateRepairCaseInput(
    validInput({ receivedAt: "2026-08-10", internalTargetShipmentDate: "2026-08-01" })
  );
  assert.equal(result.ok, false);
  if (!result.ok) assert.ok(result.fieldErrors.internalTargetShipmentDate);
});

test("internalTargetInspectionCompletionDate: create persists the submitted date (A/S intake 일정 checkpoint)", () => {
  const result = validateCreateRepairCaseInput(
    validInput({ receivedAt: "2026-08-16", internalTargetInspectionCompletionDate: "2026-08-30" })
  );
  assert.equal(result.ok, true);
  if (result.ok) assert.equal(result.data.internalTargetInspectionCompletionDate, "2026-08-30");
});

test("empty internalTargetInspectionCompletionDate is accepted (optional field) and normalizes to null", () => {
  const result = validateCreateRepairCaseInput(validInput({ internalTargetInspectionCompletionDate: "" }));
  assert.equal(result.ok, true);
  if (result.ok) assert.equal(result.data.internalTargetInspectionCompletionDate, null);
});

test("null internalTargetInspectionCompletionDate is accepted (optional field)", () => {
  const result = validateCreateRepairCaseInput(validInput({ internalTargetInspectionCompletionDate: null }));
  assert.equal(result.ok, true);
  if (result.ok) assert.equal(result.data.internalTargetInspectionCompletionDate, null);
});

test("invalid (non-date) internalTargetInspectionCompletionDate still fails when provided", () => {
  const result = validateCreateRepairCaseInput(validInput({ internalTargetInspectionCompletionDate: "not-a-date" }));
  assert.equal(result.ok, false);
  if (!result.ok) assert.ok(result.fieldErrors.internalTargetInspectionCompletionDate);
});

test("internalTargetInspectionCompletionDate earlier than receivedAt fails", () => {
  const result = validateCreateRepairCaseInput(
    validInput({ receivedAt: "2026-08-16", internalTargetInspectionCompletionDate: "2026-08-01" })
  );
  assert.equal(result.ok, false);
  if (!result.ok) assert.ok(result.fieldErrors.internalTargetInspectionCompletionDate);
});

test("customerRequestedDueDate earlier than receivedAt fails", () => {
  const result = validateCreateRepairCaseInput(
    validInput({ receivedAt: "2026-08-10", customerRequestedDueDate: "2026-08-01" })
  );
  assert.equal(result.ok, false);
  if (!result.ok) assert.ok(result.fieldErrors.customerRequestedDueDate);
});

test("missing modelName/lotNumber/serialNumber all fail together", () => {
  const result = validateCreateRepairCaseInput(
    validInput({ modelName: "", lotNumber: "", serialNumber: "" })
  );
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.ok(result.fieldErrors.modelName);
    assert.ok(result.fieldErrors.lotNumber);
    assert.ok(result.fieldErrors.serialNumber);
  }
});

test("overlong modelName fails", () => {
  const result = validateCreateRepairCaseInput(validInput({ modelName: "x".repeat(201) }));
  assert.equal(result.ok, false);
  if (!result.ok) assert.ok(result.fieldErrors.modelName);
});

test("whitespace is trimmed on success", () => {
  const result = validateCreateRepairCaseInput(validInput({ modelName: "  TG-100  " }));
  assert.equal(result.ok, true);
  if (result.ok) assert.equal(result.data.modelName, "TG-100");
});

test("blank optional long-text fields normalize to null", () => {
  const result = validateCreateRepairCaseInput(validInput({ notes: "   " }));
  assert.equal(result.ok, true);
  if (result.ok) assert.equal(result.data.notes, null);
});

test("no longer reads/returns intakeInspectionResult/currentDiagnosisSummary/nextPlannedAction (record_kind derived-summary checkpoint), even if a client still sends them", () => {
  const result = validateCreateRepairCaseInput(
    validInput({
      intakeInspectionResult: "수동 입력값",
      currentDiagnosisSummary: "수동 입력값",
      nextPlannedAction: "수동 입력값",
    } as Partial<IntakeSubmissionInput>)
  );
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.ok(!("intakeInspectionResult" in result.data));
    assert.ok(!("currentDiagnosisSummary" in result.data));
    assert.ok(!("nextPlannedAction" in result.data));
  }
});

test("createRepairCase-bound data succeeds without the 3 legacy summary fields present at all in the raw input", () => {
  const { intakeInspectionResult, currentDiagnosisSummary, nextPlannedAction, ...rest } = validInput();
  void intakeInspectionResult;
  void currentDiagnosisSummary;
  void nextPlannedAction;
  const result = validateCreateRepairCaseInput(rest as IntakeSubmissionInput);
  assert.equal(result.ok, true, JSON.stringify(result));
});

test("blank endUserId normalizes to null (optional field)", () => {
  const result = validateCreateRepairCaseInput(validInput({ endUserId: "" }));
  assert.equal(result.ok, true);
  if (result.ok) assert.equal(result.data.endUserId, null);
});

test("customerId null + newCustomerName provided passes and is trimmed", () => {
  const result = validateCreateRepairCaseInput(
    validInput({ customerId: null, newCustomerName: "  새 고객사  " })
  );
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.data.customerId, null);
    assert.equal(result.data.newCustomerName, "새 고객사");
  }
});

test("neither customerId nor newCustomerName provided fails", () => {
  const result = validateCreateRepairCaseInput(validInput({ customerId: null, newCustomerName: null }));
  assert.equal(result.ok, false);
  if (!result.ok) assert.ok(result.fieldErrors.customerId);
});

test("overlong newCustomerName fails", () => {
  const result = validateCreateRepairCaseInput(
    validInput({ customerId: null, newCustomerName: "x".repeat(201) })
  );
  assert.equal(result.ok, false);
  if (!result.ok) assert.ok(result.fieldErrors.customerId);
});

test("endUserId null + newEndUserName provided passes and is trimmed", () => {
  const result = validateCreateRepairCaseInput(validInput({ endUserId: null, newEndUserName: "  새 지점  " }));
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.data.endUserId, null);
    assert.equal(result.data.newEndUserName, "새 지점");
  }
});

test("neither endUserId nor newEndUserName provided still passes — End-User stays optional", () => {
  const result = validateCreateRepairCaseInput(validInput({ endUserId: null, newEndUserName: null }));
  assert.equal(result.ok, true);
});

test("overlong newEndUserName fails", () => {
  const result = validateCreateRepairCaseInput(validInput({ newEndUserName: "x".repeat(201) }));
  assert.equal(result.ok, false);
  if (!result.ok) assert.ok(result.fieldErrors.endUserId);
});

test("productModelId null + newProductModelName provided passes and is trimmed", () => {
  const result = validateCreateRepairCaseInput(
    validInput({ productModelId: null, newProductModelName: "  새 모델  " })
  );
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.data.productModelId, null);
    assert.equal(result.data.newProductModelName, "새 모델");
  }
});

test("neither productModelId nor newProductModelName provided fails", () => {
  const result = validateCreateRepairCaseInput(validInput({ productModelId: null, newProductModelName: null }));
  assert.equal(result.ok, false);
  if (!result.ok) assert.ok(result.fieldErrors.modelName);
});

test("malformed productModelId (not a UUID) fails", () => {
  const result = validateCreateRepairCaseInput(validInput({ productModelId: "not-a-uuid" }));
  assert.equal(result.ok, false);
  if (!result.ok) assert.ok(result.fieldErrors.modelName);
});

test("overlong newProductModelName fails", () => {
  const result = validateCreateRepairCaseInput(
    validInput({ productModelId: null, newProductModelName: "x".repeat(201) })
  );
  assert.equal(result.ok, false);
  if (!result.ok) assert.ok(result.fieldErrors.modelName);
});

test("invalid contact email format fails", () => {
  const result = validateCreateRepairCaseInput(validInput({ contactEmail: "not-an-email" }));
  assert.equal(result.ok, false);
  if (!result.ok) assert.ok(result.fieldErrors.contactEmail);
});

test("valid contact email passes and is trimmed", () => {
  const result = validateCreateRepairCaseInput(validInput({ contactEmail: "  a@b.com  " }));
  assert.equal(result.ok, true);
  if (result.ok) assert.equal(result.data.contactEmail, "a@b.com");
});

test("overlong free-text field fails", () => {
  const result = validateCreateRepairCaseInput(validInput({ notes: "x".repeat(4001) }));
  assert.equal(result.ok, false);
  if (!result.ok) assert.ok(result.fieldErrors.notes);
});

test("omitted intakeNumber override is accepted and normalizes to null", () => {
  const result = validateCreateRepairCaseInput(validInput());
  assert.equal(result.ok, true);
  if (result.ok) assert.equal(result.data.intakeNumber, null);
});

test("well-formed intakeNumber override passes and is trimmed", () => {
  const result = validateCreateRepairCaseInput(validInput({ intakeNumber: "  D260601  " }));
  assert.equal(result.ok, true);
  if (result.ok) assert.equal(result.data.intakeNumber, "D260601");
});

test("malformed intakeNumber override fails with a field error", () => {
  const result = validateCreateRepairCaseInput(validInput({ intakeNumber: "NOT-A-NUMBER" }));
  assert.equal(result.ok, false);
  if (!result.ok) assert.ok(result.fieldErrors.intakeNumber);
});

test("intakeNumber override with an out-of-range month fails format check", () => {
  const result = validateCreateRepairCaseInput(validInput({ intakeNumber: "D261301" }));
  assert.equal(result.ok, false);
  if (!result.ok) assert.ok(result.fieldErrors.intakeNumber);
});

test("isValidIdempotencyKey accepts a well-formed UUID", () => {
  assert.equal(isValidIdempotencyKey("11111111-1111-4111-8111-111111111111"), true);
  assert.equal(isValidIdempotencyKey("A1B2C3D4-E5F6-47A8-89AB-1234567890AB"), true);
});

test("isValidIdempotencyKey rejects malformed or non-UUID values", () => {
  assert.equal(isValidIdempotencyKey(""), false);
  assert.equal(isValidIdempotencyKey("not-a-uuid"), false);
  assert.equal(isValidIdempotencyKey("11111111-1111-1111-1111-11111111111"), false); // 1 char short
  assert.equal(isValidIdempotencyKey(12345), false);
  assert.equal(isValidIdempotencyKey(null), false);
  assert.equal(isValidIdempotencyKey(undefined), false);
  // Business-field-derived values must never accidentally validate.
  assert.equal(isValidIdempotencyKey("TG-CONC-msf0inak"), false);
});
