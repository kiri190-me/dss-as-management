"use client";

import { useState } from "react";
import { MANUAL_TECHNICAL_NODE_TYPE_CODES, procedureNodeTypeLabels, type ManualTechnicalNodeType } from "@/lib/domain/procedure-template-types";
import { createProcedureTemplateNodeAction } from "@/lib/server/actions/procedure-template-editor";
import { resolveEffectiveNodePosition, computeRelativePosition } from "@/lib/graph-editor-core/layout";
import { NODE_VISUAL_CONFIG, getNodeChipVisual, computeNodeDimensions } from "@/lib/domain/procedure-visual-language";
import type { EditorNodeRow } from "@/lib/db/queries/procedure-template-editor";

/** Phase 5C-5B usability — same vertical spacing convention as "상대 위치로 이동" (NodePropertyPanel) and the mutation's own default node-stacking gap. Only the vertical figure is used here — a selection-aware add always places directly below, never to a side. */
const BELOW_SELECTED_SPACING = { horizontal: 280, vertical: 150 } as const;

/**
 * Phase 5C-5B — manual TECHNICAL_TASK node authoring v1. Only ever rendered
 * for a TECHNICAL_TASK DRAFT (see ProcedureTemplateEditorScreen's own
 * category gate) — createProcedureTemplateNodeAction independently
 * re-verifies this server-side regardless. nodeType is restricted to the 7
 * approved manual-authoring types (MANUAL_TECHNICAL_NODE_TYPE_CODES) —
 * CHECKLIST/TROUBLESHOOTING are never offered here since neither has a
 * manual-authoring path for their child content yet. No reason field —
 * creation never requires one (see createProcedureTemplateNode's own doc
 * comment).
 *
 * Phase 5C-5B usability — when a node is selected in the graph at the time
 * "노드 추가" is used, the new node is placed directly below it, center-
 * aligned (same x), as an explicit user-position override so it survives a
 * refresh regardless of the auto-layout fallback. With no selection, the
 * call omits `position` entirely and the mutation falls back to its
 * original default stacking — unchanged. This is placement only — it never
 * creates an edge between the selected node and the new one.
 */
export default function CreateNodePanel({
  templateId,
  expectedTemplateUpdatedAt,
  onSaved,
  selectedNode,
  resolveNodeDimensions,
}: {
  templateId: string;
  expectedTemplateUpdatedAt: string;
  onSaved: (newUpdatedAt: string) => void;
  selectedNode: EditorNodeRow | null;
  /** 5C-6D-1D — the screen's single, already-composed effective-dimension resolver (measured-first, estimate-fallback; same instance NodePropertyPanel's own relative-position math uses). Used ONLY for `selectedNode`'s width below — the about-to-be-created node itself has no rendered instance to measure yet, so its own width still comes from the plain computeNodeDimensions estimate, unchanged. */
  resolveNodeDimensions: (n: EditorNodeRow) => { width: number; height: number };
}) {
  const [nodeType, setNodeType] = useState<ManualTechnicalNodeType>("TASK");
  const [title, setTitle] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  async function handleCreate() {
    setIsSubmitting(true);
    setErrorMessage(null);
    // Round-2 alignment fix — computeRelativePosition needs both nodes'
    // ACTUAL rendered widths to center the new node under the selected
    // one; a plain left-edge copy silently breaks the moment the two
    // titles produce different widths. 5C-6D-1D — selectedNode's width now
    // comes from resolveNodeDimensions (measured-first: React Flow's own
    // rendered size when available, the same estimate as before only as a
    // fallback) instead of the estimate alone, since selectedNode already
    // exists on screen and can actually be measured; the new node being
    // created has no rendered instance yet, so its own width is still the
    // plain estimate — there is nothing to measure it against.
    const position = selectedNode
      ? computeRelativePosition(
          {
            ...resolveEffectiveNodePosition(
              { positionX: selectedNode.positionX, positionY: selectedNode.positionY, userPositionX: selectedNode.userPositionX, userPositionY: selectedNode.userPositionY },
              "USER"
            ),
            width: resolveNodeDimensions(selectedNode).width,
          },
          "DOWN",
          BELOW_SELECTED_SPACING,
          computeNodeDimensions({ title, shape: NODE_VISUAL_CONFIG[getNodeChipVisual(nodeType).semanticType].shape }).width
        )
      : null;
    const result = await createProcedureTemplateNodeAction({ templateId, nodeType, title, position, expectedTemplateUpdatedAt });
    setIsSubmitting(false);
    if (!result.ok) {
      setErrorMessage(result.message);
      return;
    }
    setTitle("");
    onSaved(result.updatedAt);
  }

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-blue-200 bg-blue-50 p-3 text-xs dark:border-blue-900 dark:bg-blue-950">
      <h3 className="text-sm font-semibold text-blue-900 dark:text-blue-300">새 노드 추가</h3>
      {selectedNode && (
        <p className="text-blue-700 dark:text-blue-400">
          &quot;{selectedNode.title}&quot; 바로 아래, 가운데 정렬된 위치에 추가됩니다.
        </p>
      )}
      <label className="flex flex-col gap-1">
        노드 유형
        <select
          value={nodeType}
          onChange={(e) => setNodeType(e.target.value as ManualTechnicalNodeType)}
          className="rounded-md border border-zinc-200 bg-white px-2 py-1.5 text-sm dark:border-zinc-700 dark:bg-zinc-900"
        >
          {MANUAL_TECHNICAL_NODE_TYPE_CODES.map((t) => (
            <option key={t} value={t}>
              {procedureNodeTypeLabels[t]}
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
            // Shift+Enter inserts a newline (native textarea behavior, left
            // alone); plain Enter is swallowed — it never inserts a line
            // break and there is no Enter-to-submit behavior to accidentally
            // trigger here (only the explicit "노드 추가" button submits).
            if (e.key === "Enter" && !e.shiftKey) e.preventDefault();
          }}
          className="resize-y rounded-md border border-zinc-200 bg-white px-2 py-1.5 text-sm whitespace-pre-wrap dark:border-zinc-700 dark:bg-zinc-900"
        />
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
