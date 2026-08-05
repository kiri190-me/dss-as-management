import { test } from "node:test";
import assert from "node:assert/strict";
import {
  authorizeSubmittedFields,
  canEditSection,
  editableFieldsForRoleInSection,
  isBlockedByShipmentLock,
  isFieldEditable,
} from "./repair-case-edit-authorization";

// ---------------------------------------------------------- SUPER_ADMIN/ADMIN

test("SUPER_ADMIN and ADMIN may edit every field in every section", () => {
  for (const role of ["SUPER_ADMIN", "ADMIN"] as const) {
    assert.equal(canEditSection(role, "INTAKE"), true);
    assert.equal(canEditSection(role, "PRODUCT"), true);
    assert.equal(canEditSection(role, "FAULT_SERVICE"), true);
    assert.equal(isFieldEditable(role, "customerId"), true);
    assert.equal(isFieldEditable(role, "modelName"), true);
    assert.equal(isFieldEditable(role, "assignedEngineerId"), true);
  }
});

// --------------------------------------------------------------- AS_ENGINEER

test("AS_ENGINEER may edit technical/service and product fields", () => {
  assert.equal(canEditSection("AS_ENGINEER", "FAULT_SERVICE"), true);
  assert.equal(canEditSection("AS_ENGINEER", "PRODUCT"), true);
  assert.equal(isFieldEditable("AS_ENGINEER", "reportedSymptom"), true);
  assert.equal(isFieldEditable("AS_ENGINEER", "assignedEngineerId"), true);
  assert.equal(isFieldEditable("AS_ENGINEER", "internalTargetShipmentDate"), true);
  assert.equal(isFieldEditable("AS_ENGINEER", "modelName"), true);
});

test("AS_ENGINEER may not edit customer/intake fields", () => {
  assert.equal(canEditSection("AS_ENGINEER", "INTAKE"), false);
  for (const field of [
    "customerId",
    "endUserId",
    "receivedAt",
    "customerRequestedDueDate",
    "contactName",
    "contactPhone",
    "contactEmail",
  ]) {
    assert.equal(isFieldEditable("AS_ENGINEER", field), false, `AS_ENGINEER should not edit ${field}`);
  }
});

// -------------------------------------------------------------------- SALES

test("SALES may edit intake/contact fields and notes", () => {
  assert.equal(canEditSection("SALES", "INTAKE"), true);
  for (const field of [
    "customerId",
    "endUserId",
    "receivedAt",
    "customerRequestedDueDate",
    "contactName",
    "contactPhone",
    "contactEmail",
    "notes",
  ]) {
    assert.equal(isFieldEditable("SALES", field), true, `SALES should edit ${field}`);
  }
});

test("SALES may not edit diagnosis/technical/product fields", () => {
  for (const field of [
    "intakeInspectionResult",
    "currentDiagnosisSummary",
    "nextPlannedAction",
    "assignedEngineerId",
    "modelName",
    "lotNumber",
    "serialNumber",
    "partNumber",
    "internalTargetInspectionCompletionDate",
    "internalTargetShipmentDate",
    "accessoryList",
    "externalConditionSummary",
    "reasonForRemoval",
    "reportedSymptom",
  ]) {
    assert.equal(isFieldEditable("SALES", field), false, `SALES should not edit ${field}`);
  }
  assert.equal(canEditSection("SALES", "PRODUCT"), false);
});

test("SALES sees FAULT_SERVICE as editable (only via notes), never gets the full section", () => {
  assert.equal(canEditSection("SALES", "FAULT_SERVICE"), true);
  assert.deepEqual(editableFieldsForRoleInSection("SALES", "FAULT_SERVICE"), ["notes"]);
});

// --------------------------------------------------------------- INVENTORY_MANAGER

test("INVENTORY_MANAGER is read-only in every section", () => {
  assert.equal(canEditSection("INVENTORY_MANAGER", "INTAKE"), false);
  assert.equal(canEditSection("INVENTORY_MANAGER", "PRODUCT"), false);
  assert.equal(canEditSection("INVENTORY_MANAGER", "FAULT_SERVICE"), false);
  assert.deepEqual(editableFieldsForRoleInSection("INVENTORY_MANAGER", "INTAKE"), []);
});

// -------------------------------------------------------- authorizeSubmittedFields

test("authorizeSubmittedFields ok when every submitted field is permitted", () => {
  const result = authorizeSubmittedFields("SALES", "INTAKE", ["customerId", "contactName"]);
  assert.equal(result.ok, true);
});

test("authorizeSubmittedFields rejects a role submitting a field it cannot edit, even mixed with allowed ones", () => {
  const result = authorizeSubmittedFields("AS_ENGINEER", "INTAKE", ["receivedAt"]);
  assert.equal(result.ok, false);
  if (!result.ok) assert.deepEqual(result.unauthorizedFields, ["receivedAt"]);
});

test("authorizeSubmittedFields: SALES submitting only notes within FAULT_SERVICE is authorized", () => {
  const result = authorizeSubmittedFields("SALES", "FAULT_SERVICE", ["notes"]);
  assert.equal(result.ok, true);
});

test("authorizeSubmittedFields: SALES submitting notes + a technical field is rejected wholesale", () => {
  const result = authorizeSubmittedFields("SALES", "FAULT_SERVICE", ["notes", "reportedSymptom"]);
  assert.equal(result.ok, false);
  if (!result.ok) assert.deepEqual(result.unauthorizedFields, ["reportedSymptom"]);
});

// ---------------------------------------------------------------- shipment lock

test("isBlockedByShipmentLock blocks whenever isLocked is true, independent of role", () => {
  assert.equal(isBlockedByShipmentLock(true), true);
  assert.equal(isBlockedByShipmentLock(false), false);
});
