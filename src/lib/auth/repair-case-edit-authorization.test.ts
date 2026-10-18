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
      // 인수일 — 접수를 직접 다루는 역할이라 접수 후 수정 권한도 함께 준다
      // (SALES에는 원래부터 있던 값이고, 이번에 열린 쪽은 AS_ENGINEER 뿐).
      "receivedAt",
      "billingType",
      "internalTargetInspectionCompletionDate",
      "internalTargetShipmentDate",
      // 실제 출하일 — 출하 완료 처리를 누르는 역할이라 어긋난 날짜를 자기
      // 손으로 바로잡을 수 있다(SALES에는 주지 않았다). 여기 있다고 아무
      // 건에나 적을 수 있는 것은 아니다 — "이미 출하 완료된 건만"은 역할과
      // 무관한 조건이라 updateRepairCase가 DB 값을 보고 따로 막는다.
      "actualShipmentDate",
      // 보고서번호 — 접수 폼에서 이 역할이 직접 적는 값이라 접수 후 수정
      // 권한도 함께 준다(SALES에는 주지 않았다).
      "legacyReportNumber",
    ]
  );
});

test("AS_ENGINEER may not edit the rest of INTAKE (customerRequestedDueDate/contact fields stay SALES-only — receivedAt no longer does)", () => {
  for (const field of [
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

test("authorizeSubmittedFields: AS_ENGINEER submitting receivedAt within INTAKE is authorized (인수일 편집 개방)", () => {
  assert.deepEqual(authorizeSubmittedFields("AS_ENGINEER", "INTAKE", ["receivedAt"]), { ok: true });
});

test("authorizeSubmittedFields rejects a role submitting a field it cannot edit, even mixed with allowed ones", () => {
  // receivedAt 은 이제 허용, contactName 은 여전히 SALES 전용 — 한 칸이라도
  // 막히면 요청 전체가 거부된다.
  const result = authorizeSubmittedFields("AS_ENGINEER", "INTAKE", ["receivedAt", "contactName"]);
  assert.equal(result.ok, false);
  if (!result.ok) assert.deepEqual(result.unauthorizedFields, ["contactName"]);
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

/**
 * 인수일은 SALES 전용이었으나, 실제로 접수를 다루는 사람이 담당 엔지니어라
 * 자기 오기입을 고칠 수 있도록 AS_ENGINEER 에도 열었다. 이번에 바뀐 쪽은
 * AS_ENGINEER 하나뿐이다 — SALES 는 원래부터 있던 값이고, INVENTORY_MANAGER
 * 는 그대로 막혀 있어야 한다(표가 통째로 넓어지는 실수를 거짓 한 줄로 잡는다).
 */
test("인수일은 SALES뿐 아니라 담당 엔지니어도 수정할 수 있다", () => {
  for (const role of ["SUPER_ADMIN", "ADMIN", "AS_ENGINEER", "SALES"] as const) {
    assert.equal(isFieldEditable(role, "receivedAt"), true, `${role} 은 인수일을 고칠 수 있다`);
  }
  assert.equal(isFieldEditable("INVENTORY_MANAGER", "receivedAt"), false);
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

/**
 * 실제 출하일은 출하 완료 처리가 박아 놓고 아무도 못 고치던 값이었다. 물건이
 * 나간 날과 버튼을 누른 날이 어긋나면 틀린 날짜가 영구히 남으므로, 출하 완료
 * 처리를 실제로 누르는 역할(담당 엔지니어)에게 바로잡을 권한을 열었다.
 *
 * 다섯 역할을 전부 적는다 — 참만 세는 시험은 표가 통째로 넓어지는 실수를
 * 잡지 못한다. SALES 가 거짓인 것이 이 시험의 핵심이다(출하는 영업의 업무가
 * 아니다).
 *
 * ⚠️ 여기서 참이라고 아무 건에나 적을 수 있다는 뜻은 아니다 — "이미 출하
 * 완료된 건만"은 역할이 아니라 DB에 저장된 값이 정하는 조건이라 이 표가 아니라
 * updateRepairCase 가 막는다(repair-cases-update.integration.test.ts 55~58).
 */
test("실제 출하일은 SUPER_ADMIN/ADMIN/AS_ENGINEER만 수정할 수 있다 — SALES는 아니다", () => {
  for (const role of ["SUPER_ADMIN", "ADMIN", "AS_ENGINEER"] as const) {
    assert.equal(isFieldEditable(role, "actualShipmentDate"), true, `${role} 은 실제 출하일을 고칠 수 있다`);
  }
  assert.equal(isFieldEditable("SALES", "actualShipmentDate"), false);
  assert.equal(isFieldEditable("INVENTORY_MANAGER", "actualShipmentDate"), false);

  for (const role of ["SUPER_ADMIN", "ADMIN", "AS_ENGINEER"] as const) {
    assert.deepEqual(authorizeSubmittedFields(role, "INTAKE", ["actualShipmentDate"]), { ok: true });
  }
  for (const role of ["SALES", "INVENTORY_MANAGER"] as const) {
    assert.deepEqual(authorizeSubmittedFields(role, "INTAKE", ["actualShipmentDate"]), {
      ok: false,
      unauthorizedFields: ["actualShipmentDate"],
    });
  }
});
