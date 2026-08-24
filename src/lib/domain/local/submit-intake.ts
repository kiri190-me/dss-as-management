import type { BillingType, Priority, WorkflowType } from "../types";

/**
 * A/S 접수 폼이 제출하는 입력의 모양이다. 파일 이름과 위치(local/)는 이 타입이
 * 처음 만들어진 데모 접수 경로에서 유래했지만, 그 경로(submitNewLocalCase)는
 * 제거됐고 지금 이 타입을 쓰는 것은 DB 경로뿐이다 — IntakeFormInner.tsx가
 * 채우고, createRepairCase 액션/서비스가 받고, validateCreateRepairCaseInput이
 * 검증한다. 타입만 남은 모듈이므로 런타임 코드는 없다.
 */
export type IntakeSubmissionInput = {
  workflowType: WorkflowType;
  /**
   * 유상/무상 — workflowType과 독립적으로 필수 선택된다(migration 0021).
   * IntakeFormInner.tsx는 이 값을 항상 실제 선택 결과로 채워 넘긴다 — 절대
   * workflowType으로부터 재유도하지 않는다.
   */
  billingType: BillingType;
  /**
   * 고객사 해석 — customerId(기존 고객사 재사용)와 newCustomerName(자유
   * 입력으로 새 고객사를 명시적으로 등록)은 상호 배타적이다. IntakeFormInner
   * .tsx가 콤보박스 상태로부터 정확히 둘 중 하나만 채워 넘긴다 — 매 키 입력마다
   * 자동으로 새로 만들지 않고, "새 고객사로 등록" 버튼을 명시적으로 눌렀을
   * 때만 newCustomerName이 채워진다. 서버(local/DB 양쪽)는 두 값 모두 다시
   * 정규화/검증한다 — 클라이언트를 신뢰하지 않는다.
   */
  customerId: string | null;
  /** customerId가 없을 때만 의미 있다 — 명시적으로 확인된 "새 고객사" 이름. */
  newCustomerName?: string | null;
  /**
   * Product Model Master 연결 체크포인트 — customerId/newCustomerName과
   * 정확히 같은 원칙이다: productModelId(기존 product_models 재사용)와
   * newProductModelName(자유 입력으로 새 Model을 명시적으로 등록)은 상호
   * 배타적이다. optional인 이유는 이 타입을 직접 만드는 기존 호출부(통합
   * 테스트 등)가 계속 modelName 자유 입력만으로 동작하게 두기 위함이다 —
   * validateCreateRepairCaseInput이 이 값을 필수로 재해석한다.
   */
  productModelId?: string | null;
  /** productModelId가 없을 때만 의미 있다 — SUPER_ADMIN/ADMIN만 명시적으로 채울 수 있다(create-repair-case.ts가 재확인). */
  newProductModelName?: string | null;
  endUserId: string | null;
  /** customerId/newCustomerName과 같은 원칙 — endUserId가 없을 때만 의미 있다. */
  newEndUserName?: string | null;
  assignedEngineerId: string | null;
  priority: Priority;
  receivedAt: string;
  customerRequestedDueDate: string | null;
  internalTargetShipmentDate: string | null;
  /**
   * 사내 목표 검수 완료일 — A/S 접수 일정 체크포인트부터 [일정] 섹션에서
   * 직접 입력받는다. IntakeFormInner.tsx의 draft가 기본값(인수일 + 14일)을
   * 계산해 채우고, 사용자가 명시적으로 손대면 그 이후로는 인수일 변경에도
   * 다시 덮어쓰지 않는다(draft-storage.ts의
   * internalTargetInspectionCompletionDateTouched 참고) — 이 타입/이 함수
   * 자체는 그 로직을 모르고, 제출된 최종 값만 받는다. Optional인 이유는
   * intakeNumber와 같다 — 이 타입을 직접 만드는 기존 호출부가 영향받지
   * 않게 하기 위함이다.
   */
  internalTargetInspectionCompletionDate?: string | null;
  /**
   * Manual override for the auto-generated 인수번호 — omitted/null means
   * "use the existing auto-generation" (repair_case_intake_sequences, in the
   * mutation layer), a non-empty string means the user replaced the suggested
   * value and THAT exact value must be what gets saved. Format/duplicate are
   * re-validated server-side (validateCreateRepairCaseInput + the mutation
   * layer) — never trusted from the client alone, same discipline as every
   * other field here.
   */
  intakeNumber?: string | null;
  /**
   * 보고서번호 — 사람이 직접 적는 선택 입력값이다. 인수번호와 달리 자동
   * 채번이 없고(형식 규칙도, 중복 검사도 없다), 비워두면 null로 저장된다.
   * Optional인 이유는 intakeNumber와 같다 — 이 타입을 직접 만드는 기존
   * 호출부(통합 테스트 등)가 영향을 받지 않게 하기 위함이다.
   */
  legacyReportNumber?: string | null;
  modelName: string;
  lotNumber: string;
  serialNumber: string;
  partNumber: string | null;
  accessoryList: string | null;
  externalConditionSummary: string | null;
  reasonForRemoval: string | null;
  reportedSymptom: string | null;
  /**
   * record_kind 분류 체크포인트부터 A/S 접수 폼에 이 3개 필드의 입력
   * 컨트롤이 없다 — 더 이상 클라이언트가 채워 보내지 않는다(항상
   * undefined). Optional로만 남겨둔 이유는 이 타입을 직접 만드는 기존
   * 호출부(통합 테스트 등)가 영향을 받지 않게 하기 위함이다(intakeNumber와
   * 같은 원칙) — 실제 작업 내역(운영값)은 이제 [작업내용]에서만 입력된다.
   */
  intakeInspectionResult?: string | null;
  currentDiagnosisSummary?: string | null;
  nextPlannedAction?: string | null;
  notes: string | null;
  contactName: string | null;
  contactPhone: string | null;
  contactEmail: string | null;
};
