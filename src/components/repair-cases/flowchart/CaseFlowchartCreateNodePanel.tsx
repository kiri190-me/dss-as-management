"use client";

import { useState } from "react";
import { REPAIR_CASE_FLOWCHART_NODE_TYPE_CODES, repairCaseFlowchartNodeTypeLabels, type RepairCaseFlowchartNodeType } from "@/lib/domain/repair-case-flowchart-types";
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
 * resolve), so the selected node's stored position is used directly. This
 * never auto-creates an edge.
 *
 * ============================================================================
 * 🔴 2026-11-21 (조각 C2) — **이 패널은 더 이상 서버를 안 부른다**
 * ============================================================================
 * 전에는 [노드 추가]가 createRepairCaseFlowchartNodeAction 을 제 손으로 불러
 * **누르는 즉시** 서버에 노드를 만들었다. 쓰는 분 요청으로 구조 변경도 [저장]을
 * 눌러야 저장되게 바뀌면서, 여기서 하는 일은 「무엇을 만들지」를 화면으로
 * 올려 보내는 것뿐이다(onQueueCreate). 실제 호출은 화면의 [저장]이 한다.
 *
 * 🔴 **잃은 뒤처리는 없다**(옮겼거나, 일어날 수 없게 됐다):
 *  · 「추가 중...」/`isSubmitting` — 서버를 안 부르니 기다릴 것이 없다. 단추는
 *    누르는 즉시 끝난다(그림에 노드가 바로 선다 — 미리보기).
 *  · 실패 사유(`errorMessage`) — 이 자리에서는 실패할 일이 없어졌다. 서버가
 *    거절하는 일(제목 규칙 · 권한 · 토큰)은 [저장] 때 일어나고, 그 글은 화면
 *    위쪽의 저장 실패 줄에 뜬다.
 *  · 입력칸 비우기(제목·설명) — **그대로 한다**(아래 handleQueue).
 *  · `onSaved(updatedAt)` — 저장된 것이 없으니 넘길 토큰이 없다. 「화면에
 *    알린다」는 몫은 onQueueCreate 자신이 한다.
 *
 * 🔴 **자리를 비워서 넘기지 않는다**(2026-11-21). 전에는 고른 노드가 없으면
 * `position: null` 을 보내고 서버가 「맨 아래 + 150」으로 쌓았다. 이제는 저장
 * 전에 그림을 그려야 하므로, 그 셈을 여기서 **같은 규칙으로** 해서 실제로
 * 보낸다(createRepairCaseFlowchartNode 의 else 가지 — x 는 0, y 는 가장 큰
 * positionY + 150, 노드가 없으면 0). 🔵 비워 보내면 미리보기는 (0,0)에 그리고
 * 저장 뒤에는 서버가 쌓은 자리로 **뛴다** — 사람이 본 자리와 저장된 자리가
 * 다른 것이 이번 일에서 가장 피하고 싶은 모습이다.
 */
export default function CaseFlowchartCreateNodePanel({
  allNodes,
  selectedNode,
  onQueueCreate,
}: {
  /** 그림에 지금 그려져 있는 노드 전부 — 고른 노드가 없을 때 쌓을 자리를 재는 데만 쓴다. */
  allNodes: CaseFlowchartGraphNode[];
  selectedNode: CaseFlowchartGraphNode | null;
  /** 🔴 [저장] 때 보낼 「노드 추가」 한 줄을 화면의 모아 두는 통로에 쌓는다. */
  onQueueCreate: (input: { nodeType: RepairCaseFlowchartNodeType; title: string; description: string; position: { x: number; y: number } }) => void;
}) {
  const [nodeType, setNodeType] = useState<RepairCaseFlowchartNodeType>("TASK");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");

  /** 새 노드가 설 자리 — 고른 노드가 있으면 그 바로 아래 가운데, 없으면 맨 아래에 쌓는다(머리말). */
  function nextNodePosition(): { x: number; y: number } {
    if (selectedNode) {
      return computeRelativePosition(
        {
          x: selectedNode.positionX,
          y: selectedNode.positionY,
          width: computeNodeDimensions({ title: selectedNode.title, shape: NODE_VISUAL_CONFIG[getNodeChipVisual(selectedNode.nodeType).semanticType].shape }).width,
        },
        "DOWN",
        BELOW_SELECTED_SPACING,
        computeNodeDimensions({ title, shape: NODE_VISUAL_CONFIG[getNodeChipVisual(nodeType).semanticType].shape }).width
      );
    }
    if (allNodes.length === 0) return { x: 0, y: 0 };
    return { x: 0, y: allNodes.reduce((max, n) => (n.positionY > max ? n.positionY : max), allNodes[0].positionY) + BELOW_SELECTED_SPACING.vertical };
  }

  function handleQueue() {
    onQueueCreate({ nodeType, title, description, position: nextNodePosition() });
    // 다음 것을 바로 적을 수 있게 비운다 — 서버를 부르던 시절의 뒤처리 그대로다.
    setTitle("");
    setDescription("");
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
        disabled={title.trim().length === 0}
        onClick={handleQueue}
        className="self-start rounded-md bg-blue-700 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-800 disabled:opacity-50"
      >
        노드 추가
      </button>
      {/* 🔵 「[저장]을 눌러야 서버에 들어간다」는 말은 여기서 안 적는다 — 화면 위쪽의
          「변경사항 N건 저장 대기 중」과 [저장] 단추가 그 말을 이미 하고 있고, 패널마다
          한 줄씩 더 적으면 같은 말이 세 곳에서 따로 늙는다. */}
    </div>
  );
}
