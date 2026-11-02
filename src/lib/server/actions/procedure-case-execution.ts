"use server";

import { readSession } from "@/lib/auth/session";
import { getAuthSource } from "@/lib/config/auth-source";
import {
  startProcedureExecution,
  finishProcedureExecution,
  resumeProcedureExecution,
  abandonProcedureExecution,
  startExecutionNode,
  completeExecutionNode,
  skipExecutionNode,
  blockExecutionNode,
  reopenExecutionNode,
  addExecutionExtraTask,
  updateExecutionNodeMemo,
  type StartExecutionResult,
  type ExecutionNodeMutationResult,
  type ExecutionLifecycleResult,
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

/**
 * `startAtProcedureTemplateNodeId` — 중간부터 시작할 때 고른 **템플릿 노드**의 id
 * (2026-11-02, 조각 7). 안 넘기거나 null 이면 지금까지와 똑같이 **처음부터** 시작한다.
 *
 * 🔴 여기서는 **모양만** 본다(UUID 인가). 「그 절차의 노드인가 · 고를 수 있는
 * 종류인가」는 변이가 제 트랜잭션 안에서 템플릿을 다시 읽어 가른다 — 이 파일
 * 머리말의 규약 그대로, 화면도 액션도 집행 경계가 아니다.
 */
export async function startProcedureExecutionAction(input: {
  repairCaseId: string;
  procedureTemplateId: string;
  startAtProcedureTemplateNodeId?: string | null;
}): Promise<StartExecutionResult | Forbidden> {
  const actorCheck = await resolveAuthorizedActorId();
  if (!actorCheck.ok) return actorCheck.result;
  if (!isValidUuid(input.repairCaseId) || !isValidUuid(input.procedureTemplateId)) {
    return { ok: false, code: "FORBIDDEN", message: "요청 정보를 확인할 수 없습니다." };
  }
  const startAt = input.startAtProcedureTemplateNodeId ?? null;
  if (startAt !== null && !isValidUuid(startAt)) {
    return { ok: false, code: "FORBIDDEN", message: "요청 정보를 확인할 수 없습니다." };
  }

  return withErrorRedaction("startProcedureExecutionAction", () =>
    startProcedureExecution(input.repairCaseId, input.procedureTemplateId, actorCheck.userId, startAt)
  );
}

/**
 * 실행 끝내기. `confirmedRemaining` 은 **사람이 확인 창에서 「그래도 끝낸다」를
 * 누른 경우에만** true 다 — 화면이 기본으로 켜서 보내면 묻는 의미가 사라진다.
 * 안 끝난 것이 남았는데 이 값이 false 면 서버가 UNFINISHED_NODES_REMAIN 으로
 * 돌려보내고, 화면은 그때 물어서 다시 부른다.
 */
export async function finishProcedureExecutionAction(input: {
  executionId: string;
  expectedVersion: number;
  confirmedRemaining?: boolean;
}): Promise<ExecutionLifecycleResult | Forbidden> {
  const actorCheck = await resolveAuthorizedActorId();
  if (!actorCheck.ok) return actorCheck.result;
  if (!isValidUuid(input.executionId)) return { ok: false, code: "FORBIDDEN", message: "요청 정보를 확인할 수 없습니다." };

  return withErrorRedaction("finishProcedureExecutionAction", () =>
    finishProcedureExecution(input.executionId, actorCheck.userId, input.expectedVersion, input.confirmedRemaining === true)
  );
}

/**
 * 마친 실행을 **다시 잇는다**(2026-11-02, 조각 9) — completed_at 을 비운다.
 *
 * 🔵 받는 것이 **둘뿐**인 까닭: 사유를 안 받고(치우는 일이 아니라 되돌릴 수 있는
 * 일이다), 확인 표시도 안 받는다(물어야 할 것이 없다 — 남은 작업이 있는 채로
 * 마친 실행을 다시 돌게 하는 것이 사람이 바라는 바로 그것이다). 무엇을 거절하는지는
 * 전부 변이가 제 트랜잭션 안에서 다시 판정한다 — 이 파일 머리말의 규약 그대로,
 * 화면도 액션도 집행 경계가 아니다.
 */
export async function resumeProcedureExecutionAction(input: {
  executionId: string;
  expectedVersion: number;
}): Promise<ExecutionLifecycleResult | Forbidden> {
  const actorCheck = await resolveAuthorizedActorId();
  if (!actorCheck.ok) return actorCheck.result;
  if (!isValidUuid(input.executionId)) return { ok: false, code: "FORBIDDEN", message: "요청 정보를 확인할 수 없습니다." };

  return withErrorRedaction("resumeProcedureExecutionAction", () =>
    resumeProcedureExecution(input.executionId, actorCheck.userId, input.expectedVersion)
  );
}

/** 실행 그만두기(소프트 삭제). 건너뛰기·차단과 같은 사유 검증을 쓴다. */
export async function abandonProcedureExecutionAction(input: {
  executionId: string;
  expectedVersion: number;
  reason: string;
}): Promise<ExecutionLifecycleResult | Forbidden> {
  const actorCheck = await resolveAuthorizedActorId();
  if (!actorCheck.ok) return actorCheck.result;
  if (!isValidUuid(input.executionId)) return { ok: false, code: "FORBIDDEN", message: "요청 정보를 확인할 수 없습니다." };
  const reasonValidation = validateRequiredNote(input.reason);
  if (!reasonValidation.ok) return { ok: false, code: "FORBIDDEN", message: reasonValidation.error };

  return withErrorRedaction("abandonProcedureExecutionAction", () =>
    abandonProcedureExecution(input.executionId, actorCheck.userId, input.expectedVersion, reasonValidation.note)
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
