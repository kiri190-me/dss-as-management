"use server";

import { readSession } from "@/lib/auth/session";
import { getAuthSource } from "@/lib/config/auth-source";
import { canEditProcedureTemplateDraft } from "@/lib/auth/procedure-template-authorization";
import {
  updateProcedureTemplateNode,
  changeProcedureTemplateNodeType,
  saveProcedureTemplateNodeLayout,
  updateProcedureTemplateEdge,
  retargetProcedureTemplateEdge,
  createProcedureTemplateEdge,
  validateProcedureTemplate,
  type UpdateNodePatch,
  type UpdateEdgePatch,
  type LayoutPosition,
  type NodeMutationResult,
  type ChangeNodeTypeResult,
  type SaveLayoutResult,
  type EdgeMutationResult,
  type RetargetEdgeResult,
  type CreateEdgeResult,
  type ValidateTemplateResult,
} from "@/lib/db/mutations/procedure-template-editor";
import { isValidUuid, validateRequiredNote } from "@/lib/validation/procedure-validation-resolution-input";
import { PROCEDURE_BRANCH_TYPE_CODES, PROCEDURE_NODE_TYPE_CODES, type ProcedureBranchType, type ProcedureNodeType } from "@/lib/domain/procedure-template-types";

/**
 * Server Actions for the Phase 4A controlled editor — same layering as
 * procedure-validation-resolutions.ts's actions: resolve the session,
 * short-circuit on the obviously-unauthorized case (a UX speed-up only —
 * every mutation in procedure-template-editor.ts re-checks the actor
 * against the live DB regardless of what happens here), validate input
 * shape, delegate, redact unexpected DB errors.
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
  if (!canEditProcedureTemplateDraft(session.role)) {
    return { ok: false, result: { ok: false, code: "FORBIDDEN", message: "편집 권한이 없습니다 (SUPER_ADMIN 전용)." } };
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

export async function updateProcedureTemplateNodeAction(input: {
  nodeId: string;
  patch: UpdateNodePatch;
  expectedTemplateUpdatedAt: string;
  reason?: string | null;
}): Promise<NodeMutationResult | Forbidden> {
  const actorCheck = await resolveAuthorizedActorId();
  if (!actorCheck.ok) return actorCheck.result;
  if (!isValidUuid(input.nodeId)) return { ok: false, code: "FORBIDDEN", message: "요청 정보를 확인할 수 없습니다." };

  return withErrorRedaction("updateProcedureTemplateNodeAction", () =>
    updateProcedureTemplateNode(input.nodeId, actorCheck.userId, input.patch, input.expectedTemplateUpdatedAt, input.reason?.trim() || null)
  );
}

export async function changeProcedureTemplateNodeTypeAction(input: {
  nodeId: string;
  newNodeType: ProcedureNodeType;
  reason: string;
  expectedTemplateUpdatedAt: string;
}): Promise<ChangeNodeTypeResult | Forbidden> {
  const actorCheck = await resolveAuthorizedActorId();
  if (!actorCheck.ok) return actorCheck.result;
  if (!isValidUuid(input.nodeId)) return { ok: false, code: "FORBIDDEN", message: "요청 정보를 확인할 수 없습니다." };
  if (!(PROCEDURE_NODE_TYPE_CODES as readonly string[]).includes(input.newNodeType)) {
    return { ok: false, code: "FORBIDDEN", message: "지원되지 않는 노드 유형입니다." };
  }
  const reasonValidation = validateRequiredNote(input.reason);
  if (!reasonValidation.ok) return { ok: false, code: "FORBIDDEN", message: reasonValidation.error };

  return withErrorRedaction("changeProcedureTemplateNodeTypeAction", () =>
    changeProcedureTemplateNodeType(input.nodeId, actorCheck.userId, input.newNodeType, reasonValidation.note, input.expectedTemplateUpdatedAt)
  );
}

export async function saveProcedureTemplateNodeLayoutAction(input: {
  templateId: string;
  positions: LayoutPosition[];
  expectedTemplateUpdatedAt: string;
}): Promise<SaveLayoutResult | Forbidden> {
  const actorCheck = await resolveAuthorizedActorId();
  if (!actorCheck.ok) return actorCheck.result;
  if (!isValidUuid(input.templateId) || input.positions.some((p) => !isValidUuid(p.nodeId))) {
    return { ok: false, code: "FORBIDDEN", message: "요청 정보를 확인할 수 없습니다." };
  }

  return withErrorRedaction("saveProcedureTemplateNodeLayoutAction", () =>
    saveProcedureTemplateNodeLayout(input.templateId, actorCheck.userId, input.positions, input.expectedTemplateUpdatedAt)
  );
}

export async function updateProcedureTemplateEdgeAction(input: {
  edgeId: string;
  patch: UpdateEdgePatch;
  expectedTemplateUpdatedAt: string;
  note?: string | null;
}): Promise<EdgeMutationResult | Forbidden> {
  const actorCheck = await resolveAuthorizedActorId();
  if (!actorCheck.ok) return actorCheck.result;
  if (!isValidUuid(input.edgeId)) return { ok: false, code: "FORBIDDEN", message: "요청 정보를 확인할 수 없습니다." };
  if (input.patch.branchType && !(PROCEDURE_BRANCH_TYPE_CODES as readonly string[]).includes(input.patch.branchType)) {
    return { ok: false, code: "FORBIDDEN", message: "분기 유형을 확인할 수 없습니다." };
  }

  return withErrorRedaction("updateProcedureTemplateEdgeAction", () =>
    updateProcedureTemplateEdge(input.edgeId, actorCheck.userId, input.patch, input.expectedTemplateUpdatedAt, input.note?.trim() || null)
  );
}

export async function retargetProcedureTemplateEdgeAction(input: {
  edgeId: string;
  newFromNodeId: string;
  newToNodeId: string;
  reason: string;
  expectedTemplateUpdatedAt: string;
}): Promise<RetargetEdgeResult | Forbidden> {
  const actorCheck = await resolveAuthorizedActorId();
  if (!actorCheck.ok) return actorCheck.result;
  if (!isValidUuid(input.edgeId) || !isValidUuid(input.newFromNodeId) || !isValidUuid(input.newToNodeId)) {
    return { ok: false, code: "FORBIDDEN", message: "요청 정보를 확인할 수 없습니다." };
  }
  const reasonValidation = validateRequiredNote(input.reason);
  if (!reasonValidation.ok) return { ok: false, code: "FORBIDDEN", message: reasonValidation.error };

  return withErrorRedaction("retargetProcedureTemplateEdgeAction", () =>
    retargetProcedureTemplateEdge(input.edgeId, actorCheck.userId, input.newFromNodeId, input.newToNodeId, reasonValidation.note, input.expectedTemplateUpdatedAt)
  );
}

export async function createProcedureTemplateEdgeAction(input: {
  templateId: string;
  fromNodeId: string;
  toNodeId: string;
  branchType: ProcedureBranchType;
  branchLabel?: string | null;
  reason: string;
  expectedTemplateUpdatedAt: string;
}): Promise<CreateEdgeResult | Forbidden> {
  const actorCheck = await resolveAuthorizedActorId();
  if (!actorCheck.ok) return actorCheck.result;
  if (!isValidUuid(input.templateId) || !isValidUuid(input.fromNodeId) || !isValidUuid(input.toNodeId)) {
    return { ok: false, code: "FORBIDDEN", message: "요청 정보를 확인할 수 없습니다." };
  }
  if (!(PROCEDURE_BRANCH_TYPE_CODES as readonly string[]).includes(input.branchType)) {
    return { ok: false, code: "FORBIDDEN", message: "분기 유형을 확인할 수 없습니다." };
  }
  const reasonValidation = validateRequiredNote(input.reason);
  if (!reasonValidation.ok) return { ok: false, code: "FORBIDDEN", message: reasonValidation.error };

  return withErrorRedaction("createProcedureTemplateEdgeAction", () =>
    createProcedureTemplateEdge(
      input.templateId,
      actorCheck.userId,
      { fromNodeId: input.fromNodeId, toNodeId: input.toNodeId, branchType: input.branchType, branchLabel: input.branchLabel?.trim() || null, reason: reasonValidation.note },
      input.expectedTemplateUpdatedAt
    )
  );
}

export async function validateProcedureTemplateAction(input: { templateId: string }): Promise<ValidateTemplateResult | Forbidden> {
  const actorCheck = await resolveAuthorizedActorId();
  if (!actorCheck.ok) return actorCheck.result;
  if (!isValidUuid(input.templateId)) return { ok: false, code: "FORBIDDEN", message: "요청 정보를 확인할 수 없습니다." };

  return withErrorRedaction("validateProcedureTemplateAction", () => validateProcedureTemplate(input.templateId, actorCheck.userId));
}
