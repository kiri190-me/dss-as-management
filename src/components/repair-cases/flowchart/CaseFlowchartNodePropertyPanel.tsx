"use client";

import { useState } from "react";
import { REPAIR_CASE_FLOWCHART_NODE_TYPE_CODES, repairCaseFlowchartNodeTypeLabels, type RepairCaseFlowchartNodeType } from "@/lib/domain/repair-case-flowchart-types";
import { deleteRepairCaseFlowchartNodeAction } from "@/lib/server/actions/repair-case-flowchart-graph";
import { computeCenterAlignedRelativePosition, resolveColumnSnappedRelativePosition, type RelativeDirection, type ColumnSnapCandidate } from "@/lib/graph-editor-core/layout";
import type { CaseFlowchartGraphNode } from "./CaseFlowchartGraph";

export type CaseFlowchartNodeDraft = { title: string; description: string; nodeType: RepairCaseFlowchartNodeType };

/** Same fixed spacing as the procedure editor's "상대 위치로 이동" (NodePropertyPanel.tsx) — vertical reuses the server mutation's own default node-stacking gap for consistency. */
const RELATIVE_POSITION_SPACING = { horizontal: 280, vertical: 150 } as const;

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
 * Delete remains its own immediate action — a destructive operation, not a
 * "draft" (see CaseFlowchartEditorScreen's own SAVE CONTRACT doc comment
 * for the create/delete-stays-immediate decision).
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
export default function CaseFlowchartNodePropertyPanel({
  node,
  allNodes,
  repairCaseId,
  flowchartId,
  canEdit,
  expectedFlowchartUpdatedAt,
  draft,
  onDraftChange,
  onPositionDraftChange,
  onDeleted,
  resolveNodeDimensions,
}: {
  /** The screen's currently RENDERED node (server baseline merged with any pending draft/position) — never the raw server value alone. */
  node: CaseFlowchartGraphNode;
  /** Every node in the flowchart, ALSO rendered/merged — so "상대 위치로 이동"'s reference-node picker positions against what's actually on screen, including an unsaved drag on the reference node itself. */
  allNodes: CaseFlowchartGraphNode[];
  repairCaseId: string;
  flowchartId: string;
  canEdit: boolean;
  expectedFlowchartUpdatedAt: string;
  /** The screen's current working draft for THIS node's fields — its own last-saved values when nothing is pending, or whatever the user has typed/picked since. */
  draft: CaseFlowchartNodeDraft;
  onDraftChange: (patch: Partial<CaseFlowchartNodeDraft>) => void;
  /** Sets (or replaces) this node's pending position — same deferred model as drag, just triggered by a button instead of a pointer gesture. */
  onPositionDraftChange: (position: { x: number; y: number }) => void;
  onDeleted: (newUpdatedAt: string) => void;
  /** The screen's single, already-composed effective-dimension resolver (measured-first, estimate-fallback) — see this file's own DIMENSION SOURCE doc comment above for why this must be the SAME function instance/rule the screen's own double-click-straighten handler uses, not a locally re-derived copy. */
  resolveNodeDimensions: (n: CaseFlowchartGraphNode) => { width: number; height: number };
}) {
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const otherNodes = allNodes.filter((n) => n.id !== node.id);
  const [referenceNodeId, setReferenceNodeId] = useState(otherNodes[0]?.id ?? "");

  const [isDeleting, setIsDeleting] = useState(false);
  const [deleteBlockedMessage, setDeleteBlockedMessage] = useState<string | null>(null);

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

  async function handleDelete() {
    setIsDeleting(true);
    setErrorMessage(null);
    setDeleteBlockedMessage(null);
    const result = await deleteRepairCaseFlowchartNodeAction({ repairCaseId, flowchartId, nodeId: node.id, expectedFlowchartUpdatedAt });
    setIsDeleting(false);
    if (!result.ok) {
      if ("blockingEdgeCount" in result) {
        setDeleteBlockedMessage(`이 노드에 연결된 분기가 ${result.blockingEdgeCount}개 있어 삭제할 수 없습니다. 먼저 연결된 분기를 삭제해 주세요.`);
        return;
      }
      setErrorMessage(result.message);
      return;
    }
    onDeleted(result.updatedAt);
  }

  return (
    <div className="flex flex-col gap-4 text-xs">
      <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">노드 속성</h3>
      {canEdit && (
        <p className="text-zinc-500 dark:text-zinc-400">변경 내용은 그래프에 즉시 표시되며, 화면 상단의 [저장] 버튼을 눌러야 서버에 저장됩니다.</p>
      )}

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

      {canEdit && otherNodes.length > 0 && (
        <div className="flex flex-col gap-2 rounded-md border border-emerald-200 bg-emerald-50 p-3 dark:border-emerald-900 dark:bg-emerald-950">
          <h4 className="text-xs font-semibold text-emerald-900 dark:text-emerald-300">상대 위치로 이동</h4>
          <label className="flex flex-col gap-1">
            기준 노드 선택
            <select value={referenceNodeId} onChange={(e) => setReferenceNodeId(e.target.value)} className="rounded-md border border-zinc-200 bg-white px-2 py-1.5 text-sm dark:border-zinc-700 dark:bg-zinc-900">
              {otherNodes.map((n) => (
                <option key={n.id} value={n.id}>
                  {n.title}
                </option>
              ))}
            </select>
          </label>
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
          {deleteBlockedMessage && <p className="text-red-700 dark:text-red-400">{deleteBlockedMessage}</p>}
          <button
            type="button"
            disabled={isDeleting}
            onClick={() => void handleDelete()}
            className="self-start rounded-md border border-red-400 px-3 py-1.5 text-sm font-medium text-red-900 hover:bg-red-100 disabled:opacity-50 dark:border-red-700 dark:text-red-300 dark:hover:bg-red-900"
          >
            {isDeleting ? "삭제 중..." : "노드 삭제"}
          </button>
        </div>
      )}

      {errorMessage && <p className="text-red-600 dark:text-red-400">{errorMessage}</p>}
    </div>
  );
}
