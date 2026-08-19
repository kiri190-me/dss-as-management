import { DEMO_REFERENCE_DATE } from "@/lib/domain/demo-clock";
import {
  billingTypeLabels,
  isRepairCaseOverdue,
  productCategoryLabels,
  type BillingType,
  type ExceptionStatus,
  type Priority,
  type RepairStatus,
  type WorkflowType,
} from "@/lib/domain/types";
import type { ResolvedRepairCase } from "@/lib/domain/local/resolved-repair-case";
import { resolveRepairStatusFromStep } from "./repair-status";

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
  legacyReportNumber: string | null;
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
  billingType: BillingType | null;
  priority: Priority;
  currentWorkflowStepKey: string;
  /**
   * Phase 2c: 상태의 출처가 step-status-map.ts(TS 표)에서 DB의
   * workflow_steps.repair_status로 바뀌었다. 쿼리가 이미 workflow_steps를
   * 조인하고 있으므로 컬럼 하나를 더 고르는 것으로 끝난다.
   *
   * nullable인 것은 컬럼이 아직 NOT NULL로 승격되지 않았기 때문이다. 비어
   * 있으면 조용히 넘기지 않고 UnmappedWorkflowStepError로 실패한다 — 예전
   * 표에 매핑이 없을 때와 정확히 같은 동작이다.
   */
  currentWorkflowStepRepairStatus: RepairStatus | null;
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
 * Trash view row shape (Repair Case Trash + Restore checkpoint) — every
 * RepairCaseJoinRow column plus the 4 soft-delete metadata columns.
 * `deletedAt` stays nullable at the type level (it's the same nullable DB
 * column either way) even though a row only ever reaches this shape via
 * selectRepairCaseTrashJoin()'s `is_deleted = true` filter, where
 * softDeleteRepairCase guarantees deleted_at is always set in that same
 * update — mapRepairCaseTrashRow asserts the non-null invariant explicitly.
 */
export type RepairCaseTrashJoinRow = RepairCaseJoinRow & {
  deletedAt: Date | null;
  deleteReason: string | null;
  deletedByUserId: string | null;
  deletedByUserName: string | null;
};

/**
 * DB-only extension of ResolvedRepairCase for the trash list — never
 * produced by the mock/local resolvers (a local/draft repair case has no
 * server-side row and can never be soft-deleted), so this type lives here
 * rather than alongside ResolvedRepairCase's mock/local variants.
 */
export type TrashedRepairCase = ResolvedRepairCase & {
  deletedAt: string;
  deleteReason: string | null;
  deletedByUserId: string | null;
  deletedByUserName: string | null;
};

/**
 * Maps one joined DB row to the existing ResolvedRepairCase shape
 * (source: "DATABASE"). Pure function, no mutation, no logging of its own —
 * callers are responsible for not logging the row (it may contain the
 * contact-snapshot PII columns; see repair-cases.ts schema comment).
 *
 * `priority` now reads the real `repair_cases.priority` column (인수 정보
 * priority-editing checkpoint) — no longer a fixed "NORMAL" placeholder.
 * It still never affects status derivation (deriveRepairStatus/isOverdue
 * are computed independently of priority).
 */
export function mapRepairCaseRow(
  row: RepairCaseJoinRow,
  referenceDate: Date = DEMO_REFERENCE_DATE
): ResolvedRepairCase {
  const status = resolveRepairStatusFromStep({
    repairCaseId: row.id,
    workflowType: row.workflowTypeCode,
    currentStepKey: row.currentWorkflowStepKey,
    stepRepairStatus: row.currentWorkflowStepRepairStatus,
  });

  const createdAtIso = row.createdAt.toISOString();

  return {
    id: row.id,
    version: row.version,
    source: "DATABASE",
    productId: row.productId,
    intakeNumber: row.intakeNumber,
    legacyReportNumber: row.legacyReportNumber,
    workflowType: row.workflowTypeCode,
    status,
    priority: row.priority,
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
    // 라벨이 없으면 "-" — 도메인에서 없앤 레거시 코드가 만에 하나 조인되어도
    // undefined가 화면에 새어 나가지 않게 한다(db/workflow-type-column.ts 주석).
    productCategory: productCategoryLabels[row.workflowTypeCode] ?? "-",
    paidOrWarranty: row.billingType ? billingTypeLabels[row.billingType] : "-",
    billingType: row.billingType,
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

/** Maps one joined trash-list DB row (see RepairCaseTrashJoinRow) to TrashedRepairCase. */
export function mapRepairCaseTrashRow(
  row: RepairCaseTrashJoinRow,
  referenceDate: Date = DEMO_REFERENCE_DATE
): TrashedRepairCase {
  return {
    ...mapRepairCaseRow(row, referenceDate),
    // Non-null invariant: this row only ever reaches here via the trash
    // list's is_deleted=true filter, and softDeleteRepairCase always sets
    // deleted_at in that same update — see this file's RepairCaseTrashJoinRow
    // doc comment.
    deletedAt: row.deletedAt!.toISOString(),
    deleteReason: row.deleteReason,
    deletedByUserId: row.deletedByUserId,
    deletedByUserName: row.deletedByUserName,
  };
}
