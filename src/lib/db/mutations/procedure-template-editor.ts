import "server-only";
import { and, eq, inArray, ne } from "drizzle-orm";
import { db } from "../client";
import {
  procedureTemplates,
  procedureTemplateNodes,
  procedureTemplateEdges,
  procedureChecklistSections,
  procedureTroubleshootingEntries,
  procedureTemplateEditHistory,
  procedureTemplateEditActionTypeEnum,
} from "../schema";
import { resolveEligibleActor, type Tx } from "./procedure-templates";
import { canManageTechnicalTemplates, canActorEditTemplateOfCategory } from "@/lib/auth/technical-procedure-template-authorization";
import {
  validateProcedureGraphStructure,
  countBySeverity,
  type StructuralValidationIssue,
} from "@/lib/domain/procedure-graph-structural-validation";
import { PROCEDURE_NODE_TYPE_CODES, type ProcedureBranchType, type ProcedureNodeType } from "@/lib/domain/procedure-template-types";
import { sanitizeRoutePoints, routePointsEqual, type RoutePoint } from "@/lib/graph-editor-core/routing";
import type { Role } from "@/lib/domain/types";

/**
 * Phase 4A — the controlled procedure-workflow editor's mutation layer.
 * Every function here:
 *   - re-checks the actor from the live DB (resolveEligibleActor, same
 *     helper procedure-templates.ts's own mutations use — never a looser
 *     copy of the check);
 *   - authorizes in two stages (Phase 5C-5B): a coarse pre-gate
 *     (canManageTechnicalTemplates — SUPER_ADMIN or ADMIN) runs in
 *     requireEditor, before any node/edge/template row is ever looked up,
 *     so AS_ENGINEER/SALES/INVENTORY_MANAGER learn nothing about whether a
 *     given id exists; the fine-grained, category-specific check
 *     (canActorEditTemplateOfCategory — SUPER_ADMIN-only for FULL_SERVICE,
 *     unchanged; SUPER_ADMIN+ADMIN for TECHNICAL_TASK) runs immediately
 *     after the template row is loaded, inside assertEditableDraft (or
 *     validateProcedureTemplate's own inline equivalent), the first point
 *     that actually has the row's category in hand;
 *   - locks and re-verifies the owning template is still DRAFT and not
 *     reference-only, inside the same transaction as the actual write
 *     (never trusting that the editor UI already checked this);
 *   - uses procedure_templates.updated_at as the single optimistic-
 *     concurrency token for the whole DRAFT (every mutation here bumps it
 *     on success) — simpler than a second per-row revision column, and
 *     sufficient since Phase 4A has no concurrent-multi-editor scope: any
 *     other reviewer's save since the caller last loaded/saved the editor
 *     changes this value, so a stale expectedTemplateUpdatedAt reliably
 *     means "someone else changed this DRAFT under you";
 *   - writes exactly one append-only procedure_template_edit_history row
 *     per persisted mutation, never conflated with Phase 3A's
 *     procedure_validation_resolution_history.
 */

export type EditorMutationResultCode =
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "NOT_DRAFT"
  | "REFERENCE_ONLY"
  | "STALE_REVISION"
  | "DUPLICATE_EDGE"
  | "SELF_EDGE"
  | "CROSS_TEMPLATE"
  | "INVALID_INPUT";

export type StructuralValidationSummary = {
  errorCount: number;
  warningCount: number;
  infoCount: number;
  issues: StructuralValidationIssue[];
};

type Failure = { ok: false; code: EditorMutationResultCode; message: string };

class EditorMutationError extends Error {
  result: Failure;
  constructor(result: Failure) {
    super(result.message);
    this.result = result;
  }
}

function fail(code: EditorMutationResultCode, message: string): never {
  throw new EditorMutationError({ ok: false, code, message });
}

/**
 * Locks the template row (FOR UPDATE) and re-verifies every safety
 * condition this whole module depends on: exists, the actor is authorized
 * for THIS row's specific category (Phase 5C-5B — requireEditor's own
 * check is only the coarse SUPER_ADMIN/ADMIN pre-gate; this is the real,
 * fine-grained boundary), still DRAFT, not reference-only, and the
 * caller's expectedTemplateUpdatedAt still matches — run fresh inside
 * every mutation's own transaction.
 *
 * Authorization is checked immediately after the row loads, before any of
 * the status-specific errors (NOT_DRAFT/REFERENCE_ONLY/STALE_REVISION) —
 * an actor who fails the category-specific check learns only that they're
 * FORBIDDEN, never the template's current status.
 */
async function assertEditableDraft(tx: Tx, templateId: string, expectedTemplateUpdatedAt: string, actorRole: Role) {
  const [template] = await tx.select().from(procedureTemplates).where(eq(procedureTemplates.id, templateId)).for("update");
  if (!template) fail("NOT_FOUND", "해당 템플릿을 찾을 수 없습니다.");
  if (!canActorEditTemplateOfCategory(actorRole, template.category)) {
    fail("FORBIDDEN", "이 템플릿을 편집할 권한이 없습니다.");
  }
  if (template.status !== "DRAFT") fail("NOT_DRAFT", "초안(DRAFT) 상태의 템플릿만 편집할 수 있습니다.");
  if (template.isReferenceOnly) fail("REFERENCE_ONLY", "참고용 템플릿은 편집할 수 없습니다.");
  if (template.updatedAt.toISOString() !== expectedTemplateUpdatedAt) {
    fail("STALE_REVISION", "다른 검토자가 이 초안을 수정했습니다. 새로고침 후 다시 시도하세요.");
  }
  return template;
}

async function touchTemplate(tx: Tx, templateId: string): Promise<string> {
  const now = new Date();
  await tx.update(procedureTemplates).set({ updatedAt: now }).where(eq(procedureTemplates.id, templateId));
  return now.toISOString();
}

async function runStructuralValidation(tx: Tx, templateId: string): Promise<StructuralValidationSummary> {
  const nodes = await tx
    .select({ id: procedureTemplateNodes.id, nodeType: procedureTemplateNodes.nodeType })
    .from(procedureTemplateNodes)
    .where(eq(procedureTemplateNodes.procedureTemplateId, templateId));
  const edges = await tx
    .select({
      id: procedureTemplateEdges.id,
      fromNodeId: procedureTemplateEdges.fromNodeId,
      toNodeId: procedureTemplateEdges.toNodeId,
      branchType: procedureTemplateEdges.branchType,
    })
    .from(procedureTemplateEdges)
    .where(eq(procedureTemplateEdges.procedureTemplateId, templateId));

  const nodeIds = nodes.map((n) => n.id);
  const nodeIdsWithChecklistContent = new Set<string>();
  const nodeIdsWithTroubleshootingContent = new Set<string>();
  if (nodeIds.length > 0) {
    const sections = await tx.select({ nodeId: procedureChecklistSections.nodeId }).from(procedureChecklistSections).where(inArray(procedureChecklistSections.nodeId, nodeIds));
    for (const s of sections) nodeIdsWithChecklistContent.add(s.nodeId);
    const entries = await tx
      .select({ nodeId: procedureTroubleshootingEntries.nodeId })
      .from(procedureTroubleshootingEntries)
      .where(inArray(procedureTroubleshootingEntries.nodeId, nodeIds));
    for (const e of entries) nodeIdsWithTroubleshootingContent.add(e.nodeId);
  }

  const issues = validateProcedureGraphStructure(nodes, edges, { nodeIdsWithChecklistContent, nodeIdsWithTroubleshootingContent });
  return { ...countBySeverity(issues), issues };
}

type EditActionType = (typeof procedureTemplateEditActionTypeEnum.enumValues)[number];

async function insertEditHistory(
  tx: Tx,
  row: {
    procedureTemplateId: string;
    actionType: EditActionType;
    nodeId?: string | null;
    edgeId?: string | null;
    beforeState?: unknown;
    afterState?: unknown;
    reason?: string | null;
    relatedValidationIssueId?: string | null;
    actorUserId: string;
  }
): Promise<void> {
  await tx.insert(procedureTemplateEditHistory).values({
    procedureTemplateId: row.procedureTemplateId,
    actionType: row.actionType,
    nodeId: row.nodeId ?? null,
    edgeId: row.edgeId ?? null,
    beforeState: row.beforeState ?? null,
    afterState: row.afterState ?? null,
    reason: row.reason ?? null,
    relatedValidationIssueId: row.relatedValidationIssueId ?? null,
    actorUserId: row.actorUserId,
  });
}

async function requireEditor(tx: Tx, actorUserId: string) {
  let actor: Awaited<ReturnType<typeof resolveEligibleActor>>;
  try {
    actor = await resolveEligibleActor(tx, actorUserId);
  } catch {
    // resolveEligibleActor throws procedure-templates.ts's own private
    // error type (inactive/locked/unapproved/deleted actor) — every
    // mutation in this module only recognizes its own EditorMutationError,
    // so translate here rather than letting a foreign error type escape
    // the try/catch in updateProcedureTemplateNode etc. and crash the call
    // instead of returning a normal { ok: false } result.
    return fail("FORBIDDEN", "사용자 정보를 확인할 수 없습니다.");
  }
  // Phase 5C-5B — coarse pre-gate only: reject any role that can never
  // manage ANY category of template before this transaction looks up a
  // single node/edge/template row, so AS_ENGINEER/SALES/INVENTORY_MANAGER
  // learn nothing about whether a given id exists. The real, category-
  // specific boundary is assertEditableDraft (or validateProcedureTemplate's
  // own inline equivalent), which runs after the template row — and
  // therefore its category — is known.
  if (!canManageTechnicalTemplates(actor.role)) {
    fail("FORBIDDEN", "이 템플릿을 편집할 권한이 없습니다.");
  }
  return actor;
}

function isBlank(s: string | null | undefined): boolean {
  return !s || s.trim().length === 0;
}

// ---- node property editing ----

export type UpdateNodePatch = {
  title?: string;
  description?: string | null;
  instructions?: string | null;
  sortOrder?: number;
  isActive?: boolean;
};

export type NodeMutationResult = { ok: true; updatedAt: string } | Failure;

export async function updateProcedureTemplateNode(
  nodeId: string,
  actorUserId: string,
  patch: UpdateNodePatch,
  expectedTemplateUpdatedAt: string,
  reason?: string | null
): Promise<NodeMutationResult> {
  try {
    return await db.transaction(async (tx) => {
      const actor = await requireEditor(tx, actorUserId);

      const [node] = await tx.select().from(procedureTemplateNodes).where(eq(procedureTemplateNodes.id, nodeId)).for("update");
      if (!node) fail("NOT_FOUND", "해당 노드를 찾을 수 없습니다.");

      await assertEditableDraft(tx, node.procedureTemplateId, expectedTemplateUpdatedAt, actor.role);

      const beforeState = {
        title: node.title,
        description: node.description,
        instructions: node.instructions,
        sortOrder: node.sortOrder,
        isActive: node.isActive,
      };
      const afterState = { ...beforeState, ...patch };

      await tx
        .update(procedureTemplateNodes)
        .set({ ...patch, updatedAt: new Date() })
        .where(eq(procedureTemplateNodes.id, nodeId));

      await insertEditHistory(tx, {
        procedureTemplateId: node.procedureTemplateId,
        actionType: "UPDATE_NODE",
        nodeId,
        beforeState,
        afterState,
        reason,
        actorUserId: actor.id,
      });

      const updatedAt = await touchTemplate(tx, node.procedureTemplateId);
      return { ok: true, updatedAt };
    });
  } catch (err) {
    if (err instanceof EditorMutationError) return err.result;
    throw err;
  }
}

export type ChangeNodeTypeResult = (NodeMutationResult & { ok: true; structuralValidation: StructuralValidationSummary }) | Failure;

export async function changeProcedureTemplateNodeType(
  nodeId: string,
  actorUserId: string,
  newNodeType: ProcedureNodeType,
  reason: string,
  expectedTemplateUpdatedAt: string
): Promise<ChangeNodeTypeResult> {
  if (isBlank(reason)) return { ok: false, code: "INVALID_INPUT", message: "노드 유형 변경에는 사유가 필요합니다." };
  if (!PROCEDURE_NODE_TYPE_CODES.includes(newNodeType)) {
    return { ok: false, code: "INVALID_INPUT", message: "지원되지 않는 노드 유형입니다." };
  }

  try {
    return await db.transaction(async (tx) => {
      const actor = await requireEditor(tx, actorUserId);

      const [node] = await tx.select().from(procedureTemplateNodes).where(eq(procedureTemplateNodes.id, nodeId)).for("update");
      if (!node) fail("NOT_FOUND", "해당 노드를 찾을 수 없습니다.");

      await assertEditableDraft(tx, node.procedureTemplateId, expectedTemplateUpdatedAt, actor.role);

      const beforeState = { nodeType: node.nodeType };
      const afterState = { nodeType: newNodeType };

      await tx.update(procedureTemplateNodes).set({ nodeType: newNodeType, updatedAt: new Date() }).where(eq(procedureTemplateNodes.id, nodeId));

      await insertEditHistory(tx, {
        procedureTemplateId: node.procedureTemplateId,
        actionType: "CHANGE_NODE_TYPE",
        nodeId,
        beforeState,
        afterState,
        reason,
        actorUserId: actor.id,
      });

      const updatedAt = await touchTemplate(tx, node.procedureTemplateId);
      const structuralValidation = await runStructuralValidation(tx, node.procedureTemplateId);
      return { ok: true, updatedAt, structuralValidation };
    });
  } catch (err) {
    if (err instanceof EditorMutationError) return err.result;
    throw err;
  }
}

// ---- layout (사용자 배치) ----

export type LayoutPosition = { nodeId: string; x: number; y: number };
export type SaveLayoutResult = { ok: true; updatedAt: string } | Failure;

/**
 * Persists a batch of reviewer-repositioned nodes as user_position_x/y —
 * never touches position_x/position_y (the source/parent-cloned
 * coordinates, preserved forever). A no-op (empty positions array) is a
 * plain success with no audit row, since nothing actually changed.
 */
export type EdgeRouteInput = { edgeId: string; points: RoutePoint[] | null };

/**
 * Phase 4B — the single combined save behind the editor's one "저장"
 * button in 사용자 배치: node position moves and manual edge-route
 * (waypoint) changes commit or fail together, gated by exactly one
 * assertEditableDraft check (a stale expectedTemplateUpdatedAt rejects the
 * whole call — neither category partially applies). Each category is
 * diffed against its current DB value independently: an item the caller
 * sends whose value already matches what's stored is silently excluded
 * from both the write and the audit row, so re-saving unchanged data (or a
 * pure selection/zoom/pan that never actually produced a delta) can never
 * fabricate a no-op history entry. Every route-point array passes through
 * sanitizeRoutePoints before anything else runs, independent of whatever
 * the client already validated.
 */
export async function saveProcedureTemplateLayout(
  templateId: string,
  actorUserId: string,
  positions: LayoutPosition[],
  edgeRoutes: EdgeRouteInput[],
  expectedTemplateUpdatedAt: string,
  reason?: string | null
): Promise<SaveLayoutResult> {
  const sanitizedEdgeRoutes: EdgeRouteInput[] = [];
  for (const er of edgeRoutes) {
    const sanitized = sanitizeRoutePoints(er.points);
    if (!sanitized.ok) return { ok: false, code: "INVALID_INPUT", message: sanitized.message };
    sanitizedEdgeRoutes.push({ edgeId: er.edgeId, points: sanitized.points });
  }

  try {
    return await db.transaction(async (tx) => {
      const actor = await requireEditor(tx, actorUserId);
      await assertEditableDraft(tx, templateId, expectedTemplateUpdatedAt, actor.role);

      let anyChange = false;

      // ---- node positions (SAVE_LAYOUT) ----
      if (positions.length > 0) {
        const nodeIds = positions.map((p) => p.nodeId);
        const existingNodes = await tx
          .select({ id: procedureTemplateNodes.id, procedureTemplateId: procedureTemplateNodes.procedureTemplateId, userPositionX: procedureTemplateNodes.userPositionX, userPositionY: procedureTemplateNodes.userPositionY })
          .from(procedureTemplateNodes)
          .where(inArray(procedureTemplateNodes.id, nodeIds));
        const existingById = new Map(existingNodes.map((n) => [n.id, n]));

        for (const p of positions) {
          const existing = existingById.get(p.nodeId);
          if (!existing || existing.procedureTemplateId !== templateId) {
            fail("NOT_FOUND", `노드 ${p.nodeId}이(가) 이 템플릿에 존재하지 않습니다.`);
          }
        }

        const changedPositions = positions.filter((p) => {
          const existing = existingById.get(p.nodeId)!;
          return existing.userPositionX !== p.x || existing.userPositionY !== p.y;
        });

        if (changedPositions.length > 0) {
          anyChange = true;
          const beforeState = changedPositions.map((p) => {
            const existing = existingById.get(p.nodeId)!;
            return { nodeId: p.nodeId, x: existing.userPositionX, y: existing.userPositionY };
          });
          const afterState = changedPositions.map((p) => ({ nodeId: p.nodeId, x: p.x, y: p.y }));

          for (const p of changedPositions) {
            await tx
              .update(procedureTemplateNodes)
              .set({ userPositionX: p.x, userPositionY: p.y, updatedAt: new Date() })
              .where(eq(procedureTemplateNodes.id, p.nodeId));
          }

          await insertEditHistory(tx, {
            procedureTemplateId: templateId,
            actionType: "SAVE_LAYOUT",
            beforeState,
            afterState,
            reason: reason ?? null,
            actorUserId: actor.id,
          });
        }
      }

      // ---- manual edge routes (SAVE_EDGE_ROUTE) ----
      if (sanitizedEdgeRoutes.length > 0) {
        const edgeIds = sanitizedEdgeRoutes.map((e) => e.edgeId);
        const existingEdges = await tx
          .select({ id: procedureTemplateEdges.id, procedureTemplateId: procedureTemplateEdges.procedureTemplateId, userRoutePoints: procedureTemplateEdges.userRoutePoints })
          .from(procedureTemplateEdges)
          .where(inArray(procedureTemplateEdges.id, edgeIds));
        const existingEdgeById = new Map(existingEdges.map((e) => [e.id, e]));

        for (const er of sanitizedEdgeRoutes) {
          const existing = existingEdgeById.get(er.edgeId);
          if (!existing || existing.procedureTemplateId !== templateId) {
            fail("NOT_FOUND", `분기 ${er.edgeId}이(가) 이 템플릿에 존재하지 않습니다.`);
          }
        }

        const changedRoutes = sanitizedEdgeRoutes.filter((er) => {
          const existing = existingEdgeById.get(er.edgeId)!;
          return !routePointsEqual(existing.userRoutePoints ?? null, er.points);
        });

        if (changedRoutes.length > 0) {
          anyChange = true;
          const beforeState = changedRoutes.map((er) => {
            const existing = existingEdgeById.get(er.edgeId)!;
            return { edgeId: er.edgeId, points: existing.userRoutePoints ?? null };
          });
          const afterState = changedRoutes.map((er) => ({ edgeId: er.edgeId, points: er.points }));

          for (const er of changedRoutes) {
            await tx.update(procedureTemplateEdges).set({ userRoutePoints: er.points }).where(eq(procedureTemplateEdges.id, er.edgeId));
          }

          await insertEditHistory(tx, {
            procedureTemplateId: templateId,
            actionType: "SAVE_EDGE_ROUTE",
            beforeState,
            afterState,
            reason: reason ?? null,
            actorUserId: actor.id,
          });
        }
      }

      if (!anyChange) {
        return { ok: true, updatedAt: expectedTemplateUpdatedAt };
      }

      const updatedAt = await touchTemplate(tx, templateId);
      return { ok: true, updatedAt };
    });
  } catch (err) {
    if (err instanceof EditorMutationError) return err.result;
    throw err;
  }
}

// ---- edge editing ----

export type UpdateEdgePatch = { branchType?: ProcedureBranchType; branchLabel?: string | null };
export type EdgeMutationResult = (NodeMutationResult & { ok: true; structuralValidation: StructuralValidationSummary }) | Failure;

export async function updateProcedureTemplateEdge(
  edgeId: string,
  actorUserId: string,
  patch: UpdateEdgePatch,
  expectedTemplateUpdatedAt: string,
  note?: string | null
): Promise<EdgeMutationResult> {
  try {
    return await db.transaction(async (tx) => {
      const actor = await requireEditor(tx, actorUserId);

      const [edge] = await tx.select().from(procedureTemplateEdges).where(eq(procedureTemplateEdges.id, edgeId)).for("update");
      if (!edge) fail("NOT_FOUND", "해당 분기를 찾을 수 없습니다.");

      await assertEditableDraft(tx, edge.procedureTemplateId, expectedTemplateUpdatedAt, actor.role);

      const nextBranchType = patch.branchType ?? edge.branchType;
      const nextBranchLabel = patch.branchLabel !== undefined ? patch.branchLabel : edge.branchLabel;
      if (nextBranchType === "CUSTOM" && isBlank(nextBranchLabel)) {
        fail("INVALID_INPUT", "사용자 정의(CUSTOM) 분기에는 라벨이 필요합니다.");
      }

      const beforeState = { branchType: edge.branchType, branchLabel: edge.branchLabel };
      const afterState = { branchType: nextBranchType, branchLabel: nextBranchLabel };

      await tx
        .update(procedureTemplateEdges)
        .set({ branchType: nextBranchType, branchLabel: nextBranchLabel })
        .where(eq(procedureTemplateEdges.id, edgeId));

      await insertEditHistory(tx, {
        procedureTemplateId: edge.procedureTemplateId,
        actionType: "UPDATE_EDGE",
        edgeId,
        beforeState,
        afterState,
        reason: note,
        actorUserId: actor.id,
      });

      const updatedAt = await touchTemplate(tx, edge.procedureTemplateId);
      const structuralValidation = await runStructuralValidation(tx, edge.procedureTemplateId);
      return { ok: true, updatedAt, structuralValidation };
    });
  } catch (err) {
    if (err instanceof EditorMutationError) return err.result;
    throw err;
  }
}

async function assertNoDuplicateEdge(tx: Tx, templateId: string, fromNodeId: string, toNodeId: string, branchType: ProcedureBranchType, excludeEdgeId?: string) {
  const rows = await tx
    .select({ id: procedureTemplateEdges.id })
    .from(procedureTemplateEdges)
    .where(
      and(
        eq(procedureTemplateEdges.procedureTemplateId, templateId),
        eq(procedureTemplateEdges.fromNodeId, fromNodeId),
        eq(procedureTemplateEdges.toNodeId, toNodeId),
        eq(procedureTemplateEdges.branchType, branchType),
        excludeEdgeId ? ne(procedureTemplateEdges.id, excludeEdgeId) : undefined
      )
    );
  if (rows.length > 0) fail("DUPLICATE_EDGE", "동일한 시작/대상/분기 유형을 가진 분기가 이미 존재합니다.");
}

async function loadNodeInTemplate(tx: Tx, templateId: string, nodeId: string) {
  const [node] = await tx.select().from(procedureTemplateNodes).where(eq(procedureTemplateNodes.id, nodeId));
  if (!node) fail("NOT_FOUND", `노드 ${nodeId}을(를) 찾을 수 없습니다.`);
  if (node.procedureTemplateId !== templateId) fail("CROSS_TEMPLATE", "다른 템플릿에 속한 노드는 참조할 수 없습니다.");
  return node;
}

export type RetargetEdgeResult = EdgeMutationResult;

/**
 * Never a silent replace — requires an explicit, non-blank reason and both
 * new endpoints to already exist in the same template. The caller (the
 * editor UI) is responsible for showing the current-vs-proposed preview
 * and getting explicit confirmation before ever calling this.
 */
export async function retargetProcedureTemplateEdge(
  edgeId: string,
  actorUserId: string,
  newFromNodeId: string,
  newToNodeId: string,
  reason: string,
  expectedTemplateUpdatedAt: string
): Promise<RetargetEdgeResult> {
  if (isBlank(reason)) return { ok: false, code: "INVALID_INPUT", message: "분기 대상 변경에는 사유가 필요합니다." };
  if (newFromNodeId === newToNodeId) return { ok: false, code: "SELF_EDGE", message: "분기의 시작과 대상 노드는 같을 수 없습니다." };

  try {
    return await db.transaction(async (tx) => {
      const actor = await requireEditor(tx, actorUserId);

      const [edge] = await tx.select().from(procedureTemplateEdges).where(eq(procedureTemplateEdges.id, edgeId)).for("update");
      if (!edge) fail("NOT_FOUND", "해당 분기를 찾을 수 없습니다.");

      await assertEditableDraft(tx, edge.procedureTemplateId, expectedTemplateUpdatedAt, actor.role);

      await loadNodeInTemplate(tx, edge.procedureTemplateId, newFromNodeId);
      await loadNodeInTemplate(tx, edge.procedureTemplateId, newToNodeId);
      await assertNoDuplicateEdge(tx, edge.procedureTemplateId, newFromNodeId, newToNodeId, edge.branchType, edgeId);

      const beforeState = { fromNodeId: edge.fromNodeId, toNodeId: edge.toNodeId, branchType: edge.branchType };
      const afterState = { fromNodeId: newFromNodeId, toNodeId: newToNodeId, branchType: edge.branchType };

      await tx.update(procedureTemplateEdges).set({ fromNodeId: newFromNodeId, toNodeId: newToNodeId }).where(eq(procedureTemplateEdges.id, edgeId));

      await insertEditHistory(tx, {
        procedureTemplateId: edge.procedureTemplateId,
        actionType: "RETARGET_EDGE",
        edgeId,
        beforeState,
        afterState,
        reason,
        actorUserId: actor.id,
      });

      const updatedAt = await touchTemplate(tx, edge.procedureTemplateId);
      const structuralValidation = await runStructuralValidation(tx, edge.procedureTemplateId);
      return { ok: true, updatedAt, structuralValidation };
    });
  } catch (err) {
    if (err instanceof EditorMutationError) return err.result;
    throw err;
  }
}

// ---- new edge creation (existing nodes only) ----

export type CreateEdgeInput = {
  fromNodeId: string;
  toNodeId: string;
  branchType: ProcedureBranchType;
  branchLabel?: string | null;
  reason: string;
};

export type CreateEdgeResult = (NodeMutationResult & { ok: true; edgeId: string; structuralValidation: StructuralValidationSummary }) | Failure;

export async function createProcedureTemplateEdge(
  templateId: string,
  actorUserId: string,
  input: CreateEdgeInput,
  expectedTemplateUpdatedAt: string
): Promise<CreateEdgeResult> {
  if (isBlank(input.reason)) return { ok: false, code: "INVALID_INPUT", message: "새 연결 추가에는 사유가 필요합니다." };
  if (input.fromNodeId === input.toNodeId) return { ok: false, code: "SELF_EDGE", message: "분기의 시작과 대상 노드는 같을 수 없습니다." };
  if (input.branchType === "CUSTOM" && isBlank(input.branchLabel)) {
    return { ok: false, code: "INVALID_INPUT", message: "사용자 정의(CUSTOM) 분기에는 라벨이 필요합니다." };
  }

  try {
    return await db.transaction(async (tx) => {
      const actor = await requireEditor(tx, actorUserId);
      await assertEditableDraft(tx, templateId, expectedTemplateUpdatedAt, actor.role);

      await loadNodeInTemplate(tx, templateId, input.fromNodeId);
      await loadNodeInTemplate(tx, templateId, input.toNodeId);
      await assertNoDuplicateEdge(tx, templateId, input.fromNodeId, input.toNodeId, input.branchType);

      const [maxSort] = await tx
        .select({ fromNodeId: procedureTemplateEdges.fromNodeId, sortOrder: procedureTemplateEdges.sortOrder })
        .from(procedureTemplateEdges)
        .where(and(eq(procedureTemplateEdges.procedureTemplateId, templateId), eq(procedureTemplateEdges.fromNodeId, input.fromNodeId)))
        .orderBy(procedureTemplateEdges.sortOrder);
      const nextSortOrder = (maxSort?.sortOrder ?? -1) + 1;

      const [inserted] = await tx
        .insert(procedureTemplateEdges)
        .values({
          procedureTemplateId: templateId,
          fromNodeId: input.fromNodeId,
          toNodeId: input.toNodeId,
          branchType: input.branchType,
          branchLabel: input.branchLabel ?? null,
          sortOrder: nextSortOrder,
          sourceConnectorId: null,
          clonedFromEdgeId: null,
        })
        .returning({ id: procedureTemplateEdges.id });

      await insertEditHistory(tx, {
        procedureTemplateId: templateId,
        actionType: "CREATE_EDGE",
        edgeId: inserted.id,
        beforeState: null,
        afterState: { fromNodeId: input.fromNodeId, toNodeId: input.toNodeId, branchType: input.branchType, branchLabel: input.branchLabel ?? null },
        reason: input.reason,
        actorUserId: actor.id,
      });

      const updatedAt = await touchTemplate(tx, templateId);
      const structuralValidation = await runStructuralValidation(tx, templateId);
      return { ok: true, edgeId: inserted.id, updatedAt, structuralValidation };
    });
  } catch (err) {
    if (err instanceof EditorMutationError) return err.result;
    throw err;
  }
}

// ---- validate (no graph write — read + audit row only) ----

export type ValidateTemplateResult = { ok: true; structuralValidation: StructuralValidationSummary } | Failure;

export async function validateProcedureTemplate(templateId: string, actorUserId: string): Promise<ValidateTemplateResult> {
  try {
    return await db.transaction(async (tx) => {
      const actor = await requireEditor(tx, actorUserId);

      const [template] = await tx.select().from(procedureTemplates).where(eq(procedureTemplates.id, templateId)).for("update");
      if (!template) fail("NOT_FOUND", "해당 템플릿을 찾을 수 없습니다.");
      // Same category-specific boundary as assertEditableDraft, duplicated
      // here because this function never calls it (validate intentionally
      // skips the expectedTemplateUpdatedAt/STALE_REVISION check).
      if (!canActorEditTemplateOfCategory(actor.role, template.category)) {
        fail("FORBIDDEN", "이 템플릿을 검증할 권한이 없습니다.");
      }
      if (template.status !== "DRAFT") fail("NOT_DRAFT", "초안(DRAFT) 상태의 템플릿만 검증할 수 있습니다.");
      if (template.isReferenceOnly) fail("REFERENCE_ONLY", "참고용 템플릿은 검증할 수 없습니다.");

      const structuralValidation = await runStructuralValidation(tx, templateId);

      // Deliberately does NOT call touchTemplate — validating doesn't
      // change the DRAFT's editable content, only its audit trail gains an
      // entry, so a concurrent editor's expectedTemplateUpdatedAt token
      // must stay valid across a Validate run.
      await insertEditHistory(tx, {
        procedureTemplateId: templateId,
        actionType: "VALIDATE_TEMPLATE",
        beforeState: null,
        afterState: { errorCount: structuralValidation.errorCount, warningCount: structuralValidation.warningCount, infoCount: structuralValidation.infoCount },
        actorUserId: actor.id,
      });

      return { ok: true, structuralValidation };
    });
  } catch (err) {
    if (err instanceof EditorMutationError) return err.result;
    throw err;
  }
}
