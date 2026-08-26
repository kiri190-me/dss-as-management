import { test } from "node:test";
import assert from "node:assert/strict";
import {
  authorizeSubmittedFields,
  canBulkDeleteRepairCases,
  canEditSection,
  canPermanentlyDeleteRepairCases,
  canRestoreRepairCases,
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
    assert.equal(isFieldEditable(role, "productModelId"), true);
    assert.equal(isFieldEditable(role, "newProductModelName"), true);
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
  assert.equal(isFieldEditable("AS_ENGINEER", "productModelId"), true);
  assert.equal(
    isFieldEditable("AS_ENGINEER", "newProductModelName"),
    false,
    "AS_ENGINEER may select an existing Product Model but must not register a new one"
  );
});

test("AS_ENGINEER may edit customer/End-User (checkpoint: AS_ENGINEER customer/End-User edit)", () => {
  assert.equal(canEditSection("AS_ENGINEER", "INTAKE"), true);
  for (const field of ["customerId", "newCustomerName", "endUserId", "newEndUserName"]) {
    assert.equal(isFieldEditable("AS_ENGINEER", field), true, `AS_ENGINEER should edit ${field}`);
  }
  assert.deepEqual(
    editableFieldsForRoleInSection("AS_ENGINEER", "INTAKE"),
    [
      "customerId",
      "newCustomerName",
      "endUserId",
      "newEndUserName",
      "billingType",
      "internalTargetInspectionCompletionDate",
      "internalTargetShipmentDate",
      // 보고서번호 — 접수 폼에서 이 역할이 직접 적는 값이라 접수 후 수정
      // 권한도 함께 준다(SALES에는 주지 않았다).
      "legacyReportNumber",
    ]
  );
});

test("AS_ENGINEER may not edit the rest of INTAKE (receivedAt/dates/contact fields stay SALES-only)", () => {
  for (const field of [
    "receivedAt",
    "customerRequestedDueDate",
    "contactName",
    "contactPhone",
    "contactEmail",
  ]) {
    assert.equal(isFieldEditable("AS_ENGINEER", field), false, `AS_ENGINEER should not edit ${field}`);
  }
});

test("AS_ENGINEER may edit 종류(workflowKind)/billingType; SALES may not (checkpoint: 종류 edit permissions)", () => {
  assert.equal(isFieldEditable("AS_ENGINEER", "workflowKind"), true);
  assert.equal(isFieldEditable("AS_ENGINEER", "billingType"), true);
  assert.equal(isFieldEditable("SALES", "workflowKind"), false);
  assert.equal(isFieldEditable("SALES", "billingType"), false);
  assert.equal(isFieldEditable("INVENTORY_MANAGER", "workflowKind"), false);
  assert.equal(isFieldEditable("INVENTORY_MANAGER", "billingType"), false);
});

test("priority is SUPER_ADMIN/ADMIN-only for now (인수 정보 priority-editing checkpoint) — AS_ENGINEER/SALES/INVENTORY_MANAGER never see it", () => {
  assert.equal(isFieldEditable("SUPER_ADMIN", "priority"), true);
  assert.equal(isFieldEditable("ADMIN", "priority"), true);
  assert.equal(isFieldEditable("AS_ENGINEER", "priority"), false);
  assert.equal(isFieldEditable("SALES", "priority"), false);
  assert.equal(isFieldEditable("INVENTORY_MANAGER", "priority"), false);
});

test("no role — including SUPER_ADMIN/ADMIN — may edit the 3 derived-summary fields (record_kind checkpoint)", () => {
  for (const role of ["SUPER_ADMIN", "ADMIN", "AS_ENGINEER", "SALES", "INVENTORY_MANAGER"] as const) {
    for (const field of ["intakeInspectionResult", "currentDiagnosisSummary", "nextPlannedAction"]) {
      assert.equal(isFieldEditable(role, field), false, `${role} should never edit derived field ${field}`);
    }
  }
  assert.deepEqual(
    editableFieldsForRoleInSection("SUPER_ADMIN", "FAULT_SERVICE"),
    ["reportedSymptom", "notes", "assignedEngineerId"]
  );
});

// -------------------------------------------------------------------- SALES

test("SALES may edit intake/contact fields and notes", () => {
  assert.equal(canEditSection("SALES", "INTAKE"), true);
  for (const field of [
    "customerId",
    "newCustomerName",
    "endUserId",
    "newEndUserName",
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
    "productModelId",
    "newProductModelName",
    "lotNumber",
    "serialNumber",
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

// ------------------------------------------------------ canBulkDeleteRepairCases

test("canBulkDeleteRepairCases: SUPER_ADMIN/ADMIN only", () => {
  for (const role of ["SUPER_ADMIN", "ADMIN"] as const) {
    assert.equal(canBulkDeleteRepairCases(role), true, `expected ${role} to bulk-delete repair cases`);
  }
  for (const role of ["AS_ENGINEER", "SALES", "INVENTORY_MANAGER"] as const) {
    assert.equal(canBulkDeleteRepairCases(role), false, `expected ${role} not to bulk-delete repair cases`);
  }
});

// ---------------------------------------------------------- canRestoreRepairCases

test("canRestoreRepairCases: SUPER_ADMIN/ADMIN only", () => {
  for (const role of ["SUPER_ADMIN", "ADMIN"] as const) {
    assert.equal(canRestoreRepairCases(role), true, `expected ${role} to restore repair cases`);
  }
  for (const role of ["AS_ENGINEER", "SALES", "INVENTORY_MANAGER"] as const) {
    assert.equal(canRestoreRepairCases(role), false, `expected ${role} not to restore repair cases`);
  }
});

// ------------------------------------------------ canPermanentlyDeleteRepairCases

test("canPermanentlyDeleteRepairCases: SUPER_ADMIN/ADMIN only", () => {
  for (const role of ["SUPER_ADMIN", "ADMIN"] as const) {
    assert.equal(canPermanentlyDeleteRepairCases(role), true, `expected ${role} to permanently delete repair cases`);
  }
  for (const role of ["AS_ENGINEER", "SALES", "INVENTORY_MANAGER"] as const) {
    assert.equal(canPermanentlyDeleteRepairCases(role), false, `expected ${role} not to permanently delete repair cases`);
  }
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

test("isBlockedByShipmentLock never blocks (shipment-lock removal policy) — a shipped case stays editable", () => {
  assert.equal(isBlockedByShipmentLock(true), false);
  assert.equal(isBlockedByShipmentLock(false), false);
});

// ------------------------------------------------------ 주간보고 상세표의 비고

/**
 * 주간보고 화면의 `비고` 칸(WeeklyReportNotesCell)이 누구에게 열리는가.
 *
 * 그 화면은 새 권한 함수를 만들지 않고 **이 표를 그대로 본다** — page.tsx 가
 * `isFieldEditable(role, "notes")` 를 부르고, 서버 액션도 같은 표로 다시 막는다.
 * 그래서 여기 한 줄이 두 화면(수리 건 상세 · 주간보고)의 답을 함께 정한다.
 *
 * 다섯 역할을 전부 적는 이유: 넷이 참이고 하나가 거짓이라, 표가 통째로 넓어지는
 * 실수(예: INVENTORY_MANAGER 에 필드를 하나 넣는 것)는 참만 세는 시험으로는
 * 잡히지 않는다.
 */
test("주간보고 비고는 INVENTORY_MANAGER 만 수정할 수 없다", () => {
  for (const role of ["SUPER_ADMIN", "ADMIN", "AS_ENGINEER", "SALES"] as const) {
    assert.equal(isFieldEditable(role, "notes"), true, `${role} 은 비고를 고칠 수 있다`);
  }
  assert.equal(isFieldEditable("INVENTORY_MANAGER", "notes"), false);

  // 화면이 실제로 보내는 모양 그대로 — FAULT_SERVICE 구간에 `notes` 키 하나다.
  // 이 한 칸만 보내는 부분 저장이 네 역할 모두에게 통과해야, 주간보고에서 누른
  // 저장이 신고 증상·담당 엔지니어를 건드리지 않고 끝난다.
  for (const role of ["SUPER_ADMIN", "ADMIN", "AS_ENGINEER", "SALES"] as const) {
    assert.deepEqual(authorizeSubmittedFields(role, "FAULT_SERVICE", ["notes"]), { ok: true });
  }
  assert.deepEqual(authorizeSubmittedFields("INVENTORY_MANAGER", "FAULT_SERVICE", ["notes"]), {
    ok: false,
    unauthorizedFields: ["notes"],
  });
});

test("보고서번호는 SUPER_ADMIN/ADMIN/AS_ENGINEER만 수정할 수 있다", () => {
  for (const role of ["SUPER_ADMIN", "ADMIN", "AS_ENGINEER"] as const) {
    assert.equal(isFieldEditable(role, "legacyReportNumber"), true);
  }
  // 보고서를 작성하는 역할이 아니다 — 접수 폼에서 적을 수는 있어도(접수 등록
  // 권한) 이후 수정 권한까지 자동으로 따라오지는 않는다.
  assert.equal(isFieldEditable("SALES", "legacyReportNumber"), false);
  assert.equal(isFieldEditable("INVENTORY_MANAGER", "legacyReportNumber"), false);
  assert.deepEqual(authorizeSubmittedFields("SALES", "INTAKE", ["legacyReportNumber"]), {
    ok: false,
    unauthorizedFields: ["legacyReportNumber"],
  });
});
