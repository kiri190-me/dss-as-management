"use client";

import ProcedureFlowGraph from "../ProcedureFlowGraph";
import type { ExecutableTemplateGraph } from "@/lib/db/queries/procedure-case-execution";

/**
 * 「기술 절차 불러오기」 창 안의 **플로우차트**(2026-11-02, 조각 7) — 보고
 * 고르는 것만 한다.
 *
 * ──────────────────────────────────────────────────────────────────────
 * 🔴 왜 새로 그리지 않고 ProcedureFlowGraph 를 감쌌나
 * ──────────────────────────────────────────────────────────────────────
 * 그 그림에는 이 창이 혼자 다시 만들 수 없는 것이 들어 있다 — 노드 모양·색·아이콘
 * (procedure-visual-language.ts), 갈래별 선 모양과 라우팅(procedure-edge-routing.ts),
 * 저장된 사용자 배치의 해석(resolveEffectiveNodePosition). 다시 적으면 같은 절차가
 * 절차 상세 화면과 이 창에서 **다르게 보인다.**
 *
 * 절차 상세 화면(ProcedureTemplateDetailScreen)의 쓰임을 그대로 따른다 —
 * `editable` 을 안 넘기므로 기본값 false 이고, 그 값 하나가 노드 드래그
 * (`nodesDraggable={editable && …}`)와 경로점 편집(`resolveEffectiveEdgeRoute` 가
 * USER 배치에서만 경로를 돌려준다)을 **둘 다** 닫는다. 여기서 추가로 막을 것이
 * 없다는 뜻이다.
 *
 * ──────────────────────────────────────────────────────────────────────
 * 🔴 그대로는 못 썼다 — 두 가지
 * ──────────────────────────────────────────────────────────────────────
 *  1. **검색 칸이 둘**이 된다. 그 그림은 제 조작 줄(시트 필터·배치·검색)을 함께
 *     그리는데, 이 창에는 이미 절차 드롭다운과 노드 검색이 있다. `showChrome={false}`
 *     로 조작 줄·범례·안내를 접는다.
 *  2. **검색에 걸린 노드를 환하게** 할 길이 없었다. 그 그림의 흐리기는 「고른 노드의
 *     이웃인가」 하나뿐이다. `highlightedNodeIds` 를 더해 바깥에서 건 강조를 받는다.
 *
 * 둘 다 **선택 인자**라 지금까지의 두 호출부(절차 상세 · 편집기)는 글자 하나 안
 * 바뀐다.
 *
 * ──────────────────────────────────────────────────────────────────────
 * 고른 노드를 어떻게 주고받는가 — 그림이 제 선택을 들고 있다
 * ──────────────────────────────────────────────────────────────────────
 * ProcedureFlowGraph 는 선택을 **제 안에** 들고 있고 바깥에서 밀어 넣는 길은
 * `initialSelectedNodeId`(처음 한 번) 뿐이다. 그래서:
 *
 *  - **그림에서 누르면** onNodeSelectionChange 로 올라온다 → 그것이 「고른 것」이다.
 *  - **검색 결과를 누르면** 부모가 `focusSeq` 를 올리고, 그 값이 `key` 에 들어 있어
 *    그림이 다시 태어난다 → 그 노드가 골라진 채로 뜨고 카메라가 거기로 간다
 *    (handleCanvasInit 의 한 번짜리 fitView).
 *
 * 🔴 `focusSeq` 가 **번호**인 까닭: 같은 결과를 두 번 누르면 노드 id 는 그대로라
 * key 가 안 바뀌고, 그러면 카메라도 안 움직인다. 사람 눈에는 「두 번째부터 안
 * 먹는다」로 보인다.
 *
 * 🔴 **실행 행이 없는 노드는 눌러도 안 골라진다.** onNodeClickIntercept 가 true 를
 * 돌려주면 그 그림은 선택을 건드리지 않는다(편집기의 「화면에서 선택」 모드가 쓰는
 * 바로 그 길). 서버도 같은 판정을 제 손으로 다시 한다 — 여기 막는 것은 편의다.
 */
export default function ProcedureStartPickerGraph({
  template,
  focusNodeId,
  focusSeq,
  highlightedNodeIds,
  pickableNodeIds,
  onPickedNodeChange,
}: {
  template: ExecutableTemplateGraph;
  /** 다시 태어날 때 골라져 있을 노드. 없으면 아무것도 안 골라진 채로 뜬다. */
  focusNodeId: string | null;
  /** 검색 결과를 누를 때마다 올라가는 번호 — 같은 노드를 다시 눌러도 카메라가 움직이게 한다. */
  focusSeq: number;
  /** 검색에 걸린 노드. null 이면 아무것도 안 흐려진다. */
  highlightedNodeIds: readonly string[] | null;
  /** 출발점으로 고를 수 있는 노드(START·참고 문서는 빠져 있다). */
  pickableNodeIds: ReadonlySet<string>;
  onPickedNodeChange: (nodeId: string | null) => void;
}) {
  return (
    <ProcedureFlowGraph
      key={`${template.id}:${focusSeq}`}
      templateId={template.id}
      nodes={template.nodes}
      edges={template.edges}
      initialSelectedNodeId={focusNodeId}
      showChrome={false}
      graphHeight={360}
      highlightedNodeIds={highlightedNodeIds}
      // 절차 상세 화면과 같은 조건 — 손으로 만든(MANUAL) 절차의 position_x/y 는
      // 만든 차례대로 쌓은 값이라 배치로서 뜻이 없다. 저장된 사용자 배치가 있으면
      // 그쪽이 언제나 이긴다(resolveBaselinePosition).
      useAutoLayoutForUnpositionedNodes={template.category === "TECHNICAL_TASK"}
      onNodeClickIntercept={(nodeId) => !pickableNodeIds.has(nodeId)}
      onNodeSelectionChange={onPickedNodeChange}
    />
  );
}
