"use client";

import { useState, type ReactNode } from "react";
import {
  EXTRA_TASK_NODE_TYPE_CODES,
  type ExtraTaskNodeType,
} from "@/lib/domain/procedure-case-execution-types";
import {
  PROCEDURE_BRANCH_TYPE_CODES,
  procedureBranchTypeLabels,
  procedureNodeTypeLabels,
  type ProcedureBranchType,
} from "@/lib/domain/procedure-template-types";
import {
  classifyEdgeRemoval,
  classifyNodeRemoval,
  type CaseEditEdgeRow,
  type CaseEditNode,
} from "@/lib/domain/procedure-execution-case-edit";

/**
 * 「추가 작업 등록」 창의 **속**(2026-11-03, 조각 13) — 노드 추가/제거 ·
 * 연결 추가/제거.
 *
 * ──────────────────────────────────────────────────────────────────────
 * 🔴 이 파일은 **그리기만** 한다
 * ──────────────────────────────────────────────────────────────────────
 * 서버 액션을 부르지 않고 콜백만 받는다. 까닭은 조각 10 의 ExecutionStepsPanel
 * 과 같다 — 액션을 물면 이 창을 **그려서 재는** 시험이 import 에서 바로 던진다.
 * 그림도 같은 까닭으로 슬롯(`graphSlot`)으로 받는다(@xyflow/react 의 .css).
 *
 * ──────────────────────────────────────────────────────────────────────
 * 🔵 편집기의 **UI 를 베끼되 통로는 실행 쪽**이다
 * ──────────────────────────────────────────────────────────────────────
 * 절차 편집기의 네 부품(CreateNodePanel · CreateEdgePanel · NodePropertyPanel
 * 의 노드 삭제 · EdgePropertyPanel 의 분기 삭제)과 같은 모양·같은 차례다 —
 * 파란 상자가 노드, 초록 상자가 연결, 빨간 상자가 지우기.
 *
 * 다른 것이 둘 있고 둘 다 사용자 결정이다:
 *  - 🔴 **확인 창이 없다.** 편집기의 [연결 검토] → 「취소 / 추가」는 없애 달라고
 *    한 그것이다. 누르는 즉시 저장한다.
 *  - 🔴 **저장 대기가 없다.** 편집기는 모아 뒀다 [저장]을 누르는데, 그 방식을
 *    가져오면 되돌리기가 잠기는 문제가 따라온다(2026-11-02 결정).
 *
 * 🔴 **사유 칸도 없다.** 편집기는 게시 전 절차를 고치는 일이라 사유를 받지만,
 * 여기는 **이 건에서 내가 더한 것**을 더하고 지우는 일이다. 누가 언제 했는지는
 * 칸에 남는다(created_by · deleted_by).
 */
export default function ExecutionTaskEditorPanel({
  nodes,
  edgeRows,
  graphSlot,
  selectedNode,
  onSelectNode,
  selectedEdgeId,
  onSelectEdge,
  onCreateNode,
  onRemoveNode,
  onCreateEdge,
  onRemoveEdge,
  isSubmitting,
  errorMessage,
  onClose,
}: {
  /** 이 실행의 작업 줄 전부 — 절차 차례 그대로다(getExecutionDetail 이 정렬해 내려준다). */
  nodes: readonly CaseEditNode[];
  /** 연결 목록 한 줄씩 — 못 지우는 줄에는 까닭이 들어 있다(buildCaseEditEdgeRows). */
  edgeRows: readonly CaseEditEdgeRow[];
  /** 지금 지도. 🔴 없으면 null 을 넘긴다 — 그때는 그림 자리가 통째로 빈다. */
  graphSlot: ReactNode;
  /** 그림이나 목록에서 고른 작업. 「노드 제거」와 「연결 추가」의 시작점이 된다. */
  selectedNode: CaseEditNode | null;
  onSelectNode: (executionNodeId: string | null) => void;
  selectedEdgeId: string | null;
  onSelectEdge: (edgeId: string | null) => void;
  onCreateNode: (input: { nodeType: ExtraTaskNodeType; title: string; instructions: string | null }) => void;
  onRemoveNode: () => void;
  onCreateEdge: (input: {
    fromExecutionNodeId: string;
    toExecutionNodeId: string;
    branchType: ProcedureBranchType;
    branchLabel: string | null;
  }) => void;
  onRemoveEdge: () => void;
  isSubmitting: boolean;
  errorMessage: string | null;
  onClose: () => void;
}) {
  const [nodeType, setNodeType] = useState<ExtraTaskNodeType>("TASK");
  const [title, setTitle] = useState("");
  const [instructions, setInstructions] = useState("");
  const [fromNodeId, setFromNodeId] = useState("");
  const [toNodeId, setToNodeId] = useState("");
  const [branchType, setBranchType] = useState<ProcedureBranchType>("DEFAULT");
  const [branchLabel, setBranchLabel] = useState("");

  // 🔵 그림/목록에서 고른 작업이 **연결의 시작점 기본값**이다. 편집기의
  //    prefillFromNodeId 와 같은 쓰임 — 고른 것 다음에 잇는 일이 대부분이다.
  const effectiveFromNodeId = fromNodeId || (selectedNode?.id ?? "");
  const nodeRemoval = classifyNodeRemoval(selectedNode);
  const selectedEdgeRow = edgeRows.find((row) => row.edge.id === selectedEdgeId) ?? null;
  const edgeRemoval = classifyEdgeRemoval(selectedEdgeRow?.edge ?? null);

  const canCreateNode = title.trim().length > 0 && !isSubmitting;
  const edgeLabelRequired = branchType === "CUSTOM" && branchLabel.trim().length === 0;
  const canCreateEdge =
    effectiveFromNodeId.length > 0 &&
    toNodeId.length > 0 &&
    effectiveFromNodeId !== toNodeId &&
    !edgeLabelRequired &&
    !isSubmitting;

  function handleCreateNode() {
    if (!canCreateNode) return;
    onCreateNode({ nodeType, title, instructions: instructions.trim() || null });
    setTitle("");
    setInstructions("");
  }

  function handleCreateEdge() {
    if (!canCreateEdge) return;
    onCreateEdge({
      fromExecutionNodeId: effectiveFromNodeId,
      toExecutionNodeId: toNodeId,
      branchType,
      branchLabel: branchLabel.trim() || null,
    });
    setToNodeId("");
    setBranchLabel("");
  }

  return (
    <div data-execution-task-editor className="flex flex-col gap-3">
      <p className="text-xs text-zinc-500 dark:text-zinc-400">
        이 건에만 쓰는 작업과 연결을 더합니다. <span className="font-medium">원본 절차는 바뀌지 않습니다</span> — 같은
        절차를 쓰는 다른 접수 건에는 아무 영향이 없습니다. 누르는 즉시 저장되며, 잘못 더했으면 아래에서 지우면 됩니다.
      </p>

      {/* 지금 지도 — 고르는 자리이자 결과를 보는 자리다. 🔴 위에 둔 까닭: 무엇을
          더할지 정하려면 지금 어떻게 이어져 있는지를 먼저 봐야 한다. */}
      {graphSlot && <div className="rounded-lg border border-zinc-200 dark:border-zinc-800">{graphSlot}</div>}

      <label className="flex flex-col gap-1 text-xs">
        고른 작업 (그림에서 눌러도 됩니다)
        <select
          data-execution-task-editor-selected
          value={selectedNode?.id ?? ""}
          onChange={(e) => onSelectNode(e.target.value || null)}
          className="rounded-md border border-zinc-200 bg-white px-2 py-1.5 text-sm dark:border-zinc-700 dark:bg-zinc-900"
        >
          <option value="">작업을 고르세요</option>
          {nodes.map((n) => (
            <option key={n.id} value={n.id}>
              {n.orderIndex > 0 ? `${n.orderIndex}. ` : ""}
              {n.title}
              {n.isAddedInCase ? " (이 건에서 더함)" : ""}
            </option>
          ))}
        </select>
      </label>

      {/* ── 노드 추가 — 편집기의 「새 노드 추가」와 같은 파란 상자 ───────── */}
      <div className="flex flex-col gap-3 rounded-lg border border-blue-200 bg-blue-50 p-3 text-xs dark:border-blue-900 dark:bg-blue-950">
        <h3 className="text-sm font-semibold text-blue-900 dark:text-blue-300">새 작업 추가</h3>
        <label className="flex flex-col gap-1">
          노드 유형
          <select
            value={nodeType}
            onChange={(e) => setNodeType(e.target.value as ExtraTaskNodeType)}
            className="rounded-md border border-zinc-200 bg-white px-2 py-1.5 text-sm dark:border-zinc-700 dark:bg-zinc-900"
          >
            {EXTRA_TASK_NODE_TYPE_CODES.map((t) => (
              <option key={t} value={t}>
                {procedureNodeTypeLabels[t]}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1">
          제목 (필수)
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            className="rounded-md border border-zinc-200 bg-white px-2 py-1.5 text-sm dark:border-zinc-700 dark:bg-zinc-900"
          />
        </label>
        <label className="flex flex-col gap-1">
          작업 내용 (선택)
          <textarea
            rows={2}
            value={instructions}
            onChange={(e) => setInstructions(e.target.value)}
            className="resize-y rounded-md border border-zinc-200 bg-white px-2 py-1.5 text-sm whitespace-pre-wrap dark:border-zinc-700 dark:bg-zinc-900"
          />
        </label>
        <button
          type="button"
          data-execution-task-editor-add-node
          disabled={!canCreateNode}
          onClick={handleCreateNode}
          className="self-start rounded-md bg-blue-700 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-800 disabled:opacity-50"
        >
          {isSubmitting ? "처리 중..." : "작업 추가"}
        </button>
      </div>

      {/* ── 연결 추가 — 편집기의 「새 연결 추가」와 같은 초록 상자 ───────── */}
      <div className="flex flex-col gap-3 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-xs dark:border-emerald-900 dark:bg-emerald-950">
        <h3 className="text-sm font-semibold text-emerald-900 dark:text-emerald-300">새 연결 추가</h3>
        <label className="flex flex-col gap-1">
          시작 작업
          <select
            value={effectiveFromNodeId}
            onChange={(e) => setFromNodeId(e.target.value)}
            className="rounded-md border border-zinc-200 bg-white px-2 py-1.5 text-sm dark:border-zinc-700 dark:bg-zinc-900"
          >
            <option value="">작업을 고르세요</option>
            {nodes.map((n) => (
              <option key={n.id} value={n.id}>
                {n.orderIndex > 0 ? `${n.orderIndex}. ` : ""}
                {n.title}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1">
          대상 작업
          <select
            value={toNodeId}
            onChange={(e) => setToNodeId(e.target.value)}
            className="rounded-md border border-zinc-200 bg-white px-2 py-1.5 text-sm dark:border-zinc-700 dark:bg-zinc-900"
          >
            <option value="">작업을 고르세요</option>
            {nodes.map((n) => (
              <option key={n.id} value={n.id}>
                {n.orderIndex > 0 ? `${n.orderIndex}. ` : ""}
                {n.title}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1">
          분기 유형
          <select
            value={branchType}
            onChange={(e) => setBranchType(e.target.value as ProcedureBranchType)}
            className="rounded-md border border-zinc-200 bg-white px-2 py-1.5 text-sm dark:border-zinc-700 dark:bg-zinc-900"
          >
            {PROCEDURE_BRANCH_TYPE_CODES.map((bt) => (
              <option key={bt} value={bt}>
                {procedureBranchTypeLabels[bt]}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1">
          분기 이름표 {branchType === "CUSTOM" ? "(필수)" : "(선택)"}
          <input
            type="text"
            value={branchLabel}
            onChange={(e) => setBranchLabel(e.target.value)}
            className="rounded-md border border-zinc-200 bg-white px-2 py-1.5 text-sm dark:border-zinc-700 dark:bg-zinc-900"
          />
        </label>
        {effectiveFromNodeId && toNodeId && effectiveFromNodeId === toNodeId && (
          <p className="text-red-600 dark:text-red-400">자기 자신으로의 연결은 만들 수 없습니다.</p>
        )}
        {/* 🔴 「연결 검토」가 아니라 바로 「연결 추가」다 — 확인 창을 안 가져온
            까닭은 이 파일 머리말에 있다. */}
        <button
          type="button"
          data-execution-task-editor-add-edge
          disabled={!canCreateEdge}
          onClick={handleCreateEdge}
          className="self-start rounded-md bg-emerald-700 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-800 disabled:opacity-50"
        >
          {isSubmitting ? "처리 중..." : "연결 추가"}
        </button>
      </div>

      {/* ── 지우기 — 편집기의 「노드 삭제」·「분기 삭제」와 같은 빨간 상자 ── */}
      <div className="flex flex-col gap-3 rounded-lg border border-red-200 bg-red-50 p-3 text-xs dark:border-red-900 dark:bg-red-950">
        <h3 className="text-sm font-semibold text-red-900 dark:text-red-300">지우기</h3>

        <div className="flex flex-col gap-1">
          <span className="font-medium text-red-900 dark:text-red-300">작업 제거</span>
          {/* 🔴 못 지우는 까닭을 **그 자리에** 적는다 — 흐린 단추만 두면
              「왜 안 눌리지」로 끝난다(이 창의 까닭 전부가 그 한 줄에 있다). */}
          {!nodeRemoval.ok && <p className="text-red-700 dark:text-red-400">{nodeRemoval.message}</p>}
          <button
            type="button"
            data-execution-task-editor-remove-node
            disabled={!nodeRemoval.ok || isSubmitting}
            onClick={onRemoveNode}
            className="self-start rounded-md border border-red-300 px-3 py-1.5 text-sm text-red-700 hover:bg-red-100 disabled:opacity-50 dark:border-red-800 dark:text-red-300 dark:hover:bg-red-900"
          >
            {isSubmitting ? "처리 중..." : "고른 작업 제거"}
          </button>
        </div>

        <div className="flex flex-col gap-1">
          <span className="font-medium text-red-900 dark:text-red-300">연결 제거</span>
          <select
            data-execution-task-editor-edge-select
            value={selectedEdgeId ?? ""}
            onChange={(e) => onSelectEdge(e.target.value || null)}
            className="rounded-md border border-zinc-200 bg-white px-2 py-1.5 text-sm dark:border-zinc-700 dark:bg-zinc-900"
          >
            <option value="">연결을 고르세요</option>
            {edgeRows.map((row) => (
              <option key={row.edge.id} value={row.edge.id}>
                {row.label}
                {row.branchLabel ? ` [${row.branchLabel}]` : ""}
                {row.edge.isAddedInCase ? " (이 건에서 더함)" : ""}
              </option>
            ))}
          </select>
          {!edgeRemoval.ok && <p className="text-red-700 dark:text-red-400">{edgeRemoval.message}</p>}
          <button
            type="button"
            data-execution-task-editor-remove-edge
            disabled={!edgeRemoval.ok || isSubmitting}
            onClick={onRemoveEdge}
            className="self-start rounded-md border border-red-300 px-3 py-1.5 text-sm text-red-700 hover:bg-red-100 disabled:opacity-50 dark:border-red-800 dark:text-red-300 dark:hover:bg-red-900"
          >
            {isSubmitting ? "처리 중..." : "고른 연결 제거"}
          </button>
        </div>
      </div>

      {errorMessage && <p className="text-sm text-red-600 dark:text-red-400">{errorMessage}</p>}

      <div className="flex justify-end">
        <button
          type="button"
          onClick={onClose}
          className="rounded-md border border-zinc-300 px-3 py-1.5 text-sm text-zinc-700 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
        >
          닫기
        </button>
      </div>
    </div>
  );
}
