"use client";

import { useState } from "react";
import { REPAIR_CASE_FLOWCHART_BRANCH_TYPE_CODES, repairCaseFlowchartBranchTypeLabels, type RepairCaseFlowchartBranchType } from "@/lib/domain/repair-case-flowchart-types";
import { createRepairCaseFlowchartEdgeAction } from "@/lib/server/actions/repair-case-flowchart-graph";
import { pickDefaultTargetNodeId } from "@/lib/graph-editor-core/edge-default-target";
import type { CaseFlowchartGraphNode } from "./CaseFlowchartGraph";

/**
 * Case-flowchart edge creation (Phase 5C-6D). Links two existing nodes
 * only (no node creation here — see CaseFlowchartEdgePropertyPanel's "이
 * 위치에 노드 추가" for the node-on-edge-insertion path). No mandatory
 * reason, no review/confirm dialog — unlike the procedure editor's
 * CreateEdgePanel (built for FULL_SERVICE's reasoned-review requirement),
 * a case flowchart is a working diagnostic document, not a published
 * organizational asset, so a direct submit is appropriate.
 */
export default function CaseFlowchartCreateEdgePanel({
  repairCaseId,
  flowchartId,
  nodes,
  canEdit,
  expectedFlowchartUpdatedAt,
  prefillFromNodeId,
  isPickingTarget = false,
  onStartPickTarget,
  onCancelPickTarget,
  pickedTarget = null,
  onSaved,
}: {
  repairCaseId: string;
  flowchartId: string;
  nodes: CaseFlowchartGraphNode[];
  canEdit: boolean;
  expectedFlowchartUpdatedAt: string;
  prefillFromNodeId?: string | null;
  /** "화면에서 선택" — CreateEdgePanel과 같은 규칙이다(모드는 화면이 소유하고, 캔버스 클릭 결과만 seq와 함께 내려온다). */
  isPickingTarget?: boolean;
  onStartPickTarget?: () => void;
  onCancelPickTarget?: () => void;
  pickedTarget?: { nodeId: string; seq: number } | null;
  onSaved: (newUpdatedAt: string) => void;
}) {
  // Adjust-state-during-render (same convention as
  // CaseFlowchartEditorScreen's own currentUpdatedAt/prevFlowchartUpdatedAt
  // pair) — whenever prefillFromNodeId changes (the graph's selected node
  // changed), the whole form resets rather than just resyncing FROM: an
  // in-progress draft (TO/branch type/branch label) for one FROM node isn't
  // meaningful once the selection points at a different one.
  // nodes prop은 서버 쿼리가 createdAt 오름차순으로 돌려준다(오래된 것 →
  // 최근 것) — 마지막 원소가 가장 최근에 추가한 노드다.
  const mostRecentNodeId = nodes[nodes.length - 1]?.id ?? null;
  const initialFromNodeId = prefillFromNodeId ?? nodes[0]?.id ?? "";
  const [prevPrefillFromNodeId, setPrevPrefillFromNodeId] = useState(prefillFromNodeId ?? null);
  const [fromNodeId, setFromNodeId] = useState(initialFromNodeId);
  const [toNodeId, setToNodeId] = useState(() => pickDefaultTargetNodeId(nodes, initialFromNodeId));
  const [branchType, setBranchType] = useState<RepairCaseFlowchartBranchType>("DEFAULT");
  const [branchLabel, setBranchLabel] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [prevMostRecentNodeId, setPrevMostRecentNodeId] = useState(mostRecentNodeId);
  const [prevPickedSeq, setPrevPickedSeq] = useState(pickedTarget?.seq ?? 0);
  if (pickedTarget && pickedTarget.seq !== prevPickedSeq) {
    // 캔버스에서 고른 노드는 대상 노드만 바꾼다(CreateEdgePanel과 같은 규칙).
    setPrevPickedSeq(pickedTarget.seq);
    setToNodeId(pickedTarget.nodeId);
  } else if ((prefillFromNodeId ?? null) !== prevPrefillFromNodeId) {
    const nextFromNodeId = prefillFromNodeId ?? nodes[0]?.id ?? "";
    setPrevPrefillFromNodeId(prefillFromNodeId ?? null);
    setFromNodeId(nextFromNodeId);
    setToNodeId(pickDefaultTargetNodeId(nodes, nextFromNodeId));
    setBranchType("DEFAULT");
    setBranchLabel("");
    setErrorMessage(null);
  } else if (mostRecentNodeId !== prevMostRecentNodeId) {
    // 노드를 새로 추가하면 대상 노드만 그 노드로 다시 맞춘다(작성 중이던
    // 분기 유형/라벨은 그대로 둔다) — CreateEdgePanel과 같은 규칙.
    setPrevMostRecentNodeId(mostRecentNodeId);
    setToNodeId(pickDefaultTargetNodeId(nodes, fromNodeId));
  }

  const labelRequired = branchType === "CUSTOM" && branchLabel.trim().length === 0;
  const isSelfEdge = fromNodeId.length > 0 && fromNodeId === toNodeId;
  const canSubmit = fromNodeId.length > 0 && toNodeId.length > 0 && !isSelfEdge && !labelRequired;

  async function handleCreate() {
    setIsSubmitting(true);
    setErrorMessage(null);
    const result = await createRepairCaseFlowchartEdgeAction({
      repairCaseId,
      flowchartId,
      fromNodeId,
      toNodeId,
      branchType,
      branchLabel: branchLabel.trim() || null,
      expectedFlowchartUpdatedAt,
    });
    setIsSubmitting(false);
    if (!result.ok) {
      setErrorMessage(result.message);
      return;
    }
    setToNodeId("");
    onSaved(result.updatedAt);
  }

  if (!canEdit) return null;

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-xs dark:border-emerald-900 dark:bg-emerald-950">
      <h3 className="text-sm font-semibold text-emerald-900 dark:text-emerald-300">새 연결 추가</h3>
      <label className="flex flex-col gap-1">
        시작 노드
        <select
          value={fromNodeId}
          onChange={(e) => setFromNodeId(e.target.value)}
          className="rounded-md border border-zinc-200 bg-white px-2 py-1.5 text-sm dark:border-zinc-700 dark:bg-zinc-900"
        >
          <option value="">노드를 선택하세요</option>
          {nodes.map((n) => (
            <option key={n.id} value={n.id}>
              {n.title}
            </option>
          ))}
        </select>
      </label>
      <div className="flex flex-col gap-1">
        <label htmlFor="case-create-edge-to-node">대상 노드</label>
        <div className="flex items-center gap-2">
          <select
            id="case-create-edge-to-node"
            value={toNodeId}
            onChange={(e) => setToNodeId(e.target.value)}
            className="min-w-0 flex-1 rounded-md border border-zinc-200 bg-white px-2 py-1.5 text-sm dark:border-zinc-700 dark:bg-zinc-900"
          >
            <option value="">노드를 선택하세요</option>
            {nodes.map((n) => (
              <option key={n.id} value={n.id}>
                {n.title}
              </option>
            ))}
          </select>
          {(onStartPickTarget || onCancelPickTarget) && (
            <button
              type="button"
              onClick={() => (isPickingTarget ? onCancelPickTarget?.() : onStartPickTarget?.())}
              aria-pressed={isPickingTarget}
              className={`shrink-0 rounded-md border px-2 py-1.5 text-xs ${
                isPickingTarget
                  ? "border-emerald-700 bg-emerald-700 text-white"
                  : "border-zinc-300 text-zinc-700 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
              }`}
            >
              {isPickingTarget ? "선택 취소" : "화면에서 선택"}
            </button>
          )}
        </div>
        {isPickingTarget && <p className="text-emerald-800 dark:text-emerald-300">그래프에서 대상 노드를 클릭하세요.</p>}
      </div>
      <label className="flex flex-col gap-1">
        분기 유형
        <select value={branchType} onChange={(e) => setBranchType(e.target.value as RepairCaseFlowchartBranchType)} className="rounded-md border border-zinc-200 bg-white px-2 py-1.5 text-sm dark:border-zinc-700 dark:bg-zinc-900">
          {REPAIR_CASE_FLOWCHART_BRANCH_TYPE_CODES.map((bt) => (
            <option key={bt} value={bt}>
              {repairCaseFlowchartBranchTypeLabels[bt]}
            </option>
          ))}
        </select>
      </label>
      <label className="flex flex-col gap-1">
        분기 라벨 {branchType === "CUSTOM" ? "(필수)" : "(선택)"}
        <input value={branchLabel} onChange={(e) => setBranchLabel(e.target.value)} className="rounded-md border border-zinc-200 bg-white px-2 py-1.5 text-sm dark:border-zinc-700 dark:bg-zinc-900" />
      </label>
      {isSelfEdge && <p className="text-red-600 dark:text-red-400">자기 자신으로의 분기는 지원하지 않습니다.</p>}
      <button
        type="button"
        disabled={!canSubmit || isSubmitting}
        onClick={() => void handleCreate()}
        className="self-start rounded-md bg-emerald-700 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-800 disabled:opacity-50"
      >
        {isSubmitting ? "추가 중..." : "연결 추가"}
      </button>
      {errorMessage && <p className="text-red-600 dark:text-red-400">{errorMessage}</p>}
    </div>
  );
}
