"use client";

import { useEffect, useRef, useState } from "react";
import { PROCEDURE_BRANCH_TYPE_CODES, procedureBranchTypeLabels, type ProcedureBranchType } from "@/lib/domain/procedure-template-types";
import type { EditorNodeRow } from "@/lib/db/queries/procedure-template-editor";
import { createProcedureTemplateEdgeAction } from "@/lib/server/actions/procedure-template-editor";
import { buildNewEdgePreview, type NodeLookup } from "@/lib/domain/procedure-editor-client-state";
import { pickDefaultTargetNodeId } from "@/lib/graph-editor-core/edge-default-target";
import type { StructuralValidationSummary } from "@/lib/db/mutations/procedure-template-editor";

/**
 * Add-connection panel (Phase 4A; form-reset behavior standardized in the
 * 5C-6D-1E follow-up) — only ever links two existing nodes (no node
 * creation), always requires an explicit reason and a preview confirmation
 * before the edge is persisted. A caller may pre-fill fromNodeId (e.g. "새
 * 연결 추가" invoked with a node already selected).
 *
 * Not remounted via `key={selectedNodeId}` at the call site
 * (ProcedureTemplateEditorScreen) — the panel stays mounted and instead
 * resets its own fields via adjust-state-during-render whenever
 * `prefillFromNodeId` changes, i.e. whenever the canvas selection changes.
 * The whole form resets (FROM/TO/branch type/branch label/reason, and
 * closes any open review dialog) rather than only resyncing FROM, since an
 * in-progress draft for one FROM node isn't meaningful once the canvas
 * selection points at a different one. Mirrors CaseFlowchartCreateEdgePanel.
 */
export default function CreateEdgePanel({
  templateId,
  nodes,
  canEdit,
  expectedTemplateUpdatedAt,
  prefillFromNodeId,
  isPickingTarget = false,
  onStartPickTarget,
  onCancelPickTarget,
  pickedTarget = null,
  onSaved,
  isTechnical,
}: {
  templateId: string;
  nodes: EditorNodeRow[];
  canEdit: boolean;
  expectedTemplateUpdatedAt: string;
  prefillFromNodeId?: string | null;
  /**
   * "화면에서 선택" — true인 동안 캔버스 노드 클릭이 시작 노드 선택이 아니라
   * 이 패널의 대상 노드로 들어온다. 모드 자체는 화면(부모)이 소유한다 —
   * 클릭을 받는 쪽이 캔버스이기 때문이다.
   */
  isPickingTarget?: boolean;
  onStartPickTarget?: () => void;
  onCancelPickTarget?: () => void;
  /** 부모가 캔버스에서 고른 결과. 같은 노드를 다시 골라도 반영되도록 seq를 함께 올린다. */
  pickedTarget?: { nodeId: string; seq: number } | null;
  onSaved: (newUpdatedAt: string, structuralValidation?: StructuralValidationSummary) => void;
  /** Phase 5C-5B usability — true for TECHNICAL_TASK; relaxes the "추가 사유" from mandatory to optional (UI mirror of the mutation layer's own category-aware validation). FULL_SERVICE keeps requiring a reason, unchanged. */
  isTechnical: boolean;
}) {
  const nodesById = new Map<string, NodeLookup>(nodes.map((n) => [n.id, { id: n.id, title: n.title, nodeCode: n.nodeCode }]));
  // 노드 생성 시 sortOrder가 max+1로 매겨지므로(createProcedureTemplateNode),
  // sortOrder 오름차순이 곧 추가된 순서다 — nodes prop 자체의 배열 순서는
  // 쿼리에 orderBy가 없어 신뢰할 수 없다.
  const nodesOldestFirst = [...nodes].sort((a, b) => a.sortOrder - b.sortOrder);
  const mostRecentNodeId = nodesOldestFirst[nodesOldestFirst.length - 1]?.id ?? null;
  const initialFromNodeId = prefillFromNodeId ?? nodes[0]?.id ?? "";
  const [prevPrefillFromNodeId, setPrevPrefillFromNodeId] = useState(prefillFromNodeId ?? null);
  const [fromNodeId, setFromNodeId] = useState(initialFromNodeId);
  const [toNodeId, setToNodeId] = useState(() => pickDefaultTargetNodeId(nodesOldestFirst, initialFromNodeId));
  const [branchType, setBranchType] = useState<ProcedureBranchType>("DEFAULT");
  const [branchLabel, setBranchLabel] = useState("");
  const [reason, setReason] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [prevMostRecentNodeId, setPrevMostRecentNodeId] = useState(mostRecentNodeId);
  const [prevPickedSeq, setPrevPickedSeq] = useState(pickedTarget?.seq ?? 0);
  if (pickedTarget && pickedTarget.seq !== prevPickedSeq) {
    // 캔버스에서 고른 노드는 대상 노드만 바꾼다 — 작성 중이던 나머지 입력은
    // 그대로 둔다(부모가 선택 대기 중에는 prefillFromNodeId를 고정해 두므로
    // 아래 초기화 분기는 이때 돌지 않는다).
    setPrevPickedSeq(pickedTarget.seq);
    setToNodeId(pickedTarget.nodeId);
  } else if ((prefillFromNodeId ?? null) !== prevPrefillFromNodeId) {
    const nextFromNodeId = prefillFromNodeId ?? nodes[0]?.id ?? "";
    setPrevPrefillFromNodeId(prefillFromNodeId ?? null);
    setFromNodeId(nextFromNodeId);
    setToNodeId(pickDefaultTargetNodeId(nodesOldestFirst, nextFromNodeId));
    setBranchType("DEFAULT");
    setBranchLabel("");
    setReason("");
    setConfirming(false);
    setErrorMessage(null);
  } else if (mostRecentNodeId !== prevMostRecentNodeId) {
    // 노드를 새로 추가하면 그 노드가 곧 이어붙일 대상인 경우가 대부분이다 —
    // 대상 노드만 다시 기본값으로 맞추고, 작성 중이던 나머지 입력(분기 유형/
    // 라벨/사유)은 건드리지 않는다.
    setPrevMostRecentNodeId(mostRecentNodeId);
    setToNodeId(pickDefaultTargetNodeId(nodesOldestFirst, fromNodeId));
  }
  const dialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (confirming && !dialog.open) dialog.showModal();
    else if (!confirming && dialog.open) dialog.close();
  }, [confirming]);

  const labelRequired = branchType === "CUSTOM" && branchLabel.trim().length === 0;
  const canReview = fromNodeId.length > 0 && toNodeId.length > 0 && fromNodeId !== toNodeId && !labelRequired && (isTechnical || reason.trim().length > 0);

  async function handleConfirm() {
    setIsSubmitting(true);
    setErrorMessage(null);
    const result = await createProcedureTemplateEdgeAction({
      templateId,
      fromNodeId,
      toNodeId,
      branchType,
      branchLabel: branchLabel.trim() || null,
      reason,
      expectedTemplateUpdatedAt,
    });
    setIsSubmitting(false);
    if (!result.ok) {
      setErrorMessage(result.message);
      return;
    }
    setConfirming(false);
    setToNodeId("");
    setReason("");
    onSaved(result.updatedAt, result.structuralValidation);
  }

  if (!canEdit) return null;

  const preview = buildNewEdgePreview({ fromNodeId, toNodeId, branchType, branchLabel: branchLabel.trim() || null }, nodesById);

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
              {n.title} ({n.nodeCode})
            </option>
          ))}
        </select>
      </label>
      <div className="flex flex-col gap-1">
        <label htmlFor="create-edge-to-node">대상 노드</label>
        <div className="flex items-center gap-2">
          <select
            id="create-edge-to-node"
            value={toNodeId}
            onChange={(e) => setToNodeId(e.target.value)}
            className="min-w-0 flex-1 rounded-md border border-zinc-200 bg-white px-2 py-1.5 text-sm dark:border-zinc-700 dark:bg-zinc-900"
          >
            <option value="">노드를 선택하세요</option>
            {nodes.map((n) => (
              <option key={n.id} value={n.id}>
                {n.title} ({n.nodeCode})
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
        <select value={branchType} onChange={(e) => setBranchType(e.target.value as ProcedureBranchType)} className="rounded-md border border-zinc-200 bg-white px-2 py-1.5 text-sm dark:border-zinc-700 dark:bg-zinc-900">
          {PROCEDURE_BRANCH_TYPE_CODES.map((bt) => (
            <option key={bt} value={bt}>
              {procedureBranchTypeLabels[bt]}
            </option>
          ))}
        </select>
      </label>
      <label className="flex flex-col gap-1">
        분기 라벨 {branchType === "CUSTOM" ? "(필수)" : "(선택)"}
        <input value={branchLabel} onChange={(e) => setBranchLabel(e.target.value)} className="rounded-md border border-zinc-200 bg-white px-2 py-1.5 text-sm dark:border-zinc-700 dark:bg-zinc-900" />
      </label>
      <label className="flex flex-col gap-1">
        추가 사유 {isTechnical ? "(선택)" : "(필수)"}
        <textarea rows={2} value={reason} onChange={(e) => setReason(e.target.value)} className="rounded-md border border-zinc-200 bg-white px-2 py-1.5 text-sm dark:border-zinc-700 dark:bg-zinc-900" />
      </label>
      {fromNodeId && toNodeId && fromNodeId === toNodeId && <p className="text-red-600 dark:text-red-400">자기 자신으로의 분기는 지원하지 않습니다.</p>}
      <button
        type="button"
        disabled={!canReview}
        onClick={() => setConfirming(true)}
        className="self-start rounded-md bg-emerald-700 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-800 disabled:opacity-50"
      >
        연결 검토
      </button>
      {errorMessage && !confirming && <p className="text-red-600 dark:text-red-400">{errorMessage}</p>}

      <dialog
        ref={dialogRef}
        aria-labelledby="create-edge-confirm-title"
        onCancel={(e) => {
          e.preventDefault();
          if (!isSubmitting) setConfirming(false);
        }}
        className="w-full max-w-md rounded-lg border border-zinc-200 bg-white p-4 text-zinc-900 backdrop:bg-black/40 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-50"
      >
        <h2 id="create-edge-confirm-title" className="text-sm font-semibold">
          새 연결 추가 확인
        </h2>
        <div className="mt-3 space-y-1 text-sm">
          <p>
            {preview.from.title} → {preview.to.title}
          </p>
          <p>
            <span className="text-zinc-500 dark:text-zinc-400">분기 유형:</span> {procedureBranchTypeLabels[preview.branchType]}
            {preview.branchLabel ? ` ("${preview.branchLabel}")` : ""}
          </p>
          <p className="whitespace-pre-wrap text-xs">
            <span className="text-zinc-500 dark:text-zinc-400">사유:</span> {reason}
          </p>
        </div>
        {errorMessage && <p className="mt-2 text-xs text-red-600 dark:text-red-400">{errorMessage}</p>}
        <div className="mt-4 flex justify-end gap-2">
          <button
            type="button"
            onClick={() => setConfirming(false)}
            disabled={isSubmitting}
            className="rounded-md border border-zinc-300 px-3 py-1.5 text-sm text-zinc-700 hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-300"
          >
            취소
          </button>
          <button
            type="button"
            onClick={() => void handleConfirm()}
            disabled={isSubmitting}
            className="rounded-md bg-zinc-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-zinc-800 disabled:opacity-50 dark:bg-zinc-50 dark:text-zinc-900"
          >
            {isSubmitting ? "추가 중..." : "추가"}
          </button>
        </div>
      </dialog>
    </div>
  );
}
