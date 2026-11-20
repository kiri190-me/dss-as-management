import {
  computeLayeredGraphLayout,
  hasUserLayoutOverride,
  resolveEffectiveNodePosition,
  type LayeredLayoutEdge,
  type LayeredLayoutNode,
} from "@/lib/graph-editor-core/layout";
import { NODE_VISUAL_CONFIG, computeNodeDimensions, getNodeChipVisual } from "./procedure-visual-language";
import type { ProcedureBranchType, ProcedureNodeType } from "./procedure-template-types";

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
 *  - 🔴 대신 **유령을 켜는 순간** 둘레가 한 번 움직인다. 이것이 의도였다: 움직임을
 *    「넣는 순간」에서 「켜는 순간」으로 앞당긴 것이고, 방해되면 [현장 단계 표시]를
 *    끄면 된다(끄면 유령을 하나도 안 넘기므로 아래 계산이 전과 똑같아진다).
 *
 * 🟢 **그 대가가 2026-11-05 오후에 사라졌다.** 자동 배치가 한 부모 밑 자식을
 * 「줄기 하나는 부모의 열에 그대로, 나머지는 오른쪽으로 한 칸씩」으로 세우게
 * 바뀌면서(computeLayeredGraphLayout 의 「줄기 하나」 절 — 그 「한 칸」의 크기는
 * 이웃한 두 노드의 크기가 정한다, 같은 함수의 「크기만큼 벌린다」 절), 새 칸은
 * **언제나 맨 오른쪽**에만 붙고 앞선 형제의 열이 안 바뀐다. 그래서 유령을 켜도
 * 둘레가 한 픽셀도 안 움직인다 — procedure-auto-layout.test.ts 가 값으로 지킨다.
 *
 * 🔴 **섞는 것은 이 자동 배치 하나뿐이다.** 시트 띠(groupNodesByWorksheet)와
 * 단계별 정렬(computeStageSortedLayout)에는 넣지 않는다 — 게으름이 아니라
 * **채택도 그 둘을 안 바꾸기 때문**이다: 채택이 만드는 노드는 source_worksheet 가
 * null 이라 띠에 한 줄도 안 보태고(그 함수는 null 을 아예 안 센다), 단계별 정렬은
 * 편집기에서 고를 수조차 없다(layoutModeOptions={["USER"]}). 그 둘에 유령을 넣으면
 * 「채택 뒤와 같다」가 오히려 깨진다.
 * ============================================================================
 */

/**
 * 자동 배치의 눈금. `horizontal`/`vertical` 은 전에 ProcedureFlowGraph 안에
 * 인라인으로 적혀 있던 값 그대로다.
 *
 * ──────────────────────────────────────────────────────────────────────
 * 🔴 빈자리 둘은 2026-11-05 오후에 더했다 — **포개짐을 막는 값**이다
 * ──────────────────────────────────────────────────────────────────────
 * 눈금은 고정인데 노드 크기는 제목이 정한다(실측: 폭 132 ~ 527 · 높이 52 ~ 97 —
 * 폭 상한이 없고, 판단 노드는 거기에 1.25배가 더 붙는다). 그래서 눈금만으로는
 * **넓은 노드끼리 포개진다**: 폭 527 짜리 둘이 280 간격으로 서면 247px 이 겹친다.
 * 2026-11-05 에 제목을 원본 전문(줄바꿈 포함)으로 바꾸면서 드러났다.
 *
 * 🔴 **값의 근거** — 지금 가장 흔한 노드는 폭 132 · 높이 52(MIN_WIDTH ·
 * MIN_HEIGHT 에 걸린 짧은 제목)다. 그 둘이 눈금대로 나란히 서면 모서리 사이에
 * `280 − 132 = 148` · `150 − 52 = 98` 의 빈자리가 남는다. **그 빈자리를 모든
 * 크기의 노드가 똑같이 누리게** 한 값이 아래 148 · 98 이다. 그래서
 *  - 가장 흔한 크기(132×52)끼리는 **전과 글자 그대로 같은 자리**에 선다
 *    (`max(280, 132+148) = 280` · `max(150, 52+98) = 150`).
 *  - 더 넓거나 높은 노드가 끼면 **딱 그만큼만** 벌어진다.
 * 아무 숫자나 고르면 흔한 노드의 간격이 바뀌어 기존 그림이 통째로 흔들린다.
 */
export const PROCEDURE_AUTO_LAYOUT_SPACING = { horizontal: 280, vertical: 150, horizontalGap: 148, verticalGap: 98 } as const;

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

/**
 * 🔴 `branchType` 은 **선택이 아니라 필수**다(2026-11-05 오후). 자동 배치는 이
 * 값으로 「이 선이 주 흐름의 계속인가」를 가르고, 그 자식 하나가 부모의 열을 그대로
 * 잇는다. 안 넘겨도 되게 두면 안 넘긴 자리에서 **오류 없이 조용히 그림이 비뚤어
 * 진다** — 그것도 전보다 더 나쁘게. 측정(판단 20개가 연달아 서고 각자 NG 가지를
 * 하나씩 내는 표본, 눈금 280, 🔵 **폭을 0 으로 두고** 줄기가 어디로 가는지만 본
 * 값이다 — 폭을 넣으면 간격이 더 벌어져 숫자가 커진다): 갈래를 제대로 넘기면 가로
 * 폭 280, 안 넘기면 5600 이었다(고치기 전은 2940). 넘기지 않으면 **첫 자식**이
 * 줄기가 되는데, 엑셀에서 들여온 선의 차례는 NG 가지가 먼저인 일이 흔하기 때문이다.
 */
export type ProcedureAutoLayoutEdge = { fromNodeId: string; toNodeId: string; branchType: ProcedureBranchType };

/**
 * 어떤 갈래의 선이 **주 흐름의 계속**인가 — 참인 선의 자식이 부모의 중심 열을
 * 그대로 잇는다(computeLayeredGraphLayout 의 continuesMainFlow).
 *
 * 🔴 갈래를 나누는 자가 **이미 이 저장소에 있다**: procedure-edge-routing.ts 의
 * decisionBranchSourceHandle 이 「YES/NORMAL/DEFAULT 는 오른쪽, NO/NG 는 왼쪽,
 * RETRY/LOOP_BACK 은 되돌아가는 쪽」으로 가른다(단계별 정렬에서 선이 노드의 어느
 * 면에 붙는지). 여기서 전혀 다른 잣대를 새로 세우면 같은 절차가 배치 모드에 따라
 * 다른 쪽으로 뻗으므로, **그 셋(DEFAULT·NORMAL·YES)을 그대로 가져왔다.**
 *
 * 🔵 **딱 하나 다르다 — CUSTOM.** 저쪽은 남은 것을 전부 오른쪽으로 보내는
 * `else` 라 CUSTOM 도 YES 무리에 들어가지만, 여기서는 거짓이다. 사람이 적은
 * 이름표(예: 「유상」·「무상」)는 어느 쪽도 「계속」이 아닌 **진짜 갈림**이라,
 * 참으로 치면 선의 차례에 따라 「무상」이 줄기가 되는 일이 생긴다. 거짓이면 그런
 * 노드는 아무도 안 걸려 **첫 선**이 줄기가 되고, 그것이 더 설명하기 쉽다.
 * 🔵 RETRY/LOOP_BACK 도 거짓이다. 되돌아가는 선이라 대개 이미 다녀온 노드를
 * 가리켜 배치의 부모–자식이 되지도 않지만, 되는 드문 경우에도 줄기는 아니다.
 */
export function procedureBranchContinuesMainFlow(branchType: ProcedureBranchType): boolean {
  return branchType === "DEFAULT" || branchType === "NORMAL" || branchType === "YES";
}

/**
 * 어떤 갈래의 자식을 **부모와 같은 줄**(수평)에 세우는가 — 아래로 한 칸 내려가는
 * 대신 부모의 오른쪽에 나란히 선다(computeLayeredGraphLayout 의 sameRowBranch).
 *
 * 🔴 사용자 지시(2026-11-05): 「**[NG]로 연결되는 노드는 수평으로 배치**되도록
 * 해줘」. 그리고 그 모양이 **원본 엑셀 그대로**임을 실측으로 확인했다 — 열한 시트의
 * 분기 193개를 도형 좌표로 세니
 *  - **NG 97개**: 오른쪽 94 · 왼쪽 2 · 같은 열 1, 그 가운데 **같은 줄이 87**
 *  - **정상 96개**: 오른쪽 2 · 왼쪽 35 · 같은 열 59, **같은 줄은 0**
 * 왼쪽 2 · 같은 열 1 은 손으로 그린 흔들림이라 **전부 오른쪽·같은 줄로 통일**한다.
 *
 * 🔵 **NO 도 함께 친다.** 실제 데이터에 NG 93 · NO 4 로 둘 다 있고, 선이 노드의
 * 어느 면에 붙는지를 정하는 기존 규칙(decisionBranchSourceHandle)도 이 둘을 한
 * 무리로 묶는다. 둘을 갈라 두면 같은 「아니다」 갈래가 화면에서 다르게 선다.
 * 🔵 RETRY/LOOP_BACK 은 아니다 — 되돌아가는 선이라 애초에 아래로도 옆으로도 안 간다.
 * 🔵 CUSTOM 도 아니다. 사람이 적은 이름표라 「아니다」 갈래라고 단정할 수 없고,
 * 원본 실측에도 안 잡힌 갈래다.
 */
export function procedureBranchSitsOnParentRow(branchType: ProcedureBranchType): boolean {
  return branchType === "NG" || branchType === "NO";
}

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
 * 🔴 **유령 선은 맨 뒤에 붙인다.** 선의 차례가 한 부모 밑 **가지들의** 좌우
 * 차례를 정하기 때문이다(computeLayeredGraphLayout 은 줄기를 뺀 나머지를 넘어온
 * 차례대로 오른쪽에 쌓는다). 채택이 만드는 선도 표의 맨 뒤에 붙으므로 그쪽과 같은
 * 차례가 된다.
 *
 * 🔵 **줄기가 누구인지는 차례가 아니라 갈래가 정한다**(2026-11-05 오후,
 * procedureBranchContinuesMainFlow). 그래서 맨 뒤에 붙은 유령이 「기본」 선으로
 * 들어오면서 앞선 형제를 밀어내는 일은 없다 — 앞선 형제 중에 이미 줄기가 있으면
 * 그쪽이 부모의 열을 지킨다.
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

  // 🔴 유령 선도 **같은 함수**로 갈래를 가른다 — 채택(adoptFieldAddedStep)이
  //    실행 쪽 선의 branch_type 을 한 글자도 안 바꾸고 베껴 적으므로, 여기서
  //    갈래를 다르게 읽으면 「켠 그림 = 채택 뒤 그림」이 조용히 깨진다.
  const toLayoutEdge = (e: ProcedureAutoLayoutEdge): LayeredLayoutEdge => ({
    fromNodeId: e.fromNodeId,
    toNodeId: e.toNodeId,
    continuesMainFlow: procedureBranchContinuesMainFlow(e.branchType),
    sameRowBranch: procedureBranchSitsOnParentRow(e.branchType),
  });
  const layoutEdges: LayeredLayoutEdge[] = params.edges.map(toLayoutEdge);
  for (const ghostEdge of params.ghostEdges ?? []) {
    layoutEdges.push(toLayoutEdge(ghostEdge));
  }

  return computeLayeredGraphLayout(layoutNodes, layoutEdges, PROCEDURE_AUTO_LAYOUT_SPACING);
}

/** 그림이 **이미 그려 준 자리**를 노드 id 마다. 아래 함수 하나가 이 지도를 만들고 또 읽는다. */
export type ProcedureAutoLayoutMemory = ReadonlyMap<string, { x: number; y: number }>;

/**
 * ============================================================================
 * 🔴 **한 번 그려 준 자리는 다시 안 센다** (2026-11-20)
 * ============================================================================
 * 위 computeProcedureAutoLayout 은 (노드, 선)의 **순수 함수**다. 그래서 선이 하나
 * 지워지면 **그림이 통째로 다시 놓인다.** 실측(가짜 표본 — 세로 사슬 넷 + 오른쪽
 * NG 가지 셋 + 가지 하나에 매달린 끝 칸 하나, 그 마지막 선 **하나만** 지웠다):
 *  - 끊긴 칸은 들어오는 선이 없어져 **뿌리**가 된다. 뿌리는 숲의 맨 아래에 쌓이고
 *    (computeLayeredGraphLayout 의 「뿌리도 세로로 쌓는다」 절) 가로도 뿌리 차례로
 *    다시 매겨지므로, 그 칸이 x 514 → 234 · y 274 → 574 로 날아갔다.
 *  - 그 칸이 쓰던 높이가 사라져 **아래쪽 세 칸이 150px 씩 위로** 따라 올라왔다.
 *  - 끊긴 칸의 sortOrder 가 주 뿌리보다 **작으면 여덟 칸이 전부** 움직인다
 *    (가로는 전부 +300, 세로는 0 또는 +150). 2026-11-20 에 신고된 모습이 이것이다.
 *
 * 🔴 **순수 함수로는 못 고친다.** (노드, 선)이 바뀌면 값이 바뀌는 것이 그 함수의
 * 정의다. 고치려면 **먼저 그린 자리를 기억**하는 수밖에 없고, 그 기억을 다루는
 * 규칙이 이 함수다. 규칙은 세 줄이다:
 *  ① 기억에 있는 칸은 **기억한 자리 그대로** — 선이 바뀌어도 안 움직인다.
 *  ② 기억에 없는 칸(= 이 그림이 **처음 보는** 칸)은 **갓 센 자리** — 그래야 새로
 *     만든 노드가 여전히 자동으로 놓인다(안 그러면 전부 (0,0) 에 겹쳐 쌓인다).
 *  ③ 🔴 이번에 **안 들어온 칸도 기억에서 안 지운다** — 자리를 그대로 들고 있다가
 *     그 id 가 돌아오면 **원래 자리**에 놓는다(아래 「지우지 않는다」 절).
 *
 * ──────────────────────────────────────────────────────────────────────
 * 🔴 **사라진 칸을 기억에서 지우지 않는다** (2026-11-21 두 번째 신고로 뒤집힘)
 * ──────────────────────────────────────────────────────────────────────
 * 이 자리에 처음에는 반대가 적혀 있었다 — 「이번에 안 들어온 칸은 **지운다**. 기억이
 * 끝없이 자라지 않고, 되돌리면 **선도 함께 돌아오므로 갓 센 값이 곧 원래 값**이다.」
 *
 * 🔴 **그 괄호가 틀렸다.** [이전]은 **바로 앞 한 칸**만 되돌린다. 그래서 사람이
 * 「선을 지우고 → 그 선이 가리키던 노드를 지우고 → [이전]」을 밟으면 **노드만
 * 돌아오고 선은 아직 안 돌아온다.** 그 칸은 기억에서 지워졌으니 「선 없는 지형」에서
 * 갓 세어지는데, 둘레는 「선이 있던 시절」에 얼어 있다 — **두 지형이 섞여** 그 칸
 * 하나만 날아간다. 위 고침이 나간 **바로 다음에** 두 번째로 신고된 모습이 이것이다
 * (「연결선을 없앤 뒤 노드를 없애고 [이전]으로 되돌리니 엉뚱한 자리에 노드가 뜬다」).
 * 실측(아래 시험 파일의 같은 표본, `c3 → done` 선을 지우고 `done` 을 지운 뒤 되돌림):
 * `done` 이 x −66 → 234 로 **가로 한 칸(+300)** 날아갔고 나머지 일곱 칸은 제자리였다.
 *
 * 그래서 안 지운다. 기억은 **늘기만 한다.** 그러면 되살아난 칸이 「그때의 지형」에
 * 선 자기 자리를 그대로 돌려받으므로 지형이 섞일 일이 아예 없다.
 *
 * 🔵 **무한 성장은 값으로 따져 보니 걱정거리가 아니었다.** 이 기억은 **화면이 떠
 * 있는 동안만** 살고(state 다 — ProcedureFlowGraph), 절차가 바뀌면 통째로 비워진다.
 * 칸 하나가 차지하는 것은 「id 글자 + {x,y}」이고 Node 에서 재니 **칸당 약 600바이트**
 * 였다(Map 200·2,000·100,000 칸으로 heapUsed 를 재어 913 · 629 · 598 B/칸). 한
 * 절차의 노드는 많아야 수백 개고, 지웠다 만들기를 거듭해도 한 세션에 수백 칸이다 —
 * 500칸이면 0.3MB, 10MB 를 채우려면 **한 화면에서 노드를 1만7천 번** 만들었다 지워야
 * 한다. 그 전에 새로고침 한 번이면 비워진다. 그래서 **그냥 안 지우는 것이 맞다**:
 * 상한을 두면 밀려난 칸에서 위 결함이 **조용히 되살아나는데**, 그 쪽이 훨씬 나쁘다.
 *
 * 🔵 **임시 번호가 다시 쓰이는 일은 해롭지 않다.** 저장 전 노드의 id 는
 * `tmp:node:N` 이고, 되돌리기로 목록이 비면 다음 번호가 **다시 1** 이다
 * (procedure-editor-structural-undo.ts 의 번호 도장). 그러면 **다른** 새 노드가
 * 옛 `tmp:node:1` 의 자리를 물려받는다. 실측으로 재 보니 그래도 괜찮았다 — 그래프
 * 모양이 그대로면 갓 센 값과 **글자 그대로 같은 자리**였고(둘 다 (214,424)), 사이에
 * 선을 지운 경우에는 기억 쪽이 (214,424) · 갓 센 쪽이 (494,424) 로 갈렸는데 **둘레가
 * 얼어 있는 지형에서는 기억 쪽이 맞는 자리**였다(갓 센 값은 아무도 안 선 빈 열을
 * 하나 건너뛴다). 서버에 저장된 노드의 id 는 UUID 라 다시 쓰이지 않는다.
 *
 * 🔵 **기억이 비어 있으면 값이 전과 글자 그대로 같다.** 첫 렌더가 늘 그렇고, 노드도
 * 선도 안 바뀌는 화면(절차 상세 · 실행 시작 노드 고르기 · 「전체 단계 보기」)은
 * 기억과 갓 센 값이 **언제나 같다** — 그 셋은 한 픽셀도 안 바뀐다.
 *
 * 🔴 **아직 고치지 않고 남긴 것 — 기억과 갓 센 값은 서로 다른 지형에 서 있다.** 선을
 * 지운 뒤 같은 세션에서 **처음 보는** 노드를 만들면, 기존 칸은 「지우기 전」 자리에 ·
 * 새 칸은 「지운 뒤」 자리에 선다(위 표본에서 그 어긋남이 세로 150px 이었다).
 * 🔵 **되살아난 칸은 이제 여기 안 걸린다** — 기억을 안 지우게 되면서(위 절) 그 칸은
 * 갓 센 값을 아예 안 보기 때문이다. 남은 것은 **진짜 새 노드**뿐이고, 그것까지
 * 없애려면 가로뿐 아니라 **세로까지 못 박을** 수 있어야 하는데
 * computeLayeredGraphLayout 에는 pinnedX 밖에 없다 — 그 핵심 셈을 고치는 것은
 * 이번 조각의 범위 밖이라 그대로 뒀다.
 *
 * 🔵 **기억은 저장되지 않는다.** 이 배치는 화면 전용 값이고(파일 머리말), 새로고침
 * 하면 기억이 비어 다시 갓 센 자리로 그려진다 — 2026-11-20 이전의 동작 그대로다.
 *
 * ──────────────────────────────────────────────────────────────────────
 * 🔴 **안 바뀌었으면 넘긴 지도를 그대로 돌려준다** — 렌더가 멈추는 근거
 * ──────────────────────────────────────────────────────────────────────
 * 부르는 쪽(ProcedureFlowGraph)은 돌려받은 기억을 state 에 담고, 그 state 를 보고
 * 다시 이 함수를 부른다. 담을 때마다 **새 지도**를 돌려주면 「바뀌었다」가 영영
 * 참이라 담기–다시 그리기가 끝없이 돈다. 그래서 **기억에 보탤 칸이 하나도 없으면**
 * (= 갓 센 지도의 id 가 전부 이미 기억에 있으면) 넘어온 지도를 **그 객체 그대로**
 * 돌려준다.
 *
 * 🔴 **잣대가 「수가 같은가」에서 「보탤 것이 있는가」로 바뀌었다**(2026-11-21 두
 * 번째 신고). 기억이 이제 안 줄어들므로 **기억이 갓 센 지도보다 큰 것이 정상**이다 —
 * 수를 맞대면 노드를 하나 지운 뒤로 「안 바뀌었다」가 영영 거짓이 되어, 고치려던
 * 결함 대신 **끝없이 다시 그리기**를 얻는다. 보탤 칸이 없다는 것만으로 충분하다:
 * 이 함수는 기억을 **지우지도 고치지도 않으므로**, 보탤 것이 없으면 내용이 글자
 * 그대로 그대로다.
 * 🔵 그 밖의 경우에만 새 지도를 만든다 — 넘어온 기억을 **베껴서** 거기에 처음 보는
 * 칸만 보탠다. 넘어온 지도를 제자리에서 고치면 부르는 쪽이 쥐고 있는 state 가
 * 조용히 바뀌어 「바뀌었다」를 아무도 못 알아챈다. `layout` 을 그대로 돌려주지 않는
 * 까닭도 같다 — 같은 객체를 두 이름으로 쥐여 주면 한쪽을 고칠 때 다른 쪽이 함께
 * 바뀐다(게다가 `layout` 에는 **지워진 칸이 안 들어 있다**).
 * ============================================================================
 */
export function applyProcedureAutoLayoutMemory(
  fresh: ReadonlyMap<string, { x: number; y: number }>,
  remembered: ProcedureAutoLayoutMemory
): { layout: Map<string, { x: number; y: number }>; remembered: ProcedureAutoLayoutMemory } {
  const layout = new Map<string, { x: number; y: number }>();
  // 🔵 「처음 보는 칸이 하나라도 있었나」 — 기억이 늘어나는 경우는 이것 하나뿐이다.
  let added = false;
  for (const [id, position] of fresh) {
    const kept = remembered.get(id);
    if (kept === undefined) added = true;
    layout.set(id, kept ?? position);
  }
  if (!added) return { layout, remembered };
  // 🔴 지워진 칸을 들고 가려면 **기억**을 베껴야 한다(`layout` 이 아니다 — 거기엔
  //    이번에 안 들어온 칸이 빠져 있다). 그 위에 처음 보는 칸만 보탠다.
  const grown = new Map(remembered);
  for (const [id, position] of layout) {
    if (!grown.has(id)) grown.set(id, position);
  }
  return { layout, remembered: grown };
}
