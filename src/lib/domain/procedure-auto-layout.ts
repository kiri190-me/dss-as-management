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
