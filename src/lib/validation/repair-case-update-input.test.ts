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

// -------------------------------------------------------------- PRODUCT

test("PRODUCT: blank modelName fails", () => {
  const result = validateProductSectionFields({ modelName: "" });
  assert.equal(result.ok, false);
  if (!result.ok) assert.ok(result.fieldErrors.modelName);
});

test("PRODUCT: valid partial triple passes and trims", () => {
  const result = validateProductSectionFields({ serialNumber: "  SN-1  " });
  assert.equal(result.ok, true);
  if (result.ok) assert.deepEqual(result.data, { serialNumber: "SN-1" });
});

test("PRODUCT: partNumber null is accepted", () => {
  const result = validateProductSectionFields({ partNumber: null });
  assert.equal(result.ok, true);
  if (result.ok) assert.equal(result.data.partNumber, null);
});

// ---------------------------------------------------------- FAULT_SERVICE

test("FAULT_SERVICE: blank assignedEngineerId fails", () => {
  const result = validateFaultServiceSectionFields({ assignedEngineerId: "" });
  assert.equal(result.ok, false);
  if (!result.ok) assert.ok(result.fieldErrors.assignedEngineerId);
});

test("FAULT_SERVICE: invalid internalTargetShipmentDate fails", () => {
  const result = validateFaultServiceSectionFields({ internalTargetShipmentDate: "not-a-date" });
  assert.equal(result.ok, false);
  if (!result.ok) assert.ok(result.fieldErrors.internalTargetShipmentDate);
});

test("FAULT_SERVICE: blank internalTargetInspectionCompletionDate normalizes to null", () => {
  const result = validateFaultServiceSectionFields({ internalTargetInspectionCompletionDate: "" });
  assert.equal(result.ok, true);
  if (result.ok) assert.equal(result.data.internalTargetInspectionCompletionDate, null);
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

test("FAULT_SERVICE: multiple submitted fields all validated together", () => {
  const result = validateFaultServiceSectionFields({
    notes: "테스트",
    internalTargetShipmentDate: "2026-08-20",
  });
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.data.notes, "테스트");
    assert.equal(result.data.internalTargetShipmentDate, "2026-08-20");
  }
});
