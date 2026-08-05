import { DEMO_REFERENCE_DATE } from "@/lib/domain/demo-clock";
import {
  isRepairCaseOverdue,
  paidOrWarrantyLabels,
  productCategoryLabels,
  type ExceptionStatus,
  type WorkflowType,
} from "@/lib/domain/types";
import type { ResolvedRepairCase } from "@/lib/domain/local/resolved-repair-case";
import { deriveRepairStatus } from "./repair-status";

/**
 * Flat shape produced by the single joined query in
 * src/lib/db/queries/repair-cases.ts. Deliberately a plain structural type
 * (no drizzle-orm import here) so this mapper stays a pure function with no
 * DB/React dependency, and so no Drizzle row/table type ever needs to leak
 * past this file.
 */
export type RepairCaseJoinRow = {
  id: string;
  version: number;
  intakeNumber: string;
  customerId: string;
  customerName: string;
  endUserId: string | null;
  endUserName: string | null;
  productId: string;
  modelName: string;
  lotNumber: string | null;
  serialNumber: string | null;
  partNumber: string | null;
  assignedEngineerId: string | null;
  engineerName: string | null;
  workflowTypeCode: WorkflowType;
  currentWorkflowStepKey: string;
  exceptionStatusCode: string | null;
  receivedAt: string;
  customerRequestedDueDate: string | null;
  internalTargetInspectionCompletionDate: string | null;
  internalTargetShipmentDate: string | null;
  actualShipmentDate: string | null;
  reportedSymptom: string | null;
  intakeInspectionResult: string | null;
  currentDiagnosisSummary: string | null;
  nextPlannedAction: string | null;
  accessoryList: string | null;
  externalConditionSummary: string | null;
  reasonForRemoval: string | null;
  notes: string | null;
  contactNameSnapshot: string | null;
  contactPhoneSnapshot: string | null;
  contactEmailSnapshot: string | null;
  createdAt: Date;
};

/**
 * Maps one joined DB row to the existing ResolvedRepairCase shape
 * (source: "DATABASE"). Pure function, no mutation, no logging of its own —
 * callers are responsible for not logging the row (it may contain the
 * contact-snapshot PII columns; see repair-cases.ts schema comment).
 *
 * `priority` has no DB column (excluded from the schema in the Gate 4
 * correction batches) and is fixed to "NORMAL" as a non-persisted display
 * placeholder — it is never read back from this value, never implies a
 * real triage decision was made, and does not affect status derivation.
 */
export function mapRepairCaseRow(
  row: RepairCaseJoinRow,
  referenceDate: Date = DEMO_REFERENCE_DATE
): ResolvedRepairCase {
  const status = deriveRepairStatus({
    repairCaseId: row.id,
    workflowType: row.workflowTypeCode,
    currentStepKey: row.currentWorkflowStepKey,
  });

  const createdAtIso = row.createdAt.toISOString();

  return {
    id: row.id,
    version: row.version,
    source: "DATABASE",
    productId: row.productId,
    intakeNumber: row.intakeNumber,
    workflowType: row.workflowTypeCode,
    status,
    priority: "NORMAL",
    exceptionStatus: row.exceptionStatusCode as ExceptionStatus | null,
    currentWorkflowStepKey: row.currentWorkflowStepKey,
    receivedAt: row.receivedAt,
    customerRequestedDueDate: row.customerRequestedDueDate,
    internalTargetInspectionCompletionDate: row.internalTargetInspectionCompletionDate,
    internalTargetShipmentDate: row.internalTargetShipmentDate,
    actualShipmentDate: row.actualShipmentDate,
    createdAt: createdAtIso,
    isOverdue: isRepairCaseOverdue(
      { status, internalTargetShipmentDate: row.internalTargetShipmentDate },
      referenceDate
    ),
    productCategory: productCategoryLabels[row.workflowTypeCode],
    paidOrWarranty: paidOrWarrantyLabels[row.workflowTypeCode],
    modelName: row.modelName,
    lotNumber: row.lotNumber ?? "-",
    serialNumber: row.serialNumber ?? "-",
    partNumber: row.partNumber,
    customerId: row.customerId,
    customerName: row.customerName,
    endUserId: row.endUserId,
    endUserName: row.endUserName,
    assignedEngineerId: row.assignedEngineerId,
    engineerName: row.engineerName,
    reportedSymptom: row.reportedSymptom,
    intakeInspectionResult: row.intakeInspectionResult,
    currentDiagnosisSummary: row.currentDiagnosisSummary,
    nextPlannedAction: row.nextPlannedAction,
    accessoryList: row.accessoryList,
    externalConditionSummary: row.externalConditionSummary,
    reasonForRemoval: row.reasonForRemoval,
    notes: row.notes,
    contactName: row.contactNameSnapshot,
    contactPhone: row.contactPhoneSnapshot,
    contactEmail: row.contactEmailSnapshot,
  };
}
