import { routePointsEqual, type RoutePoint } from "@/lib/graph-editor-core/routing";
import { runSaveSequence as runGenericSaveSequence, type SaveStepResult as GenericSaveStepResult } from "@/lib/graph-editor-core/save-sequence";
import type { RepairCaseFlowchartNodeType, RepairCaseFlowchartBranchType } from "@/lib/domain/repair-case-flowchart-types";

/**
 * Pure draft/render/dirty/save-ordering logic for CaseFlowchartEditorScreen
 * (5C-6D follow-up #2 — the "live preview + explicit commit" editor model).
 * Extracted out of the screen component specifically so it can be unit-
 * tested: a component importing "use server" action modules can't be
 * statically rendered by this project's node:test harness (confirmed
 * during 6D — see this module's sibling test file's own doc comment), but
 * this module holds no server-action import, no React, and no persistence
 * of its own — CaseFlowchartEditorScreen is the only caller, and it uses
 * these exact functions rather than a parallel duplicate.
 *
 * Editor model:
 *   SERVER BASELINE (nodes/edges props) + LOCAL DRAFT OVERRIDES
 *   (nodeDraftsById / nodePositionsById / edgeDraftsById / routePointsByEdgeId)
 *   = RENDERED GRAPH (mergeNodeForRender / mergeEdgeForRender)
 *   DIRTY = rendered draft differs from baseline (computeDirty*)
 *   SAVE = diff local draft vs baseline, run mutations in deterministic
 *          order (planSaveSteps + runSaveSequence), clear only what
 *          actually persisted.
 *
 * 🔴 2026-11-21(조각 C2) — **노드·연결선의 만들기·지우기도 [저장]을 눌러야
 * 나간다.** 그때까지는 그 둘만 즉시 서버로 갔고, 이 머리말에도 그렇게 적혀
 * 있었다. 다만 **이 모듈은 한 글자도 안 바뀌었다** — 구조 변경은 제 모듈 한 벌이
 * 따로 맡고(procedure-editor-structural-*.ts), 화면이 그것을 **먼저** 돌린 뒤
 * 여기 있는 칸 값·자리·경로점 단계를 돌린다.
 * 🔴 그래서 아래 세는 함수들의 「받침에 없는 id 는 조용히 건너뛴다」
 * (`if (!server) ... continue`)가 **새로 위험해졌다**: 저장 전에 만든 노드는 서버
 * 스냅숏에 아직 없다. 화면은 받침을 **미리보기 목록**으로 세우고
 * includeBrandNewDraftEntries/Ids 로 한 겹 더 받쳐 그 구멍을 메운다
 * (CaseFlowchartEditorScreen 의 handleGlobalSave 주석 ㉠㉡㉢).
 *
 * 그 밖에 사용자가 **이미 있는** 노드/연결선에 고칠 수 있는 것(title,
 * description, type, branch type/label, retarget, route, position)은 전부
 * 전처럼 이 초안/렌더/저장 모델을 지난다.
 *
 * `runSaveSequence` (5C-6D-1A) is a thin, Case-Flowchart-flavored adapter
 * over graph-editor-core/save-sequence.ts's domain-agnostic executor — the
 * actual sequential-execution/token-chaining/stop-on-first-failure loop
 * lives there now, unowned by any domain. This file keeps its own exported
 * `SaveStep`/`SaveStepResult`/`SaveSequenceOutcome` shapes (with their
 * `updatedAt`/`finalUpdatedAt` field names) unchanged so
 * CaseFlowchartEditorScreen.tsx needed zero changes for this extraction —
 * only `planSaveSteps` (what a pending change is, how steps are ordered)
 * and the post-outcome id-reconciliation helpers below stay genuinely
 * Case-Flowchart-specific.
 */

/**
 * 🔴 `shareDocRelativePath`(2026-11-25) — 이 노드가 가리키는 공유폴더 속 파일 한 자리.
 * **빈 글자 규약이 없다**: 다른 글자 칸들은 초안에서 `""`, 서버에서 `null` 로 모양이
 * 갈리지만(아래 mergeNodeForRender 가 그 둘을 옮긴다) 이 칸은 초안도 서버도 `string |
 * null` 그대로다. 빈 글자는 **경로가 아니고**(검사가 거절한다), 「안 가리킴」을 뜻하는
 * 값이 둘(`""` 와 `null`)이 되면 「안 바뀜」 판정이 그 둘 사이에서 갈린다.
 */
export type CaseFlowchartNodeDraft = { title: string; description: string; instructions: string; nodeType: RepairCaseFlowchartNodeType; shareDocRelativePath: string | null };
export type CaseFlowchartEdgeDraft = { branchType: RepairCaseFlowchartBranchType; branchLabel: string; fromNodeId: string; toNodeId: string };
export type Position = { x: number; y: number };

export type ServerNodeSnapshot = {
  id: string;
  title: string;
  description: string | null;
  instructions: string | null;
  nodeType: RepairCaseFlowchartNodeType;
  /** 🔴 받침에도 **반드시** 있어야 한다 — 없으면 아래 세 함수가 이 칸을 못 본다(위 주석). */
  shareDocRelativePath: string | null;
  positionX: number;
  positionY: number;
};
export type ServerEdgeSnapshot = {
  id: string;
  branchType: RepairCaseFlowchartBranchType;
  branchLabel: string | null;
  fromNodeId: string;
  toNodeId: string;
  routePoints: RoutePoint[] | null;
};

// ==================== RENDER (baseline + drafts → rendered graph) ====================

/** Applies a pending node draft/position (if any) on top of the server baseline — this is what the graph canvas renders, always, so an edit is visible the instant it's made, never only after Save. */
export function mergeNodeForRender(server: ServerNodeSnapshot, pendingDraft: CaseFlowchartNodeDraft | undefined, pendingPosition: Position | undefined): ServerNodeSnapshot {
  return {
    id: server.id,
    nodeType: pendingDraft?.nodeType ?? server.nodeType,
    title: pendingDraft?.title ?? server.title,
    description: pendingDraft ? (pendingDraft.description.length > 0 ? pendingDraft.description : null) : server.description,
    instructions: pendingDraft ? (pendingDraft.instructions.length > 0 ? pendingDraft.instructions : null) : server.instructions,
    // 🔴 `?? server...` 가 **아니다** — 초안의 `null` 은 「아직 안 정했음」이 아니라
    //    「가리킴을 지웠음」이다. ?? 로 적으면 지운 것이 받침 값으로 되살아나, 화면에서는
    //    지웠는데 [저장]을 누르면 그대로 남는다(위 두 줄이 `pendingDraft ? …` 인 것과 같은 까닭).
    shareDocRelativePath: pendingDraft ? pendingDraft.shareDocRelativePath : server.shareDocRelativePath,
    positionX: pendingPosition?.x ?? server.positionX,
    positionY: pendingPosition?.y ?? server.positionY,
  };
}

/**
 * Same principle for edges. `pendingRoutePoints` must be the raw
 * `Map.get(edgeId)` result (not pre-resolved) — `undefined` means "no route
 * override pending" (fall back to the server's route), while an explicit
 * `null` means "pending reset to automatic routing," a real, meaningful
 * override in its own right, not the same as "nothing pending."
 */
export function mergeEdgeForRender(server: ServerEdgeSnapshot, pendingDraft: CaseFlowchartEdgeDraft | undefined, pendingRoutePoints: RoutePoint[] | null | undefined): ServerEdgeSnapshot {
  return {
    id: server.id,
    fromNodeId: pendingDraft?.fromNodeId ?? server.fromNodeId,
    toNodeId: pendingDraft?.toNodeId ?? server.toNodeId,
    branchType: pendingDraft?.branchType ?? server.branchType,
    branchLabel: pendingDraft ? (pendingDraft.branchLabel.length > 0 ? pendingDraft.branchLabel : null) : server.branchLabel,
    routePoints: pendingRoutePoints !== undefined ? pendingRoutePoints : server.routePoints,
  };
}

// ==================== DIRTY (rendered draft vs baseline) ====================

/**
 * 🔴 **새 칸을 여기 안 적으면 [저장]이 서버를 아예 안 부른다** — 오류도 안 나고 「저장할
 * 변경 없음」이 뜬 채로 고친 것이 사라진다. 아래 planSaveSteps 의 NODE_FIELDS 줄도 같은
 * 짝이다(이쪽만 적으면 「변경 있음」인데 보낼 걸음이 0 개가 된다).
 * 🔵 `shareDocRelativePath` 는 양쪽 다 `string | null` 이라 `?? ""` 같은 맞춤이 없다.
 */
export function isNodeDraftDirty(draft: CaseFlowchartNodeDraft, server: ServerNodeSnapshot): boolean {
  return (
    draft.title !== server.title ||
    draft.description !== (server.description ?? "") ||
    draft.instructions !== (server.instructions ?? "") ||
    draft.nodeType !== server.nodeType ||
    draft.shareDocRelativePath !== server.shareDocRelativePath
  );
}

export function isEdgeDraftDirty(draft: CaseFlowchartEdgeDraft, server: ServerEdgeSnapshot): boolean {
  return (
    draft.branchType !== server.branchType ||
    draft.branchLabel !== (server.branchLabel ?? "") ||
    draft.fromNodeId !== server.fromNodeId ||
    draft.toNodeId !== server.toNodeId
  );
}

/** Entries whose draft genuinely differs from its last-known server value — an orphaned draft (id no longer present, e.g. deleted meanwhile) never counts as pending. */
export function computeDirtyNodeEntries(draftsById: Map<string, CaseFlowchartNodeDraft>, serverNodesById: Map<string, ServerNodeSnapshot>): [string, CaseFlowchartNodeDraft][] {
  const result: [string, CaseFlowchartNodeDraft][] = [];
  for (const [id, draft] of draftsById) {
    const server = serverNodesById.get(id);
    if (server && isNodeDraftDirty(draft, server)) result.push([id, draft]);
  }
  return result;
}

export function computeDirtyEdgeEntries(draftsById: Map<string, CaseFlowchartEdgeDraft>, serverEdgesById: Map<string, ServerEdgeSnapshot>): [string, CaseFlowchartEdgeDraft][] {
  const result: [string, CaseFlowchartEdgeDraft][] = [];
  for (const [id, draft] of draftsById) {
    const server = serverEdgesById.get(id);
    if (server && isEdgeDraftDirty(draft, server)) result.push([id, draft]);
  }
  return result;
}

export function computeDirtyRouteEdgeIds(pendingRoutesById: Map<string, RoutePoint[] | null>, serverEdgesById: Map<string, ServerEdgeSnapshot>): string[] {
  const result: string[] = [];
  for (const [id, points] of pendingRoutesById) {
    const server = serverEdgesById.get(id);
    if (server && !routePointsEqual(points, server.routePoints)) result.push(id);
  }
  return result;
}

/** A pending position that round-trips back to the server's own value (e.g. dragged out and back) stops counting as dirty on its own — same "compare current draft to baseline" rule as every other field, never a sticky "was dragged" boolean. */
export function computeDirtyPositionNodeIds(pendingPositionsById: Map<string, Position>, serverNodesById: Map<string, ServerNodeSnapshot>): string[] {
  const result: string[] = [];
  for (const [id, pos] of pendingPositionsById) {
    const server = serverNodesById.get(id);
    if (server && (pos.x !== server.positionX || pos.y !== server.positionY)) result.push(id);
  }
  return result;
}

// ==================== SAVE (plan + sequence) ====================

export type SaveStep =
  | { kind: "NODE_FIELDS"; nodeId: string }
  | { kind: "NODE_TYPE"; nodeId: string }
  | { kind: "NODE_POSITIONS"; nodeIds: string[] }
  | { kind: "EDGE_FIELDS"; edgeId: string }
  | { kind: "EDGE_RETARGET"; edgeId: string }
  | { kind: "EDGE_ROUTE"; edgeId: string };

/**
 * Deterministic save order: node property/type changes, then node
 * positions (ALL dirty positions in one batched step — the existing
 * `saveRepairCaseFlowchartLayoutAction` already accepts an array, so this
 * mirrors that mutation's own natural shape rather than one call per
 * node), then edge property/retarget changes, then route changes. Planning
 * only — never calls a mutation; the caller executes each step and feeds
 * the result back into `runSaveSequence`.
 */
export function planSaveSteps(input: {
  dirtyNodes: [string, CaseFlowchartNodeDraft][];
  serverNodesById: Map<string, ServerNodeSnapshot>;
  dirtyPositionNodeIds: string[];
  dirtyEdges: [string, CaseFlowchartEdgeDraft][];
  serverEdgesById: Map<string, ServerEdgeSnapshot>;
  dirtyRouteEdgeIds: string[];
}): SaveStep[] {
  const steps: SaveStep[] = [];
  for (const [nodeId, draft] of input.dirtyNodes) {
    const server = input.serverNodesById.get(nodeId);
    if (!server) continue;
    // 🔴 `shareDocRelativePath` 도 **NODE_FIELDS 가 함께** 나른다(서버 액션 하나가 네 칸을
    //    한 번에 받는다). 이 줄에서 빠뜨리면 「파일만 바꾼」 노드는 더러움 판정은 통과하는데
    //    보낼 걸음이 하나도 안 생겨 조용히 안 나간다.
    if (
      draft.title !== server.title ||
      draft.description !== (server.description ?? "") ||
      draft.instructions !== (server.instructions ?? "") ||
      draft.shareDocRelativePath !== server.shareDocRelativePath
    )
      steps.push({ kind: "NODE_FIELDS", nodeId });
    if (draft.nodeType !== server.nodeType) steps.push({ kind: "NODE_TYPE", nodeId });
  }
  if (input.dirtyPositionNodeIds.length > 0) {
    steps.push({ kind: "NODE_POSITIONS", nodeIds: [...input.dirtyPositionNodeIds] });
  }
  for (const [edgeId, draft] of input.dirtyEdges) {
    const server = input.serverEdgesById.get(edgeId);
    if (!server) continue;
    if (draft.branchType !== server.branchType || draft.branchLabel !== (server.branchLabel ?? "")) steps.push({ kind: "EDGE_FIELDS", edgeId });
    if (draft.fromNodeId !== server.fromNodeId || draft.toNodeId !== server.toNodeId) steps.push({ kind: "EDGE_RETARGET", edgeId });
  }
  for (const edgeId of input.dirtyRouteEdgeIds) {
    steps.push({ kind: "EDGE_ROUTE", edgeId });
  }
  return steps;
}

export type SaveStepResult = { ok: true; updatedAt: string } | { ok: false; message: string };

export type SaveSequenceOutcome = {
  succeededSteps: SaveStep[];
  failedAtStep: SaveStep | null;
  failureMessage: string | null;
  finalUpdatedAt: string;
};

/**
 * Runs `steps` strictly in order, feeding each successful step's returned
 * `updatedAt` into the next step's `expectedUpdatedAt` (never sends two
 * mutations concurrently against one stale token). Stops at the FIRST
 * failure — every step from that point on is left un-run, so its owning
 * draft stays pending for a retry. `finalUpdatedAt` is always the latest
 * token actually confirmed by the server, whether the sequence fully
 * succeeded or stopped partway.
 *
 * Delegates the actual loop to graph-editor-core/save-sequence.ts's
 * `runSaveSequence` (5C-6D-1A) — this wrapper exists only to translate
 * between the generic `{ok, token}` shape and this domain's own
 * `{ok, updatedAt}`/`finalUpdatedAt` naming, so every caller (in
 * particular CaseFlowchartEditorScreen.tsx) keeps working unchanged.
 */
export async function runSaveSequence(steps: SaveStep[], initialUpdatedAt: string, executeStep: (step: SaveStep, expectedUpdatedAt: string) => Promise<SaveStepResult>): Promise<SaveSequenceOutcome> {
  const genericExecuteStep = async (step: SaveStep, expectedToken: string): Promise<GenericSaveStepResult<string>> => {
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

/** A node's PROPERTY draft (title/description/type) counts as fully flushed only when EVERY step planned for it (fields and/or type) succeeded — a node with a succeeded fields-update but a failed type-change must stay pending (its recomputed dirty state naturally narrows to just the type field on retry). Position is tracked separately — see `succeededPositionNodeIds`. */
export function fullySucceededNodeIds(plannedSteps: SaveStep[], succeededSteps: SaveStep[]): string[] {
  return fullySucceededIds(plannedSteps, succeededSteps, ["NODE_FIELDS", "NODE_TYPE"], (s) => (s as { nodeId: string }).nodeId);
}

/** Same rule as `fullySucceededNodeIds`, for EDGE_FIELDS/EDGE_RETARGET. */
export function fullySucceededEdgeIds(plannedSteps: SaveStep[], succeededSteps: SaveStep[]): string[] {
  return fullySucceededIds(plannedSteps, succeededSteps, ["EDGE_FIELDS", "EDGE_RETARGET"], (s) => (s as { edgeId: string }).edgeId);
}

export function succeededRouteEdgeIds(succeededSteps: SaveStep[]): string[] {
  return succeededSteps.filter((s): s is Extract<SaveStep, { kind: "EDGE_ROUTE" }> => s.kind === "EDGE_ROUTE").map((s) => s.edgeId);
}

/** The single NODE_POSITIONS step is one batched mutation call — it either fully succeeds (every listed node's position persisted) or never completes (the step failed or never ran), so there is no partial-per-node case to reconcile here, unlike node property drafts. */
export function succeededPositionNodeIds(succeededSteps: SaveStep[]): string[] {
  const step = succeededSteps.find((s): s is Extract<SaveStep, { kind: "NODE_POSITIONS" }> => s.kind === "NODE_POSITIONS");
  return step ? step.nodeIds : [];
}

function fullySucceededIds(plannedSteps: SaveStep[], succeededSteps: SaveStep[], kinds: SaveStep["kind"][], idOf: (step: SaveStep) => string): string[] {
  const plannedCount = new Map<string, number>();
  for (const s of plannedSteps) {
    if (!kinds.includes(s.kind)) continue;
    const id = idOf(s);
    plannedCount.set(id, (plannedCount.get(id) ?? 0) + 1);
  }
  const succeededCount = new Map<string, number>();
  for (const s of succeededSteps) {
    if (!kinds.includes(s.kind)) continue;
    const id = idOf(s);
    succeededCount.set(id, (succeededCount.get(id) ?? 0) + 1);
  }
  return [...plannedCount.entries()].filter(([id, count]) => succeededCount.get(id) === count).map(([id]) => id);
}
