"use client";

import { useState } from "react";
import { MANUAL_TECHNICAL_NODE_TYPE_CODES, procedureNodeTypeLabels, type ManualTechnicalNodeType } from "@/lib/domain/procedure-template-types";
import { resolveEffectiveNodePosition, computeCenterAlignedRelativePosition } from "@/lib/graph-editor-core/layout";
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
 * "노드 추가" is used, the new node is placed directly below it, as an
 * explicit user-position override so it survives a refresh regardless of
 * the auto-layout fallback. With no selection, the call omits `position`
 * entirely and the mutation falls back to its original default stacking —
 * unchanged. This is placement only — it never creates an edge between the
 * selected node and the new one.
 *
 * 🔴 2026-11-05 — 「바로 아래」가 **중심점 기준**이 됐다: 가로는 두 노드의
 * 중심 x 를 맞추고, 세로는 두 중심 사이가 눈금(150)이다. 그리고 기준으로 삼는
 * 자리가 저장된 position_x/y 가 아니라 **화면에 그려진 자리**다 — 아래
 * handleCreate 의 주석에 어긋났던 실측값이 있다.
 *
 * ── 🔴 2026-11-20(조각 4) — **서버를 여기서 안 부른다** ──────────────────
 * 쓰는 분의 요청: 「노드·연결선 추가·삭제·재연결은 [저장] 없이 바로 저장되는데,
 * 그것들도 [저장]을 눌러야 저장되도록 해 달라.」 그래서 이 패널은 이제
 * createProcedureTemplateNodeAction 을 부르지 않는다 — 무엇을 만들지만 적어
 * 화면(ProcedureTemplateEditorScreen)에 넘기고, 화면이 그것을 모아 두었다가
 * [저장]에서 **같은 액션을** 부른다(서버 쪽은 한 글자도 안 바뀌었다).
 *
 * 🔵 그래서 `templateId`·`expectedTemplateUpdatedAt`·`onSaved` 가 사라졌다 —
 * 셋 다 그 호출에만 쓰이던 것이다. `isSubmitting`·`errorMessage` 도 함께 사라졌다:
 * 여기서는 기다릴 일도 실패할 일도 없다(실패는 [저장] 때 화면 위쪽 한 자리에서
 * 알린다 — 실패를 알리는 자리를 하나로 모은 것이지 없앤 것이 아니다).
 */
export default function CreateNodePanel({
  onQueueCreate,
  selectedNode,
  resolveNodeDimensions,
  renderedPositions,
}: {
  // 🔴 서버에 보내지 않고 **모아 둔다.** 화면이 임시 번호를 찍어 목록 뒤에 붙이고,
  // 그림에는 그 자리에서 새 노드가 나타난다(저장 전 미리보기).
  // 🔴 블록 주석으로 적으면 안 된다 — 까닭은 NodePropertyPanel 의 nodeTypeOptions
  //    위에 적어 두었다(화면 시험의 주석 걷어내기가 `{` 바로 뒤의 `/*` 를 JSX
  //    주석으로 읽어 수천 자를 통째로 지운다).
  onQueueCreate: (input: { nodeType: ManualTechnicalNodeType; title: string; position: { x: number; y: number } | null }) => void;
  selectedNode: EditorNodeRow | null;
  /** 5C-6D-1D — the screen's single, already-composed effective-dimension resolver (measured-first, estimate-fallback; same instance NodePropertyPanel's own relative-position math uses). Used ONLY for `selectedNode`'s size below — the about-to-be-created node itself has no rendered instance to measure yet, so its own size still comes from the plain computeNodeDimensions estimate, unchanged. */
  resolveNodeDimensions: (n: EditorNodeRow) => { width: number; height: number };
  /**
   * **그림이 실제로 그린 자리**, 노드 id 마다(2026-11-05). NodePropertyPanel 이
   * 받는 것과 같은 한 벌이고, 같은 까닭으로 여기서 다시 세지 않는다.
   * 🔵 지도에 없으면 저장된 자리로 떨어진다(전 동작).
   */
  renderedPositions?: ReadonlyMap<string, { x: number; y: number }>;
}) {
  const [nodeType, setNodeType] = useState<ManualTechnicalNodeType>("TASK");
  const [title, setTitle] = useState("");

  function handleCreate() {
    // Round-2 alignment fix — the placement math needs both nodes' ACTUAL
    // rendered sizes to center the new node under the selected one; a plain
    // left-edge copy silently breaks the moment the two titles produce
    // different widths. 5C-6D-1D — selectedNode's size comes from
    // resolveNodeDimensions (measured-first: React Flow's own rendered size
    // when available, the same estimate as before only as a fallback)
    // instead of the estimate alone, since selectedNode already exists on
    // screen and can actually be measured; the new node being created has
    // no rendered instance yet, so its own size is still the plain
    // estimate — there is nothing to measure it against.
    //
    // 🔴 2026-11-05 — **중심점 기준으로** 고친 두 가지.
    //  ① 함수를 computeCenterAlignedRelativePosition 으로 갈아탔다. 그쪽의
    //     DOWN 은 세로 간격을 **중심 간 간격**으로 잡는다 — 제목 줄 수가 달라
    //     높이가 다른 노드 아래에 붙일 때 전에는 간격이 150 이 아니었다.
    //  ② 기준 노드의 자리를 **화면에 그려진 자리**로 읽는다. 전에는 저장된
    //     position_x/y 였고, 기술 작업 절차에서 그 값은 「만든 차례대로 쌓은
    //     숫자」(x 가 전부 0)다. 실측으로, 화면 x = −346 에 있는 노드를 골라
    //     만든 노드가 저장 좌표 (0, 150) 아래인 (−177.5, 300)에 꽂혔다.
    // 🔵 받침(지도에 없을 때)은 전과 같은 저장 좌표다.
    const selectedPosition = selectedNode
      ? renderedPositions?.get(selectedNode.id) ??
        resolveEffectiveNodePosition(
          { positionX: selectedNode.positionX, positionY: selectedNode.positionY, userPositionX: selectedNode.userPositionX, userPositionY: selectedNode.userPositionY },
          "USER"
        )
      : null;
    const newNodeDimensions = computeNodeDimensions({ title, shape: NODE_VISUAL_CONFIG[getNodeChipVisual(nodeType).semanticType].shape });
    const position =
      selectedNode && selectedPosition
        ? computeCenterAlignedRelativePosition(
            { ...selectedPosition, ...resolveNodeDimensions(selectedNode) },
            "DOWN",
            BELOW_SELECTED_SPACING,
            { width: newNodeDimensions.width, height: newNodeDimensions.height }
          )
        : null;
    onQueueCreate({ nodeType, title, position });
    // 🔵 제목만 비운다 — 유형은 그대로 둔다. 노드를 여러 개 이어 만들 때 같은 유형을
    //    고르는 일이 보통이고, 전에도(서버를 바로 부르던 시절에도) 그랬다.
    setTitle("");
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
        disabled={title.trim().length === 0}
        onClick={handleCreate}
        className="self-start rounded-md bg-blue-700 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-800 disabled:opacity-50"
      >
        노드 추가
      </button>
      {/*
        🔴 2026-11-20(조각 4) — **여기서 서버로 가지 않는다**고 적어 둔다. 전에는
        누르는 순간 저장돼서 그림에 나타나는 것이 곧 증거였는데, 이제는 그림에
        나타나도 아직 안 간 것이다. 안 적으면 「추가했으니 됐다」고 나가는 사람이
        생기고(나가기 확인이 한 번 더 묻기는 한다), 그 오해가 이번 일의 반대짝이다.
      */}
      <p className="text-blue-700 dark:text-blue-400">추가한 노드는 화면 상단의 [저장]을 눌러야 서버에 저장됩니다.</p>
    </div>
  );
}
