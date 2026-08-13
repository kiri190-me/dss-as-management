"use client";

import { useState } from "react";
import { REPAIR_CASE_FLOWCHART_NODE_TYPE_CODES, repairCaseFlowchartNodeTypeLabels, type RepairCaseFlowchartNodeType } from "@/lib/domain/repair-case-flowchart-types";
import { createRepairCaseFlowchartNodeAction } from "@/lib/server/actions/repair-case-flowchart-graph";
import { computeRelativePosition } from "@/lib/graph-editor-core/layout";
import { NODE_VISUAL_CONFIG, getNodeChipVisual, computeNodeDimensions } from "@/lib/domain/procedure-visual-language";
import type { CaseFlowchartGraphNode } from "./CaseFlowchartGraph";

/** Same vertical/horizontal spacing convention as the procedure editor's "새 노드를 선택된 노드 아래에 추가" (CreateNodePanel.tsx) — vertical also matches the server mutation's own default node-stacking gap. */
const BELOW_SELECTED_SPACING = { horizontal: 280, vertical: 150 } as const;

/**
 * Phase 5C-6D — case-flowchart node creation. No client-supplied ownership
 * ids beyond repairCaseId/flowchartId (server generates the node id); no
 * reason field (case-flowchart mutations never require one). When a node
 * is selected in the graph at the time of creation, the new node is placed
 * directly below it, center-aligned — reusing computeRelativePosition, the
 * same width-aware helper the procedure editor's CreateNodePanel uses, but
 * WITHOUT resolveEffectiveNodePosition: a case node has only one
 * positionX/positionY pair (no SOURCE/USER override distinction to
 * resolve), so the selected node's stored position is used directly. With
 * no selection, position is omitted and the mutation falls back to its own
 * default vertical stack. This never auto-creates an edge.
 */
export default function CaseFlowchartCreateNodePanel({
  repairCaseId,
  flowchartId,
  expectedFlowchartUpdatedAt,
  onSaved,
  selectedNode,
}: {
  repairCaseId: string;
  flowchartId: string;
  expectedFlowchartUpdatedAt: string;
  onSaved: (newUpdatedAt: string) => void;
  selectedNode: CaseFlowchartGraphNode | null;
}) {
  const [nodeType, setNodeType] = useState<RepairCaseFlowchartNodeType>("TASK");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  async function handleCreate() {
    setIsSubmitting(true);
    setErrorMessage(null);
    const position = selectedNode
      ? computeRelativePosition(
          {
            x: selectedNode.positionX,
            y: selectedNode.positionY,
            width: computeNodeDimensions({ title: selectedNode.title, shape: NODE_VISUAL_CONFIG[getNodeChipVisual(selectedNode.nodeType).semanticType].shape }).width,
          },
          "DOWN",
          BELOW_SELECTED_SPACING,
          computeNodeDimensions({ title, shape: NODE_VISUAL_CONFIG[getNodeChipVisual(nodeType).semanticType].shape }).width
        )
      : null;
    const result = await createRepairCaseFlowchartNodeAction({
      repairCaseId,
      flowchartId,
      nodeType,
      title,
      description: description.trim() || null,
      position,
      expectedFlowchartUpdatedAt,
    });
    setIsSubmitting(false);
    if (!result.ok) {
      setErrorMessage(result.message);
      return;
    }
    setTitle("");
    setDescription("");
    onSaved(result.updatedAt);
  }

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-blue-200 bg-blue-50 p-3 text-xs dark:border-blue-900 dark:bg-blue-950">
      <h3 className="text-sm font-semibold text-blue-900 dark:text-blue-300">새 노드 추가</h3>
      {selectedNode && (
        <p className="text-blue-700 dark:text-blue-400">&quot;{selectedNode.title}&quot; 바로 아래, 가운데 정렬된 위치에 추가됩니다.</p>
      )}
      <label className="flex flex-col gap-1">
        노드 유형
        <select value={nodeType} onChange={(e) => setNodeType(e.target.value as RepairCaseFlowchartNodeType)} className="rounded-md border border-zinc-200 bg-white px-2 py-1.5 text-sm dark:border-zinc-700 dark:bg-zinc-900">
          {REPAIR_CASE_FLOWCHART_NODE_TYPE_CODES.map((t) => (
            <option key={t} value={t}>
              {repairCaseFlowchartNodeTypeLabels[t]}
            </option>
          ))}
        </select>
      </label>
      <label className="flex flex-col gap-1">
        제목 (필수, Shift+Enter로 줄바꿈)
        <textarea
          rows={2}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) e.preventDefault();
          }}
          className="resize-y rounded-md border border-zinc-200 bg-white px-2 py-1.5 text-sm whitespace-pre-wrap dark:border-zinc-700 dark:bg-zinc-900"
        />
      </label>
      <label className="flex flex-col gap-1">
        설명 (선택)
        <textarea rows={2} value={description} onChange={(e) => setDescription(e.target.value)} className="rounded-md border border-zinc-200 bg-white px-2 py-1.5 text-sm dark:border-zinc-700 dark:bg-zinc-900" />
      </label>
      <button
        type="button"
        disabled={title.trim().length === 0 || isSubmitting}
        onClick={() => void handleCreate()}
        className="self-start rounded-md bg-blue-700 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-800 disabled:opacity-50"
      >
        {isSubmitting ? "추가 중..." : "노드 추가"}
      </button>
      {errorMessage && <p className="text-red-600 dark:text-red-400">{errorMessage}</p>}
    </div>
  );
}
