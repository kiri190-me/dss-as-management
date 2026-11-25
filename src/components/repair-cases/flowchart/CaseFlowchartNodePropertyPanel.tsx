"use client";

import { useState } from "react";
import { REPAIR_CASE_FLOWCHART_NODE_TYPE_CODES, repairCaseFlowchartNodeTypeLabels, type RepairCaseFlowchartNodeType } from "@/lib/domain/repair-case-flowchart-types";
import { computeCenterAlignedRelativePosition, resolveColumnSnappedRelativePosition, type RelativeDirection, type ColumnSnapCandidate } from "@/lib/graph-editor-core/layout";
import ContactFolderEntryOpenButton from "@/components/repair-cases/files/ContactFolderEntryOpenButton";
import CaseFlowchartNodeShareDocPicker, {
  canOpenCaseFlowchartNodeShareDoc,
  caseFlowchartNodeShareDocFileName,
  caseFlowchartNodeShareDocParentPath,
} from "./CaseFlowchartNodeShareDocPicker";
import type { CaseFlowchartGraphNode } from "./CaseFlowchartGraph";

/**
 * 🔴 `shareDocRelativePath`(2026-11-25) — 이 노드가 가리키는 공유폴더 속 파일 한 자리.
 * 🔴 **lib/domain/repair-case-flowchart-editor-save-state.ts 에 같은 이름의 타입이 한 벌
 * 더 있다**(모양이 같아 tsc 가 둘을 구별하지 않는다). 한쪽에만 칸을 더하면 **아무 말도
 * 없이** 그 칸이 저장 길에서 빠진다 — 늘 둘을 함께 본다.
 */
export type CaseFlowchartNodeDraft = { title: string; description: string; instructions: string; nodeType: RepairCaseFlowchartNodeType; shareDocRelativePath: string | null };

/** Same fixed spacing as the procedure editor's "상대 위치로 이동" (NodePropertyPanel.tsx) — vertical reuses the server mutation's own default node-stacking gap for consistency. */
const RELATIVE_POSITION_SPACING = { horizontal: 140, vertical: 150 } as const;

/** Derived from the same horizontal spacing constant, not an arbitrary number — half the standard gap is close enough to catch "same column, slightly different due to a different reference node's width" while staying far short of a full column-to-column distance (width + spacing), so an unrelated column is never snapped to. */
const COLUMN_SNAP_TOLERANCE = RELATIVE_POSITION_SPACING.horizontal / 2;

/**
 * Case-flowchart node property panel (5C-6D follow-up #2: live-preview
 * editor model). Title/description/node-type AND position ("상대 위치로
 * 이동") are all fully CONTROLLED/deferred now — they read/write lifted
 * state in CaseFlowchartEditorScreen (`draft`/`onDraftChange` for fields,
 * `onPositionDraftChange` for position) and persist ONLY through the
 * screen's global [저장] button. `node` itself is always the screen's
 * RENDERED (baseline + pending drafts merged) node, so this panel's own
 * fields/position picker naturally reflect whatever is currently on
 * screen, live, with no extra plumbing here.
 *
 * Earlier in 6D, position changes here saved immediately — the corrected
 * model no longer auto-saves position from ANY source (this panel's
 * buttons or a canvas drag); every position change is deferred/pending
 * exactly like every other field, per the approved editor model: "EDIT →
 * immediately visible → remains pending → [저장] → persist exactly what's
 * visible."
 *
 * 🔴 2026-11-21 — **지우는 일 자체는 이 패널을 떠났다.** 전에는 여기서
 * deleteRepairCaseFlowchartNodeAction 을 직접 부르고 「삭제 중 · 막힌 까닭 ·
 * 실패한 까닭」도 제 state 로 쥐고 있었다. 같은 날 [Delete] 키가 붙으면서
 * **부르는 자리가 둘이 될 뻔해서**, 호출도 뒤처리도 전부
 * CaseFlowchartEditorScreen 의 handleDeleteNode 한 자리로 올렸다(그 함수 옆의
 * 주석에 까닭 전문이 있다). 여기 남은 것은 단추를 그리고 `onDelete` 를 부르는
 * 것, 그리고 받아 온 글을 **전과 똑같은 자리에** 띄우는 것뿐이다.
 *
 * 🔴 같은 날(조각 C2) 지우기도 **[저장]을 눌러야 나가는 일**이 되었다. 그래서
 * `isDeleting`(「삭제 중...」)과 `deleteErrorMessage`(삭제가 그 자리에서 실패한
 * 까닭) 둘을 **없앴다** — 기다릴 서버도, 그 자리에서 날 실패도 없어서 값이 늘
 * false/null 인 칸이 되기 때문이다. 서버가 거절하면 그 글은 [저장] 때 화면 위쪽
 * 저장 실패 줄에 뜬다.
 *
 * 🔴 같은 날(조각 C3) **`deleteBlockedMessage` 도 같은 까닭으로 없앴다.** 그 칸에
 * 들어오던 글은 「이 노드에 연결된 분기가 N개 있어 삭제할 수 없습니다」 하나뿐이었고,
 * 쓰는 분 결정으로 **노드를 지우면 붙은 연결선도 함께 지워지게** 되면서 화면이 미리
 * 막는 일 자체가 사라졌다. 값이 영영 null 인 칸을 남기면 「꺼도 아무 일 없는
 * 스위치」가 된다. 🔵 그러므로 이 패널에는 이제 **삭제를 막는 길이 하나도 없다** —
 * 단추는 `canEdit` 일 때 늘 눌리고, 거절은 [저장] 때 한 자리에서만 나온다.
 *
 * "상대 위치로 이동" (5C-6D follow-up #3, dimension source corrected in
 * follow-up #4): LEFT/RIGHT align by vertical CENTER
 * (computeCenterAlignedRelativePosition), not raw top-left y — two nodes of
 * different height still land with matching centers. LEFT/RIGHT also
 * column-snap (resolveColumnSnappedRelativePosition): if an existing node
 * already occupies this column directly above the intended position, the
 * target lands exactly on that node's center-x. UP/DOWN are unchanged.
 * Both are generic graph-editor-core math — not wired into the Procedure
 * editor this checkpoint (5C-6D-1 decides that); this file's own dimension
 * SOURCE is the actual bug fix, not that math (see follow-up #4's root
 * cause below).
 *
 * DIMENSION SOURCE (5C-6D follow-up #4/#5 root-cause fix, follow-up #6
 * shares it): `resolveNodeDimensions` is passed down ALREADY COMPOSED from
 * CaseFlowchartEditorScreen — the ONE shared priority rule
 * (resolveEffectiveNodeDimensions, graph-editor-core/layout.ts), applied
 * identically to the target, the reference, AND every column-snap
 * candidate here, and to the source/target nodes in the screen's own
 * double-click-straighten handler. Real measured {width,height} (from
 * React Flow's `getInternalNode(id)?.measured`) wins per-axis when validly
 * measured, else the presentation-only computeNodeDimensions estimate.
 * This single shared function — not a duplicated composition in each
 * caller — is what guarantees "the double-click alignment uses the SAME
 * effective geometry source as the relative-positioning feature," per this
 * checkpoint's own requirement.
 */
// ── 🔴 「관련 파일」 구역의 문장 (2026-11-25) ─────────────────────────────
//
// 「모든 종류의 노드에 관련된 파일을 … 파일의 위치를 기억해서 도우미를 통해서 폴더에서
// 파일을 여는 방식으로」(사용자 요구 2026-11-21). 🔴 **올리는 것이 아니다** — 바이트는
// 이 시스템에 들어오지 않고, 남는 것은 공유폴더 루트 기준 **경로 한 줄**이다. 그 사실을
// 구역 머리에서 말한다(올리기 칸으로 읽히면 「왜 내려받기가 없지」에서 멈춘다).

export const CASE_NODE_SHARE_DOC_TITLE = "관련 파일";
export const CASE_NODE_SHARE_DOC_HINT =
  "파일을 올리지 않고 사내 공유폴더의 자리를 가리킵니다 — 여는 일은 그 PC 의 폴더 열기 도우미가 합니다.";
/** 🔴 노드당 하나라는 결정(2026-11-21)을 **고르기 전에** 말한다. */
export const CASE_NODE_SHARE_DOC_REPLACE_HINT =
  "노드마다 파일 하나만 가리킵니다 — 새로 고르면 지금 가리킨 자리가 바뀝니다.";
export const CASE_NODE_SHARE_DOC_EMPTY_TEXT = "가리킨 파일이 없습니다.";
export const CASE_NODE_SHARE_DOC_CLEAR_TEXT = "가리킴 지우기";
/** 🔴 이 구역의 변경도 [저장]을 눌러야 나간다 — 위 칸들과 같은 규약이다. */
export const CASE_NODE_SHARE_DOC_SAVE_NOTICE =
  "가리킴 변경도 화면 상단의 [저장] 버튼으로 다른 변경사항과 함께 저장됩니다.";

/**
 * 가리킨 자리 한 줄 — 경로 · [열기] · [가리킴 지우기].
 *
 * 🔴 **경로를 숨기지 않는다**: 「어느 자리인가」가 이 줄의 전부다. 🔴 [열기]는 연락서 쪽
 * 단추를 **그대로 가져다 쓴다**(베끼지 않는다) — 도우미 주소를 짓는 일도, Windows 가
 * 아닌 PC 에서 스스로 사라지는 일도 그 안에 있다. 🔴 열 수 없는 모양이면 단추만 없고
 * 경로는 그대로 보인다(canOpenCaseFlowchartNodeShareDoc 주석).
 */
export function CaseFlowchartNodeShareDocRow({
  relativePath,
  onClear,
}: {
  relativePath: string;
  /** 🔴 주지 않으면 지우기 단추가 그려지지 않는다(고칠 수 없는 사람). */
  onClear?: () => void;
}) {
  const openable = canOpenCaseFlowchartNodeShareDoc(relativePath);
  return (
    <div
      data-case-node-share-doc-row=""
      className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1"
    >
      <span className="min-w-0 flex-1 break-all text-[11px] text-zinc-600 dark:text-zinc-400">{relativePath}</span>
      <span className="flex shrink-0 items-start gap-2">
        {openable && (
          <ContactFolderEntryOpenButton
            folderName={caseFlowchartNodeShareDocParentPath(relativePath)}
            fileName={caseFlowchartNodeShareDocFileName(relativePath)}
          />
        )}
        {onClear !== undefined && (
          <button
            type="button"
            onClick={onClear}
            data-case-node-share-doc-clear=""
            className="text-xs font-medium text-red-700 underline dark:text-red-400"
          >
            {CASE_NODE_SHARE_DOC_CLEAR_TEXT}
          </button>
        )}
      </span>
    </div>
  );
}

export default function CaseFlowchartNodePropertyPanel({
  repairCaseId,
  node,
  allNodes,
  isPickingReference = false,
  onStartPickReference,
  onCancelPickReference,
  pickedReferenceNode = null,
  canEdit,
  draft,
  onDraftChange,
  onPositionDraftChange,
  onDelete,
  resolveNodeDimensions,
}: {
  /**
   * 🔴 그 수리 건의 id — 「관련 파일」 고르기 창의 통로 주소에 그대로 간다
   * (권한의 단위가 건이기 때문이다 — 그 통로의 머리말). 노드 id 가 **아니다**.
   */
  repairCaseId: string;
  /** The screen's currently RENDERED node (server baseline merged with any pending draft/position) — never the raw server value alone. */
  node: CaseFlowchartGraphNode;
  /** Every node in the flowchart, ALSO rendered/merged — so "상대 위치로 이동"'s reference-node picker positions against what's actually on screen, including an unsaved drag on the reference node itself. */
  allNodes: CaseFlowchartGraphNode[];
  /** "화면에서 선택" — 절차 편집기 NodePropertyPanel과 같은 규약이다. */
  isPickingReference?: boolean;
  onStartPickReference?: () => void;
  onCancelPickReference?: () => void;
  pickedReferenceNode?: { nodeId: string; seq: number } | null;
  canEdit: boolean;
  /** The screen's current working draft for THIS node's fields — its own last-saved values when nothing is pending, or whatever the user has typed/picked since. */
  draft: CaseFlowchartNodeDraft;
  onDraftChange: (patch: Partial<CaseFlowchartNodeDraft>) => void;
  /** Sets (or replaces) this node's pending position — same deferred model as drag, just triggered by a button instead of a pointer gesture. */
  onPositionDraftChange: (position: { x: number; y: number }) => void;
  /** 🔴 [노드 삭제] 를 누른 것뿐 — 실제로 지우는 것도 그 뒤처리도(붙은 연결선까지 함께 지우는 일도) 화면(handleDeleteNode)이 한다. [Delete] 키가 부르는 함수와 **같은 하나**다. */
  onDelete: () => void;
  /** The screen's single, already-composed effective-dimension resolver (measured-first, estimate-fallback) — see this file's own DIMENSION SOURCE doc comment above for why this must be the SAME function instance/rule the screen's own double-click-straighten handler uses, not a locally re-derived copy. */
  resolveNodeDimensions: (n: CaseFlowchartGraphNode) => { width: number; height: number };
}) {
  const otherNodes = allNodes.filter((n) => n.id !== node.id);
  const [referenceNodeId, setReferenceNodeId] = useState(otherNodes[0]?.id ?? "");
  // 절차 편집기의 NodePropertyPanel과 같은 규약 — 캔버스에서 고른 결과가 seq와 함께 내려온다.
  const [prevPickedReferenceSeq, setPrevPickedReferenceSeq] = useState(pickedReferenceNode?.seq ?? 0);
  if (pickedReferenceNode && pickedReferenceNode.seq !== prevPickedReferenceSeq) {
    setPrevPickedReferenceSeq(pickedReferenceNode.seq);
    if (pickedReferenceNode.nodeId !== node.id) setReferenceNodeId(pickedReferenceNode.nodeId);
  }

  function handleRelativePosition(direction: RelativeDirection) {
    const reference = otherNodes.find((n) => n.id === referenceNodeId);
    if (!reference) return;
    const referenceDims = resolveNodeDimensions(reference);
    const targetDims = resolveNodeDimensions(node);
    const candidate = computeCenterAlignedRelativePosition(
      { x: reference.positionX, y: reference.positionY, width: referenceDims.width, height: referenceDims.height },
      direction,
      RELATIVE_POSITION_SPACING,
      { width: targetDims.width, height: targetDims.height }
    );

    if (direction !== "LEFT" && direction !== "RIGHT") {
      onPositionDraftChange(candidate);
      return;
    }

    // Column snap (LEFT/RIGHT only) — if a node already occupies this
    // column above the intended position, land exactly on its center-x
    // instead of a slightly different x caused only by this particular
    // reference node's own width.
    const existingNodes: ColumnSnapCandidate[] = allNodes
      .filter((n) => n.id !== node.id && n.id !== reference.id)
      .map((n) => {
        const dims = resolveNodeDimensions(n);
        return { id: n.id, x: n.positionX, y: n.positionY, width: dims.width, height: dims.height };
      });
    const snapped = resolveColumnSnappedRelativePosition({
      candidateX: candidate.x,
      candidateY: candidate.y,
      targetWidth: targetDims.width,
      targetHeight: targetDims.height,
      existingNodes,
      excludeNodeIds: [],
      tolerance: COLUMN_SNAP_TOLERANCE,
    });
    onPositionDraftChange({ x: snapped.x, y: snapped.y });
  }

  return (
    <div className="flex flex-col gap-4 text-xs">
      <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">노드 속성</h3>

      <label className="flex flex-col gap-1">
        제목 (Shift+Enter로 줄바꿈)
        <textarea
          rows={2}
          value={draft.title}
          onChange={(e) => onDraftChange({ title: e.target.value })}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) e.preventDefault();
          }}
          disabled={!canEdit}
          className="resize-y rounded-md border border-zinc-200 bg-white px-2 py-1.5 text-sm whitespace-pre-wrap disabled:opacity-60 dark:border-zinc-700 dark:bg-zinc-900"
        />
      </label>
      <label className="flex flex-col gap-1">
        설명
        <textarea rows={2} value={draft.description} onChange={(e) => onDraftChange({ description: e.target.value })} disabled={!canEdit} className="rounded-md border border-zinc-200 bg-white px-2 py-1.5 text-sm disabled:opacity-60 dark:border-zinc-700 dark:bg-zinc-900" />
      </label>
      <label className="flex flex-col gap-1">
        작업 지시 요약
        <textarea
          rows={4}
          maxLength={4000}
          value={draft.instructions}
          onChange={(e) => onDraftChange({ instructions: e.target.value })}
          disabled={!canEdit}
          className="rounded-md border border-zinc-200 bg-white px-2 py-1.5 text-sm disabled:opacity-60 dark:border-zinc-700 dark:bg-zinc-900"
        />
      </label>
      <label className="flex flex-col gap-1">
        노드 유형
        <select
          value={draft.nodeType}
          onChange={(e) => onDraftChange({ nodeType: e.target.value as RepairCaseFlowchartNodeType })}
          disabled={!canEdit}
          className="rounded-md border border-zinc-200 bg-white px-2 py-1.5 text-sm disabled:opacity-60 dark:border-zinc-700 dark:bg-zinc-900"
        >
          {REPAIR_CASE_FLOWCHART_NODE_TYPE_CODES.map((t) => (
            <option key={t} value={t}>
              {repairCaseFlowchartNodeTypeLabels[t]}
            </option>
          ))}
        </select>
      </label>

      {canEdit && <p className="text-[11px] text-zinc-400 dark:text-zinc-600">위 속성 변경은 화면 상단의 [저장] 버튼으로 다른 변경사항과 함께 저장됩니다.</p>}

      {/*
        🔴 「관련 파일」 — 🔵 **아무것도 그리지 않는 자리가 있다.** 가리킨 것이 없고 고칠
        수도 없는 사람에게는 빈 상자가 하나 느는 것뿐이라 구역 자체를 세우지 않는다
        (제품 모델 쪽 구역과 같은 규율).
        🔴 고르는 창은 설정이 비어 있으면(지금 개발 PC) **제 상태로 스스로 꺼진다** —
        여기서 설정을 판정하지 않는다.
      */}
      {(draft.shareDocRelativePath !== null || canEdit) && (
        <div
          data-case-node-share-doc-section=""
          className="flex flex-col gap-2 rounded-md border border-zinc-200 bg-zinc-50 p-3 dark:border-zinc-800 dark:bg-zinc-950"
        >
          <h4 className="text-xs font-semibold text-zinc-900 dark:text-zinc-50">{CASE_NODE_SHARE_DOC_TITLE}</h4>
          <p className="text-[11px] text-zinc-500 dark:text-zinc-400">{CASE_NODE_SHARE_DOC_HINT}</p>

          {draft.shareDocRelativePath === null ? (
            <p className="text-[11px] text-zinc-500 dark:text-zinc-400">{CASE_NODE_SHARE_DOC_EMPTY_TEXT}</p>
          ) : (
            <CaseFlowchartNodeShareDocRow
              relativePath={draft.shareDocRelativePath}
              {...(canEdit ? { onClear: () => onDraftChange({ shareDocRelativePath: null }) } : {})}
            />
          )}

          {canEdit && (
            <>
              <p className="text-[11px] text-zinc-500 dark:text-zinc-400">{CASE_NODE_SHARE_DOC_REPLACE_HINT}</p>
              <CaseFlowchartNodeShareDocPicker
                repairCaseId={repairCaseId}
                onPick={(relativePath) => onDraftChange({ shareDocRelativePath: relativePath })}
              />
              <p className="text-[11px] text-zinc-400 dark:text-zinc-600">{CASE_NODE_SHARE_DOC_SAVE_NOTICE}</p>
            </>
          )}
        </div>
      )}

      {canEdit && otherNodes.length > 0 && (
        <div className="flex flex-col gap-2 rounded-md border border-emerald-200 bg-emerald-50 p-3 dark:border-emerald-900 dark:bg-emerald-950">
          <h4 className="text-xs font-semibold text-emerald-900 dark:text-emerald-300">상대 위치로 이동</h4>
          <div className="flex flex-col gap-1">
            <label htmlFor="case-relative-reference-node">기준 노드 선택</label>
            <div className="flex items-center gap-2">
              <select
                id="case-relative-reference-node"
                value={referenceNodeId}
                onChange={(e) => setReferenceNodeId(e.target.value)}
                className="min-w-0 flex-1 rounded-md border border-zinc-200 bg-white px-2 py-1.5 text-sm dark:border-zinc-700 dark:bg-zinc-900"
              >
                {otherNodes.map((n) => (
                  <option key={n.id} value={n.id}>
                    {n.title}
                  </option>
                ))}
              </select>
              {(onStartPickReference || onCancelPickReference) && (
                <button
                  type="button"
                  onClick={() => (isPickingReference ? onCancelPickReference?.() : onStartPickReference?.())}
                  aria-pressed={isPickingReference}
                  className={`shrink-0 rounded-md border px-2 py-1.5 text-xs ${
                    isPickingReference
                      ? "border-emerald-700 bg-emerald-700 text-white"
                      : "border-emerald-400 text-emerald-900 hover:bg-emerald-100 dark:border-emerald-700 dark:text-emerald-300 dark:hover:bg-emerald-900"
                  }`}
                >
                  {isPickingReference ? "선택 취소" : "화면에서 선택"}
                </button>
              )}
            </div>
            {isPickingReference && <p className="text-emerald-800 dark:text-emerald-300">그래프에서 기준으로 삼을 노드를 클릭하세요.</p>}
          </div>
          <div className="flex flex-wrap gap-2">
            {(
              [
                ["LEFT", "왼쪽"],
                ["RIGHT", "오른쪽"],
                ["UP", "위"],
                ["DOWN", "아래"],
              ] as [RelativeDirection, string][]
            ).map(([direction, label]) => (
              <button
                key={direction}
                type="button"
                disabled={!referenceNodeId}
                onClick={() => handleRelativePosition(direction)}
                className="rounded-md border border-emerald-400 px-2.5 py-1 text-xs font-medium text-emerald-900 hover:bg-emerald-100 disabled:opacity-50 dark:border-emerald-700 dark:text-emerald-300 dark:hover:bg-emerald-900"
              >
                {label}
              </button>
            ))}
          </div>
        </div>
      )}

      {canEdit && (
        <div className="flex flex-col gap-2 rounded-md border border-red-200 bg-red-50 p-3 dark:border-red-900 dark:bg-red-950">
          <h4 className="text-xs font-semibold text-red-900 dark:text-red-300">노드 삭제</h4>
          <button
            type="button"
            onClick={onDelete}
            /* 🔵 키 이야기는 **여기까지**다. 이 편집기의 상시 안내는 절차 쪽에서
               두 번 세웠다 두 번 다 지워 달라는 요청을 받았다(커밋 d57f664a) —
               툴팁은 자리를 안 차지하고 찾는 사람만 본다. */
            title="[Delete] 키로도 지울 수 있습니다"
            className="self-start rounded-md border border-red-400 px-3 py-1.5 text-sm font-medium text-red-900 hover:bg-red-100 disabled:opacity-50 dark:border-red-700 dark:text-red-300 dark:hover:bg-red-900"
          >
            노드 삭제
          </button>
        </div>
      )}
    </div>
  );
}
