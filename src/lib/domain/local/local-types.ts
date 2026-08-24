import { normalizeEntityName } from "../entity-name-match";
import type { BillingType, Priority, RepairStatus, WorkflowType } from "../types";

// 브라우저 localStorage에만 저장되는 데모 전용 로컬 접수 건이다. 실제 DB 스키마
// 결정이 아니며, 모의(mock) RepairCase와 달리 고객/제품 FK 대신 스냅샷 값을
// 함께 저장한다(Stage C-2 Option A: 별도 서버/DB 없이 브라우저 단일 세션에서만
// 유효한 데모 영속화).
export type LocalRepairCase = {
  id: string;
  intakeNumber: string;
  /**
   * 보고서번호 — A/S 접수 폼에서 사람이 직접 적는 선택 입력값이다(인수번호와
   * 달리 자동 채번 규칙이 없고, 형식/중복 검사도 하지 않는다). 비워두면 null.
   * DB 모드의 repair_cases.legacy_report_number와 같은 값을 담는다.
   */
  legacyReportNumber: string | null;
  workflowType: WorkflowType;
  /**
   * 유상/무상 — workflowType과 독립적으로 A/S 접수 폼에서 필수로 선택한다
   * (migration 0021). 로컬로 생성되는 건은 이 필수 검증을 항상 통과했으므로
   * null이 아니다.
   */
  billingType: BillingType;
  /** 이 스테이지에서 로컬로 생성되는 건은 항상 WAITING_INTAKE_INSPECTION이다. */
  status: RepairStatus;
  priority: Priority;
  currentWorkflowStepKey: string;
  /** 접수 화면에서 선택한 인수일("YYYY-MM-DD"). DEMO_REFERENCE_DATE는 기본값일 뿐이다. */
  receivedAt: string;
  customerRequestedDueDate: string | null;
  /** A/S 접수 폼에서 선택 입력이다 — 비워두면 null. */
  internalTargetShipmentDate: string | null;
  actualShipmentDate: null;
  exceptionStatus: null;
  /** 실제 벽시계 ISO 시각(등록 처리 시각). 데모 기준일과 무관하다. */
  createdAt: string;

  // 고객/End-User는 기존 모의 목록에서 선택하거나(자유 입력 콤보박스에서
  // 매칭됨), 접수 화면에서 "새 고객사/End-User로 등록"을 명시적으로 눌러
  // 새로 생성할 수 있다(A/S INTAKE 고객사/End-User 자유 입력 체크포인트).
  // 새로 생성된 경우 customerId/endUserId는 LOCAL_CUSTOMER_ID_PREFIX/
  // LOCAL_END_USER_ID_PREFIX로 시작하는 결정적(deterministic) ID다 — 정규화된
  // 이름으로부터 유도되므로, 같은 이름을 다시 입력하면 항상 같은 ID로
  // 재사용된다(별도 조회 없이도 자연스러운 중복 방지). 관계 검증은 항상 ID로
  // 수행한다. Snapshot 이름은 표시 전용이며 신뢰 가능한 관계 소스가 아니다.
  customerId: string;
  customerNameSnapshot: string;
  endUserId: string | null;
  endUserNameSnapshot: string | null;

  // A/S 접수 폼에서 선택 입력이다 — 비워두면 null. 지정할 때는 승인된
  // A/S 엔지니어 중에서만 선택한다.
  assignedEngineerId: string | null;
  assignedEngineerNameSnapshot: string | null;

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

// 로컬 고객사/End-User의 결정적(deterministic) ID 스킴 — 정규화된 이름
// (End-User는 customerId까지)으로부터 유도되므로, 실제 저장소 없이도 "같은
// 이름은 항상 같은 ID"가 자동으로 성립한다. 이 ID를 새로 만들던 쓰기 경로는
// 사라졌고, 지금 이 두 함수는 이미 저장된 값이 그 규칙과 맞는지 확인하는
// 용도로만 쓰인다(validation.ts).
export const LOCAL_CUSTOMER_ID_PREFIX = "local-customer-";
export const LOCAL_END_USER_ID_PREFIX = "local-enduser-";

export function isLocalCustomerId(id: string): boolean {
  return id.startsWith(LOCAL_CUSTOMER_ID_PREFIX);
}

export function isLocalEndUserId(id: string): boolean {
  return id.startsWith(LOCAL_END_USER_ID_PREFIX);
}

export function localCustomerId(name: string): string {
  return `${LOCAL_CUSTOMER_ID_PREFIX}${normalizeEntityName(name)}`;
}

export function localEndUserId(customerId: string, name: string): string {
  return `${LOCAL_END_USER_ID_PREFIX}${customerId}:${normalizeEntityName(name)}`;
}
