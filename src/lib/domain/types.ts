
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
  "PAID_MATCHER",
  "WARRANTY_MATCHER",
  "PAID_GENERATOR",
  "WARRANTY_GENERATOR",
  "PAID_TOTAL_CONTROLLER",
  "WARRANTY_TOTAL_CONTROLLER",
  "PENDING_MATCHER",
  "PENDING_GENERATOR",
  "PENDING_TOTAL_CONTROLLER",
] as const;
export type WorkflowType = (typeof WORKFLOW_TYPE_CODES)[number];
export const NEW_INTAKE_WORKFLOW_TYPE_CODES = [
  "PAID_MATCHER",
  "WARRANTY_MATCHER",
  "PAID_GENERATOR",
  "WARRANTY_GENERATOR",
  "PAID_TOTAL_CONTROLLER",
  "WARRANTY_TOTAL_CONTROLLER",
] as const satisfies readonly WorkflowType[];
export type NewIntakeWorkflowType = (typeof NEW_INTAKE_WORKFLOW_TYPE_CODES)[number];
export const PENDING_BILLING_WORKFLOW_TYPE_CODES = [
  "PENDING_MATCHER",
  "PENDING_GENERATOR",
  "PENDING_TOTAL_CONTROLLER",
] as const satisfies readonly WorkflowType[];
export type PendingBillingWorkflowType = (typeof PENDING_BILLING_WORKFLOW_TYPE_CODES)[number];
export const workflowTypeLabels: Record<WorkflowType, string> = {
  PAID_MATCHER: "유상 Matcher",
  WARRANTY_MATCHER: "무상(보증) Matcher",
  PAID_GENERATOR: "유상 Generator",
  WARRANTY_GENERATOR: "무상(보증) Generator",
  PAID_TOTAL_CONTROLLER: "유상 Total Controller",
  WARRANTY_TOTAL_CONTROLLER: "무상(보증) Total Controller",
  PENDING_MATCHER: "추후결정 Matcher",
  PENDING_GENERATOR: "추후결정 Generator",
  PENDING_TOTAL_CONTROLLER: "추후결정 Total Controller",
};

/**
 * "제품 구분"은 DATABASE_DESIGN.md에 별도 컬럼으로 정의되어 있지 않으며,
 * 여기서는 기존 WorkflowType 값으로부터 표시용 문구를 파생시키는 화면
 * 표시 전용 데모 값이다. 실제 DB 스키마에 이 컬럼을 그대로 추가한다는
 * 결정이 아니다.
 */
export const productCategoryLabels: Record<WorkflowType, string> = {
  PAID_MATCHER: "Matcher",
  WARRANTY_MATCHER: "Matcher",
  PAID_GENERATOR: "Generator",
  WARRANTY_GENERATOR: "Generator",
  PAID_TOTAL_CONTROLLER: "Total Controller",
  WARRANTY_TOTAL_CONTROLLER: "Total Controller",
  PENDING_MATCHER: "Matcher",
  PENDING_GENERATOR: "Generator",
  PENDING_TOTAL_CONTROLLER: "Total Controller",
};

/**
 * 제품군 드롭다운이 늘어놓을 값 — 위 표의 문구를 중복 없이 모은 것이다.
 *
 * 코드 목록(PRODUCT_CATEGORY_CODES 같은 것)을 따로 만들지 않는다. 제품군은
 * 아직 DB 컬럼이 아니라 workflowType에서 파생시킨 표시 문구이고(위 주석),
 * 목록을 따로 두면 표의 문구가 바뀔 때 둘이 조용히 갈라진다. 여기서 파생하면
 * 화면이 보여 주는 문구와 고를 수 있는 값이 언제나 같은 것이 된다.
 *
 * 그래서 비교도 코드가 아니라 이 문구로 한다 — 내 담당 제품 화면의 제품 구분
 * 필터(my-active-work-filter.ts)가 이미 같은 방식이다.
 */
export const PRODUCT_CATEGORY_OPTIONS: readonly string[] = [
  ...new Set(Object.values(productCategoryLabels)),
].sort((a, b) => a.localeCompare(b));

/**
 * 유상/무상 — migration 0021로 repair_cases.billing_type이 workflowType과
 * 독립된 실제 컬럼이 되었다(A/S INTAKE UX 체크포인트, 감사 승인). 더 이상
 * workflowType으로부터 유도하지 않는다. PAID/PARTIAL_PAID/WARRANTY는
 * 최종 분류이고 PENDING_DECISION은 Excel 이관 전용 임시 분류다.
 */
export const BILLING_TYPE_CODES = [
  "PAID",
  "PARTIAL_PAID",
  "WARRANTY",
  "PENDING_DECISION",
] as const;
export type BillingType = (typeof BILLING_TYPE_CODES)[number];
export const MANUAL_INTAKE_BILLING_TYPE_CODES = [
  "PAID",
  "PARTIAL_PAID",
  "WARRANTY",
] as const satisfies readonly BillingType[];
export type ManualIntakeBillingType = (typeof MANUAL_INTAKE_BILLING_TYPE_CODES)[number];
export const billingTypeLabels: Record<BillingType, string> = {
  PAID: "유상",
  PARTIAL_PAID: "일부유상",
  WARRANTY: "무상",
  PENDING_DECISION: "추후결정",
};

// 데모 전용 단순화 상태 값이다. 실제 스키마는 workflow_version/current_step +
// nullable exception_status 조합으로 표현되며(DATABASE_DESIGN.md 13번),
// 이 평탄화된 상태는 Phase 2/3의 정규 모델로 대체될 예정이다.
export const REPAIR_STATUS_CODES = [
  "WAITING_INTAKE_INSPECTION",
  "INTAKE_INSPECTION_IN_PROGRESS",
  "INTAKE_INSPECTION_COMPLETED",
  "WAITING_KYOSAN_REPLY",
  "WAITING_PO",
  "WAITING_PARTS_SUPPLY",
  "WAITING_REPAIR",
  "IN_REPAIR",
  "REPAIR_COMPLETED",
  "WAITING_SHIPMENT_APPROVAL",
  "WAITING_SHIPMENT",
  "SHIPMENT_COMPLETED",
] as const;
export type RepairStatus = (typeof REPAIR_STATUS_CODES)[number];
export const repairStatusLabels: Record<RepairStatus, string> = {
  WAITING_INTAKE_INSPECTION: "인수점검 대기",
  INTAKE_INSPECTION_IN_PROGRESS: "인수점검 중",
  INTAKE_INSPECTION_COMPLETED: "인수점검 완료",
  WAITING_KYOSAN_REPLY: "교산 회신 대기",
  WAITING_PO: "PO 대기",
  WAITING_PARTS_SUPPLY: "부품 수급 대기",
  WAITING_REPAIR: "수리 대기",
  IN_REPAIR: "수리 중",
  REPAIR_COMPLETED: "수리 완료",
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

/**
 * migration 0023 — repair_case_work_records.record_kind. Author-selected at
 * creation only (WorkRecordForm), never inferred/edited afterward. Not the
 * same concept as WorkHistoryType above (an older, unrelated mock work-
 * history event categorization) — do not conflate the two.
 */
export const WORK_RECORD_KIND_CODES = [
  "GENERAL",
  "INTAKE_INSPECTION_RESULT",
  "DIAGNOSIS_REPAIR_SUMMARY",
  "NEXT_PLANNED_ACTION",
] as const;
export type WorkRecordKind = (typeof WORK_RECORD_KIND_CODES)[number];
export const workRecordKindLabels: Record<WorkRecordKind, string> = {
  GENERAL: "일반",
  INTAKE_INSPECTION_RESULT: "인수점검 결과",
  DIAGNOSIS_REPAIR_SUMMARY: "진단/조치",
  NEXT_PLANNED_ACTION: "다음 예정 작업",
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
  /**
   * 유상/무상 — workflowType과 독립된 필드다(migration 0021). 과거 MATCHER
   * 행처럼 알 수 없는 값을 추측해 채우지 않으므로 nullable이다.
   */
  billingType: BillingType | null;
  status: RepairStatus;
  priority: Priority;
  assignedEngineerId: string | null;
  receivedAt: string;
  /**
   * 고객이 요청한 희망 납기일.
   *
   * 🔴 **2026-11-03 부터 「납기 지연」 배지의 기준이 이 칸이다**
   * (domain/repair-case-overdue.ts 의 isRepairCaseOverdue). 그 전에는
   * internalTargetShipmentDate 였다.
   *
   * 🔴 **2026-11-07 부터 이 칸이 비면 연결된 내자 정리의 납기요청일을 빌려 잰다** —
   * 그 판정이 더 이상 이 칸 하나만 보지 않는다(그 파일 머리말). 화면이 이미 그렇게
   * 그리고 있었고, 「납기 임박」·「납기 역전」도 이미 그렇게 재고 있었다.
   */
  customerRequestedDueDate: string | null;
  /**
   * 🔴 **화면에서는 「사내 목표 완료일」이다**(2026-11-03 사용자 결정 — 「사내 목표
   * 출하일을 사내 목표 완료일로 바꾸고」). 칸 이름(DB 의
   * `repair_cases.internal_target_shipment_date` 와 이 변수명)은 **일부러 그대로
   * 두었다** — 바꾸면 마이그레이션이 필요한데 얻는 것이 없다. 이름만 보고 「출하일」로
   * 읽지 말 것.
   *
   * 🔴 **더 이상 「납기 지연」의 기준이 아니다.** 같은 결정으로 그 배지는 고객 요청
   * 납기일만 본다(「사내 목표 완료일을 지났다고 해서 납기 지연 배지가 뜨지 않도록」).
   * 이 칸이 아직 쓰이는 자리는 셋이다 — 「납기 역전」 판정(domain/due-date-inversion.ts),
   * 「사내 목표 완료일 미등록」 알림(domain/notifications.ts), 그리고 목록 정렬·주간보고
   * 의 `납입 예정` 칸이다.
   */
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
 * 🔵 **「납기 지연」 판정(isRepairCaseOverdue)은 여기 있었다 — 2026-11-07 에
 * domain/repair-case-overdue.ts 로 옮겼다.**
 *
 * 옮긴 까닭은 **고리(circular import)** 하나다. 사용자 요구로 그 판정이 「이 칸이
 * 비면 연결된 내자 정리의 납기요청일을 빌려 온다」를 하게 되면서
 * requested-due-date-link.ts 가 필요해졌는데, 그 파일은 local/validation.ts 를 보고
 * 그쪽이 다시 **이 파일**을 본다. 여기에 그 import 를 더하면 types.ts 가 제 자신을
 * 거쳐 초기화되는 길이 생기고, 그 고리는 앱이 통째로 안 서는 모양으로 터진다
 * (domain/shipment-finished.ts 머리말에 이 저장소가 실제로 겪은 전말이 있다 — 그
 * 파일도 똑같은 까닭으로 똑같이 분가한 것이다).
 *
 * 🔴 **편의로라도 여기서 다시 export 하지 마라** — 한 줄만 다시 내보내도 끊어 놓은
 * 고리가 그 자리에서 되살아난다. 부르는 쪽이 그 파일을 직접 들여온다(지금 넷이다:
 * db/mappers/repair-case.ts · domain/local/resolved-repair-case.ts ·
 * domain/local/workflow/effective-repair-case.ts · db/queries/repair-case-overdue-
 * notifications.ts).
 */
