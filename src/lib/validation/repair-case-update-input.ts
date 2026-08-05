import { isValidDateString } from "@/lib/domain/local/validation";

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
    "endUserId",
    "receivedAt",
    "customerRequestedDueDate",
    "contactName",
    "contactPhone",
    "contactEmail",
  ],
  PRODUCT: ["modelName", "lotNumber", "serialNumber", "partNumber"],
  FAULT_SERVICE: [
    "reportedSymptom",
    "intakeInspectionResult",
    "currentDiagnosisSummary",
    "nextPlannedAction",
    "accessoryList",
    "externalConditionSummary",
    "reasonForRemoval",
    "notes",
    "assignedEngineerId",
    "internalTargetInspectionCompletionDate",
    "internalTargetShipmentDate",
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
  endUserId: string | null;
  receivedAt: string;
  customerRequestedDueDate: string | null;
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

  const receivedAt = normalizeRequiredDate(raw, "receivedAt", "인수일", fieldErrors);
  if (receivedAt !== undefined) data.receivedAt = receivedAt;

  const customerRequestedDueDate = normalizeNullableDate(
    raw,
    "customerRequestedDueDate",
    "고객 요청 납기일",
    fieldErrors
  );
  if (customerRequestedDueDate !== undefined) data.customerRequestedDueDate = customerRequestedDueDate;

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
  | "DATABASE_UNAVAILABLE";

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
  modelName: string;
  lotNumber: string;
  serialNumber: string;
  partNumber: string | null;
}>;

export function validateProductSectionFields(
  raw: Record<string, unknown>
): UpdateFieldValidationResult<ProductSectionUpdateFields> {
  const fieldErrors: Record<string, string> = {};
  const data: ProductSectionUpdateFields = {};

  const modelName = normalizeRequiredShortText(raw, "modelName", "Model", fieldErrors);
  if (modelName !== undefined) data.modelName = modelName;

  const lotNumber = normalizeRequiredShortText(raw, "lotNumber", "L/N", fieldErrors);
  if (lotNumber !== undefined) data.lotNumber = lotNumber;

  const serialNumber = normalizeRequiredShortText(raw, "serialNumber", "S/N", fieldErrors);
  if (serialNumber !== undefined) data.serialNumber = serialNumber;

  const partNumber = normalizeShortText(raw, "partNumber", "Part Number", fieldErrors);
  if (partNumber !== undefined) data.partNumber = partNumber;

  if (Object.keys(fieldErrors).length > 0) return { ok: false, fieldErrors };
  return { ok: true, data };
}

// ---------------------------------------------------------- FAULT_SERVICE --

export type FaultServiceSectionUpdateFields = Partial<{
  reportedSymptom: string | null;
  intakeInspectionResult: string | null;
  currentDiagnosisSummary: string | null;
  nextPlannedAction: string | null;
  accessoryList: string | null;
  externalConditionSummary: string | null;
  reasonForRemoval: string | null;
  notes: string | null;
  assignedEngineerId: string;
  internalTargetInspectionCompletionDate: string | null;
  internalTargetShipmentDate: string;
}>;

export function validateFaultServiceSectionFields(
  raw: Record<string, unknown>
): UpdateFieldValidationResult<FaultServiceSectionUpdateFields> {
  const fieldErrors: Record<string, string> = {};
  const data: FaultServiceSectionUpdateFields = {};

  const longTextFields = [
    ["reportedSymptom", "신고 증상"],
    ["intakeInspectionResult", "인수점검 결과"],
    ["currentDiagnosisSummary", "현재 진단/조치 요약"],
    ["nextPlannedAction", "다음 예정 작업"],
    ["accessoryList", "동봉 액세서리"],
    ["externalConditionSummary", "외관 상태 요약"],
    ["reasonForRemoval", "탈거 사유"],
    ["notes", "비고"],
  ] as const;
  for (const [key, label] of longTextFields) {
    const value = normalizeLongText(raw, key, label, fieldErrors);
    if (value !== undefined) (data as Record<string, string | null>)[key] = value;
  }

  const assignedEngineerId = normalizeRequiredShortText(
    raw,
    "assignedEngineerId",
    "담당 엔지니어",
    fieldErrors
  );
  if (assignedEngineerId !== undefined) data.assignedEngineerId = assignedEngineerId;

  const internalTargetInspectionCompletionDate = normalizeNullableDate(
    raw,
    "internalTargetInspectionCompletionDate",
    "사내 목표 검수완료일",
    fieldErrors
  );
  if (internalTargetInspectionCompletionDate !== undefined) {
    data.internalTargetInspectionCompletionDate = internalTargetInspectionCompletionDate;
  }

  const internalTargetShipmentDate = normalizeRequiredDate(
    raw,
    "internalTargetShipmentDate",
    "사내 목표 출하일",
    fieldErrors
  );
  if (internalTargetShipmentDate !== undefined) data.internalTargetShipmentDate = internalTargetShipmentDate;

  if (Object.keys(fieldErrors).length > 0) return { ok: false, fieldErrors };
  return { ok: true, data };
}
