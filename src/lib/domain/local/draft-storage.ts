import { PRIORITY_CODES, WORKFLOW_TYPE_CODES, type Priority, type WorkflowType } from "../types";
import { formatDemoReferenceDateLabel } from "../demo-clock";
import { isValidDateString } from "./validation";

export const DRAFT_STORAGE_KEY = "dss-as-intake-draft-v1";

// 인수번호는 제출 시점에만 최종 확정되므로 초안에는 절대 저장하지 않는다.
// 인증/세션 관련 값도 저장하지 않는다(이 폼은 애초에 그런 값을 다루지 않는다).
export type IntakeDraftData = {
  workflowType: WorkflowType;
  customerId: string;
  endUserId: string | null;
  assignedEngineerId: string;
  priority: Priority;
  receivedAt: string;
  customerRequestedDueDate: string;
  internalTargetShipmentDate: string;
  modelName: string;
  lotNumber: string;
  serialNumber: string;
  partNumber: string;
  accessoryList: string;
  externalConditionSummary: string;
  reasonForRemoval: string;
  reportedSymptom: string;
  intakeInspectionResult: string;
  currentDiagnosisSummary: string;
  nextPlannedAction: string;
  notes: string;
  contactName: string;
  contactPhone: string;
  contactEmail: string;
};

export function createDefaultDraft(): IntakeDraftData {
  return {
    workflowType: "MATCHER",
    customerId: "",
    endUserId: null,
    assignedEngineerId: "",
    priority: "NORMAL",
    receivedAt: formatDemoReferenceDateLabel(),
    customerRequestedDueDate: "",
    internalTargetShipmentDate: "",
    modelName: "",
    lotNumber: "",
    serialNumber: "",
    partNumber: "",
    accessoryList: "",
    externalConditionSummary: "",
    reasonForRemoval: "",
    reportedSymptom: "",
    intakeInspectionResult: "",
    currentDiagnosisSummary: "",
    nextPlannedAction: "",
    notes: "",
    contactName: "",
    contactPhone: "",
    contactEmail: "",
  };
}

function isPlainString(value: unknown): value is string {
  return typeof value === "string";
}

/**
 * 초안은 "미완성"이 정상 상태이므로, 레코드 하나가 깨졌다고 초안 전체를
 * 버리지 않는다 — 필드 단위로 검증하고, 잘못된 필드만 기본값으로 되돌린다.
 */
export function sanitizeDraft(raw: unknown): IntakeDraftData {
  const fallback = createDefaultDraft();
  if (typeof raw !== "object" || raw === null) return fallback;
  const r = raw as Record<string, unknown>;

  const draft = { ...fallback };

  if (isPlainString(r.workflowType) && (WORKFLOW_TYPE_CODES as readonly string[]).includes(r.workflowType)) {
    draft.workflowType = r.workflowType as WorkflowType;
  }
  if (isPlainString(r.customerId)) draft.customerId = r.customerId;
  if (r.endUserId === null || isPlainString(r.endUserId)) {
    draft.endUserId = (r.endUserId as string | null) ?? null;
  }
  if (isPlainString(r.assignedEngineerId)) draft.assignedEngineerId = r.assignedEngineerId;
  if (isPlainString(r.priority) && (PRIORITY_CODES as readonly string[]).includes(r.priority)) {
    draft.priority = r.priority as Priority;
  }
  if (isPlainString(r.receivedAt) && (r.receivedAt === "" || isValidDateString(r.receivedAt))) {
    draft.receivedAt = r.receivedAt;
  }
  if (
    isPlainString(r.customerRequestedDueDate) &&
    (r.customerRequestedDueDate === "" || isValidDateString(r.customerRequestedDueDate))
  ) {
    draft.customerRequestedDueDate = r.customerRequestedDueDate;
  }
  if (
    isPlainString(r.internalTargetShipmentDate) &&
    (r.internalTargetShipmentDate === "" || isValidDateString(r.internalTargetShipmentDate))
  ) {
    draft.internalTargetShipmentDate = r.internalTargetShipmentDate;
  }

  const textFields = [
    "modelName",
    "lotNumber",
    "serialNumber",
    "partNumber",
    "accessoryList",
    "externalConditionSummary",
    "reasonForRemoval",
    "reportedSymptom",
    "intakeInspectionResult",
    "currentDiagnosisSummary",
    "nextPlannedAction",
    "notes",
    "contactName",
    "contactPhone",
    "contactEmail",
  ] as const;
  for (const field of textFields) {
    if (isPlainString(r[field])) {
      draft[field] = r[field] as string;
    }
  }

  return draft;
}

type DraftEnvelope = {
  version: 1;
  draft: IntakeDraftData;
  savedAt: string;
};

function isBrowser(): boolean {
  return typeof window !== "undefined";
}

export function readDraft(): { draft: IntakeDraftData; savedAt: string | null } {
  if (!isBrowser()) return { draft: createDefaultDraft(), savedAt: null };

  const raw = window.localStorage.getItem(DRAFT_STORAGE_KEY);
  if (raw === null) return { draft: createDefaultDraft(), savedAt: null };

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { draft: createDefaultDraft(), savedAt: null };
  }
  if (typeof parsed !== "object" || parsed === null) {
    return { draft: createDefaultDraft(), savedAt: null };
  }
  const envelope = parsed as Record<string, unknown>;
  if (envelope.version !== 1) {
    return { draft: createDefaultDraft(), savedAt: null };
  }

  const savedAt = isPlainString(envelope.savedAt) ? envelope.savedAt : null;
  return { draft: sanitizeDraft(envelope.draft), savedAt };
}

export function writeDraft(draft: IntakeDraftData): string {
  const savedAt = new Date().toISOString();
  const envelope: DraftEnvelope = { version: 1, draft, savedAt };
  if (isBrowser()) {
    window.localStorage.setItem(DRAFT_STORAGE_KEY, JSON.stringify(envelope));
  }
  return savedAt;
}

export function clearDraft(): void {
  if (isBrowser()) {
    window.localStorage.removeItem(DRAFT_STORAGE_KEY);
  }
}

export function isDraftEmpty(draft: IntakeDraftData): boolean {
  const defaults = createDefaultDraft();
  return (
    draft.customerId === "" &&
    draft.endUserId === null &&
    draft.assignedEngineerId === "" &&
    draft.modelName === "" &&
    draft.lotNumber === "" &&
    draft.serialNumber === "" &&
    draft.internalTargetShipmentDate === "" &&
    draft.customerRequestedDueDate === "" &&
    draft.partNumber === "" &&
    draft.accessoryList === "" &&
    draft.externalConditionSummary === "" &&
    draft.reasonForRemoval === "" &&
    draft.reportedSymptom === "" &&
    draft.intakeInspectionResult === "" &&
    draft.currentDiagnosisSummary === "" &&
    draft.nextPlannedAction === "" &&
    draft.notes === "" &&
    draft.contactName === "" &&
    draft.contactPhone === "" &&
    draft.contactEmail === "" &&
    draft.workflowType === defaults.workflowType &&
    draft.priority === defaults.priority
  );
}
