"use client";

import { useState } from "react";
import {
  REPAIR_CASE_FLOWCHART_BRANCH_TYPE_CODES,
  repairCaseFlowchartBranchTypeLabels,
  REPAIR_CASE_FLOWCHART_NODE_TYPE_CODES,
  repairCaseFlowchartNodeTypeLabels,
  type RepairCaseFlowchartBranchType,
  type RepairCaseFlowchartNodeType,
} from "@/lib/domain/repair-case-flowchart-types";
import { deleteRepairCaseFlowchartEdgeAction, insertRepairCaseFlowchartNodeOnEdgeAction } from "@/lib/server/actions/repair-case-flowchart-graph";
import { routePointsEqual, type RoutePoint } from "@/lib/graph-editor-core/routing";
import type { CaseFlowchartGraphNode, CaseFlowchartGraphEdge } from "./CaseFlowchartGraph";

export type CaseFlowchartEdgeDraft = { branchType: RepairCaseFlowchartBranchType; branchLabel: string; fromNodeId: string; toNodeId: string };

/**
 * Case-flowchart edge property panel (5C-6D follow-up: converted to a
 * fully CONTROLLED component). Branch type/label and the retarget from/to
 * selects no longer own local state or a local save/apply button — they
 * read/write `draft` (lifted to CaseFlowchartEditorScreen, keyed per-edge)
 * and persist ONLY through the screen's global [저장] button, exactly like
 * CaseFlowchartNodePropertyPanel. The route's own former "경로 저장" button
 * is gone too — the global button is now the SOLE save action for every
 * form/property/route field in this editor; see
 * CaseFlowchartEditorScreen's own doc comment for the full save contract.
 * No mandatory reason, no confirmation dialog for retarget (unlike the
 * procedure editor's EdgePropertyPanel) — a case flowchart is a working
 * diagnostic document, not a published organizational asset.
 *
 * Waypoint add/move/remove/reset still only ever mutate the screen's
 * client-only pending route state via the passed callbacks — unchanged.
 * Delete and node-on-edge insertion remain their own immediate, dedicated
 * actions (destructive / structural-creation, not a "draft").
 */
export default function CaseFlowchartEdgePropertyPanel({
  edge,
  nodes,
  repairCaseId,
  flowchartId,
  canEdit,
  expectedFlowchartUpdatedAt,
  draft,
  onDraftChange,
  onSaved,
  onDeleted,
  routePoints,
  selectedWaypointIndex,
  onAddWaypoint,
  onRemoveSelectedWaypoint,
  onResetRoute,
}: {
  edge: CaseFlowchartGraphEdge;
  nodes: CaseFlowchartGraphNode[];
  repairCaseId: string;
  flowchartId: string;
  canEdit: boolean;
  expectedFlowchartUpdatedAt: string;
  draft: CaseFlowchartEdgeDraft;
  onDraftChange: (patch: Partial<CaseFlowchartEdgeDraft>) => void;
  onSaved: (newUpdatedAt: string) => void;
  onDeleted: (newUpdatedAt: string) => void;
  routePoints: RoutePoint[] | null;
  selectedWaypointIndex: number | null;
  onAddWaypoint: () => void;
  onRemoveSelectedWaypoint: () => void;
  onResetRoute: () => void;
}) {
  const nodesById = new Map(nodes.map((n) => [n.id, n]));
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const [isDeleting, setIsDeleting] = useState(false);

  const [showInsertNodeForm, setShowInsertNodeForm] = useState(false);
  const [insertNodeType, setInsertNodeType] = useState<RepairCaseFlowchartNodeType>("TASK");
  const [insertNodeTitle, setInsertNodeTitle] = useState("");
  const [isInsertingNode, setIsInsertingNode] = useState(false);

  const labelRequired = draft.branchType === "CUSTOM" && draft.branchLabel.trim().length === 0;

  async function handleDelete() {
    setIsDeleting(true);
    setErrorMessage(null);
    const result = await deleteRepairCaseFlowchartEdgeAction({ repairCaseId, flowchartId, edgeId: edge.id, expectedFlowchartUpdatedAt });
    setIsDeleting(false);
    if (!result.ok) {
      setErrorMessage(result.message);
      return;
    }
    onDeleted(result.updatedAt);
  }

  async function handleInsertNodeAtWaypoint() {
    if (selectedWaypointIndex === null || !routePoints) return;
    const point = routePoints[selectedWaypointIndex];
    if (!point) return;
    setIsInsertingNode(true);
    setErrorMessage(null);
    const result = await insertRepairCaseFlowchartNodeOnEdgeAction({
      repairCaseId,
      flowchartId,
      edgeId: edge.id,
      nodeType: insertNodeType,
      title: insertNodeTitle,
      position: point,
      expectedFlowchartUpdatedAt,
    });
    setIsInsertingNode(false);
    if (!result.ok) {
      setErrorMessage(result.message);
      return;
    }
    setShowInsertNodeForm(false);
    setInsertNodeTitle("");
    onSaved(result.updatedAt);
  }

  return (
    <div className="flex flex-col gap-4 text-xs">
      <div>
        <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">분기 속성</h3>
        <p className="mt-0.5 text-zinc-500 dark:text-zinc-400">
          {nodesById.get(edge.fromNodeId)?.title ?? edge.fromNodeId} → {nodesById.get(edge.toNodeId)?.title ?? edge.toNodeId}
        </p>
        {canEdit && <p className="mt-1 text-zinc-500 dark:text-zinc-400">분기 유형/라벨/대상 변경은 화면 상단의 [저장] 버튼으로 함께 저장됩니다.</p>}
      </div>

      <label className="flex flex-col gap-1">
        분기 유형
        <select value={draft.branchType} onChange={(e) => onDraftChange({ branchType: e.target.value as RepairCaseFlowchartBranchType })} disabled={!canEdit} className="rounded-md border border-zinc-200 bg-white px-2 py-1.5 text-sm disabled:opacity-60 dark:border-zinc-700 dark:bg-zinc-900">
          {REPAIR_CASE_FLOWCHART_BRANCH_TYPE_CODES.map((bt) => (
            <option key={bt} value={bt}>
              {repairCaseFlowchartBranchTypeLabels[bt]}
            </option>
          ))}
        </select>
      </label>
      <label className="flex flex-col gap-1">
        분기 라벨 {draft.branchType === "CUSTOM" ? "(필수)" : "(선택)"}
        <input value={draft.branchLabel} onChange={(e) => onDraftChange({ branchLabel: e.target.value })} disabled={!canEdit} className="rounded-md border border-zinc-200 bg-white px-2 py-1.5 text-sm disabled:opacity-60 dark:border-zinc-700 dark:bg-zinc-900" />
      </label>
      {labelRequired && <p className="text-red-600 dark:text-red-400">사용자 정의(CUSTOM) 분기에는 라벨이 필요합니다.</p>}

      <div className="flex flex-col gap-2 rounded-md border border-zinc-200 bg-zinc-50 p-3 dark:border-zinc-800 dark:bg-zinc-900">
        <h4 className="text-xs font-semibold text-zinc-700 dark:text-zinc-300">연결선 경로</h4>
        <p className="text-zinc-500 dark:text-zinc-400">{routePoints && routePoints.length > 0 ? `수동 경로 — 경로점 ${routePoints.length}개` : "자동 경로 (계산된 경로 사용 중)"}</p>
        {canEdit && (
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={onAddWaypoint} className="rounded-md border border-zinc-300 px-2.5 py-1 text-xs text-zinc-700 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800">
              경로점 추가
            </button>
            <button
              type="button"
              onClick={onRemoveSelectedWaypoint}
              disabled={selectedWaypointIndex === null}
              className="rounded-md border border-zinc-300 px-2.5 py-1 text-xs text-zinc-700 hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
            >
              선택 경로점 삭제
            </button>
            <button
              type="button"
              onClick={onResetRoute}
              disabled={!routePoints || routePoints.length === 0}
              className="rounded-md border border-zinc-300 px-2.5 py-1 text-xs text-zinc-700 hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
            >
              자동 경로로 초기화
            </button>
            <button
              type="button"
              onClick={() => setShowInsertNodeForm((v) => !v)}
              disabled={selectedWaypointIndex === null}
              className="rounded-md border border-blue-400 px-2.5 py-1 text-xs text-blue-900 hover:bg-blue-100 disabled:opacity-50 dark:border-blue-700 dark:text-blue-300 dark:hover:bg-blue-900"
            >
              이 위치에 노드 추가
            </button>
          </div>
        )}
        {canEdit && showInsertNodeForm && selectedWaypointIndex !== null && (
          <div className="flex flex-col gap-2 rounded-md border border-blue-200 bg-blue-50 p-2 dark:border-blue-900 dark:bg-blue-950">
            <p className="text-blue-800 dark:text-blue-300">
              선택된 경로점 위치에 새 노드를 삽입하고, 이 분기를 두 개로 나눕니다. 원래 분기 유형/라벨은 첫 번째 구간에 그대로 유지되고, 두 번째 구간은 기본(정상 진행) 연결이 됩니다.
            </p>
            <label className="flex flex-col gap-1">
              노드 유형
              <select value={insertNodeType} onChange={(e) => setInsertNodeType(e.target.value as RepairCaseFlowchartNodeType)} className="rounded-md border border-zinc-200 bg-white px-2 py-1.5 text-sm dark:border-zinc-700 dark:bg-zinc-900">
                {REPAIR_CASE_FLOWCHART_NODE_TYPE_CODES.map((t) => (
                  <option key={t} value={t}>
                    {repairCaseFlowchartNodeTypeLabels[t]}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1">
              제목 (필수)
              <input value={insertNodeTitle} onChange={(e) => setInsertNodeTitle(e.target.value)} className="rounded-md border border-zinc-200 bg-white px-2 py-1.5 text-sm dark:border-zinc-700 dark:bg-zinc-900" />
            </label>
            <div className="flex gap-2">
              <button
                type="button"
                disabled={insertNodeTitle.trim().length === 0 || isInsertingNode}
                onClick={() => void handleInsertNodeAtWaypoint()}
                className="self-start rounded-md bg-blue-700 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-800 disabled:opacity-50"
              >
                {isInsertingNode ? "추가 중..." : "노드 삽입"}
              </button>
              <button type="button" onClick={() => setShowInsertNodeForm(false)} disabled={isInsertingNode} className="rounded-md border border-zinc-300 px-3 py-1.5 text-sm text-zinc-700 hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-300">
                취소
              </button>
            </div>
          </div>
        )}
        {routePoints && routePoints.length > 0 && (
          <details className="text-[11px] text-zinc-500 dark:text-zinc-400">
            <summary className="cursor-pointer select-none">기술 정보 (경로점 좌표)</summary>
            <ul className="mt-1 flex flex-col gap-0.5 font-mono">
              {routePoints.map((p, i) => (
                <li key={i} className={i === selectedWaypointIndex ? "font-semibold text-blue-700 dark:text-blue-400" : ""}>
                  #{i + 1}: ({Math.round(p.x)}, {Math.round(p.y)})
                </li>
              ))}
            </ul>
          </details>
        )}
      </div>

      {canEdit && (
        <div className="flex flex-col gap-2 rounded-md border border-blue-200 bg-blue-50 p-3 dark:border-blue-900 dark:bg-blue-950">
          <h4 className="text-xs font-semibold text-blue-900 dark:text-blue-300">분기 대상 변경</h4>
          <label className="flex flex-col gap-1">
            시작 노드
            <select value={draft.fromNodeId} onChange={(e) => onDraftChange({ fromNodeId: e.target.value })} className="rounded-md border border-zinc-200 bg-white px-2 py-1.5 text-sm dark:border-zinc-700 dark:bg-zinc-900">
              {nodes.map((n) => (
                <option key={n.id} value={n.id}>
                  {n.title}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1">
            대상 노드
            <select value={draft.toNodeId} onChange={(e) => onDraftChange({ toNodeId: e.target.value })} className="rounded-md border border-zinc-200 bg-white px-2 py-1.5 text-sm dark:border-zinc-700 dark:bg-zinc-900">
              {nodes.map((n) => (
                <option key={n.id} value={n.id}>
                  {n.title}
                </option>
              ))}
            </select>
          </label>
          {draft.fromNodeId === draft.toNodeId && <p className="text-red-600 dark:text-red-400">자기 자신으로의 분기는 지원하지 않습니다.</p>}
        </div>
      )}

      {canEdit && (
        <div className="flex flex-col gap-2 rounded-md border border-red-200 bg-red-50 p-3 dark:border-red-900 dark:bg-red-950">
          <h4 className="text-xs font-semibold text-red-900 dark:text-red-300">분기 삭제</h4>
          <button
            type="button"
            disabled={isDeleting}
            onClick={() => void handleDelete()}
            className="self-start rounded-md border border-red-400 px-3 py-1.5 text-sm font-medium text-red-900 hover:bg-red-100 disabled:opacity-50 dark:border-red-700 dark:text-red-300 dark:hover:bg-red-900"
          >
            {isDeleting ? "삭제 중..." : "분기 삭제"}
          </button>
        </div>
      )}

      {errorMessage && <p className="text-red-600 dark:text-red-400">{errorMessage}</p>}
    </div>
  );
}

/** Exported for reuse by CaseFlowchartEditorScreen — compares the merged working route against the edge's own last-saved value to decide whether it should count as "pending" for the global [저장] button. */
export function hasUnsavedRouteChanges(working: RoutePoint[] | null, saved: RoutePoint[] | null): boolean {
  return !routePointsEqual(working, saved);
}
