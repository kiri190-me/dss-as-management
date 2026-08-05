"use server";

import { readSession } from "@/lib/auth/session";
import { getRepairCaseReadSource } from "@/lib/config/read-source";
import { getRepairCaseWriteSource } from "@/lib/config/write-source";
import { decideRepairCaseApproval, requestRepairCaseApproval } from "@/lib/db/mutations/repair-case-approvals";
import {
  isValidApprovalDecision,
  isValidApprovalType,
  isValidRepairCaseId,
  validateReasonFormat,
  type ApprovalActionResult,
  type ApprovalDecisionCode,
  type RepairCaseApprovalType,
} from "@/lib/validation/repair-case-approval-input";

/**
 * Server Actions for database-backed approval request/decision, same
 * auth + format-validation + error-redaction layering as
 * transition-workflow.ts. Never trusts a client-supplied approval status —
 * the mutation layer re-reads and re-evaluates everything from the DB.
 */

export type RequestApprovalActionInput = {
  repairCaseId: string;
  approvalType: RepairCaseApprovalType;
  reason?: string | null;
};

export type DecideApprovalActionInput = {
  repairCaseId: string;
  approvalType: RepairCaseApprovalType;
  decision: ApprovalDecisionCode;
  reason?: string | null;
};

async function resolveAuthorizedActorId(): Promise<
  { ok: true; userId: string } | { ok: false; result: ApprovalActionResult & { ok: false } }
> {
  if (getRepairCaseWriteSource() !== "database" || getRepairCaseReadSource() !== "database") {
    return { ok: false, result: { ok: false, code: "FORBIDDEN", message: "데이터베이스 저장 모드가 아닙니다." } };
  }
  const session = await readSession();
  if (!session) {
    return { ok: false, result: { ok: false, code: "UNAUTHORIZED", message: "로그인이 필요합니다." } };
  }
  if (session.approvalStatus !== "APPROVED") {
    return { ok: false, result: { ok: false, code: "FORBIDDEN", message: "계정이 아직 승인되지 않았습니다." } };
  }
  return { ok: true, userId: session.userId };
}

function isPgErrorLike(err: unknown): err is { code?: string } {
  return typeof err === "object" && err !== null && "code" in err;
}

export async function requestRepairCaseApprovalAction(
  input: RequestApprovalActionInput
): Promise<ApprovalActionResult> {
  const actorCheck = await resolveAuthorizedActorId();
  if (!actorCheck.ok) return actorCheck.result;

  if (!isValidRepairCaseId(input.repairCaseId)) {
    return { ok: false, code: "VALIDATION_ERROR", message: "접수 건을 확인할 수 없습니다." };
  }
  if (!isValidApprovalType(input.approvalType)) {
    return { ok: false, code: "INVALID_APPROVAL_TYPE", message: "승인 종류를 확인할 수 없습니다." };
  }
  const reasonValidation = validateReasonFormat(input.reason);
  if (!reasonValidation.ok) {
    return { ok: false, code: "VALIDATION_ERROR", message: reasonValidation.error };
  }

  try {
    return await requestRepairCaseApproval(
      input.repairCaseId,
      input.approvalType,
      actorCheck.userId,
      reasonValidation.reason
    );
  } catch (err) {
    const code = isPgErrorLike(err) ? err.code : undefined;
    console.error("requestRepairCaseApprovalAction: unexpected DB error", { code });
    return { ok: false, code: "DATABASE_UNAVAILABLE", message: "일시적으로 처리할 수 없습니다. 잠시 후 다시 시도해 주세요." };
  }
}

export async function decideRepairCaseApprovalAction(
  input: DecideApprovalActionInput
): Promise<ApprovalActionResult> {
  const actorCheck = await resolveAuthorizedActorId();
  if (!actorCheck.ok) return actorCheck.result;

  if (!isValidRepairCaseId(input.repairCaseId)) {
    return { ok: false, code: "VALIDATION_ERROR", message: "접수 건을 확인할 수 없습니다." };
  }
  if (!isValidApprovalType(input.approvalType)) {
    return { ok: false, code: "INVALID_APPROVAL_TYPE", message: "승인 종류를 확인할 수 없습니다." };
  }
  if (!isValidApprovalDecision(input.decision)) {
    return { ok: false, code: "VALIDATION_ERROR", message: "결정 종류를 확인할 수 없습니다." };
  }
  const reasonValidation = validateReasonFormat(input.reason);
  if (!reasonValidation.ok) {
    return { ok: false, code: "VALIDATION_ERROR", message: reasonValidation.error };
  }

  try {
    return await decideRepairCaseApproval(
      input.repairCaseId,
      input.approvalType,
      input.decision,
      actorCheck.userId,
      reasonValidation.reason
    );
  } catch (err) {
    const code = isPgErrorLike(err) ? err.code : undefined;
    console.error("decideRepairCaseApprovalAction: unexpected DB error", { code });
    return { ok: false, code: "DATABASE_UNAVAILABLE", message: "일시적으로 처리할 수 없습니다. 잠시 후 다시 시도해 주세요." };
  }
}
