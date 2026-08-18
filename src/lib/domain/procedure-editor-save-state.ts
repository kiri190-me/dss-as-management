import { routePointsEqual, type RoutePoint } from "@/lib/graph-editor-core/routing";
import { runSaveSequence as runGenericSaveSequence, type SaveStepResult as GenericSaveStepResult } from "@/lib/graph-editor-core/save-sequence";
import type { ProcedureBranchType } from "@/lib/domain/procedure-template-types";

/**
 * Pure draft/render/dirty/save-ordering logic for the Procedure Template
 * editor (5C-6D-1B — PURE LOGIC ONLY, not wired into
 * ProcedureTemplateEditorScreen yet). Same shape as the Repair Case
 * Flowchart domain's own repair-case-flowchart-editor-save-state.ts, but
 * NOT a copy of it — every type/step/ordering below is derived from
 * Procedure's own actual mutation boundaries (audited directly from
 * src/lib/db/mutations/procedure-template-editor.ts before writing this),
 * not transplanted from the Case Flowchart domain.
 *
 * ==================== AUDITED MUTATION BOUNDARIES ====================
 * `updateProcedureTemplateNode(nodeId, actorUserId, patch: UpdateNodePatch,
 * expectedTemplateUpdatedAt, reason?)` — `UpdateNodePatch = { title?,
 * description?, instructions?, sortOrder?, isActive? }`, all optional,
 * partial-patch. No reason is currently ever sent by the UI (`reason` is
 * accepted but unused there) and no structural re-validation runs for a
 * plain field save. → this is the safe-to-defer NODE_FIELDS step.
 *
 * `updateProcedureTemplateEdge(edgeId, actorUserId, patch: UpdateEdgePatch,
 * expectedTemplateUpdatedAt, note?)` — `UpdateEdgePatch = { branchType?,
 * branchLabel? }`. Unlike node fields, this mutation ALWAYS re-runs
 * structural validation and returns a `structuralValidation` summary even
 * for a plain branchType/label edit — a real asymmetry with node fields
 * that any future screen wiring (1C) must surface, not hide. `note` is a
 * write-only, per-save audit annotation (stored only as that one edit's
 * history `reason`, never as a column on the edge itself) — it has no
 * server-side baseline to diff against, so it CANNOT be dirty-tracked the
 * way branchType/branchLabel can. It is deliberately excluded from
 * `ProcedureEdgeFieldDraft` below; if a future screen still wants to
 * collect it for a deferred/batched save, that is a UI-level decision for
 * 1C, orthogonal to this dirty model. → EDGE_FIELDS is the safe-to-defer
 * step for branchType/branchLabel only.
 *
 * `saveProcedureTemplateLayout(templateId, actorUserId, positions[],
 * edgeRoutes[], expectedTemplateUpdatedAt, reason?)` — ONE mutation, one
 * transaction, one `expectedTemplateUpdatedAt` check, covering BOTH node
 * positions (user_position_x/y) AND edge manual routes (userRoutePoints)
 * in a single call; each category is independently no-op-filtered
 * server-side and gets its own history action type (SAVE_LAYOUT /
 * SAVE_EDGE_ROUTE) under one shared changeGroupId, but the call itself
 * succeeds or fails as one unit. This is modeled honestly below as ONE
 * `LAYOUT_AND_ROUTES` step — NOT split into a separate position step and
 * route step the way the Case Flowchart domain's 4-step shape does, since
 * Procedure's real server boundary is genuinely one combined call, and
 * splitting it here would misrepresent what a "step" actually costs
 * (another round trip that doesn't exist).
 *
 * ==================== EXPLICITLY EXCLUDED (stay immediate in 1C) ====================
 * CHANGE_NODE_TYPE (reason unless TECHNICAL_TASK, re-validates, its own
 * always-separately-audited action type), RETARGET_EDGE (reason + confirm
 * dialog), CREATE_EDGE (reason + confirm dialog), DELETE_EDGE, CREATE_NODE,
 * DELETE_NODE, node-on-edge insertion (compound), VALIDATE_TEMPLATE,
 * publish/version actions. None of these appear anywhere in this module —
 * there is no SaveStep variant for any of them, so they cannot accidentally
 * end up deferred by a future caller misusing this module.
 * ========================================================================
 */

// ==================== draft representations (safe-to-defer fields only) ====================

export type ProcedureNodeFieldDraft = {
  title: string;
  description: string;
  instructions: string;
  sortOrder: number;
  isActive: boolean;
};

export type Position = { x: number; y: number };

export type ProcedureEdgeFieldDraft = {
  branchType: ProcedureBranchType;
  branchLabel: string;
};

// ==================== server baselines ====================

/**
 * `positionX`/`positionY` are the node's current EFFECTIVE position
 * (i.e. `resolveEffectiveNodePosition(node, "USER")`'s result — the saved
 * `user_position_x/y` override if present, else the source/layered-layout
 * fallback), already resolved by the caller — same convention
 * NodePropertyPanel's own "상대 위치로 이동" and ProcedureFlowGraph's
 * `resolveBaselinePosition` already use as "the current position" today.
 * This module never reads the raw nullable `user_position_x/y` column
 * itself.
 */
export type ProcedureServerNodeSnapshot = {
  id: string;
  title: string;
  description: string | null;
  instructions: string | null;
  sortOrder: number;
  isActive: boolean;
  positionX: number;
  positionY: number;
};

export type ProcedureServerEdgeSnapshot = {
  id: string;
  branchType: ProcedureBranchType;
  branchLabel: string | null;
  routePoints: RoutePoint[] | null;
};

// ==================== RENDER (baseline + drafts → rendered graph) ====================

/** Applies a pending node field/position draft (if any) on top of the server baseline — what the graph canvas would render, live, the instant an edit is made (1C). */
export function mergeProcedureNodeForRender(
  server: ProcedureServerNodeSnapshot,
  pendingFieldDraft: ProcedureNodeFieldDraft | undefined,
  pendingPosition: Position | undefined
): ProcedureServerNodeSnapshot {
  return {
    id: server.id,
    title: pendingFieldDraft?.title ?? server.title,
    description: pendingFieldDraft ? (pendingFieldDraft.description.length > 0 ? pendingFieldDraft.description : null) : server.description,
    instructions: pendingFieldDraft ? (pendingFieldDraft.instructions.length > 0 ? pendingFieldDraft.instructions : null) : server.instructions,
    sortOrder: pendingFieldDraft?.sortOrder ?? server.sortOrder,
    isActive: pendingFieldDraft?.isActive ?? server.isActive,
    positionX: pendingPosition?.x ?? server.positionX,
    positionY: pendingPosition?.y ?? server.positionY,
  };
}

/**
 * Same principle for edges. `pendingRoutePoints` must be the raw
 * `Map.get(edgeId)` result (not pre-resolved) — `undefined` means "no
 * route override pending" (fall back to the server's route), while an
 * explicit `null` means "pending reset to automatic routing," a real,
 * meaningful override in its own right, distinct from "nothing pending"
 * (same distinction the Case Flowchart domain's own merge helper makes).
 */
export function mergeProcedureEdgeForRender(
  server: ProcedureServerEdgeSnapshot,
  pendingFieldDraft: ProcedureEdgeFieldDraft | undefined,
  pendingRoutePoints: RoutePoint[] | null | undefined
): ProcedureServerEdgeSnapshot {
  return {
    id: server.id,
    branchType: pendingFieldDraft?.branchType ?? server.branchType,
    branchLabel: pendingFieldDraft ? (pendingFieldDraft.branchLabel.length > 0 ? pendingFieldDraft.branchLabel : null) : server.branchLabel,
    routePoints: pendingRoutePoints !== undefined ? pendingRoutePoints : server.routePoints,
  };
}

// ==================== DIRTY (rendered draft vs baseline) ====================

export function isProcedureNodeFieldDraftDirty(draft: ProcedureNodeFieldDraft, server: ProcedureServerNodeSnapshot): boolean {
  return (
    draft.title !== server.title ||
    draft.description !== (server.description ?? "") ||
    draft.instructions !== (server.instructions ?? "") ||
    draft.sortOrder !== server.sortOrder ||
    draft.isActive !== server.isActive
  );
}

export function isProcedureEdgeFieldDraftDirty(draft: ProcedureEdgeFieldDraft, server: ProcedureServerEdgeSnapshot): boolean {
  return draft.branchType !== server.branchType || draft.branchLabel !== (server.branchLabel ?? "");
}

/** Entries whose draft genuinely differs from its last-known server value — an orphaned draft (id no longer present, e.g. deleted meanwhile) never counts as pending. */
export function computeDirtyProcedureNodeFieldEntries(
  draftsById: Map<string, ProcedureNodeFieldDraft>,
  serverNodesById: Map<string, ProcedureServerNodeSnapshot>
): [string, ProcedureNodeFieldDraft][] {
  const result: [string, ProcedureNodeFieldDraft][] = [];
  for (const [id, draft] of draftsById) {
    const server = serverNodesById.get(id);
    if (server && isProcedureNodeFieldDraftDirty(draft, server)) result.push([id, draft]);
  }
  return result;
}

export function computeDirtyProcedureEdgeFieldEntries(
  draftsById: Map<string, ProcedureEdgeFieldDraft>,
  serverEdgesById: Map<string, ProcedureServerEdgeSnapshot>
): [string, ProcedureEdgeFieldDraft][] {
  const result: [string, ProcedureEdgeFieldDraft][] = [];
  for (const [id, draft] of draftsById) {
    const server = serverEdgesById.get(id);
    if (server && isProcedureEdgeFieldDraftDirty(draft, server)) result.push([id, draft]);
  }
  return result;
}

/** A pending position that round-trips back to the server's own effective value (e.g. dragged out and back) stops counting as dirty on its own — same "compare current draft to baseline" rule as every other field, never a sticky "was dragged" boolean. */
export function computeDirtyProcedurePositionNodeIds(pendingPositionsById: Map<string, Position>, serverNodesById: Map<string, ProcedureServerNodeSnapshot>): string[] {
  const result: string[] = [];
  for (const [id, pos] of pendingPositionsById) {
    const server = serverNodesById.get(id);
    if (server && (pos.x !== server.positionX || pos.y !== server.positionY)) result.push(id);
  }
  return result;
}

export function computeDirtyProcedureRouteEdgeIds(pendingRoutesById: Map<string, RoutePoint[] | null>, serverEdgesById: Map<string, ProcedureServerEdgeSnapshot>): string[] {
  const result: string[] = [];
  for (const [id, points] of pendingRoutesById) {
    const server = serverEdgesById.get(id);
    if (server && !routePointsEqual(points, server.routePoints)) result.push(id);
  }
  return result;
}

// ==================== SAVE (plan + sequence) ====================

/**
 * Three kinds, not Case Flowchart's six — derived from Procedure's actual
 * server boundaries (see this file's own AUDITED MUTATION BOUNDARIES doc
 * comment above), not from parity with the other domain. `LAYOUT_AND_ROUTES`
 * intentionally carries BOTH node ids and edge ids, mirroring
 * `saveProcedureTemplateLayout`'s own combined `(positions[], edgeRoutes[])`
 * call shape exactly.
 */
export type ProcedureSaveStep =
  | { kind: "NODE_FIELDS"; nodeId: string }
  | { kind: "EDGE_FIELDS"; edgeId: string }
  | { kind: "LAYOUT_AND_ROUTES"; nodeIds: string[]; edgeIds: string[] };

/**
 * Deterministic save order: node field changes, then edge field changes,
 * then combined layout/route changes. No dependency forces a different
 * order — node fields, edge fields, and position/route are mutually
 * independent (no field's new value depends on another field's new
 * value within the same save) — so this follows the order the checkpoint
 * spec itself recommends: node fields first (a plain value swap, no
 * side effects), edge fields second (also a value swap, but this is the
 * one category that always re-triggers structural validation — running it
 * after node fields means that re-validation reflects the just-saved node
 * values too, though title/description/instructions/sortOrder/isActive
 * don't actually affect structural validity), layout/routes last (purely
 * geometric, matching the Case Flowchart domain's own "route last"
 * convention). Planning only — never calls a mutation; the caller executes
 * each step and feeds the result back into `runProcedureSaveSequence`.
 */
export function planProcedureSaveSteps(input: {
  dirtyNodeFieldEntries: [string, ProcedureNodeFieldDraft][];
  dirtyEdgeFieldEntries: [string, ProcedureEdgeFieldDraft][];
  dirtyPositionNodeIds: string[];
  dirtyRouteEdgeIds: string[];
}): ProcedureSaveStep[] {
  const steps: ProcedureSaveStep[] = [];
  for (const [nodeId] of input.dirtyNodeFieldEntries) steps.push({ kind: "NODE_FIELDS", nodeId });
  for (const [edgeId] of input.dirtyEdgeFieldEntries) steps.push({ kind: "EDGE_FIELDS", edgeId });
  if (input.dirtyPositionNodeIds.length > 0 || input.dirtyRouteEdgeIds.length > 0) {
    steps.push({ kind: "LAYOUT_AND_ROUTES", nodeIds: [...input.dirtyPositionNodeIds], edgeIds: [...input.dirtyRouteEdgeIds] });
  }
  return steps;
}

export type ProcedureSaveStepResult = { ok: true; updatedAt: string } | { ok: false; message: string };

export type ProcedureSaveSequenceOutcome = {
  succeededSteps: ProcedureSaveStep[];
  failedAtStep: ProcedureSaveStep | null;
  failureMessage: string | null;
  finalUpdatedAt: string;
};

/**
 * Runs `steps` strictly in order, feeding each successful step's returned
 * `updatedAt` into the next step's `expectedTemplateUpdatedAt` (never
 * sends two mutations concurrently against one stale token). Stops at the
 * FIRST failure — every step from that point on is left un-run. Delegates
 * the actual loop to graph-editor-core/save-sequence.ts's generic
 * `runSaveSequence` (5C-6D-1A) — this wrapper only translates between the
 * generic `{ok, token}` shape and this domain's own `{ok, updatedAt}`/
 * `finalUpdatedAt` naming, exactly like the Case Flowchart domain's own
 * `runSaveSequence` wrapper does. Named `runProcedureSaveSequence` (not
 * `runSaveSequence`) purely so a future file importing helpers from both
 * domain modules together never has an ambiguous same-named import to
 * disambiguate.
 */
export async function runProcedureSaveSequence(
  steps: ProcedureSaveStep[],
  initialUpdatedAt: string,
  executeStep: (step: ProcedureSaveStep, expectedUpdatedAt: string) => Promise<ProcedureSaveStepResult>
): Promise<ProcedureSaveSequenceOutcome> {
  const genericExecuteStep = async (step: ProcedureSaveStep, expectedToken: string): Promise<GenericSaveStepResult<string>> => {
    const result = await executeStep(step, expectedToken);
    return result.ok ? { ok: true, token: result.updatedAt } : { ok: false, message: result.message };
  };
  const outcome = await runGenericSaveSequence(steps, initialUpdatedAt, genericExecuteStep);
  return {
    succeededSteps: outcome.succeededSteps,
    failedAtStep: outcome.failedAtStep,
    failureMessage: outcome.failureMessage,
    finalUpdatedAt: outcome.finalToken,
  };
}

// ==================== success-clearing bookkeeping ====================

export function succeededProcedureNodeFieldIds(succeededSteps: ProcedureSaveStep[]): string[] {
  return succeededSteps.filter((s): s is Extract<ProcedureSaveStep, { kind: "NODE_FIELDS" }> => s.kind === "NODE_FIELDS").map((s) => s.nodeId);
}

export function succeededProcedureEdgeFieldIds(succeededSteps: ProcedureSaveStep[]): string[] {
  return succeededSteps.filter((s): s is Extract<ProcedureSaveStep, { kind: "EDGE_FIELDS" }> => s.kind === "EDGE_FIELDS").map((s) => s.edgeId);
}

/** The single LAYOUT_AND_ROUTES step is one batched mutation call — it either fully succeeds (every listed node position AND edge route persisted) or never completes, mirroring saveProcedureTemplateLayout's own one-transaction guarantee. There is no partial-per-node/per-edge case to reconcile, unlike node/edge field steps which are independent calls. */
export function succeededProcedureLayoutNodeIds(succeededSteps: ProcedureSaveStep[]): string[] {
  const step = succeededSteps.find((s): s is Extract<ProcedureSaveStep, { kind: "LAYOUT_AND_ROUTES" }> => s.kind === "LAYOUT_AND_ROUTES");
  return step ? step.nodeIds : [];
}

export function succeededProcedureRouteEdgeIds(succeededSteps: ProcedureSaveStep[]): string[] {
  const step = succeededSteps.find((s): s is Extract<ProcedureSaveStep, { kind: "LAYOUT_AND_ROUTES" }> => s.kind === "LAYOUT_AND_ROUTES");
  return step ? step.edgeIds : [];
}
