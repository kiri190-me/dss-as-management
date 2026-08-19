import { mockCustomers, mockEndUsers, mockUsers, workflowSteps } from "../mock-data";
import type { BillingType, Priority, WorkflowType } from "../types";
import { appendLocalCase, getLocalCasesSnapshot } from "./local-case-storage";
import { generateFinalIntakeNumber, isIntakeNumberTaken, isValidIntakeNumberFormat } from "./intake-number";
import { resolveOrCreateLocalCustomer, resolveOrCreateLocalEndUser } from "./local-entity-resolve";
import { generateLocalCaseId, type LocalRepairCase } from "./local-types";
import { validateLocalRepairCase } from "./validation";

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
   * 배타적이다. 로컬 모드(submitNewLocalCase)는 product_models 개념 자체가
   * 없으므로 이 두 값을 절대 읽지 않는다 — optional인 이유는 그 경로와
   * 기존 호출부(통합 테스트 등)가 계속 modelName 자유 입력만으로 동작하게
   * 두기 위함이다. DB 모드(validateCreateRepairCaseInput)만 이 값을
   * 필수로 재해석한다.
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
   * "use the existing auto-generation" (generateFinalIntakeNumber), a
   * non-empty string means the user replaced the suggested value and THAT
   * exact value must be what gets saved. Format/duplicate are re-validated
   * server-side (submitNewLocalCase here; validateCreateRepairCaseInput +
   * the mutation layer for database mode) — never trusted from the client
   * alone, same discipline as every other field here.
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
   * 같은 원칙). submitNewLocalCase는 undefined를 null로 정규화해 그대로
   * 저장한다 — 실제 작업 내역(운영값)은 이제 [작업내용]에서만 입력된다.
   */
  intakeInspectionResult?: string | null;
  currentDiagnosisSummary?: string | null;
  nextPlannedAction?: string | null;
  notes: string | null;
  contactName: string | null;
  contactPhone: string | null;
  contactEmail: string | null;
};

export type SubmitIntakeResult =
  | { ok: true; repairCase: LocalRepairCase }
  | {
      ok: false;
      reason:
        | "INVALID_CUSTOMER"
        | "INVALID_END_USER"
        | "INVALID_ENGINEER"
        | "SEQUENCE_EXHAUSTED"
        | "STORAGE_CONFLICT"
        | "INTAKE_NUMBER_INVALID_FORMAT"
        | "INTAKE_NUMBER_DUPLICATE";
    };

function resolveIntakeInspectionStepKey(workflowType: WorkflowType): string | null {
  const step = workflowSteps.find(
    (s) => s.workflowType === workflowType && s.key === "intake_inspection"
  );
  return step?.key ?? null;
}

/**
 * 접수 폼 "제출" 버튼 핸들러에서 호출되는 단일 진입점이다. localStorage를
 * 새로 읽고 -> 관계(고객/End-User/엔지니어) 재검증 -> 인수번호 재계산/중복
 * 재확인 -> 레코드 생성 -> 자체 검증 -> 저장까지를 한 번에 수행한다.
 * 이 전체 절차는 하나의 동기 함수 안에서 실행되어 같은 탭 내에서는 사실상
 * 원자적이지만, 여러 탭이 동시에 쓰는 경우까지 안전하지는 않다(데모 한정).
 */
export function submitNewLocalCase(input: IntakeSubmissionInput): SubmitIntakeResult {
  const freshLocalCases = getLocalCasesSnapshot();

  let customer: { id: string; name: string };
  if (input.customerId) {
    const existingMock = mockCustomers.find((c) => c.id === input.customerId);
    if (existingMock) {
      customer = existingMock;
    } else {
      // 이전 로컬 접수에서 이미 새로 만들어진 고객사일 수 있다 — 그 접수
      // 건 자체의 스냅샷에서만 신뢰할 수 있는 (id, name) 쌍을 찾는다(임의의
      // customerId를 그대로 믿지 않는다).
      const existingLocal = freshLocalCases.find((c) => c.customerId === input.customerId);
      if (!existingLocal) return { ok: false, reason: "INVALID_CUSTOMER" };
      customer = { id: existingLocal.customerId, name: existingLocal.customerNameSnapshot };
    }
  } else if (input.newCustomerName?.trim()) {
    customer = resolveOrCreateLocalCustomer(
      input.newCustomerName,
      mockCustomers,
      freshLocalCases
    );
  } else {
    return { ok: false, reason: "INVALID_CUSTOMER" };
  }

  let endUser: { id: string; name: string } | null = null;
  if (input.endUserId) {
    const existingMock = mockEndUsers.find((e) => e.id === input.endUserId);
    if (existingMock) {
      if (existingMock.customerId !== customer.id) {
        return { ok: false, reason: "INVALID_END_USER" };
      }
      endUser = existingMock;
    } else {
      const existingLocal = freshLocalCases.find(
        (c) => c.endUserId === input.endUserId && c.customerId === customer.id
      );
      if (!existingLocal || !existingLocal.endUserNameSnapshot) {
        return { ok: false, reason: "INVALID_END_USER" };
      }
      endUser = { id: existingLocal.endUserId as string, name: existingLocal.endUserNameSnapshot };
    }
  } else if (input.newEndUserName?.trim()) {
    endUser = resolveOrCreateLocalEndUser(
      input.newEndUserName,
      customer.id,
      mockEndUsers,
      freshLocalCases
    );
  }

  let engineer: ReturnType<typeof mockUsers.find> = undefined;
  if (input.assignedEngineerId !== null) {
    engineer = mockUsers.find((u) => u.id === input.assignedEngineerId);
    if (!engineer || engineer.role !== "AS_ENGINEER" || engineer.approvalStatus !== "APPROVED") {
      return { ok: false, reason: "INVALID_ENGINEER" };
    }
  }

  const stepKey = resolveIntakeInspectionStepKey(input.workflowType);
  if (!stepKey) return { ok: false, reason: "INVALID_ENGINEER" };

  const intakeNumberOverride = input.intakeNumber?.trim() || null;
  let intakeNumber: string;
  if (intakeNumberOverride) {
    if (!isValidIntakeNumberFormat(intakeNumberOverride)) {
      return { ok: false, reason: "INTAKE_NUMBER_INVALID_FORMAT" };
    }
    if (isIntakeNumberTaken(intakeNumberOverride, freshLocalCases)) {
      return { ok: false, reason: "INTAKE_NUMBER_DUPLICATE" };
    }
    intakeNumber = intakeNumberOverride;
  } else {
    const generated = generateFinalIntakeNumber(input.receivedAt, freshLocalCases);
    if (!generated.ok) return { ok: false, reason: "SEQUENCE_EXHAUSTED" };
    intakeNumber = generated.intakeNumber;
  }

  const repairCase: LocalRepairCase = {
    id: generateLocalCaseId(),
    intakeNumber,
    legacyReportNumber: input.legacyReportNumber?.trim() || null,
    workflowType: input.workflowType,
    billingType: input.billingType,
    status: "WAITING_INTAKE_INSPECTION",
    priority: input.priority,
    currentWorkflowStepKey: stepKey,
    receivedAt: input.receivedAt,
    customerRequestedDueDate: input.customerRequestedDueDate,
    internalTargetShipmentDate: input.internalTargetShipmentDate,
    actualShipmentDate: null,
    exceptionStatus: null,
    createdAt: new Date().toISOString(),
    customerId: customer.id,
    customerNameSnapshot: customer.name,
    endUserId: endUser?.id ?? null,
    endUserNameSnapshot: endUser?.name ?? null,
    assignedEngineerId: engineer?.id ?? null,
    assignedEngineerNameSnapshot: engineer?.name ?? null,
    modelName: input.modelName.trim(),
    lotNumber: input.lotNumber.trim(),
    serialNumber: input.serialNumber.trim(),
    partNumber: input.partNumber?.trim() || null,
    accessoryList: input.accessoryList?.trim() || null,
    externalConditionSummary: input.externalConditionSummary?.trim() || null,
    reasonForRemoval: input.reasonForRemoval?.trim() || null,
    reportedSymptom: input.reportedSymptom?.trim() || null,
    intakeInspectionResult: input.intakeInspectionResult?.trim() || null,
    currentDiagnosisSummary: input.currentDiagnosisSummary?.trim() || null,
    nextPlannedAction: input.nextPlannedAction?.trim() || null,
    notes: input.notes?.trim() || null,
    contactName: input.contactName?.trim() || null,
    contactPhone: input.contactPhone?.trim() || null,
    contactEmail: input.contactEmail?.trim() || null,
  };

  // 방어적 재검증: 위에서 만든 레코드가 저장소 검증 규칙 자체를 통과하는지
  // 다시 한번 확인한다(검증 로직이 단일 소스로 유지되도록).
  if (!validateLocalRepairCase(repairCase)) {
    return { ok: false, reason: "STORAGE_CONFLICT" };
  }

  const appendResult = appendLocalCase(repairCase);
  if (!appendResult.ok) {
    return { ok: false, reason: "STORAGE_CONFLICT" };
  }

  return { ok: true, repairCase };
}
