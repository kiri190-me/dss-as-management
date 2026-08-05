import { test } from "node:test";
import assert from "node:assert/strict";
import { isValidIdempotencyKey, validateCreateRepairCaseInput } from "./repair-case-input";
import type { IntakeSubmissionInput } from "@/lib/domain/local/submit-intake";

function validInput(overrides: Partial<IntakeSubmissionInput> = {}): IntakeSubmissionInput {
  return {
    workflowType: "MATCHER",
    customerId: "11111111-1111-4111-8111-111111111111",
    endUserId: null,
    assignedEngineerId: "22222222-2222-4222-8222-222222222222",
    priority: "NORMAL",
    receivedAt: "2026-08-04",
    customerRequestedDueDate: null,
    internalTargetShipmentDate: "2026-08-20",
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

test("valid input passes", () => {
  const result = validateCreateRepairCaseInput(validInput());
  assert.equal(result.ok, true);
});

test("missing customerId fails with a field error", () => {
  const result = validateCreateRepairCaseInput(validInput({ customerId: "" }));
  assert.equal(result.ok, false);
  if (!result.ok) assert.ok(result.fieldErrors.customerId);
});

test("missing assignedEngineerId fails", () => {
  const result = validateCreateRepairCaseInput(validInput({ assignedEngineerId: "" }));
  assert.equal(result.ok, false);
  if (!result.ok) assert.ok(result.fieldErrors.assignedEngineerId);
});

test("invalid workflowType fails", () => {
  const result = validateCreateRepairCaseInput(
    validInput({ workflowType: "NOT_A_WORKFLOW" as IntakeSubmissionInput["workflowType"] })
  );
  assert.equal(result.ok, false);
  if (!result.ok) assert.ok(result.fieldErrors.workflowType);
});

test("invalid receivedAt fails", () => {
  const result = validateCreateRepairCaseInput(validInput({ receivedAt: "not-a-date" }));
  assert.equal(result.ok, false);
  if (!result.ok) assert.ok(result.fieldErrors.receivedAt);
});

test("missing internalTargetShipmentDate fails", () => {
  const result = validateCreateRepairCaseInput(validInput({ internalTargetShipmentDate: "" }));
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

test("blank endUserId normalizes to null (optional field)", () => {
  const result = validateCreateRepairCaseInput(validInput({ endUserId: "" }));
  assert.equal(result.ok, true);
  if (result.ok) assert.equal(result.data.endUserId, null);
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
