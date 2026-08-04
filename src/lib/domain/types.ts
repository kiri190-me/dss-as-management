export const ROLE_CODES = [
  "SUPER_ADMIN",
  "ADMIN",
  "AS_ENGINEER",
  "SALES",
  "INVENTORY_MANAGER",
] as const;
export type Role = (typeof ROLE_CODES)[number];
export const roleLabels: Record<Role, string> = {
  SUPER_ADMIN: "최고관리자",
  ADMIN: "관리자",
  AS_ENGINEER: "A/S 엔지니어",
  SALES: "영업 담당자",
  INVENTORY_MANAGER: "재고 담당자",
};

export const ACCOUNT_APPROVAL_STATUS_CODES = ["PENDING", "APPROVED"] as const;
export type AccountApprovalStatus = (typeof ACCOUNT_APPROVAL_STATUS_CODES)[number];
export const accountApprovalStatusLabels: Record<AccountApprovalStatus, string> = {
  PENDING: "승인 대기",
  APPROVED: "승인됨",
};

export const WORKFLOW_TYPE_CODES = [
  "MATCHER",
  "PAID_GENERATOR",
  "WARRANTY_GENERATOR",
] as const;
export type WorkflowType = (typeof WORKFLOW_TYPE_CODES)[number];
export const workflowTypeLabels: Record<WorkflowType, string> = {
  MATCHER: "Matcher",
  PAID_GENERATOR: "유상 Generator",
  WARRANTY_GENERATOR: "무상(보증) Generator",
};

/**
 * 아래 두 맵은 화면 표시 전용 데모 파생 값이다. DATABASE_DESIGN.md에는
 * "제품 구분"/"유상·무상" 컬럼이 별도로 정의되어 있지 않으며, 여기서는
 * 기존 WorkflowType 값 하나로부터 두 개의 표시용 문구를 파생시킨다.
 * 실제 DB 스키마에 이 두 컬럼을 그대로 추가한다는 결정이 아니다.
 */
export const productCategoryLabels: Record<WorkflowType, string> = {
  MATCHER: "Matcher",
  PAID_GENERATOR: "Generator",
  WARRANTY_GENERATOR: "Generator",
};
export const paidOrWarrantyLabels: Record<WorkflowType, string> = {
  MATCHER: "-",
  PAID_GENERATOR: "유상",
  WARRANTY_GENERATOR: "무상",
};

// 데모 전용 단순화 상태 값이다. 실제 스키마는 workflow_version/current_step +
// nullable exception_status 조합으로 표현되며(DATABASE_DESIGN.md 13번),
// 이 평탄화된 상태는 Phase 2/3의 정규 모델로 대체될 예정이다.
export const REPAIR_STATUS_CODES = [
  "WAITING_INTAKE_INSPECTION",
  "WAITING_KYOSAN_REPLY",
  "WAITING_PO",
  "WAITING_PARTS_SUPPLY",
  "IN_REPAIR",
  "WAITING_SHIPMENT_APPROVAL",
  "WAITING_SHIPMENT",
  "SHIPMENT_COMPLETED",
] as const;
export type RepairStatus = (typeof REPAIR_STATUS_CODES)[number];
export const repairStatusLabels: Record<RepairStatus, string> = {
  WAITING_INTAKE_INSPECTION: "인수점검 대기",
  WAITING_KYOSAN_REPLY: "교산 회신 대기",
  WAITING_PO: "PO 대기",
  WAITING_PARTS_SUPPLY: "부품 수급 대기",
  IN_REPAIR: "수리 중",
  WAITING_SHIPMENT_APPROVAL: "출하 승인 대기",
  WAITING_SHIPMENT: "출하 대기",
  SHIPMENT_COMPLETED: "출하 완료",
};

// DATABASE_DESIGN.md/API_SPECIFICATION.md에 아직 정의되지 않은 데모 전용 필드다.
export const PRIORITY_CODES = ["LOW", "NORMAL", "HIGH", "URGENT"] as const;
export type Priority = (typeof PRIORITY_CODES)[number];
export const priorityLabels: Record<Priority, string> = {
  LOW: "낮음",
  NORMAL: "보통",
  HIGH: "높음",
  URGENT: "긴급",
};

/**
 * DATABASE_DESIGN.md 13번 / PROJECT_REQUIREMENTS.md "예외 상태" 절에 정의된
 * 9종 예외 상태를 그대로 코드화한 것이다(용어를 임의로 바꾸거나 새 항목을
 * 추가하지 않았다). "삭제"는 두 문서 모두 예외 상태에서 명시적으로 제외한다.
 * exceptionStatus는 RepairStatus/currentWorkflowStepKey와 독립적인 nullable
 * 필드이며, 워크플로 진행 표시와 절대 합쳐서 렌더링하지 않는다.
 */
export const EXCEPTION_STATUS_CODES = [
  "ON_HOLD",
  "WAITING_CUSTOMER_RESPONSE",
  "WAITING_KYOSAN_RESPONSE",
  "PARTS_WAITING",
  "REPAIR_NOT_POSSIBLE",
  "REPAIR_FAILED",
  "CUSTOMER_CANCELLED_REPAIR",
  "FREE_RETURN",
  "DISPOSED",
] as const;
export type ExceptionStatus = (typeof EXCEPTION_STATUS_CODES)[number];
export const exceptionStatusLabels: Record<ExceptionStatus, string> = {
  ON_HOLD: "보류",
  WAITING_CUSTOMER_RESPONSE: "고객 응답 대기",
  WAITING_KYOSAN_RESPONSE: "교산 응답 대기",
  PARTS_WAITING: "부품 대기",
  REPAIR_NOT_POSSIBLE: "수리 불가",
  REPAIR_FAILED: "수리 실패",
  CUSTOMER_CANCELLED_REPAIR: "고객 수리 취소",
  FREE_RETURN: "무상 반송",
  DISPOSED: "폐기",
};

// 데모 전용 작업 이력 구분값이다. DATABASE_DESIGN.md에 별도로 정의되어 있지
// 않으며, 상태 변경 이력(STATUS_CHANGE)을 일반 작업 기록과 시각적으로
// 구분하기 위한 목적으로 도입했다.
export const WORK_HISTORY_TYPE_CODES = [
  "INSPECTION",
  "DIAGNOSIS",
  "REPAIR",
  "TEST",
  "COMMUNICATION",
  "STATUS_CHANGE",
  "OTHER",
] as const;
export type WorkHistoryType = (typeof WORK_HISTORY_TYPE_CODES)[number];
export const workHistoryTypeLabels: Record<WorkHistoryType, string> = {
  INSPECTION: "점검",
  DIAGNOSIS: "진단",
  REPAIR: "수리/부품교체",
  TEST: "테스트",
  COMMUNICATION: "연락/보고",
  STATUS_CHANGE: "상태 변경",
  OTHER: "기타",
};

export type User = {
  id: string;
  name: string;
  email: string;
  role: Role;
  approvalStatus: AccountApprovalStatus;
  createdAt: string;
};

export type Customer = {
  id: string;
  name: string;
  contactName: string;
  contactEmail: string;
  contactPhone: string;
};

export type EndUser = {
  id: string;
  customerId: string;
  name: string;
  contactName: string;
  contactEmail: string;
};

export type Product = {
  id: string;
  modelName: string;
  /** Lot Number. 데모 값은 전부 가상이다. */
  lotNumber: string;
  serialNumber: string;
};

export type RepairCase = {
  id: string;
  intakeNumber: string;
  customerId: string;
  endUserId: string | null;
  productId: string;
  workflowType: WorkflowType;
  status: RepairStatus;
  priority: Priority;
  assignedEngineerId: string | null;
  receivedAt: string;
  /** 고객이 요청한 희망 납기일 */
  customerRequestedDueDate: string | null;
  /** 내부적으로 관리하는 목표 출하일 — 지연 여부 계산의 기준 */
  internalTargetShipmentDate: string | null;
  /**
   * 실제로 출하가 완료된 날짜. status가 SHIPMENT_COMPLETED가 아닌 건은
   * 보통 null이다. internalTargetShipmentDate(목표일)의 대용으로 쓰지 않는다.
   */
  actualShipmentDate: string | null;
  isLocked: boolean;
  createdAt: string;

  // 아래 6개 필드는 Stage C-1에서 추가된 데모 전용 스냅샷 필드다.
  // 실제 운영 스키마 결정이 아니며, 값은 전부 가상/비기술적 데모 문구다.

  /** 고객이 최초 신고한 증상 요약 */
  reportedSymptom: string | null;
  /** 인수점검 결과. 아직 인수점검 전인 건은 null이다. */
  intakeInspectionResult: string | null;
  /** 현재까지의 진단/조치 한 줄 요약(최신 상태 스냅샷). 상세 이력은 WorkHistory 참조. */
  currentDiagnosisSummary: string | null;
  /** 다음 예정 작업 */
  nextPlannedAction: string | null;
  /** 워크플로 진행과 독립적인 예외 상태(nullable) */
  exceptionStatus: ExceptionStatus | null;
  /**
   * 이 접수 건이 현재 위치한 워크플로 단계의 key(WorkflowStep.key와 매칭).
   * DATABASE_DESIGN.md의 향후 `repair_cases.current_step_id` 관계를
   * 단순화하여 흉내 낸 데모 필드이며, 실제 DB 구현이 아니다.
   * RepairStatus로부터 역산하지 않고 이 필드가 진행 상태의 단일 소스다.
   */
  currentWorkflowStepKey: string;
};

export type WorkHistory = {
  id: string;
  repairCaseId: string;
  engineerId: string;
  /**
   * ISO 8601 날짜/시각(+09:00 고정 오프셋). Stage B-2까지 쓰던 날짜 전용
   * workDate 필드를 대체한다 — 같은 의미의 필드를 두 개 두지 않기 위해
   * workDate는 제거했다(다음 마이그레이션 참고: workDate("YYYY-MM-DD") →
   * workedAt("YYYY-MM-DDTHH:mm:00+09:00"), 시각은 데모용 가상 값으로 새로 부여).
   */
  workedAt: string;
  workType: WorkHistoryType;
  description: string;
  symptom: string | null;
  suspectedCause: string | null;
  actionTaken: string | null;
  partsUsed: string | null;
  nextAction: string | null;
  /**
   * workType이 STATUS_CHANGE인 항목만 두 값 모두 채운다. 그 외 항목은
   * 항상 null이며, 설명 문자열에서 상태를 파싱하지 않고 이 타입 필드로만
   * 렌더링한다.
   */
  previousStatus: RepairStatus | null;
  newStatus: RepairStatus | null;
};

export type AttachmentMetadata = {
  id: string;
  repairCaseId: string;
  uploadedBy: string;
  fileName: string;
  mimeType: string;
  fileSizeBytes: number;
  malwareScanStatus: "PENDING" | "CLEAN" | "INFECTED";
  uploadedAt: string;
};

export type WorkflowStep = {
  workflowType: WorkflowType;
  order: number;
  key: string;
  label: string;
};

/**
 * "납기 지연"은 저장된 상태값이 아니라 계산된 조건이다(내부 목표 출하일이
 * 지났고 아직 출하 완료되지 않은 경우). RepairStatus/exception status에
 * 포함하지 않는다.
 */
export function isRepairCaseOverdue(
  repairCase: Pick<RepairCase, "status" | "internalTargetShipmentDate">,
  today: Date = new Date()
): boolean {
  if (repairCase.status === "SHIPMENT_COMPLETED") {
    return false;
  }
  if (!repairCase.internalTargetShipmentDate) {
    return false;
  }
  return new Date(repairCase.internalTargetShipmentDate) < today;
}
