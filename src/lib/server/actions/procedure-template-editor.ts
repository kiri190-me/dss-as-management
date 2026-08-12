"use server";

import { readSession } from "@/lib/auth/session";
import { getAuthSource } from "@/lib/config/auth-source";
import { canEditProcedureTemplateDraft } from "@/lib/auth/procedure-template-authorization";
import { canEditTechnicalTemplateDraft, canManageTechnicalTemplates } from "@/lib/auth/technical-procedure-template-authorization";
import {
  updateProcedureTemplateNode,
  changeProcedureTemplateNodeType,
  saveProcedureTemplateLayout,
  updateProcedureTemplateEdge,
  retargetProcedureTemplateEdge,
  createProcedureTemplateEdge,
  validateProcedureTemplate,
  createProcedureTemplateNode,
  deleteProcedureTemplateNode,
  deleteProcedureTemplateEdge,
  insertProcedureTemplateNodeOnEdge,
  type UpdateNodePatch,
  type UpdateEdgePatch,
  type LayoutPosition,
  type EdgeRouteInput,
  type NodeMutationResult,
  type ChangeNodeTypeResult,
  type SaveLayoutResult,
  type EdgeMutationResult,
  type RetargetEdgeResult,
  type CreateEdgeResult,
  type ValidateTemplateResult,
  type CreateNodeResult,
  type DeleteNodeResult,
  type DeleteEdgeResult,
  type InsertNodeOnEdgeResult,
} from "@/lib/db/mutations/procedure-template-editor";
import { isValidUuid, validateOptionalNote } from "@/lib/validation/procedure-validation-resolution-input";
import {
  PROCEDURE_BRANCH_TYPE_CODES,
  PROCEDURE_NODE_TYPE_CODES,
  MANUAL_TECHNICAL_NODE_TYPE_CODES,
  type ProcedureBranchType,
  type ProcedureNodeType,
  type ManualTechnicalNodeType,
} from "@/lib/domain/procedure-template-types";
import { isValidRoutePoint } from "@/lib/graph-editor-core/routing";

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
  // Phase 5C-5B — this fast pre-check is a UX short-circuit only, run
  // before any template row (and therefore its category) is known; it must
  // admit anyone who could possibly be authorized for EITHER category
  // (FULL_SERVICE's existing SUPER_ADMIN-only function OR TECHNICAL_TASK's
  // ADMIN+SUPER_ADMIN function). The mutation layer's category-aware check
  // (procedure-template-editor.ts's assertEditableDraft /
  // validateProcedureTemplate) remains the sole authoritative boundary.
  if (!canEditProcedureTemplateDraft(session.role) && !canEditTechnicalTemplateDraft(session.role)) {
    return { ok: false, result: { ok: false, code: "FORBIDDEN", message: "편집 권한이 없습니다." } };
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
  reason?: string | null;
  expectedTemplateUpdatedAt: string;
}): Promise<ChangeNodeTypeResult | Forbidden> {
  const actorCheck = await resolveAuthorizedActorId();
  if (!actorCheck.ok) return actorCheck.result;
  if (!isValidUuid(input.nodeId)) return { ok: false, code: "FORBIDDEN", message: "요청 정보를 확인할 수 없습니다." };
  if (!(PROCEDURE_NODE_TYPE_CODES as readonly string[]).includes(input.newNodeType)) {
    return { ok: false, code: "FORBIDDEN", message: "지원되지 않는 노드 유형입니다." };
  }
  // Phase 5C-5B usability — a reason is optional here at the fast-check
  // layer for BOTH categories; the mutation itself is what enforces
  // "mandatory unless TECHNICAL_TASK" once the template's category is
  // known, so this layer must never reject a blank reason on FULL_SERVICE's
  // behalf pre-emptively either — that would just surface as a confusing
  // generic FORBIDDEN instead of the mutation's own precise INVALID_INPUT.
  const reasonValidation = validateOptionalNote(input.reason);
  if (!reasonValidation.ok) return { ok: false, code: "FORBIDDEN", message: reasonValidation.error };

  return withErrorRedaction("changeProcedureTemplateNodeTypeAction", () =>
    changeProcedureTemplateNodeType(input.nodeId, actorCheck.userId, input.newNodeType, reasonValidation.note, input.expectedTemplateUpdatedAt)
  );
}

/** Phase 4B — combined save (node positions + manual edge routes) behind the editor's single "저장" button. Route-point shape gets a shallow sanity check here (every array entry looks like a route point); the mutation layer's sanitizeRoutePoints is still the authoritative, unconditional gate. */
export async function saveProcedureTemplateLayoutAction(input: {
  templateId: string;
  positions: LayoutPosition[];
  edgeRoutes: EdgeRouteInput[];
  expectedTemplateUpdatedAt: string;
  reason?: string | null;
}): Promise<SaveLayoutResult | Forbidden> {
  const actorCheck = await resolveAuthorizedActorId();
  if (!actorCheck.ok) return actorCheck.result;
  if (!isValidUuid(input.templateId) || input.positions.some((p) => !isValidUuid(p.nodeId))) {
    return { ok: false, code: "FORBIDDEN", message: "요청 정보를 확인할 수 없습니다." };
  }
  if (input.edgeRoutes.some((er) => !isValidUuid(er.edgeId) || (er.points !== null && !er.points.every(isValidRoutePoint)))) {
    return { ok: false, code: "FORBIDDEN", message: "요청 정보를 확인할 수 없습니다." };
  }

  return withErrorRedaction("saveProcedureTemplateLayoutAction", () =>
    saveProcedureTemplateLayout(input.templateId, actorCheck.userId, input.positions, input.edgeRoutes, input.expectedTemplateUpdatedAt, input.reason?.trim() || null)
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
  reason?: string | null;
  expectedTemplateUpdatedAt: string;
}): Promise<RetargetEdgeResult | Forbidden> {
  const actorCheck = await resolveAuthorizedActorId();
  if (!actorCheck.ok) return actorCheck.result;
  if (!isValidUuid(input.edgeId) || !isValidUuid(input.newFromNodeId) || !isValidUuid(input.newToNodeId)) {
    return { ok: false, code: "FORBIDDEN", message: "요청 정보를 확인할 수 없습니다." };
  }
  // Phase 5C-5B usability — see changeProcedureTemplateNodeTypeAction's own note.
  const reasonValidation = validateOptionalNote(input.reason);
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
  reason?: string | null;
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
  // Phase 5C-5B usability — see changeProcedureTemplateNodeTypeAction's own note.
  const reasonValidation = validateOptionalNote(input.reason);
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

/**
 * Phase 5C-5B-1 — fast pre-check for the NEW node/edge structural-CRUD
 * actions below. Deliberately separate from resolveAuthorizedActorId
 * (which admits either category's property-edit policy): the new
 * capability is TECHNICAL_TASK-only for every role, so
 * canManageTechnicalTemplates is the correct (and only) coarse gate here.
 * The mutation layer's assertTechnicalGraphEditable/
 * canActorManageTechnicalTemplateGraph remains the sole authoritative
 * boundary — this is a UX short-circuit only.
 *
 * Exported for reuse by procedure-template-undo-redo.ts and
 * procedure-template-restore.ts's own actions (Phase 5C-5C) — Undo/Redo/
 * Restore share this exact TECHNICAL_TASK-only gate, never a looser copy.
 */
export async function resolveTechnicalGraphActorId(): Promise<{ ok: true; userId: string } | { ok: false; result: Forbidden }> {
  if (getAuthSource() !== "database") {
    return { ok: false, result: { ok: false, code: "FORBIDDEN", message: "데이터베이스 저장 모드가 아닙니다." } };
  }
  const session = await readSession();
  if (!session) return { ok: false, result: { ok: false, code: "FORBIDDEN", message: "로그인이 필요합니다." } };
  if (session.approvalStatus !== "APPROVED") {
    return { ok: false, result: { ok: false, code: "FORBIDDEN", message: "계정이 아직 승인되지 않았습니다." } };
  }
  if (!canManageTechnicalTemplates(session.role)) {
    return { ok: false, result: { ok: false, code: "FORBIDDEN", message: "권한이 없습니다." } };
  }
  return { ok: true, userId: session.userId };
}

export async function createProcedureTemplateNodeAction(input: {
  templateId: string;
  nodeType: ManualTechnicalNodeType;
  title: string;
  /** Phase 5C-5B usability — "directly below the selected node, center-aligned", computed client-side (see CreateNodePanel). Omitted when no node is selected — the mutation then falls back to its own default stacking. */
  position?: { x: number; y: number } | null;
  expectedTemplateUpdatedAt: string;
}): Promise<CreateNodeResult | Forbidden> {
  const actorCheck = await resolveTechnicalGraphActorId();
  if (!actorCheck.ok) return actorCheck.result;
  if (!isValidUuid(input.templateId)) return { ok: false, code: "FORBIDDEN", message: "요청 정보를 확인할 수 없습니다." };
  if (!(MANUAL_TECHNICAL_NODE_TYPE_CODES as readonly string[]).includes(input.nodeType)) {
    return { ok: false, code: "FORBIDDEN", message: "지원되지 않는 노드 유형입니다." };
  }
  if (input.position && (!Number.isFinite(input.position.x) || !Number.isFinite(input.position.y))) {
    return { ok: false, code: "FORBIDDEN", message: "노드 위치를 확인할 수 없습니다." };
  }

  return withErrorRedaction("createProcedureTemplateNodeAction", () =>
    createProcedureTemplateNode(input.templateId, actorCheck.userId, { nodeType: input.nodeType, title: input.title, position: input.position }, input.expectedTemplateUpdatedAt)
  );
}

export async function deleteProcedureTemplateNodeAction(input: {
  nodeId: string;
  reason?: string | null;
  expectedTemplateUpdatedAt: string;
}): Promise<DeleteNodeResult | Forbidden> {
  const actorCheck = await resolveTechnicalGraphActorId();
  if (!actorCheck.ok) return actorCheck.result;
  if (!isValidUuid(input.nodeId)) return { ok: false, code: "FORBIDDEN", message: "요청 정보를 확인할 수 없습니다." };
  // Phase 5C-5B usability — this capability is already TECHNICAL_TASK-only, so a reason is never mandatory.
  const reasonValidation = validateOptionalNote(input.reason);
  if (!reasonValidation.ok) return { ok: false, code: "FORBIDDEN", message: reasonValidation.error };

  return withErrorRedaction("deleteProcedureTemplateNodeAction", () =>
    deleteProcedureTemplateNode(input.nodeId, actorCheck.userId, reasonValidation.note, input.expectedTemplateUpdatedAt)
  );
}

export async function deleteProcedureTemplateEdgeAction(input: {
  edgeId: string;
  reason?: string | null;
  expectedTemplateUpdatedAt: string;
}): Promise<DeleteEdgeResult | Forbidden> {
  const actorCheck = await resolveTechnicalGraphActorId();
  if (!actorCheck.ok) return actorCheck.result;
  if (!isValidUuid(input.edgeId)) return { ok: false, code: "FORBIDDEN", message: "요청 정보를 확인할 수 없습니다." };
  // Phase 5C-5B usability — this capability is already TECHNICAL_TASK-only, so a reason is never mandatory.
  const reasonValidation = validateOptionalNote(input.reason);
  if (!reasonValidation.ok) return { ok: false, code: "FORBIDDEN", message: reasonValidation.error };

  return withErrorRedaction("deleteProcedureTemplateEdgeAction", () =>
    deleteProcedureTemplateEdge(input.edgeId, actorCheck.userId, reasonValidation.note, input.expectedTemplateUpdatedAt)
  );
}

export async function insertProcedureTemplateNodeOnEdgeAction(input: {
  edgeId: string;
  nodeType: ManualTechnicalNodeType;
  title: string;
  position: { x: number; y: number };
  expectedTemplateUpdatedAt: string;
}): Promise<InsertNodeOnEdgeResult | Forbidden> {
  const actorCheck = await resolveTechnicalGraphActorId();
  if (!actorCheck.ok) return actorCheck.result;
  if (!isValidUuid(input.edgeId)) return { ok: false, code: "FORBIDDEN", message: "요청 정보를 확인할 수 없습니다." };
  if (!(MANUAL_TECHNICAL_NODE_TYPE_CODES as readonly string[]).includes(input.nodeType)) {
    return { ok: false, code: "FORBIDDEN", message: "지원되지 않는 노드 유형입니다." };
  }
  if (!Number.isFinite(input.position.x) || !Number.isFinite(input.position.y)) {
    return { ok: false, code: "FORBIDDEN", message: "노드 위치를 확인할 수 없습니다." };
  }

  return withErrorRedaction("insertProcedureTemplateNodeOnEdgeAction", () =>
    insertProcedureTemplateNodeOnEdge(input.edgeId, actorCheck.userId, { nodeType: input.nodeType, title: input.title, position: input.position }, input.expectedTemplateUpdatedAt)
  );
}
