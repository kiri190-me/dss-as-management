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
};

export type WorkHistory = {
  id: string;
  repairCaseId: string;
  engineerId: string;
  workDate: string;
  description: string;
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
  repairCase: RepairCase,
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
