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

/**
 * 여러 건을 **한 번에** — 바로 위 getDerivedServiceSummaryForCase 의 형제다.
 * 「이 제품의 과거 A/S 이력」줄마다 `조치 내용`(DIAGNOSIS_REPAIR_SUMMARY)을
 * 보여 주는데, 줄마다 위 함수를 부르면 이력 수만큼 왕복이 생긴다(N+1).
 *
 * 🔴 규칙은 위 함수와 **한 글자도 다르지 않다** — 같은
 * invalidated_at IS NULL, 같은 DERIVED_SUMMARY_KINDS 상수(GENERAL 제외),
 * 같은 tie-break(created_at DESC, id DESC). DISTINCT ON 의 키만
 * (repair_case_id, record_kind) 로 넓혀 **건별로** 종류마다 최신 한 줄씩
 * 고르고, 같은 부분 인덱스
 * repair_case_work_records_repair_case_id_record_kind_created_at_idx 를
 * 그대로 탄다(선행 칼럼이 repair_case_id 라 IN 목록에도 맞는다). 두 함수가
 * 같은 건에 다른 답을 주면 이력 줄에 보이는 글과 그 건을 눌러 들어갔을 때
 * 본문에 보이는 글이 어긋난다 — 그 동치성은 통합 시험이 두 함수를 나란히
 * 불러 값으로 못 박는다.
 *
 * 위 함수와 마찬가지로 legacy repair_cases 텍스트 칼럼은 여기서도 절대 읽지
 * 않는다. 작업기록이 하나도 없는 건은 **Map 에 열쇠 자체가 없다** — 부르는
 * 쪽은 없는 열쇠를 빈 요약(모든 칸 null)으로 읽어 화면에 "-" 를 그린다.
 */
export async function getDerivedServiceSummariesForCases(
  repairCaseIds: readonly string[]
): Promise<Map<string, DerivedServiceSummary>> {
  if (repairCaseIds.length === 0) return new Map();

  const rows = await db
    .selectDistinctOn([repairCaseWorkRecords.repairCaseId, repairCaseWorkRecords.recordKind], {
      repairCaseId: repairCaseWorkRecords.repairCaseId,
      recordKind: repairCaseWorkRecords.recordKind,
      memo: repairCaseWorkRecords.memo,
    })
    .from(repairCaseWorkRecords)
    .where(
      and(
        inArray(repairCaseWorkRecords.repairCaseId, [...repairCaseIds]),
        sql`${repairCaseWorkRecords.invalidatedAt} is null`,
        inArray(repairCaseWorkRecords.recordKind, DERIVED_SUMMARY_KINDS)
      )
    )
    .orderBy(
      repairCaseWorkRecords.repairCaseId,
      repairCaseWorkRecords.recordKind,
      desc(repairCaseWorkRecords.createdAt),
      desc(repairCaseWorkRecords.id)
    );

  const byCase = new Map<string, DerivedServiceSummary>();
  for (const row of rows) {
    // repair_case_id 는 스키마상 nullable 이다 — 건을 완전 삭제해도 작업기록
    // 자체는 남기려고 ON DELETE SET NULL 로 두었다. IN 목록으로 고른 줄이라
    // 여기에 null 이 올 길은 없지만, 타입을 억지로 좁히지 않고 건너뛴다.
    if (row.repairCaseId === null) continue;
    const summary =
      byCase.get(row.repairCaseId) ??
      { intakeInspectionResult: null, currentDiagnosisSummary: null, nextPlannedAction: null };
    if (row.recordKind === "INTAKE_INSPECTION_RESULT") summary.intakeInspectionResult = row.memo;
    else if (row.recordKind === "DIAGNOSIS_REPAIR_SUMMARY") summary.currentDiagnosisSummary = row.memo;
    else if (row.recordKind === "NEXT_PLANNED_ACTION") summary.nextPlannedAction = row.memo;
    byCase.set(row.repairCaseId, summary);
  }
  return byCase;
}
