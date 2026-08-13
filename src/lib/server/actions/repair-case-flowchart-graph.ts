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
  validateBranchLabel,
} from "@/lib/validation/repair-case-flowchart-graph-input";

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

export async function updateRepairCaseFlowchartNodeAction(input: {
  repairCaseId: string;
  flowchartId: string;
  nodeId: string;
  title: string;
  description?: string | null;
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

  try {
    return await updateRepairCaseFlowchartNode({
      repairCaseId: input.repairCaseId,
      flowchartId: input.flowchartId,
      nodeId: input.nodeId,
      actorUserId: actorCheck.userId,
      title: titleValidation.title,
      description: descriptionValidation.description,
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
