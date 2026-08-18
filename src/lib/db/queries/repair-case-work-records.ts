import "server-only";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { db } from "../client";
import {
  repairCases,
  repairCaseWorkRecords,
  users,
  workflowSteps,
  procedureCaseExecutionNodes,
  procedureTemplateNodes,
} from "../schema";
import type { WorkRecordKind } from "@/lib/domain/types";

const invalidatedByUser = alias(users, "invalidated_by_user");

export type WorkRecordCaseContext = { id: string; isLocked: boolean; assignedEngineerId: string | null };

/** UI-hint context for the create/invalidate authorization checks on the 작업내용 page — the mutation layer independently re-reads and re-locks this same row, never trusting this. */
export async function getWorkRecordCaseContext(repairCaseId: string): Promise<WorkRecordCaseContext | null> {
  const [row] = await db
    .select({ id: repairCases.id, isLocked: repairCases.isLocked, assignedEngineerId: repairCases.assignedEngineerId })
    .from(repairCases)
    .where(and(eq(repairCases.id, repairCaseId), eq(repairCases.isDeleted, false)));
  return row ?? null;
}

export type WorkRecordRow = {
  id: string;
  memo: string;
  recordKind: WorkRecordKind;
  authorUserId: string;
  authorName: string;
  createdAt: string;
  workflowStepLabel: string | null;
  /** procedure_template_nodes.title for a template-backed node, or the node's own extra_task_title for a case-specific extra task — never both. */
  procedureNodeTitle: string | null;
  isInvalidated: boolean;
  invalidatedAt: string | null;
  invalidatedByUserId: string | null;
  invalidatedByName: string | null;
  invalidationReason: string | null;
};

function selectWorkRecordColumns() {
  return {
    id: repairCaseWorkRecords.id,
    memo: repairCaseWorkRecords.memo,
    recordKind: repairCaseWorkRecords.recordKind,
    authorUserId: repairCaseWorkRecords.authorUserId,
    authorName: users.name,
    createdAt: repairCaseWorkRecords.createdAt,
    workflowStepLabel: workflowSteps.label,
    procedureTemplateNodeTitle: procedureTemplateNodes.title,
    procedureExtraTaskTitle: procedureCaseExecutionNodes.extraTaskTitle,
    invalidatedAt: repairCaseWorkRecords.invalidatedAt,
    invalidatedByUserId: repairCaseWorkRecords.invalidatedBy,
    invalidatedByName: invalidatedByUser.name,
    invalidationReason: repairCaseWorkRecords.invalidationReason,
  };
}

function baseWorkRecordQuery() {
  return db
    .select(selectWorkRecordColumns())
    .from(repairCaseWorkRecords)
    .innerJoin(users, eq(repairCaseWorkRecords.authorUserId, users.id))
    .leftJoin(workflowSteps, eq(repairCaseWorkRecords.relatedWorkflowStepId, workflowSteps.id))
    .leftJoin(procedureCaseExecutionNodes, eq(repairCaseWorkRecords.relatedProcedureExecutionNodeId, procedureCaseExecutionNodes.id))
    .leftJoin(procedureTemplateNodes, eq(procedureCaseExecutionNodes.procedureTemplateNodeId, procedureTemplateNodes.id))
    .leftJoin(invalidatedByUser, eq(repairCaseWorkRecords.invalidatedBy, invalidatedByUser.id));
}

function toWorkRecordRow(row: {
  id: string;
  memo: string;
  recordKind: WorkRecordKind;
  authorUserId: string;
  authorName: string;
  createdAt: Date;
  workflowStepLabel: string | null;
  procedureTemplateNodeTitle: string | null;
  procedureExtraTaskTitle: string | null;
  invalidatedAt: Date | null;
  invalidatedByUserId: string | null;
  invalidatedByName: string | null;
  invalidationReason: string | null;
}): WorkRecordRow {
  return {
    id: row.id,
    memo: row.memo,
    recordKind: row.recordKind,
    authorUserId: row.authorUserId,
    authorName: row.authorName,
    createdAt: row.createdAt.toISOString(),
    workflowStepLabel: row.workflowStepLabel,
    procedureNodeTitle: row.procedureTemplateNodeTitle ?? row.procedureExtraTaskTitle ?? null,
    isInvalidated: row.invalidatedAt !== null,
    invalidatedAt: row.invalidatedAt?.toISOString() ?? null,
    invalidatedByUserId: row.invalidatedByUserId,
    invalidatedByName: row.invalidatedByName,
    invalidationReason: row.invalidationReason,
  };
}

/**
 * Newest-first, limited count for the 작업내용 "최근 작업 기록" section.
 * Deterministic tie-break (created_at DESC, id DESC) — two records inserted
 * within the same timestamp resolution must still sort consistently across
 * repeated reads.
 */
export async function getRecentWorkRecordsForCase(repairCaseId: string, limit = 5): Promise<WorkRecordRow[]> {
  const rows = await baseWorkRecordQuery()
    .where(eq(repairCaseWorkRecords.repairCaseId, repairCaseId))
    .orderBy(desc(repairCaseWorkRecords.createdAt), desc(repairCaseWorkRecords.id))
    .limit(limit);

  return rows.map(toWorkRecordRow);
}

/**
 * Full, paginated history for the 작업 이력 tab. Plain offset/limit
 * pagination — acceptable for this phase's small per-case dataset (a
 * handful to a few dozen rows per case), no cursor-based scheme needed.
 */
export async function getWorkRecordHistoryForCase(
  repairCaseId: string,
  { limit, offset }: { limit: number; offset: number }
): Promise<{ rows: WorkRecordRow[]; total: number }> {
  const [rows, [{ count }]] = await Promise.all([
    baseWorkRecordQuery()
      .where(eq(repairCaseWorkRecords.repairCaseId, repairCaseId))
      .orderBy(desc(repairCaseWorkRecords.createdAt), desc(repairCaseWorkRecords.id))
      .limit(limit)
      .offset(offset),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(repairCaseWorkRecords)
      .where(eq(repairCaseWorkRecords.repairCaseId, repairCaseId)),
  ]);

  return { rows: rows.map(toWorkRecordRow), total: count };
}

const DERIVED_SUMMARY_KINDS: readonly WorkRecordKind[] = [
  "INTAKE_INSPECTION_RESULT",
  "DIAGNOSIS_REPAIR_SUMMARY",
  "NEXT_PLANNED_ACTION",
];

export type DerivedServiceSummary = {
  intakeInspectionResult: string | null;
  currentDiagnosisSummary: string | null;
  nextPlannedAction: string | null;
};

/**
 * Deterministic, non-AI derivation for 고장 및 서비스 정보's 3 summary
 * fields (migration 0023 record_kind checkpoint). One round trip via
 * DISTINCT ON (record_kind), matching the partial index
 * repair_case_work_records_repair_case_id_record_kind_created_at_idx
 * (repair_case_id, record_kind, created_at) WHERE invalidated_at IS NULL.
 * "latest" uses the exact same tie-break as every other work-record read
 * (created_at DESC, id DESC) — DISTINCT ON requires the ORDER BY to start
 * with its own key, so record_kind leads, then the usual tie-break.
 *
 * GENERAL is deliberately excluded from the IN filter — it can never
 * populate these summaries, structurally (not by convention). No memo text
 * is parsed, combined, or inferred; the legacy repair_cases text columns
 * (intake_inspection_result/current_diagnosis_summary/next_planned_action)
 * are never read here — this is a fully independent source. If a record's
 * kind has no non-invalidated row, the corresponding field is null (caller
 * renders "-").
 */
export async function getDerivedServiceSummaryForCase(repairCaseId: string): Promise<DerivedServiceSummary> {
  const rows = await db
    .selectDistinctOn([repairCaseWorkRecords.recordKind], {
      recordKind: repairCaseWorkRecords.recordKind,
      memo: repairCaseWorkRecords.memo,
    })
    .from(repairCaseWorkRecords)
    .where(
      and(
        eq(repairCaseWorkRecords.repairCaseId, repairCaseId),
        sql`${repairCaseWorkRecords.invalidatedAt} is null`,
        inArray(repairCaseWorkRecords.recordKind, DERIVED_SUMMARY_KINDS)
      )
    )
    .orderBy(repairCaseWorkRecords.recordKind, desc(repairCaseWorkRecords.createdAt), desc(repairCaseWorkRecords.id));

  const byKind = new Map(rows.map((row) => [row.recordKind, row.memo]));
  return {
    intakeInspectionResult: byKind.get("INTAKE_INSPECTION_RESULT") ?? null,
    currentDiagnosisSummary: byKind.get("DIAGNOSIS_REPAIR_SUMMARY") ?? null,
    nextPlannedAction: byKind.get("NEXT_PLANNED_ACTION") ?? null,
  };
}
