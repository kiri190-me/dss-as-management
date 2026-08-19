import "server-only";
import { workflowTypeCodeColumn } from "../workflow-type-column";
import { and, eq, sql } from "drizzle-orm";
import { db } from "../client";
import {
  repairCases,
  customers,
  endUsers,
  products,
  workflowSteps,
  workflowTemplates,
  workflowVersions,
  exceptionStatuses,
  repairCaseWorkRecords,
  statusChangeHistories,
  procedureCaseExecutionHistory,
  procedureCaseExecutions,
  inventoryPartRequests,
} from "../schema";
import { resolveRepairStatusFromStep } from "../mappers/repair-status";
import { productCategoryLabels, type BillingType, type ExceptionStatus, type RepairStatus, type WorkflowType } from "@/lib/domain/types";

/**
 * Phase 5C-3 — "내 담당 제품" / My Active Work. A dedicated query, not an
 * extension of listRepairCases(): this screen needs a server-side identity
 * filter, a derived-status exclusion, and two extra per-case aggregates
 * (last activity, active parts-request summary) that the global A/S list
 * has no use for — folding those into listRepairCases() would force every
 * other caller to pay for them.
 *
 * Security: takes only `actorId`, resolved server-side from the session by
 * the caller (repair-cases/mine/page.tsx) — this function has no parameter
 * an unauthenticated or spoofed request could use to see another
 * engineer's cases. There is no "engineerId" argument.
 */

export type MyActiveWorkRow = {
  id: string;
  intakeNumber: string;
  receivedAt: string;
  customerId: string;
  customerName: string;
  endUserName: string | null;
  productCategory: string;
  modelName: string;
  /** 유·무상. 전체 A/S 현황과 같은 "제품" 열을 만들기 위해 필요하다(미정이면 null). */
  billingType: BillingType | null;
  serialNumber: string;
  lotNumber: string;
  status: RepairStatus;
  currentWorkflowStepLabel: string;
  exceptionStatus: ExceptionStatus | null;
  internalTargetInspectionCompletionDate: string | null;
  internalTargetShipmentDate: string | null;
  customerRequestedDueDate: string | null;
  /** MAX(created_at) across repair_case_work_records (invalidated excluded), status_change_histories, and procedure_case_execution_history — null when none of the three has ever recorded activity for this case. */
  lastActivityAt: string | null;
  /** Most-actionable active (non-terminal) parts-request state for this case, or null when none is active. PENDING outranks PARTIALLY_ISSUED. */
  activePartsRequestStatus: "PENDING" | "PARTIALLY_ISSUED" | null;
};

type JoinRow = {
  id: string;
  intakeNumber: string;
  receivedAt: string;
  customerId: string;
  customerName: string;
  billingType: BillingType | null;
  endUserName: string | null;
  workflowTypeCode: WorkflowType;
  currentWorkflowStepKey: string;
  currentWorkflowStepRepairStatus: RepairStatus | null;
  currentWorkflowStepLabel: string;
  exceptionStatusCode: string | null;
  modelName: string;
  serialNumber: string | null;
  lotNumber: string | null;
  internalTargetInspectionCompletionDate: string | null;
  internalTargetShipmentDate: string | null;
  customerRequestedDueDate: string | null;
  /** Raw driver output for the GREATEST(...) expression — a Date instance for ordinary typed columns, but postgres.js returns computed/aggregate expressions as ISO strings, so both are handled at the mapping boundary. */
  lastActivityAt: Date | string | null;
  activePartsRequestStatus: "PENDING" | "PARTIALLY_ISSUED" | null;
};

/**
 * Latest of the three approved last-activity sources, computed as three
 * correlated scalar subqueries (each index-backed on repair_case_id) rather
 * than N application-level round trips — one query, not N+1. Invalidated
 * work records are excluded per Phase 5C-2 semantics (an invalidated memo
 * must never make a case look recently worked).
 */
function lastActivitySubquery() {
  return sql<Date | null>`greatest(
    (select max(${repairCaseWorkRecords.createdAt}) from ${repairCaseWorkRecords}
      where ${repairCaseWorkRecords.repairCaseId} = ${repairCases.id} and ${repairCaseWorkRecords.invalidatedAt} is null),
    (select max(${statusChangeHistories.createdAt}) from ${statusChangeHistories}
      where ${statusChangeHistories.repairCaseId} = ${repairCases.id}),
    (select max(${procedureCaseExecutionHistory.createdAt}) from ${procedureCaseExecutionHistory}
      inner join ${procedureCaseExecutions} on ${procedureCaseExecutions.id} = ${procedureCaseExecutionHistory.executionId}
      where ${procedureCaseExecutions.repairCaseId} = ${repairCases.id} and ${procedureCaseExecutions.isDeleted} = false)
  )`;
}

/**
 * Most-actionable active parts-request status for the case, or null if
 * every request (if any) is terminal (FULLY_ISSUED / PARTIALLY_CLOSED /
 * REJECTED / CANCELLED). PENDING outranks PARTIALLY_ISSUED — a wholly
 * unactioned request is more urgent than a partly-fulfilled one. Single
 * correlated subquery, index-backed on repair_case_id.
 */
function activePartsRequestSubquery() {
  return sql<"PENDING" | "PARTIALLY_ISSUED" | null>`(
    select case
      when bool_or(${inventoryPartRequests.status} = 'PENDING') then 'PENDING'
      when bool_or(${inventoryPartRequests.status} = 'PARTIALLY_ISSUED') then 'PARTIALLY_ISSUED'
      else null
    end
    from ${inventoryPartRequests}
    where ${inventoryPartRequests.repairCaseId} = ${repairCases.id}
  )`;
}

function toMyActiveWorkRow(row: JoinRow): MyActiveWorkRow {
  return {
    id: row.id,
    intakeNumber: row.intakeNumber,
    receivedAt: row.receivedAt,
    customerId: row.customerId,
    customerName: row.customerName,
    endUserName: row.endUserName,
    // 라벨이 없으면 "-" — 도메인에서 없앤 레거시 코드가 만에 하나 조인되어도
    // undefined가 화면에 새어 나가지 않게 한다(db/workflow-type-column.ts 주석).
    productCategory: productCategoryLabels[row.workflowTypeCode] ?? "-",
    modelName: row.modelName,
    billingType: row.billingType,
    serialNumber: row.serialNumber ?? "-",
    lotNumber: row.lotNumber ?? "-",
    status: resolveRepairStatusFromStep({
      repairCaseId: row.id,
      workflowType: row.workflowTypeCode,
      currentStepKey: row.currentWorkflowStepKey,
      stepRepairStatus: row.currentWorkflowStepRepairStatus,
    }),
    currentWorkflowStepLabel: row.currentWorkflowStepLabel,
    exceptionStatus: row.exceptionStatusCode as ExceptionStatus | null,
    internalTargetInspectionCompletionDate: row.internalTargetInspectionCompletionDate,
    internalTargetShipmentDate: row.internalTargetShipmentDate,
    customerRequestedDueDate: row.customerRequestedDueDate,
    lastActivityAt: row.lastActivityAt ? new Date(row.lastActivityAt).toISOString() : null,
    activePartsRequestStatus: row.activePartsRequestStatus,
  };
}

/**
 * All of `actorId`'s own assigned, non-shipment-completed repair cases.
 * SHIPMENT_COMPLETED exclusion uses the authoritative derived RepairStatus
 * (deriveRepairStatus over currentWorkflowStepKey), never repair_cases.
 * is_locked — locked correlates with shipment completion today but is not
 * the business rule. Filtering happens after the derive step (the same
 * established pattern as isRepairCaseOverdue/deriveRepairStatus elsewhere
 * in this codebase — never expressed as raw SQL against the static
 * step-status-map.ts table).
 */
export async function listMyActiveRepairCases(actorId: string): Promise<MyActiveWorkRow[]> {
  const rows = await db
    .select({
      id: repairCases.id,
      intakeNumber: repairCases.intakeNumber,
      receivedAt: repairCases.receivedAt,
      customerId: repairCases.customerId,
      customerName: customers.name,
      billingType: repairCases.billingType,
      endUserName: endUsers.name,
      workflowTypeCode: workflowTypeCodeColumn(),
      currentWorkflowStepKey: workflowSteps.key,
      // Phase 2c: 상태를 TS 표가 아니라 이 컬럼에서 읽는다.
      currentWorkflowStepRepairStatus: workflowSteps.repairStatus,
      currentWorkflowStepLabel: workflowSteps.label,
      exceptionStatusCode: exceptionStatuses.code,
      modelName: products.modelName,
      serialNumber: products.serialNumber,
      lotNumber: products.lotNumber,
      internalTargetInspectionCompletionDate: repairCases.internalTargetInspectionCompletionDate,
      internalTargetShipmentDate: repairCases.internalTargetShipmentDate,
      customerRequestedDueDate: repairCases.customerRequestedDueDate,
      lastActivityAt: lastActivitySubquery(),
      activePartsRequestStatus: activePartsRequestSubquery(),
    })
    .from(repairCases)
    .innerJoin(customers, eq(repairCases.customerId, customers.id))
    .leftJoin(endUsers, eq(repairCases.endUserId, endUsers.id))
    .innerJoin(products, eq(repairCases.productId, products.id))
    .innerJoin(workflowVersions, eq(repairCases.workflowVersionId, workflowVersions.id))
    .innerJoin(workflowTemplates, eq(workflowVersions.workflowTemplateId, workflowTemplates.id))
    .innerJoin(workflowSteps, eq(repairCases.currentWorkflowStepId, workflowSteps.id))
    .leftJoin(exceptionStatuses, eq(repairCases.exceptionStatusId, exceptionStatuses.id))
    .where(and(eq(repairCases.assignedEngineerId, actorId), eq(repairCases.isDeleted, false)));

  return rows.map((row) => toMyActiveWorkRow(row as JoinRow)).filter((row) => row.status !== "SHIPMENT_COMPLETED");
}
