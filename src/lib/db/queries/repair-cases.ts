import { and, desc, eq } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
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
import { mapRepairCaseRow, mapRepairCaseTrashRow } from "../mappers/repair-case";
import type { ResolvedRepairCase } from "@/lib/domain/local/resolved-repair-case";
import type { TrashedRepairCase } from "../mappers/repair-case";

const deletedByUsers = alias(users, "repair_case_deleted_by_users");

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
function repairCaseBaseColumns() {
  return {
    id: repairCases.id,
    version: repairCases.version,
    intakeNumber: repairCases.intakeNumber,
    legacyReportNumber: repairCases.legacyReportNumber,
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
    billingType: repairCases.billingType,
    priority: repairCases.priority,
    currentWorkflowStepKey: workflowSteps.key,
    // Phase 2c: 상태를 TS 표가 아니라 이 컬럼에서 읽는다(mappers/repair-status.ts).
    currentWorkflowStepRepairStatus: workflowSteps.repairStatus,
    exceptionStatusCode: exceptionStatuses.code,
    receivedAt: repairCases.receivedAt,
    customerRequestedDueDate: repairCases.customerRequestedDueDate,
    internalTargetInspectionCompletionDate: repairCases.internalTargetInspectionCompletionDate,
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
  };
}

function selectRepairCaseJoin() {
  return db
    .select(repairCaseBaseColumns())
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

/**
 * Trash view (Repair Case Trash + Restore checkpoint) — same 8-table join
 * as selectRepairCaseJoin() plus the 3 soft-delete metadata columns and a
 * second, aliased join to `users` for the deleting admin's name
 * (`deletedByUsers` — a distinct alias from the assigned-engineer `users`
 * join above; a case can be deleted by someone other than its engineer).
 * A separate function rather than parameterizing selectRepairCaseJoin()
 * itself — drizzle's chained builder type does not thread extra columns
 * through cleanly, and this list only ever needs deleted rows.
 */
function selectRepairCaseTrashJoin() {
  return db
    .select({
      ...repairCaseBaseColumns(),
      deletedAt: repairCases.deletedAt,
      deleteReason: repairCases.deleteReason,
      deletedByUserId: repairCases.deletedBy,
      deletedByUserName: deletedByUsers.name,
    })
    .from(repairCases)
    .innerJoin(customers, eq(repairCases.customerId, customers.id))
    .leftJoin(endUsers, eq(repairCases.endUserId, endUsers.id))
    .innerJoin(products, eq(repairCases.productId, products.id))
    .innerJoin(workflowVersions, eq(repairCases.workflowVersionId, workflowVersions.id))
    .innerJoin(workflowTemplates, eq(workflowVersions.workflowTemplateId, workflowTemplates.id))
    .innerJoin(workflowSteps, eq(repairCases.currentWorkflowStepId, workflowSteps.id))
    .leftJoin(exceptionStatuses, eq(repairCases.exceptionStatusId, exceptionStatuses.id))
    .leftJoin(users, eq(repairCases.assignedEngineerId, users.id))
    .leftJoin(deletedByUsers, eq(repairCases.deletedBy, deletedByUsers.id));
}

export async function listRepairCases(): Promise<ResolvedRepairCase[]> {
  const rows = await selectRepairCaseJoin()
    .where(eq(repairCases.isDeleted, false))
    .orderBy(desc(repairCases.receivedAt));

  return rows.map((row) => mapRepairCaseRow(row));
}

/**
 * 휴지통 (trash) list for /repair-cases — SUPER_ADMIN/ADMIN only at the
 * caller level (this function itself has no role check, same "queries are
 * mechanism, Server Actions/pages are policy" precedent as every other
 * query in this file). Explicitly loads `is_deleted = true` rows — the
 * mirror image of listRepairCases()'s `is_deleted = false`, never the
 * default/unfiltered set.
 */
export async function listDeletedRepairCases(): Promise<TrashedRepairCase[]> {
  const rows = await selectRepairCaseTrashJoin()
    .where(eq(repairCases.isDeleted, true))
    .orderBy(desc(repairCases.deletedAt));

  return rows.map((row) => mapRepairCaseTrashRow(row));
}

/**
 * A/S 이력 for the Customer Management detail page (/customers/[id]) — same
 * shared join/mapper as listRepairCases/getRepairCaseById, just scoped by
 * customerId, so this can never drift from what the case list/detail pages
 * themselves show for the same rows.
 */
export async function listRepairCasesByCustomerId(customerId: string): Promise<ResolvedRepairCase[]> {
  const rows = await selectRepairCaseJoin()
    .where(and(eq(repairCases.isDeleted, false), eq(repairCases.customerId, customerId)))
    .orderBy(desc(repairCases.receivedAt));

  return rows.map((row) => mapRepairCaseRow(row));
}

/**
 * A/S 이력 for the Product Model Management detail page (/product-models/[id])
 * — same shared join/mapper as listRepairCases/getRepairCaseById/
 * listRepairCasesByCustomerId, scoped by the product's product_model_id
 * (the real master-table FK, migration 0030), never by a model_name string
 * comparison — a later master rename never breaks this linkage.
 */
export async function listRepairCasesByProductModelId(productModelId: string): Promise<ResolvedRepairCase[]> {
  const rows = await selectRepairCaseJoin()
    .where(and(eq(repairCases.isDeleted, false), eq(products.productModelId, productModelId)))
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

export type RepairCaseEditGuard = { id: string; isLocked: boolean };

/**
 * Minimal, edit-authorization-only lookup — used by update-repair-case.ts's
 * Server Action to check the shipment-lock policy (PROJECT_REQUIREMENTS.md
 * "출하 완료 후 수정(잠금 해제) 정책", SECURITY_POLICY.md §2) before
 * attempting any write, without pulling the full 8-table join just to read
 * one boolean.
 */
export async function getRepairCaseEditGuardById(id: string): Promise<RepairCaseEditGuard | null> {
  if (!UUID_PATTERN.test(id)) {
    return null;
  }

  const [row] = await db
    .select({ id: repairCases.id, isLocked: repairCases.isLocked })
    .from(repairCases)
    .where(and(eq(repairCases.isDeleted, false), eq(repairCases.id, id)))
    .limit(1);

  return row ?? null;
}

export type RepairCaseFlowchartCreateOption = {
  id: string;
  intakeNumber: string;
  customerName: string;
  modelName: string;
  serialNumber: string | null;
};

/**
 * Checkpoint 3A — the smallest identity-only projection needed for the
 * 진단 Flowchart 관리 page's "새 Flowchart 추가" target-case dropdown. Same
 * minimal-columns precedent as getRepairCaseEditGuardById (never the full
 * 8-table selectRepairCaseJoin, which also carries contact-snapshot PII
 * this selector has no reason to load). ~20 active cases today — a plain
 * <select> is the right size for this dataset (see this checkpoint's own
 * audit); no search/typeahead is introduced.
 */
export async function listRepairCasesForFlowchartCreateSelector(): Promise<RepairCaseFlowchartCreateOption[]> {
  const rows = await db
    .select({
      id: repairCases.id,
      intakeNumber: repairCases.intakeNumber,
      customerName: customers.name,
      modelName: products.modelName,
      serialNumber: products.serialNumber,
    })
    .from(repairCases)
    .innerJoin(customers, eq(repairCases.customerId, customers.id))
    .innerJoin(products, eq(repairCases.productId, products.id))
    .where(eq(repairCases.isDeleted, false))
    .orderBy(desc(repairCases.receivedAt));

  return rows;
}
