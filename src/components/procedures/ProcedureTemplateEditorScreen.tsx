"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import ProcedureFlowGraph from "./ProcedureFlowGraph";
import ProcedureGraphLegend from "./visual/ProcedureGraphLegend";
import NodePropertyPanel from "./editor/NodePropertyPanel";
import EdgePropertyPanel from "./editor/EdgePropertyPanel";
import CreateEdgePanel from "./editor/CreateEdgePanel";
import type { ProcedureTemplateForEditor, EditHistoryRow, DraftParentComparisonResult } from "@/lib/db/queries/procedure-template-editor";
import { resolveInitialGraphTarget, parseSourceReference } from "@/lib/domain/procedure-graph-navigation";
import { resolveEffectiveNodePosition } from "@/lib/graph-editor-core/layout";
import { computeUnsavedLayoutNodeIds, computeUnsavedEdgeRouteIds, computeEditorSaveState } from "@/lib/domain/procedure-editor-client-state";
import { saveProcedureTemplateLayoutAction, validateProcedureTemplateAction } from "@/lib/server/actions/procedure-template-editor";
import { procedureValidationIssueTypeLabels, procedureValidationSeverityLabels, procedureBranchTypeLabels, procedureNodeTypeLabels, procedureTemplateStatusLabels } from "@/lib/domain/procedure-template-types";
import type { StructuralValidationSummary, EdgeRouteInput } from "@/lib/db/mutations/procedure-template-editor";
import { addWaypointAtDefaultPosition, insertWaypointAtSegment, moveWaypoint, removeWaypoint, type RoutePoint } from "@/lib/graph-editor-core/routing";

type RightPanelTab = "properties" | "validation" | "history" | "compare" | "createEdge";

/**
 * The Phase 4A controlled workflow editor — deliberately a thin shell
 * around the exact same ProcedureFlowGraph/ProcedureGraphLegend Phase 3B
 * built (node shapes, edge routing, layout modes, error-focus, selection
 * highlighting are all reused verbatim via `editable`), never a second
 * visual language. Everything mutating lives in the right panel's three
 * focused forms (node/edge property, create-connection); this shell only
 * owns layout drag-batching (the one genuinely "continuous" editing
 * surface) and which panel is showing.
 */
export default function ProcedureTemplateEditorScreen({
  template,
  editHistory,
  comparison,
  canEdit,
}: {
  template: ProcedureTemplateForEditor;
  editHistory: EditHistoryRow[];
  comparison: DraftParentComparisonResult | null;
  canEdit: boolean;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const issueParam = searchParams.get("issue");
  const navigationTarget = resolveInitialGraphTarget(
    {
      nodeParam: searchParams.get("node"),
      worksheetParam: searchParams.get("worksheet"),
      shapeParam: searchParams.get("shape"),
      connectorParam: searchParams.get("connector"),
      fallbackParam: searchParams.get("fallback"),
      modeParam: searchParams.get("mode"),
    },
    template.nodes,
    template.edges
  );
  const errorFocusMode = navigationTarget.errorFocus && navigationTarget.nodeId !== null;

  // Adjust-state-during-render (React's documented alternative to a
  // synchronizing effect for "reset local state when a prop changes") —
  // currentUpdatedAt can also be advanced directly by a successful
  // mutation (handleSaved), so it can't just be derived from the prop on
  // every render; it only needs to resync when the prop itself changes
  // (e.g. after router.refresh() brings a fresh template).
  const [prevTemplateUpdatedAt, setPrevTemplateUpdatedAt] = useState(template.updatedAt);
  const [currentUpdatedAt, setCurrentUpdatedAt] = useState(template.updatedAt);
  if (template.updatedAt !== prevTemplateUpdatedAt) {
    setPrevTemplateUpdatedAt(template.updatedAt);
    setCurrentUpdatedAt(template.updatedAt);
  }

  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(navigationTarget.nodeId);
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null);
  const [rightPanelTab, setRightPanelTab] = useState<RightPanelTab>(navigationTarget.nodeId ? "properties" : "validation");
  const [lastStructuralValidation, setLastStructuralValidation] = useState<StructuralValidationSummary | null>(null);
  const [isValidating, setIsValidating] = useState(false);

  // Same sourceWorksheet+sourceShapeId matching technique
  // getProcedureTemplateDetail's openIssuesByNodeId already uses — the
  // editor's read-model doesn't pre-join this since not every caller of
  // getProcedureTemplateForEditor needs it (e.g. the DRAFT-vs-parent
  // comparison, which loads both sides of a template).
  const openIssuesByNodeId = useMemo(() => {
    const nodeByShapeAndSheet = new Map<string, string>();
    for (const n of template.nodes) {
      if (n.sourceShapeId && n.sourceWorksheet) nodeByShapeAndSheet.set(`${n.sourceWorksheet}::${n.sourceShapeId}`, n.id);
    }
    const result: { nodeId: string; issueId: string; severity: "ERROR" | "WARNING" }[] = [];
    for (const issue of template.unresolvedIssues) {
      if (issue.severity !== "ERROR" && issue.severity !== "WARNING") continue;
      const { shapeId } = parseSourceReference(issue.sourceReference);
      if (!shapeId || !issue.sourceWorksheet) continue;
      const nodeId = nodeByShapeAndSheet.get(`${issue.sourceWorksheet}::${shapeId}`);
      if (nodeId) result.push({ nodeId, issueId: issue.id, severity: issue.severity });
    }
    return result;
  }, [template.nodes, template.unresolvedIssues]);

  const savedLayoutPositions = useMemo(() => {
    const map = new Map<string, { x: number; y: number }>();
    for (const n of template.nodes) map.set(n.id, resolveEffectiveNodePosition(n, "USER"));
    return map;
  }, [template.nodes]);
  const [pendingLayoutMoves, setPendingLayoutMoves] = useState<Map<string, { x: number; y: number }>>(new Map());
  const workingLayoutPositions = useMemo(() => {
    const map = new Map(savedLayoutPositions);
    for (const [id, pos] of pendingLayoutMoves) map.set(id, pos);
    return map;
  }, [savedLayoutPositions, pendingLayoutMoves]);
  const unsavedLayoutNodeIds = useMemo(() => computeUnsavedLayoutNodeIds(savedLayoutPositions, workingLayoutPositions), [savedLayoutPositions, workingLayoutPositions]);

  // Phase 4B — 사용자 배치 manual edge-route (waypoint) pending state, the
  // edge-level sibling of pendingLayoutMoves above. A map *entry with
  // `null`* means "explicitly restored to automatic routing this session"
  // (distinct from *no entry*, meaning "untouched") — both
  // computeUnsavedEdgeRouteIds and the save payload below rely on that
  // distinction.
  const savedEdgeRoutes = useMemo(() => {
    const map = new Map<string, RoutePoint[] | null>();
    for (const e of template.edges) map.set(e.id, e.userRoutePoints && e.userRoutePoints.length > 0 ? e.userRoutePoints : null);
    return map;
  }, [template.edges]);
  const [pendingEdgeRouteMoves, setPendingEdgeRouteMoves] = useState<Map<string, RoutePoint[] | null>>(new Map());
  const workingEdgeRoutes = useMemo(() => {
    const map = new Map(savedEdgeRoutes);
    for (const [id, points] of pendingEdgeRouteMoves) map.set(id, points);
    return map;
  }, [savedEdgeRoutes, pendingEdgeRouteMoves]);
  const unsavedEdgeRouteIds = useMemo(() => computeUnsavedEdgeRouteIds(savedEdgeRoutes, workingEdgeRoutes), [savedEdgeRoutes, workingEdgeRoutes]);
  const [selectedWaypointIndex, setSelectedWaypointIndex] = useState<number | null>(null);

  const [isSavingLayout, setIsSavingLayout] = useState(false);
  const [layoutSaveFailed, setLayoutSaveFailed] = useState(false);
  const [layoutErrorMessage, setLayoutErrorMessage] = useState<string | null>(null);
  const saveState = computeEditorSaveState({ isSaving: isSavingLayout, lastSaveFailed: layoutSaveFailed, unsavedNodeIds: new Set(), unsavedEdgeIds: new Set(), unsavedLayoutNodeIds, unsavedEdgeRouteIds });
  const hasPendingLayoutChanges = unsavedLayoutNodeIds.size > 0 || unsavedEdgeRouteIds.size > 0;

  // Unsaved-navigation guard (Phase 4A, widened Phase 4B) — covers browser
  // close/refresh; the editor's own "나가기" link separately confirms via
  // window.confirm before navigating away in-app. Does not intercept every
  // possible in-app link (e.g. the global sidebar) — see the final
  // report's documented limitation.
  useEffect(() => {
    function handleBeforeUnload(e: BeforeUnloadEvent) {
      if (!hasPendingLayoutChanges) return;
      e.preventDefault();
    }
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [hasPendingLayoutChanges]);

  // A waypoint selection only ever makes sense for the currently-selected
  // edge — switching (or clearing) the selected edge always clears it, so
  // a stale index can never point at the wrong edge's route array.
  useEffect(() => {
    setSelectedWaypointIndex(null);
  }, [selectedEdgeId]);

  function handleSaved(newUpdatedAt: string, structuralValidation?: StructuralValidationSummary) {
    setCurrentUpdatedAt(newUpdatedAt);
    if (structuralValidation) setLastStructuralValidation(structuralValidation);
    router.refresh();
  }

  /**
   * Phase 4B — one combined save behind the single "저장" button: node
   * position moves and manual edge-route changes go in the same
   * saveProcedureTemplateLayoutAction call, so they commit or fail
   * together (see saveProcedureTemplateLayout's own doc comment for the
   * transactional guarantee this relies on). A failed save intentionally
   * never clears either pending map — the reviewer's in-progress work must
   * survive a rejected save (e.g. STALE_REVISION) so nothing is lost.
   */
  async function handleSaveLayout() {
    if (pendingLayoutMoves.size === 0 && pendingEdgeRouteMoves.size === 0) return;
    setIsSavingLayout(true);
    setLayoutErrorMessage(null);
    const positions = [...pendingLayoutMoves].map(([nodeId, pos]) => ({ nodeId, x: pos.x, y: pos.y }));
    const edgeRoutes: EdgeRouteInput[] = [...pendingEdgeRouteMoves].map(([edgeId, points]) => ({ edgeId, points }));
    const result = await saveProcedureTemplateLayoutAction({ templateId: template.id, positions, edgeRoutes, expectedTemplateUpdatedAt: currentUpdatedAt });
    setIsSavingLayout(false);
    if (!result.ok) {
      setLayoutSaveFailed(true);
      setLayoutErrorMessage(result.message);
      return;
    }
    setLayoutSaveFailed(false);
    setPendingLayoutMoves(new Map());
    setPendingEdgeRouteMoves(new Map());
    setSelectedWaypointIndex(null);
    handleSaved(result.updatedAt);
  }

  function handleDiscardLayout() {
    // Client-only — nothing was ever persisted, so there is no server call
    // and no DISCARD_DRAFT_CHANGES audit row (that action type is reserved
    // for a case where server state actually changed, which never applies
    // here).
    setPendingLayoutMoves(new Map());
    setPendingEdgeRouteMoves(new Map());
    setSelectedWaypointIndex(null);
    setLayoutSaveFailed(false);
    setLayoutErrorMessage(null);
  }

  /** Reads a route's current *working* points (pending override if this session touched it, else the last-saved value) — the one baseline every waypoint mutation below builds its next array from. */
  function currentWorkingRoutePoints(pending: Map<string, RoutePoint[] | null>, edgeId: string): RoutePoint[] {
    const points = pending.has(edgeId) ? pending.get(edgeId) : savedEdgeRoutes.get(edgeId);
    return points ?? [];
  }

  async function handleValidate() {
    setIsValidating(true);
    const result = await validateProcedureTemplateAction({ templateId: template.id });
    setIsValidating(false);
    if (result.ok) {
      setLastStructuralValidation(result.structuralValidation);
      setRightPanelTab("validation");
      router.refresh();
    }
  }

  function handleExit() {
    if (hasPendingLayoutChanges && !window.confirm("저장하지 않은 배치 변경사항이 있습니다. 나가시겠습니까?")) {
      return;
    }
    router.push(`/procedures/${template.id}`);
  }

  // Stable references (useCallback) are required here, not just tidiness —
  // ProcedureFlowGraph's own selection-sync effect depends on
  // [selectedNodeId, onNodeSelectionChange]; an inline arrow function would
  // get a new identity on every render of *this* component (e.g. every
  // right-panel tab click), re-firing that effect and silently resetting
  // rightPanelTab back to "properties" even though the selected node never
  // actually changed.
  const handleNodeSelectionChange = useCallback((nodeId: string | null) => {
    setSelectedNodeId(nodeId);
    if (nodeId) setRightPanelTab("properties");
  }, []);
  const handleEdgeSelectionChange = useCallback((edgeId: string | null) => {
    setSelectedEdgeId(edgeId);
    if (edgeId) setRightPanelTab("properties");
  }, []);
  const handleNodeDragStop = useCallback((nodeId: string, position: { x: number; y: number }) => {
    setPendingLayoutMoves((prev) => {
      const next = new Map(prev);
      next.set(nodeId, position);
      return next;
    });
  }, []);

  // ---- Phase 4B: manual edge-route (waypoint) editing ----
  // Every one of these only ever touches pendingEdgeRouteMoves — client
  // state only, never a Server Action call. "No auto-save" holds for
  // every one of add/move/remove/reset, not just node dragging.

  const handleWaypointSelectionChange = useCallback((index: number | null) => {
    setSelectedWaypointIndex(index);
  }, []);

  const handleWaypointMove = useCallback(
    (edgeId: string, index: number, point: RoutePoint) => {
      setPendingEdgeRouteMoves((prev) => {
        const next = new Map(prev);
        next.set(edgeId, moveWaypoint(currentWorkingRoutePoints(prev, edgeId), index, point));
        return next;
      });
    },
    [savedEdgeRoutes]
  );

  /** The double-click-on-the-edge shortcut (never the only way to add a point — see handleAddWaypoint for the primary, explicit-button method). */
  const handleWaypointInsertAt = useCallback(
    (edgeId: string, point: RoutePoint) => {
      const edge = template.edges.find((e) => e.id === edgeId);
      const source = edge ? workingLayoutPositions.get(edge.fromNodeId) : undefined;
      const target = edge ? workingLayoutPositions.get(edge.toNodeId) : undefined;
      if (!edge || !source || !target) return;
      setPendingEdgeRouteMoves((prev) => {
        const next = new Map(prev);
        next.set(edgeId, insertWaypointAtSegment(currentWorkingRoutePoints(prev, edgeId), source, target, point));
        return next;
      });
    },
    [template.edges, workingLayoutPositions, savedEdgeRoutes]
  );

  /** "경로점 추가" — the primary insertion method, no click position required: inserts at the midpoint of the selected edge's longest current segment. */
  const handleAddWaypoint = useCallback(() => {
    if (!selectedEdgeId) return;
    const edge = template.edges.find((e) => e.id === selectedEdgeId);
    const source = edge ? workingLayoutPositions.get(edge.fromNodeId) : undefined;
    const target = edge ? workingLayoutPositions.get(edge.toNodeId) : undefined;
    if (!edge || !source || !target) return;
    setPendingEdgeRouteMoves((prev) => {
      const next = new Map(prev);
      next.set(selectedEdgeId, addWaypointAtDefaultPosition(currentWorkingRoutePoints(prev, selectedEdgeId), source, target));
      return next;
    });
  }, [selectedEdgeId, template.edges, workingLayoutPositions, savedEdgeRoutes]);

  /** "선택 경로점 삭제" (button and Delete/Backspace) — removing the last remaining point restores automatic routing, per removeWaypoint's own semantics. */
  const handleRemoveSelectedWaypoint = useCallback(() => {
    if (!selectedEdgeId || selectedWaypointIndex === null) return;
    setPendingEdgeRouteMoves((prev) => {
      const next = new Map(prev);
      next.set(selectedEdgeId, removeWaypoint(currentWorkingRoutePoints(prev, selectedEdgeId), selectedWaypointIndex));
      return next;
    });
    setSelectedWaypointIndex(null);
  }, [selectedEdgeId, selectedWaypointIndex, savedEdgeRoutes]);

  /** "자동 경로로 초기화" — explicit restore, discoverable beyond deleting every point one at a time. */
  const handleResetEdgeRoute = useCallback((edgeId: string) => {
    setPendingEdgeRouteMoves((prev) => {
      const next = new Map(prev);
      next.set(edgeId, null);
      return next;
    });
    setSelectedWaypointIndex(null);
  }, []);

  // Delete/Backspace removes the selected waypoint — only when a waypoint
  // is actually selected and focus isn't inside a text input/textarea/
  // select/contenteditable element (never hijack ordinary text editing
  // elsewhere in the editor, e.g. the property panels' own fields).
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key !== "Delete" && e.key !== "Backspace") return;
      if (!canEdit || !selectedEdgeId || selectedWaypointIndex === null) return;
      const active = document.activeElement;
      const tag = active?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || (active instanceof HTMLElement && active.isContentEditable)) return;
      e.preventDefault();
      handleRemoveSelectedWaypoint();
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [canEdit, selectedEdgeId, selectedWaypointIndex, handleRemoveSelectedWaypoint]);

  const selectedNode = selectedNodeId ? template.nodes.find((n) => n.id === selectedNodeId) ?? null : null;
  const selectedEdge = selectedEdgeId ? template.edges.find((e) => e.id === selectedEdgeId) ?? null : null;

  const SAVE_STATE_LABEL: Record<typeof saveState, string> = {
    SAVED: "저장됨",
    UNSAVED: "저장되지 않은 변경사항",
    SAVING: "저장 중...",
    SAVE_FAILED: "저장 실패",
  };
  const SAVE_STATE_CLASS: Record<typeof saveState, string> = {
    SAVED: "text-emerald-700 dark:text-emerald-400",
    UNSAVED: "text-amber-700 dark:text-amber-400",
    SAVING: "text-zinc-500 dark:text-zinc-400",
    SAVE_FAILED: "text-red-600 dark:text-red-400",
  };

  return (
    <div className="flex flex-col gap-4">
      {issueParam && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-xs dark:border-blue-900 dark:bg-blue-950">
          <p className="text-blue-800 dark:text-blue-300">
            검증 이슈에서 편집기로 이동했습니다.
            {!navigationTarget.nodeId && " 정확한 노드가 아직 연결되지 않았습니다. 후보 위치를 확인하세요."}
            {navigationTarget.nodeId && navigationTarget.isFallback && " 정확히 일치하는 노드가 없어 가장 가까운 연결된 노드로 이동했습니다."}
          </p>
          <Link href={`/procedures/${template.id}/validation/${issueParam}`} className="shrink-0 rounded-md border border-blue-300 px-2 py-1 font-medium text-blue-700 hover:bg-blue-100 dark:border-blue-800 dark:text-blue-300">
            ← 오류 상세로 돌아가기
          </Link>
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-zinc-200 bg-white p-3 dark:border-zinc-800 dark:bg-zinc-900">
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="font-semibold text-zinc-900 dark:text-zinc-50">{template.name}</span>
          <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-xs text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400">v{template.version}</span>
          <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-xs font-medium text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300">{procedureTemplateStatusLabels[template.status]}</span>
          {!canEdit && <span className="rounded-full bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-700 dark:bg-amber-950 dark:text-amber-400">읽기 전용 (SUPER_ADMIN만 편집 가능)</span>}
          <span className={`text-xs font-medium ${SAVE_STATE_CLASS[saveState]}`}>● {SAVE_STATE_LABEL[saveState]}</span>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {canEdit && (
            <>
              <button type="button" onClick={() => void handleSaveLayout()} disabled={!hasPendingLayoutChanges || isSavingLayout} className="rounded-md bg-zinc-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-zinc-800 disabled:opacity-50 dark:bg-zinc-50 dark:text-zinc-900">
                저장
              </button>
              <button type="button" onClick={handleDiscardLayout} disabled={!hasPendingLayoutChanges} className="rounded-md border border-zinc-300 px-3 py-1.5 text-xs text-zinc-700 hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-300">
                취소
              </button>
            </>
          )}
          <button type="button" onClick={() => void handleValidate()} disabled={isValidating} className="rounded-md border border-zinc-300 px-3 py-1.5 text-xs text-zinc-700 hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-300">
            {isValidating ? "검증 중..." : "검증"}
          </button>
          <button type="button" onClick={() => setRightPanelTab("compare")} disabled={!comparison} className="rounded-md border border-zinc-300 px-3 py-1.5 text-xs text-zinc-700 hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-300">
            부모 버전과 비교
          </button>
          <button type="button" onClick={handleExit} className="rounded-md border border-zinc-300 px-3 py-1.5 text-xs text-zinc-700 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300">
            편집기 나가기
          </button>
        </div>
      </div>
      {layoutErrorMessage && <p className="text-xs text-red-600 dark:text-red-400">{layoutErrorMessage}</p>}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1fr_320px]">
        <div className="flex flex-col gap-2">
          <ProcedureFlowGraph
            templateId={template.id}
            nodes={template.nodes}
            edges={template.edges}
            openIssuesByNodeId={openIssuesByNodeId}
            initialWorksheet={navigationTarget.worksheetFilter}
            initialSelectedNodeId={navigationTarget.nodeId}
            errorFocusMode={errorFocusMode}
            editable={canEdit}
            onNodeSelectionChange={handleNodeSelectionChange}
            onEdgeSelectionChange={handleEdgeSelectionChange}
            onNodeDragStop={handleNodeDragStop}
            selectedEdgeId={selectedEdgeId}
            edgeRoutesByEdgeId={workingEdgeRoutes}
            selectedWaypointIndex={selectedWaypointIndex}
            onWaypointSelectionChange={handleWaypointSelectionChange}
            onWaypointMove={handleWaypointMove}
            onEdgeDoubleClickInsert={handleWaypointInsertAt}
          />
          <ProcedureGraphLegend />
        </div>

        <div className="flex flex-col gap-3 rounded-lg border border-zinc-200 bg-white p-3 dark:border-zinc-800 dark:bg-zinc-900">
          <div className="flex flex-wrap gap-1 border-b border-zinc-200 pb-2 text-xs dark:border-zinc-800">
            {(["properties", "validation", "history", "createEdge"] as RightPanelTab[]).map((tab) => (
              <button
                key={tab}
                type="button"
                onClick={() => setRightPanelTab(tab)}
                className={`rounded-md px-2 py-1 ${rightPanelTab === tab ? "bg-zinc-900 text-white dark:bg-zinc-50 dark:text-zinc-900" : "text-zinc-600 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-800"}`}
              >
                {tab === "properties" ? "속성" : tab === "validation" ? "검증" : tab === "history" ? "이력" : "연결 추가"}
              </button>
            ))}
          </div>

          {rightPanelTab === "properties" && selectedNode && (
            <NodePropertyPanel key={selectedNode.id} node={selectedNode} canEdit={canEdit} expectedTemplateUpdatedAt={currentUpdatedAt} onSaved={handleSaved} />
          )}
          {rightPanelTab === "properties" && !selectedNode && selectedEdge && (
            <EdgePropertyPanel
              key={selectedEdge.id}
              edge={selectedEdge}
              nodes={template.nodes}
              canEdit={canEdit}
              expectedTemplateUpdatedAt={currentUpdatedAt}
              onSaved={handleSaved}
              routePoints={workingEdgeRoutes.get(selectedEdge.id) ?? null}
              selectedWaypointIndex={selectedWaypointIndex}
              onAddWaypoint={handleAddWaypoint}
              onRemoveSelectedWaypoint={handleRemoveSelectedWaypoint}
              onResetRoute={() => handleResetEdgeRoute(selectedEdge.id)}
            />
          )}
          {rightPanelTab === "properties" && !selectedNode && !selectedEdge && <p className="text-xs text-zinc-400 dark:text-zinc-600">그래프에서 노드나 분기를 선택하세요.</p>}

          {rightPanelTab === "createEdge" && (
            <CreateEdgePanel key={selectedNodeId ?? "none"} templateId={template.id} nodes={template.nodes} canEdit={canEdit} expectedTemplateUpdatedAt={currentUpdatedAt} prefillFromNodeId={selectedNodeId} onSaved={handleSaved} />
          )}

          {rightPanelTab === "validation" && (
            <div className="flex flex-col gap-3 text-xs">
              <div>
                <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">가져오기 시점 검증 이슈 (미해결)</h3>
                {template.unresolvedIssues.length === 0 ? (
                  <p className="mt-1 text-zinc-400 dark:text-zinc-600">없음</p>
                ) : (
                  <ul className="mt-1 flex flex-col gap-1">
                    {template.unresolvedIssues.map((i) => (
                      <li key={i.id} className="rounded border border-zinc-100 p-1.5 dark:border-zinc-800">
                        <span className={i.severity === "ERROR" ? "font-medium text-red-600 dark:text-red-400" : "font-medium text-amber-600 dark:text-amber-400"}>
                          {procedureValidationSeverityLabels[i.severity]}
                        </span>{" "}
                        {procedureValidationIssueTypeLabels[i.issueType] ?? i.issueType}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
              <div>
                <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">구조 검증 결과 {lastStructuralValidation ? "" : "(아직 실행하지 않음 — 검증 버튼을 눌러 실행)"}</h3>
                {lastStructuralValidation && (
                  <>
                    <p className="mt-1">
                      오류 <span className="font-semibold text-red-600 dark:text-red-400">{lastStructuralValidation.errorCount}</span>건 · 경고{" "}
                      <span className="font-semibold text-amber-600 dark:text-amber-400">{lastStructuralValidation.warningCount}</span>건
                    </p>
                    {lastStructuralValidation.errorCount > 0 && <p className="mt-1 text-red-600 dark:text-red-400">오류가 있으면 이 초안을 게시할 수 없습니다.</p>}
                    <ul className="mt-1 flex flex-col gap-1">
                      {lastStructuralValidation.issues.map((issue, idx) => (
                        <li key={idx} className="rounded border border-zinc-100 p-1.5 dark:border-zinc-800">
                          <span className={issue.severity === "ERROR" ? "font-medium text-red-600 dark:text-red-400" : "font-medium text-amber-600 dark:text-amber-400"}>
                            {procedureValidationSeverityLabels[issue.severity]}
                          </span>{" "}
                          {issue.message}
                        </li>
                      ))}
                    </ul>
                  </>
                )}
              </div>
            </div>
          )}

          {rightPanelTab === "history" && (
            <ol className="flex flex-col gap-2 text-xs">
              {editHistory.length === 0 ? (
                <p className="text-zinc-400 dark:text-zinc-600">아직 편집 이력이 없습니다.</p>
              ) : (
                editHistory.map((row) => (
                  <li key={row.id} className="rounded border border-zinc-100 p-2 dark:border-zinc-800">
                    <div className="flex items-center justify-between">
                      <span className="font-medium text-zinc-900 dark:text-zinc-50">{row.actionType}</span>
                      <span className="text-zinc-400 dark:text-zinc-600">{row.actorName}</span>
                    </div>
                    <p className="text-zinc-400 dark:text-zinc-600">{new Date(row.createdAt).toLocaleString("ko-KR")}</p>
                    {row.reason && <p className="mt-1 whitespace-pre-wrap">사유: {row.reason}</p>}
                  </li>
                ))
              )}
            </ol>
          )}

          {rightPanelTab === "compare" && comparison && comparison.ok && (
            <div className="flex flex-col gap-3 text-xs">
              <p className="text-zinc-500 dark:text-zinc-400">
                부모 버전 v{comparison.parentVersion}과 비교 — 오류/경고 차이: {comparison.draftUnresolvedCount.errorCount - comparison.parentUnresolvedCount.errorCount >= 0 ? "+" : ""}
                {comparison.draftUnresolvedCount.errorCount - comparison.parentUnresolvedCount.errorCount} / {comparison.draftUnresolvedCount.warningCount - comparison.parentUnresolvedCount.warningCount >= 0 ? "+" : ""}
                {comparison.draftUnresolvedCount.warningCount - comparison.parentUnresolvedCount.warningCount}
              </p>
              <CompareSection title={`변경된 노드 (${comparison.comparison.changedNodes.length})`}>
                {comparison.comparison.changedNodes.map((n) => (
                  <li key={n.nodeCode}>
                    {n.nodeCode}: {n.changes.map((c) => c.field).join(", ")}
                  </li>
                ))}
              </CompareSection>
              <CompareSection title={`이동한 노드 (${comparison.comparison.movedNodes.length})`}>
                {comparison.comparison.movedNodes.map((n) => (
                  <li key={n.nodeCode}>
                    {n.nodeCode}: ({n.before.x}, {n.before.y}) → ({n.after.x}, {n.after.y})
                  </li>
                ))}
              </CompareSection>
              <CompareSection title={`노드 유형 변경 (${comparison.comparison.changedNodeTypes.length})`}>
                {comparison.comparison.changedNodeTypes.map((n) => (
                  <li key={n.nodeCode}>
                    {n.nodeCode}: {procedureNodeTypeLabels[n.before]} → {procedureNodeTypeLabels[n.after]}
                  </li>
                ))}
              </CompareSection>
              <CompareSection title={`분기 대상 변경 (${comparison.comparison.retargetedEdges.length})`}>
                {comparison.comparison.retargetedEdges.map((e) => (
                  <li key={e.draftEdgeId}>
                    {e.before.fromNodeCode}→{e.before.toNodeCode} ⇒ {e.after.fromNodeCode}→{e.after.toNodeCode}
                  </li>
                ))}
              </CompareSection>
              <CompareSection title={`분기 속성 변경 (${comparison.comparison.changedEdges.length})`}>
                {comparison.comparison.changedEdges.map((e) => (
                  <li key={e.draftEdgeId}>
                    {e.fromNodeCode}→{e.toNodeCode}: {procedureBranchTypeLabels[e.before.branchType]} → {procedureBranchTypeLabels[e.after.branchType]}
                  </li>
                ))}
              </CompareSection>
              <CompareSection title={`새로 추가된 연결 (${comparison.comparison.newlyAddedEdges.length})`}>
                {comparison.comparison.newlyAddedEdges.map((e) => (
                  <li key={e.draftEdgeId}>
                    {e.fromNodeCode}→{e.toNodeCode} ({procedureBranchTypeLabels[e.branchType]})
                  </li>
                ))}
              </CompareSection>
              <CompareSection title={`연결선 경로 수동 조정 (${comparison.comparison.routeChangedEdges.length})`}>
                {comparison.comparison.routeChangedEdges.map((e) => (
                  <li key={e.draftEdgeId}>
                    {e.fromNodeCode}→{e.toNodeCode}: {e.before.isManual ? `수동 (경로점 ${e.before.pointCount}개)` : "자동"} → {e.after.isManual ? `수동 (경로점 ${e.after.pointCount}개)` : "자동"}
                  </li>
                ))}
              </CompareSection>
            </div>
          )}
          {rightPanelTab === "compare" && comparison && !comparison.ok && <p className="text-xs text-zinc-400 dark:text-zinc-600">비교할 부모 버전이 없습니다 (이 템플릿의 첫 버전).</p>}
        </div>
      </div>
    </div>
  );
}

function CompareSection({ title, children }: { title: string; children: React.ReactNode }) {
  const items = Array.isArray(children) ? children : [children];
  const hasItems = items.some((c) => c !== null && c !== undefined && c !== false);
  return (
    <div>
      <h4 className="font-semibold text-zinc-700 dark:text-zinc-300">{title}</h4>
      {hasItems ? <ul className="mt-1 flex flex-col gap-0.5">{children}</ul> : <p className="text-zinc-400 dark:text-zinc-600">없음</p>}
    </div>
  );
}
