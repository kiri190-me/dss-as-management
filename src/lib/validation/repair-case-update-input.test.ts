import { test } from "node:test";
import assert from "node:assert/strict";
import {
  isValidExpectedVersion,
  isValidRepairCaseEditSection,
  isValidRepairCaseId,
  validateFaultServiceSectionFields,
  validateIntakeSectionFields,
  validateProductSectionFields,
} from "./repair-case-update-input";

// ------------------------------------------------------------- format checks

test("isValidRepairCaseId accepts a well-formed UUID and rejects everything else", () => {
  assert.equal(isValidRepairCaseId("11111111-1111-4111-8111-111111111111"), true);
  assert.equal(isValidRepairCaseId("not-a-uuid"), false);
  assert.equal(isValidRepairCaseId(""), false);
  assert.equal(isValidRepairCaseId(123), false);
  assert.equal(isValidRepairCaseId(null), false);
});

test("isValidExpectedVersion accepts only a positive integer", () => {
  assert.equal(isValidExpectedVersion(1), true);
  assert.equal(isValidExpectedVersion(42), true);
  assert.equal(isValidExpectedVersion(0), false);
  assert.equal(isValidExpectedVersion(-1), false);
  assert.equal(isValidExpectedVersion(1.5), false);
  assert.equal(isValidExpectedVersion("1"), false);
  assert.equal(isValidExpectedVersion(null), false);
});

test("isValidRepairCaseEditSection accepts only the three known sections", () => {
  assert.equal(isValidRepairCaseEditSection("INTAKE"), true);
  assert.equal(isValidRepairCaseEditSection("PRODUCT"), true);
  assert.equal(isValidRepairCaseEditSection("FAULT_SERVICE"), true);
  assert.equal(isValidRepairCaseEditSection("WORKFLOW"), false);
  assert.equal(isValidRepairCaseEditSection(""), false);
});

// --------------------------------------------------------------- INTAKE

test("INTAKE: empty payload is a no-op success (nothing to validate)", () => {
  const result = validateIntakeSectionFields({});
  assert.equal(result.ok, true);
  if (result.ok) assert.deepEqual(result.data, {});
});

test("INTAKE: only submitted keys are validated/returned (partial update)", () => {
  const result = validateIntakeSectionFields({ receivedAt: "2026-08-04" });
  assert.equal(result.ok, true);
  if (result.ok) assert.deepEqual(result.data, { receivedAt: "2026-08-04" });
});

test("INTAKE: blank customerId fails", () => {
  const result = validateIntakeSectionFields({ customerId: "   " });
  assert.equal(result.ok, false);
  if (!result.ok) assert.ok(result.fieldErrors.customerId);
});

test("INTAKE: invalid receivedAt fails", () => {
  const result = validateIntakeSectionFields({ receivedAt: "not-a-date" });
  assert.equal(result.ok, false);
  if (!result.ok) assert.ok(result.fieldErrors.receivedAt);
});

test("INTAKE: endUserId null/empty normalizes to null", () => {
  const result = validateIntakeSectionFields({ endUserId: "" });
  assert.equal(result.ok, true);
  if (result.ok) assert.equal(result.data.endUserId, null);
});

test("INTAKE: invalid contact email format fails", () => {
  const result = validateIntakeSectionFields({ contactEmail: "not-an-email" });
  assert.equal(result.ok, false);
  if (!result.ok) assert.ok(result.fieldErrors.contactEmail);
});

test("INTAKE: valid contact email is trimmed", () => {
  const result = validateIntakeSectionFields({ contactEmail: "  a@b.com  " });
  assert.equal(result.ok, true);
  if (result.ok) assert.equal(result.data.contactEmail, "a@b.com");
});

test("INTAKE: overlong contactName fails", () => {
  const result = validateIntakeSectionFields({ contactName: "x".repeat(201) });
  assert.equal(result.ok, false);
  if (!result.ok) assert.ok(result.fieldErrors.contactName);
});

test("INTAKE: blank customerRequestedDueDate normalizes to null", () => {
  const result = validateIntakeSectionFields({ customerRequestedDueDate: "" });
  assert.equal(result.ok, true);
  if (result.ok) assert.equal(result.data.customerRequestedDueDate, null);
});

test("INTAKE: newCustomerName is accepted and trimmed", () => {
  const result = validateIntakeSectionFields({ newCustomerName: "  새 고객사  " });
  assert.equal(result.ok, true);
  if (result.ok) assert.equal(result.data.newCustomerName, "새 고객사");
});

test("INTAKE: blank newCustomerName fails (attributed to the customerId field slot)", () => {
  const result = validateIntakeSectionFields({ newCustomerName: "   " });
  assert.equal(result.ok, false);
  if (!result.ok) assert.ok(result.fieldErrors.customerId);
});

test("INTAKE: overlong newCustomerName fails", () => {
  const result = validateIntakeSectionFields({ newCustomerName: "x".repeat(201) });
  assert.equal(result.ok, false);
  if (!result.ok) assert.ok(result.fieldErrors.customerId);
});

test("INTAKE: newEndUserName is accepted and trimmed", () => {
  const result = validateIntakeSectionFields({ newEndUserName: "  새 지점  " });
  assert.equal(result.ok, true);
  if (result.ok) assert.equal(result.data.newEndUserName, "새 지점");
});

test("INTAKE: blank newEndUserName fails (attributed to the endUserId field slot)", () => {
  const result = validateIntakeSectionFields({ newEndUserName: "" });
  assert.equal(result.ok, false);
  if (!result.ok) assert.ok(result.fieldErrors.endUserId);
});

test("INTAKE: billingType accepts final values but never permits reverting to PENDING_DECISION", () => {
  const paid = validateIntakeSectionFields({ billingType: "PAID" });
  assert.equal(paid.ok, true);
  if (paid.ok) assert.equal(paid.data.billingType, "PAID");

  const warranty = validateIntakeSectionFields({ billingType: "WARRANTY" });
  assert.equal(warranty.ok, true);
  if (warranty.ok) assert.equal(warranty.data.billingType, "WARRANTY");

  const partialPaid = validateIntakeSectionFields({ billingType: "PARTIAL_PAID" });
  assert.equal(partialPaid.ok, true);
  if (partialPaid.ok) assert.equal(partialPaid.data.billingType, "PARTIAL_PAID");

  const pending = validateIntakeSectionFields({ billingType: "PENDING_DECISION" });
  assert.equal(pending.ok, false);
  if (!pending.ok) assert.ok(pending.fieldErrors.billingType);

  const invalid = validateIntakeSectionFields({ billingType: "" });
  assert.equal(invalid.ok, false);
  if (!invalid.ok) assert.ok(invalid.fieldErrors.billingType);
});

test("INTAKE: priority accepts LOW/NORMAL/HIGH/URGENT and rejects anything else, including empty string", () => {
  for (const code of ["LOW", "NORMAL", "HIGH", "URGENT"] as const) {
    const result = validateIntakeSectionFields({ priority: code });
    assert.equal(result.ok, true);
    if (result.ok) assert.equal(result.data.priority, code);
  }

  const invalid = validateIntakeSectionFields({ priority: "" });
  assert.equal(invalid.ok, false);
  if (!invalid.ok) assert.ok(invalid.fieldErrors.priority);

  const unknown = validateIntakeSectionFields({ priority: "CRITICAL" });
  assert.equal(unknown.ok, false);
  if (!unknown.ok) assert.ok(unknown.fieldErrors.priority);
});

test("INTAKE: internalTargetShipmentDate accepts a valid date, normalizes blank/null to null (clearable), and rejects malformed input (moved from FAULT_SERVICE checkpoint)", () => {
  const valid = validateIntakeSectionFields({ internalTargetShipmentDate: "2026-08-20" });
  assert.equal(valid.ok, true);
  if (valid.ok) assert.equal(valid.data.internalTargetShipmentDate, "2026-08-20");

  const blank = validateIntakeSectionFields({ internalTargetShipmentDate: "" });
  assert.equal(blank.ok, true);
  if (blank.ok) assert.equal(blank.data.internalTargetShipmentDate, null);

  const cleared = validateIntakeSectionFields({ internalTargetShipmentDate: null });
  assert.equal(cleared.ok, true);
  if (cleared.ok) assert.equal(cleared.data.internalTargetShipmentDate, null);

  const invalid = validateIntakeSectionFields({ internalTargetShipmentDate: "not-a-date" });
  assert.equal(invalid.ok, false);
  if (!invalid.ok) assert.ok(invalid.fieldErrors.internalTargetShipmentDate);
});

test("INTAKE: internalTargetInspectionCompletionDate accepts a valid date, normalizes blank/null to null (clearable), and rejects malformed input (moved from FAULT_SERVICE checkpoint)", () => {
  const valid = validateIntakeSectionFields({ internalTargetInspectionCompletionDate: "2026-08-30" });
  assert.equal(valid.ok, true);
  if (valid.ok) assert.equal(valid.data.internalTargetInspectionCompletionDate, "2026-08-30");

  const blank = validateIntakeSectionFields({ internalTargetInspectionCompletionDate: "" });
  assert.equal(blank.ok, true);
  if (blank.ok) assert.equal(blank.data.internalTargetInspectionCompletionDate, null);

  const cleared = validateIntakeSectionFields({ internalTargetInspectionCompletionDate: null });
  assert.equal(cleared.ok, true);
  if (cleared.ok) assert.equal(cleared.data.internalTargetInspectionCompletionDate, null);

  const invalid = validateIntakeSectionFields({ internalTargetInspectionCompletionDate: "not-a-date" });
  assert.equal(invalid.ok, false);
  if (!invalid.ok) assert.ok(invalid.fieldErrors.internalTargetInspectionCompletionDate);
});

// -------------------------------------------------------------- PRODUCT

test("PRODUCT: malformed productModelId (not a UUID) fails", () => {
  const result = validateProductSectionFields({ productModelId: "not-a-uuid" });
  assert.equal(result.ok, false);
  if (!result.ok) assert.ok(result.fieldErrors.productModelId);
});

test("PRODUCT: valid productModelId passes through as-is", () => {
  const id = "11111111-1111-4111-8111-111111111111";
  const result = validateProductSectionFields({ productModelId: id });
  assert.equal(result.ok, true);
  if (result.ok) assert.equal(result.data.productModelId, id);
});

test("PRODUCT: blank newProductModelName fails", () => {
  const result = validateProductSectionFields({ newProductModelName: "" });
  assert.equal(result.ok, false);
  if (!result.ok) assert.ok(result.fieldErrors.newProductModelName);
});

test("PRODUCT: newProductModelName is trimmed, and over-length fails", () => {
  const result = validateProductSectionFields({ newProductModelName: "  새 모델  " });
  assert.equal(result.ok, true);
  if (result.ok) assert.equal(result.data.newProductModelName, "새 모델");

  const overlong = validateProductSectionFields({ newProductModelName: "x".repeat(201) });
  assert.equal(overlong.ok, false);
  if (!overlong.ok) assert.ok(overlong.fieldErrors.newProductModelName);
});

test("PRODUCT: no longer accepts raw modelName (replaced by productModelId/newProductModelName) — an unknown key is simply not returned", () => {
  const result = validateProductSectionFields({ modelName: "TG-100" });
  assert.equal(result.ok, true);
  if (result.ok) assert.deepEqual(result.data, {});
});

test("PRODUCT: valid partial triple passes and trims", () => {
  const result = validateProductSectionFields({ serialNumber: "  SN-1  " });
  assert.equal(result.ok, true);
  if (result.ok) assert.deepEqual(result.data, { serialNumber: "SN-1" });
});

test("PRODUCT: no longer accepts partNumber (removed from user-facing UI checkpoint) — an unknown key is simply not returned", () => {
  const result = validateProductSectionFields({ partNumber: "PN-1" });
  assert.equal(result.ok, true);
  if (result.ok) assert.deepEqual(result.data, {});
});

test("PRODUCT: accessoryList/externalConditionSummary/reasonForRemoval accepted (moved from FAULT_SERVICE checkpoint)", () => {
  const result = validateProductSectionFields({
    accessoryList: "  충전기  ",
    externalConditionSummary: "  양호  ",
    reasonForRemoval: "  고객 요청  ",
  });
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.data.accessoryList, "충전기");
    assert.equal(result.data.externalConditionSummary, "양호");
    assert.equal(result.data.reasonForRemoval, "고객 요청");
  }
});

test("PRODUCT: overlong externalConditionSummary fails", () => {
  const result = validateProductSectionFields({ externalConditionSummary: "x".repeat(4001) });
  assert.equal(result.ok, false);
  if (!result.ok) assert.ok(result.fieldErrors.externalConditionSummary);
});

test("PRODUCT: no longer accepts billingType (moved to INTAKE checkpoint) — an unknown key is simply not returned", () => {
  const result = validateProductSectionFields({ billingType: "PAID" });
  assert.equal(result.ok, true);
  if (result.ok) assert.deepEqual(result.data, {});
});

test("PRODUCT: workflowKind accepts MATCHER/GENERATOR and rejects anything else", () => {
  const matcher = validateProductSectionFields({ workflowKind: "MATCHER" });
  assert.equal(matcher.ok, true);
  if (matcher.ok) assert.equal(matcher.data.workflowKind, "MATCHER");

  const generator = validateProductSectionFields({ workflowKind: "GENERATOR" });
  assert.equal(generator.ok, true);
  if (generator.ok) assert.equal(generator.data.workflowKind, "GENERATOR");

  const invalid = validateProductSectionFields({ workflowKind: "MATCHER_PAID" });
  assert.equal(invalid.ok, false);
  if (!invalid.ok) assert.ok(invalid.fieldErrors.workflowKind);
});

// ---------------------------------------------------------- FAULT_SERVICE

test("FAULT_SERVICE: blank assignedEngineerId is accepted (optional field) and normalizes to null", () => {
  const result = validateFaultServiceSectionFields({ assignedEngineerId: "" });
  assert.equal(result.ok, true);
  if (result.ok) assert.equal(result.data.assignedEngineerId, null);
});

test("FAULT_SERVICE: null assignedEngineerId is accepted (optional field)", () => {
  const result = validateFaultServiceSectionFields({ assignedEngineerId: null });
  assert.equal(result.ok, true);
  if (result.ok) assert.equal(result.data.assignedEngineerId, null);
});

test("FAULT_SERVICE: a real assignedEngineerId value is trimmed and kept", () => {
  const result = validateFaultServiceSectionFields({ assignedEngineerId: "  u-004  " });
  assert.equal(result.ok, true);
  if (result.ok) assert.equal(result.data.assignedEngineerId, "u-004");
});

test("FAULT_SERVICE: no longer accepts internalTargetShipmentDate (moved to INTAKE checkpoint) — an unknown key is simply not returned", () => {
  const result = validateFaultServiceSectionFields({ internalTargetShipmentDate: "2026-08-20" });
  assert.equal(result.ok, true);
  if (result.ok) assert.deepEqual(result.data, {});
});

test("FAULT_SERVICE: no longer accepts internalTargetInspectionCompletionDate (moved to INTAKE 일정 checkpoint) — an unknown key is simply not returned", () => {
  const result = validateFaultServiceSectionFields({ internalTargetInspectionCompletionDate: "2026-08-30" });
  assert.equal(result.ok, true);
  if (result.ok) assert.deepEqual(result.data, {});
});

test("FAULT_SERVICE: overlong notes fails", () => {
  const result = validateFaultServiceSectionFields({ notes: "x".repeat(4001) });
  assert.equal(result.ok, false);
  if (!result.ok) assert.ok(result.fieldErrors.notes);
});

test("FAULT_SERVICE: blank long-text field normalizes to null", () => {
  const result = validateFaultServiceSectionFields({ reportedSymptom: "   " });
  assert.equal(result.ok, true);
  if (result.ok) assert.equal(result.data.reportedSymptom, null);
});

test("FAULT_SERVICE: no longer accepts intakeInspectionResult/currentDiagnosisSummary/nextPlannedAction (record_kind derived-summary checkpoint) — unknown keys are simply not returned", () => {
  const result = validateFaultServiceSectionFields({
    intakeInspectionResult: "수동 입력값",
    currentDiagnosisSummary: "수동 입력값",
    nextPlannedAction: "수동 입력값",
  });
  assert.equal(result.ok, true);
  if (result.ok) assert.deepEqual(result.data, {});
});

test("FAULT_SERVICE: multiple submitted fields all validated together", () => {
  const result = validateFaultServiceSectionFields({
    notes: "테스트",
    assignedEngineerId: "u-004",
  });
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.data.notes, "테스트");
    assert.equal(result.data.assignedEngineerId, "u-004");
  }
});
