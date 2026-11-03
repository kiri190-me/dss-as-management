"use client";

import { useState } from "react";
import { PROCEDURE_BRANCH_TYPE_CODES, procedureBranchTypeLabels, type ProcedureBranchType } from "@/lib/domain/procedure-template-types";
import type { EditorNodeRow } from "@/lib/db/queries/procedure-template-editor";
import { createProcedureTemplateEdgeAction } from "@/lib/server/actions/procedure-template-editor";
import { pickDefaultTargetNodeId } from "@/lib/graph-editor-core/edge-default-target";
import type { StructuralValidationSummary } from "@/lib/db/mutations/procedure-template-editor";

/**
 * Add-connection panel (Phase 4A; form-reset behavior standardized in the
 * 5C-6D-1E follow-up) — only ever links two existing nodes (no node
 * creation). A caller may pre-fill fromNodeId (e.g. "새 연결 추가" invoked
 * with a node already selected).
 *
 * 🔴 2026-11-03(줄기 B-②) — [연결 추가]를 누르면 **확인 창 없이 그 자리에서**
 * 만든다. 예전에는 [연결 검토] → 미리보기 <dialog> → [추가] 로 두 걸음이었다.
 * 없앤 까닭 둘: 사용자가 "추가/수정할 때마다 팝업이 뜬다"고 직접 말했고,
 * 줄기 B-① 로 **구조 변경도 [이전]으로 되돌릴 수 있게** 됐다 — 되돌릴 수 있는
 * 추가에 한 번 더 묻는 값이 없다. (삭제·게시처럼 되돌릴 수 없거나 값이 큰
 * 조작의 확인은 그대로 남아 있다 — 이 조각이 없앤 것은 추가·수정뿐이다.)
 *
 * 🔴 됐다는 것을 사람이 아는 길은 **지도에 연결선이 나타나는 것**이다(onSaved →
 * 화면의 router.refresh()). 따로 성공 알림을 띄우지 않는다 — 조각 13(「추가
 * 작업 등록」)이 이미 같은 판단을 했다. 반대로 **실패는 반드시 보인다**:
 * errorMessage 를 패널 안에 그대로 그린다. 예전에는 같은 글을 창 안에도 한 벌
 * 더 그렸는데, 창이 없어진 지금은 이 한 자리가 **유일한** 통로다.
 *
 * 사유 입력칸은 원래부터 창이 아니라 패널에 있었으므로 그대로다 —
 * FULL_SERVICE/REFERENCE 는 사유가 여전히 필수고(canAdd), TECHNICAL_TASK 만
 * 선택이다. 즉 확인 창을 없앴다고 서버가 요구하는 입력이 사라지지 않았다.
 *
 * Not remounted via `key={selectedNodeId}` at the call site
 * (ProcedureTemplateEditorScreen) — the panel stays mounted and instead
 * resets its own fields via adjust-state-during-render whenever
 * `prefillFromNodeId` changes, i.e. whenever the canvas selection changes.
 * The whole form resets (FROM/TO/branch type/branch label/reason) rather
 * than only resyncing FROM, since an in-progress draft for one FROM node
 * isn't meaningful once the canvas selection points at a different one.
 * Mirrors CaseFlowchartCreateEdgePanel.
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
    setErrorMessage(null);
  } else if (mostRecentNodeId !== prevMostRecentNodeId) {
    // 노드를 새로 추가하면 그 노드가 곧 이어붙일 대상인 경우가 대부분이다 —
    // 대상 노드만 다시 기본값으로 맞추고, 작성 중이던 나머지 입력(분기 유형/
    // 라벨/사유)은 건드리지 않는다.
    setPrevMostRecentNodeId(mostRecentNodeId);
    setToNodeId(pickDefaultTargetNodeId(nodesOldestFirst, fromNodeId));
  }

  const labelRequired = branchType === "CUSTOM" && branchLabel.trim().length === 0;
  /**
   * 단추를 켤 조건. 확인 창이 있던 시절의 canReview 와 **같은 식**이다 — 창을
   * 없앴을 뿐 "무엇이 갖춰져야 만들 수 있는가"는 바뀌지 않았다(특히 사유:
   * FULL_SERVICE/REFERENCE 는 여전히 필수다).
   */
  const canAdd = fromNodeId.length > 0 && toNodeId.length > 0 && fromNodeId !== toNodeId && !labelRequired && (isTechnical || reason.trim().length > 0);

  /**
   * [연결 추가] 의 본체. 🔴 onSaved 는 **실패 검사 뒤**에만 부른다 — 이 호출이
   * 화면의 handleStructuralSaved → pushStructuralUndoStep() 으로 이어져
   * 되돌리기 한 걸음을 쌓기 때문에, 실패한 호출까지 쌓으면 일어나지도 않은
   * 일을 되돌리려 들어 바로 아래 있던 멀쩡한 변경이 대신 날아간다(줄기 B-①).
   * 확인 창을 없애면서도 이 순서는 손대지 않았다.
   */
  async function handleAdd() {
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
    setToNodeId("");
    setReason("");
    onSaved(result.updatedAt, result.structuralValidation);
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
        disabled={!canAdd || isSubmitting}
        onClick={() => void handleAdd()}
        className="self-start rounded-md bg-emerald-700 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-800 disabled:opacity-50"
      >
        {isSubmitting ? "추가 중..." : "연결 추가"}
      </button>
      {/*
        🔴 실패를 알리는 **유일한** 자리다 — 확인 창이 있던 시절에는 같은 글을
        창 안에도 한 벌 더 그렸다. 조용히 아무 일도 안 일어나면 사람은 고장으로
        읽으므로, 성공 알림은 없애도 이것은 없애면 안 된다.
      */}
      {errorMessage && <p className="text-red-600 dark:text-red-400">{errorMessage}</p>}
    </div>
  );
}
