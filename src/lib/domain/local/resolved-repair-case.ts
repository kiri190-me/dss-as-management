import { DEMO_REFERENCE_DATE } from "../demo-clock";
import {
  mockCustomers,
  mockEndUsers,
  mockProducts,
  mockRepairCases,
  mockUsers,
} from "../mock-data";
import {
  billingTypeLabels,
  isRepairCaseOverdue,
  productCategoryLabels,
  type BillingType,
  type ExceptionStatus,
  type Priority,
  type RepairCase,
  type RepairStatus,
  type WorkflowType,
} from "../types";
import { type LocalRepairCase } from "./local-types";

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
  /** Excel legacy report identifier; unrelated to any future official report number. */
  legacyReportNumber: string | null;
  workflowType: WorkflowType;
  status: RepairStatus;
  priority: Priority;
  exceptionStatus: ExceptionStatus | null;
  currentWorkflowStepKey: string;
  receivedAt: string;
  customerRequestedDueDate: string | null;
  /**
   * 이 건에 연결된 내자 정리 줄들의 **납기요청일 전부**(없으면 빈 배열).
   *
   * 🔴 **계산한 날짜가 아니라 재료다.** 위 customerRequestedDueDate 가 비었을 때
   * 화면이 무엇을 그릴지는 domain/requested-due-date-link.ts 의
   * resolveRepairCaseRequestedDueDate 가 정하는데, 그 파일 머리말이 **"이 결과는
   * 어느 저장 payload 타입에도 들어가지 않는다"**고 못 박았다 — 계산된 값을 원본
   * 옆에 실어 두면 자동으로 따라오던 날짜가 그 줄에 박제되고, 그때부터 "일부러
   * 다르게 적었다"와 "그냥 안 건드렸다"를 구분할 수 없다. 그래서 여기 싣는 것은
   * **고르기 전의 날짜 목록**이고, 고르는 일은 그리는 자리에서 한다(상세 화면이
   * 이미 그렇게 한다 — detail/IntakeInfoSection.tsx).
   *
   * 🔵 **MOCK · LOCAL_DEMO 는 늘 빈 배열이다.** 그 두 소스에는 내자 정리라는
   * 자료 자체가 없다(내자는 DB 표 domestic_orders 에만 있다). 빈 배열이면 위
   * 함수는 "빌릴 것이 없다"로 답하므로, 그 화면들은 예전과 똑같이 자기 칸만
   * 그린다.
   *
   * 🔴 DATABASE 소스라고 언제나 차 있는 것도 아니다 — 싣는 쪽은 **목록 조회
   * 둘**(queries/repair-cases.ts 의 listRepairCases, queries/repair-cases-mine.ts)
   * 뿐이고, 나머지 조회(고객사·제품 이력, 휴지통 등)는 빈 배열로 둔다. 그 화면들은
   * 이 칸을 그리지 않는다.
   */
  domesticOrderDueDates: readonly string[];
  /** Not carried by mock/local demo data (Stage G-3R column) — always null there. */
  internalTargetInspectionCompletionDate: string | null;
  internalTargetShipmentDate: string | null;
  actualShipmentDate: string | null;
  /** Stage E-2 활동 타임라인의 CASE_CREATED 이벤트가 사용한다(등록 처리 시각). */
  createdAt: string;
  isOverdue: boolean;
  productCategory: string;
  paidOrWarranty: string;
  /** Raw value behind `paidOrWarranty`'s label — needed by 종류 재배정 UX (never guesses when null). */
  billingType: BillingType | null;
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
    legacyReportNumber: null,
    workflowType: repairCase.workflowType,
    status: repairCase.status,
    priority: repairCase.priority,
    exceptionStatus: repairCase.exceptionStatus,
    currentWorkflowStepKey: repairCase.currentWorkflowStepKey,
    receivedAt: repairCase.receivedAt,
    customerRequestedDueDate: repairCase.customerRequestedDueDate,
    // mock 자료에는 내자 정리가 없다 — 빌려 올 날짜도 없다(타입 주석).
    domesticOrderDueDates: [],
    internalTargetInspectionCompletionDate: null,
    internalTargetShipmentDate: repairCase.internalTargetShipmentDate,
    actualShipmentDate: repairCase.actualShipmentDate,
    createdAt: repairCase.createdAt,
    isOverdue: isRepairCaseOverdue(repairCase, referenceDate),
    productCategory: productCategoryLabels[repairCase.workflowType],
    paidOrWarranty: repairCase.billingType ? billingTypeLabels[repairCase.billingType] : "-",
    billingType: repairCase.billingType,
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
    legacyReportNumber: localCase.legacyReportNumber,
    workflowType: localCase.workflowType,
    status: localCase.status,
    priority: localCase.priority,
    exceptionStatus: localCase.exceptionStatus,
    currentWorkflowStepKey: localCase.currentWorkflowStepKey,
    receivedAt: localCase.receivedAt,
    customerRequestedDueDate: localCase.customerRequestedDueDate,
    // 브라우저에만 있는 건이라 내자 정리에 붙을 자리가 없다(타입 주석).
    domesticOrderDueDates: [],
    internalTargetInspectionCompletionDate: null,
    internalTargetShipmentDate: localCase.internalTargetShipmentDate,
    actualShipmentDate: localCase.actualShipmentDate,
    createdAt: localCase.createdAt,
    isOverdue: isRepairCaseOverdue(localCase, referenceDate),
    productCategory: productCategoryLabels[localCase.workflowType],
    paidOrWarranty: billingTypeLabels[localCase.billingType],
    billingType: localCase.billingType,
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
