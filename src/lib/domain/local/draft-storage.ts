import type { BillingType, Priority, WorkflowType } from "../types";
import { addCalendarDays, toKstDateOnly } from "../date-only";
import { isValidDateString } from "./validation";

/** 사내 목표 검수 완료일의 기본값 오프셋(A/S 접수 일정 체크포인트) — 인수일 + 14일. */
export const DEFAULT_TARGET_INSPECTION_COMPLETION_OFFSET_DAYS = 14;

// 초안은 오직 현재 페이지 세션(메모리)에만 존재한다 — localStorage에 쓰지도,
// 새로고침 후 복원하지도 않는다(A/S INTAKE UX 체크포인트: 새로고침은 항상
// 빈 폼에서 시작). 인수번호는 이전부터도 여기 저장하지 않았다(제출 시점에만
// 최종 확정). 인증/세션 관련 값도 다루지 않는다.
export type IntakeDraftData = {
  workflowType: WorkflowType;
  // 유상/무상 — workflowType과 독립된 필수 선택 값이다(migration 0021).
  // ""는 "아직 선택 안 함"이다 — workflowType 변경 시 편의상 기본값을
  // 채워줄 수 있지만, 사용자가 이미 선택한 값은 절대 덮어쓰지 않는다
  // (IntakeFormInner.tsx의 handleWorkflowTypeChange 참고).
  billingType: BillingType | "";
  /**
   * 보고서번호 — 자동 채번이 없는 순수 수기 입력값이다(인수번호와 다르다).
   * 인수번호 override는 제출 시점에만 확정되므로 초안에 담지 않지만, 이
   * 값은 다른 일반 입력 필드들과 똑같이 초안에 남는다 — "지우기"/작성 중
   * 이탈 경고(isDraftEmpty)가 다른 필드와 동일하게 이 값도 본다.
   */
  legacyReportNumber: string;
  customerId: string;
  // 고객사 콤보박스에 실제로 입력된 문자열 — customerId는 이 값이 기존
  // 고객사 이름과 일치할 때만 채워지는 "해석된" 값이다(IntakeFormInner.tsx의
  // handleCustomerNameChange 참고).
  customerName: string;
  // 사용자가 "새 고객사로 등록"을 명시적으로 눌렀는지 여부다 — customerId가
  // 비어 있어도(=기존 매칭 없음) 이 값이 true면 제출 시 customerName으로
  // 새 고객사를 생성한다. 텍스트가 바뀌면 매 키 입력마다 false로 되돌아가
  // 다시 명시적으로 눌러야 한다(자동으로 새로 만들지 않기 위함).
  customerCreateNew: boolean;
  endUserId: string | null;
  // customerName과 같은 관계: endUserId는 이 텍스트가 현재 고객사의 기존
  // End-User 이름과 일치할 때만 채워진다.
  endUserName: string;
  // customerCreateNew와 같은 원칙 — End-User 버전.
  endUserCreateNew: boolean;
  assignedEngineerId: string;
  priority: Priority;
  receivedAt: string;
  customerRequestedDueDate: string;
  /**
   * 사내 목표 검수 완료일 — 기본값은 receivedAt + 14일(아래
   * DEFAULT_TARGET_INSPECTION_COMPLETION_OFFSET_DAYS)이며,
   * internalTargetInspectionCompletionDateTouched가 false인 동안은
   * receivedAt이 바뀔 때마다 IntakeFormInner.tsx의 handleReceivedAtChange가
   * 자동으로 다시 계산해 채운다. 사용자가 이 필드를 한 번이라도 직접
   * 손대면(빈 문자열로 지우는 것 포함) touched가 true로 바뀌고, 그 뒤로는
   * receivedAt이 바뀌어도 절대 덮어쓰지 않는다 — 폼을 다시 마운트(새로고침/
   * "지우기")해야만 초기화된다.
   */
  internalTargetInspectionCompletionDate: string;
  internalTargetInspectionCompletionDateTouched: boolean;
  internalTargetShipmentDate: string;
  modelName: string;
  // Product Model Master 연결 체크포인트 — DB 모드에서만 의미 있다(콤보박스가
  // 채운다). customerId/customerCreateNew와 정확히 같은 원칙: productModelId는
  // modelName 텍스트가 기존 product_models와 정규화 일치할 때만 채워지는
  // "해석된" 값이고, productModelCreateNew는 "새 모델로 등록"을 명시적으로
  // 눌렀는지 여부다. 로컬 모드는 이 두 값을 절대 읽지 않는다(modelName
  // 자유 입력 그대로 제출).
  productModelId: string;
  productModelCreateNew: boolean;
  lotNumber: string;
  serialNumber: string;
  partNumber: string;
  accessoryList: string;
  externalConditionSummary: string;
  reasonForRemoval: string;
  reportedSymptom: string;
  notes: string;
  contactName: string;
  contactPhone: string;
  contactEmail: string;
};

export function createDefaultDraft(): IntakeDraftData {
  // 인수일 기본값은 한국 기준 오늘이다. 폼은 useIsHydrated() 게이트 뒤에서만
  // 마운트되므로 이 new Date()는 브라우저에서만 실행된다.
  const receivedAt = toKstDateOnly(new Date());
  return {
    workflowType: "PAID_MATCHER",
    billingType: "",
    legacyReportNumber: "",
    customerId: "",
    customerName: "",
    customerCreateNew: false,
    endUserId: null,
    endUserName: "",
    endUserCreateNew: false,
    assignedEngineerId: "",
    priority: "NORMAL",
    receivedAt,
    customerRequestedDueDate: "",
    internalTargetInspectionCompletionDate: nextTargetInspectionCompletionDate({
      newReceivedAt: receivedAt,
      touched: false,
      currentValue: "",
    }),
    internalTargetInspectionCompletionDateTouched: false,
    internalTargetShipmentDate: "",
    modelName: "",
    productModelId: "",
    productModelCreateNew: false,
    lotNumber: "",
    serialNumber: "",
    partNumber: "",
    accessoryList: "",
    externalConditionSummary: "",
    reasonForRemoval: "",
    reportedSymptom: "",
    notes: "",
    contactName: "",
    contactPhone: "",
    contactEmail: "",
  };
}

/**
 * Pure decision for what internalTargetInspectionCompletionDate should
 * become when receivedAt changes — IntakeFormInner.tsx's
 * handleReceivedAtChange calls this rather than duplicating the logic.
 * Untouched: recompute to the new receivedAt + 14 days (or "" while
 * receivedAt is mid-typing/not yet a valid date). Touched: the current
 * value is returned completely unchanged — once the user has explicitly
 * edited this field (including clearing it to ""), no later receivedAt
 * change may silently overwrite it again.
 */
export function nextTargetInspectionCompletionDate(params: {
  newReceivedAt: string;
  touched: boolean;
  currentValue: string;
}): string {
  if (params.touched) return params.currentValue;
  return isValidDateString(params.newReceivedAt)
    ? addCalendarDays(params.newReceivedAt, DEFAULT_TARGET_INSPECTION_COMPLETION_OFFSET_DAYS)
    : "";
}

export function isDraftEmpty(draft: IntakeDraftData): boolean {
  const defaults = createDefaultDraft();
  return (
    draft.billingType === "" &&
    draft.legacyReportNumber === "" &&
    draft.customerId === "" &&
    draft.customerName === "" &&
    draft.customerCreateNew === false &&
    draft.endUserId === null &&
    draft.endUserName === "" &&
    draft.endUserCreateNew === false &&
    draft.assignedEngineerId === "" &&
    draft.modelName === "" &&
    draft.productModelId === "" &&
    draft.productModelCreateNew === false &&
    draft.lotNumber === "" &&
    draft.serialNumber === "" &&
    draft.internalTargetShipmentDate === "" &&
    draft.customerRequestedDueDate === "" &&
    draft.partNumber === "" &&
    draft.accessoryList === "" &&
    draft.externalConditionSummary === "" &&
    draft.reasonForRemoval === "" &&
    draft.reportedSymptom === "" &&
    draft.notes === "" &&
    draft.contactName === "" &&
    draft.contactPhone === "" &&
    draft.contactEmail === "" &&
    draft.workflowType === defaults.workflowType &&
    draft.priority === defaults.priority
  );
}
