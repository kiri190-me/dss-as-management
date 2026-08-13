"use client";

import { useState } from "react";
import { REPAIR_CASE_FLOWCHART_BRANCH_TYPE_CODES, repairCaseFlowchartBranchTypeLabels, type RepairCaseFlowchartBranchType } from "@/lib/domain/repair-case-flowchart-types";
import { createRepairCaseFlowchartEdgeAction } from "@/lib/server/actions/repair-case-flowchart-graph";
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
  onSaved,
}: {
  repairCaseId: string;
  flowchartId: string;
  nodes: CaseFlowchartGraphNode[];
  canEdit: boolean;
  expectedFlowchartUpdatedAt: string;
  prefillFromNodeId?: string | null;
  onSaved: (newUpdatedAt: string) => void;
}) {
  // Adjust-state-during-render (same convention as
  // CaseFlowchartEditorScreen's own currentUpdatedAt/prevFlowchartUpdatedAt
  // pair) — auto-resyncs fromNodeId to the graph's currently-selected node
  // whenever prefillFromNodeId changes, EXCEPT once the user has manually
  // picked a different FROM node in this open form themselves
  // (userTouchedFrom): a later selection change elsewhere in the graph
  // must never silently overwrite a choice the user already made. Resets
  // on a successful create (the form is conceptually closed/reset), so the
  // next open form prefills fresh again.
  const [prevPrefillFromNodeId, setPrevPrefillFromNodeId] = useState(prefillFromNodeId ?? null);
  const [userTouchedFrom, setUserTouchedFrom] = useState(false);
  const [fromNodeId, setFromNodeId] = useState(prefillFromNodeId ?? nodes[0]?.id ?? "");
  if ((prefillFromNodeId ?? null) !== prevPrefillFromNodeId) {
    setPrevPrefillFromNodeId(prefillFromNodeId ?? null);
    if (!userTouchedFrom) {
      setFromNodeId(prefillFromNodeId ?? nodes[0]?.id ?? "");
    }
  }
  const [toNodeId, setToNodeId] = useState("");
  const [branchType, setBranchType] = useState<RepairCaseFlowchartBranchType>("DEFAULT");
  const [branchLabel, setBranchLabel] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

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
    setUserTouchedFrom(false);
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
          onChange={(e) => {
            setFromNodeId(e.target.value);
            setUserTouchedFrom(true);
          }}
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
      <label className="flex flex-col gap-1">
        대상 노드
        <select value={toNodeId} onChange={(e) => setToNodeId(e.target.value)} className="rounded-md border border-zinc-200 bg-white px-2 py-1.5 text-sm dark:border-zinc-700 dark:bg-zinc-900">
          <option value="">노드를 선택하세요</option>
          {nodes.map((n) => (
            <option key={n.id} value={n.id}>
              {n.title}
            </option>
          ))}
        </select>
      </label>
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
