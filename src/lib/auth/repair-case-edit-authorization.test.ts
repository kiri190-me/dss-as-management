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
      // 우선순위 · 고객 요청 납기일 — 2026-10-23 에 담당 엔지니어에게 열렸다.
      // 차례는 SECTION_FIELD_NAMES.INTAKE 를 따른다(AS_ENGINEER_FIELDS 에 적은
      // 차례가 아니다) — editableFieldsForRoleInSection 이 섹션 목록을
      // filter 하기 때문이다.
      "priority",
      "customerRequestedDueDate",
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

test("AS_ENGINEER may not edit the rest of INTAKE (contact fields stay SALES-only — receivedAt/customerRequestedDueDate no longer do)", () => {
  // 고객 요청 납기일은 2026-10-23 에 담당 엔지니어에게 열렸으므로 이 목록에서
  // 빠졌다(인수일이 먼저 같은 길을 갔다). 남은 것은 연락처 세 칸뿐이다 —
  // 고객 쪽 연락 창구를 적는 자리라 영업의 칸으로 남긴다.
  for (const field of ["contactName", "contactPhone", "contactEmail"]) {
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

/**
 * 고객 요청 납기일 · 우선순위를 담당 엔지니어에게 연 변경(2026-10-23 사용자 결정).
 *
 * 다섯 역할 × 두 칸을 **한 표로** 단언한다. 참만 세는 시험은 "목록이 통째로
 * 넓어지는" 실수를 못 잡는다 — 이 표에서 거짓이어야 하는 두 칸(SALES 의
 * 우선순위, INVENTORY_MANAGER 의 두 칸)이 이번 변경이 옆으로 새지 않았다는
 * 증거다. 특히 SALES 의 우선순위는 **고객 요청 납기일과 한 줄 차이**라, 두 칸을
 * 같은 묶음으로 보고 한꺼번에 넣어 버리기 쉬운 자리다.
 *
 * 기대값을 변수로 적어 두 칸을 같은 자리에서 비교한다 — 한 칸만 고치고 다른
 * 칸을 잊는 일이 없게 한다.
 */
test("고객 요청 납기일은 영업과 담당 엔지니어 둘 다, 우선순위는 담당 엔지니어만 — 영업은 아니다", () => {
  const expected = [
    { role: "SUPER_ADMIN", customerRequestedDueDate: true, priority: true },
    { role: "ADMIN", customerRequestedDueDate: true, priority: true },
    // 2026-10-23 에 열린 쪽은 이 역할 하나뿐이다 — 두 칸 모두.
    { role: "AS_ENGINEER", customerRequestedDueDate: true, priority: true },
    // 🔴 납기일은 원래부터 있던 값이고, 우선순위는 **일부러 주지 않았다**.
    { role: "SALES", customerRequestedDueDate: true, priority: false },
    // 🔴 이 역할은 어느 칸도 고치지 못한다 — 이번 변경 전과 같다.
    { role: "INVENTORY_MANAGER", customerRequestedDueDate: false, priority: false },
  ] as const;
  const fields = ["customerRequestedDueDate", "priority"] as const;

  // 표본이 비어서 공짜로 통과하는 일이 없게 — 무엇을 재는지 먼저 단언한다.
  assert.equal(expected.length, 5, "다섯 역할을 모두 재야 한다");
  assert.equal(fields.length, 2, "두 칸을 모두 재야 한다");

  for (const row of expected) {
    for (const field of fields) {
      const allowed = row[field];
      assert.equal(
        isFieldEditable(row.role, field),
        allowed,
        `${row.role} 의 ${field} 은(는) ${allowed ? "고칠 수 있어야" : "막혀 있어야"} 한다`
      );
      // 화면이 아니라 서버가 보는 쪽 — 같은 표를 쓰는지 한 번 더 확인한다.
      assert.deepEqual(
        authorizeSubmittedFields(row.role, "INTAKE", [field]),
        allowed ? { ok: true } : { ok: false, unauthorizedFields: [field] },
        `${row.role} 가 ${field} 하나만 보낼 때의 판정`
      );
    }
  }
});

/**
 * 담당 엔지니어는 인수일도 고칠 수 있으므로(receivedAt), 이번 변경으로 **인수일과
 * 고객 요청 납기일을 한 번에 보내는 길**이 열렸다. 권한 표는 그 조합을 통과시켜야
 * 한다 — 두 칸의 앞뒤(납기일이 인수일보다 이를 수 없다)를 보는 것은 이 표가 아니라
 * updateRepairCase 이고, 그쪽은 이번 제출에 실린 인수일을 기준으로 잰다
 * (repair-cases-update.integration.test.ts 의 날짜 선후 시험).
 */
test("담당 엔지니어는 인수일 · 납기일 · 우선순위를 한 번에 제출할 수 있다", () => {
  assert.deepEqual(
    authorizeSubmittedFields("AS_ENGINEER", "INTAKE", [
      "receivedAt",
      "customerRequestedDueDate",
      "priority",
    ]),
    { ok: true }
  );

  // 같은 묶음에 연락처가 섞이면 요청 전체가 거부된다 — 이번에 열린 두 칸이
  // 나머지 칸까지 함께 통과시키지 않는다는 뜻이다.
  const withContact = authorizeSubmittedFields("AS_ENGINEER", "INTAKE", [
    "customerRequestedDueDate",
    "priority",
    "contactPhone",
  ]);
  assert.equal(withContact.ok, false);
  if (!withContact.ok) assert.deepEqual(withContact.unauthorizedFields, ["contactPhone"]);

  // 영업이 납기일에 우선순위를 얹어 보내면 **통째로** 거부된다. 납기일만 보낼
  // 때는 통과하므로, 거부의 까닭이 우선순위 하나임이 분명해야 한다.
  assert.deepEqual(authorizeSubmittedFields("SALES", "INTAKE", ["customerRequestedDueDate"]), {
    ok: true,
  });
  assert.deepEqual(
    authorizeSubmittedFields("SALES", "INTAKE", ["customerRequestedDueDate", "priority"]),
    { ok: false, unauthorizedFields: ["priority"] }
  );
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
