"use client";

import { useState } from "react";
import { PROCEDURE_BRANCH_TYPE_CODES, procedureBranchTypeLabels, type ProcedureBranchType } from "@/lib/domain/procedure-template-types";
import type { EditorNodeRow } from "@/lib/db/queries/procedure-template-editor";
import { pickDefaultTargetNodeId } from "@/lib/graph-editor-core/edge-default-target";

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
 * 🔴 됐다는 것을 사람이 아는 길은 **지도에 연결선이 나타나는 것**이다. 따로 성공
 * 알림을 띄우지 않는다 — 조각 13(「추가 작업 등록」)이 이미 같은 판단을 했다.
 * 🔴 2026-11-20(조각 4) 에 이 문장의 뒤쪽이 바뀌었다: 예전에는 「실패는 반드시
 * 보인다 — errorMessage 를 패널 안에 그대로 그린다」였는데, 이 패널에는 실패할
 * 서버 호출이 한 건도 안 남아 그 자리가 **화면 위쪽 한 곳으로 옮겨 갔다**
 * (없앤 것이 아니라 옮긴 것이다 — 아래 조각 4 절).
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
 *
 * ── 🔴 2026-11-20(조각 4) — **서버를 여기서 안 부른다** ──────────────────
 * 쓰는 분의 요청으로 연결선 추가도 [저장]을 눌러야 저장된다. 이 패널은 이제
 * createProcedureTemplateEdgeAction 을 부르지 않고, 무엇을 그을지만 적어 화면에
 * 넘긴다 — 화면이 모아 두었다가 [저장]에서 **같은 액션을** 부른다(서버는 그대로다).
 *
 * 🔵 사유 칸은 **그대로 남는다.** 모아 두는 조작이 reason 칸을 들고 가고, [저장]이
 * 그것을 그대로 실어 보낸다. 그래서 FULL_SERVICE/REFERENCE 의 「사유 필수」도
 * 그대로다(canAdd 가 전과 같은 식이다).
 */
export default function CreateEdgePanel({
  nodes,
  canEdit,
  prefillFromNodeId,
  isPickingTarget = false,
  onStartPickTarget,
  onCancelPickTarget,
  pickedTarget = null,
  onQueueCreate,
  isTechnical,
}: {
  nodes: EditorNodeRow[];
  canEdit: boolean;
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
  /** 🔴 서버에 보내지 않고 **모아 둔다**(2026-11-20, 조각 4). 그림에는 그 자리에서 선이 나타난다. */
  onQueueCreate: (input: {
    fromNodeId: string;
    toNodeId: string;
    branchType: ProcedureBranchType;
    branchLabel: string | null;
    reason: string | null;
  }) => void;
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
   * [연결 추가] 의 본체 — 🔴 **모아 두기만 한다**(2026-11-20, 조각 4).
   *
   * 🔵 실패 검사가 사라진 까닭: 여기서는 실패할 일이 없다. 전에는 이 자리의
   * `if (!result.ok)` 가 「실패한 호출로 되돌리기 한 걸음이 쌓이는 것」을 막고
   * 있었는데, 이제 되돌리기 한 걸음은 **화면이 목록을 고치기 직전에** 쌓는다 —
   * 서버가 거절할 기회 자체가 [저장] 때로 밀렸고, 그때 실패하면 목록이 그대로
   * 남아 다시 보낼 수 있다(runProcedureStructuralSequence 의 remainingOperations).
   *
   * 🔵 비우는 칸은 전과 같다 — 대상 노드와 사유. 시작 노드·분기 유형·라벨은 그대로
   * 둔다(한 노드에서 선을 여럿 긋는 일이 보통이다).
   */
  function handleAdd() {
    onQueueCreate({ fromNodeId, toNodeId, branchType, branchLabel: branchLabel.trim() || null, reason: reason.trim() || null });
    setToNodeId("");
    setReason("");
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
        disabled={!canAdd}
        onClick={handleAdd}
        className="self-start rounded-md bg-emerald-700 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-800 disabled:opacity-50"
      >
        연결 추가
      </button>
      {/*
        🔴 2026-11-20(조각 4) — **실패를 알리던 자리가 여기서 없어졌다.** 없앤 것이
        아니라 **옮긴 것**이다: 서버가 거절하는 시점이 [저장] 때로 밀렸고, 그 글은
        화면 위쪽 [저장] 줄 아래 한 자리에서 나온다. 여기 빈 자리를 남겨 두면
        「조용히 아무 일도 안 일어났다」가 되므로, 대신 **어디서 저장되는지**를 적는다.
      */}
      <p className="text-emerald-800 dark:text-emerald-300">그은 연결선은 화면 상단의 [저장]을 눌러야 서버에 저장됩니다.</p>
    </div>
  );
}
