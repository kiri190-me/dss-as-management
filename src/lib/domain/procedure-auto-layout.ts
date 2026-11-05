import {
  computeLayeredGraphLayout,
  hasUserLayoutOverride,
  resolveEffectiveNodePosition,
  type LayeredLayoutEdge,
  type LayeredLayoutNode,
} from "@/lib/graph-editor-core/layout";
import { NODE_VISUAL_CONFIG, computeNodeDimensions, getNodeChipVisual } from "./procedure-visual-language";
import type { ProcedureNodeType } from "./procedure-template-types";

/**
 * ============================================================================
 * 자리 값이 없는 노드를 **그림이 어디에 세우는가** — 한 곳에서만 센다
 * ============================================================================
 * 기술작업절차(MANUAL)의 노드는 position_x/position_y 가 「만든 차례대로 쌓은
 * 숫자」일 뿐 사람이 그린 자리가 아니다. 그래서 이 그림은 저장된 자리가 없는 칸을
 * **제 나름의 자동 배치**로 그린다(ProcedureFlowGraph 의
 * useAutoLayoutForUnpositionedNodes). 그 계산을 여기로 꺼낸 것이 이 파일이다.
 *
 * 2026-11-04 까지 이 계산은 ProcedureFlowGraph.tsx 안에 그대로 적혀 있었다.
 * 꺼낸 까닭은 하나다 — **유령 칸과 진짜 노드가 같은 자로 재어지는지를 값으로
 * 시험할 수 있어야** 하기 때문이다(그림 부품은 @xyflow/react 의 .css 를 물고 있어
 * import 자체가 던진다). 꺼내면서 셈을 한 줄도 안 바꿨다: 폭·pinnedX·눈금 모두
 * 전에 인라인으로 적혀 있던 그대로다.
 *
 * ──────────────────────────────────────────────────────────────────────
 * 🔴 유령을 **함께 센다** (2026-11-04 사용자 결정 — 「A로 가자」)
 * ──────────────────────────────────────────────────────────────────────
 * 전에는 반대였다. 줄기 B-⑧(2026-11-03)은 「유령은 자리 계산에 안 섞는다」를
 * 결정으로 삼았고, 까닭은 「기존 노드가 유령 때문에 움직이면 안 된다」였다.
 *
 * **그 전제가 틀렸다**(2026-11-04 실측). 움직이는 것은 유령 탓이 아니라 **노드가
 * 하나 느는 것** 자체다 — 채택하는 순간 자리 값 없는 22개가 전부 110~140px 씩
 * 비켜섰다. 유령을 빼 두어도 그 움직임은 「넣기」 단추를 누른 뒤에 똑같이 일어났고,
 * 게다가 유령은 저장 좌표계에 · 둘레는 자동 배치 좌표계에 서서 **미리 보기 자체가
 * 엉뚱한 자리**였다.
 *
 * 그래서 뒤집었다. 유령을 함께 세우면:
 *  - 🟢 유령을 켠 그림이 **채택 뒤와 글자 그대로 같은 좌표**가 된다. 넣어도 더는
 *    아무것도 안 움직인다 — 미리 보기가 진짜 미리 보기가 된다.
 *  - 🔴 대신 **유령을 켜는 순간** 둘레가 한 번 움직인다. 이것이 의도다: 움직임을
 *    「넣는 순간」에서 「켜는 순간」으로 앞당긴 것이고, 방해되면 [현장 단계 표시]를
 *    끄면 된다(끄면 유령을 하나도 안 넘기므로 아래 계산이 전과 똑같아진다).
 *
 * 🔴 **섞는 것은 이 자동 배치 하나뿐이다.** 시트 띠(groupNodesByWorksheet)와
 * 단계별 정렬(computeStageSortedLayout)에는 넣지 않는다 — 게으름이 아니라
 * **채택도 그 둘을 안 바꾸기 때문**이다: 채택이 만드는 노드는 source_worksheet 가
 * null 이라 띠에 한 줄도 안 보태고(그 함수는 null 을 아예 안 센다), 단계별 정렬은
 * 편집기에서 고를 수조차 없다(layoutModeOptions={["USER"]}). 그 둘에 유령을 넣으면
 * 「채택 뒤와 같다」가 오히려 깨진다.
 * ============================================================================
 */

/** 자동 배치의 눈금. 전에 ProcedureFlowGraph 안에 인라인으로 적혀 있던 값 그대로다. */
export const PROCEDURE_AUTO_LAYOUT_SPACING = { horizontal: 280, vertical: 150 } as const;

/** 자동 배치가 읽는 **진짜 노드**의 칸들. 더 많이 가진 행을 넘기는 쪽은 언제나 맞다. */
export type ProcedureAutoLayoutNode = {
  id: string;
  nodeType: ProcedureNodeType;
  title: string;
  sortOrder: number;
  positionX: number;
  positionY: number;
  userPositionX: number | null;
  userPositionY: number | null;
};

/**
 * 자동 배치가 읽는 **유령 칸**.
 *
 * 🔴 `sortOrder` 는 「채택하면 받게 될 번호」다(adoptFieldAddedStep 이 max+1 을
 * 적는다). 아무 값이나 넣으면 안 된다 — 들어오는 선이 하나도 없는 칸은 뿌리로
 * 세워지는데, 뿌리의 가로 차례가 바로 이 번호 순서다. 번호가 어긋나면 켠 그림과
 * 넣은 뒤 그림이 좌우로 갈린다.
 *
 * 🔴 `pinnedX` 는 **현장에서 사람이 끌어다 놓은 자리**가 있을 때의 x 다(없으면
 * null). 채택은 그 값을 user_position_x/y 로 그대로 적고, 저장된 자리가 있는 칸은
 * 자동 배치가 밀지 않는다(computeLayeredGraphLayout 의 pinnedX). 그러니 유령도
 * 같아야 한다 — 안 그러면 「켤 때는 밀리던 이웃이 넣고 나니 안 밀린다」가 된다.
 */
export type ProcedureAutoLayoutGhostNode = {
  id: string;
  nodeType: ProcedureNodeType;
  title: string;
  sortOrder: number;
  pinnedX: number | null;
};

export type ProcedureAutoLayoutEdge = { fromNodeId: string; toNodeId: string };

/**
 * 그림이 들고 다니는 유령 칸(ProcedureFlowGraphGhostNode ·
 * FieldStepGhostNode — 둘은 같은 모양이다)을 **자동 배치가 읽는 모양**으로 옮긴다.
 *
 * 🔴 그림과 시험이 **이 함수 하나**를 쓴다. 양쪽에서 각자 옮기면 「시험은 통과하는데
 * 화면만 어긋나는」 자리가 생긴다 — 옮기는 규칙이 한 줄(`hasUserPosition ? x : null`)
 * 이라 더 그렇다. 그 한 줄이 곧 「사람이 정한 자리는 자동 배치가 밀지 않는다」이다.
 */
export function toAutoLayoutGhostNode(ghost: {
  id: string;
  nodeType: ProcedureNodeType;
  title: string;
  sortOrder: number;
  /** 사람이 정한 자리일 때의 x. hasUserPosition 이 거짓이면 안 읽는다(받침 값이다). */
  x: number;
  hasUserPosition: boolean;
}): ProcedureAutoLayoutGhostNode {
  return {
    id: ghost.id,
    nodeType: ghost.nodeType,
    title: ghost.title,
    sortOrder: ghost.sortOrder,
    pinnedX: ghost.hasUserPosition ? ghost.x : null,
  };
}

/**
 * 자동 배치가 쓰는 **노드 크기**(폭과 높이). 가운데 맞춤이 둘 다에 걸려 있어서
 * — 같은 x 라도 폭이 다르면 가로 중심이, 같은 y 라도 높이가 다르면 세로 중심이
 * 어긋난다 — 유령과 진짜 노드가 **같은 함수**로 재어져야 한다. 제목과 갈래가
 * 같으면 같은 값이 나오고, 채택은 그 둘을 한 글자도 안 바꾸고 옮긴다 — 그래서
 * 유령의 크기가 곧 채택 뒤의 크기다.
 *
 * 🔴 높이는 2026-11-05 에 더했다. 그 전까지 자동 배치는 폭만 받아서 세로를
 * **윗변**으로 맞췄고, 제목이 세 줄이라 높이가 82 인 노드가 52 인 이웃과 같은
 * 줄에 서면 혼자 아래로 삐져나왔다(실측: 윗변은 셋 다 0, 중심은 26 · 26 · 41).
 */
export function procedureAutoLayoutNodeDimensions(node: { nodeType: ProcedureNodeType; title: string }): { width: number; height: number } {
  const { semanticType } = getNodeChipVisual(node.nodeType);
  const { width, height } = computeNodeDimensions({ title: node.title, shape: NODE_VISUAL_CONFIG[semanticType].shape });
  return { width, height };
}

/**
 * 위의 폭만 꺼내 보는 길. 🔵 **계산을 따로 들고 있지 않다** — 한 글자라도
 * 갈라지면 「유령과 진짜 노드를 같은 자로 잰다」가 폭에서만 조용히 깨진다.
 */
export function procedureAutoLayoutNodeWidth(node: { nodeType: ProcedureNodeType; title: string }): number {
  return procedureAutoLayoutNodeDimensions(node).width;
}

/**
 * 자리 값이 없는 노드들의 자동 배치를 센다. 돌려주는 지도에는 **넘긴 칸이 전부**
 * 들어 있다(저장된 자리가 있는 칸도 — 그 칸은 자기 자리에 못 박힌 채로 들어간다).
 * 어느 칸이 이 값을 실제로 쓰는지는 부르는 쪽이 정한다(ProcedureFlowGraph 의
 * resolveBaselinePosition — 저장된 자리가 있으면 그쪽이 이긴다).
 *
 * 🔵 유령을 하나도 안 넘기면(null·빈 배열) **전과 글자 그대로 같은 값**이 나온다.
 * 이 프롭을 안 넘기는 화면 셋(절차 상세 · 실행 시작 노드 고르기 · 「전체 단계
 * 보기」)이 안 바뀐다는 근거가 거기 있다 — 시험이 값으로 지킨다.
 *
 * 🔴 **유령 선은 맨 뒤에 붙인다.** 선의 차례가 한 부모 밑 형제들의 좌우 차례를
 * 정하기 때문이다(computeLayeredGraphLayout 은 넘어온 차례대로 자식을 쌓는다).
 * 채택이 만드는 선도 표의 맨 뒤에 붙으므로 그쪽과 같은 차례가 된다.
 */
export function computeProcedureAutoLayout(params: {
  nodes: readonly ProcedureAutoLayoutNode[];
  edges: readonly ProcedureAutoLayoutEdge[];
  ghostNodes?: readonly ProcedureAutoLayoutGhostNode[] | null;
  ghostEdges?: readonly ProcedureAutoLayoutEdge[] | null;
}): Map<string, { x: number; y: number }> {
  const layoutNodes: LayeredLayoutNode[] = params.nodes.map((n) => ({
    id: n.id,
    sortOrder: n.sortOrder,
    ...procedureAutoLayoutNodeDimensions(n),
    // 저장된 자리가 있는 칸은 그 자리에 못 박는다 — 「배치와 선이 어긋나면 안
    // 된다」(computeLayeredGraphLayout 의 pinnedX 주석). 두 칸이 다 차 있을
    // 때만이다(반쪽은 자리가 아니다 — hasUserLayoutOverride).
    pinnedX: hasUserLayoutOverride(n) ? resolveEffectiveNodePosition(n, "USER").x : undefined,
  }));
  for (const ghost of params.ghostNodes ?? []) {
    layoutNodes.push({
      id: ghost.id,
      sortOrder: ghost.sortOrder,
      // 🔴 유령도 **같은 함수**로 잰다 — 폭만 그랬던 것을 높이까지 넓혔다.
      //    한쪽만 중심으로 서면 켠 그림과 채택 뒤 그림이 세로로 갈린다.
      ...procedureAutoLayoutNodeDimensions(ghost),
      pinnedX: ghost.pinnedX ?? undefined,
    });
  }

  const layoutEdges: LayeredLayoutEdge[] = params.edges.map((e) => ({ fromNodeId: e.fromNodeId, toNodeId: e.toNodeId }));
  for (const ghostEdge of params.ghostEdges ?? []) {
    layoutEdges.push({ fromNodeId: ghostEdge.fromNodeId, toNodeId: ghostEdge.toNodeId });
  }

  return computeLayeredGraphLayout(layoutNodes, layoutEdges, PROCEDURE_AUTO_LAYOUT_SPACING);
}
