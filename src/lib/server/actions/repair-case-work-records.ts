"use server";

import { readSession } from "@/lib/auth/session";
import { getAuthSource } from "@/lib/config/auth-source";
import { createWorkRecord, invalidateWorkRecord } from "@/lib/db/mutations/repair-case-work-records";
import {
  isValidRepairCaseId,
  isValidOptionalUuid,
  isValidUuid,
  validateWorkRecordMemo,
  validateWorkRecordKind,
  validateInvalidationReason,
  type CreateWorkRecordActionResult,
  type InvalidateWorkRecordActionResult,
} from "@/lib/validation/repair-case-work-record-input";

/**
 * Server Actions for Phase 5C-2 work records. Same layering as
 * procedure-case-execution.ts's actions: resolve the session, validate
 * input shape, delegate to the mutation layer, redact unexpected DB
 * errors. Role/assignment/lock authorization is entirely re-checked inside
 * the mutation layer — this file only confirms a valid, approved session
 * exists.
 */

type Forbidden = { ok: false; code: "FORBIDDEN"; message: string };

async function resolveAuthorizedActorId(): Promise<{ ok: true; userId: string } | { ok: false; result: Forbidden }> {
  if (getAuthSource() !== "database") {
    return { ok: false, result: { ok: false, code: "FORBIDDEN", message: "데이터베이스 저장 모드가 아닙니다." } };
  }
  const session = await readSession();
  if (!session) return { ok: false, result: { ok: false, code: "FORBIDDEN", message: "로그인이 필요합니다." } };
  if (session.approvalStatus !== "APPROVED") {
    return { ok: false, result: { ok: false, code: "FORBIDDEN", message: "계정이 아직 승인되지 않았습니다." } };
  }
  return { ok: true, userId: session.userId };
}

function isPgErrorLike(err: unknown): err is { code?: string } {
  return typeof err === "object" && err !== null && "code" in err;
}

export async function createWorkRecordAction(input: {
  repairCaseId: string;
  memo: string;
  /** Omitted/null/"" all default to GENERAL — see validateWorkRecordKind. */
  recordKind?: string | null;
  relatedProcedureExecutionNodeId?: string | null;
  clientRequestId: string;
}): Promise<CreateWorkRecordActionResult> {
  const actorCheck = await resolveAuthorizedActorId();
  if (!actorCheck.ok) return { ok: false, code: "UNAUTHORIZED", message: actorCheck.result.message };

  if (!isValidRepairCaseId(input.repairCaseId)) {
    return { ok: false, code: "VALIDATION_ERROR", message: "접수 건을 확인할 수 없습니다." };
  }
  if (!isValidUuid(input.clientRequestId)) {
    return { ok: false, code: "VALIDATION_ERROR", message: "요청 식별자를 확인할 수 없습니다." };
  }
  if (!isValidOptionalUuid(input.relatedProcedureExecutionNodeId)) {
    return { ok: false, code: "VALIDATION_ERROR", message: "선택한 절차 항목을 확인할 수 없습니다." };
  }
  const memoValidation = validateWorkRecordMemo(input.memo);
  if (!memoValidation.ok) {
    return { ok: false, code: "VALIDATION_ERROR", message: memoValidation.error };
  }
  const kindValidation = validateWorkRecordKind(input.recordKind);
  if (!kindValidation.ok) {
    return { ok: false, code: "VALIDATION_ERROR", message: kindValidation.error };
  }

  try {
    const result = await createWorkRecord({
      repairCaseId: input.repairCaseId,
      actorUserId: actorCheck.userId,
      memo: memoValidation.memo,
      recordKind: kindValidation.recordKind,
      relatedProcedureExecutionNodeId: input.relatedProcedureExecutionNodeId ?? null,
      clientRequestId: input.clientRequestId,
    });
    return result;
  } catch (err) {
    const code = isPgErrorLike(err) ? err.code : undefined;
    console.error("createWorkRecordAction: unexpected DB error", { code });
    return { ok: false, code: "DATABASE_UNAVAILABLE", message: "일시적으로 처리할 수 없습니다. 잠시 후 다시 시도해 주세요." };
  }
}

export async function invalidateWorkRecordAction(input: {
  workRecordId: string;
  reason: string;
}): Promise<InvalidateWorkRecordActionResult> {
  const actorCheck = await resolveAuthorizedActorId();
  if (!actorCheck.ok) return { ok: false, code: "UNAUTHORIZED", message: actorCheck.result.message };

  if (!isValidUuid(input.workRecordId)) {
    return { ok: false, code: "VALIDATION_ERROR", message: "작업 기록을 확인할 수 없습니다." };
  }
  const reasonValidation = validateInvalidationReason(input.reason);
  if (!reasonValidation.ok) {
    return { ok: false, code: "VALIDATION_ERROR", message: reasonValidation.error };
  }

  try {
    const result = await invalidateWorkRecord({
      workRecordId: input.workRecordId,
      actorUserId: actorCheck.userId,
      reason: reasonValidation.reason,
    });
    return result;
  } catch (err) {
    const code = isPgErrorLike(err) ? err.code : undefined;
    console.error("invalidateWorkRecordAction: unexpected DB error", { code });
    return { ok: false, code: "DATABASE_UNAVAILABLE", message: "일시적으로 처리할 수 없습니다. 잠시 후 다시 시도해 주세요." };
  }
}
