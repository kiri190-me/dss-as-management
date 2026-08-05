import { WORKFLOW_TYPE_CODES, type WorkflowType } from "@/lib/domain/types";
import { isNotEarlierThan, isValidDateString } from "@/lib/domain/local/validation";
import type { IntakeSubmissionInput } from "@/lib/domain/local/submit-intake";

/**
 * Pure, DB-free, React-free validation for database-backed repair-case
 * creation. Reuses the existing IntakeSubmissionInput shape (the same
 * object IntakeFormInner.tsx already builds for the local/localStorage
 * path) and the existing isValidDateString/isNotEarlierThan pure helpers
 * (src/lib/domain/local/validation.ts) rather than duplicating date logic.
 *
 * `priority` is accepted on the input (IntakeSubmissionInput carries it,
 * used by the local path) but intentionally not part of the validated
 * output — repair_cases has no priority column (Stage G-2 decision,
 * mapRepairCaseRow always uses a fixed "NORMAL" placeholder on read).
 */
export type ValidatedCreateRepairCaseInput = {
  workflowType: WorkflowType;
  customerId: string;
  endUserId: string | null;
  assignedEngineerId: string;
  receivedAt: string;
  customerRequestedDueDate: string | null;
  internalTargetShipmentDate: string;
  modelName: string;
  lotNumber: string;
  serialNumber: string;
  partNumber: string | null;
  accessoryList: string | null;
  externalConditionSummary: string | null;
  reasonForRemoval: string | null;
  reportedSymptom: string | null;
  intakeInspectionResult: string | null;
  currentDiagnosisSummary: string | null;
  nextPlannedAction: string | null;
  notes: string | null;
  contactName: string | null;
  contactPhone: string | null;
  contactEmail: string | null;
};

export type CreateRepairCaseResultCode =
  | "VALIDATION_ERROR"
  | "UNAUTHORIZED"
  | "FORBIDDEN"
  | "REFERENCE_NOT_FOUND"
  | "REFERENCE_MISMATCH"
  | "ENGINEER_NOT_ALLOWED"
  | "WORKFLOW_NOT_ALLOWED"
  | "INTAKE_SEQUENCE_EXHAUSTED"
  | "CONFLICT"
  | "DATABASE_UNAVAILABLE"
  // The same idempotency key is still being processed by an earlier,
  // not-yet-resolved request — the caller must not retry immediately.
  | "SUBMISSION_IN_PROGRESS";

export type CreateRepairCaseResult =
  | { ok: true; id: string; intakeNumber: string }
  | {
      ok: false;
      code: CreateRepairCaseResultCode;
      fieldErrors?: Record<string, string>;
      message: string;
    };

export type FieldValidationResult =
  | { ok: true; data: ValidatedCreateRepairCaseInput }
  | { ok: false; fieldErrors: Record<string, string> };

const MAX_SHORT_TEXT = 200;
const MAX_LONG_TEXT = 4000;

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Idempotency keys are opaque, client-generated crypto.randomUUID() values
 * (src/lib/domain/local/intake-idempotency-key.ts) — this only checks shape
 * (any RFC 4122 UUID), never derives or infers a key from business fields.
 */
export function isValidIdempotencyKey(value: unknown): value is string {
  return typeof value === "string" && UUID_PATTERN.test(value);
}

function trimToNull(value: string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

const LONG_TEXT_FIELDS: ReadonlyArray<{
  key: keyof Pick<
    IntakeSubmissionInput,
    | "accessoryList"
    | "externalConditionSummary"
    | "reasonForRemoval"
    | "reportedSymptom"
    | "intakeInspectionResult"
    | "currentDiagnosisSummary"
    | "nextPlannedAction"
    | "notes"
  >;
  label: string;
}> = [
  { key: "accessoryList", label: "동봉 액세서리" },
  { key: "externalConditionSummary", label: "외관 상태 요약" },
  { key: "reasonForRemoval", label: "탈거 사유" },
  { key: "reportedSymptom", label: "신고 증상" },
  { key: "intakeInspectionResult", label: "인수점검 결과" },
  { key: "currentDiagnosisSummary", label: "현재 진단/조치 요약" },
  { key: "nextPlannedAction", label: "다음 예정 작업" },
  { key: "notes", label: "비고" },
];

/**
 * Server-side re-validation of the intake input — never trusts that the
 * client's own validateDraft() already ran. Mirrors that function's rules
 * exactly (same required fields, same date-ordering rules) plus adds
 * length bounds and blank-to-null normalization that the client layer
 * doesn't need (localStorage has no column-length constraint to mirror).
 */
export function validateCreateRepairCaseInput(
  input: IntakeSubmissionInput
): FieldValidationResult {
  const fieldErrors: Record<string, string> = {};

  if (!(WORKFLOW_TYPE_CODES as readonly string[]).includes(input.workflowType)) {
    fieldErrors.workflowType = "워크플로 유형을 확인해 주세요.";
  }

  const customerId = trimToNull(input.customerId);
  if (!customerId) {
    fieldErrors.customerId = "고객사를 선택해 주세요.";
  }

  const endUserId = trimToNull(input.endUserId);

  const assignedEngineerId = trimToNull(input.assignedEngineerId);
  if (!assignedEngineerId) {
    fieldErrors.assignedEngineerId = "담당 엔지니어를 선택해 주세요.";
  }

  if (!isValidDateString(input.receivedAt)) {
    fieldErrors.receivedAt = "인수일을 올바른 날짜로 입력해 주세요.";
  }

  if (!input.internalTargetShipmentDate || !isValidDateString(input.internalTargetShipmentDate)) {
    fieldErrors.internalTargetShipmentDate = "사내 목표 출하일을 올바른 날짜로 입력해 주세요.";
  } else if (
    isValidDateString(input.receivedAt) &&
    !isNotEarlierThan(input.internalTargetShipmentDate, input.receivedAt)
  ) {
    fieldErrors.internalTargetShipmentDate = "사내 목표 출하일은 인수일보다 이전일 수 없습니다.";
  }

  const customerRequestedDueDate = trimToNull(input.customerRequestedDueDate);
  if (customerRequestedDueDate) {
    if (!isValidDateString(customerRequestedDueDate)) {
      fieldErrors.customerRequestedDueDate = "고객 요청 납기일을 올바른 날짜로 입력해 주세요.";
    } else if (
      isValidDateString(input.receivedAt) &&
      !isNotEarlierThan(customerRequestedDueDate, input.receivedAt)
    ) {
      fieldErrors.customerRequestedDueDate = "고객 요청 납기일은 인수일보다 이전일 수 없습니다.";
    }
  }

  const modelName = trimToNull(input.modelName);
  if (!modelName) fieldErrors.modelName = "Model을 입력해 주세요.";
  else if (modelName.length > MAX_SHORT_TEXT) fieldErrors.modelName = "Model이 너무 깁니다.";

  const lotNumber = trimToNull(input.lotNumber);
  if (!lotNumber) fieldErrors.lotNumber = "L/N을 입력해 주세요.";
  else if (lotNumber.length > MAX_SHORT_TEXT) fieldErrors.lotNumber = "L/N이 너무 깁니다.";

  const serialNumber = trimToNull(input.serialNumber);
  if (!serialNumber) fieldErrors.serialNumber = "S/N을 입력해 주세요.";
  else if (serialNumber.length > MAX_SHORT_TEXT) fieldErrors.serialNumber = "S/N이 너무 깁니다.";

  const partNumber = trimToNull(input.partNumber);
  if (partNumber && partNumber.length > MAX_SHORT_TEXT) {
    fieldErrors.partNumber = "Part Number가 너무 깁니다.";
  }

  const normalizedLongText = {} as Record<(typeof LONG_TEXT_FIELDS)[number]["key"], string | null>;
  for (const { key, label } of LONG_TEXT_FIELDS) {
    const value = trimToNull(input[key]);
    if (value && value.length > MAX_LONG_TEXT) {
      fieldErrors[key] = `${label} 내용이 너무 깁니다.`;
    }
    normalizedLongText[key] = value;
  }

  const contactName = trimToNull(input.contactName);
  const contactPhone = trimToNull(input.contactPhone);
  const contactEmail = trimToNull(input.contactEmail);
  if (contactName && contactName.length > MAX_SHORT_TEXT) {
    fieldErrors.contactName = "담당자 성함이 너무 깁니다.";
  }
  if (contactPhone && contactPhone.length > MAX_SHORT_TEXT) {
    fieldErrors.contactPhone = "연락처가 너무 깁니다.";
  }
  if (contactEmail) {
    if (contactEmail.length > MAX_SHORT_TEXT) {
      fieldErrors.contactEmail = "이메일이 너무 깁니다.";
    } else if (!contactEmail.includes("@")) {
      fieldErrors.contactEmail = "올바른 이메일 형식이 아닙니다.";
    }
  }

  if (Object.keys(fieldErrors).length > 0) {
    return { ok: false, fieldErrors };
  }

  return {
    ok: true,
    data: {
      workflowType: input.workflowType,
      customerId: customerId!,
      endUserId,
      assignedEngineerId: assignedEngineerId!,
      receivedAt: input.receivedAt,
      customerRequestedDueDate,
      internalTargetShipmentDate: input.internalTargetShipmentDate,
      modelName: modelName!,
      lotNumber: lotNumber!,
      serialNumber: serialNumber!,
      partNumber,
      accessoryList: normalizedLongText.accessoryList,
      externalConditionSummary: normalizedLongText.externalConditionSummary,
      reasonForRemoval: normalizedLongText.reasonForRemoval,
      reportedSymptom: normalizedLongText.reportedSymptom,
      intakeInspectionResult: normalizedLongText.intakeInspectionResult,
      currentDiagnosisSummary: normalizedLongText.currentDiagnosisSummary,
      nextPlannedAction: normalizedLongText.nextPlannedAction,
      notes: normalizedLongText.notes,
      contactName,
      contactPhone,
      contactEmail,
    },
  };
}
