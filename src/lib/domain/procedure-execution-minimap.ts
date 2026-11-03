/**
 * 절차 실행 화면의 **작은 흐름 그림** — 「지금 할 일」 둘레의 몇 걸음만 고른다.
 * 순수 함수만 — DOM 도 React 도 DB 도 건드리지 않는다
 * (procedure-execution-order.ts · procedure-execution-focus.ts 와 같은 규약).
 *
 * ──────────────────────────────────────────────────────────────────────
 * 왜 이 파일이 생겼는가
 * ──────────────────────────────────────────────────────────────────────
 * 절차는 **만들 때는 플로우차트로 그리는데 쓸 때는 목록만** 보여 준다. 그래서
 * 수리하는 사람이 「내가 지금 어디쯤이고 다음에 어디로 갈라지는지」를 머릿속에서
 * 다시 그려야 했다 — 이 절차들은 판단(DECISION) 노드가 8할이라 그 되그리기가
 * 곧 일이다.
 *
 * 🔴 **편집기 그림(ProcedureFlowGraph, React Flow)을 그대로 쓰지 않는다.**
 * 드래그·경로점·선택 같은 편집용 상호작용이 딸려 오고 휴대폰에서 못 쓴다. 여기서
 * 고르는 것은 **지금 자리를 짚는 데 필요한 몇 걸음**뿐이고, 화면은 그것을 읽기
 * 전용 띠 하나로 그린다.
 *
 * ──────────────────────────────────────────────────────────────────────
 * 몇 걸음인가 — 지난 2 · 다음 3
 * ──────────────────────────────────────────────────────────────────────
 * 비대칭인 까닭이 있다. **다음**은 사람이 곧 **골라야 하는 것**이라 한 걸음 더
 * 보여 줄 값어치가 있고(판단 → 갈래 → 그 다음), **지난 것**은 「여기서 왔구나」를
 * 알아보게만 하면 된다 — 이미 한 일이라 두 걸음이면 알아본다.
 *
 * 띠 하나의 폭도 이 값이 정한다. 곧은 길일 때 칸이 최대 2+1+3=6개인데, 한 칸이
 * 8rem 이므로 좁은 휴대폰에서는 가로로 넘치고 **가로 스크롤**이 된다. 세로로는
 * 늘지 않는다 — 세로로 자라면 바로 아래 「지금 할 일」 큰 카드가 화면 밖으로
 * 밀려난다.
 *
 * ──────────────────────────────────────────────────────────────────────
 * 🔴 고리가 실제로 있다
 * ──────────────────────────────────────────────────────────────────────
 * 「재측정」·「재진행」 갈래가 앞쪽 노드로 되돌아간다. 본 노드를 기억하지 않으면
 * 걸음 수를 세는 것만으로는 안 멈추는 것이 아니라 — 멈추기는 하지만 같은 노드를
 * 몇 번이고 다시 그린다. 그래서 **방향마다 따로** 본 것을 기억한다. 방향마다
 * 따로인 까닭: A → B → A 인 고리에서 B 에 서 있으면 A 는 「왔던 곳」이면서
 * 「돌아갈 곳」이다. 둘 중 하나를 지우면 고리가 화면에서 사라진다.
 *
 * ──────────────────────────────────────────────────────────────────────
 * 🔴 그릴 수 없을 때는 그리지 않는다 — 게시된 절차 하나가 「그리다 만」 상태다
 * ──────────────────────────────────────────────────────────────────────
 * 「원복 검사 및 개선 작업 (3상 입력)」은 노드 23개에 간선이 8개뿐이고, 그중
 * 하나는 START 에서 나가는 선이라 **사람이 할 일끼리를 잇는 선은 7개**다. 22장
 * 가운데 14장은 선이 하나도 안 붙어 있다.
 *
 * 그런 노드에서 그림을 그리면 **점 하나짜리 그림**이 된다 — 아무것도 안 알려
 * 주면서 자리만 차지하고, 「이 절차에는 다음이 그려져 있다」는 거짓 인상을 준다.
 * 그래서 세 갈래로 가른다:
 *
 *   - GRAPH  — 둘레에 그릴 걸음이 하나라도 있다.
 *   - NOTE   — 이 노드만 외따로다. 그림 대신 **한 줄**로 까닭을 적는다.
 *   - HIDDEN — 절차 전체에 이을 선이 없거나 지금 할 일 자체가 없다. 띠를
 *              **통째로** 안 그린다.
 */

import type { ProcedureBranchType } from "./procedure-template-types";

/** 지난 쪽(간선을 거슬러)으로 몇 걸음까지 모으는가. */
export const MINIMAP_BACKWARD_STEPS = 2;
/** 다음 쪽(간선을 따라)으로 몇 걸음까지 모으는가. */
export const MINIMAP_FORWARD_STEPS = 3;
/**
 * 한 걸음에 나란히 세울 칸의 최대 수.
 *
 * 실측(2026-11-02)으로는 나가는 갈래가 최대 2개(정상/NG)라 이 뚜껑에 닿지
 * 않는다. 들어오는 선은 한 노드에 4개까지 모이는 자리가 있었다 — 그래도 네
 * 칸이면 띠가 가로로 두 배가 될 뿐 세로로는 안 자란다. 뚜껑을 두는 까닭은
 * 앞으로 더 촘촘히 그린 절차가 들어왔을 때 **띠가 터지지 않게** 하는 것이다.
 */
export const MINIMAP_MAX_STEPS_PER_LEVEL = 4;

/**
 * 선 하나. 🔵 2026-11-03(조각 13)부터 **두 표가 섞여 들어온다** —
 * procedure_template_edges 와 procedure_case_execution_edges 를 조회가 한
 * 목록으로 합쳐 내려보낸다(getExecutionDetail). 양끝은 어느 쪽이든 **그림 위
 * 자리 id**(MinimapNode.graphNodeId 와 같은 열쇠)로 적혀 있다.
 */
export type MinimapEdge = {
  /** procedure_template_edges.id 또는 procedure_case_execution_edges.id */
  id: string;
  /** 그림 위 자리 id(MinimapNode.graphNodeId). */
  fromNodeId: string;
  /** 그림 위 자리 id(MinimapNode.graphNodeId). */
  toNodeId: string;
  branchType: ProcedureBranchType;
  branchLabel: string | null;
};

export type MinimapNode = {
  /** procedure_case_execution_nodes.id */
  id: string;
  /**
   * **그림 위 자리 id**. 템플릿에서 온 줄은 procedure_template_nodes.id 이고,
   * 이 건에서 더한 작업은 **제 실행 노드 id** 다(2026-11-03, 조각 13).
   *
   * 🔴 전에는 이 칸이 `string | null` 이었고 null 이 「그림에 자리가 없다」는
   * 뜻이었다. 조각 13 에서 추가 작업도 선을 가지게 되면서 그 뜻이 **거짓이
   * 됐다** — 자리는 언제나 있고, 없을 수 있는 것은 **이어진 선**뿐이다.
   */
  graphNodeId: string;
  /** 1 부터 매긴 절차상 번호(getExecutionDetail 의 orderIndex). 칸에 적는다. */
  orderIndex: number;
  /**
   * 이 건에서 **더한** 작업인가(procedure_template_node_id 가 비어 있는 줄).
   *
   * 🔴 그릴 수 없을 때 **무엇이라고 적을지**가 이 값으로 갈린다 — 「절차가 안
   * 이어져 있다」와 「방금 더한 작업이라 아직 아무 데도 안 이었다」는 사람이 해야
   * 할 다음 행동이 다르다(뒤쪽은 「추가 작업 등록」 창에서 선을 그으면 된다).
   */
  isAddedInCase: boolean;
};

export type MinimapVia = {
  /** procedure_template_edges.id 또는 procedure_case_execution_edges.id */
  edgeId: string;
  branchType: ProcedureBranchType;
  branchLabel: string | null;
};

export type MinimapStep<T> = {
  node: T;
  /**
   * 이 걸음과 **바로 한 걸음 앞/뒤**를 잇는 간선. 화면이 화살표에 갈래 이름을
   * 적는 데 쓴다 — 「NG 면 여기로」가 판단의 절반이다.
   */
  via: MinimapVia;
};

export type MinimapLevel<T> = {
  steps: MinimapStep<T>[];
  /** 뚜껑(MINIMAP_MAX_STEPS_PER_LEVEL)에 걸려 안 그린 수. 0 이면 다 그렸다. */
  omittedCount: number;
};

export type ProcedureExecutionMinimap<T> =
  | {
      kind: "GRAPH";
      /** **가까운 것부터** — [0] 이 한 걸음 전이다. 화면이 뒤집어 그린다. */
      backward: MinimapLevel<T>[];
      current: T;
      /** [0] 이 한 걸음 뒤. */
      forward: MinimapLevel<T>[];
    }
  | {
      kind: "NOTE";
      reason:
        /**
         * 지금 할 일이 **이 건에서 더한 작업**인데 아직 아무 선에도 안 이어져
         * 있다.
         *
         * 🔵 2026-11-03(조각 13)에 **뜻이 바뀌었다.** 전에는 「추가 작업은
         * 그림에 자리가 아예 없다」였는데, 이제 자리는 있고 **선이 없을 뿐**이다.
         * 아래 CURRENT_HAS_NO_LINKED_STEP 과 일어나는 상황은 같고 **할 말이
         * 다르다** — 여기는 「창에서 선을 그으면 된다」로 이어진다.
         */
        | "CURRENT_IS_EXTRA_TASK"
        /** 템플릿에서 온 줄인데 이을 선이 한 쪽도 없다(그리다 만 절차). */
        | "CURRENT_HAS_NO_LINKED_STEP";
    }
  | {
      kind: "HIDDEN";
      reason:
        /** 절차 전체에 **사람이 할 일끼리를 잇는 선**이 하나도 없다. */
        | "NO_LINKED_STEPS_AT_ALL"
        /** 지금 할 일 자체가 없다(다 끝났거나 전부 차단됨). */
        | "NO_CURRENT_TASK";
    };

type Direction = "BACKWARD" | "FORWARD";

type Found<T> = { graphNodeId: string; step: MinimapStep<T> };

function walk<T extends MinimapNode>(
  direction: Direction,
  startGraphNodeId: string,
  maxSteps: number,
  adjacency: ReadonlyMap<string, MinimapEdge[]>,
  nodeByGraphNodeId: ReadonlyMap<string, T>
): MinimapLevel<T>[] {
  const levels: MinimapLevel<T>[] = [];
  // 🔴 고리가 있다 — 본 노드를 기억하지 않으면 같은 칸이 몇 번이고 되풀이된다.
  // 출발점을 미리 넣어 두는 것도 그 때문이다: 지금 자리로 되돌아오는 갈래가
  // 있으면 「지금 할 일」 칸이 띠 안에 두 번 생긴다.
  const seen = new Set<string>([startGraphNodeId]);
  let frontier: string[] = [startGraphNodeId];

  for (let step = 0; step < maxSteps; step += 1) {
    const found: Found<T>[] = [];
    const foundIds = new Set<string>();

    for (const fromGraphNodeId of frontier) {
      for (const edge of adjacency.get(fromGraphNodeId) ?? []) {
        const nextGraphNodeId = direction === "FORWARD" ? edge.toNodeId : edge.fromNodeId;
        if (seen.has(nextGraphNodeId) || foundIds.has(nextGraphNodeId)) continue;
        const node = nodeByGraphNodeId.get(nextGraphNodeId);
        // 실행 행이 없는 노드(START·참고 문서)는 칸을 만들지 않는다 — 사람이
        // 할 일이 아니고, 번호도 상태도 없어 칸에 적을 것이 없다.
        if (!node) continue;
        foundIds.add(nextGraphNodeId);
        found.push({
          graphNodeId: nextGraphNodeId,
          step: { node, via: { edgeId: edge.id, branchType: edge.branchType, branchLabel: edge.branchLabel } },
        });
      }
    }

    if (found.length === 0) break;
    for (const id of foundIds) seen.add(id);

    // 🔴 차례를 다시 매기지 않는다 — **간선이 들어온 차례 그대로**다. 조회가
    // 이미 간선을 sort_order 로 정렬해 주므로, 이 차례가 곧 바로 아래 「지금 할
    // 일」 카드의 갈래 단추 차례와 같다. 여기서 번호순으로 다시 세우면 띠의
    // 「정상 / NG」와 단추의 「정상 / NG」가 서로 자리를 바꾼 화면이 된다.
    const shown = found.slice(0, MINIMAP_MAX_STEPS_PER_LEVEL);
    levels.push({ steps: shown.map((f) => f.step), omittedCount: found.length - shown.length });

    // 🔴 갈래가 벌어지면 **거기서 멈춘다** — 갈래마다 한 걸음까지만. 더 따라가면
    // 걸음마다 칸이 곱해져 띠가 터진다. 갈라진다는 사실 자체가 알려 줄 것의
    // 거의 전부이기도 하다.
    if (found.length > 1) break;
    frontier = [found[0].graphNodeId];
  }

  return levels;
}

/**
 * 지금 자리 둘레의 몇 걸음을 모아 돌려준다. **아무것도 그리지 않는 쪽**도
 * 결과의 한 갈래다(위 ProcedureExecutionMinimap 주석 참고).
 *
 * `nodes` 는 getExecutionDetail 이 절차 차례로 내려준 배열을 그대로 받는다 —
 * 여기서 다시 정렬하지 않는다. `edges` 는 템플릿 전체를 줘도 되고 일부만 줘도
 * 된다. 양끝이 모두 이 배열 안의 노드인 간선만 쓴다.
 */
export function buildProcedureExecutionMinimap<T extends MinimapNode>(input: {
  nodes: readonly T[];
  edges: readonly MinimapEdge[];
  /** pickCurrentTask 가 고른 「지금 할 일」. 없으면 null. */
  current: T | null;
}): ProcedureExecutionMinimap<T> {
  const nodeByGraphNodeId = new Map<string, T>();
  for (const node of input.nodes) {
    // 먼저 나온 것을 남긴다 — 입력이 절차 차례이므로 「앞선 것이 이긴다」가 되고,
    // 같은 입력이면 언제나 같은 그림이 나온다.
    if (!nodeByGraphNodeId.has(node.graphNodeId)) {
      nodeByGraphNodeId.set(node.graphNodeId, node);
    }
  }

  // 🔴 「간선이 있는가」를 **원본 간선 수**로 재면 틀린다. 실측한 절차의 간선
  // 8개 가운데 하나는 START 에서 나가는 선이고, START 는 사람이 할 일 목록에
  // 아예 없다(getExecutionDetail 이 뺀다). 그릴 수 있는지는 **양끝이 다 칸이
  // 되는 선**으로만 판정해야 한다.
  const outgoing = new Map<string, MinimapEdge[]>();
  const incoming = new Map<string, MinimapEdge[]>();
  let linkedEdgeCount = 0;
  for (const edge of input.edges) {
    if (!nodeByGraphNodeId.has(edge.fromNodeId) || !nodeByGraphNodeId.has(edge.toNodeId)) continue;
    linkedEdgeCount += 1;
    const out = outgoing.get(edge.fromNodeId);
    if (out) out.push(edge);
    else outgoing.set(edge.fromNodeId, [edge]);
    const incomingList = incoming.get(edge.toNodeId);
    if (incomingList) incomingList.push(edge);
    else incoming.set(edge.toNodeId, [edge]);
  }

  if (linkedEdgeCount === 0) return { kind: "HIDDEN", reason: "NO_LINKED_STEPS_AT_ALL" };
  if (!input.current) return { kind: "HIDDEN", reason: "NO_CURRENT_TASK" };

  const currentGraphNodeId = input.current.graphNodeId;

  const backward = walk("BACKWARD", currentGraphNodeId, MINIMAP_BACKWARD_STEPS, incoming, nodeByGraphNodeId);
  const forward = walk("FORWARD", currentGraphNodeId, MINIMAP_FORWARD_STEPS, outgoing, nodeByGraphNodeId);

  // 양쪽 다 비었으면 칸이 「지금」 하나뿐이다 — 점 하나를 그리느니 한 줄로 적는다.
  //
  // 🔴 까닭을 **무엇이 안 이어졌는가**로 가른다(2026-11-03, 조각 13). 방금 더한
  // 작업은 선을 긋기 전이 보통이라, 「이 절차가 안 이어져 있다」고 적으면 사람이
  // 절차를 탓하게 된다 — 해야 할 일은 그 창에서 선을 긋는 것이다.
  if (backward.length === 0 && forward.length === 0) {
    return { kind: "NOTE", reason: input.current.isAddedInCase ? "CURRENT_IS_EXTRA_TASK" : "CURRENT_HAS_NO_LINKED_STEP" };
  }

  return { kind: "GRAPH", backward, current: input.current, forward };
}
