import {
  BILLING_TYPE_CODES,
  MANUAL_INTAKE_BILLING_TYPE_CODES,
  NEW_INTAKE_WORKFLOW_TYPE_CODES,
  PENDING_BILLING_WORKFLOW_TYPE_CODES,
  type BillingType,
  type WorkflowType,
} from "@/lib/domain/types";
import { isNotEarlierThan, isValidDateString } from "@/lib/domain/local/validation";
import { isValidIntakeNumberFormat } from "@/lib/domain/local/intake-number";
import type { IntakeSubmissionInput } from "@/lib/domain/local/submit-intake";
import { deriveWorkflowType, workflowKindOf } from "@/lib/domain/workflow-kind";

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
  /** 유상/무상 — workflowType과 독립된 필수 값이다(migration 0021). */
  billingType: BillingType;
  /**
   * 고객사 해석 — customerId(기존 재사용)와 newCustomerName(자유 입력으로
   * 새로 명시 등록)은 상호 배타적이다. 둘 다 optional인 이유는 이 타입을
   * 직접 만드는 기존 호출부(통합 테스트 등)가 영향을 받지 않게 하기
   * 위함이다 — 실제로는 이 함수를 거치면 항상 둘 중 하나만 채워진다.
   */
  customerId: string | null;
  newCustomerName?: string | null;
  endUserId: string | null;
  newEndUserName?: string | null;
  assignedEngineerId: string | null;
  receivedAt: string;
  customerRequestedDueDate: string | null;
  internalTargetShipmentDate: string | null;
  /**
   * 사내 목표 검수 완료일 — A/S 접수 일정 체크포인트부터 [일정] 섹션에서
   * 직접 입력받는다(기본값 = 인수일 + 14일, 클라이언트의 draft가 계산해
   * 보낸다 — 여기서는 재계산하지 않고 제출된 값만 형식/순서 검증한다).
   * Optional인 이유는 다른 optional 필드들과 같다 — 이 타입을 직접 만드는
   * 기존 호출부(통합 테스트 등)가 영향을 받지 않게 하기 위함이다.
   */
  internalTargetInspectionCompletionDate?: string | null;
  /** Manual 인수번호 override, already format-validated here; omitted/null means "use the existing auto-generator." Optional so existing call sites that build this type directly (integration tests, etc.) are unaffected. */
  intakeNumber?: string | null;
  /**
   * 보고서번호 — 사람이 직접 적는 선택 입력값이며, 인수번호와 달리 자동
   * 채번 규칙이 없다(형식 검사도, 중복 검사도 하지 않는다 — 길이만 본다).
   * repair_cases.legacy_report_number 컬럼에 그대로 저장된다. Optional인
   * 이유는 intakeNumber와 같다.
   */
  legacyReportNumber?: string | null;
  modelName: string;
  /**
   * Product Model Master 연결 체크포인트 — customerId/newCustomerName과
   * 같은 원칙으로 상호 배타적이다. Optional인 이유도 같다: 이 타입을 직접
   * 만드는 기존 호출부(통합 테스트 등, resolveProduct를 레거시 자유 입력
   * modelName만으로 호출)가 영향을 받지 않게 하기 위함이다 — 실제로
   * validateCreateRepairCaseInput을 거치면(DB 모드 A/S 접수) 항상 둘 중
   * 하나가 채워진다.
   */
  productModelId?: string | null;
  newProductModelName?: string | null;
  lotNumber: string;
  serialNumber: string;
  partNumber: string | null;
  accessoryList: string | null;
  externalConditionSummary: string | null;
  reasonForRemoval: string | null;
  reportedSymptom: string | null;
  /**
   * record_kind 분류 체크포인트부터 A/S 접수 폼이 더 이상 이 3개 필드를
   * 받지 않는다 — validateCreateRepairCaseInput은 client가 무엇을 보내든
   * 이 값들을 절대 읽지 않으며, 반환되는 data에도 포함하지 않는다. Optional
   * 로만 남겨둔 이유는 이 타입을 직접 만드는 기존 호출부(통합 테스트 등)가
   * 영향을 받지 않게 하기 위함이다 — 실제로 이 함수를 거치면 항상 undefined
   * 다. 신규 접수 건은 이 컬럼들이 NULL로 남는다(레거시 히스토리 전용
   * 컬럼 — DB 컬럼 자체는 그대로 보존).
   */
  intakeInspectionResult?: string | null;
  currentDiagnosisSummary?: string | null;
  nextPlannedAction?: string | null;
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
  | "INTAKE_NUMBER_DUPLICATE"
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

/**
 * intakeInspectionResult/currentDiagnosisSummary/nextPlannedAction are
 * deliberately absent — record_kind 분류 체크포인트부터 이 3개 필드는 A/S
 * 접수에서 더 이상 입력받지 않는다(고장 및 서비스 정보 페이지가
 * repair_case_work_records에서만 파생한다). Client가 이 키들을 보내더라도
 * 여기서 절대 읽지 않는다.
 */
const LONG_TEXT_FIELDS: ReadonlyArray<{
  key: keyof Pick<
    IntakeSubmissionInput,
    | "accessoryList"
    | "externalConditionSummary"
    | "reasonForRemoval"
    | "reportedSymptom"
    | "notes"
  >;
  label: string;
}> = [
  { key: "accessoryList", label: "동봉 액세서리" },
  { key: "externalConditionSummary", label: "외관 상태 요약" },
  { key: "reasonForRemoval", label: "탈거 사유" },
  { key: "reportedSymptom", label: "신고 증상" },
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
  input: IntakeSubmissionInput,
  options: { allowPendingBilling?: boolean } = {}
): FieldValidationResult {
  const fieldErrors: Record<string, string> = {};
  const allowedWorkflowTypes = options.allowPendingBilling
    ? [...NEW_INTAKE_WORKFLOW_TYPE_CODES, ...PENDING_BILLING_WORKFLOW_TYPE_CODES]
    : NEW_INTAKE_WORKFLOW_TYPE_CODES;

  if (!(allowedWorkflowTypes as readonly string[]).includes(input.workflowType)) {
    fieldErrors.workflowType = "워크플로 유형을 확인해 주세요.";
  }

  if (!(BILLING_TYPE_CODES as readonly string[]).includes(input.billingType)) {
    fieldErrors.billingType = "유상/무상을 선택해 주세요.";
  } else if (
    input.billingType === "PENDING_DECISION" &&
    !options.allowPendingBilling
  ) {
    fieldErrors.billingType = "일반 신규 접수에서는 추후결정을 선택할 수 없습니다.";
  } else if (
    ((MANUAL_INTAKE_BILLING_TYPE_CODES as readonly string[]).includes(input.billingType) ||
      input.billingType === "PENDING_DECISION") &&
    deriveWorkflowType(workflowKindOf(input.workflowType), input.billingType) !== input.workflowType
  ) {
    fieldErrors.workflowType = "제품 종류와 유상/무상에 맞는 워크플로를 선택해 주세요.";
  }

  const customerId = trimToNull(input.customerId);
  const newCustomerName = trimToNull(input.newCustomerName);
  if (!customerId && !newCustomerName) {
    fieldErrors.customerId = "고객사를 선택하거나 새로 등록해 주세요.";
  } else if (newCustomerName && newCustomerName.length > MAX_SHORT_TEXT) {
    fieldErrors.customerId = "고객사명이 너무 깁니다.";
  }

  const endUserId = trimToNull(input.endUserId);
  const newEndUserName = trimToNull(input.newEndUserName);
  if (newEndUserName && newEndUserName.length > MAX_SHORT_TEXT) {
    fieldErrors.endUserId = "End-User명이 너무 깁니다.";
  }

  const assignedEngineerId = trimToNull(input.assignedEngineerId);

  if (!isValidDateString(input.receivedAt)) {
    fieldErrors.receivedAt = "인수일을 올바른 날짜로 입력해 주세요.";
  }

  const internalTargetShipmentDate = trimToNull(input.internalTargetShipmentDate);
  if (internalTargetShipmentDate) {
    if (!isValidDateString(internalTargetShipmentDate)) {
      fieldErrors.internalTargetShipmentDate = "사내 목표 출하일을 올바른 날짜로 입력해 주세요.";
    } else if (
      isValidDateString(input.receivedAt) &&
      !isNotEarlierThan(internalTargetShipmentDate, input.receivedAt)
    ) {
      fieldErrors.internalTargetShipmentDate = "사내 목표 출하일은 인수일보다 이전일 수 없습니다.";
    }
  }

  const internalTargetInspectionCompletionDate = trimToNull(input.internalTargetInspectionCompletionDate);
  if (internalTargetInspectionCompletionDate) {
    if (!isValidDateString(internalTargetInspectionCompletionDate)) {
      fieldErrors.internalTargetInspectionCompletionDate = "사내 목표 검수 완료일을 올바른 날짜로 입력해 주세요.";
    } else if (
      isValidDateString(input.receivedAt) &&
      !isNotEarlierThan(internalTargetInspectionCompletionDate, input.receivedAt)
    ) {
      fieldErrors.internalTargetInspectionCompletionDate = "사내 목표 검수 완료일은 인수일보다 이전일 수 없습니다.";
    }
  }

  const intakeNumber = trimToNull(input.intakeNumber);
  if (intakeNumber && !isValidIntakeNumberFormat(intakeNumber)) {
    fieldErrors.intakeNumber = "인수번호 형식이 올바르지 않습니다. (예: D260601)";
  }

  // 보고서번호는 인수번호와 달리 자동 채번 대상이 아니다 — 형식/중복 규칙이
  // 존재하지 않으므로 여기서도 검사하지 않는다. 다른 짧은 자유 입력 필드들과
  // 똑같이 길이만 확인하고, 빈 값은 null로 정규화한다.
  const legacyReportNumber = trimToNull(input.legacyReportNumber);
  if (legacyReportNumber && legacyReportNumber.length > MAX_SHORT_TEXT) {
    fieldErrors.legacyReportNumber = "보고서번호가 너무 깁니다.";
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

  // Product Model Master 연결 — productModelId(기존 Model 선택)와
  // newProductModelName(새 Model 등록, SUPER_ADMIN/ADMIN만 create-repair-
  // case.ts에서 허용)은 상호 배타적이며 DB 모드 A/S 접수에서는 항상 둘 중
  // 하나가 필요하다. modelName 자체는 위에서 이미 검증된 표시용 텍스트로
  // 계속 남지만, 실제 products.model_name 스냅샷은 mutation layer가
  // productModelId/newProductModelName으로부터 마스터의 현재 이름을 다시
  // 조회해 결정한다(클라이언트 텍스트를 그대로 신뢰하지 않는다).
  const productModelId = trimToNull(input.productModelId ?? null);
  const newProductModelName = trimToNull(input.newProductModelName ?? null);
  if (!productModelId && !newProductModelName) {
    fieldErrors.modelName = fieldErrors.modelName || "Model을 선택하거나 새로 등록해 주세요.";
  } else if (productModelId && !UUID_PATTERN.test(productModelId)) {
    fieldErrors.modelName = "선택한 Model을 확인할 수 없습니다.";
  } else if (newProductModelName && newProductModelName.length > MAX_SHORT_TEXT) {
    fieldErrors.modelName = "Model명이 너무 깁니다.";
  }

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
      billingType: input.billingType,
      customerId,
      newCustomerName,
      endUserId,
      newEndUserName,
      assignedEngineerId,
      receivedAt: input.receivedAt,
      customerRequestedDueDate,
      internalTargetShipmentDate,
      internalTargetInspectionCompletionDate,
      intakeNumber,
      legacyReportNumber,
      modelName: modelName!,
      productModelId,
      newProductModelName,
      lotNumber: lotNumber!,
      serialNumber: serialNumber!,
      partNumber,
      accessoryList: normalizedLongText.accessoryList,
      externalConditionSummary: normalizedLongText.externalConditionSummary,
      reasonForRemoval: normalizedLongText.reasonForRemoval,
      reportedSymptom: normalizedLongText.reportedSymptom,
      notes: normalizedLongText.notes,
      contactName,
      contactPhone,
      contactEmail,
    },
  };
}
