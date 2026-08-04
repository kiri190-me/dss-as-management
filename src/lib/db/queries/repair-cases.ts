import { and, desc, eq } from "drizzle-orm";
import { db } from "../client";
import {
  customers,
  endUsers,
  exceptionStatuses,
  products,
  repairCases,
  users,
  workflowSteps,
  workflowTemplates,
  workflowVersions,
} from "../schema";
import { mapRepairCaseRow } from "../mappers/repair-case";
import type { ResolvedRepairCase } from "@/lib/domain/local/resolved-repair-case";

/**
 * Read-only queries backing Stage G-2's REPAIR_CASE_READ_SOURCE=database
 * path. SELECT-only — no inserts/updates/deletes anywhere in this file, no
 * localStorage access, no mock-data.ts import. Never logs a row (rows may
 * contain the contact-snapshot PII columns; callers must not log query
 * results either — see repair-cases.ts schema comment).
 *
 * Both exported functions share the same 8-table join so the two read
 * paths (list, detail) can never drift into returning differently-shaped
 * data. This is a function (not a shared builder instance) so each call
 * gets its own fresh query.
 */
function selectRepairCaseJoin() {
  return db
    .select({
      id: repairCases.id,
      intakeNumber: repairCases.intakeNumber,
      customerId: repairCases.customerId,
      customerName: customers.name,
      endUserId: repairCases.endUserId,
      endUserName: endUsers.name,
      productId: repairCases.productId,
      modelName: products.modelName,
      lotNumber: products.lotNumber,
      serialNumber: products.serialNumber,
      partNumber: products.partNumber,
      assignedEngineerId: repairCases.assignedEngineerId,
      engineerName: users.name,
      workflowTypeCode: workflowTemplates.code,
      currentWorkflowStepKey: workflowSteps.key,
      exceptionStatusCode: exceptionStatuses.code,
      receivedAt: repairCases.receivedAt,
      customerRequestedDueDate: repairCases.customerRequestedDueDate,
      internalTargetShipmentDate: repairCases.internalTargetShipmentDate,
      actualShipmentDate: repairCases.actualShipmentDate,
      reportedSymptom: repairCases.reportedSymptom,
      intakeInspectionResult: repairCases.intakeInspectionResult,
      currentDiagnosisSummary: repairCases.currentDiagnosisSummary,
      nextPlannedAction: repairCases.nextPlannedAction,
      accessoryList: repairCases.accessoryList,
      externalConditionSummary: repairCases.externalConditionSummary,
      reasonForRemoval: repairCases.reasonForRemoval,
      notes: repairCases.notes,
      contactNameSnapshot: repairCases.contactNameSnapshot,
      contactPhoneSnapshot: repairCases.contactPhoneSnapshot,
      contactEmailSnapshot: repairCases.contactEmailSnapshot,
      createdAt: repairCases.createdAt,
    })
    .from(repairCases)
    .innerJoin(customers, eq(repairCases.customerId, customers.id))
    .leftJoin(endUsers, eq(repairCases.endUserId, endUsers.id))
    .innerJoin(products, eq(repairCases.productId, products.id))
    .innerJoin(workflowVersions, eq(repairCases.workflowVersionId, workflowVersions.id))
    .innerJoin(workflowTemplates, eq(workflowVersions.workflowTemplateId, workflowTemplates.id))
    .innerJoin(workflowSteps, eq(repairCases.currentWorkflowStepId, workflowSteps.id))
    .leftJoin(exceptionStatuses, eq(repairCases.exceptionStatusId, exceptionStatuses.id))
    .leftJoin(users, eq(repairCases.assignedEngineerId, users.id));
}

export async function listRepairCases(): Promise<ResolvedRepairCase[]> {
  const rows = await selectRepairCaseJoin()
    .where(eq(repairCases.isDeleted, false))
    .orderBy(desc(repairCases.receivedAt));

  return rows.map((row) => mapRepairCaseRow(row));
}

// Deliberately permissive UUID matcher (any RFC-4122-shaped hex string, not
// version-pinned) — its only job is to reject obviously-non-UUID input
// before it reaches Postgres, so a malformed :id route param returns a
// clean `null` instead of a raw "invalid input syntax for type uuid" error.
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function getRepairCaseById(id: string): Promise<ResolvedRepairCase | null> {
  if (!UUID_PATTERN.test(id)) {
    return null;
  }

  const rows = await selectRepairCaseJoin()
    .where(and(eq(repairCases.isDeleted, false), eq(repairCases.id, id)))
    .limit(1);

  const row = rows[0];
  return row ? mapRepairCaseRow(row) : null;
}
