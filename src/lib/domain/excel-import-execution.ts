import type { IntakeSubmissionInput } from "@/lib/domain/local/submit-intake";
import { deriveWorkflowType, type WorkflowKind } from "@/lib/domain/workflow-kind";
import type {
  ExcelImportNormalizedCandidateInput,
  ExcelImportRawCellInput,
} from "@/lib/domain/excel-import-preview";

export const EXCEL_IMPORT_EXECUTION_PARSER_VERSION =
  "repair-case-list-parser-v6";
export const EXCEL_IMPORT_EXECUTION_CHUNK_SIZE = 10;

export type ExcelImportExecutionBatchStatus =
  | "IMPORTING"
  | "PARTIAL_SUCCESS"
  | "COMPLETED"
  | "FAILED";

export type ExcelImportExecutionOutcomeCounts = {
  succeeded: number;
  failed: number;
  incomplete: number;
  excluded: number;
};

/** Derive lifecycle state from executable-row outcomes, not attempts alone. */
export function deriveExcelImportExecutionBatchStatus(
  counts: ExcelImportExecutionOutcomeCounts
): ExcelImportExecutionBatchStatus | null {
  if (counts.incomplete > 0) return "IMPORTING";
  if (counts.succeeded > 0 && counts.failed > 0) return "PARTIAL_SUCCESS";
  if (counts.succeeded > 0) return "COMPLETED";
  if (counts.failed > 0) return "FAILED";
  return null;
}

export type ExcelImportPreflightDisposition =
  | "EXECUTABLE"
  | "AUTO_EXCLUDED"
  | "CONFLICT"
  | "IMPORTED"
  | "FAILED";

export type ExcelImportPreflightReason = {
  code: string;
  kind: "EXCLUSION" | "CONFLICT" | "NOTICE";
  field?: string;
};

function text(value: string | null | undefined): string | null {
  const trimmed = value?.trim() ?? "";
  return trimmed && trimmed !== "-" ? trimmed : null;
}

export function workflowKindFromLegacyProductName(
  value: string | null
): WorkflowKind | null {
  const normalized = text(value)
    ?.normalize("NFKC")
    .replace(/[\s/_-]+/g, "")
    .toLowerCase();
  if (!normalized) return null;
  if (["매처", "매쳐", "메처", "메쳐", "matcher", "matchingbox", "mb"].includes(normalized)) {
    return "MATCHER";
  }
  if (["제너레이터", "generator", "rfg", "rfgenerator"].includes(normalized)) {
    return "GENERATOR";
  }
  if (["tc", "totalcontroller"].includes(normalized)) {
    return "TOTAL_CONTROLLER";
  }
  return null;
}

export function intakeYearMonthMismatch(
  intakeNumber: string | null,
  receivedDate: string | null
): boolean {
  if (!intakeNumber || !receivedDate) return false;
  const intake = intakeNumber.match(/^D(\d{2})(\d{2})\d{2}$/);
  const date = receivedDate.match(/^(\d{4})-(\d{2})-\d{2}$/);
  return !!intake && !!date && `${intake[1]}${intake[2]}` !== `${date[1].slice(2)}${date[2]}`;
}

export function missingExcelImportRequiredFields(
  candidate: ExcelImportNormalizedCandidateInput,
  rawColumns: Record<string, ExcelImportRawCellInput>
): string[] {
  const missing: string[] = [];
  if (!candidate.intakeNumber) missing.push("intakeNumber");
  if (!candidate.receivedDate) missing.push("receivedAt");
  if (!candidate.customerName) missing.push("customer");
  if (!candidate.productName) missing.push("workflowKind");
  if (!candidate.modelName) missing.push("modelName");
  if (!candidate.lotNumber) missing.push("lotNumber");
  if (!candidate.serialNumber) missing.push("serialNumber");
  // Formulas with no cached value are source conflicts, not ordinary blanks.
  for (const column of ["B", "C"] as const) {
    const cell = rawColumns[column];
    if (cell?.metadata?.formula && !cell.metadata.cachedFormulaValue) {
      const field = column === "B" ? "intakeNumber" : "receivedAt";
      const index = missing.indexOf(field);
      if (index >= 0) missing.splice(index, 1);
    }
  }
  return missing;
}

export function buildExcelImportIntakeInput(input: {
  candidate: ExcelImportNormalizedCandidateInput;
  rawColumns: Record<string, ExcelImportRawCellInput>;
  customerId: string | null;
  endUserId: string | null;
  productModelId: string | null;
  assignedEngineerId: string | null;
}): IntakeSubmissionInput | null {
  const { candidate, rawColumns } = input;
  const kind = workflowKindFromLegacyProductName(candidate.productName);
  const workflowType = kind
    ? deriveWorkflowType(kind, candidate.billingType)
    : null;
  if (
    !workflowType ||
    !candidate.billingType ||
    !candidate.intakeNumber ||
    !candidate.receivedDate ||
    !candidate.customerName ||
    !candidate.modelName ||
    !candidate.lotNumber ||
    !candidate.serialNumber
  ) {
    return null;
  }
  return {
    workflowType,
    billingType: candidate.billingType,
    customerId: input.customerId,
    newCustomerName: input.customerId ? null : candidate.customerName,
    endUserId: input.endUserId,
    newEndUserName:
      candidate.endUserName && !input.endUserId ? candidate.endUserName : null,
    productModelId: input.productModelId,
    newProductModelName: input.productModelId ? null : candidate.modelName,
    assignedEngineerId: input.assignedEngineerId,
    priority: "NORMAL",
    receivedAt: candidate.receivedDate,
    intakeNumber: candidate.intakeNumber,
    customerRequestedDueDate: null,
    internalTargetShipmentDate: null,
    internalTargetInspectionCompletionDate: null,
    modelName: candidate.modelName,
    lotNumber: candidate.lotNumber,
    serialNumber: candidate.serialNumber,
    partNumber: null,
    accessoryList: null,
    externalConditionSummary: null,
    reasonForRemoval: null,
    reportedSymptom: text(rawColumns.S?.value),
    notes: text(candidate.legacyNotes),
    contactName: null,
    contactPhone: null,
    contactEmail: null,
  };
}
