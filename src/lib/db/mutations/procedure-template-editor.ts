import "server-only";
import { and, desc, eq, inArray, ne, or } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { db } from "../client";
import {
  procedureTemplates,
  procedureTemplateNodes,
  procedureTemplateEdges,
  procedureChecklistSections,
  procedureTroubleshootingEntries,
  procedureCaseExecutionNodes,
  procedureTemplateEditHistory,
  procedureTemplateEditActionTypeEnum,
} from "../schema";
import { resolveEligibleActor, type Tx } from "./procedure-templates";
import {
  canManageTechnicalTemplates,
  canActorEditTemplateOfCategory,
  canActorManageTechnicalTemplateGraph,
} from "@/lib/auth/technical-procedure-template-authorization";
import {
  validateProcedureGraphStructure,
  countBySeverity,
  type StructuralValidationIssue,
} from "@/lib/domain/procedure-graph-structural-validation";
import {
  PROCEDURE_NODE_TYPE_CODES,
  MANUAL_TECHNICAL_NODE_TYPE_CODES,
  type ProcedureBranchType,
  type ProcedureNodeType,
  type ManualTechnicalNodeType,
} from "@/lib/domain/procedure-template-types";
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
  | "INVALID_INPUT"
  // Phase 5C-5B-1 — node/edge structural CRUD's own dependency/invariant
  // errors. EDGE_HAS_CLONE_DEPENDENTS/NODE_HAS_CONNECTED_EDGES/
  // NODE_HAS_DEPENDENT_CONTENT carry extra structured detail (see
  // EdgeHasCloneDependentsFailure etc. below) rather than being plain
  // Failure objects. EXECUTION_REFERENCE_CONFLICT is the plain-Failure
  // defensive invariant error for the (should-be-impossible-for-a-DRAFT-
  // row) case where procedure_case_execution_nodes still references the
  // node/edge being deleted.
  | "EDGE_HAS_CLONE_DEPENDENTS"
  | "NODE_HAS_CONNECTED_EDGES"
  | "NODE_HAS_DEPENDENT_CONTENT"
  | "EXECUTION_REFERENCE_CONFLICT";

export type StructuralValidationSummary = {
  errorCount: number;
  warningCount: number;
  infoCount: number;
  issues: StructuralValidationIssue[];
};

// Phase 5C-5B-1: the three rich dependency-error codes are deliberately
// excluded from Failure's own `code` type (see EdgeHasCloneDependentsFailure
// etc. below) — they must always carry their extra structured fields, never
// be thrown as a plain { code, message } via fail(). This also gives every
// caller (including tests) correct TS discriminated-union narrowing on
// `code` between Failure and the three rich types, which a shared wide
// `code: EditorMutationResultCode` on both would defeat.
type Failure = {
  ok: false;
  code: Exclude<EditorMutationResultCode, "EDGE_HAS_CLONE_DEPENDENTS" | "NODE_HAS_CONNECTED_EDGES" | "NODE_HAS_DEPENDENT_CONTENT">;
  message: string;
};

class EditorMutationError extends Error {
  result: Failure;
  constructor(result: Failure) {
    super(result.message);
    this.result = result;
  }
}

function fail(code: Failure["code"], message: string): never {
  throw new EditorMutationError({ ok: false, code, message });
}

// ---- Phase 5C-5B-1: structured dependency-error contracts ----
//
// A plain { code, message } Failure loses the "why" a human/UI needs to act
// on (which edges are blocking, how many, etc.) — these three carry the
// extra detail the task brief asks for, thrown via the separate
// DetailedEditorFailure error class below so the existing fail()/
// EditorMutationError pair (used by all 15 pre-5C-5B-1 mutations) stays
// completely untouched.

export type EdgeHasCloneDependentsFailure = {
  ok: false;
  code: "EDGE_HAS_CLONE_DEPENDENTS";
  message: string;
  dependentEdgeCount: number;
  dependentEdgeIds: string[];
};

export type BlockingEdgeSummary = {
  edgeId: string;
  direction: "INCOMING" | "OUTGOING";
  otherNodeId: string;
  otherNodeTitle: string;
  branchType: ProcedureBranchType;
};

export type NodeHasConnectedEdgesFailure = {
  ok: false;
  code: "NODE_HAS_CONNECTED_EDGES";
  message: string;
  blockingEdgeCount: number;
  blockingEdgeIds: string[];
  blockingEdges: BlockingEdgeSummary[];
};

export type NodeHasDependentContentFailure = {
  ok: false;
  code: "NODE_HAS_DEPENDENT_CONTENT";
  message: string;
  checklistSectionCount: number;
  troubleshootingEntryCount: number;
};

type DetailedFailure = EdgeHasCloneDependentsFailure | NodeHasConnectedEdgesFailure | NodeHasDependentContentFailure;

class DetailedEditorFailure extends Error {
  result: DetailedFailure;
  constructor(result: DetailedFailure) {
    super(result.message);
    this.result = result;
  }
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

/**
 * Phase 5C-5B-1 — the analogous lock-and-verify gate for the NEW node/edge
 * structural-CRUD capabilities (create node, delete node, delete edge).
 * Identical in shape and ordering to assertEditableDraft (exists →
 * authorized → still DRAFT → not reference-only → expectedTemplateUpdatedAt
 * matches), but authorizes via canActorManageTechnicalTemplateGraph
 * (TECHNICAL_TASK-only, hard-denies FULL_SERVICE/REFERENCE for every role
 * including SUPER_ADMIN) instead of canActorEditTemplateOfCategory —
 * reusing assertEditableDraft here would incorrectly let SUPER_ADMIN
 * create/delete nodes on a FULL_SERVICE template.
 */
async function assertTechnicalGraphEditable(tx: Tx, templateId: string, expectedTemplateUpdatedAt: string, actorRole: Role) {
  const [template] = await tx.select().from(procedureTemplates).where(eq(procedureTemplates.id, templateId)).for("update");
  if (!template) fail("NOT_FOUND", "해당 템플릿을 찾을 수 없습니다.");
  if (!canActorManageTechnicalTemplateGraph(actorRole, template.category)) {
    fail("FORBIDDEN", "이 작업을 수행할 권한이 없습니다.");
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
  // Multiline titles (Shift+Enter) — trim only the leading/trailing whitespace
  // around the whole title (same convention as createProcedureTemplateNode);
  // an intentional internal `\n` must never be collapsed/normalized to a
  // space here. A title that becomes blank after trimming (including one
  // that was only whitespace/newlines) is rejected, same as node creation.
  let normalizedPatch = patch;
  if (patch.title !== undefined) {
    const trimmedTitle = typeof patch.title === "string" ? patch.title.trim() : "";
    if (trimmedTitle.length === 0) {
      return { ok: false, code: "INVALID_INPUT", message: "제목을 입력해야 합니다." };
    }
    normalizedPatch = { ...patch, title: trimmedTitle };
  }

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
      const afterState = { ...beforeState, ...normalizedPatch };

      await tx
        .update(procedureTemplateNodes)
        .set({ ...normalizedPatch, updatedAt: new Date() })
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
  reason: string | null | undefined,
  expectedTemplateUpdatedAt: string
): Promise<ChangeNodeTypeResult> {
  if (!PROCEDURE_NODE_TYPE_CODES.includes(newNodeType)) {
    return { ok: false, code: "INVALID_INPUT", message: "지원되지 않는 노드 유형입니다." };
  }

  try {
    return await db.transaction(async (tx) => {
      const actor = await requireEditor(tx, actorUserId);

      const [node] = await tx.select().from(procedureTemplateNodes).where(eq(procedureTemplateNodes.id, nodeId)).for("update");
      if (!node) fail("NOT_FOUND", "해당 노드를 찾을 수 없습니다.");

      const template = await assertEditableDraft(tx, node.procedureTemplateId, expectedTemplateUpdatedAt, actor.role);

      // Phase 5C-5B usability — TECHNICAL_TASK authoring never requires a
      // reason for an ordinary edit; FULL_SERVICE/REFERENCE keep the
      // original mandatory-reason rule unchanged. Category is only known
      // once the template row is loaded, so this check cannot run before
      // the transaction the way it used to.
      if (template.category !== "TECHNICAL_TASK" && isBlank(reason)) {
        fail("INVALID_INPUT", "노드 유형 변경에는 사유가 필요합니다.");
      }
      const storedReason = isBlank(reason) ? null : reason!.trim();

      const beforeState = { nodeType: node.nodeType };
      const afterState = { nodeType: newNodeType };

      await tx.update(procedureTemplateNodes).set({ nodeType: newNodeType, updatedAt: new Date() }).where(eq(procedureTemplateNodes.id, nodeId));

      await insertEditHistory(tx, {
        procedureTemplateId: node.procedureTemplateId,
        actionType: "CHANGE_NODE_TYPE",
        nodeId,
        beforeState,
        afterState,
        reason: storedReason,
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
  reason: string | null | undefined,
  expectedTemplateUpdatedAt: string
): Promise<RetargetEdgeResult> {
  if (newFromNodeId === newToNodeId) return { ok: false, code: "SELF_EDGE", message: "분기의 시작과 대상 노드는 같을 수 없습니다." };

  try {
    return await db.transaction(async (tx) => {
      const actor = await requireEditor(tx, actorUserId);

      const [edge] = await tx.select().from(procedureTemplateEdges).where(eq(procedureTemplateEdges.id, edgeId)).for("update");
      if (!edge) fail("NOT_FOUND", "해당 분기를 찾을 수 없습니다.");

      const template = await assertEditableDraft(tx, edge.procedureTemplateId, expectedTemplateUpdatedAt, actor.role);

      // Phase 5C-5B usability — see changeProcedureTemplateNodeType's own note.
      if (template.category !== "TECHNICAL_TASK" && isBlank(reason)) {
        fail("INVALID_INPUT", "분기 대상 변경에는 사유가 필요합니다.");
      }
      const storedReason = isBlank(reason) ? null : reason!.trim();

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
        reason: storedReason,
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
  reason?: string | null;
};

export type CreateEdgeResult = (NodeMutationResult & { ok: true; edgeId: string; structuralValidation: StructuralValidationSummary }) | Failure;

export async function createProcedureTemplateEdge(
  templateId: string,
  actorUserId: string,
  input: CreateEdgeInput,
  expectedTemplateUpdatedAt: string
): Promise<CreateEdgeResult> {
  if (input.fromNodeId === input.toNodeId) return { ok: false, code: "SELF_EDGE", message: "분기의 시작과 대상 노드는 같을 수 없습니다." };
  if (input.branchType === "CUSTOM" && isBlank(input.branchLabel)) {
    return { ok: false, code: "INVALID_INPUT", message: "사용자 정의(CUSTOM) 분기에는 라벨이 필요합니다." };
  }

  try {
    return await db.transaction(async (tx) => {
      const actor = await requireEditor(tx, actorUserId);
      const template = await assertEditableDraft(tx, templateId, expectedTemplateUpdatedAt, actor.role);

      // Phase 5C-5B usability — see changeProcedureTemplateNodeType's own note.
      if (template.category !== "TECHNICAL_TASK" && isBlank(input.reason)) {
        fail("INVALID_INPUT", "새 연결 추가에는 사유가 필요합니다.");
      }
      const storedReason = isBlank(input.reason) ? null : input.reason!.trim();

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
        reason: storedReason,
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

// ---- Phase 5C-5B-1: technical-only node/edge structural CRUD ----
//
// Everything below is new, structural (create/delete a node or edge row
// entirely, not just edit its properties) capability that no category had
// before this phase, gated by assertTechnicalGraphEditable/
// canActorManageTechnicalTemplateGraph rather than assertEditableDraft/
// canActorEditTemplateOfCategory — see that function's own doc comment for
// why the two must not be conflated. Every existing function above this
// point is untouched.

export type NodeSnapshot = {
  id: string;
  procedureTemplateId: string;
  nodeCode: string;
  nodeType: ProcedureNodeType;
  title: string;
  description: string | null;
  objective: string | null;
  preparation: string | null;
  toolsAndEquipment: string | null;
  safetyCaution: string | null;
  instructions: string | null;
  expectedNormalResult: string | null;
  ngSymptoms: string | null;
  recommendedCorrectiveAction: string | null;
  acceptanceCriteria: string | null;
  workerMayAddNextTask: boolean;
  positionX: number;
  positionY: number;
  userPositionX: number | null;
  userPositionY: number | null;
  sortOrder: number;
  sourceWorksheet: string | null;
  sourceShapeId: string | null;
  sourceCellRange: string | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
};

/** Shared by createProcedureTemplateNode's CREATE_NODE afterState and deleteProcedureTemplateNode's DELETE_NODE beforeState — the exact same complete-node shape either way, so a reviewer reading the audit trail sees identical fields regardless of which action produced the row. */
function serializeNodeSnapshot(node: typeof procedureTemplateNodes.$inferSelect): NodeSnapshot {
  return {
    id: node.id,
    procedureTemplateId: node.procedureTemplateId,
    nodeCode: node.nodeCode,
    nodeType: node.nodeType,
    title: node.title,
    description: node.description,
    objective: node.objective,
    preparation: node.preparation,
    toolsAndEquipment: node.toolsAndEquipment,
    safetyCaution: node.safetyCaution,
    instructions: node.instructions,
    expectedNormalResult: node.expectedNormalResult,
    ngSymptoms: node.ngSymptoms,
    recommendedCorrectiveAction: node.recommendedCorrectiveAction,
    acceptanceCriteria: node.acceptanceCriteria,
    workerMayAddNextTask: node.workerMayAddNextTask,
    positionX: node.positionX,
    positionY: node.positionY,
    userPositionX: node.userPositionX,
    userPositionY: node.userPositionY,
    sortOrder: node.sortOrder,
    sourceWorksheet: node.sourceWorksheet,
    sourceShapeId: node.sourceShapeId,
    sourceCellRange: node.sourceCellRange,
    isActive: node.isActive,
    createdAt: node.createdAt.toISOString(),
    updatedAt: node.updatedAt.toISOString(),
  };
}

export type EdgeSnapshot = {
  id: string;
  procedureTemplateId: string;
  fromNodeId: string;
  toNodeId: string;
  fromNodeCode: string;
  fromNodeTitle: string;
  toNodeCode: string;
  toNodeTitle: string;
  branchType: ProcedureBranchType;
  branchLabel: string | null;
  conditionDefinition: unknown;
  sortOrder: number;
  sourceConnectorId: string | null;
  clonedFromEdgeId: string | null;
  userRoutePoints: RoutePoint[] | null;
};

/** deleteProcedureTemplateEdge's DELETE_EDGE beforeState — denormalizes the endpoint nodes' code/title onto the snapshot (edges only store fromNodeId/toNodeId) so the audit row stays human-readable even after the node itself is later deleted too. */
function serializeEdgeSnapshot(
  edge: typeof procedureTemplateEdges.$inferSelect,
  fromNode: { nodeCode: string; title: string },
  toNode: { nodeCode: string; title: string }
): EdgeSnapshot {
  return {
    id: edge.id,
    procedureTemplateId: edge.procedureTemplateId,
    fromNodeId: edge.fromNodeId,
    toNodeId: edge.toNodeId,
    fromNodeCode: fromNode.nodeCode,
    fromNodeTitle: fromNode.title,
    toNodeCode: toNode.nodeCode,
    toNodeTitle: toNode.title,
    branchType: edge.branchType,
    branchLabel: edge.branchLabel,
    conditionDefinition: edge.conditionDefinition,
    sortOrder: edge.sortOrder,
    sourceConnectorId: edge.sourceConnectorId,
    clonedFromEdgeId: edge.clonedFromEdgeId,
    userRoutePoints: edge.userRoutePoints,
  };
}

// ---- create node ----

export type CreateNodeInput = {
  nodeType: ManualTechnicalNodeType;
  title: string;
  /**
   * Phase 5C-5B usability — optional explicit initial position (e.g. "place
   * directly below the currently-selected node, center-aligned" — computed
   * client-side from that node's own effective position). When provided, it
   * becomes BOTH position_x/y and user_position_x/y (same convention
   * insertProcedureTemplateNodeOnEdge already uses for a route-point-placed
   * node), so the placement survives a refresh regardless of the auto-
   * layout fallback ProcedureFlowGraph applies to any node with no saved
   * override. When omitted (no node was selected), falls back to the
   * original default: position_x=0, position_y=(max existing position_y)+150,
   * no user-position override — unchanged from this function's original
   * behavior.
   */
  position?: { x: number; y: number } | null;
};

export type CreateNodeResult = { ok: true; nodeId: string; updatedAt: string } | Failure;

/**
 * Manual TECHNICAL_TASK node authoring v1 — deliberately minimal (nodeType
 * + title only; every other field starts null/default). id and nodeCode
 * are both server-generated and never accepted from the caller: nodeCode is
 * always `manual-<the node's own id>`, so it is trivially unique per
 * template (the id is a fresh UUID) without needing a per-template counter
 * or trusting client input, and the existing unique(template_id, node_code)
 * index remains a defense-in-depth backstop rather than the primary
 * uniqueness mechanism. Position defaults to a simple vertical stack
 * (x=0, y = previous max + 150) unless the caller supplies an explicit
 * `input.position` — real free-form placement is otherwise left to the
 * existing saveProcedureTemplateLayout "저장" action, same as every other
 * node.
 */
export async function createProcedureTemplateNode(
  templateId: string,
  actorUserId: string,
  input: CreateNodeInput,
  expectedTemplateUpdatedAt: string
): Promise<CreateNodeResult> {
  const title = typeof input.title === "string" ? input.title.trim() : "";
  if (title.length === 0) return { ok: false, code: "INVALID_INPUT", message: "제목을 입력해야 합니다." };
  if (!(MANUAL_TECHNICAL_NODE_TYPE_CODES as readonly string[]).includes(input.nodeType)) {
    return { ok: false, code: "INVALID_INPUT", message: "지원되지 않는 노드 유형입니다." };
  }
  if (input.position && (!Number.isFinite(input.position.x) || !Number.isFinite(input.position.y))) {
    return { ok: false, code: "INVALID_INPUT", message: "노드 위치가 올바르지 않습니다." };
  }

  try {
    return await db.transaction(async (tx) => {
      const actor = await requireEditor(tx, actorUserId);
      await assertTechnicalGraphEditable(tx, templateId, expectedTemplateUpdatedAt, actor.role);

      const [maxSortRow] = await tx
        .select({ sortOrder: procedureTemplateNodes.sortOrder })
        .from(procedureTemplateNodes)
        .where(eq(procedureTemplateNodes.procedureTemplateId, templateId))
        .orderBy(desc(procedureTemplateNodes.sortOrder))
        .limit(1);
      const nextSortOrder = (maxSortRow?.sortOrder ?? -1) + 1;

      let positionX = 0;
      let positionY = 0;
      let userPositionX: number | null = null;
      let userPositionY: number | null = null;
      if (input.position) {
        positionX = input.position.x;
        positionY = input.position.y;
        userPositionX = input.position.x;
        userPositionY = input.position.y;
      } else {
        const [maxPositionYRow] = await tx
          .select({ positionY: procedureTemplateNodes.positionY })
          .from(procedureTemplateNodes)
          .where(eq(procedureTemplateNodes.procedureTemplateId, templateId))
          .orderBy(desc(procedureTemplateNodes.positionY))
          .limit(1);
        positionY = maxPositionYRow ? maxPositionYRow.positionY + 150 : 0;
      }

      const nodeId = randomUUID();
      const nodeCode = `manual-${nodeId}`;

      const [inserted] = await tx
        .insert(procedureTemplateNodes)
        .values({
          id: nodeId,
          procedureTemplateId: templateId,
          nodeCode,
          nodeType: input.nodeType,
          title,
          positionX,
          positionY,
          userPositionX,
          userPositionY,
          sortOrder: nextSortOrder,
          sourceWorksheet: null,
          sourceShapeId: null,
          sourceCellRange: null,
          isActive: true,
          // workerMayAddNextTask, description, objective, etc. all use the
          // column's own default/null — never set explicitly here.
        })
        .returning();

      const afterState = serializeNodeSnapshot(inserted);

      // No reason required for creation (only the two DELETE mutations
      // below require one) — matches this phase's explicit brief.
      await insertEditHistory(tx, {
        procedureTemplateId: templateId,
        actionType: "CREATE_NODE",
        nodeId: inserted.id,
        beforeState: null,
        afterState,
        reason: null,
        actorUserId: actor.id,
      });

      const updatedAt = await touchTemplate(tx, templateId);
      return { ok: true, nodeId: inserted.id, updatedAt };
    });
  } catch (err) {
    if (err instanceof EditorMutationError) return err.result;
    throw err;
  }
}

// ---- delete edge ----

export type DeleteEdgeResult = { ok: true; updatedAt: string } | Failure | EdgeHasCloneDependentsFailure;

/**
 * Hard-deletes an edge row (never a soft/isActive flag — edges have none).
 * Requires a mandatory non-blank reason (unlike CREATE_NODE) since this is
 * destructive and, unlike a node, has no "undo by recreating with the same
 * id" path. The DELETE_EDGE history row is inserted BEFORE the DELETE
 * statement, inside the same transaction — the FK from
 * procedure_template_edit_history.edge_id is ON DELETE SET NULL (migration
 * 0017), so the DELETE below automatically nulls out the edge_id on the
 * history row just inserted (and any earlier history rows referencing this
 * edge) as a DB-level side effect, never a second application UPDATE.
 */
export async function deleteProcedureTemplateEdge(
  edgeId: string,
  actorUserId: string,
  reason: string | null | undefined,
  expectedTemplateUpdatedAt: string
): Promise<DeleteEdgeResult> {
  // Phase 5C-5B usability — this mutation is already TECHNICAL_TASK-only
  // (assertTechnicalGraphEditable below), so a reason is never mandatory
  // here at all, unlike the shared FULL_SERVICE+TECHNICAL_TASK functions
  // above.
  const storedReason = isBlank(reason) ? null : reason!.trim();

  try {
    return await db.transaction(async (tx) => {
      const actor = await requireEditor(tx, actorUserId);

      const [edge] = await tx.select().from(procedureTemplateEdges).where(eq(procedureTemplateEdges.id, edgeId)).for("update");
      if (!edge) fail("NOT_FOUND", "해당 분기를 찾을 수 없습니다.");

      await assertTechnicalGraphEditable(tx, edge.procedureTemplateId, expectedTemplateUpdatedAt, actor.role);

      // Dependency check: another edge's clonedFromEdgeId still points at
      // this one (a PUBLISHED-then-cloned-into-DRAFT lineage pointer) —
      // must never surface as a raw RESTRICT FK violation.
      const dependents = await tx
        .select({ id: procedureTemplateEdges.id })
        .from(procedureTemplateEdges)
        .where(eq(procedureTemplateEdges.clonedFromEdgeId, edgeId));
      if (dependents.length > 0) {
        throw new DetailedEditorFailure({
          ok: false,
          code: "EDGE_HAS_CLONE_DEPENDENTS",
          message: "다른 초안 버전이 이 분기를 복제 참조하고 있어 삭제할 수 없습니다.",
          dependentEdgeCount: dependents.length,
          dependentEdgeIds: dependents.map((d) => d.id),
        });
      }

      // Defensive invariant check: a DRAFT edge should be structurally
      // unreachable from procedure_case_execution_nodes.selected_outgoing_
      // edge_id (executions only ever reference PUBLISHED template rows),
      // but this is never assumed silently — audited live, every call.
      const [executionRef] = await tx
        .select({ id: procedureCaseExecutionNodes.id })
        .from(procedureCaseExecutionNodes)
        .where(eq(procedureCaseExecutionNodes.selectedOutgoingEdgeId, edgeId))
        .limit(1);
      if (executionRef) {
        fail("EXECUTION_REFERENCE_CONFLICT", "이 분기가 실행 기록에서 참조되고 있어 삭제할 수 없습니다.");
      }

      const endpointNodes = await tx
        .select({ id: procedureTemplateNodes.id, nodeCode: procedureTemplateNodes.nodeCode, title: procedureTemplateNodes.title })
        .from(procedureTemplateNodes)
        .where(inArray(procedureTemplateNodes.id, [edge.fromNodeId, edge.toNodeId]));
      const fromNode = endpointNodes.find((n) => n.id === edge.fromNodeId);
      const toNode = endpointNodes.find((n) => n.id === edge.toNodeId);
      if (!fromNode || !toNode) fail("NOT_FOUND", "분기의 시작 또는 대상 노드를 찾을 수 없습니다.");

      const beforeState = serializeEdgeSnapshot(edge, fromNode, toNode);

      await insertEditHistory(tx, {
        procedureTemplateId: edge.procedureTemplateId,
        actionType: "DELETE_EDGE",
        edgeId: edge.id,
        beforeState,
        afterState: null,
        reason: storedReason,
        actorUserId: actor.id,
      });

      await tx.delete(procedureTemplateEdges).where(eq(procedureTemplateEdges.id, edgeId));

      const updatedAt = await touchTemplate(tx, edge.procedureTemplateId);
      return { ok: true, updatedAt };
    });
  } catch (err) {
    if (err instanceof EditorMutationError) return err.result;
    // By construction, deleteProcedureTemplateEdge only ever throws
    // DetailedEditorFailure with an EdgeHasCloneDependentsFailure payload
    // (never the two node-shaped ones) — safe to narrow here.
    if (err instanceof DetailedEditorFailure) return err.result as EdgeHasCloneDependentsFailure;
    throw err;
  }
}

// ---- delete node ----

export type DeleteNodeResult = { ok: true; updatedAt: string } | Failure | NodeHasConnectedEdgesFailure | NodeHasDependentContentFailure;

/**
 * Hard-deletes a node row. Never cascade-deletes its edges — a node with
 * any live incoming/outgoing edge is rejected outright
 * (NODE_HAS_CONNECTED_EDGES); the caller must delete those edges first via
 * deleteProcedureTemplateEdge. Same DELETE_NODE-history-before-DELETE +
 * onDelete:"set null" (migration 0017) pattern as deleteProcedureTemplateEdge
 * above.
 */
export async function deleteProcedureTemplateNode(
  nodeId: string,
  actorUserId: string,
  reason: string | null | undefined,
  expectedTemplateUpdatedAt: string
): Promise<DeleteNodeResult> {
  // Phase 5C-5B usability — already TECHNICAL_TASK-only (assertTechnicalGraphEditable below); a reason is never mandatory here.
  const storedReason = isBlank(reason) ? null : reason!.trim();

  try {
    return await db.transaction(async (tx) => {
      const actor = await requireEditor(tx, actorUserId);

      const [node] = await tx.select().from(procedureTemplateNodes).where(eq(procedureTemplateNodes.id, nodeId)).for("update");
      if (!node) fail("NOT_FOUND", "해당 노드를 찾을 수 없습니다.");

      await assertTechnicalGraphEditable(tx, node.procedureTemplateId, expectedTemplateUpdatedAt, actor.role);

      // A. connected edges (incoming or outgoing) — never cascade-deleted.
      const connectedEdges = await tx
        .select({ id: procedureTemplateEdges.id, fromNodeId: procedureTemplateEdges.fromNodeId, toNodeId: procedureTemplateEdges.toNodeId, branchType: procedureTemplateEdges.branchType })
        .from(procedureTemplateEdges)
        .where(or(eq(procedureTemplateEdges.fromNodeId, nodeId), eq(procedureTemplateEdges.toNodeId, nodeId)));
      if (connectedEdges.length > 0) {
        const otherNodeIds = connectedEdges.map((e) => (e.fromNodeId === nodeId ? e.toNodeId : e.fromNodeId));
        const otherNodes = await tx
          .select({ id: procedureTemplateNodes.id, title: procedureTemplateNodes.title })
          .from(procedureTemplateNodes)
          .where(inArray(procedureTemplateNodes.id, otherNodeIds));
        const titleById = new Map(otherNodes.map((n) => [n.id, n.title]));
        const blockingEdges: BlockingEdgeSummary[] = connectedEdges.map((e) => {
          const direction: "INCOMING" | "OUTGOING" = e.fromNodeId === nodeId ? "OUTGOING" : "INCOMING";
          const otherNodeId = e.fromNodeId === nodeId ? e.toNodeId : e.fromNodeId;
          return { edgeId: e.id, direction, otherNodeId, otherNodeTitle: titleById.get(otherNodeId) ?? "", branchType: e.branchType };
        });
        throw new DetailedEditorFailure({
          ok: false,
          code: "NODE_HAS_CONNECTED_EDGES",
          message: "이 노드에 연결된 분기가 있어 삭제할 수 없습니다. 먼저 분기를 삭제하세요.",
          blockingEdgeCount: connectedEdges.length,
          blockingEdgeIds: connectedEdges.map((e) => e.id),
          blockingEdges,
        });
      }

      // B/C. dependent checklist-section / troubleshooting-entry content —
      // same NODE_HAS_DEPENDENT_CONTENT contract either way, carrying both
      // counts so the caller can tell which (or both) blocked the delete.
      const [sections, entries] = await Promise.all([
        tx.select({ id: procedureChecklistSections.id }).from(procedureChecklistSections).where(eq(procedureChecklistSections.nodeId, nodeId)),
        tx.select({ id: procedureTroubleshootingEntries.id }).from(procedureTroubleshootingEntries).where(eq(procedureTroubleshootingEntries.nodeId, nodeId)),
      ]);
      if (sections.length > 0 || entries.length > 0) {
        throw new DetailedEditorFailure({
          ok: false,
          code: "NODE_HAS_DEPENDENT_CONTENT",
          message: "이 노드에 체크리스트 또는 고장 진단표 내용이 있어 삭제할 수 없습니다.",
          checklistSectionCount: sections.length,
          troubleshootingEntryCount: entries.length,
        });
      }

      // D. defensive invariant check: a DRAFT node should be structurally
      // unreachable from procedure_case_execution_nodes (executions only
      // ever reference PUBLISHED template rows), but never assumed
      // silently — audited live, every call. Never mutates execution rows.
      const [executionRef] = await tx
        .select({ id: procedureCaseExecutionNodes.id })
        .from(procedureCaseExecutionNodes)
        .where(eq(procedureCaseExecutionNodes.procedureTemplateNodeId, nodeId))
        .limit(1);
      if (executionRef) {
        fail("EXECUTION_REFERENCE_CONFLICT", "이 노드가 실행 기록에서 참조되고 있어 삭제할 수 없습니다.");
      }

      const beforeState = serializeNodeSnapshot(node);

      await insertEditHistory(tx, {
        procedureTemplateId: node.procedureTemplateId,
        actionType: "DELETE_NODE",
        nodeId: node.id,
        beforeState,
        afterState: null,
        reason: storedReason,
        actorUserId: actor.id,
      });

      await tx.delete(procedureTemplateNodes).where(eq(procedureTemplateNodes.id, nodeId));

      const updatedAt = await touchTemplate(tx, node.procedureTemplateId);
      return { ok: true, updatedAt };
    });
  } catch (err) {
    if (err instanceof EditorMutationError) return err.result;
    // By construction, deleteProcedureTemplateNode only ever throws
    // DetailedEditorFailure with a NodeHasConnectedEdgesFailure or
    // NodeHasDependentContentFailure payload (never the edge-shaped one) —
    // safe to narrow here.
    if (err instanceof DetailedEditorFailure) return err.result as NodeHasConnectedEdgesFailure | NodeHasDependentContentFailure;
    throw err;
  }
}

// ---- insert node on an edge's route point (split) ----

export type InsertNodeOnEdgeInput = {
  nodeType: ManualTechnicalNodeType;
  title: string;
  /** Flow-space coordinates of the route point the caller split at — becomes both the new node's position_x/position_y (same "natural placement" convention createProcedureTemplateNode uses) AND its user_position_x/y override, so it renders exactly there regardless of the auto-layout fallback a MANUAL template's unpositioned nodes otherwise get (see ProcedureFlowGraph's useAutoLayoutForUnpositionedNodes). */
  position: { x: number; y: number };
};

export type InsertNodeOnEdgeResult = { ok: true; nodeId: string; firstEdgeId: string; secondEdgeId: string; updatedAt: string } | Failure;

/**
 * Splits an existing TECHNICAL_TASK DRAFT edge (A -[branch]-> B) at a
 * chosen route point into two: A -[the exact same branchType/branchLabel/
 * conditionDefinition, untouched]-> NEW, and NEW -[a plain DEFAULT
 * continuation, never a copy of A's condition]-> B. A route point is a
 * routing/geometry detail, not a second decision — duplicating A's branch
 * semantics onto the new edge would silently change the graph's meaning.
 *
 * One transaction, one authoritative mutation (no client-side multi-step
 * sequence that could leave A->NEW without NEW->B): create the node,
 * retarget the first edge's toNodeId (its own transaction-internal
 * equivalent of retargetProcedureTemplateEdge — that function cannot be
 * called directly here, since it opens its own separate transaction, which
 * would break atomicity with the rest of this split), create the second
 * edge, and write three history rows reusing existing action types
 * (CREATE_NODE / RETARGET_EDGE / CREATE_EDGE — no new enum value, no
 * migration) — all inside the same db.transaction(), so a failure at any
 * step rolls back everything.
 */
export async function insertProcedureTemplateNodeOnEdge(
  edgeId: string,
  actorUserId: string,
  input: InsertNodeOnEdgeInput,
  expectedTemplateUpdatedAt: string
): Promise<InsertNodeOnEdgeResult> {
  const title = typeof input.title === "string" ? input.title.trim() : "";
  if (title.length === 0) return { ok: false, code: "INVALID_INPUT", message: "제목을 입력해야 합니다." };
  if (!(MANUAL_TECHNICAL_NODE_TYPE_CODES as readonly string[]).includes(input.nodeType)) {
    return { ok: false, code: "INVALID_INPUT", message: "지원되지 않는 노드 유형입니다." };
  }
  if (!Number.isFinite(input.position.x) || !Number.isFinite(input.position.y)) {
    return { ok: false, code: "INVALID_INPUT", message: "노드 위치가 올바르지 않습니다." };
  }

  try {
    return await db.transaction(async (tx) => {
      const actor = await requireEditor(tx, actorUserId);

      const [edge] = await tx.select().from(procedureTemplateEdges).where(eq(procedureTemplateEdges.id, edgeId)).for("update");
      if (!edge) fail("NOT_FOUND", "해당 분기를 찾을 수 없습니다.");

      await assertTechnicalGraphEditable(tx, edge.procedureTemplateId, expectedTemplateUpdatedAt, actor.role);

      // Defensive invariant check — same rationale as deleteProcedureTemplateEdge's own: a DRAFT edge should be structurally unreachable from procedure_case_execution_nodes (executions only ever reference PUBLISHED rows), but retargeting a referenced edge's toNodeId would be just as corrupting as deleting it, so this is never assumed silently either.
      const [executionRef] = await tx
        .select({ id: procedureCaseExecutionNodes.id })
        .from(procedureCaseExecutionNodes)
        .where(eq(procedureCaseExecutionNodes.selectedOutgoingEdgeId, edgeId))
        .limit(1);
      if (executionRef) {
        fail("EXECUTION_REFERENCE_CONFLICT", "이 분기가 실행 기록에서 참조되고 있어 노드를 삽입할 수 없습니다.");
      }

      const nodeId = randomUUID();
      const nodeCode = `manual-${nodeId}`;

      const [maxNodeSortRow] = await tx
        .select({ sortOrder: procedureTemplateNodes.sortOrder })
        .from(procedureTemplateNodes)
        .where(eq(procedureTemplateNodes.procedureTemplateId, edge.procedureTemplateId))
        .orderBy(desc(procedureTemplateNodes.sortOrder))
        .limit(1);
      const nextNodeSortOrder = (maxNodeSortRow?.sortOrder ?? -1) + 1;

      const [insertedNode] = await tx
        .insert(procedureTemplateNodes)
        .values({
          id: nodeId,
          procedureTemplateId: edge.procedureTemplateId,
          nodeCode,
          nodeType: input.nodeType,
          title,
          positionX: input.position.x,
          positionY: input.position.y,
          userPositionX: input.position.x,
          userPositionY: input.position.y,
          sortOrder: nextNodeSortOrder,
          sourceWorksheet: null,
          sourceShapeId: null,
          sourceCellRange: null,
          isActive: true,
        })
        .returning();

      const originalToNodeId = edge.toNodeId;

      await tx.update(procedureTemplateEdges).set({ toNodeId: nodeId }).where(eq(procedureTemplateEdges.id, edgeId));

      const [maxEdgeSortRow] = await tx
        .select({ sortOrder: procedureTemplateEdges.sortOrder })
        .from(procedureTemplateEdges)
        .where(and(eq(procedureTemplateEdges.procedureTemplateId, edge.procedureTemplateId), eq(procedureTemplateEdges.fromNodeId, nodeId)))
        .orderBy(desc(procedureTemplateEdges.sortOrder))
        .limit(1);
      const nextEdgeSortOrder = (maxEdgeSortRow?.sortOrder ?? -1) + 1;

      const [secondEdge] = await tx
        .insert(procedureTemplateEdges)
        .values({
          procedureTemplateId: edge.procedureTemplateId,
          fromNodeId: nodeId,
          toNodeId: originalToNodeId,
          branchType: "DEFAULT",
          branchLabel: null,
          sortOrder: nextEdgeSortOrder,
          sourceConnectorId: null,
          clonedFromEdgeId: null,
        })
        .returning({ id: procedureTemplateEdges.id });

      const splitReason = `경로점 위치에 새 노드를 삽입하며 분기를 분할했습니다 (${nodeCode}).`;

      await insertEditHistory(tx, {
        procedureTemplateId: edge.procedureTemplateId,
        actionType: "CREATE_NODE",
        nodeId: insertedNode.id,
        beforeState: null,
        afterState: serializeNodeSnapshot(insertedNode),
        reason: null,
        actorUserId: actor.id,
      });

      await insertEditHistory(tx, {
        procedureTemplateId: edge.procedureTemplateId,
        actionType: "RETARGET_EDGE",
        edgeId: edge.id,
        beforeState: { fromNodeId: edge.fromNodeId, toNodeId: originalToNodeId, branchType: edge.branchType },
        afterState: { fromNodeId: edge.fromNodeId, toNodeId: nodeId, branchType: edge.branchType },
        reason: splitReason,
        actorUserId: actor.id,
      });

      await insertEditHistory(tx, {
        procedureTemplateId: edge.procedureTemplateId,
        actionType: "CREATE_EDGE",
        edgeId: secondEdge.id,
        beforeState: null,
        afterState: { fromNodeId: nodeId, toNodeId: originalToNodeId, branchType: "DEFAULT", branchLabel: null },
        reason: splitReason,
        actorUserId: actor.id,
      });

      const updatedAt = await touchTemplate(tx, edge.procedureTemplateId);
      return { ok: true, nodeId: insertedNode.id, firstEdgeId: edge.id, secondEdgeId: secondEdge.id, updatedAt };
    });
  } catch (err) {
    if (err instanceof EditorMutationError) return err.result;
    throw err;
  }
}
