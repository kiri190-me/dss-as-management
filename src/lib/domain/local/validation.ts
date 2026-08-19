import {
  BILLING_TYPE_CODES,
  PRIORITY_CODES,
  REPAIR_STATUS_CODES,
  WORKFLOW_TYPE_CODES,
  type BillingType,
  type Priority,
  type RepairStatus,
  type WorkflowType,
} from "../types";
import { mockCustomers, mockEndUsers, mockUsers, workflowSteps } from "../mock-data";
import {
  isLocalCustomerId,
  isLocalEndUserId,
  isLocalId,
  localCustomerId,
  localEndUserId,
  type LocalRepairCase,
} from "./local-types";

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export function isNonEmptyTrimmedString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

export function isNullableTrimmedString(value: unknown): value is string | null {
  return value === null || (typeof value === "string" && value === value.trim());
}

/** "YYYY-MM-DD" 형식이면서 실제 존재하는 달력 날짜인지까지 확인한다. */
export function isValidDateString(value: unknown): value is string {
  if (typeof value !== "string" || !DATE_PATTERN.test(value)) {
    return false;
  }
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}

export function isValidIsoDateTimeString(value: unknown): value is string {
  return typeof value === "string" && !Number.isNaN(Date.parse(value));
}

/** a가 b보다 이전 날짜가 아니면(같거나 이후) true. 둘 다 유효한 날짜 문자열이어야 한다. */
export function isNotEarlierThan(a: string, b: string): boolean {
  return a >= b;
}

function isOneOf<T extends string>(value: unknown, codes: readonly T[]): value is T {
  return typeof value === "string" && (codes as readonly string[]).includes(value);
}

/**
 * localStorage에서 읽은 값(unknown)을 검증하여 안전한 LocalRepairCase로
 * 변환한다. 관계/보안에 민감한 값(고객ID, End-User 소속, 담당 엔지니어 자격,
 * 워크플로 단계, 상태)은 다른 값으로 "보정"하지 않고, 하나라도 어긋나면
 * 레코드 전체를 버린다(null 반환) — 잘못된 관계를 조용히 다른 정체성으로
 * 바꿔치기하지 않기 위함이다.
 */
export function validateLocalRepairCase(raw: unknown): LocalRepairCase | null {
  if (typeof raw !== "object" || raw === null) return null;
  const r = raw as Record<string, unknown>;

  if (!isNonEmptyTrimmedString(r.id) || !isLocalId(r.id)) return null;
  if (!isNonEmptyTrimmedString(r.intakeNumber)) return null;
  if (!isOneOf<WorkflowType>(r.workflowType, WORKFLOW_TYPE_CODES)) return null;
  if (!isOneOf<BillingType>(r.billingType, BILLING_TYPE_CODES)) return null;
  // 이 스테이지에서 로컬로 생성되는 건은 항상 인수점검 대기 상태여야 한다.
  if (!isOneOf<RepairStatus>(r.status, REPAIR_STATUS_CODES)) return null;
  if (r.status !== "WAITING_INTAKE_INSPECTION") return null;
  if (!isOneOf<Priority>(r.priority, PRIORITY_CODES)) return null;
  if (!isNonEmptyTrimmedString(r.currentWorkflowStepKey)) return null;
  const stepExists = workflowSteps.some(
    (step) => step.workflowType === r.workflowType && step.key === r.currentWorkflowStepKey
  );
  if (!stepExists) return null;

  if (!isValidDateString(r.receivedAt)) return null;
  if (r.customerRequestedDueDate !== null && !isValidDateString(r.customerRequestedDueDate)) {
    return null;
  }
  if (
    typeof r.customerRequestedDueDate === "string" &&
    !isNotEarlierThan(r.customerRequestedDueDate, r.receivedAt as string)
  ) {
    return null;
  }
  if (r.internalTargetShipmentDate !== null && !isValidDateString(r.internalTargetShipmentDate)) {
    return null;
  }
  if (
    typeof r.internalTargetShipmentDate === "string" &&
    !isNotEarlierThan(r.internalTargetShipmentDate, r.receivedAt as string)
  ) {
    return null;
  }
  if (r.actualShipmentDate !== null) return null;
  if (r.exceptionStatus !== null) return null;
  if (!isValidIsoDateTimeString(r.createdAt)) return null;

  if (!isNonEmptyTrimmedString(r.customerId)) return null;
  if (!isNonEmptyTrimmedString(r.customerNameSnapshot)) return null;
  if (isLocalCustomerId(r.customerId)) {
    // 새로 등록된(자유 입력) 고객사 — ID가 스냅샷 이름으로부터 정확히
    // 유도된 형태인지만 확인한다(모의 목록에는 당연히 없다).
    if (r.customerId !== localCustomerId(r.customerNameSnapshot)) return null;
  } else {
    const customer = mockCustomers.find((c) => c.id === r.customerId);
    if (!customer) return null;
  }

  if (r.endUserId !== null) {
    if (!isNonEmptyTrimmedString(r.endUserId)) return null;
    if (!isNonEmptyTrimmedString(r.endUserNameSnapshot)) return null;
    if (isLocalEndUserId(r.endUserId)) {
      if (r.endUserId !== localEndUserId(r.customerId, r.endUserNameSnapshot)) return null;
    } else {
      const endUser = mockEndUsers.find((e) => e.id === r.endUserId);
      if (!endUser || endUser.customerId !== r.customerId) return null;
    }
  } else if (r.endUserNameSnapshot !== null) {
    return null;
  }

  if (r.assignedEngineerId !== null) {
    if (!isNonEmptyTrimmedString(r.assignedEngineerId)) return null;
    const engineer = mockUsers.find((u) => u.id === r.assignedEngineerId);
    if (!engineer || engineer.role !== "AS_ENGINEER" || engineer.approvalStatus !== "APPROVED") {
      return null;
    }
    if (!isNonEmptyTrimmedString(r.assignedEngineerNameSnapshot)) return null;
  } else if (r.assignedEngineerNameSnapshot !== null) {
    return null;
  }

  if (!isNonEmptyTrimmedString(r.modelName)) return null;
  if (!isNonEmptyTrimmedString(r.lotNumber)) return null;
  if (!isNonEmptyTrimmedString(r.serialNumber)) return null;

  // 보고서번호는 아래 nullableStringFields 루프에 넣지 않는다 — 그 루프는
  // undefined를 "손상된 레코드"로 보고 레코드 전체를 버리는데, 보고서번호
  // 입력칸이 생기기 전에 저장된 기존 로컬 접수 건에는 이 키 자체가 없다.
  // 여기서만 undefined를 null과 동일하게 받아들여 기존 데이터를 보존한다.
  if (
    r.legacyReportNumber !== null &&
    r.legacyReportNumber !== undefined &&
    !isNonEmptyTrimmedString(r.legacyReportNumber)
  ) {
    return null;
  }

  const nullableStringFields = [
    "partNumber",
    "accessoryList",
    "externalConditionSummary",
    "reasonForRemoval",
    "reportedSymptom",
    "intakeInspectionResult",
    "currentDiagnosisSummary",
    "nextPlannedAction",
    "notes",
    "contactName",
    "contactPhone",
    "contactEmail",
  ] as const;
  for (const field of nullableStringFields) {
    const value = r[field];
    if (value !== null && !isNonEmptyTrimmedString(value)) return null;
  }

  return {
    id: r.id as string,
    intakeNumber: r.intakeNumber as string,
    legacyReportNumber: (r.legacyReportNumber as string | null | undefined) ?? null,
    workflowType: r.workflowType as WorkflowType,
    billingType: r.billingType as BillingType,
    status: r.status as RepairStatus,
    priority: r.priority as Priority,
    currentWorkflowStepKey: r.currentWorkflowStepKey as string,
    receivedAt: r.receivedAt as string,
    customerRequestedDueDate: (r.customerRequestedDueDate as string | null) ?? null,
    internalTargetShipmentDate: (r.internalTargetShipmentDate as string | null) ?? null,
    actualShipmentDate: null,
    exceptionStatus: null,
    createdAt: r.createdAt as string,
    customerId: r.customerId as string,
    customerNameSnapshot: r.customerNameSnapshot as string,
    endUserId: (r.endUserId as string | null) ?? null,
    endUserNameSnapshot: (r.endUserNameSnapshot as string | null) ?? null,
    assignedEngineerId: (r.assignedEngineerId as string | null) ?? null,
    assignedEngineerNameSnapshot: (r.assignedEngineerNameSnapshot as string | null) ?? null,
    modelName: r.modelName as string,
    lotNumber: r.lotNumber as string,
    serialNumber: r.serialNumber as string,
    partNumber: (r.partNumber as string | null) ?? null,
    accessoryList: (r.accessoryList as string | null) ?? null,
    externalConditionSummary: (r.externalConditionSummary as string | null) ?? null,
    reasonForRemoval: (r.reasonForRemoval as string | null) ?? null,
    reportedSymptom: (r.reportedSymptom as string | null) ?? null,
    intakeInspectionResult: (r.intakeInspectionResult as string | null) ?? null,
    currentDiagnosisSummary: (r.currentDiagnosisSummary as string | null) ?? null,
    nextPlannedAction: (r.nextPlannedAction as string | null) ?? null,
    notes: (r.notes as string | null) ?? null,
    contactName: (r.contactName as string | null) ?? null,
    contactPhone: (r.contactPhone as string | null) ?? null,
    contactEmail: (r.contactEmail as string | null) ?? null,
  };
}

/**
 * 검증을 통과한 레코드 배열에서 중복 로컬 ID/중복 인수번호를 제거한다.
 * (먼저 등장한 레코드를 유지하고 이후 중복은 건너뛴다.) mockIntakeNumbers는
 * 모의 데이터와의 충돌도 함께 걸러내기 위해 전달받는다.
 */
export function dedupeLocalRepairCases(
  cases: LocalRepairCase[],
  mockIntakeNumbers: ReadonlySet<string>
): LocalRepairCase[] {
  const seenIds = new Set<string>();
  const seenIntakeNumbers = new Set<string>(mockIntakeNumbers);
  const result: LocalRepairCase[] = [];

  for (const candidate of cases) {
    if (seenIds.has(candidate.id)) continue;
    if (seenIntakeNumbers.has(candidate.intakeNumber)) continue;
    seenIds.add(candidate.id);
    seenIntakeNumbers.add(candidate.intakeNumber);
    result.push(candidate);
  }

  return result;
}
