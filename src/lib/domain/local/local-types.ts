import type { Priority, RepairStatus, WorkflowType } from "../types";

// 브라우저 localStorage에만 저장되는 데모 전용 로컬 접수 건이다. 실제 DB 스키마
// 결정이 아니며, 모의(mock) RepairCase와 달리 고객/제품 FK 대신 스냅샷 값을
// 함께 저장한다(Stage C-2 Option A: 별도 서버/DB 없이 브라우저 단일 세션에서만
// 유효한 데모 영속화).
export type LocalRepairCase = {
  id: string;
  intakeNumber: string;
  workflowType: WorkflowType;
  /** 이 스테이지에서 로컬로 생성되는 건은 항상 WAITING_INTAKE_INSPECTION이다. */
  status: RepairStatus;
  priority: Priority;
  currentWorkflowStepKey: string;
  /** 접수 화면에서 선택한 인수일("YYYY-MM-DD"). DEMO_REFERENCE_DATE는 기본값일 뿐이다. */
  receivedAt: string;
  customerRequestedDueDate: string | null;
  /** 폼에서 필수 입력이므로 null을 허용하지 않는다. */
  internalTargetShipmentDate: string;
  actualShipmentDate: null;
  exceptionStatus: null;
  /** 실제 벽시계 ISO 시각(등록 처리 시각). 데모 기준일과 무관하다. */
  createdAt: string;

  // 고객/End-User는 기존 모의 고객 목록에서 선택하며, 관계 검증은 항상 ID로
  // 수행한다. Snapshot 이름은 표시 전용이며 신뢰 가능한 관계 소스가 아니다.
  customerId: string;
  customerNameSnapshot: string;
  endUserId: string | null;
  endUserNameSnapshot: string | null;

  // 담당 엔지니어는 필수이며, 승인된 A/S 엔지니어 중에서만 선택한다.
  assignedEngineerId: string;
  assignedEngineerNameSnapshot: string;

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

export type LocalCaseEnvelope = {
  version: 1;
  cases: LocalRepairCase[];
};

export const LOCAL_CASE_STORAGE_KEY = "dss-as-local-cases-v1";
export const LOCAL_ID_PREFIX = "local-";

export function isLocalId(id: string): boolean {
  return id.startsWith(LOCAL_ID_PREFIX);
}

export function generateLocalCaseId(): string {
  return `${LOCAL_ID_PREFIX}${crypto.randomUUID()}`;
}
