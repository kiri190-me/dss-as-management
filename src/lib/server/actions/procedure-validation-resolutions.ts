"use server";

import { readSession } from "@/lib/auth/session";
import { sessionActorWithDeveloperFlag } from "@/lib/auth/acting-user";
import { actorMay } from "@/lib/auth/developer-promotion";
import { getAuthSource } from "@/lib/config/auth-source";
import { canResolveProcedureValidationIssues } from "@/lib/auth/procedure-template-authorization";
import {
  bindValidationIssueEdge,
  resolveValidationIssueWithoutGraphChange,
  reopenValidationIssue,
  rollbackValidationIssueEdge,
  type ValidationResolutionResult,
} from "@/lib/db/mutations/procedure-validation-resolutions";
import { isValidUuid, validateRequiredNote } from "@/lib/validation/procedure-validation-resolution-input";
import type { ProcedureBranchType } from "@/lib/domain/procedure-template-types";
import { PROCEDURE_BRANCH_TYPE_CODES } from "@/lib/domain/procedure-template-types";

/**
 * Server Actions for Phase 3A validation resolution — same layering as
 * repair-case-approvals.ts: resolve the session, re-check role (the
 * mutation layer re-checks again against the live DB — this is a UX-speed
 * short-circuit, never the real enforcement boundary), validate input
 * shape, delegate, redact unexpected DB errors.
 */

async function resolveAuthorizedActorId(): Promise<{ ok: true; userId: string } | { ok: false; result: ValidationResolutionResult & { ok: false } }> {
  if (getAuthSource() !== "database") {
    return { ok: false, result: { ok: false, code: "FORBIDDEN", message: "데이터베이스 저장 모드가 아닙니다." } };
  }
  const session = await readSession();
  if (!session) {
    return { ok: false, result: { ok: false, code: "FORBIDDEN", message: "로그인이 필요합니다." } };
  }
  if (session.approvalStatus !== "APPROVED") {
    return { ok: false, result: { ok: false, code: "FORBIDDEN", message: "계정이 아직 승인되지 않았습니다." } };
  }
  if (!actorMay(await sessionActorWithDeveloperFlag(session), canResolveProcedureValidationIssues)) {
    return { ok: false, result: { ok: false, code: "FORBIDDEN", message: "검증 이슈 해결 권한이 없습니다 (SUPER_ADMIN 전용)." } };
  }
  return { ok: true, userId: session.userId };
}

function isPgErrorLike(err: unknown): err is { code?: string } {
  return typeof err === "object" && err !== null && "code" in err;
}

async function withErrorRedaction(label: string, run: () => Promise<ValidationResolutionResult>): Promise<ValidationResolutionResult> {
  try {
    return await run();
  } catch (err) {
    const code = isPgErrorLike(err) ? err.code : undefined;
    console.error(`${label}: unexpected DB error`, { code });
    return { ok: false, code: "CONFLICT", message: "일시적으로 처리할 수 없습니다. 잠시 후 다시 시도해 주세요." };
  }
}

export type BindConnectorActionInput = {
  issueId: string;
  sourceNodeId: string;
  targetNodeId: string;
  branchType: ProcedureBranchType;
  branchLabel?: string | null;
  resolutionNote: string;
};

export async function bindValidationIssueEdgeAction(input: BindConnectorActionInput): Promise<ValidationResolutionResult> {
  const actorCheck = await resolveAuthorizedActorId();
  if (!actorCheck.ok) return actorCheck.result;

  if (!isValidUuid(input.issueId) || !isValidUuid(input.sourceNodeId) || !isValidUuid(input.targetNodeId)) {
    return { ok: false, code: "VALIDATION_ERROR", message: "요청 정보를 확인할 수 없습니다." };
  }
  if (!(PROCEDURE_BRANCH_TYPE_CODES as readonly string[]).includes(input.branchType)) {
    return { ok: false, code: "VALIDATION_ERROR", message: "분기 유형을 확인할 수 없습니다." };
  }
  const noteValidation = validateRequiredNote(input.resolutionNote);
  if (!noteValidation.ok) {
    return { ok: false, code: "VALIDATION_ERROR", message: noteValidation.error };
  }

  return withErrorRedaction("bindValidationIssueEdgeAction", () =>
    bindValidationIssueEdge(input.issueId, actorCheck.userId, {
      sourceNodeId: input.sourceNodeId,
      targetNodeId: input.targetNodeId,
      branchType: input.branchType,
      branchLabel: input.branchLabel?.trim() || null,
      resolutionNote: noteValidation.note,
    })
  );
}

export type ResolveNoChangeActionInput = {
  issueId: string;
  outcome: "RESOLVED_NO_CHANGE" | "DEFERRED";
  resolutionNote: string;
  businessConfirmationReference?: string | null;
};

export async function resolveValidationIssueWithoutGraphChangeAction(input: ResolveNoChangeActionInput): Promise<ValidationResolutionResult> {
  const actorCheck = await resolveAuthorizedActorId();
  if (!actorCheck.ok) return actorCheck.result;

  if (!isValidUuid(input.issueId)) {
    return { ok: false, code: "VALIDATION_ERROR", message: "요청 정보를 확인할 수 없습니다." };
  }
  if (input.outcome !== "RESOLVED_NO_CHANGE" && input.outcome !== "DEFERRED") {
    return { ok: false, code: "VALIDATION_ERROR", message: "처리 결과를 확인할 수 없습니다." };
  }
  const noteValidation = validateRequiredNote(input.resolutionNote);
  if (!noteValidation.ok) {
    return { ok: false, code: "VALIDATION_ERROR", message: noteValidation.error };
  }

  return withErrorRedaction("resolveValidationIssueWithoutGraphChangeAction", () =>
    resolveValidationIssueWithoutGraphChange(input.issueId, actorCheck.userId, {
      outcome: input.outcome,
      resolutionNote: noteValidation.note,
      businessConfirmationReference: input.businessConfirmationReference?.trim() || null,
    })
  );
}

export async function reopenValidationIssueAction(input: { issueId: string; note: string }): Promise<ValidationResolutionResult> {
  const actorCheck = await resolveAuthorizedActorId();
  if (!actorCheck.ok) return actorCheck.result;

  if (!isValidUuid(input.issueId)) {
    return { ok: false, code: "VALIDATION_ERROR", message: "요청 정보를 확인할 수 없습니다." };
  }
  const noteValidation = validateRequiredNote(input.note);
  if (!noteValidation.ok) {
    return { ok: false, code: "VALIDATION_ERROR", message: noteValidation.error };
  }

  return withErrorRedaction("reopenValidationIssueAction", () => reopenValidationIssue(input.issueId, actorCheck.userId, { note: noteValidation.note }));
}

export async function rollbackValidationIssueEdgeAction(input: { issueId: string; note: string }): Promise<ValidationResolutionResult> {
  const actorCheck = await resolveAuthorizedActorId();
  if (!actorCheck.ok) return actorCheck.result;

  if (!isValidUuid(input.issueId)) {
    return { ok: false, code: "VALIDATION_ERROR", message: "요청 정보를 확인할 수 없습니다." };
  }
  const noteValidation = validateRequiredNote(input.note);
  if (!noteValidation.ok) {
    return { ok: false, code: "VALIDATION_ERROR", message: noteValidation.error };
  }

  return withErrorRedaction("rollbackValidationIssueEdgeAction", () => rollbackValidationIssueEdge(input.issueId, actorCheck.userId, { note: noteValidation.note }));
}
