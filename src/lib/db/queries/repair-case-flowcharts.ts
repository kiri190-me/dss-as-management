import "server-only";
import { and, desc, eq } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { db } from "../client";
import { repairCaseFlowcharts, repairCases, users } from "../schema";

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
