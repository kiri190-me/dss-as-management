import "server-only";
import { and, desc, eq } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { db } from "../client";
import { repairCaseFlowcharts, repairCases, users, customers, endUsers, products } from "../schema";

const updatedByUser = alias(users, "flowchart_updated_by_user");

export type RepairCaseFlowchartPageContext = { id: string; isLocked: boolean; assignedEngineerId: string | null };

/**
 * UI-hint context for the case-flowchart editor page's canEdit derivation
 * (5C-6D) — same convention as getWorkRecordCaseContext
 * (repair-case-work-records.ts): the mutation layer independently re-reads
 * and re-locks this same row, never trusting this. Deliberately not
 * resolveRepairCaseForServer (repair-case-resolver.ts) — that resolver is
 * mock/database read-source-aware and its ResolvedRepairCase shape doesn't
 * carry isLocked, while case-flowchart mutations are database-mode-only
 * (every server action gates on getAuthSource() === "database").
 */
export async function getRepairCaseFlowchartPageContext(repairCaseId: string): Promise<RepairCaseFlowchartPageContext | null> {
  const [row] = await db
    .select({ id: repairCases.id, isLocked: repairCases.isLocked, assignedEngineerId: repairCases.assignedEngineerId })
    .from(repairCases)
    .where(and(eq(repairCases.id, repairCaseId), eq(repairCases.isDeleted, false)));
  return row ?? null;
}

export type RepairCaseFlowchartRow = {
  id: string;
  repairCaseId: string;
  title: string;
  description: string | null;
  createdByUserId: string;
  createdByName: string;
  updatedByUserId: string;
  updatedByName: string;
  createdAt: string;
  updatedAt: string;
};

function selectFlowchartColumns() {
  return {
    id: repairCaseFlowcharts.id,
    repairCaseId: repairCaseFlowcharts.repairCaseId,
    title: repairCaseFlowcharts.title,
    description: repairCaseFlowcharts.description,
    createdByUserId: repairCaseFlowcharts.createdBy,
    createdByName: users.name,
    updatedByUserId: repairCaseFlowcharts.updatedBy,
    updatedByName: updatedByUser.name,
    createdAt: repairCaseFlowcharts.createdAt,
    updatedAt: repairCaseFlowcharts.updatedAt,
  };
}

function baseFlowchartQuery() {
  return db
    .select(selectFlowchartColumns())
    .from(repairCaseFlowcharts)
    .innerJoin(users, eq(repairCaseFlowcharts.createdBy, users.id))
    .innerJoin(updatedByUser, eq(repairCaseFlowcharts.updatedBy, updatedByUser.id));
}

function toFlowchartRow(row: {
  id: string;
  repairCaseId: string;
  title: string;
  description: string | null;
  createdByUserId: string;
  createdByName: string;
  updatedByUserId: string;
  updatedByName: string;
  createdAt: Date;
  updatedAt: Date;
}): RepairCaseFlowchartRow {
  return {
    id: row.id,
    repairCaseId: row.repairCaseId,
    title: row.title,
    description: row.description,
    createdByUserId: row.createdByUserId,
    createdByName: row.createdByName,
    updatedByUserId: row.updatedByUserId,
    updatedByName: row.updatedByName,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/**
 * 진단 Flowchart list for one repair case — excludes soft-deleted rows by
 * default (no "include deleted" option exists yet; nothing in 6B's scope
 * needs one). Newest-first, deterministic tie-break, same convention as
 * getRecentWorkRecordsForCase.
 */
export async function listRepairCaseFlowcharts(repairCaseId: string): Promise<RepairCaseFlowchartRow[]> {
  const rows = await baseFlowchartQuery()
    .where(and(eq(repairCaseFlowcharts.repairCaseId, repairCaseId), eq(repairCaseFlowcharts.isDeleted, false)))
    .orderBy(desc(repairCaseFlowcharts.createdAt), desc(repairCaseFlowcharts.id));
  return rows.map(toFlowchartRow);
}

/**
 * Single-flowchart lookup, scoped by BOTH repairCaseId and flowchartId in
 * the same WHERE clause — never fetched by flowchartId alone and checked
 * afterward. A flowchart that exists but belongs to a different repair case
 * returns null, identical to "doesn't exist at all" — this is the IDOR
 * defense for the get-one path (5C-6B plan §8): the query itself can never
 * return a cross-case row, so there is no separate "belongs to another
 * case" branch to accidentally leak information through. Soft-deleted rows
 * are also excluded — same default as the list query.
 */
export async function getRepairCaseFlowchart(
  repairCaseId: string,
  flowchartId: string
): Promise<RepairCaseFlowchartRow | null> {
  const [row] = await baseFlowchartQuery().where(
    and(
      eq(repairCaseFlowcharts.id, flowchartId),
      eq(repairCaseFlowcharts.repairCaseId, repairCaseId),
      eq(repairCaseFlowcharts.isDeleted, false)
    )
  );
  return row ? toFlowchartRow(row) : null;
}

export type RepairCaseFlowchartManagementRow = {
  id: string;
  repairCaseId: string;
  title: string;
  isDeleted: boolean;
  updatedAt: string;
  intakeNumber: string;
  customerName: string;
  endUserName: string | null;
  modelName: string;
  serialNumber: string | null;
};

/**
 * 진단 Flowchart 관리 (Checkpoint 2) — the smallest cross-case read model
 * needed for the new central list: no new storage, joins
 * repair_case_flowcharts straight into the same repair_cases/customers/
 * end_users/products chain selectRepairCaseJoin (repair-cases.ts) already
 * uses, with the same join-nullability shape (customerId/productId
 * NOT NULL -> innerJoin, endUserId nullable -> leftJoin). Excludes
 * soft-deleted repair cases (same convention as listRepairCases) in
 * addition to soft-deleted flowcharts — a flowchart belonging to a deleted
 * case is never shown here, regardless of its own isDeleted value.
 *
 * Checkpoint 2 is read-only and active-only: callers get non-deleted
 * flowcharts (`isDeleted = false`) exclusively — the future trash view is a
 * separate, later query, not a parameter bolted onto this one yet.
 */
export async function listRepairCaseFlowchartsForManagement(): Promise<RepairCaseFlowchartManagementRow[]> {
  const rows = await db
    .select({
      id: repairCaseFlowcharts.id,
      repairCaseId: repairCaseFlowcharts.repairCaseId,
      title: repairCaseFlowcharts.title,
      isDeleted: repairCaseFlowcharts.isDeleted,
      updatedAt: repairCaseFlowcharts.updatedAt,
      intakeNumber: repairCases.intakeNumber,
      customerName: customers.name,
      endUserName: endUsers.name,
      modelName: products.modelName,
      serialNumber: products.serialNumber,
    })
    .from(repairCaseFlowcharts)
    .innerJoin(repairCases, eq(repairCaseFlowcharts.repairCaseId, repairCases.id))
    .innerJoin(customers, eq(repairCases.customerId, customers.id))
    .leftJoin(endUsers, eq(repairCases.endUserId, endUsers.id))
    .innerJoin(products, eq(repairCases.productId, products.id))
    .where(and(eq(repairCaseFlowcharts.isDeleted, false), eq(repairCases.isDeleted, false)))
    .orderBy(desc(repairCaseFlowcharts.updatedAt));

  return rows.map((row) => ({
    id: row.id,
    repairCaseId: row.repairCaseId,
    title: row.title,
    isDeleted: row.isDeleted,
    updatedAt: row.updatedAt.toISOString(),
    intakeNumber: row.intakeNumber,
    customerName: row.customerName,
    endUserName: row.endUserName,
    modelName: row.modelName,
    serialNumber: row.serialNumber,
  }));
}

export type RepairCaseFlowchartTrashRow = {
  id: string;
  repairCaseId: string;
  title: string;
  updatedAt: string;
  deletedAt: string;
  intakeNumber: string;
  customerName: string;
  endUserName: string | null;
  modelName: string;
  serialNumber: string | null;
};

/**
 * Checkpoint 3B — the 휴지통 counterpart of listRepairCaseFlowchartsForManagement:
 * same join shape, same real-data-only scoping (soft-deleted repair cases
 * excluded even if one of their flowcharts is itself soft-deleted), but
 * flips the flowchart filter to `isDeleted = true` and additionally selects
 * `deletedAt` (never selected by the active-list query, since it's always
 * null there). Restore eligibility/retention-window display both derive
 * from this deletedAt value client-side
 * (getFlowchartRetentionStatus) — this query never computes or filters on
 * the 15-day window itself, it only supplies the raw timestamp.
 */
export async function listDeletedRepairCaseFlowchartsForManagement(): Promise<RepairCaseFlowchartTrashRow[]> {
  const rows = await db
    .select({
      id: repairCaseFlowcharts.id,
      repairCaseId: repairCaseFlowcharts.repairCaseId,
      title: repairCaseFlowcharts.title,
      updatedAt: repairCaseFlowcharts.updatedAt,
      deletedAt: repairCaseFlowcharts.deletedAt,
      intakeNumber: repairCases.intakeNumber,
      customerName: customers.name,
      endUserName: endUsers.name,
      modelName: products.modelName,
      serialNumber: products.serialNumber,
    })
    .from(repairCaseFlowcharts)
    .innerJoin(repairCases, eq(repairCaseFlowcharts.repairCaseId, repairCases.id))
    .innerJoin(customers, eq(repairCases.customerId, customers.id))
    .leftJoin(endUsers, eq(repairCases.endUserId, endUsers.id))
    .innerJoin(products, eq(repairCases.productId, products.id))
    .where(and(eq(repairCaseFlowcharts.isDeleted, true), eq(repairCases.isDeleted, false)))
    .orderBy(desc(repairCaseFlowcharts.deletedAt));

  return rows.map((row) => ({
    id: row.id,
    repairCaseId: row.repairCaseId,
    title: row.title,
    updatedAt: row.updatedAt.toISOString(),
    // Non-null by construction: the WHERE clause requires isDeleted = true,
    // and softDeleteRepairCaseFlowchart always sets deletedAt in the same
    // transaction it sets isDeleted = true.
    deletedAt: row.deletedAt!.toISOString(),
    intakeNumber: row.intakeNumber,
    customerName: row.customerName,
    endUserName: row.endUserName,
    modelName: row.modelName,
    serialNumber: row.serialNumber,
  }));
}
