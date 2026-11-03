"use client";

import ProcedureFlowGraph, { type ProcedureFlowGraphNodeMark } from "../ProcedureFlowGraph";
import type { JumpStatusTone } from "@/lib/domain/procedure-execution-jump";
import type { ExecutionDetail } from "@/lib/db/queries/procedure-case-execution";

/**
 * 「전체 단계 보기」 팝업 안의 **플로우차트**(2026-11-02, 조각 10) — 절차 전체를
 * 보고, 상태를 읽고, 옮길 자리를 고르는 것만 한다.
 *
 * ──────────────────────────────────────────────────────────────────────
 * 🔴 왜 따로 만들었나 — 이웃 ProcedureStartPickerGraph 와 가른 까닭
 * ──────────────────────────────────────────────────────────────────────
 * 편집기 그림(ProcedureFlowGraph)을 감싸 쓰는 **까닭 자체는 같다** — 노드 모양·
 * 색·아이콘, 갈래별 선 모양과 라우팅, 저장된 사용자 배치의 해석을 다시 적으면
 * 같은 절차가 화면마다 다르게 보인다. 그 설명은 ProcedureStartPickerGraph 의
 * 머리말에 있고 여기 옮겨 적지 않는다.
 *
 * 가른 것은 **받는 것과 얹는 것**이다:
 *  - 저쪽은 절차 **하나를 고르는** 창이라 ExecutableTemplateGraph(이름·코드까지)를
 *    통째로 받고, 여기는 **이미 정해진 실행 하나**라 그 실행이 들고 온 노드·간선·
 *    갈래만 받는다.
 *  - 저쪽은 「고를 수 있는 노드」를 눌러도 안 골라지게 막고(pickableNodeIds),
 *    여기는 **아무 칸이나 골라진다** — 고른 뒤에 왜 못 옮기는지를 창이 한 줄로
 *    말해 주는 쪽이 낫다(완료된 칸을 눌렀는데 아무 반응이 없으면 고장으로
 *    읽힌다). 막는 것은 단추이고, 서버가 제 손으로 다시 가른다.
 *  - 여기는 **상태 딱지**를 얹는다(nodeMarks). 저쪽에는 얹을 상태가 없다.
 *
 * 둘을 한 부품으로 합치면 저 셋이 전부 조건이 되어, 지금 열여덟 줄짜리 감싸개가
 * if 네 개를 품은 것이 된다.
 */
export default function ExecutionStepsGraph({
  templateId,
  templateCategory,
  nodes,
  edges,
  focusNodeId,
  focusSeq,
  highlightedNodeIds,
  nodeMarks,
  onPickedNodeChange,
}: {
  /** procedure_templates.id — 그림이 오류 배지 링크를 만드는 데 쓴다. */
  templateId: string;
  templateCategory: ExecutionDetail["templateCategory"];
  nodes: ExecutionDetail["graphNodes"];
  edges: ExecutionDetail["flowEdges"];
  /** 다시 태어날 때 골라져 있을 **절차 노드** id. 없으면 아무것도 안 골라진 채로 뜬다. */
  focusNodeId: string | null;
  /** 검색 결과를 누를 때마다 올라가는 번호 — 같은 노드를 다시 눌러도 카메라가 움직이게 한다. */
  focusSeq: number;
  /** 검색에 걸린 노드. null 이면 아무것도 안 흐려진다. */
  highlightedNodeIds: readonly string[] | null;
  /** 절차 노드 id → 그 노드의 실행 상태 딱지. */
  nodeMarks: ReadonlyMap<string, { label: string; tone: JumpStatusTone }>;
  /** 그림에서 고른 **절차 노드** id. 창이 그것으로 실행 줄을 되찾는다. */
  onPickedNodeChange: (nodeId: string | null) => void;
}) {
  // 실행 상태의 세기(네 이름)를 그림이 아는 세기로 옮긴다. 🔴 그림은 「진행 중」
  // 이라는 낱말을 몰라야 한다 — 같은 자리에 다른 뜻의 딱지를 붙이는 날이 온다
  // (ProcedureFlowGraphNodeMark 의 머리말).
  const graphMarks = new Map<string, ProcedureFlowGraphNodeMark>();
  for (const [nodeId, mark] of nodeMarks) {
    const tone: ProcedureFlowGraphNodeMark["tone"] =
      mark.tone === "CURRENT" ? "STRONG" : mark.tone === "DONE" ? "MUTED" : mark.tone === "BLOCKED" ? "WARN" : "PLAIN";
    graphMarks.set(nodeId, { label: mark.label, tone });
  }

  return (
    <ProcedureFlowGraph
      key={`${templateId}:${focusSeq}`}
      templateId={templateId}
      nodes={nodes}
      edges={edges}
      initialSelectedNodeId={focusNodeId}
      showChrome={false}
      graphHeight={360}
      highlightedNodeIds={highlightedNodeIds}
      nodeMarks={graphMarks}
      // 불러오기 창의 그림과 **같은 조건**이다 — 손으로 만든(MANUAL) 절차의
      // position_x/y 는 만든 차례대로 쌓은 값이라 배치로서 뜻이 없다. 저장된
      // 사용자 배치가 있으면 그쪽이 언제나 이긴다(resolveBaselinePosition).
      useAutoLayoutForUnpositionedNodes={templateCategory === "TECHNICAL_TASK"}
      onNodeSelectionChange={onPickedNodeChange}
    />
  );
}
