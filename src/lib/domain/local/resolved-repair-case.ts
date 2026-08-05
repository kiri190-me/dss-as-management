import { DEMO_REFERENCE_DATE } from "../demo-clock";
import {
  mockCustomers,
  mockEndUsers,
  mockProducts,
  mockRepairCases,
  mockUsers,
} from "../mock-data";
import {
  isRepairCaseOverdue,
  paidOrWarrantyLabels,
  productCategoryLabels,
  type ExceptionStatus,
  type Priority,
  type RepairCase,
  type RepairStatus,
  type WorkflowType,
} from "../types";
import { isLocalId, type LocalRepairCase } from "./local-types";

/**
 * mock(FK 기반)과 local(임베디드 스냅샷) 두 소스를 화면에서 동일하게 다룰 수
 * 있도록 만든 단일 정규화 구조다. 대시보드/목록/상세/제품이력 화면은 이
 * 타입만 소비하며, source에 따라 필드를 다르게 읽는 분기를 두지 않는다.
 *
 * productId는 UI가 직접 쓰는 필드가 아니라, product-history-match.ts의
 * "mock-to-mock은 productId로" 매칭 전략을 위해서만 존재하는 내부용 필드다
 * (MOCK 소스만 값을 가지며 LOCAL_DEMO는 항상 null이다).
 */
export type ResolvedRepairCase = {
  id: string;
  /**
   * Optimistic-concurrency token (repair_cases.version). Only DATABASE-
   * sourced rows carry a real, meaningful value — MOCK/LOCAL_DEMO rows are
   * never database-editable through the edit Server Action (see
   * repair-case-edit-authorization.ts's source gate), so they're fixed at
   * 1 purely for type consistency, never read back or incremented.
   */
  version: number;
  source: "MOCK" | "LOCAL_DEMO" | "DATABASE";
  productId: string | null;
  intakeNumber: string;
  workflowType: WorkflowType;
  status: RepairStatus;
  priority: Priority;
  exceptionStatus: ExceptionStatus | null;
  currentWorkflowStepKey: string;
  receivedAt: string;
  customerRequestedDueDate: string | null;
  /** Not carried by mock/local demo data (Stage G-3R column) — always null there. */
  internalTargetInspectionCompletionDate: string | null;
  internalTargetShipmentDate: string | null;
  actualShipmentDate: string | null;
  /** Stage E-2 활동 타임라인의 CASE_CREATED 이벤트가 사용한다(등록 처리 시각). */
  createdAt: string;
  isOverdue: boolean;
  productCategory: string;
  paidOrWarranty: string;
  modelName: string;
  lotNumber: string;
  serialNumber: string;
  partNumber: string | null;
  customerId: string;
  customerName: string;
  endUserId: string | null;
  endUserName: string | null;
  assignedEngineerId: string | null;
  engineerName: string | null;
  reportedSymptom: string | null;
  intakeInspectionResult: string | null;
  currentDiagnosisSummary: string | null;
  nextPlannedAction: string | null;
  accessoryList: string | null;
  externalConditionSummary: string | null;
  reasonForRemoval: string | null;
  notes: string | null;
  contactName: string | null;
  contactPhone: string | null;
  contactEmail: string | null;
};

export function toResolvedFromMock(
  repairCase: RepairCase,
  referenceDate: Date = DEMO_REFERENCE_DATE
): ResolvedRepairCase {
  const customer = mockCustomers.find((c) => c.id === repairCase.customerId);
  const endUser = repairCase.endUserId
    ? (mockEndUsers.find((e) => e.id === repairCase.endUserId) ?? null)
    : null;
  const product = mockProducts.find((p) => p.id === repairCase.productId);
  const engineer = repairCase.assignedEngineerId
    ? (mockUsers.find((u) => u.id === repairCase.assignedEngineerId) ?? null)
    : null;

  return {
    id: repairCase.id,
    version: 1,
    source: "MOCK",
    productId: repairCase.productId,
    intakeNumber: repairCase.intakeNumber,
    workflowType: repairCase.workflowType,
    status: repairCase.status,
    priority: repairCase.priority,
    exceptionStatus: repairCase.exceptionStatus,
    currentWorkflowStepKey: repairCase.currentWorkflowStepKey,
    receivedAt: repairCase.receivedAt,
    customerRequestedDueDate: repairCase.customerRequestedDueDate,
    internalTargetInspectionCompletionDate: null,
    internalTargetShipmentDate: repairCase.internalTargetShipmentDate,
    actualShipmentDate: repairCase.actualShipmentDate,
    createdAt: repairCase.createdAt,
    isOverdue: isRepairCaseOverdue(repairCase, referenceDate),
    productCategory: productCategoryLabels[repairCase.workflowType],
    paidOrWarranty: paidOrWarrantyLabels[repairCase.workflowType],
    modelName: product?.modelName ?? "-",
    lotNumber: product?.lotNumber ?? "-",
    serialNumber: product?.serialNumber ?? "-",
    partNumber: null,
    customerId: repairCase.customerId,
    customerName: customer?.name ?? "-",
    endUserId: repairCase.endUserId,
    endUserName: endUser?.name ?? null,
    assignedEngineerId: repairCase.assignedEngineerId,
    engineerName: engineer?.name ?? null,
    reportedSymptom: repairCase.reportedSymptom,
    intakeInspectionResult: repairCase.intakeInspectionResult,
    currentDiagnosisSummary: repairCase.currentDiagnosisSummary,
    nextPlannedAction: repairCase.nextPlannedAction,
    accessoryList: null,
    externalConditionSummary: null,
    reasonForRemoval: null,
    notes: null,
    contactName: null,
    contactPhone: null,
    contactEmail: null,
  };
}

export function toResolvedFromLocal(
  localCase: LocalRepairCase,
  referenceDate: Date = DEMO_REFERENCE_DATE
): ResolvedRepairCase {
  return {
    id: localCase.id,
    version: 1,
    source: "LOCAL_DEMO",
    productId: null,
    intakeNumber: localCase.intakeNumber,
    workflowType: localCase.workflowType,
    status: localCase.status,
    priority: localCase.priority,
    exceptionStatus: localCase.exceptionStatus,
    currentWorkflowStepKey: localCase.currentWorkflowStepKey,
    receivedAt: localCase.receivedAt,
    customerRequestedDueDate: localCase.customerRequestedDueDate,
    internalTargetInspectionCompletionDate: null,
    internalTargetShipmentDate: localCase.internalTargetShipmentDate,
    actualShipmentDate: localCase.actualShipmentDate,
    createdAt: localCase.createdAt,
    isOverdue: isRepairCaseOverdue(localCase, referenceDate),
    productCategory: productCategoryLabels[localCase.workflowType],
    paidOrWarranty: paidOrWarrantyLabels[localCase.workflowType],
    modelName: localCase.modelName,
    lotNumber: localCase.lotNumber,
    serialNumber: localCase.serialNumber,
    partNumber: localCase.partNumber,
    customerId: localCase.customerId,
    customerName: localCase.customerNameSnapshot,
    endUserId: localCase.endUserId,
    endUserName: localCase.endUserNameSnapshot,
    assignedEngineerId: localCase.assignedEngineerId,
    engineerName: localCase.assignedEngineerNameSnapshot,
    reportedSymptom: localCase.reportedSymptom,
    intakeInspectionResult: localCase.intakeInspectionResult,
    currentDiagnosisSummary: localCase.currentDiagnosisSummary,
    nextPlannedAction: localCase.nextPlannedAction,
    accessoryList: localCase.accessoryList,
    externalConditionSummary: localCase.externalConditionSummary,
    reasonForRemoval: localCase.reasonForRemoval,
    notes: localCase.notes,
    contactName: localCase.contactName,
    contactPhone: localCase.contactPhone,
    contactEmail: localCase.contactEmail,
  };
}

/**
 * 대시보드/목록 화면에서 사용하는 병합 목록이다. mock은 정적으로, local은
 * 호출자가 훅으로 구독해 전달한 최신 배열을 받는다.
 */
export function resolveAllRepairCases(
  localCases: LocalRepairCase[],
  referenceDate: Date = DEMO_REFERENCE_DATE
): ResolvedRepairCase[] {
  return [
    ...mockRepairCases.map((c) => toResolvedFromMock(c, referenceDate)),
    ...localCases.map((c) => toResolvedFromLocal(c, referenceDate)),
  ];
}

/** 서버 컴포넌트에서 안전하게 쓸 수 있는 mock 전용 조회(로컬스토리지 접근 없음). */
export function resolveMockRepairCaseById(
  id: string,
  referenceDate: Date = DEMO_REFERENCE_DATE
): ResolvedRepairCase | null {
  const repairCase = mockRepairCases.find((c) => c.id === id);
  return repairCase ? toResolvedFromMock(repairCase, referenceDate) : null;
}

/** 클라이언트 전용: local- id는 localCases에서, 그 외에는 mock에서 찾는다. */
export function resolveRepairCaseById(
  id: string,
  localCases: LocalRepairCase[],
  referenceDate: Date = DEMO_REFERENCE_DATE
): ResolvedRepairCase | null {
  if (isLocalId(id)) {
    const localCase = localCases.find((c) => c.id === id);
    return localCase ? toResolvedFromLocal(localCase, referenceDate) : null;
  }
  return resolveMockRepairCaseById(id, referenceDate);
}
