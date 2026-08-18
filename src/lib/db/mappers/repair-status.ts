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

/**
 * Phase 2c — 상태를 DB에서 읽은 값으로 확정한다.
 *
 * deriveRepairStatus(아래 유지)가 TS 표를 조회해 상태를 만들어냈다면, 이
 * 함수는 이미 읽어 온 workflow_steps.repair_status를 그대로 쓴다. 값이 비어
 * 있을 때의 동작은 완전히 같다 — 기본값을 지어내지 않고
 * UnmappedWorkflowStepError를 던진다. 상태가 없는 단계에 놓인 접수 건을
 * 조용히 목록에서 빼거나 임의의 상태로 보여주면, 데이터가 잘못된 사실이
 * 아무에게도 드러나지 않는다.
 *
 * deriveRepairStatus는 로컬(mock) 모드와 기존 테스트가 계속 쓰므로 남겨 둔다.
 */
export function resolveRepairStatusFromStep(input: {
  repairCaseId: string;
  workflowType: WorkflowType;
  currentStepKey: string;
  stepRepairStatus: RepairStatus | null;
}): RepairStatus {
  if (!input.stepRepairStatus) {
    throw new UnmappedWorkflowStepError({
      repairCaseId: input.repairCaseId,
      workflowType: input.workflowType,
      currentStepKey: input.currentStepKey,
    });
  }
  return input.stepRepairStatus;
}
