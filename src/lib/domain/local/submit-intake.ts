import { mockCustomers, mockEndUsers, mockUsers, workflowSteps } from "../mock-data";
import type { Priority, WorkflowType } from "../types";
import { appendLocalCase, getLocalCasesSnapshot } from "./local-case-storage";
import { generateFinalIntakeNumber } from "./intake-number";
import { generateLocalCaseId, type LocalRepairCase } from "./local-types";
import { validateLocalRepairCase } from "./validation";

export type IntakeSubmissionInput = {
  workflowType: WorkflowType;
  customerId: string;
  endUserId: string | null;
  assignedEngineerId: string;
  priority: Priority;
  receivedAt: string;
  customerRequestedDueDate: string | null;
  internalTargetShipmentDate: string;
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

export type SubmitIntakeResult =
  | { ok: true; repairCase: LocalRepairCase }
  | {
      ok: false;
      reason: "INVALID_CUSTOMER" | "INVALID_END_USER" | "INVALID_ENGINEER" | "SEQUENCE_EXHAUSTED" | "STORAGE_CONFLICT";
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
  const customer = mockCustomers.find((c) => c.id === input.customerId);
  if (!customer) return { ok: false, reason: "INVALID_CUSTOMER" };

  let endUser: ReturnType<typeof mockEndUsers.find> = undefined;
  if (input.endUserId !== null) {
    endUser = mockEndUsers.find((e) => e.id === input.endUserId);
    if (!endUser || endUser.customerId !== input.customerId) {
      return { ok: false, reason: "INVALID_END_USER" };
    }
  }

  const engineer = mockUsers.find((u) => u.id === input.assignedEngineerId);
  if (!engineer || engineer.role !== "AS_ENGINEER" || engineer.approvalStatus !== "APPROVED") {
    return { ok: false, reason: "INVALID_ENGINEER" };
  }

  const stepKey = resolveIntakeInspectionStepKey(input.workflowType);
  if (!stepKey) return { ok: false, reason: "INVALID_ENGINEER" };

  const freshLocalCases = getLocalCasesSnapshot();
  const generated = generateFinalIntakeNumber(input.receivedAt, freshLocalCases);
  if (!generated.ok) return { ok: false, reason: "SEQUENCE_EXHAUSTED" };

  const repairCase: LocalRepairCase = {
    id: generateLocalCaseId(),
    intakeNumber: generated.intakeNumber,
    workflowType: input.workflowType,
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
    assignedEngineerId: engineer.id,
    assignedEngineerNameSnapshot: engineer.name,
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
