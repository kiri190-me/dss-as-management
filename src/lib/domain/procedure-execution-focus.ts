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

// ---- 「지금 할 일」 하나 고르기 ----

export type FocusCandidate = { status: ProcedureCaseExecutionNodeStatus };

export type CurrentTaskPick<T> =
  | { kind: "IN_PROGRESS"; node: T }
  | { kind: "PENDING"; node: T }
  /**
   * 지금 할 일이 없다. 까닭이 셋이고 화면 문구가 각각 달라야 한다 —
   * 「다 끝났습니다」와 「남은 것이 전부 차단돼 있습니다」는 사람이 해야 할
   * 다음 행동이 정반대다.
   */
  | { kind: "NONE"; reason: "NO_NODES" | "ALL_FINISHED" | "ALL_BLOCKED" };

function isFinished(status: ProcedureCaseExecutionNodeStatus): boolean {
  return status === "COMPLETED" || status === "SKIPPED";
}

/**
 * 「지금 할 일」 하나를 고른다. 차례는 이렇다:
 *
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
 */
export function pickCurrentTask<T extends FocusCandidate>(nodes: readonly T[]): CurrentTaskPick<T> {
  if (nodes.length === 0) return { kind: "NONE", reason: "NO_NODES" };

  const inProgress = nodes.find((n) => n.status === "IN_PROGRESS");
  if (inProgress) return { kind: "IN_PROGRESS", node: inProgress };

  const pending = nodes.find((n) => n.status === "PENDING");
  if (pending) return { kind: "PENDING", node: pending };

  // 여기까지 왔으면 남은 것은 완료·건너뜀·차단됨뿐이다.
  return { kind: "NONE", reason: nodes.every((n) => isFinished(n.status)) ? "ALL_FINISHED" : "ALL_BLOCKED" };
}

/** 노드만 필요할 때. 없으면 null — 까닭이 필요하면 pickCurrentTask 를 쓴다. */
export function pickCurrentTaskNode<T extends FocusCandidate>(nodes: readonly T[]): T | null {
  const pick = pickCurrentTask(nodes);
  return pick.kind === "NONE" ? null : pick.node;
}

// ---- 하나를 끝냈을 때 설 「다음 하나」 ----

export type AutoAdvanceEdge = {
  /** procedure_template_edges.id */
  id: string;
  fromNodeId: string;
  toNodeId: string;
};

export type AutoAdvanceCandidate = {
  /** procedure_case_execution_nodes.id — 세울 대상의 식별자. */
  id: string;
  /** 사례별 추가 작업은 null(템플릿 노드가 없다). */
  procedureTemplateNodeId: string | null;
  status: ProcedureCaseExecutionNodeStatus;
};

export type AutoAdvanceSkipReason =
  /** 끝낸 것이 사례별 추가 작업이라 그래프에 자리가 없다 — 다음이라는 개념이 없다. */
  | "NOT_IN_GRAPH"
  /** 나가는 간선이 없다(END, 또는 그리다 만 가지). */
  | "NO_OUTGOING_EDGE"
  /** 판단 노드인데 고른 갈래가 이 노드에서 나가는 간선이 아니다. */
  | "SELECTED_BRANCH_MISSING"
  /** 판단이 아닌데 나가는 간선이 여럿 — 어느 쪽인지 **사람만 안다.** */
  | "AMBIGUOUS_OUTGOING_EDGES"
  /** 간선이 가리키는 노드에 실행 행이 없다(참고 문서는 실행 행을 안 만든다). */
  | "TARGET_NOT_EXECUTABLE"
  /** 🔴 이미 완료·건너뜀 — 고리가 있는 절차에서 끝난 일을 되살리면 안 된다. */
  | "TARGET_ALREADY_FINISHED"
  /** 사람이 사유를 적어 막아 둔 것 — 자동으로 풀지 않는다. */
  | "TARGET_BLOCKED"
  /** 🔴 이미 누가 하고 있다 — 남의 진행 중을 건드리지 않는다(끄지도, 다시 세우지도). */
  | "TARGET_ALREADY_IN_PROGRESS";

export type AutoAdvanceDecision =
  | { kind: "ADVANCE"; executionNodeId: string; viaEdgeId: string }
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
 * `edges` 에는 이 노드에서 나가는 것만 줘도 되고 템플릿 전체를 줘도 된다 —
 * fromNodeId 로 한 번 더 거른다. 부르는 쪽이 거르는 것을 잊어도 틀리지 않게.
 */
export function resolveAutoAdvanceTarget(input: {
  /** 끝낸 노드의 procedure_template_nodes.id. 추가 작업이면 null. */
  completedTemplateNodeId: string | null;
  isDecision: boolean;
  /** 판단일 때 사람이 고른 갈래(procedure_template_edges.id). 아니면 null. */
  selectedOutgoingEdgeId: string | null;
  edges: readonly AutoAdvanceEdge[];
  /** 같은 실행에 속한 실행 노드 전부(끝낸 것 자신이 섞여 있어도 된다). */
  executionNodes: readonly AutoAdvanceCandidate[];
}): AutoAdvanceDecision {
  if (input.completedTemplateNodeId === null) return { kind: "SKIP", reason: "NOT_IN_GRAPH" };

  const outgoing = input.edges.filter((e) => e.fromNodeId === input.completedTemplateNodeId);

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

  const target = input.executionNodes.find((n) => n.procedureTemplateNodeId === edge.toNodeId);
  if (!target) return { kind: "SKIP", reason: "TARGET_NOT_EXECUTABLE" };

  const blockedReason = classifyAutoAdvanceTarget(target.status);
  if (blockedReason) return { kind: "SKIP", reason: blockedReason };

  return { kind: "ADVANCE", executionNodeId: target.id, viaEdgeId: edge.id };
}
