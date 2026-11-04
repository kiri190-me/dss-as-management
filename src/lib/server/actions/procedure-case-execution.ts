"use server";

import { readSession } from "@/lib/auth/session";
import { getAuthSource } from "@/lib/config/auth-source";
import {
  startProcedureExecution,
  finishProcedureExecution,
  resumeProcedureExecution,
  abandonProcedureExecution,
  startExecutionNode,
  jumpToExecutionNode,
  completeExecutionNode,
  skipExecutionNode,
  blockExecutionNode,
  reopenExecutionNode,
  addExecutionExtraTask,
  removeExecutionExtraTask,
  moveExecutionExtraTask,
  addExecutionEdge,
  removeExecutionEdge,
  updateExecutionNodeMemo,
  type StartExecutionResult,
  type ExecutionNodeMutationResult,
  type ExecutionLifecycleResult,
  type AddExtraTaskResult,
  type MoveExecutionExtraTaskResult,
  type AddExecutionEdgeResult,
  type RemoveExecutionEdgeResult,
} from "@/lib/db/mutations/procedure-case-execution";
import { isExtraTaskNodeType } from "@/lib/domain/procedure-case-execution-types";
import { resolveNextProcedureForExecutionNode } from "@/lib/db/queries/procedure-case-execution";
import { isUsableGraphPoint } from "@/lib/domain/procedure-execution-layout";
import { PROCEDURE_BRANCH_TYPE_CODES, type ProcedureBranchType } from "@/lib/domain/procedure-template-types";
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

/**
 * 「지금 할 일」을 **고른 노드로 옮긴다**(2026-11-02, 조각 10).
 *
 * 🔴 `executionId` 를 함께 받는 까닭: 변이가 **그 실행의 노드인지**를 맞대어 봐야
 * 한다. 여기서는 **모양만** 본다(UUID 인가) — 그 실행이 도는 중인지, 옮길 수 있는
 * 상태인지는 변이가 제 트랜잭션 안에서 잠근 행으로 다시 가른다(이 파일 머리말의
 * 규약 그대로, 화면도 액션도 집행 경계가 아니다).
 */
export async function jumpToExecutionNodeAction(input: {
  executionId: string;
  executionNodeId: string;
  expectedVersion: number;
}): Promise<ExecutionNodeMutationResult | Forbidden> {
  const actorCheck = await resolveAuthorizedActorId();
  if (!actorCheck.ok) return actorCheck.result;
  if (!isValidUuid(input.executionId) || !isValidUuid(input.executionNodeId)) {
    return { ok: false, code: "FORBIDDEN", message: "요청 정보를 확인할 수 없습니다." };
  }

  return withErrorRedaction("jumpToExecutionNodeAction", () =>
    jumpToExecutionNode(input.executionId, input.executionNodeId, actorCheck.userId, input.expectedVersion)
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

/**
 * `nodeType` — 🔵 2026-11-03(조각 13). 안 넘기면 전과 똑같이 갈래 없이 만든다.
 *
 * `position` — 🔵 2026-11-03(조각 14). 사람이 **상·하·좌·우**를 골랐을 때만
 * 온다. 안 넘기면(= 기준이 될 작업을 안 골랐을 때) 자리를 비워 두고, 조회가
 * 전과 똑같이 센다.
 *
 * 🔴 여기서는 **허용 목록 안인가 · 쓸 수 있는 수인가**만 본다. 「만들어도 되는
 * 사람인가」는 변이가 제 트랜잭션 안에서 다시 가른다(이 파일 머리말의 규약).
 */
export async function addExecutionExtraTaskAction(input: {
  executionId: string;
  title: string;
  instructions?: string | null;
  nodeType?: string | null;
  position?: { x: number; y: number } | null;
}): Promise<AddExtraTaskResult | Forbidden> {
  const actorCheck = await resolveAuthorizedActorId();
  if (!actorCheck.ok) return actorCheck.result;
  if (!isValidUuid(input.executionId)) return { ok: false, code: "FORBIDDEN", message: "요청 정보를 확인할 수 없습니다." };
  if (typeof input.title !== "string" || input.title.trim().length === 0) {
    return { ok: false, code: "FORBIDDEN", message: "작업 제목을 입력해 주세요." };
  }
  const nodeType = input.nodeType ?? null;
  if (nodeType !== null && !isExtraTaskNodeType(nodeType)) {
    return { ok: false, code: "FORBIDDEN", message: "이 창에서 만들 수 없는 노드 유형입니다." };
  }
  // 🔵 **안 보낸 것**과 **이상한 값**을 가른다 — 앞은 「방향을 안 골랐다」는
  //    정상이고, 뒤는 거절할 일이다.
  const position = input.position ?? null;
  if (position !== null && !isUsableGraphPoint(position)) {
    return { ok: false, code: "FORBIDDEN", message: "작업을 놓을 자리를 확인할 수 없습니다." };
  }

  return withErrorRedaction("addExecutionExtraTaskAction", () =>
    addExecutionExtraTask(
      input.executionId,
      actorCheck.userId,
      input.title,
      input.instructions?.trim() || null,
      nodeType,
      position
    )
  );
}

/**
 * 이 건에서 더한 작업을 **그림에서 옮긴다**(2026-11-03, 조각 14) — 놓는 순간
 * 저장한다.
 *
 * 🔴 **expectedVersion 을 안 받는다.** 이 파일에서 낙관적 잠금 토큰을 안 받는
 * 유일한 통로이고, 까닭은 변이 쪽 머리말에 적어 두었다(요지: 좌표는 다툴 것이
 * 없는데 토큰을 올리면 옆 사람의 탭이 **다음 작업에서** CONFLICT 로 튕긴다).
 */
export async function moveExecutionExtraTaskAction(input: {
  executionNodeId: string;
  position: { x: number; y: number };
}): Promise<MoveExecutionExtraTaskResult | Forbidden> {
  const actorCheck = await resolveAuthorizedActorId();
  if (!actorCheck.ok) return actorCheck.result;
  if (!isValidUuid(input.executionNodeId)) return { ok: false, code: "FORBIDDEN", message: "요청 정보를 확인할 수 없습니다." };
  if (!isUsableGraphPoint(input.position)) {
    return { ok: false, code: "FORBIDDEN", message: "작업을 놓을 자리를 확인할 수 없습니다." };
  }

  return withErrorRedaction("moveExecutionExtraTaskAction", () =>
    moveExecutionExtraTask({
      executionNodeId: input.executionNodeId,
      actorUserId: actorCheck.userId,
      position: input.position,
    })
  );
}

/**
 * 이 건에서 더한 작업을 치운다(2026-11-03, 조각 13).
 *
 * 🔴 사유는 **안 받는다**. 절차 편집기의 노드 삭제도 사유가 선택이고, 여기서
 * 굳이 요구하면 「잘못 만들었다」를 지울 때마다 글을 써야 한다. 누가 언제 치웠는지는
 * 칸에 남는다(deleted_by · deleted_at).
 */
export async function removeExecutionExtraTaskAction(input: {
  executionNodeId: string;
  expectedVersion: number;
  reason?: string | null;
}): Promise<ExecutionNodeMutationResult | Forbidden> {
  const actorCheck = await resolveAuthorizedActorId();
  if (!actorCheck.ok) return actorCheck.result;
  if (!isValidUuid(input.executionNodeId)) return { ok: false, code: "FORBIDDEN", message: "요청 정보를 확인할 수 없습니다." };

  return withErrorRedaction("removeExecutionExtraTaskAction", () =>
    removeExecutionExtraTask(input.executionNodeId, actorCheck.userId, input.expectedVersion, input.reason?.trim() || null)
  );
}

export async function addExecutionEdgeAction(input: {
  executionId: string;
  fromExecutionNodeId: string;
  toExecutionNodeId: string;
  branchType: string;
  branchLabel?: string | null;
}): Promise<AddExecutionEdgeResult | Forbidden> {
  const actorCheck = await resolveAuthorizedActorId();
  if (!actorCheck.ok) return actorCheck.result;
  if (
    !isValidUuid(input.executionId) ||
    !isValidUuid(input.fromExecutionNodeId) ||
    !isValidUuid(input.toExecutionNodeId)
  ) {
    return { ok: false, code: "FORBIDDEN", message: "요청 정보를 확인할 수 없습니다." };
  }
  if (!PROCEDURE_BRANCH_TYPE_CODES.includes(input.branchType as ProcedureBranchType)) {
    return { ok: false, code: "FORBIDDEN", message: "분기 유형을 다시 선택해 주세요." };
  }

  return withErrorRedaction("addExecutionEdgeAction", () =>
    addExecutionEdge({
      executionId: input.executionId,
      fromExecutionNodeId: input.fromExecutionNodeId,
      toExecutionNodeId: input.toExecutionNodeId,
      branchType: input.branchType as ProcedureBranchType,
      branchLabel: input.branchLabel?.trim() || null,
      actorUserId: actorCheck.userId,
    })
  );
}

export async function removeExecutionEdgeAction(input: {
  edgeId: string;
  reason?: string | null;
}): Promise<RemoveExecutionEdgeResult | Forbidden> {
  const actorCheck = await resolveAuthorizedActorId();
  if (!actorCheck.ok) return actorCheck.result;
  if (!isValidUuid(input.edgeId)) return { ok: false, code: "FORBIDDEN", message: "요청 정보를 확인할 수 없습니다." };

  return withErrorRedaction("removeExecutionEdgeAction", () =>
    removeExecutionEdge(input.edgeId, actorCheck.userId, input.reason?.trim() || null)
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

/**
 * ============================================================================
 * [종료]를 완료하고 **다음 절차를 이어서 시작**한다 (2026-11-04, 줄기 B ④ 조각 ④)
 * ============================================================================
 * 사용자 결정(2026-11-04): **넘어가는 순간 한 번 묻는다**, 그리고 **지금 절차는
 * 안 끝난 채로 둔다**. 그래서 이 통로는 끝내기(finishProcedureExecution)를
 * 부르지 않는다 — 끝내기는 사람이 따로 누르는 별개의 조작 그대로다.
 *
 * ── 🔴 왜 한 트랜잭션이 아닌가, 그리고 왜 그래도 안전한가 ───────────────
 * 완료와 시작은 **서로 다른 트랜잭션**이다(startProcedureExecution 이 제
 * 트랜잭션을 열고, 권한·건 잠금·유무상 확정 검사를 그 안에서 한다. 그것을
 * 쪼개 가져오면 검사가 두 벌이 된다).
 *
 * 🔵 그래서 중간 상태가 **뜻이 있는 상태**가 되도록 차례를 잡았다. 완료는
 * 됐는데 시작이 실패하면, 그것은 사람이 창에서 [완료만 하기]를 고른 것과
 * **똑같은 상태**다 — 망가진 중간이 아니다. 그리고 실행 화면이 「이어집니다 —
 * [이어서 시작]」 카드를 계속 띄우므로 다시 누를 길이 남는다.
 *
 * 🔴 **그래서 결과가 「무엇까지 됐는지」를 반드시 말해야 한다.** 그냥
 * `ok: false` 로 뭉개면 사람은 완료도 안 된 줄 알고 [완료]를 다시 누른다
 * (그때는 이미 완료된 노드라 또 다른 오류가 뜬다).
 * ============================================================================
 */
export type CompleteAndStartNextProcedureResult =
  | { ok: true; startedExecutionId: string }
  /** 완료는 됐지만 이어서 시작하지 못했다 — 사람이 [완료만 하기]를 고른 것과 같은 상태다. */
  | { ok: false; completed: true; message: string }
  /** 완료 자체가 안 됐다 — 아무것도 안 바뀌었다. */
  | { ok: false; completed: false; message: string };

export async function completeAndStartNextProcedureAction(input: {
  executionNodeId: string;
  expectedVersion: number;
}): Promise<CompleteAndStartNextProcedureResult> {
  const actorCheck = await resolveAuthorizedActorId();
  if (!actorCheck.ok) {
    return { ok: false, completed: false, message: actorCheck.result.message };
  }
  if (!isValidUuid(input.executionNodeId)) {
    return { ok: false, completed: false, message: "요청 정보를 확인할 수 없습니다." };
  }

  // 🔴 **시작할 곳을 먼저 푼다.** 완료부터 하면, 이어갈 곳이 없는 것이 드러났을
  //    때 이미 노드가 완료된 뒤다 — 사람은 「이어서 시작」을 눌렀는데 완료만
  //    일어난 까닭을 알 수 없다. 화면이 보낸 값은 쓰지 않는다(서버가 제 눈으로
  //    다시 읽는다 — resolveNextProcedureForExecutionNode 머리말).
  const target = await resolveNextProcedureForExecutionNode(input.executionNodeId);
  if (!target.ok) {
    return { ok: false, completed: false, message: target.reason };
  }

  const completed = await withErrorRedaction("completeAndStartNextProcedureAction:complete", () =>
    completeExecutionNode({
      executionNodeId: input.executionNodeId,
      actorUserId: actorCheck.userId,
      expectedVersion: input.expectedVersion,
      selectedOutgoingEdgeId: null,
      reason: null,
    })
  );
  if (!completed.ok) {
    return { ok: false, completed: false, message: completed.message };
  }

  const started = await withErrorRedaction("completeAndStartNextProcedureAction:start", () =>
    startProcedureExecution(target.repairCaseId, target.templateId, actorCheck.userId)
  );
  if (!started.ok) {
    return {
      ok: false,
      completed: true,
      message: `이 단계는 완료했지만 다음 절차를 시작하지 못했습니다 — ${started.message} 아래 [이어서 시작]으로 다시 시도할 수 있습니다.`,
    };
  }

  return { ok: true, startedExecutionId: started.executionId };
}

/**
 * 완료는 건드리지 않고 **다음 절차만 시작**한다 — 창에서 [완료만 하기]를 고른
 * 뒤, 또는 위에서 시작이 실패한 뒤 다시 누르는 길이다(줄기 B ④ 조각 ④).
 */
export async function startNextProcedureAction(input: {
  executionNodeId: string;
}): Promise<StartExecutionResult | Forbidden> {
  const actorCheck = await resolveAuthorizedActorId();
  if (!actorCheck.ok) return actorCheck.result;
  if (!isValidUuid(input.executionNodeId)) {
    return { ok: false, code: "FORBIDDEN", message: "요청 정보를 확인할 수 없습니다." };
  }

  const target = await resolveNextProcedureForExecutionNode(input.executionNodeId);
  if (!target.ok) return { ok: false, code: "NOT_FOUND", message: target.reason };

  return withErrorRedaction("startNextProcedureAction", () =>
    startProcedureExecution(target.repairCaseId, target.templateId, actorCheck.userId)
  );
}
