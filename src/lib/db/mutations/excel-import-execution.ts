import "server-only";

import { and, eq, inArray, sql } from "drizzle-orm";
import { canManageExcelImports } from "@/lib/auth/excel-import-authorization";
import {
  EXCEL_IMPORT_EXECUTION_CHUNK_SIZE,
  EXCEL_IMPORT_EXECUTION_PARSER_VERSION,
  deriveExcelImportExecutionBatchStatus,
} from "@/lib/domain/excel-import-execution";
import { createRepairCaseWithIdempotency } from "@/lib/server/services/create-repair-case";
import { db } from "../client";
import { pgClient } from "../connection";
import {
  excelImportBatches,
  excelImportRowAttempts,
  excelImportRows,
  products,
  repairCaseIdempotencyKeys,
  repairCases,
  users,
} from "../schema";
import { getExcelImportPreflightPlan } from "../queries/excel-import-preflight";
import { insertAuditLog } from "./audit-logs";

const PREVIEW_STATUSES = ["PREVIEWED", "REVIEW_REQUIRED", "READY"] as const;

export type ExcelImportExecutionCode =
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "STALE_BATCH_VERSION"
  | "BATCH_NOT_CONFIRMABLE"
  | "BATCH_NOT_RESUMABLE"
  | "PARSER_VERSION_NOT_SUPPORTED"
  | "CONCURRENT_EXECUTION"
  | "NO_EXECUTABLE_ROWS"
  | "EXECUTION_DATABASE_NOT_READY"
  | "RETRY_CONDITION_UNRESOLVED"
  | "DATABASE_UNAVAILABLE";

export type ConfirmExcelImportExecutionResult =
  | { ok: true; batchId: string; version: number; executable: number; excluded: number; conflicts: number }
  | { ok: false; code: ExcelImportExecutionCode };

export type RunExcelImportChunkResult =
  | { ok: true; batchId: string; version: number; processed: number; succeeded: number; failed: number; remaining: number; completed: boolean; status: "IMPORTING" | "PARTIAL_SUCCESS" | "COMPLETED" | "FAILED" }
  | { ok: false; code: ExcelImportExecutionCode };

export type ExcelImportExecutionTestHooks = {
  beforeRowExecution?: (rowId: string) => Promise<void>;
  afterRepairCaseExecution?: (rowId: string) => Promise<void>;
};

async function allowedActor(actorUserId: string) {
  const [actor] = await db.select({ id: users.id, role: users.role, approvalStatus: users.approvalStatus, isDeleted: users.isDeleted }).from(users).where(eq(users.id, actorUserId)).limit(1);
  return actor && !actor.isDeleted && actor.approvalStatus === "APPROVED" && canManageExcelImports(actor.role) ? actor : null;
}

export async function confirmExcelImportExecution(input: { batchId: string; actorUserId: string; expectedBatchVersion: number }): Promise<ConfirmExcelImportExecutionResult> {
  const actor = await allowedActor(input.actorUserId);
  if (!actor) return { ok: false, code: "FORBIDDEN" };
  const preflight = await getExcelImportPreflightPlan({ batchId: input.batchId, actorUserId: input.actorUserId });
  if (!preflight.ok) return { ok: false, code: preflight.code === "NOT_FOUND" ? "NOT_FOUND" : preflight.code === "FORBIDDEN" ? "FORBIDDEN" : "DATABASE_UNAVAILABLE" };
  if (preflight.value.batch.parserVersion !== EXCEL_IMPORT_EXECUTION_PARSER_VERSION) return { ok: false, code: "PARSER_VERSION_NOT_SUPPORTED" };
  if (preflight.value.counts.executable === 0) return { ok: false, code: "NO_EXECUTABLE_ROWS" };
  try {
    return await db.transaction(async (tx): Promise<ConfirmExcelImportExecutionResult> => {
      const [batch] = await tx.select().from(excelImportBatches).where(and(eq(excelImportBatches.id, input.batchId), eq(excelImportBatches.uploadedBy, input.actorUserId))).for("update");
      if (!batch) return { ok: false, code: "NOT_FOUND" };
      if (batch.version !== input.expectedBatchVersion) return { ok: false, code: "STALE_BATCH_VERSION" };
      if (!PREVIEW_STATUSES.includes(batch.status as (typeof PREVIEW_STATUSES)[number]) || batch.confirmedAt) return { ok: false, code: "BATCH_NOT_CONFIRMABLE" };
      if (batch.parserVersion !== EXCEL_IMPORT_EXECUTION_PARSER_VERSION) return { ok: false, code: "PARSER_VERSION_NOT_SUPPORTED" };
      for (const row of preflight.value.rows) {
        if (row.disposition === "IMPORTED") continue;
        const importStatus = row.disposition === "EXECUTABLE" ? "IMPORT_READY" : row.disposition === "AUTO_EXCLUDED" ? "EXCLUDED" : "PENDING_REVIEW";
        const updated = await tx.update(excelImportRows).set({ importStatus, lastErrorCode: null, lastErrorAt: null, version: sql`${excelImportRows.version} + 1`, updatedAt: sql`now()` }).where(and(eq(excelImportRows.id, row.id), eq(excelImportRows.batchId, batch.id), eq(excelImportRows.version, row.rowVersion))).returning({ id: excelImportRows.id });
        if (updated.length !== 1) return { ok: false, code: "STALE_BATCH_VERSION" };
      }
      const summary = { ...(batch.summary as Record<string, unknown>), executionPreflight: { executable: preflight.value.counts.executable, excluded: preflight.value.counts.autoExcluded, conflicts: preflight.value.counts.conflicts } };
      const [updatedBatch] = await tx.update(excelImportBatches).set({ status: "IMPORTING", confirmedBy: input.actorUserId, confirmedAt: new Date(), completedAt: null, summary, version: sql`${excelImportBatches.version} + 1`, updatedAt: sql`now()` }).where(and(eq(excelImportBatches.id, batch.id), eq(excelImportBatches.version, batch.version))).returning({ version: excelImportBatches.version });
      if (!updatedBatch) return { ok: false, code: "STALE_BATCH_VERSION" };
      return { ok: true, batchId: batch.id, version: updatedBatch.version, executable: preflight.value.counts.executable, excluded: preflight.value.counts.autoExcluded, conflicts: preflight.value.counts.conflicts };
    });
  } catch { return { ok: false, code: "DATABASE_UNAVAILABLE" }; }
}

async function startAttempt(input: { batchId: string; rowId: string; actorUserId: string; allowedStatuses: Array<typeof excelImportRows.$inferSelect.importStatus> }) {
  return db.transaction(async (tx) => {
    const [row] = await tx.select({ id: excelImportRows.id, status: excelImportRows.importStatus, version: excelImportRows.version }).from(excelImportRows).where(and(eq(excelImportRows.id, input.rowId), eq(excelImportRows.batchId, input.batchId))).for("update");
    if (!row || !input.allowedStatuses.includes(row.status)) return null;
    const [started] = await tx.select({ id: excelImportRowAttempts.id }).from(excelImportRowAttempts).where(and(eq(excelImportRowAttempts.importRowId, row.id), eq(excelImportRowAttempts.status, "STARTED"))).for("update");
    if (started) await tx.update(excelImportRowAttempts).set({ status: "ABORTED", completedAt: new Date() }).where(eq(excelImportRowAttempts.id, started.id));
    const [number] = await tx.select({ value: sql<number>`coalesce(max(${excelImportRowAttempts.attemptNumber}), 0)::int + 1` }).from(excelImportRowAttempts).where(eq(excelImportRowAttempts.importRowId, row.id));
    const [attempt] = await tx.insert(excelImportRowAttempts).values({ importRowId: row.id, attemptNumber: number?.value ?? 1, status: "STARTED", requestedBy: input.actorUserId }).returning({ id: excelImportRowAttempts.id });
    await tx.update(excelImportRows).set({ importStatus: "IMPORTING", lastErrorCode: null, lastErrorAt: null, version: sql`${excelImportRows.version} + 1`, updatedAt: sql`now()` }).where(and(eq(excelImportRows.id, row.id), eq(excelImportRows.version, row.version)));
    return attempt;
  });
}

async function finishAttempt(input: { rowId: string; attemptId: string; actorUserId: string; result: Awaited<ReturnType<typeof createRepairCaseWithIdempotency>> }) {
  return db.transaction(async (tx) => {
    if (input.result.ok) {
      const [created] = await tx.select({ customerId: repairCases.customerId, endUserId: repairCases.endUserId, productId: repairCases.productId, assignedEngineerId: repairCases.assignedEngineerId, workflowVersionId: repairCases.workflowVersionId, workflowStepId: repairCases.currentWorkflowStepId, productModelId: products.productModelId }).from(repairCases).innerJoin(products, eq(products.id, repairCases.productId)).where(eq(repairCases.id, input.result.id));
      if (!created) throw new Error("CREATED_REPAIR_CASE_NOT_FOUND");
      await tx.update(excelImportRowAttempts).set({ status: "SUCCEEDED", completedAt: new Date(), resultRepairCaseId: input.result.id }).where(and(eq(excelImportRowAttempts.id, input.attemptId), eq(excelImportRowAttempts.status, "STARTED")));
      await tx.update(excelImportRows).set({ importStatus: "IMPORTED", customerId: created.customerId, endUserId: created.endUserId, productModelId: created.productModelId, productId: created.productId, assignedEngineerId: created.assignedEngineerId, workflowVersionId: created.workflowVersionId, workflowStepId: created.workflowStepId, resultRepairCaseId: input.result.id, importedBy: input.actorUserId, importedAt: new Date(), lastErrorCode: null, lastErrorAt: null, version: sql`${excelImportRows.version} + 1`, updatedAt: sql`now()` }).where(and(eq(excelImportRows.id, input.rowId), eq(excelImportRows.importStatus, "IMPORTING")));
      return true;
    }
    const errorCode = input.result.code;
    await tx.update(excelImportRowAttempts).set({ status: "FAILED", completedAt: new Date(), errorCode }).where(and(eq(excelImportRowAttempts.id, input.attemptId), eq(excelImportRowAttempts.status, "STARTED")));
    await tx.update(excelImportRows).set({ importStatus: "FAILED", lastErrorCode: errorCode, lastErrorAt: new Date(), version: sql`${excelImportRows.version} + 1`, updatedAt: sql`now()` }).where(and(eq(excelImportRows.id, input.rowId), eq(excelImportRows.importStatus, "IMPORTING")));
    return false;
  });
}

async function executionDatabaseContractIsReady(
  connection: Awaited<ReturnType<typeof pgClient.reserve>>
): Promise<boolean> {
  const [contract] = await connection<{ ready: boolean }[]>`
    select
      (select count(*) >= 39 from drizzle.__drizzle_migrations)
      and exists (
        select 1 from information_schema.columns
        where table_schema = 'public'
          and table_name = 'repair_cases'
          and column_name = 'legacy_report_number'
      )
      and exists (
        select 1
        from pg_type t
        join pg_enum e on e.enumtypid = t.oid
        where t.typname = 'status_change_action_type'
          and e.enumlabel = 'LEGACY_IMPORT_STATE_SET'
      ) as ready
  `;
  return contract?.ready === true;
}

export async function runExcelImportChunk(input: { batchId: string; actorUserId: string; expectedBatchVersion: number; retryFailed?: boolean }, testHooks: ExcelImportExecutionTestHooks = {}): Promise<RunExcelImportChunkResult> {
  const actor = await allowedActor(input.actorUserId);
  if (!actor) return { ok: false, code: "FORBIDDEN" };
  const reserved = await pgClient.reserve();
  let ownsLock = false;
  try {
    const [lock] = await reserved<{ locked: boolean }[]>`select pg_try_advisory_lock(hashtextextended(${input.batchId}, 0)) as locked`;
    if (!lock?.locked) return { ok: false, code: "CONCURRENT_EXECUTION" };
    ownsLock = true;
    const [batch] = await db.select().from(excelImportBatches).where(and(eq(excelImportBatches.id, input.batchId), eq(excelImportBatches.uploadedBy, input.actorUserId))).limit(1);
    if (!batch) return { ok: false, code: "NOT_FOUND" };
    if (batch.version !== input.expectedBatchVersion) return { ok: false, code: "STALE_BATCH_VERSION" };
    if (batch.parserVersion !== EXCEL_IMPORT_EXECUTION_PARSER_VERSION) return { ok: false, code: "PARSER_VERSION_NOT_SUPPORTED" };
    let preflight = await getExcelImportPreflightPlan({ batchId: batch.id, actorUserId: input.actorUserId });
    if (!preflight.ok) return { ok: false, code: "DATABASE_UNAVAILABLE" };
    if (input.retryFailed && ["PARTIAL_SUCCESS", "FAILED"].includes(batch.status)) {
      if (!(await executionDatabaseContractIsReady(reserved))) return { ok: false, code: "EXECUTION_DATABASE_NOT_READY" };
      const failedPlans = preflight.value.rows.filter((row) => row.storedStatus === "FAILED");
      if (failedPlans.length === 0) return { ok: false, code: "BATCH_NOT_RESUMABLE" };
      const unresolved = failedPlans.some((row) =>
        !row.intake || row.reasons.some((reason) => reason.kind === "EXCLUSION" || reason.kind === "CONFLICT")
      );
      if (unresolved) return { ok: false, code: "RETRY_CONDITION_UNRESOLVED" };
      const failedIds = failedPlans.map((row) => row.id);
      const resumed = await db.transaction(async (tx) => {
        const [lockedBatch] = await tx.select({ status: excelImportBatches.status, version: excelImportBatches.version }).from(excelImportBatches).where(and(eq(excelImportBatches.id, batch.id), eq(excelImportBatches.uploadedBy, input.actorUserId))).for("update");
        if (!lockedBatch || lockedBatch.version !== batch.version) return null;
        if (lockedBatch.status !== "PARTIAL_SUCCESS" && lockedBatch.status !== "FAILED") return null;
        const lockedRows = await tx.select({ id: excelImportRows.id }).from(excelImportRows).where(and(eq(excelImportRows.batchId, batch.id), inArray(excelImportRows.id, failedIds), eq(excelImportRows.importStatus, "FAILED"))).for("update");
        if (lockedRows.length !== failedIds.length) return null;
        await tx.update(excelImportRows).set({ importStatus: "IMPORT_READY", lastErrorCode: null, lastErrorAt: null, version: sql`${excelImportRows.version} + 1`, updatedAt: sql`now()` }).where(inArray(excelImportRows.id, failedIds));
        const [updatedBatch] = await tx.update(excelImportBatches).set({ status: "IMPORTING", completedAt: null, version: sql`${excelImportBatches.version} + 1`, updatedAt: sql`now()` }).where(and(eq(excelImportBatches.id, batch.id), eq(excelImportBatches.version, batch.version))).returning({ version: excelImportBatches.version });
        return updatedBatch ?? null;
      });
      if (!resumed) return { ok: false, code: "STALE_BATCH_VERSION" };
      batch.status = "IMPORTING"; batch.version = resumed.version;
      preflight = await getExcelImportPreflightPlan({ batchId: batch.id, actorUserId: input.actorUserId });
      if (!preflight.ok) return { ok: false, code: "DATABASE_UNAVAILABLE" };
    }
    if (batch.status !== "IMPORTING") return { ok: false, code: "BATCH_NOT_RESUMABLE" };
    const targetStatuses = ["IMPORT_READY", "IMPORTING"] as const;
    const targetRows = preflight.value.rows.filter((row) => targetStatuses.includes(row.storedStatus as never));
    const blockedRows = targetRows.filter((row) => !row.intake || (row.disposition === "CONFLICT" && !(row.storedStatus === "IMPORTING" && row.reasons.every((reason) => reason.kind === "NOTICE" || reason.code === "INTAKE_NUMBER_DUPLICATE_IN_DATABASE")))).slice(0, EXCEL_IMPORT_EXECUTION_CHUNK_SIZE);
    let succeeded = 0; let failed = 0;
    for (const row of blockedRows) {
      const attempt = await startAttempt({ batchId: batch.id, rowId: row.id, actorUserId: input.actorUserId, allowedStatuses: [...targetStatuses] });
      if (!attempt) continue;
      await finishAttempt({ rowId: row.id, attemptId: attempt.id, actorUserId: input.actorUserId, result: { ok: false, code: "CONFLICT", message: "이관 전 조건이 변경되었습니다." } });
      failed++;
    }
    const remainingSlots = EXCEL_IMPORT_EXECUTION_CHUNK_SIZE - blockedRows.length;
    const candidates = targetRows.filter((row) => !blockedRows.some((blocked) => blocked.id === row.id)).filter((row) => row.intake && (row.disposition === "EXECUTABLE" || row.disposition === "FAILED" || (row.storedStatus === "IMPORTING" && row.reasons.every((reason) => reason.kind === "NOTICE" || reason.code === "INTAKE_NUMBER_DUPLICATE_IN_DATABASE")))).slice(0, remainingSlots);
    for (const row of candidates) {
      const attempt = await startAttempt({ batchId: batch.id, rowId: row.id, actorUserId: input.actorUserId, allowedStatuses: [...targetStatuses] });
      if (!attempt || !row.intake) continue;
      await testHooks.beforeRowExecution?.(row.id);
      const result = await createRepairCaseWithIdempotency({
        actor: { userId: actor.id, role: actor.role, approvalStatus: actor.approvalStatus },
        intake: row.intake,
        idempotencyKey: row.id,
        logContext: "EXCEL_IMPORT",
        legacyReportNumber: row.candidate.legacyReportNumber ?? null,
        legacyImportState: row.legacyState.apply && row.legacyState.targetStepKey
          ? {
              targetStepKey: row.legacyState.targetStepKey,
              actualShipmentDate: row.legacyState.actualShipmentDate,
              batchId: batch.id,
              sourceRowNumber: row.sourceRowNumber,
            }
          : undefined,
      });
      await testHooks.afterRepairCaseExecution?.(row.id);
      if (await finishAttempt({ rowId: row.id, attemptId: attempt.id, actorUserId: input.actorUserId, result })) succeeded++; else failed++;
    }
    const outcomeRows = await db.select({ status: excelImportRows.importStatus, resultRepairCaseId: excelImportRows.resultRepairCaseId }).from(excelImportRows).where(eq(excelImportRows.batchId, batch.id));
    const outcomeCounts = {
      succeeded: outcomeRows.filter((row) => row.status === "IMPORTED" && row.resultRepairCaseId !== null).length,
      failed: outcomeRows.filter((row) => row.status === "FAILED" || (row.status === "IMPORTED" && row.resultRepairCaseId === null)).length,
      incomplete: outcomeRows.filter((row) => row.status === "IMPORT_READY" || row.status === "IMPORTING").length,
      excluded: outcomeRows.filter((row) => row.status === "EXCLUDED").length,
    };
    const remaining = outcomeCounts.incomplete;
    const finalStatus = deriveExcelImportExecutionBatchStatus(outcomeCounts) ?? "FAILED";
    const [updated] = await db.update(excelImportBatches).set({ status: finalStatus, completedAt: finalStatus === "IMPORTING" ? null : new Date(), version: sql`${excelImportBatches.version} + 1`, updatedAt: sql`now()` }).where(and(eq(excelImportBatches.id, batch.id), eq(excelImportBatches.version, batch.version))).returning({ version: excelImportBatches.version });
    if (!updated) return { ok: false, code: "STALE_BATCH_VERSION" };
    return { ok: true, batchId: batch.id, version: updated.version, processed: succeeded + failed, succeeded, failed, remaining, completed: finalStatus !== "IMPORTING", status: finalStatus };
  } catch { return { ok: false, code: "DATABASE_UNAVAILABLE" }; }
  finally {
    if (ownsLock) {
      try { await reserved`select pg_advisory_unlock(hashtextextended(${input.batchId}, 0))`; } catch { /* connection release also drops the lock */ }
    }
    await reserved.release();
  }
}

export type ReconcileFailedExcelImportBatchResult =
  | { ok: true; batchId: string; version: number; status: "FAILED" }
  | { ok: false; code: "FORBIDDEN" | "NOT_FOUND" | "STALE_BATCH_VERSION" | "RECONCILIATION_GUARD_FAILED" | "DATABASE_UNAVAILABLE" };

/**
 * Corrects the historical all-failed/PARTIAL_SUCCESS classification only.
 * This is intentionally not exposed as a Server Action. It is available for
 * a separately approved, exact-batch reconciliation after every guard passes.
 */
export async function reconcileFailedExcelImportBatch(input: {
  batchId: string;
  actorUserId: string;
  expectedBatchVersion: number;
}): Promise<ReconcileFailedExcelImportBatchResult> {
  const actor = await allowedActor(input.actorUserId);
  if (!actor) return { ok: false, code: "FORBIDDEN" };
  try {
    return await db.transaction(async (tx): Promise<ReconcileFailedExcelImportBatchResult> => {
      const [batch] = await tx.select({ id: excelImportBatches.id, status: excelImportBatches.status, version: excelImportBatches.version }).from(excelImportBatches).where(and(eq(excelImportBatches.id, input.batchId), eq(excelImportBatches.uploadedBy, input.actorUserId))).for("update");
      if (!batch) return { ok: false, code: "NOT_FOUND" };
      if (batch.version !== input.expectedBatchVersion) return { ok: false, code: "STALE_BATCH_VERSION" };
      if (batch.status !== "PARTIAL_SUCCESS") return { ok: false, code: "RECONCILIATION_GUARD_FAILED" };

      const [databaseContract] = await tx.select({
        migrationCount: sql<number>`(select count(*)::int from drizzle.__drizzle_migrations)`,
        legacyReportNumberExists: sql<boolean>`exists (
          select 1 from information_schema.columns
          where table_schema = 'public'
            and table_name = 'repair_cases'
            and column_name = 'legacy_report_number'
        )`,
      }).from(excelImportBatches).limit(1);
      if (databaseContract?.migrationCount !== 39 || databaseContract.legacyReportNumberExists !== true) {
        return { ok: false, code: "RECONCILIATION_GUARD_FAILED" };
      }

      const rows = await tx.select({ id: excelImportRows.id, status: excelImportRows.importStatus, resultRepairCaseId: excelImportRows.resultRepairCaseId }).from(excelImportRows).where(eq(excelImportRows.batchId, batch.id)).for("update");
      const rowIds = rows.map((row) => row.id);
      const attempts = rowIds.length === 0 ? [] : await tx.select({ status: excelImportRowAttempts.status, resultRepairCaseId: excelImportRowAttempts.resultRepairCaseId }).from(excelImportRowAttempts).where(inArray(excelImportRowAttempts.importRowId, rowIds)).for("update");
      const idempotency = rowIds.length === 0 ? [] : await tx.select({ status: repairCaseIdempotencyKeys.status, repairCaseId: repairCaseIdempotencyKeys.repairCaseId }).from(repairCaseIdempotencyKeys).where(inArray(repairCaseIdempotencyKeys.idempotencyKey, rowIds));
      const executionRows = rows.filter((row) => row.status !== "EXCLUDED" && row.status !== "PENDING_REVIEW" && row.status !== "MAPPING_REQUIRED");
      const guardsPass =
        rows.length === 10 &&
        executionRows.length === 10 &&
        executionRows.every((row) => row.status === "FAILED" && row.resultRepairCaseId === null) &&
        attempts.length === 20 &&
        attempts.every((attempt) => attempt.status === "FAILED" && attempt.resultRepairCaseId === null) &&
        idempotency.length === 10 &&
        idempotency.every((key) => key.status === "FAILED" && key.repairCaseId === null);
      if (!guardsPass) return { ok: false, code: "RECONCILIATION_GUARD_FAILED" };

      const [updated] = await tx.update(excelImportBatches).set({ status: "FAILED", completedAt: new Date(), version: sql`${excelImportBatches.version} + 1`, updatedAt: sql`now()` }).where(and(eq(excelImportBatches.id, batch.id), eq(excelImportBatches.version, batch.version), eq(excelImportBatches.status, "PARTIAL_SUCCESS"))).returning({ version: excelImportBatches.version });
      if (!updated) return { ok: false, code: "STALE_BATCH_VERSION" };
      await insertAuditLog(tx, {
        actorUserId: input.actorUserId,
        actionType: "EXCEL_IMPORT",
        targetEntity: "excel_import_batches",
        targetRecordId: batch.id,
        previousValue: { status: "PARTIAL_SUCCESS", version: batch.version },
        newValue: {
          operation: "BATCH_STATUS_RECONCILIATION",
          status: "FAILED",
          version: updated.version,
          rows: 10,
          failedAttempts: 20,
          resultRepairCases: 0,
        },
      });
      return { ok: true, batchId: batch.id, version: updated.version, status: "FAILED" };
    });
  } catch {
    return { ok: false, code: "DATABASE_UNAVAILABLE" };
  }
}
