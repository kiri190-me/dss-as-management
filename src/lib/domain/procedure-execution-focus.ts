/**
 * 「지금 할 일 **하나**」와 「그것을 끝냈을 때 설 **다음 하나**」. 순수 함수만 —
 * DOM 도 React 도 DB 도 건드리지 않는다(procedure-execution-order.ts 와 같은 규약).
 *
 * ──────────────────────────────────────────────────────────────────────
 * 왜 이 파일이 생겼는가
 * ──────────────────────────────────────────────────────────────────────
 * 실행 화면이 카드 22장을 네 구역(실행 가능·진행 중·차단됨·완료)에 평평하게
 * 깔아 놓는다. 22장이 전부 「대기」라서 **어디서부터 할지 화면에 적혀 있지
 * 않다.** 그래서 「지금 할 일」 하나를 뽑아 크게 세우기로 했고, 그 하나를 고르는
 * 규칙이 여기 있다.
 *
 * ──────────────────────────────────────────────────────────────────────
 * 🔴 「추천(isSuggestedNext)」을 쓰지 않는다
 * ──────────────────────────────────────────────────────────────────────
 * computeSuggestedNextNodes(procedure-execution-topology.ts)는 **들어오는 간선이
 * 없으면 무조건 추천**으로 켠다. 게시된 절차를 실제로 세어 보니(2026-11-02)
 * 「원복 검사 및 개선 작업 (3상 입력)」은 노드 23개에 간선이 8개뿐이고, 들어오는
 * 선이 없는 노드가 **15개**다 — 사람이 그리다 만 절차라 거의 전부가 「추천」이
 * 된다. 추천을 「지금 할 일」의 근거로 쓰면 그 절차에서는 아무 노드나 골라도
 * 추천이라서 **고른 것이 아니게 된다.**
 *
 * 그래서 근거는 **절차의 차례**다. 조회(getExecutionDetail)가 이미 템플릿의
 * sort_order 로 정렬해서 내려주므로, **배열에서 먼저 나오는 것**이 곧 「절차
 * 차례가 앞선 것」이다. 여기서 다시 정렬하지 않는다 — 화면마다 다시 정렬하면
 * 화면마다 차례가 달라진다(procedure-execution-order.ts 머리말).
 *
 * ──────────────────────────────────────────────────────────────────────
 * 자동 전진이 「안 세우는」 경우를 따로 돌려주는 까닭
 * ──────────────────────────────────────────────────────────────────────
 * 안 세우는 경우가 일곱 가지나 되고 서로 뜻이 전혀 다르다(갈 곳이 없다 / 갈
 * 곳이 여럿이라 못 고른다 / 이미 끝난 일이다 / 사람이 막아 뒀다 …). 참·거짓
 * 하나로 돌려주면 나중에 「왜 안 섰지」를 코드를 다시 읽어야만 알 수 있고,
 * 시험도 「안 섰다」까지만 재게 된다. 까닭까지 돌려주면 시험이 **어느 까닭으로**
 * 안 섰는지를 잰다.
 */

import type { ProcedureCaseExecutionNodeStatus } from "./procedure-case-execution-types";
import type { ProcedureNodeType } from "./procedure-template-types";
import { isExecutableNodeType } from "./procedure-execution-topology";

// ---- 「지금 할 일」 하나 고르기 ----

export type FocusCandidate = { status: ProcedureCaseExecutionNodeStatus };

/**
 * 지금 할 일이 없는 까닭. 화면이 할 말이 각각 다르다 — 「다 끝났습니다」와
 * 「남은 것이 전부 차단돼 있습니다」는 사람이 해야 할 다음 행동이 정반대다.
 *
 * 🔴 EXECUTION_FINISHED 만 **아무 말도 안 하는** 까닭이다. 나머지 셋은 안내
 * 한 줄이라도 서지만, 사람이 [절차 끝내기]를 눌러 마친 실행에서는 「지금 할
 * 일」 자리가 **통째로 사라져야** 한다(2026-11-02 눈 확인: 끝까지 안 가고
 * 마쳤을 때 남은 작업 카드가 그대로 떠 있어 마친 것처럼 안 보였다).
 */
export type NoCurrentTaskReason = "NO_NODES" | "ALL_FINISHED" | "ALL_BLOCKED" | "EXECUTION_FINISHED";

export type CurrentTaskPick<T> =
  | { kind: "IN_PROGRESS"; node: T }
  | { kind: "PENDING"; node: T }
  | { kind: "NONE"; reason: NoCurrentTaskReason };

function isFinished(status: ProcedureCaseExecutionNodeStatus): boolean {
  return status === "COMPLETED" || status === "SKIPPED";
}

/**
 * 실행 **한 줄 자신**의 형편. 노드만 봐서는 알 수 없는 것이라 따로 받는다.
 *
 * 🔴 선택 인자로 두지 않는다. 빠뜨리면 「아직 도는 실행」으로 읽혀, 마친
 * 실행에서 **지금 할 일이 다시 뜨는** 바로 그 결함으로 조용히 돌아간다.
 */
export type ExecutionFocusContext = {
  /** procedure_case_executions.completed_at 이 찼는가. */
  isExecutionFinished: boolean;
};

/**
 * 「지금 할 일」 하나를 고른다. 차례는 이렇다:
 *
 *   0. **마친 실행이면 아무것도 안 고른다.** 사람이 [절차 끝내기]를 눌렀으면
 *      남은 노드가 있어도 마친 것이다 — 남은 것을 띄우면 「마쳤다」는 사람의
 *      판단을 화면이 뒤집는 꼴이 된다.
 *   1. 진행 중(IN_PROGRESS)이 있으면 그것. 여럿이면 **배열에서 먼저 나오는 것**
 *      (= 절차 차례가 앞선 것).
 *   2. 없으면 대기(PENDING) 중 배열에서 먼저 나오는 것.
 *   3. 둘 다 없으면 없음.
 *
 * 🔴 차단됨(BLOCKED)은 절대 고르지 않는다. 사람이 사유를 적어 막아 둔 것이라,
 * 그것을 「지금 할 일」로 크게 띄우면 막아 둔 뜻이 화면에서 지워진다. 막힌 것을
 * 풀려면 차단됨 구역에서 [재개]를 누르는 길이 따로 있다.
 *
 * 🔴 진행 중을 대기보다 먼저 보는 까닭: 사람이 [시작]을 누른 일이 절차 차례상
 * 뒤쪽이더라도, **손을 댄 일**이 지금 하고 있는 일이다. 차례가 앞선 대기를
 * 띄우면 방금 시작한 일이 또 화면에서 사라진다 — 이 화면의 원래 불만이
 * 「[시작]을 누르면 카드가 사라진다」였다.
 *
 * 🔴 「마쳤는가」를 여기서 판정하는 까닭은 **쓰는 자리가 셋**이기 때문이다 —
 * 큰 카드 · 흐름 띠 · 아래 목록. 화면마다 `completedAt` 을 다시 보면 한 곳만
 * 고치는 날이 오고, 타입이 같아 컴파일러는 아무 말도 안 한다.
 */
export function pickCurrentTask<T extends FocusCandidate>(
  nodes: readonly T[],
  context: ExecutionFocusContext
): CurrentTaskPick<T> {
  if (context.isExecutionFinished) return { kind: "NONE", reason: "EXECUTION_FINISHED" };
  if (nodes.length === 0) return { kind: "NONE", reason: "NO_NODES" };

  const inProgress = nodes.find((n) => n.status === "IN_PROGRESS");
  if (inProgress) return { kind: "IN_PROGRESS", node: inProgress };

  const pending = nodes.find((n) => n.status === "PENDING");
  if (pending) return { kind: "PENDING", node: pending };

  // 여기까지 왔으면 남은 것은 완료·건너뜀·차단됨뿐이다.
  return { kind: "NONE", reason: nodes.every((n) => isFinished(n.status)) ? "ALL_FINISHED" : "ALL_BLOCKED" };
}

/** 노드만 필요할 때. 없으면 null — 까닭이 필요하면 pickCurrentTask 를 쓴다. */
export function pickCurrentTaskNode<T extends FocusCandidate>(
  nodes: readonly T[],
  context: ExecutionFocusContext
): T | null {
  const pick = pickCurrentTask(nodes, context);
  return pick.kind === "NONE" ? null : pick.node;
}

// ---- 하나를 끝냈을 때 설 「다음 하나」 ----

/**
 * 선 하나. 🔵 2026-11-03(조각 13)부터 템플릿 간선과 **이 건에서 그은 간선**이
 * 섞여 들어온다 — 양끝은 어느 쪽이든 AutoAdvanceGraphNode.id 와 같은 열쇠다.
 */
export type AutoAdvanceEdge = {
  /** procedure_template_edges.id 또는 procedure_case_execution_edges.id */
  id: string;
  fromNodeId: string;
  toNodeId: string;
};

export type AutoAdvanceCandidate = {
  /** procedure_case_execution_nodes.id — 세울 대상의 식별자. */
  id: string;
  /**
   * **그림 위 자리 id**. 템플릿에서 온 줄은 그 템플릿 노드 id, 이 건에서 더한
   * 작업은 **제 실행 노드 id** 다(2026-11-03, 조각 13).
   */
  graphNodeId: string;
  status: ProcedureCaseExecutionNodeStatus;
};

export type AutoAdvanceGraphNode = {
  /** 그림 위 자리 id — procedure_template_nodes.id 또는 추가 작업의 실행 노드 id. */
  id: string;
  nodeType: ProcedureNodeType;
};

export type AutoAdvanceSkipReason =
  /**
   * 나가는 간선이 없다(END, 그리다 만 가지, **또는 아직 아무 데도 안 이은 추가
   * 작업**).
   *
   * 🔴 2026-11-03(조각 13)에 마지막 하나가 여기로 합쳐졌다. 전에는
   * NOT_IN_GRAPH 라는 까닭이 따로 있었고 뜻이 「추가 작업이라 그래프에 자리가
   * 없다」였는데, 추가 작업이 선을 가질 수 있게 되면서 그 말이 거짓이 됐다 —
   * 자리는 언제나 있고 없는 것은 선뿐이다.
   */
  | "NO_OUTGOING_EDGE"
  /** 판단 노드인데 고른 갈래가 이 노드에서 나가는 간선이 아니다. */
  | "SELECTED_BRANCH_MISSING"
  /** 판단이 아닌데 나가는 간선이 여럿 — 어느 쪽인지 **사람만 안다.** */
  | "AMBIGUOUS_OUTGOING_EDGES"
  /**
   * 간선이 가리키는 노드에 실행 행이 없는데 **참고 문서도 아니다.**
   *
   * 🔴 전에는 참고 문서가 여기로 떨어졌다(= 참고 문서를 만나면 거기서 멈췄다).
   * 지금은 참고 문서를 건너뛰므로(아래 resolveAutoAdvanceTarget), 이 까닭이 남는
   * 경우는 **일어나면 안 되는 일**뿐이다 — 게시된 템플릿은 더 바뀌지 않고, 실행
   * 행은 시작할 때 실행 가능한 노드마다 한 줄씩 만들어지므로 둘이 어긋날 길이
   * 없다. 그래도 조용히 다른 노드로 흘러가지 않게 까닭을 따로 둔다.
   */
  | "TARGET_NOT_EXECUTABLE"
  /**
   * 참고 문서를 건너뛰다가 **아까 지나온 참고 문서로 되돌아왔다.**
   *
   * 실측(2026-11-02, rfg-full-lifecycle)에 참고 문서가 연달아 붙은 자리가 있다
   * (s31-50 → s31-56). 둘이 서로를 가리키거나 자기를 가리키면 건너뛰기가 영영
   * 끝나지 않는다 — 그때는 **돌지 말고 멈춘다.** 무한 반복은 실패로 나타나지
   * 않고 「화면이 안 돌아온다」로 나타나서, 까닭을 따로 두지 않으면 나중에 아무도
   * 못 찾는다.
   */
  | "REFERENCE_CHAIN_LOOPS"
  /** 🔴 이미 완료·건너뜀 — 고리가 있는 절차에서 끝난 일을 되살리면 안 된다. */
  | "TARGET_ALREADY_FINISHED"
  /** 사람이 사유를 적어 막아 둔 것 — 자동으로 풀지 않는다. */
  | "TARGET_BLOCKED"
  /** 🔴 이미 누가 하고 있다 — 남의 진행 중을 건드리지 않는다(끄지도, 다시 세우지도). */
  | "TARGET_ALREADY_IN_PROGRESS";

export type AutoAdvanceDecision =
  | {
      kind: "ADVANCE";
      executionNodeId: string;
      /**
       * 세운 노드로 **들어가는** 간선(템플릿 간선 또는 이 건에서 그은 간선의 id).
       *
       * 🔴 참고 문서를 건너뛴 경우 이것은 사람이 고른 갈래가 아니라 **사슬의
       * 마지막 간선**이다 — 참고 문서에서 나와 이 노드로 들어가는 선. 이력에
       * 적히는 값이라 「세운 노드로 들어가지 않는 간선」이면 줄 자체가 앞뒤가
       * 안 맞는다. 건너뛰었다는 사실은 이 간선의 출발점이 참고 문서라는 것으로
       * 그대로 읽힌다.
       */
      viaEdgeId: string;
    }
  | { kind: "SKIP"; reason: AutoAdvanceSkipReason };

/**
 * 세울 수 있는 상태인가. 세울 수 있으면 null, 아니면 그 까닭.
 *
 * 쓰는 곳이 둘이다: 아래 resolveAutoAdvanceTarget 이 한 번 보고, 쓰기 쪽
 * (db/mutations/procedure-case-execution.ts)이 **행을 잠근 뒤 다시** 본다.
 * 잠그기 전에 읽은 상태는 그 사이에 바뀔 수 있고, 잠근 뒤의 판정이 진짜다.
 * 두 자리가 같은 함수를 봐야 「잠그기 전엔 되는데 잠근 뒤엔 안 된다」가 서로
 * 다른 뜻으로 갈리지 않는다.
 */
export function classifyAutoAdvanceTarget(status: ProcedureCaseExecutionNodeStatus): AutoAdvanceSkipReason | null {
  if (status === "COMPLETED" || status === "SKIPPED") return "TARGET_ALREADY_FINISHED";
  if (status === "BLOCKED") return "TARGET_BLOCKED";
  if (status === "IN_PROGRESS") return "TARGET_ALREADY_IN_PROGRESS";
  return null;
}

/**
 * 노드 하나를 **완료**했을 때, 저절로 진행 중으로 세울 노드를 고른다.
 *
 *  - 판단(DECISION)이면 — **고른 갈래가 가리키는 노드**.
 *  - 판단이 아니면 — 나가는 간선이 **하나뿐일 때만** 그 노드. 여럿이면 어느
 *    쪽으로 가는지는 그리다 만 절차에서 알 길이 없으므로 아무것도 안 세운다.
 *    🔴 여럿일 때 첫째를 고르는 것은 **틀린 쪽을 1순위로 만드는 것**이다 —
 *    사람이 아무것도 안 고른 것처럼 보이지만 실은 왼쪽을 고른 것이 된다.
 *
 * ──────────────────────────────────────────────────────────────────────
 * 🔴 참고 문서는 **건너뛴다** — 거기서 멈추지 않는다
 * ──────────────────────────────────────────────────────────────────────
 * 참고 문서(DOCUMENT_REFERENCE)는 사람이 할 일이 아니라 읽을 것이라 실행 행을
 * 아예 안 만든다(isExecutableNodeType). 그런데 간선은 그 노드를 **지나간다** —
 * 실측(2026-11-02) rfg-full-lifecycle 에 들어오는 선과 나가는 선을 다 가진
 * 참고 문서가 둘 있다:
 *
 *   s31-45(TASK) → s31-50(참고) → s31-53(END)
 *                  s31-50(참고) → s31-56(참고) → s31-58(END)
 *
 * 전에는 s31-45 를 완료하면 s31-50 에 실행 행이 없다는 이유로 아무것도 안 섰다
 * (TARGET_NOT_EXECUTABLE). 절차가 그 자리에서 조용히 멈춘다 — 지금은 그 절차가
 * 초안이라 안 터지지만 게시하는 날 거기서 멈춘다. 그래서 참고 문서를 만나면
 * **그 너머의 다음 노드**를 본다.
 *
 * 건너뛰는 동안에도 잣대는 그대로다:
 *  - 참고 문서에서 나가는 간선이 **여럿이면 안 세운다**(AMBIGUOUS_OUTGOING_
 *    EDGES). 위 s31-50 이 바로 그 모양이다 — END 로도 가고 다음 참고 문서로도
 *    간다. 참고 문서는 판단이 아니므로 고른 갈래라는 것이 없고, 어느 쪽인지는
 *    여기서 알 길이 없다.
 *  - 나가는 간선이 **없으면** NO_OUTGOING_EDGE. 읽고 끝나는 참고 문서다.
 *  - 🔴 지나온 참고 문서를 **다시 만나면 멈춘다**(REFERENCE_CHAIN_LOOPS).
 *    참고 문서가 연달아 붙은 자리가 실제로 있어서, 그것들이 고리를 이루면
 *    걸음 수로는 안 끝난다. 조각 3 의 흐름 띠(minimap 의 walk)가 같은 문제를
 *    같은 방법으로 푼다 — 본 것을 기억한다.
 *
 * `edges` 에는 **그림 전체**를 준다(템플릿 간선 + 이 건에서 그은 간선). 끝낸
 * 노드에서 나가는 것만 주면 참고 문서 너머를 볼 수 없다 — 그 노드에서 나가는
 * 선이 거기 없기 때문이다. 끝낸 노드 것만 골라 쓰는 첫 단계는 fromNodeId 로 한
 * 번 더 거르므로, 전체를 줘도 틀리지 않는다.
 *
 * 🔵 2026-11-03(조각 13) — **이 건에서 그은 선으로도 다음이 선다.** 합치는 일은
 * 조회가 하고(getExecutionDetail), 이 함수는 받은 한 목록을 그대로 걷는다.
 */
export function resolveAutoAdvanceTarget(input: {
  /** 끝낸 노드의 **그림 위 자리 id**(템플릿 노드 id 또는 추가 작업의 실행 노드 id). */
  completedGraphNodeId: string;
  isDecision: boolean;
  /** 판단일 때 사람이 고른 갈래(간선 id). 아니면 null. */
  selectedOutgoingEdgeId: string | null;
  /** 🔴 그림 **전체**의 간선(위 머리말 참고). */
  edges: readonly AutoAdvanceEdge[];
  /**
   * 그림 칸의 갈래. 실행 행이 없는 노드가 **참고 문서라서** 없는 것인지,
   * 있어야 하는데 없는 것인지를 이것으로만 가를 수 있다.
   */
  graphNodes: readonly AutoAdvanceGraphNode[];
  /** 같은 실행에 속한 실행 노드 전부(끝낸 것 자신이 섞여 있어도 된다). */
  executionNodes: readonly AutoAdvanceCandidate[];
}): AutoAdvanceDecision {
  const outgoing = input.edges.filter((e) => e.fromNodeId === input.completedGraphNodeId);

  let edge: AutoAdvanceEdge | undefined;
  if (input.isDecision) {
    edge = input.selectedOutgoingEdgeId
      ? outgoing.find((e) => e.id === input.selectedOutgoingEdgeId)
      : undefined;
    // 판단은 갈래를 고르지 않으면 완료 자체가 거절되므로(DECISION_SELECTION_
    // REQUIRED) 여기 닿을 일이 없다. 그래도 조용히 첫 간선으로 흘러가지 않게
    // 막아 둔다 — 흘러가면 「사람이 NG 를 골랐는데 YES 쪽이 섰다」가 된다.
    if (!edge) return { kind: "SKIP", reason: "SELECTED_BRANCH_MISSING" };
  } else {
    if (outgoing.length === 0) return { kind: "SKIP", reason: "NO_OUTGOING_EDGE" };
    if (outgoing.length > 1) return { kind: "SKIP", reason: "AMBIGUOUS_OUTGOING_EDGES" };
    edge = outgoing[0];
  }

  const nodeTypeById = new Map(input.graphNodes.map((n) => [n.id, n.nodeType]));
  // 🔴 **지나온 참고 문서만** 기억한다. 끝낸 노드 자신을 미리 넣어 두지 않는
  // 까닭: 자기 자신으로 돌아오는 간선이 있으면 그 행은 방금 완료라
  // TARGET_ALREADY_FINISHED 로 갈려야 하고, 그것이 고리를 막는 기존 규칙이다
  // (「끝난 일을 되살리지 않는다」). 여기서 먼저 가로채면 같은 일에 까닭이 둘이
  // 된다.
  const passedReferenceNodeIds = new Set<string>();

  // 참고 문서는 유한하고 한 번 지나간 것은 다시 안 들어가므로, 이 반복은 반드시
  // 끝난다 — 끝나는 근거가 걸음 수가 아니라 **집합이 자란다**는 것이다.
  let hop: AutoAdvanceEdge = edge;
  for (;;) {
    const targetGraphNodeId = hop.toNodeId;
    const target = input.executionNodes.find((n) => n.graphNodeId === targetGraphNodeId);
    if (target) {
      const blockedReason = classifyAutoAdvanceTarget(target.status);
      if (blockedReason) return { kind: "SKIP", reason: blockedReason };
      return { kind: "ADVANCE", executionNodeId: target.id, viaEdgeId: hop.id };
    }

    const targetNodeType = nodeTypeById.get(targetGraphNodeId);
    // 갈래를 모르거나(템플릿에 없는 노드) 실행 행이 있어야 할 갈래인데 없다 —
    // 둘 다 건너뛸 근거가 없다. 건너뛰면 **없는 줄 알고 지나친 일**이 생긴다.
    if (targetNodeType === undefined || isExecutableNodeType(targetNodeType)) {
      return { kind: "SKIP", reason: "TARGET_NOT_EXECUTABLE" };
    }

    if (passedReferenceNodeIds.has(targetGraphNodeId)) {
      return { kind: "SKIP", reason: "REFERENCE_CHAIN_LOOPS" };
    }
    passedReferenceNodeIds.add(targetGraphNodeId);

    const beyond = input.edges.filter((e) => e.fromNodeId === targetGraphNodeId);
    if (beyond.length === 0) return { kind: "SKIP", reason: "NO_OUTGOING_EDGE" };
    if (beyond.length > 1) return { kind: "SKIP", reason: "AMBIGUOUS_OUTGOING_EDGES" };
    hop = beyond[0];
  }
}
