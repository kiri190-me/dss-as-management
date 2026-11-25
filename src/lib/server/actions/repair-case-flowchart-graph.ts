"use server";

import { readSession } from "@/lib/auth/session";
import { getAuthSource } from "@/lib/config/auth-source";
import {
  createRepairCaseFlowchartNode,
  updateRepairCaseFlowchartNode,
  changeRepairCaseFlowchartNodeType,
  saveRepairCaseFlowchartLayout,
  deleteRepairCaseFlowchartNode,
  createRepairCaseFlowchartEdge,
  updateRepairCaseFlowchartEdge,
  retargetRepairCaseFlowchartEdge,
  deleteRepairCaseFlowchartEdge,
  saveRepairCaseFlowchartEdgeRoute,
  insertRepairCaseFlowchartNodeOnEdge,
  type NodeHasConnectedEdgesFailure,
} from "@/lib/db/mutations/repair-case-flowchart-graph";
import {
  isValidUuid,
  isValidExpectedUpdatedAt,
  isValidNodeType,
  isValidBranchType,
  isValidPosition,
  isValidLayoutPositions,
  isValidRoutePoints,
  validateNodeTitle,
  validateNodeDescription,
  validateNodeInstructions,
  validateNodeShareDocRelativePath,
  validateBranchLabel,
} from "@/lib/validation/repair-case-flowchart-graph-input";
// 🔴 「그 자리에 실제로 있는가」를 묻는 길은 **이미 있는 한 벌**이다 — 제품 모델 가리킴이
//    쓰는 그 모듈 그대로다(베끼지 않는다: 깊이 · 기다리기 상한과 거르는 이름 규칙이 거기
//    한 곳에 있다).
import { resolveRepairDocsArchiveRoot } from "@/lib/storage/repair-docs-archive";
import { findRepairDocsEntry } from "@/lib/storage/repair-docs-entries";

/**
 * Server Actions for Phase 5C-6C graph (node/edge) mutations. Same layering
 * as repair-case-flowcharts.ts's (5C-6B) actions: resolve the session,
 * validate input shape, delegate to the mutation layer, redact unexpected
 * DB errors. Role/assignment/lock/ownership/concurrency authorization is
 * entirely re-checked inside the mutation layer — this file only confirms a
 * valid, approved session exists and that the request shape is well-formed.
 * No CaseFlowchartGraph UI adapter, routing/waypoint editing, or Undo/Redo
 * exists yet (6D/6E) — these actions are the mutation-layer surface only.
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

type ActionResult<T> = ({ ok: true } & T) | { ok: false; code: string; message: string };

function unauthorized(message: string): { ok: false; code: "UNAUTHORIZED"; message: string } {
  return { ok: false, code: "UNAUTHORIZED", message };
}
function validationError(message: string): { ok: false; code: "VALIDATION_ERROR"; message: string } {
  return { ok: false, code: "VALIDATION_ERROR", message };
}
/**
 * 공유폴더 쪽 거절(설정 없음 · 못 읽음 · 그 자리에 없음 · 폴더였음) — 🔴 글자 모양이
 * 틀린 것(VALIDATION_ERROR)과 **코드를 가른다.** 둘 다 「저장 실패」 한 줄로 보이지만,
 * 이쪽은 **사람이 적은 값이 아니라 그 서버의 형편**이라 다음에 볼 곳이 다르다.
 */
function shareFolderError(message: string): { ok: false; code: "SHARE_FOLDER_UNAVAILABLE"; message: string } {
  return { ok: false, code: "SHARE_FOLDER_UNAVAILABLE", message };
}
function databaseUnavailable(err: unknown, context: string): { ok: false; code: "DATABASE_UNAVAILABLE"; message: string } {
  const code = isPgErrorLike(err) ? err.code : undefined;
  console.error(`${context}: unexpected DB error`, { code });
  return { ok: false, code: "DATABASE_UNAVAILABLE", message: "일시적으로 처리할 수 없습니다. 잠시 후 다시 시도해 주세요." };
}

// ---- node ----

export async function createRepairCaseFlowchartNodeAction(input: {
  repairCaseId: string;
  flowchartId: string;
  nodeType: string;
  title: string;
  description?: string | null;
  position?: { x: number; y: number } | null;
  expectedFlowchartUpdatedAt: string;
}): Promise<ActionResult<{ nodeId: string; updatedAt: string }>> {
  const actorCheck = await resolveAuthorizedActorId();
  if (!actorCheck.ok) return unauthorized(actorCheck.result.message);
  if (!isValidUuid(input.repairCaseId) || !isValidUuid(input.flowchartId)) return validationError("요청을 확인할 수 없습니다.");
  if (!isValidNodeType(input.nodeType)) return validationError("지원되지 않는 노드 유형입니다.");
  if (!isValidExpectedUpdatedAt(input.expectedFlowchartUpdatedAt)) return validationError("요청이 올바르지 않습니다. 새로고침 후 다시 시도하세요.");
  if (input.position !== undefined && input.position !== null && !isValidPosition(input.position)) return validationError("노드 위치가 올바르지 않습니다.");
  const titleValidation = validateNodeTitle(input.title);
  if (!titleValidation.ok) return validationError(titleValidation.error);
  const descriptionValidation = validateNodeDescription(input.description);
  if (!descriptionValidation.ok) return validationError(descriptionValidation.error);

  try {
    return await createRepairCaseFlowchartNode({
      repairCaseId: input.repairCaseId,
      flowchartId: input.flowchartId,
      actorUserId: actorCheck.userId,
      nodeType: input.nodeType,
      title: titleValidation.title,
      description: descriptionValidation.description,
      position: input.position ?? null,
      expectedFlowchartUpdatedAt: input.expectedFlowchartUpdatedAt,
    });
  } catch (err) {
    return databaseUnavailable(err, "createRepairCaseFlowchartNodeAction");
  }
}

/**
 * ============================================================================
 * 🔴 노드가 가리키는 **공유폴더 속 파일**도 이 액션이 받는다 (2026-11-25)
 * ============================================================================
 * 칸 하나가 늘었을 뿐 통로는 그대로다 — 화면의 [저장]이 NODE_FIELDS 한 걸음에 제목 ·
 * 설명 · 작업 지시 요약과 **함께** 싣는다.
 *
 * ── 🔴 담기 전에 **그 자리에 실제로 있는지** 본다 ─────────────────────────
 * 제품 모델 가리킴(server/actions/product-model-share-docs.ts)이 세운 차례를 그대로
 * 따른다: ① 글자 규칙 + 열 수 있는 확장자(validateNodeShareDocRelativePath → 공용
 * 검사) → ② 공유폴더 루트 → ③ 그 자리에 **파일이** 서 있는가(findRepairDocsEntry).
 * 🔴 ③에서 폴더가 서 있으면 거절한다 — 이 칸에는 「파일인가 폴더인가」를 담을 자리가
 * 없어(노드 표에 경로 한 칸뿐이다) 나중에 **무엇으로 열지**를 가를 수 없다.
 *
 * ── 🔴 설정이 비어 있으면 **멈춘다**(읽기와 일부러 다르다) ─────────────────
 * 고르기 창이 읽는 통로(api/repair-cases/[id]/flowchart/share-folder/entries)는
 * `REPAIR_DOCS_ARCHIVE_DIR` 가 비면 `{status:"disabled"}` 로 **조용히 꺼진다**. 쓰는
 * 쪽은 반대로 **거절한다** — 가리킴은 「확인된 자리」라는 약속이고, 확인할 수 없을 때
 * 그냥 담으면 아무도 본 적 없는 경로가 표에 남는다.
 * 🔴 **값으로 치르는 값이 있다**: 그 노드가 **이미 가리키고 있는 채로** 제목만 고치는
 * 저장도 이 검사를 지난다(액션은 받은 칸 넷을 한 묶음으로 쓴다). 그래서 설정이 빠졌거나
 * 공유폴더를 못 읽는 서버에서는 **가리킨 노드의 칸 수정이 통째로 막힌다.** 가르려면
 * 저장할 때마다 그 노드의 **지금 값**을 한 번 더 읽어 「안 바뀐 값은 전에 확인된 값」임을
 * 서버가 스스로 확인해야 한다. 운영에서 공유폴더와 DB 가 같은 NAS 에 있어 「DB 는 되는데
 * 폴더만 못 읽는」 상태가 드물다고 보고, 읽기를 한 번 더 두는 대신 **막히는 쪽**을
 * 골랐다(2026-11-25). 🔵 **지우는 쪽(null)은 이 검사를 한 줄도 안 지난다** — 그래서
 * 설정이 빠진 서버에서도 가리킴을 **풀 수는** 있다(막힌 채로 갇히지 않는다).
 *
 * ── 🔴 거절 사유에 경로가 한 글자도 안 들어간다 ───────────────────────────
 * 이 서류함의 폴더 이름에는 고객사명이 섞여 있다. 아래 문장은 전부 붙박이이고, 저장소
 * 모듈이 만드는 실패 사유(`found.reason`)도 경로 없는 짧은 문장임이 그쪽에서 못 박혀 있다.
 * ============================================================================
 */
export async function updateRepairCaseFlowchartNodeAction(input: {
  repairCaseId: string;
  flowchartId: string;
  nodeId: string;
  title: string;
  description?: string | null;
  instructions?: string | null;
  /**
   * 🔴 **선택 칸이 아니다**(이웃 둘과 다르다). 이 액션은 받은 값으로 칸을 **덮어쓰므로**
   * 안 실으면 그 노드의 가리킴이 조용히 지워진다 — 새 호출부가 생기는 날 타입이 그것을
   * 먼저 묻게 둔다.
   */
  shareDocRelativePath: string | null;
  expectedFlowchartUpdatedAt: string;
}): Promise<ActionResult<{ updatedAt: string; changed: boolean }>> {
  const actorCheck = await resolveAuthorizedActorId();
  if (!actorCheck.ok) return unauthorized(actorCheck.result.message);
  if (!isValidUuid(input.repairCaseId) || !isValidUuid(input.flowchartId) || !isValidUuid(input.nodeId)) return validationError("요청을 확인할 수 없습니다.");
  if (!isValidExpectedUpdatedAt(input.expectedFlowchartUpdatedAt)) return validationError("요청이 올바르지 않습니다. 새로고침 후 다시 시도하세요.");
  const titleValidation = validateNodeTitle(input.title);
  if (!titleValidation.ok) return validationError(titleValidation.error);
  const descriptionValidation = validateNodeDescription(input.description);
  if (!descriptionValidation.ok) return validationError(descriptionValidation.error);
  const instructionsValidation = validateNodeInstructions(input.instructions);
  if (!instructionsValidation.ok) return validationError(instructionsValidation.error);
  // ── ① 글자 규칙 · 열 수 있는 확장자 — 디스크를 보기 전이다 ──────────────
  const shareDocValidation = validateNodeShareDocRelativePath(input.shareDocRelativePath);
  if (!shareDocValidation.ok) return validationError(shareDocValidation.error);

  // ── ②③ 그 자리에 **파일이** 실제로 있는가 — 가리킬 때만 묻는다 ──────────
  const shareDocRelativePath = shareDocValidation.shareDocRelativePath;
  if (shareDocRelativePath !== null) {
    const archiveRoot = resolveRepairDocsArchiveRoot();
    if (archiveRoot === null) {
      // 🔴 읽기는 조용히 꺼지지만 쓰기는 멈춘다 — 머리말 참조.
      return shareFolderError("공유폴더 위치가 설정되지 않아 자리를 확인할 수 없습니다(관리자에게 알려 주세요).");
    }
    const found = await findRepairDocsEntry({ root: archiveRoot, relativePath: shareDocRelativePath });
    if (found.status === "failed") {
      // 사유는 저장소 모듈이 만든 **경로 없는** 짧은 문장이다.
      return shareFolderError(found.reason);
    }
    if (found.status === "not-found") {
      return shareFolderError("공유폴더에서 그 파일을 찾을 수 없습니다.");
    }
    if (found.isDirectory) {
      return shareFolderError("그 자리에 있는 것은 폴더입니다 — 파일을 고르세요.");
    }
  }

  try {
    return await updateRepairCaseFlowchartNode({
      repairCaseId: input.repairCaseId,
      flowchartId: input.flowchartId,
      nodeId: input.nodeId,
      actorUserId: actorCheck.userId,
      title: titleValidation.title,
      description: descriptionValidation.description,
      instructions: instructionsValidation.instructions,
      // 🔴 들어온 글자 그대로 담는다 — 다듬은 이름으로 이으면 없는 파일이 된다.
      shareDocRelativePath,
      expectedFlowchartUpdatedAt: input.expectedFlowchartUpdatedAt,
    });
  } catch (err) {
    return databaseUnavailable(err, "updateRepairCaseFlowchartNodeAction");
  }
}

export async function changeRepairCaseFlowchartNodeTypeAction(input: {
  repairCaseId: string;
  flowchartId: string;
  nodeId: string;
  nodeType: string;
  expectedFlowchartUpdatedAt: string;
}): Promise<ActionResult<{ updatedAt: string; changed: boolean }>> {
  const actorCheck = await resolveAuthorizedActorId();
  if (!actorCheck.ok) return unauthorized(actorCheck.result.message);
  if (!isValidUuid(input.repairCaseId) || !isValidUuid(input.flowchartId) || !isValidUuid(input.nodeId)) return validationError("요청을 확인할 수 없습니다.");
  if (!isValidNodeType(input.nodeType)) return validationError("지원되지 않는 노드 유형입니다.");
  if (!isValidExpectedUpdatedAt(input.expectedFlowchartUpdatedAt)) return validationError("요청이 올바르지 않습니다. 새로고침 후 다시 시도하세요.");

  try {
    return await changeRepairCaseFlowchartNodeType({
      repairCaseId: input.repairCaseId,
      flowchartId: input.flowchartId,
      nodeId: input.nodeId,
      actorUserId: actorCheck.userId,
      nodeType: input.nodeType,
      expectedFlowchartUpdatedAt: input.expectedFlowchartUpdatedAt,
    });
  } catch (err) {
    return databaseUnavailable(err, "changeRepairCaseFlowchartNodeTypeAction");
  }
}

export async function saveRepairCaseFlowchartLayoutAction(input: {
  repairCaseId: string;
  flowchartId: string;
  positions: { id: string; positionX: number; positionY: number }[];
  expectedFlowchartUpdatedAt: string;
}): Promise<ActionResult<{ updatedAt: string; changed: boolean }>> {
  const actorCheck = await resolveAuthorizedActorId();
  if (!actorCheck.ok) return unauthorized(actorCheck.result.message);
  if (!isValidUuid(input.repairCaseId) || !isValidUuid(input.flowchartId)) return validationError("요청을 확인할 수 없습니다.");
  if (!isValidExpectedUpdatedAt(input.expectedFlowchartUpdatedAt)) return validationError("요청이 올바르지 않습니다. 새로고침 후 다시 시도하세요.");
  if (!isValidLayoutPositions(input.positions)) return validationError("노드 위치가 올바르지 않습니다.");

  try {
    return await saveRepairCaseFlowchartLayout({
      repairCaseId: input.repairCaseId,
      flowchartId: input.flowchartId,
      actorUserId: actorCheck.userId,
      positions: input.positions,
      expectedFlowchartUpdatedAt: input.expectedFlowchartUpdatedAt,
    });
  } catch (err) {
    return databaseUnavailable(err, "saveRepairCaseFlowchartLayoutAction");
  }
}

export async function deleteRepairCaseFlowchartNodeAction(input: {
  repairCaseId: string;
  flowchartId: string;
  nodeId: string;
  expectedFlowchartUpdatedAt: string;
}): Promise<ActionResult<{ updatedAt: string }> | NodeHasConnectedEdgesFailure> {
  const actorCheck = await resolveAuthorizedActorId();
  if (!actorCheck.ok) return unauthorized(actorCheck.result.message);
  if (!isValidUuid(input.repairCaseId) || !isValidUuid(input.flowchartId) || !isValidUuid(input.nodeId)) return validationError("요청을 확인할 수 없습니다.");
  if (!isValidExpectedUpdatedAt(input.expectedFlowchartUpdatedAt)) return validationError("요청이 올바르지 않습니다. 새로고침 후 다시 시도하세요.");

  try {
    return await deleteRepairCaseFlowchartNode({
      repairCaseId: input.repairCaseId,
      flowchartId: input.flowchartId,
      nodeId: input.nodeId,
      actorUserId: actorCheck.userId,
      expectedFlowchartUpdatedAt: input.expectedFlowchartUpdatedAt,
    });
  } catch (err) {
    return databaseUnavailable(err, "deleteRepairCaseFlowchartNodeAction");
  }
}

// ---- edge ----

export async function createRepairCaseFlowchartEdgeAction(input: {
  repairCaseId: string;
  flowchartId: string;
  fromNodeId: string;
  toNodeId: string;
  branchType: string;
  branchLabel?: string | null;
  expectedFlowchartUpdatedAt: string;
}): Promise<ActionResult<{ edgeId: string; updatedAt: string }>> {
  const actorCheck = await resolveAuthorizedActorId();
  if (!actorCheck.ok) return unauthorized(actorCheck.result.message);
  if (!isValidUuid(input.repairCaseId) || !isValidUuid(input.flowchartId) || !isValidUuid(input.fromNodeId) || !isValidUuid(input.toNodeId)) {
    return validationError("요청을 확인할 수 없습니다.");
  }
  if (!isValidBranchType(input.branchType)) return validationError("지원되지 않는 분기 유형입니다.");
  if (!isValidExpectedUpdatedAt(input.expectedFlowchartUpdatedAt)) return validationError("요청이 올바르지 않습니다. 새로고침 후 다시 시도하세요.");
  const branchLabelValidation = validateBranchLabel(input.branchLabel);
  if (!branchLabelValidation.ok) return validationError(branchLabelValidation.error);

  try {
    return await createRepairCaseFlowchartEdge({
      repairCaseId: input.repairCaseId,
      flowchartId: input.flowchartId,
      actorUserId: actorCheck.userId,
      fromNodeId: input.fromNodeId,
      toNodeId: input.toNodeId,
      branchType: input.branchType,
      branchLabel: branchLabelValidation.branchLabel,
      expectedFlowchartUpdatedAt: input.expectedFlowchartUpdatedAt,
    });
  } catch (err) {
    return databaseUnavailable(err, "createRepairCaseFlowchartEdgeAction");
  }
}

export async function updateRepairCaseFlowchartEdgeAction(input: {
  repairCaseId: string;
  flowchartId: string;
  edgeId: string;
  branchType: string;
  branchLabel?: string | null;
  expectedFlowchartUpdatedAt: string;
}): Promise<ActionResult<{ updatedAt: string; changed: boolean }>> {
  const actorCheck = await resolveAuthorizedActorId();
  if (!actorCheck.ok) return unauthorized(actorCheck.result.message);
  if (!isValidUuid(input.repairCaseId) || !isValidUuid(input.flowchartId) || !isValidUuid(input.edgeId)) return validationError("요청을 확인할 수 없습니다.");
  if (!isValidBranchType(input.branchType)) return validationError("지원되지 않는 분기 유형입니다.");
  if (!isValidExpectedUpdatedAt(input.expectedFlowchartUpdatedAt)) return validationError("요청이 올바르지 않습니다. 새로고침 후 다시 시도하세요.");
  const branchLabelValidation = validateBranchLabel(input.branchLabel);
  if (!branchLabelValidation.ok) return validationError(branchLabelValidation.error);

  try {
    return await updateRepairCaseFlowchartEdge({
      repairCaseId: input.repairCaseId,
      flowchartId: input.flowchartId,
      edgeId: input.edgeId,
      actorUserId: actorCheck.userId,
      branchType: input.branchType,
      branchLabel: branchLabelValidation.branchLabel,
      expectedFlowchartUpdatedAt: input.expectedFlowchartUpdatedAt,
    });
  } catch (err) {
    return databaseUnavailable(err, "updateRepairCaseFlowchartEdgeAction");
  }
}

export async function retargetRepairCaseFlowchartEdgeAction(input: {
  repairCaseId: string;
  flowchartId: string;
  edgeId: string;
  newFromNodeId: string;
  newToNodeId: string;
  expectedFlowchartUpdatedAt: string;
}): Promise<ActionResult<{ updatedAt: string }>> {
  const actorCheck = await resolveAuthorizedActorId();
  if (!actorCheck.ok) return unauthorized(actorCheck.result.message);
  if (
    !isValidUuid(input.repairCaseId) ||
    !isValidUuid(input.flowchartId) ||
    !isValidUuid(input.edgeId) ||
    !isValidUuid(input.newFromNodeId) ||
    !isValidUuid(input.newToNodeId)
  ) {
    return validationError("요청을 확인할 수 없습니다.");
  }
  if (!isValidExpectedUpdatedAt(input.expectedFlowchartUpdatedAt)) return validationError("요청이 올바르지 않습니다. 새로고침 후 다시 시도하세요.");

  try {
    return await retargetRepairCaseFlowchartEdge({
      repairCaseId: input.repairCaseId,
      flowchartId: input.flowchartId,
      edgeId: input.edgeId,
      actorUserId: actorCheck.userId,
      newFromNodeId: input.newFromNodeId,
      newToNodeId: input.newToNodeId,
      expectedFlowchartUpdatedAt: input.expectedFlowchartUpdatedAt,
    });
  } catch (err) {
    return databaseUnavailable(err, "retargetRepairCaseFlowchartEdgeAction");
  }
}

export async function deleteRepairCaseFlowchartEdgeAction(input: {
  repairCaseId: string;
  flowchartId: string;
  edgeId: string;
  expectedFlowchartUpdatedAt: string;
}): Promise<ActionResult<{ updatedAt: string }>> {
  const actorCheck = await resolveAuthorizedActorId();
  if (!actorCheck.ok) return unauthorized(actorCheck.result.message);
  if (!isValidUuid(input.repairCaseId) || !isValidUuid(input.flowchartId) || !isValidUuid(input.edgeId)) return validationError("요청을 확인할 수 없습니다.");
  if (!isValidExpectedUpdatedAt(input.expectedFlowchartUpdatedAt)) return validationError("요청이 올바르지 않습니다. 새로고침 후 다시 시도하세요.");

  try {
    return await deleteRepairCaseFlowchartEdge({
      repairCaseId: input.repairCaseId,
      flowchartId: input.flowchartId,
      edgeId: input.edgeId,
      actorUserId: actorCheck.userId,
      expectedFlowchartUpdatedAt: input.expectedFlowchartUpdatedAt,
    });
  } catch (err) {
    return databaseUnavailable(err, "deleteRepairCaseFlowchartEdgeAction");
  }
}

// ---- routing (5C-6D) ----

export async function saveRepairCaseFlowchartEdgeRouteAction(input: {
  repairCaseId: string;
  flowchartId: string;
  edgeId: string;
  routePoints: unknown;
  expectedFlowchartUpdatedAt: string;
}): Promise<ActionResult<{ updatedAt: string; changed: boolean }>> {
  const actorCheck = await resolveAuthorizedActorId();
  if (!actorCheck.ok) return unauthorized(actorCheck.result.message);
  if (!isValidUuid(input.repairCaseId) || !isValidUuid(input.flowchartId) || !isValidUuid(input.edgeId)) return validationError("요청을 확인할 수 없습니다.");
  if (!isValidExpectedUpdatedAt(input.expectedFlowchartUpdatedAt)) return validationError("요청이 올바르지 않습니다. 새로고침 후 다시 시도하세요.");
  if (!isValidRoutePoints(input.routePoints)) return validationError("경로점이 올바르지 않습니다.");

  try {
    return await saveRepairCaseFlowchartEdgeRoute({
      repairCaseId: input.repairCaseId,
      flowchartId: input.flowchartId,
      edgeId: input.edgeId,
      actorUserId: actorCheck.userId,
      routePoints: input.routePoints,
      expectedFlowchartUpdatedAt: input.expectedFlowchartUpdatedAt,
    });
  } catch (err) {
    return databaseUnavailable(err, "saveRepairCaseFlowchartEdgeRouteAction");
  }
}

export async function insertRepairCaseFlowchartNodeOnEdgeAction(input: {
  repairCaseId: string;
  flowchartId: string;
  edgeId: string;
  nodeType: string;
  title: string;
  position: { x: number; y: number };
  expectedFlowchartUpdatedAt: string;
}): Promise<ActionResult<{ nodeId: string; firstEdgeId: string; secondEdgeId: string; updatedAt: string }>> {
  const actorCheck = await resolveAuthorizedActorId();
  if (!actorCheck.ok) return unauthorized(actorCheck.result.message);
  if (!isValidUuid(input.repairCaseId) || !isValidUuid(input.flowchartId) || !isValidUuid(input.edgeId)) return validationError("요청을 확인할 수 없습니다.");
  if (!isValidNodeType(input.nodeType)) return validationError("지원되지 않는 노드 유형입니다.");
  if (!isValidPosition(input.position)) return validationError("노드 위치가 올바르지 않습니다.");
  if (!isValidExpectedUpdatedAt(input.expectedFlowchartUpdatedAt)) return validationError("요청이 올바르지 않습니다. 새로고침 후 다시 시도하세요.");
  const titleValidation = validateNodeTitle(input.title);
  if (!titleValidation.ok) return validationError(titleValidation.error);

  try {
    return await insertRepairCaseFlowchartNodeOnEdge({
      repairCaseId: input.repairCaseId,
      flowchartId: input.flowchartId,
      edgeId: input.edgeId,
      actorUserId: actorCheck.userId,
      nodeType: input.nodeType,
      title: titleValidation.title,
      position: input.position,
      expectedFlowchartUpdatedAt: input.expectedFlowchartUpdatedAt,
    });
  } catch (err) {
    return databaseUnavailable(err, "insertRepairCaseFlowchartNodeOnEdgeAction");
  }
}
