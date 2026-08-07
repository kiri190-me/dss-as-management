"use server";

import { readSession } from "@/lib/auth/session";
import { getAuthSource } from "@/lib/config/auth-source";
import {
  startProcedureExecution,
  startExecutionNode,
  completeExecutionNode,
  skipExecutionNode,
  blockExecutionNode,
  reopenExecutionNode,
  addExecutionExtraTask,
  updateExecutionNodeMemo,
  type StartExecutionResult,
  type ExecutionNodeMutationResult,
  type AddExtraTaskResult,
} from "@/lib/db/mutations/procedure-case-execution";
import { isValidUuid, validateRequiredNote } from "@/lib/validation/procedure-validation-resolution-input";

/**
 * Server Actions for Phase 5A repair-case procedure execution. Same
 * layering as procedure-template-editor.ts's actions: resolve the session,
 * validate input shape, delegate, redact unexpected DB errors.
 *
 * Unlike procedure-template-editor.ts's actions (uniformly SUPER_ADMIN-
 * only, so resolveAuthorizedActorId bakes in one role check as a UX
 * shortcut), Phase 5A's role/assignment authorization varies per action and
 * depends on live case/node assignment data this layer doesn't otherwise
 * need to fetch — so resolveAuthorizedActorId here only confirms a valid,
 * approved session exists. The actual enforcement is entirely in
 * procedure-case-execution.ts's mutations, which re-check role, effective
 * assignment, and the case lock independently on every call; a hidden
 * button in the UI is a convenience only, never the enforcement boundary.
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

async function withErrorRedaction<T extends { ok: boolean }>(label: string, run: () => Promise<T>): Promise<T | Forbidden> {
  try {
    return await run();
  } catch (err) {
    const code = isPgErrorLike(err) ? err.code : undefined;
    console.error(`${label}: unexpected DB error`, { code });
    return { ok: false, code: "FORBIDDEN", message: "일시적으로 처리할 수 없습니다. 잠시 후 다시 시도해 주세요." };
  }
}

export async function startProcedureExecutionAction(input: {
  repairCaseId: string;
  procedureTemplateId: string;
}): Promise<StartExecutionResult | Forbidden> {
  const actorCheck = await resolveAuthorizedActorId();
  if (!actorCheck.ok) return actorCheck.result;
  if (!isValidUuid(input.repairCaseId) || !isValidUuid(input.procedureTemplateId)) {
    return { ok: false, code: "FORBIDDEN", message: "요청 정보를 확인할 수 없습니다." };
  }

  return withErrorRedaction("startProcedureExecutionAction", () =>
    startProcedureExecution(input.repairCaseId, input.procedureTemplateId, actorCheck.userId)
  );
}

export async function startExecutionNodeAction(input: {
  executionNodeId: string;
  expectedVersion: number;
}): Promise<ExecutionNodeMutationResult | Forbidden> {
  const actorCheck = await resolveAuthorizedActorId();
  if (!actorCheck.ok) return actorCheck.result;
  if (!isValidUuid(input.executionNodeId)) return { ok: false, code: "FORBIDDEN", message: "요청 정보를 확인할 수 없습니다." };

  return withErrorRedaction("startExecutionNodeAction", () =>
    startExecutionNode(input.executionNodeId, actorCheck.userId, input.expectedVersion)
  );
}

export async function completeExecutionNodeAction(input: {
  executionNodeId: string;
  expectedVersion: number;
  selectedOutgoingEdgeId?: string | null;
  reason?: string | null;
}): Promise<ExecutionNodeMutationResult | Forbidden> {
  const actorCheck = await resolveAuthorizedActorId();
  if (!actorCheck.ok) return actorCheck.result;
  if (!isValidUuid(input.executionNodeId)) return { ok: false, code: "FORBIDDEN", message: "요청 정보를 확인할 수 없습니다." };
  if (input.selectedOutgoingEdgeId != null && !isValidUuid(input.selectedOutgoingEdgeId)) {
    return { ok: false, code: "FORBIDDEN", message: "요청 정보를 확인할 수 없습니다." };
  }

  return withErrorRedaction("completeExecutionNodeAction", () =>
    completeExecutionNode({
      executionNodeId: input.executionNodeId,
      actorUserId: actorCheck.userId,
      expectedVersion: input.expectedVersion,
      selectedOutgoingEdgeId: input.selectedOutgoingEdgeId ?? null,
      reason: input.reason?.trim() || null,
    })
  );
}

export async function skipExecutionNodeAction(input: {
  executionNodeId: string;
  expectedVersion: number;
  reason: string;
}): Promise<ExecutionNodeMutationResult | Forbidden> {
  const actorCheck = await resolveAuthorizedActorId();
  if (!actorCheck.ok) return actorCheck.result;
  if (!isValidUuid(input.executionNodeId)) return { ok: false, code: "FORBIDDEN", message: "요청 정보를 확인할 수 없습니다." };
  const reasonValidation = validateRequiredNote(input.reason);
  if (!reasonValidation.ok) return { ok: false, code: "FORBIDDEN", message: reasonValidation.error };

  return withErrorRedaction("skipExecutionNodeAction", () =>
    skipExecutionNode(input.executionNodeId, actorCheck.userId, input.expectedVersion, reasonValidation.note)
  );
}

export async function blockExecutionNodeAction(input: {
  executionNodeId: string;
  expectedVersion: number;
  reason: string;
}): Promise<ExecutionNodeMutationResult | Forbidden> {
  const actorCheck = await resolveAuthorizedActorId();
  if (!actorCheck.ok) return actorCheck.result;
  if (!isValidUuid(input.executionNodeId)) return { ok: false, code: "FORBIDDEN", message: "요청 정보를 확인할 수 없습니다." };
  const reasonValidation = validateRequiredNote(input.reason);
  if (!reasonValidation.ok) return { ok: false, code: "FORBIDDEN", message: reasonValidation.error };

  return withErrorRedaction("blockExecutionNodeAction", () =>
    blockExecutionNode(input.executionNodeId, actorCheck.userId, input.expectedVersion, reasonValidation.note)
  );
}

export async function reopenExecutionNodeAction(input: {
  executionNodeId: string;
  expectedVersion: number;
  reason: string;
}): Promise<ExecutionNodeMutationResult | Forbidden> {
  const actorCheck = await resolveAuthorizedActorId();
  if (!actorCheck.ok) return actorCheck.result;
  if (!isValidUuid(input.executionNodeId)) return { ok: false, code: "FORBIDDEN", message: "요청 정보를 확인할 수 없습니다." };
  const reasonValidation = validateRequiredNote(input.reason);
  if (!reasonValidation.ok) return { ok: false, code: "FORBIDDEN", message: reasonValidation.error };

  return withErrorRedaction("reopenExecutionNodeAction", () =>
    reopenExecutionNode(input.executionNodeId, actorCheck.userId, input.expectedVersion, reasonValidation.note)
  );
}

export async function addExecutionExtraTaskAction(input: {
  executionId: string;
  title: string;
  instructions?: string | null;
}): Promise<AddExtraTaskResult | Forbidden> {
  const actorCheck = await resolveAuthorizedActorId();
  if (!actorCheck.ok) return actorCheck.result;
  if (!isValidUuid(input.executionId)) return { ok: false, code: "FORBIDDEN", message: "요청 정보를 확인할 수 없습니다." };
  if (typeof input.title !== "string" || input.title.trim().length === 0) {
    return { ok: false, code: "FORBIDDEN", message: "작업 제목을 입력해 주세요." };
  }

  return withErrorRedaction("addExecutionExtraTaskAction", () =>
    addExecutionExtraTask(input.executionId, actorCheck.userId, input.title, input.instructions?.trim() || null)
  );
}

export async function updateExecutionNodeMemoAction(input: {
  executionNodeId: string;
  expectedVersion: number;
  memo: string | null;
}): Promise<ExecutionNodeMutationResult | Forbidden> {
  const actorCheck = await resolveAuthorizedActorId();
  if (!actorCheck.ok) return actorCheck.result;
  if (!isValidUuid(input.executionNodeId)) return { ok: false, code: "FORBIDDEN", message: "요청 정보를 확인할 수 없습니다." };

  return withErrorRedaction("updateExecutionNodeMemoAction", () =>
    updateExecutionNodeMemo(input.executionNodeId, actorCheck.userId, input.expectedVersion, input.memo?.trim() || null)
  );
}
