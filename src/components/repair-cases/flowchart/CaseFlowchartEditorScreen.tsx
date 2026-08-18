"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { ReactFlowInstance } from "@xyflow/react";
import CaseFlowchartGraph, { type CaseFlowchartGraphNode, type CaseFlowchartGraphEdge } from "./CaseFlowchartGraph";
import CaseFlowchartCreateNodePanel from "./CaseFlowchartCreateNodePanel";
import CaseFlowchartNodePropertyPanel, { type CaseFlowchartNodeDraft } from "./CaseFlowchartNodePropertyPanel";
import CaseFlowchartCreateEdgePanel from "./CaseFlowchartCreateEdgePanel";
import CaseFlowchartEdgePropertyPanel, { type CaseFlowchartEdgeDraft } from "./CaseFlowchartEdgePropertyPanel";
import { updateRepairCaseFlowchartMetadataAction } from "@/lib/server/actions/repair-case-flowcharts";
import {
  saveRepairCaseFlowchartLayoutAction,
  saveRepairCaseFlowchartEdgeRouteAction,
  updateRepairCaseFlowchartNodeAction,
  changeRepairCaseFlowchartNodeTypeAction,
  updateRepairCaseFlowchartEdgeAction,
  retargetRepairCaseFlowchartEdgeAction,
} from "@/lib/server/actions/repair-case-flowchart-graph";
import { addWaypointAtDefaultPosition, removeWaypoint, moveWaypoint, type RoutePoint } from "@/lib/graph-editor-core/routing";
import { resolveEffectiveNodeDimensions, computeStraightenedConnectedNodePosition } from "@/lib/graph-editor-core/layout";
import { NODE_VISUAL_CONFIG, getNodeChipVisual, computeNodeDimensions } from "@/lib/domain/procedure-visual-language";
import {
  mergeNodeForRender,
  mergeEdgeForRender,
  computeDirtyNodeEntries,
  computeDirtyEdgeEntries,
  computeDirtyRouteEdgeIds,
  computeDirtyPositionNodeIds,
  planSaveSteps,
  runSaveSequence,
  fullySucceededNodeIds,
  fullySucceededEdgeIds,
  succeededRouteEdgeIds,
  succeededPositionNodeIds,
  type SaveStep,
  type SaveStepResult,
  type Position,
} from "@/lib/domain/repair-case-flowchart-editor-save-state";

export type CaseFlowchartMetadata = { id: string; repairCaseId: string; title: string; description: string | null; updatedAt: string };

type CaseRightPanelTab = "properties" | "addNode" | "createEdge";

/**
 * Case-flowchart graph editor screen (Phase 5C-6D, editor model corrected
 * in 5C-6D follow-up #2). Deliberately not a clone of
 * ProcedureTemplateEditorScreen.tsx — no template category, no DRAFT/
 * PUBLISHED lifecycle, no validation-issue panel, no version controls, no
 * publish controls, no procedure-template history UI, no Undo/Redo/Restore
 * (6E). Uses the existing 6B/6C query/action layers exclusively.
 *
 * canEdit is a prop computed server-side (the page) from session role +
 * repair-case assignment/lock — a UX convenience only. Every mutation
 * called below independently re-verifies authority server-side; this
 * screen never passes a trusted role/assignment boolean INTO a mutation.
 *
 * ================================ EDITOR MODEL ================================
 *   SERVER BASELINE (nodes/edges props)
 *     + LOCAL DRAFT OVERRIDES (pendingNodeDraftsById / pendingNodePositionsById /
 *       pendingEdgeDraftsById / pendingRoutePointsByEdgeId — all keyed
 *       per-entity, so editing/dragging node A then selecting node B never
 *       loses A's in-progress edit or leaks it into B's display)
 *     = RENDERED GRAPH (renderedNodes/renderedEdges below, via
 *       mergeNodeForRender/mergeEdgeForRender — repair-case-flowchart-
 *       editor-save-state.ts)
 *
 * EVERY editable property (node title/description/type, node position, edge
 * branchType/branchLabel/retarget, edge routePoints) is visible on the
 * canvas THE INSTANT it changes — typing a new title, dragging a node,
 * changing an edge's branch type — with zero server round-trip and no
 * "press Save to see it" step. The canvas always renders from baseline +
 * pending drafts, never from baseline alone; there is exactly one rendered
 * graph, not a separate "visual state" the draft maps have to stay in sync
 * with.
 *
 * DIRTY is always derived by comparing the current draft/position against
 * the live `nodes`/`edges` props (never a separately-tracked boolean) — an
 * entry that round-trips back to its original value (e.g. dragged out and
 * back) stops counting as pending on its own, and a router.refresh()
 * bringing fresh server props automatically re-bases the comparison
 * without discarding any draft the user hasn't saved yet (pending state
 * lives in this component's own React state, which router.refresh()
 * re-renders around, never resets).
 *
 * [저장] is a COMMIT of exactly the rendered state, not a preview trigger:
 * it persists what's already on screen. Node position no longer
 * auto-saves on drag-stop or from the property panel's "상대 위치로
 * 이동" buttons — ALL position changes are pending/dirty like every other
 * field, and only [저장] ever calls saveRepairCaseFlowchartLayoutAction.
 * On success: pending state clears, server baseline catches up (via
 * router.refresh()), button reads 저장할 변경 없음 again. On failure: the
 * canvas keeps showing the local pending state (never snaps back to
 * server values), dirty state remains, retry is just clicking again. A
 * page refresh BEFORE Save can lose unsaved local edits — acceptable for
 * this checkpoint; no browser-local persistence/autosave is added.
 *
 * handleGlobalSave flushes everything in one deterministic sequence: (1)
 * node property/type changes, (2) node positions (one batched layout
 * call), (3) edge property/retarget changes, (4) route changes — chaining
 * each mutation's returned `updatedAt` into the next call's
 * `expectedFlowchartUpdatedAt` (every successful save bumps the token, so
 * concurrent/stale calls would otherwise corrupt each other). Stops at the
 * FIRST failure anywhere in the sequence; already-flushed entries are
 * removed from their pending maps, everything from the failure point
 * onward stays pending for a retry. Never reports 저장 완료 unless the
 * entire sequence succeeded. This is NOT one atomic DB transaction across
 * every change — the underlying server APIs are separate mutations — so a
 * partial failure is a real, surfaced possibility, not something hidden
 * from the user.
 *
 * Relative-position ("상대 위치로 이동") Y-center/X-column alignment (5C-6D
 * follow-up #4/#5) is computed from each node's REAL measured dimensions
 * (React Flow's own `getInternalNode(id)?.measured`, surfaced here via
 * CaseFlowchartGraph's onInstanceReady into reactFlowInstanceRef) rather
 * than a size estimate — see resolveMeasuredNodeDimensions below,
 * graph-editor-core/layout.ts's resolveEffectiveNodeDimensions (the one
 * shared measured-vs-fallback priority rule), and
 * CaseFlowchartNodePropertyPanel's own doc comment for the full story.
 * Root cause (two layers, both real): (1) computeNodeDimensions never
 * accounted for a node's description/subtitle line, so the fallback
 * estimate silently under-measured any node with a description; (2)
 * follow-up #4's first attempt at using measured dimensions called
 * `getNode(id)`, which React Flow resolves to the ORIGINAL unmeasured
 * object this component itself passed in — never the internally-measured
 * node — so `.measured` was undefined on every call and the fix had zero
 * runtime effect despite passing its own tests. `getInternalNode(id)` is
 * the actual fix.
 *
 * Double-click an edge → "straighten this connection" (5C-6D follow-up
 * #6): computeStraightenedConnectedNodePosition (graph-editor-core/
 * layout.ts) moves only the TARGET node's pending position to align
 * visual centers with the fixed SOURCE node, and — if the edge has a
 * manual route — resets it to automatic (`routePoints: null`) as a second
 * pending change. Uses the exact same `resolveNodeDimensions` function
 * instance as the relative-position feature (see handleEdgeDoubleClick's
 * own doc comment below), never a separate geometry path. Both writes are
 * ordinary pending-map updates, so they participate in the normal dirty/
 * Save flow with no special-casing.
 *
 * Node/edge CREATE and DELETE remain immediate server mutations in this
 * checkpoint (not deferred into this draft model) — converting them would
 * mean rendering not-yet-persisted nodes/edges with client-only ids and
 * reconciling them against server ids on save, materially expanding scope
 * beyond "editing existing visible graph properties/positions/routes."
 * =================================================================================
 */
export default function CaseFlowchartEditorScreen({
  repairCaseId,
  flowchart,
  nodes,
  edges,
  canEdit,
}: {
  repairCaseId: string;
  flowchart: CaseFlowchartMetadata;
  nodes: CaseFlowchartGraphNode[];
  edges: CaseFlowchartGraphEdge[];
  canEdit: boolean;
}) {
  const router = useRouter();

  // Adjust-state-during-render (same convention as
  // ProcedureTemplateEditorScreen's own currentUpdatedAt/prevTemplateUpdatedAt
  // pair) — resyncs only when the prop itself changes (e.g. after
  // router.refresh() brings a fresh flowchart).
  const [prevFlowchartUpdatedAt, setPrevFlowchartUpdatedAt] = useState(flowchart.updatedAt);
  const [currentUpdatedAt, setCurrentUpdatedAt] = useState(flowchart.updatedAt);
  if (flowchart.updatedAt !== prevFlowchartUpdatedAt) {
    setPrevFlowchartUpdatedAt(flowchart.updatedAt);
    setCurrentUpdatedAt(flowchart.updatedAt);
  }

  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null);
  const [selectedWaypointIndex, setSelectedWaypointIndex] = useState<number | null>(null);

  // Phase B (5C-6D-1F design pass) — right-panel tabs, mirroring
  // ProcedureTemplateEditorScreen's rightPanelTab pattern at the IA level
  // only (no 검증/이력 tabs — Case has neither). Selecting a node or edge on
  // the canvas always jumps to "properties", same as the Procedure screen.
  const [rightPanelTab, setRightPanelTab] = useState<CaseRightPanelTab>("properties");

  const [pendingNodeDraftsById, setPendingNodeDraftsById] = useState<Map<string, CaseFlowchartNodeDraft>>(new Map());
  const [pendingNodePositionsById, setPendingNodePositionsById] = useState<Map<string, Position>>(new Map());
  const [pendingEdgeDraftsById, setPendingEdgeDraftsById] = useState<Map<string, CaseFlowchartEdgeDraft>>(new Map());
  const [pendingRoutePointsByEdgeId, setPendingRoutePointsByEdgeId] = useState<Map<string, RoutePoint[] | null>>(new Map());

  const [titleDraft, setTitleDraft] = useState(flowchart.title);
  const [descriptionDraft, setDescriptionDraft] = useState(flowchart.description ?? "");
  const [isSavingMetadata, setIsSavingMetadata] = useState(false);
  const [metadataError, setMetadataError] = useState<string | null>(null);

  const [globalSaveStatus, setGlobalSaveStatus] = useState<"idle" | "saving" | "saved" | "failed">("idle");
  const [globalSaveError, setGlobalSaveError] = useState<string | null>(null);

  // 5C-6D follow-up #4/#5 — the live React Flow instance, captured once via
  // CaseFlowchartGraph's onInstanceReady. Real measured node dimensions
  // come from its `getInternalNode(id)?.measured` — used by the relative-
  // position math in CaseFlowchartNodePropertyPanel so Y-center/X-column
  // alignment is based on what's actually on screen (including a
  // subtitle/description line, which the presentation-only
  // computeNodeDimensions ESTIMATE never accounted for) rather than a
  // second, potentially-drifting size estimator. A ref, not state — the
  // instance itself never changes after mount, and this must never trigger
  // a re-render on its own.
  //
  // Root-cause note (5C-6D follow-up #5): `getNode(id)` — used here in
  // follow-up #4 — is NOT the internally-measured node. Per React Flow's
  // own source (@xyflow/react's useReactFlow hook), `getNode(id)` resolves
  // to `getInternalNode(id)?.internals.userNode` — literally the raw
  // object this component itself passed into the `nodes` prop via
  // CaseFlowchartGraph's `flowNodes`, which never carries a `measured`
  // field at all. `.measured` is undefined there ALWAYS, not merely before
  // the first paint — so follow-up #4's fix silently fell back to the
  // description-blind estimate on every single call, changing nothing at
  // runtime despite type-checking and its own unit tests passing (the
  // tests exercised the pure math with fabricated-correct inputs; the bug
  // was entirely in how this caller obtained its input). `getInternalNode`
  // (also exposed directly on ReactFlowInstance) resolves to React Flow's
  // own `nodeLookup` — the same internal, ResizeObserver-measured node
  // store React Flow's own geometry functions (e.g. evaluateAbsolutePosition)
  // read from — which is the correct, authoritative source.
  const reactFlowInstanceRef = useRef<ReactFlowInstance | null>(null);

  /** Raw measured dimensions straight from React Flow's internal node store — each axis independently `number | undefined` until actually measured; `null` only when the node isn't in the RF instance at all. Never finite-checked or defaulted here — resolveEffectiveNodeDimensions (graph-editor-core/layout.ts) is the one place that priority rule lives, applied identically for every node a caller resolves. */
  function resolveMeasuredNodeDimensions(nodeId: string): { width?: number; height?: number } | null {
    return reactFlowInstanceRef.current?.getInternalNode(nodeId)?.measured ?? null;
  }

  /** DETERMINISTIC FALLBACK ONLY, used when a node hasn't been measured yet — presentation-only and, notably, blind to a node's description/subtitle line (only `title` drives it). This is the estimator whose gap with real rendering root-caused the follow-up #5 misalignment bug; kept unchanged here, not patched, since the actual fix is preferring real measured size over it (see resolveNodeDimensions below), not making the estimate itself smarter. */
  function estimatedNodeDimensions(n: CaseFlowchartGraphNode) {
    return computeNodeDimensions({ title: n.title, shape: NODE_VISUAL_CONFIG[getNodeChipVisual(n.nodeType).semanticType].shape });
  }

  /**
   * THE single, shared effective-dimension resolver — measured-first,
   * estimate-fallback (resolveEffectiveNodeDimensions), used identically
   * by CaseFlowchartNodePropertyPanel's relative-position math (passed
   * down as a prop) AND this screen's own handleEdgeDoubleClick straighten
   * logic below. One function instance, not a duplicated composition per
   * caller — this is what guarantees both features read the same runtime
   * geometry (5C-6D follow-up #6's explicit requirement).
   */
  function resolveNodeDimensions(n: CaseFlowchartGraphNode): { width: number; height: number } {
    return resolveEffectiveNodeDimensions(resolveMeasuredNodeDimensions(n.id), estimatedNodeDimensions(n));
  }

  // "저장 완료" is a transient confirmation, not a permanent state — reverts
  // to idle on its own so the button doesn't get stuck claiming a save
  // that already happened minutes ago.
  useEffect(() => {
    if (globalSaveStatus !== "saved") return;
    const timer = setTimeout(() => setGlobalSaveStatus("idle"), 2500);
    return () => clearTimeout(timer);
  }, [globalSaveStatus]);

  function handleSaved(newUpdatedAt: string) {
    setCurrentUpdatedAt(newUpdatedAt);
    router.refresh();
  }

  function handleNodeDeleted(newUpdatedAt: string) {
    if (selectedNodeId) {
      setPendingNodeDraftsById((prev) => {
        if (!prev.has(selectedNodeId)) return prev;
        const next = new Map(prev);
        next.delete(selectedNodeId);
        return next;
      });
      setPendingNodePositionsById((prev) => {
        if (!prev.has(selectedNodeId)) return prev;
        const next = new Map(prev);
        next.delete(selectedNodeId);
        return next;
      });
    }
    setSelectedNodeId(null);
    handleSaved(newUpdatedAt);
  }

  function handleEdgeDeleted(newUpdatedAt: string) {
    if (selectedEdgeId) {
      setPendingEdgeDraftsById((prev) => {
        if (!prev.has(selectedEdgeId)) return prev;
        const next = new Map(prev);
        next.delete(selectedEdgeId);
        return next;
      });
      setPendingRoutePointsByEdgeId((prev) => {
        if (!prev.has(selectedEdgeId)) return prev;
        const next = new Map(prev);
        next.delete(selectedEdgeId);
        return next;
      });
    }
    setSelectedEdgeId(null);
    setSelectedWaypointIndex(null);
    handleSaved(newUpdatedAt);
  }

  /** Sets (or replaces) a node's pending position — the ONE place both canvas drag-stop and the property panel's "상대 위치로 이동" buttons funnel through. No mutation call here; position is dirty/pending like every other field, only [저장] persists it. */
  function setPendingNodePosition(nodeId: string, position: Position) {
    setPendingNodePositionsById((prev) => {
      const next = new Map(prev);
      next.set(nodeId, position);
      return next;
    });
  }

  function handleNodeDragStop(nodeId: string, position: Position) {
    if (!canEdit) return;
    setPendingNodePosition(nodeId, position);
  }

  // ---- node draft (title/description/nodeType) ----

  function nodeDraft(nodeId: string): CaseFlowchartNodeDraft {
    const pending = pendingNodeDraftsById.get(nodeId);
    if (pending) return pending;
    const serverNode = nodes.find((n) => n.id === nodeId);
    return {
      title: serverNode?.title ?? "",
      description: serverNode?.description ?? "",
      instructions: serverNode?.instructions ?? "",
      nodeType: serverNode?.nodeType ?? "TASK",
    };
  }

  function updateNodeDraft(nodeId: string, patch: Partial<CaseFlowchartNodeDraft>) {
    setPendingNodeDraftsById((prev) => {
      const next = new Map(prev);
      next.set(nodeId, { ...nodeDraft(nodeId), ...patch });
      return next;
    });
  }

  const nodesById = new Map(nodes.map((n) => [n.id, n]));
  const dirtyNodeEntries = computeDirtyNodeEntries(pendingNodeDraftsById, nodesById);
  const dirtyPositionNodeIds = computeDirtyPositionNodeIds(pendingNodePositionsById, nodesById);

  // ---- edge draft (branchType/branchLabel/fromNodeId/toNodeId) ----

  function edgeDraft(edgeId: string): CaseFlowchartEdgeDraft {
    const pending = pendingEdgeDraftsById.get(edgeId);
    if (pending) return pending;
    const serverEdge = edges.find((e) => e.id === edgeId);
    return {
      branchType: serverEdge?.branchType ?? "DEFAULT",
      branchLabel: serverEdge?.branchLabel ?? "",
      fromNodeId: serverEdge?.fromNodeId ?? "",
      toNodeId: serverEdge?.toNodeId ?? "",
    };
  }

  function updateEdgeDraft(edgeId: string, patch: Partial<CaseFlowchartEdgeDraft>) {
    setPendingEdgeDraftsById((prev) => {
      const next = new Map(prev);
      next.set(edgeId, { ...edgeDraft(edgeId), ...patch });
      return next;
    });
  }

  const edgesById = new Map(edges.map((e) => [e.id, e]));
  const dirtyEdgeEntries = computeDirtyEdgeEntries(pendingEdgeDraftsById, edgesById);

  // ---- route draft (waypoints) ----

  function workingRoutePoints(edgeId: string): RoutePoint[] | null {
    if (pendingRoutePointsByEdgeId.has(edgeId)) return pendingRoutePointsByEdgeId.get(edgeId) ?? null;
    return edges.find((e) => e.id === edgeId)?.routePoints ?? null;
  }

  function handleWaypointMove(edgeId: string, index: number, point: RoutePoint) {
    if (!canEdit) return;
    setPendingRoutePointsByEdgeId((prev) => {
      const next = new Map(prev);
      next.set(edgeId, moveWaypoint(workingRoutePoints(edgeId) ?? [], index, point));
      return next;
    });
  }

  function handleAddWaypoint() {
    if (!canEdit || !selectedEdgeId || !selectedEdge) return;
    const fromNode = renderedNodes.find((n) => n.id === selectedEdge.fromNodeId);
    const toNode = renderedNodes.find((n) => n.id === selectedEdge.toNodeId);
    if (!fromNode || !toNode) return;
    setPendingRoutePointsByEdgeId((prev) => {
      const next = new Map(prev);
      const points = workingRoutePoints(selectedEdgeId) ?? [];
      next.set(selectedEdgeId, addWaypointAtDefaultPosition(points, { x: fromNode.positionX, y: fromNode.positionY }, { x: toNode.positionX, y: toNode.positionY }));
      return next;
    });
  }

  function handleRemoveSelectedWaypoint() {
    if (!canEdit || !selectedEdgeId || selectedWaypointIndex === null) return;
    setPendingRoutePointsByEdgeId((prev) => {
      const next = new Map(prev);
      next.set(selectedEdgeId, removeWaypoint(workingRoutePoints(selectedEdgeId) ?? [], selectedWaypointIndex));
      return next;
    });
    setSelectedWaypointIndex(null);
  }

  function handleResetRoute() {
    if (!canEdit || !selectedEdgeId) return;
    setPendingRoutePointsByEdgeId((prev) => {
      const next = new Map(prev);
      next.set(selectedEdgeId, null);
      return next;
    });
    setSelectedWaypointIndex(null);
  }

  /**
   * Double-click an edge → "straighten this connection" (5C-6D follow-up
   * #6). SOURCE (fromNodeId) stays fixed; only TARGET (toNodeId) moves —
   * see computeStraightenedConnectedNodePosition's own doc comment for why
   * only one node moves: it keeps the operation predictable and preserves
   * the upstream layout, rather than averaging/splitting the move across
   * both nodes. A LOCAL pending-position update only — no server mutation,
   * [저장] becomes dirty exactly like a manual drag.
   *
   * If the edge currently has a manual route, it also resets to automatic
   * (`routePoints: null`) as a second pending change from the same click.
   * This applies uniformly across every branch type, INCLUDING RETRY/
   * LOOP_BACK — audited explicitly, not assumed: CaseFlowchartGraph's own
   * `flowEdges` memo already renders a null-routePoints RETRY/LOOP_BACK
   * edge through React Flow's own curved `"default"` type
   * (`config.routeStyle === "loopback-curve"`), its correct semantic
   * rendering — so resetting to null RESTORES that curve rather than
   * fighting it. No branch-type special-casing is needed here as a result.
   *
   * Both writes go through the same pending-map + dirty-comparison
   * machinery as every other draft change, so an already-aligned/already-
   * automatic edge naturally produces no new dirty state on its own (the
   * computed position already equals the current one; a null-vs-null route
   * compares as unchanged) — no separate no-op check needed here.
   */
  function handleEdgeDoubleClick(edgeId: string) {
    if (!canEdit) return;
    const edge = renderedEdges.find((e) => e.id === edgeId);
    if (!edge) return;
    const sourceNode = renderedNodes.find((n) => n.id === edge.fromNodeId);
    const targetNode = renderedNodes.find((n) => n.id === edge.toNodeId);
    if (!sourceNode || !targetNode) return;

    const sourceDims = resolveNodeDimensions(sourceNode);
    const targetDims = resolveNodeDimensions(targetNode);
    const straightened = computeStraightenedConnectedNodePosition(
      { x: sourceNode.positionX, y: sourceNode.positionY, width: sourceDims.width, height: sourceDims.height },
      { x: targetNode.positionX, y: targetNode.positionY, width: targetDims.width, height: targetDims.height }
    );
    setPendingNodePosition(targetNode.id, straightened.position);

    const currentRoute = workingRoutePoints(edgeId);
    if (currentRoute && currentRoute.length > 0) {
      setPendingRoutePointsByEdgeId((prev) => {
        const next = new Map(prev);
        next.set(edgeId, null);
        return next;
      });
    }
  }

  /** Ids whose pending route actually differs from the last-saved edge (so re-adding then removing the same waypoint, ending up back where it started, doesn't count as "pending"). */
  const dirtyRouteEdgeIds = computeDirtyRouteEdgeIds(pendingRoutePointsByEdgeId, edgesById);

  const totalPendingCount = dirtyNodeEntries.length + dirtyPositionNodeIds.length + dirtyEdgeEntries.length + dirtyRouteEdgeIds.length;
  const hasAnyPendingChanges = totalPendingCount > 0;

  // Unsaved-navigation guard (parity with ProcedureTemplateEditorScreen) —
  // covers browser close/refresh; this screen is embedded in a tab (no
  // dedicated "나가기" link of its own to separately confirm).
  useEffect(() => {
    function handleBeforeUnload(e: BeforeUnloadEvent) {
      if (!hasAnyPendingChanges) return;
      e.preventDefault();
    }
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [hasAnyPendingChanges]);

  // ---- rendered graph (server baseline + pending drafts, merged) ----

  const renderedNodes: CaseFlowchartGraphNode[] = nodes.map((n) => mergeNodeForRender(n, pendingNodeDraftsById.get(n.id), pendingNodePositionsById.get(n.id)));
  const renderedEdges: CaseFlowchartGraphEdge[] = edges.map((e) => mergeEdgeForRender(e, pendingEdgeDraftsById.get(e.id), pendingRoutePointsByEdgeId.get(e.id)));

  const selectedNode = renderedNodes.find((n) => n.id === selectedNodeId) ?? null;
  const selectedEdge = renderedEdges.find((e) => e.id === selectedEdgeId) ?? null;

  /** Executes exactly one planned step against the real mutation layer — the only place in this component that knows which server action a given SaveStep maps to. Ordering, chaining, and stop-on-first-failure all live in runSaveSequence (repair-case-flowchart-editor-save-state.ts), unit-tested there. */
  async function executeSaveStep(step: SaveStep, expectedUpdatedAt: string): Promise<SaveStepResult> {
    if (step.kind === "NODE_FIELDS") {
      const draft = nodeDraft(step.nodeId);
      const result = await updateRepairCaseFlowchartNodeAction({
        repairCaseId,
        flowchartId: flowchart.id,
        nodeId: step.nodeId,
        title: draft.title,
        description: draft.description.trim() || null,
        instructions: draft.instructions.trim() || null,
        expectedFlowchartUpdatedAt: expectedUpdatedAt,
      });
      return result.ok ? { ok: true, updatedAt: result.updatedAt } : { ok: false, message: result.message };
    }
    if (step.kind === "NODE_TYPE") {
      const draft = nodeDraft(step.nodeId);
      const result = await changeRepairCaseFlowchartNodeTypeAction({
        repairCaseId,
        flowchartId: flowchart.id,
        nodeId: step.nodeId,
        nodeType: draft.nodeType,
        expectedFlowchartUpdatedAt: expectedUpdatedAt,
      });
      return result.ok ? { ok: true, updatedAt: result.updatedAt } : { ok: false, message: result.message };
    }
    if (step.kind === "NODE_POSITIONS") {
      const positions = step.nodeIds.map((id) => {
        const pos = pendingNodePositionsById.get(id);
        return { id, positionX: pos?.x ?? 0, positionY: pos?.y ?? 0 };
      });
      const result = await saveRepairCaseFlowchartLayoutAction({
        repairCaseId,
        flowchartId: flowchart.id,
        positions,
        expectedFlowchartUpdatedAt: expectedUpdatedAt,
      });
      return result.ok ? { ok: true, updatedAt: result.updatedAt } : { ok: false, message: result.message };
    }
    if (step.kind === "EDGE_FIELDS") {
      const draft = edgeDraft(step.edgeId);
      const result = await updateRepairCaseFlowchartEdgeAction({
        repairCaseId,
        flowchartId: flowchart.id,
        edgeId: step.edgeId,
        branchType: draft.branchType,
        branchLabel: draft.branchLabel.trim() || null,
        expectedFlowchartUpdatedAt: expectedUpdatedAt,
      });
      return result.ok ? { ok: true, updatedAt: result.updatedAt } : { ok: false, message: result.message };
    }
    if (step.kind === "EDGE_RETARGET") {
      const draft = edgeDraft(step.edgeId);
      const result = await retargetRepairCaseFlowchartEdgeAction({
        repairCaseId,
        flowchartId: flowchart.id,
        edgeId: step.edgeId,
        newFromNodeId: draft.fromNodeId,
        newToNodeId: draft.toNodeId,
        expectedFlowchartUpdatedAt: expectedUpdatedAt,
      });
      return result.ok ? { ok: true, updatedAt: result.updatedAt } : { ok: false, message: result.message };
    }
    // EDGE_ROUTE
    const result = await saveRepairCaseFlowchartEdgeRouteAction({
      repairCaseId,
      flowchartId: flowchart.id,
      edgeId: step.edgeId,
      routePoints: workingRoutePoints(step.edgeId),
      expectedFlowchartUpdatedAt: expectedUpdatedAt,
    });
    return result.ok ? { ok: true, updatedAt: result.updatedAt } : { ok: false, message: result.message };
  }

  /**
   * The editor's SOLE save action — commits exactly what's currently
   * rendered (see this file's own EDITOR MODEL doc comment above).
   * Deterministic order: node property/type changes, then node positions
   * (one batched layout call), then edge property/retarget changes, then
   * route changes — no known dependency forces a different order (a
   * retarget's new endpoints are always EXISTING nodes, never ones created
   * in this same save batch, since node CREATION stays its own immediate
   * action outside this dirty-state model entirely).
   */
  async function handleGlobalSave() {
    if (!hasAnyPendingChanges) return;
    setGlobalSaveStatus("saving");
    setGlobalSaveError(null);

    const steps = planSaveSteps({
      dirtyNodes: dirtyNodeEntries,
      serverNodesById: nodesById,
      dirtyPositionNodeIds,
      dirtyEdges: dirtyEdgeEntries,
      serverEdgesById: edgesById,
      dirtyRouteEdgeIds,
    });

    const outcome = await runSaveSequence(steps, currentUpdatedAt, executeSaveStep);

    const flushedNodeIds = fullySucceededNodeIds(steps, outcome.succeededSteps);
    const flushedPositionNodeIds = succeededPositionNodeIds(outcome.succeededSteps);
    const flushedEdgeIds = fullySucceededEdgeIds(steps, outcome.succeededSteps);
    const flushedRouteEdgeIds = succeededRouteEdgeIds(outcome.succeededSteps);

    setPendingNodeDraftsById((prev) => {
      if (flushedNodeIds.length === 0) return prev;
      const next = new Map(prev);
      for (const id of flushedNodeIds) next.delete(id);
      return next;
    });
    setPendingNodePositionsById((prev) => {
      if (flushedPositionNodeIds.length === 0) return prev;
      const next = new Map(prev);
      for (const id of flushedPositionNodeIds) next.delete(id);
      return next;
    });
    setPendingEdgeDraftsById((prev) => {
      if (flushedEdgeIds.length === 0) return prev;
      const next = new Map(prev);
      for (const id of flushedEdgeIds) next.delete(id);
      return next;
    });
    setPendingRoutePointsByEdgeId((prev) => {
      if (flushedRouteEdgeIds.length === 0) return prev;
      const next = new Map(prev);
      for (const id of flushedRouteEdgeIds) next.delete(id);
      return next;
    });
    setCurrentUpdatedAt(outcome.finalUpdatedAt);

    if (outcome.failedAtStep) {
      setGlobalSaveStatus("failed");
      setGlobalSaveError(outcome.failureMessage);
      return;
    }

    setSelectedWaypointIndex(null);
    setGlobalSaveStatus("saved");
    router.refresh();
  }

  /** Client-only reset of every pending draft/position/route map — mirrors ProcedureTemplateEditorScreen's handleDiscardAllPending. Nothing here was ever persisted, so there is no server call and no audit row. */
  function handleDiscardAllPending() {
    setPendingNodeDraftsById(new Map());
    setPendingNodePositionsById(new Map());
    setPendingEdgeDraftsById(new Map());
    setPendingRoutePointsByEdgeId(new Map());
    setSelectedWaypointIndex(null);
    setGlobalSaveStatus("idle");
    setGlobalSaveError(null);
  }

  async function handleSaveMetadata() {
    setIsSavingMetadata(true);
    setMetadataError(null);
    const result = await updateRepairCaseFlowchartMetadataAction({
      repairCaseId,
      flowchartId: flowchart.id,
      title: titleDraft,
      description: descriptionDraft.trim() || null,
      expectedUpdatedAt: currentUpdatedAt,
    });
    setIsSavingMetadata(false);
    if (!result.ok) {
      setMetadataError(result.message);
      return;
    }
    handleSaved(result.updatedAt);
  }

  const hasMetadataChanges = titleDraft !== flowchart.title || descriptionDraft !== (flowchart.description ?? "");

  return (
    <div className="flex flex-col gap-4">
      {!canEdit && (
        <p className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-300">
          읽기 전용 — 이 Flowchart를 수정할 권한이 없거나 접수 건이 잠겨 있습니다.
        </p>
      )}

      {canEdit && (
        <div className="flex items-center gap-3 rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2 text-xs dark:border-zinc-800 dark:bg-zinc-900">
          <button
            type="button"
            disabled={!hasAnyPendingChanges || globalSaveStatus === "saving"}
            onClick={() => void handleGlobalSave()}
            className="rounded-md bg-zinc-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-zinc-800 disabled:opacity-50 dark:bg-zinc-50 dark:text-zinc-900"
          >
            {globalSaveStatus === "saving"
              ? "저장 중..."
              : !hasAnyPendingChanges
                ? "저장할 변경 없음"
                : globalSaveStatus === "failed"
                  ? "저장 실패 - 다시 시도"
                  : "저장"}
          </button>
          <button
            type="button"
            onClick={handleDiscardAllPending}
            disabled={!hasAnyPendingChanges}
            className="rounded-md border border-zinc-300 px-3 py-1.5 text-sm text-zinc-700 hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-300"
          >
            취소
          </button>
          {globalSaveStatus === "saved" && <span className="text-emerald-700 dark:text-emerald-400">저장 완료</span>}
          {globalSaveStatus === "failed" && globalSaveError && <span className="text-red-600 dark:text-red-400">{globalSaveError}</span>}
          {hasAnyPendingChanges && globalSaveStatus === "idle" && (
            <span className="text-zinc-500 dark:text-zinc-400">변경사항 {totalPendingCount}건 저장 대기 중</span>
          )}
        </div>
      )}

      <div className="flex flex-col gap-2 rounded-lg border border-zinc-200 p-3 dark:border-zinc-800">
        <label className="flex flex-col gap-1 text-xs">
          Flowchart 제목
          <input
            value={titleDraft}
            onChange={(e) => setTitleDraft(e.target.value)}
            disabled={!canEdit}
            className="rounded-md border border-zinc-200 bg-white px-2 py-1.5 text-sm disabled:opacity-60 dark:border-zinc-700 dark:bg-zinc-900"
          />
        </label>
        <label className="flex flex-col gap-1 text-xs">
          설명 (선택)
          <textarea
            rows={2}
            value={descriptionDraft}
            onChange={(e) => setDescriptionDraft(e.target.value)}
            disabled={!canEdit}
            className="rounded-md border border-zinc-200 bg-white px-2 py-1.5 text-sm disabled:opacity-60 dark:border-zinc-700 dark:bg-zinc-900"
          />
        </label>
        {canEdit && (
          <button
            type="button"
            disabled={!hasMetadataChanges || titleDraft.trim().length === 0 || isSavingMetadata}
            onClick={() => void handleSaveMetadata()}
            className="self-start rounded-md bg-zinc-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-zinc-800 disabled:opacity-50 dark:bg-zinc-50 dark:text-zinc-900"
          >
            {isSavingMetadata ? "저장 중..." : "제목/설명 저장"}
          </button>
        )}
        {metadataError && <p className="text-xs text-red-600 dark:text-red-400">{metadataError}</p>}
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1fr_320px]">
        <div className="flex flex-col gap-2">
          <div className="min-h-[500px] rounded-lg border border-zinc-200 dark:border-zinc-800">
            {nodes.length === 0 ? (
              <p className="p-6 text-sm text-zinc-500 dark:text-zinc-400">아직 노드가 없습니다. 오른쪽 패널에서 첫 노드를 추가하세요.</p>
            ) : (
              <CaseFlowchartGraph
                nodes={renderedNodes}
                edges={renderedEdges}
                editable={canEdit}
                selectedNodeId={selectedNodeId}
                selectedEdgeId={selectedEdgeId}
                onNodeClick={(nodeId) => {
                  setSelectedNodeId(nodeId);
                  setSelectedEdgeId(null);
                  setSelectedWaypointIndex(null);
                  setRightPanelTab("properties");
                }}
                onEdgeClick={(edgeId) => {
                  setSelectedEdgeId(edgeId);
                  setSelectedNodeId(null);
                  setSelectedWaypointIndex(null);
                  setRightPanelTab("properties");
                }}
                onEdgeDoubleClick={handleEdgeDoubleClick}
                onPaneClick={() => {
                  setSelectedNodeId(null);
                  setSelectedEdgeId(null);
                  setSelectedWaypointIndex(null);
                }}
                onNodeDragStop={handleNodeDragStop}
                selectedWaypointIndex={selectedWaypointIndex}
                onWaypointSelectionChange={setSelectedWaypointIndex}
                onWaypointMove={handleWaypointMove}
                onInstanceReady={(instance) => {
                  reactFlowInstanceRef.current = instance;
                }}
              />
            )}
          </div>
          <p className="text-xs text-zinc-500 dark:text-zinc-400">
            {canEdit
              ? "편집 모드 — 노드를 드래그해 위치를 조정하고, 분기를 선택한 뒤 경로점을 추가/이동/삭제해 연결선 경로를 조정할 수 있습니다 (명시적으로 저장하기 전까지 반영되지 않습니다). 노드/분기를 클릭하면 연결된 경로가 강조되고 나머지는 흐리게 표시됩니다."
              : "읽기 전용 — 마우스 휠로 확대/축소, 드래그로 이동, 노드를 클릭하면 연결된 경로가 강조되고 나머지는 흐리게 표시됩니다."}
          </p>
        </div>

        <div className="flex flex-col gap-3 rounded-lg border border-zinc-200 bg-white p-3 dark:border-zinc-800 dark:bg-zinc-900">
          <div className="flex flex-wrap gap-1 border-b border-zinc-200 pb-2 text-xs dark:border-zinc-800">
            {(canEdit ? (["properties", "addNode", "createEdge"] as const) : (["properties"] as const)).map((tab) => (
              <button
                key={tab}
                type="button"
                onClick={() => setRightPanelTab(tab)}
                className={`rounded-md px-2 py-1 ${rightPanelTab === tab ? "bg-zinc-900 text-white dark:bg-zinc-50 dark:text-zinc-900" : "text-zinc-600 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-800"}`}
              >
                {tab === "properties" ? "속성" : tab === "addNode" ? "노드 추가" : "연결 추가"}
              </button>
            ))}
          </div>

          {rightPanelTab === "properties" && (
            <>
              {selectedNode && (
                <CaseFlowchartNodePropertyPanel
                  node={selectedNode}
                  allNodes={renderedNodes}
                  repairCaseId={repairCaseId}
                  flowchartId={flowchart.id}
                  canEdit={canEdit}
                  expectedFlowchartUpdatedAt={currentUpdatedAt}
                  draft={nodeDraft(selectedNode.id)}
                  onDraftChange={(patch) => updateNodeDraft(selectedNode.id, patch)}
                  onPositionDraftChange={(position) => setPendingNodePosition(selectedNode.id, position)}
                  onDeleted={handleNodeDeleted}
                  resolveNodeDimensions={resolveNodeDimensions}
                />
              )}
              {selectedEdge && (
                <CaseFlowchartEdgePropertyPanel
                  edge={selectedEdge}
                  nodes={renderedNodes}
                  repairCaseId={repairCaseId}
                  flowchartId={flowchart.id}
                  canEdit={canEdit}
                  expectedFlowchartUpdatedAt={currentUpdatedAt}
                  draft={edgeDraft(selectedEdge.id)}
                  onDraftChange={(patch) => updateEdgeDraft(selectedEdge.id, patch)}
                  onSaved={handleSaved}
                  onDeleted={handleEdgeDeleted}
                  routePoints={workingRoutePoints(selectedEdge.id)}
                  selectedWaypointIndex={selectedWaypointIndex}
                  onAddWaypoint={handleAddWaypoint}
                  onRemoveSelectedWaypoint={handleRemoveSelectedWaypoint}
                  onResetRoute={handleResetRoute}
                  onStraighten={() => handleEdgeDoubleClick(selectedEdge.id)}
                />
              )}
              {!selectedNode && !selectedEdge && <p className="text-xs text-zinc-500 dark:text-zinc-400">노드 또는 분기를 선택하면 상세 정보가 표시됩니다.</p>}
            </>
          )}

          {rightPanelTab === "addNode" && canEdit && (
            <CaseFlowchartCreateNodePanel
              repairCaseId={repairCaseId}
              flowchartId={flowchart.id}
              expectedFlowchartUpdatedAt={currentUpdatedAt}
              onSaved={handleSaved}
              selectedNode={selectedNode}
            />
          )}

          {rightPanelTab === "createEdge" && canEdit && nodes.length > 0 && (
            <CaseFlowchartCreateEdgePanel
              repairCaseId={repairCaseId}
              flowchartId={flowchart.id}
              nodes={renderedNodes}
              canEdit={canEdit}
              expectedFlowchartUpdatedAt={currentUpdatedAt}
              prefillFromNodeId={selectedNodeId}
              onSaved={handleSaved}
            />
          )}
        </div>
      </div>
    </div>
  );
}
