import { getStepStatus, hasStepStatusMapping } from "@/lib/domain/local/workflow/step-status-map";
import type { RepairStatus, WorkflowType } from "@/lib/domain/types";

/**
 * Thrown when a (workflowType, currentStepKey) pair has no entry in the
 * existing step-status-map.ts lookup table. Per the approved Stage G-2
 * policy: never invent a default RepairStatus, never silently exclude only
 * the affected row — this must surface as a real error the caller cannot
 * ignore.
 *
 * Carries only repairCaseId/workflowType/currentStepKey — safe to log in
 * full. Never attach customer/End-User/contact/symptom/diagnosis/notes data
 * to this error or its logging.
 */
export class UnmappedWorkflowStepError extends Error {
  readonly repairCaseId: string;
  readonly workflowType: WorkflowType;
  readonly currentStepKey: string;

  constructor(input: {
    repairCaseId: string;
    workflowType: WorkflowType;
    currentStepKey: string;
  }) {
    super(
      `No RepairStatus mapping for workflowType="${input.workflowType}" currentStepKey="${input.currentStepKey}".`
    );
    this.name = "UnmappedWorkflowStepError";
    this.repairCaseId = input.repairCaseId;
    this.workflowType = input.workflowType;
    this.currentStepKey = input.currentStepKey;
  }
}

/**
 * Derives the flat RepairStatus for a repair case from its authoritative
 * workflow position, at read time only — never written back to the
 * database. Reuses the existing step-status-map.ts table (the same one
 * Stage E-1's client-only workflow-override layer already relies on) rather
 * than duplicating a second mapping.
 */
export function deriveRepairStatus(input: {
  repairCaseId: string;
  workflowType: WorkflowType;
  currentStepKey: string;
}): RepairStatus {
  if (!hasStepStatusMapping(input.workflowType, input.currentStepKey)) {
    throw new UnmappedWorkflowStepError(input);
  }
  // Safe: hasStepStatusMapping just confirmed this key exists in the table.
  return getStepStatus(input.workflowType, input.currentStepKey) as RepairStatus;
}
