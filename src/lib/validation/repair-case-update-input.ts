import { isValidDateString } from "@/lib/domain/local/validation";
import { BILLING_TYPE_CODES, PRIORITY_CODES, type BillingType, type Priority } from "@/lib/domain/types";
import { WORKFLOW_REASSIGNMENT_KIND_CODES, type WorkflowKind } from "@/lib/domain/workflow-kind";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isValidRepairCaseId(value: unknown): value is string {
  return typeof value === "string" && UUID_PATTERN.test(value);
}

export function isValidExpectedVersion(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value > 0;
}

export const REPAIR_CASE_EDIT_SECTIONS = ["INTAKE", "PRODUCT", "FAULT_SERVICE"] as const;
export type RepairCaseEditSection = (typeof REPAIR_CASE_EDIT_SECTIONS)[number];

export function isValidRepairCaseEditSection(value: unknown): value is RepairCaseEditSection {
  return typeof value === "string" && (REPAIR_CASE_EDIT_SECTIONS as readonly string[]).includes(value);
}

/**
 * Structural "what fields exist per section" data — the single source of
 * truth both this file's per-section validators and
 * repair-case-edit-authorization.ts's role×field matrix are built from, so
 * the two can never drift apart.
 */
export const SECTION_FIELD_NAMES = {
  INTAKE: [
    "customerId",
    "newCustomerName",
    "endUserId",
    "newEndUserName",
    "receivedAt",
    "billingType",
    "priority",
    "customerRequestedDueDate",
    // 사내 목표 검수 완료일 — 인수정보/A/S 접수 일정 체크포인트부터 이
    // 섹션이 단독 소관이다(고장 및 서비스 정보에는 더 이상 없다).
    "internalTargetInspectionCompletionDate",
    "internalTargetShipmentDate",
    // 보고서번호 — A/S 접수 폼에서 수기로 받는 값이며, 접수 이후에는 상단
    // 요약 카드의 ReportNumberEditCell이 이 섹션으로 제출해 고친다(담당
    // 엔지니어가 FAULT_SERVICE 섹션으로 제출하는 것과 같은 구조). 인수 정보
    // 편집 폼에는 이 입력이 없다.
    "legacyReportNumber",
    "contactName",
    "contactPhone",
    "contactEmail",
  ],
  PRODUCT: [
    "productModelId",
    "newProductModelName",
    "lotNumber",
    "serialNumber",
    "workflowKind",
    "accessoryList",
    "externalConditionSummary",
    "reasonForRemoval",
  ],
  // 인수점검 결과/현재 진단·조치 요약/다음 예정 작업은 여기 없다 —
  // record_kind 분류 체크포인트부터 repair_case_work_records에서 결정론적
  //으로 파생되는 읽기 전용 값이며(getDerivedServiceSummaryForCase), 이
  // Server Action으로는 더 이상 제출되지 않는다(제출 시 "이 구역에서
  // 허용되지 않는 필드"로 거부됨 — Part Number 제거와 동일한 원칙). 레거시
  // repair_cases 컬럼 자체는 스키마/데이터 모두 그대로 보존된다.
  FAULT_SERVICE: [
    "reportedSymptom",
    "notes",
    "assignedEngineerId",
  ],
} as const satisfies Record<RepairCaseEditSection, readonly string[]>;

const MAX_SHORT_TEXT = 200;
const MAX_LONG_TEXT = 4000;

export type UpdateFieldValidationResult<T> =
  | { ok: true; data: T }
  | { ok: false; fieldErrors: Record<string, string> };

/**
 * Every validator below is a *partial* update: a key present in `raw` is
 * validated and included in `data`; a key absent from `raw` is left
 * completely untouched (the mutation layer never SETs a column whose key
 * wasn't submitted) — this is what lets e.g. SALES submit only `{ notes }`
 * under the FAULT_SERVICE section without needing to resend fields it has
 * no permission to touch. `raw` is expected to already be restricted to
 * this section's known field names and to keys the caller's role may edit —
 * both checked upstream by update-repair-case.ts before this runs; this
 * file only checks per-field *format*, never role or DB state.
 */

function normalizeShortText(
  raw: Record<string, unknown>,
  key: string,
  label: string,
  fieldErrors: Record<string, string>
): string | null | undefined {
  if (!(key in raw)) return undefined;
  const value = raw[key];
  if (value === null) return null;
  if (typeof value !== "string") {
    fieldErrors[key] = `${label} 값을 확인할 수 없습니다.`;
    return undefined;
  }
  const trimmed = value.trim();
  if (trimmed.length > MAX_SHORT_TEXT) {
    fieldErrors[key] = `${label}이(가) 너무 깁니다.`;
    return undefined;
  }
  return trimmed === "" ? null : trimmed;
}

function normalizeLongText(
  raw: Record<string, unknown>,
  key: string,
  label: string,
  fieldErrors: Record<string, string>
): string | null | undefined {
  if (!(key in raw)) return undefined;
  const value = raw[key];
  if (value === null) return null;
  if (typeof value !== "string") {
    fieldErrors[key] = `${label} 값을 확인할 수 없습니다.`;
    return undefined;
  }
  const trimmed = value.trim();
  if (trimmed.length > MAX_LONG_TEXT) {
    fieldErrors[key] = `${label} 내용이 너무 깁니다.`;
    return undefined;
  }
  return trimmed === "" ? null : trimmed;
}

function normalizeRequiredShortText(
  raw: Record<string, unknown>,
  key: string,
  label: string,
  fieldErrors: Record<string, string>
): string | undefined {
  if (!(key in raw)) return undefined;
  const value = raw[key];
  if (typeof value !== "string" || value.trim() === "") {
    fieldErrors[key] = `${label}을(를) 입력해 주세요.`;
    return undefined;
  }
  const trimmed = value.trim();
  if (trimmed.length > MAX_SHORT_TEXT) {
    fieldErrors[key] = `${label}이(가) 너무 깁니다.`;
    return undefined;
  }
  return trimmed;
}

function normalizeNullableDate(
  raw: Record<string, unknown>,
  key: string,
  label: string,
  fieldErrors: Record<string, string>
): string | null | undefined {
  if (!(key in raw)) return undefined;
  const value = raw[key];
  if (value === null || value === "") return null;
  if (!isValidDateString(value)) {
    fieldErrors[key] = `${label}을(를) 올바른 날짜로 입력해 주세요.`;
    return undefined;
  }
  return value;
}

function normalizeRequiredDate(
  raw: Record<string, unknown>,
  key: string,
  label: string,
  fieldErrors: Record<string, string>
): string | undefined {
  if (!(key in raw)) return undefined;
  const value = raw[key];
  if (!isValidDateString(value)) {
    fieldErrors[key] = `${label}을(를) 올바른 날짜로 입력해 주세요.`;
    return undefined;
  }
  return value;
}

// ---------------------------------------------------------------- INTAKE --

export type IntakeSectionUpdateFields = Partial<{
  customerId: string;
  /**
   * 고객사 자유 입력 등록 — customerId와 상호 배타적이다(동시에 둘 다
   * 제출되지 않는다; 편집 폼이 콤보박스 상태에서 정확히 하나만 채워
   * 보낸다). intake의 IntakeSubmissionInput.newCustomerName과 동일한
   * 원칙 — 매 키 입력마다 자동으로 새로 만들지 않고, "새 고객사로 등록"을
   * 명시적으로 눌렀을 때만 값이 채워진다.
   */
  newCustomerName: string;
  endUserId: string | null;
  /** customerId/newCustomerName과 같은 원칙 — End-User 버전. */
  newEndUserName: string;
  receivedAt: string;
  /**
   * 유상/무상 — 종류/워크플로 배정과 독립적이다(mutation layer가 재확인).
   * 인수정보가 이 값의 단일한 정상 편집 지점이다(제품 정보에는 더 이상
   * 없다). 값을 비워 다시 null로 되돌리는 옵션은 없다 — "선택 안 함"은
   * "제출하지 않음"과 같다(현재 값을 그대로 둔다).
   */
  billingType: BillingType;
  /**
   * 우선순위 — domain/types.ts의 PRIORITY_CODES를 그대로 재사용한다(별도
   * enum을 새로 만들지 않는다). NOT NULL 컬럼이라 billingType과 달리 "선택
   * 안 함"/미제출로 되돌리는 옵션이 없다 — 제출되면 항상 4개 코드 중 하나로
   * 확정된다.
   */
  priority: Priority;
  /**
   * 사내 목표 출하일 — 인수정보가 이 값의 단일한 정상 편집 지점이다(고장 및
   * 서비스 정보에는 더 이상 없다). 선택 입력이라 null로 지울 수 있다(고객
   * 요청 납기일과 같은 원칙).
   */
  internalTargetShipmentDate: string | null;
  /**
   * 사내 목표 검수 완료일 — 인수정보/A/S 접수 일정 체크포인트부터 이 섹션이
   * 단독 소관이다(고장 및 서비스 정보에는 더 이상 없다). 선택 입력이라
   * null로 지울 수 있다(사내 목표 출하일과 같은 원칙).
   */
  internalTargetInspectionCompletionDate: string | null;
  customerRequestedDueDate: string | null;
  /**
   * 보고서번호 — 자동 채번도, 형식 규칙도, 중복 검사도 없는 수기 입력값이다
   * (인수번호와 다르다). 선택 입력이라 빈 문자열을 제출하면 null로 지워진다
   * (연락처 필드들과 같은 원칙).
   */
  legacyReportNumber: string | null;
  contactName: string | null;
  contactPhone: string | null;
  contactEmail: string | null;
}>;

export function validateIntakeSectionFields(
  raw: Record<string, unknown>
): UpdateFieldValidationResult<IntakeSectionUpdateFields> {
  const fieldErrors: Record<string, string> = {};
  const data: IntakeSectionUpdateFields = {};

  const customerId = normalizeRequiredShortText(raw, "customerId", "고객사", fieldErrors);
  if (customerId !== undefined) data.customerId = customerId;

  if ("newCustomerName" in raw) {
    const value = raw.newCustomerName;
    if (typeof value !== "string" || value.trim() === "") {
      fieldErrors.customerId = "새 고객사명을 입력해 주세요.";
    } else {
      const trimmed = value.trim();
      if (trimmed.length > MAX_SHORT_TEXT) {
        fieldErrors.customerId = "고객사명이 너무 깁니다.";
      } else {
        data.newCustomerName = trimmed;
      }
    }
  }

  if ("endUserId" in raw) {
    const value = raw.endUserId;
    if (value === null || value === "") {
      data.endUserId = null;
    } else if (typeof value === "string") {
      data.endUserId = value.trim();
    } else {
      fieldErrors.endUserId = "End-User 값을 확인할 수 없습니다.";
    }
  }

  if ("newEndUserName" in raw) {
    const value = raw.newEndUserName;
    if (typeof value !== "string" || value.trim() === "") {
      fieldErrors.endUserId = "새 End-User명을 입력해 주세요.";
    } else {
      const trimmed = value.trim();
      if (trimmed.length > MAX_SHORT_TEXT) {
        fieldErrors.endUserId = "End-User명이 너무 깁니다.";
      } else {
        data.newEndUserName = trimmed;
      }
    }
  }

  const receivedAt = normalizeRequiredDate(raw, "receivedAt", "인수일", fieldErrors);
  if (receivedAt !== undefined) data.receivedAt = receivedAt;

  if ("billingType" in raw) {
    const value = raw.billingType;
    if (
      typeof value !== "string" ||
      !(BILLING_TYPE_CODES as readonly string[]).includes(value) ||
      value === "PENDING_DECISION"
    ) {
      fieldErrors.billingType = "유상/무상 값을 확인할 수 없습니다.";
    } else {
      data.billingType = value as BillingType;
    }
  }

  if ("priority" in raw) {
    const value = raw.priority;
    if (typeof value !== "string" || !(PRIORITY_CODES as readonly string[]).includes(value)) {
      fieldErrors.priority = "우선순위 값을 확인할 수 없습니다.";
    } else {
      data.priority = value as Priority;
    }
  }

  const customerRequestedDueDate = normalizeNullableDate(
    raw,
    "customerRequestedDueDate",
    "고객 요청 납기일",
    fieldErrors
  );
  if (customerRequestedDueDate !== undefined) data.customerRequestedDueDate = customerRequestedDueDate;

  const internalTargetShipmentDate = normalizeNullableDate(
    raw,
    "internalTargetShipmentDate",
    "사내 목표 출하일",
    fieldErrors
  );
  if (internalTargetShipmentDate !== undefined) data.internalTargetShipmentDate = internalTargetShipmentDate;

  const internalTargetInspectionCompletionDate = normalizeNullableDate(
    raw,
    "internalTargetInspectionCompletionDate",
    "사내 목표 검수 완료일",
    fieldErrors
  );
  if (internalTargetInspectionCompletionDate !== undefined) {
    data.internalTargetInspectionCompletionDate = internalTargetInspectionCompletionDate;
  }

  const legacyReportNumber = normalizeShortText(raw, "legacyReportNumber", "보고서번호", fieldErrors);
  if (legacyReportNumber !== undefined) data.legacyReportNumber = legacyReportNumber;

  const contactName = normalizeShortText(raw, "contactName", "담당자 성함", fieldErrors);
  if (contactName !== undefined) data.contactName = contactName;

  const contactPhone = normalizeShortText(raw, "contactPhone", "연락처", fieldErrors);
  if (contactPhone !== undefined) data.contactPhone = contactPhone;

  if ("contactEmail" in raw) {
    const value = raw.contactEmail;
    if (value === null || value === "") {
      data.contactEmail = null;
    } else if (typeof value !== "string") {
      fieldErrors.contactEmail = "이메일 값을 확인할 수 없습니다.";
    } else {
      const trimmed = value.trim();
      if (trimmed.length > MAX_SHORT_TEXT) {
        fieldErrors.contactEmail = "이메일이 너무 깁니다.";
      } else if (!trimmed.includes("@")) {
        fieldErrors.contactEmail = "올바른 이메일 형식이 아닙니다.";
      } else {
        data.contactEmail = trimmed;
      }
    }
  }

  if (Object.keys(fieldErrors).length > 0) return { ok: false, fieldErrors };
  return { ok: true, data };
}

// -------------------------------------------------------- ACTION RESULT --

export type UpdateRepairCaseActionResultCode =
  | "VALIDATION_ERROR"
  | "UNAUTHORIZED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "CONFLICT"
  | "REFERENCE_NOT_FOUND"
  | "REFERENCE_MISMATCH"
  | "ENGINEER_NOT_ALLOWED"
  | "DATABASE_UNAVAILABLE"
  | "WORKFLOW_REASSIGNMENT_NOT_ALLOWED"
  | "WORKFLOW_NOT_ALLOWED";

export type UpdateRepairCaseActionResult =
  | { ok: true; id: string; version: number }
  | {
      ok: false;
      code: UpdateRepairCaseActionResultCode;
      fieldErrors?: Record<string, string>;
      message: string;
    };

// --------------------------------------------------------------- PRODUCT --

export type ProductSectionUpdateFields = Partial<{
  /**
   * Product Model Master 선택 — 기존 product_models 행 재사용. Model 관련
   * 편집을 아예 하지 않으면 둘 다 제출되지 않고(제품 정보 편집 폼의 dirty
   * 체크), 이 경우 mutation layer가 현재 연결된 productModelId/modelName을
   * 그대로 유지한다.
   */
  productModelId: string;
  /** productModelId와 상호 배타적 — 새 Model 등록(SUPER_ADMIN/ADMIN만, 필드
   * 권한 매트릭스가 재확인한다). */
  newProductModelName: string;
  lotNumber: string;
  serialNumber: string;
  /**
   * 종류(매쳐/제너레이터) 재배정 요청 — DB 컬럼이 아니라 workflow-kind.ts의
   * deriveWorkflowType()을 거쳐 workflowVersionId/currentWorkflowStepId로
   * 변환되는 UI 전용 값이다. intake_inspection 단계 + 이력 없음일 때만
   * 허용된다(mutation layer에서 검사). 유상/무상은 더 이상 이 섹션에서
   * 제출되지 않는다(인수정보 섹션 소관) — GENERATOR로 재배정 시 mutation
   * layer가 현재 저장된 billing_type을 그대로 사용하며, 없으면 절대
   * 추측하지 않고 거부한다.
   */
  workflowKind: WorkflowKind;
  accessoryList: string | null;
  externalConditionSummary: string | null;
  reasonForRemoval: string | null;
}>;

export function validateProductSectionFields(
  raw: Record<string, unknown>
): UpdateFieldValidationResult<ProductSectionUpdateFields> {
  const fieldErrors: Record<string, string> = {};
  const data: ProductSectionUpdateFields = {};

  if ("productModelId" in raw) {
    const value = raw.productModelId;
    if (typeof value !== "string" || !UUID_PATTERN.test(value)) {
      fieldErrors.productModelId = "선택한 Model을 확인할 수 없습니다.";
    } else {
      data.productModelId = value;
    }
  }

  if ("newProductModelName" in raw) {
    const value = raw.newProductModelName;
    if (typeof value !== "string" || value.trim() === "") {
      fieldErrors.newProductModelName = "새 Model명을 입력해 주세요.";
    } else {
      const trimmed = value.trim();
      if (trimmed.length > MAX_SHORT_TEXT) {
        fieldErrors.newProductModelName = "Model명이 너무 깁니다.";
      } else {
        data.newProductModelName = trimmed;
      }
    }
  }

  const lotNumber = normalizeRequiredShortText(raw, "lotNumber", "L/N", fieldErrors);
  if (lotNumber !== undefined) data.lotNumber = lotNumber;

  const serialNumber = normalizeRequiredShortText(raw, "serialNumber", "S/N", fieldErrors);
  if (serialNumber !== undefined) data.serialNumber = serialNumber;

  if ("workflowKind" in raw) {
    const value = raw.workflowKind;
    if (typeof value !== "string" || !(WORKFLOW_REASSIGNMENT_KIND_CODES as readonly string[]).includes(value)) {
      fieldErrors.workflowKind = "종류 값을 확인할 수 없습니다.";
    } else {
      data.workflowKind = value as WorkflowKind;
    }
  }

  const productLongTextFields = [
    ["accessoryList", "동봉 액세서리"],
    ["externalConditionSummary", "외관 상태 요약"],
    ["reasonForRemoval", "탈거 사유"],
  ] as const;
  for (const [key, label] of productLongTextFields) {
    const value = normalizeLongText(raw, key, label, fieldErrors);
    if (value !== undefined) (data as Record<string, string | null>)[key] = value;
  }

  if (Object.keys(fieldErrors).length > 0) return { ok: false, fieldErrors };
  return { ok: true, data };
}

// ---------------------------------------------------------- FAULT_SERVICE --

export type FaultServiceSectionUpdateFields = Partial<{
  reportedSymptom: string | null;
  notes: string | null;
  /** 선택 입력이다 — 비워두면 null(미배정). */
  assignedEngineerId: string | null;
}>;

export function validateFaultServiceSectionFields(
  raw: Record<string, unknown>
): UpdateFieldValidationResult<FaultServiceSectionUpdateFields> {
  const fieldErrors: Record<string, string> = {};
  const data: FaultServiceSectionUpdateFields = {};

  const longTextFields = [
    ["reportedSymptom", "신고 증상"],
    ["notes", "비고"],
  ] as const;
  for (const [key, label] of longTextFields) {
    const value = normalizeLongText(raw, key, label, fieldErrors);
    if (value !== undefined) (data as Record<string, string | null>)[key] = value;
  }

  if ("assignedEngineerId" in raw) {
    const value = raw.assignedEngineerId;
    if (value === null || value === "") {
      data.assignedEngineerId = null;
    } else if (typeof value !== "string") {
      fieldErrors.assignedEngineerId = "담당 엔지니어 값을 확인할 수 없습니다.";
    } else {
      const trimmed = value.trim();
      if (trimmed.length > MAX_SHORT_TEXT) {
        fieldErrors.assignedEngineerId = "담당 엔지니어 값이 너무 깁니다.";
      } else {
        data.assignedEngineerId = trimmed;
      }
    }
  }

  if (Object.keys(fieldErrors).length > 0) return { ok: false, fieldErrors };
  return { ok: true, data };
}
