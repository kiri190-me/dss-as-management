/**
 * 작업 기록을 **어느 절차 항목에 붙일 것인가** — 고를 것들과 **처음 골라져 있을
 * 것**. 순수 함수만 — DOM 도 React 도 DB 도 건드리지 않는다
 * (procedure-execution-focus.ts 와 같은 규약).
 *
 * ──────────────────────────────────────────────────────────────────────
 * 왜 이 파일이 생겼는가 — 기본값이 「연결 안 함」이라 **대부분 안 이어졌다**
 * ──────────────────────────────────────────────────────────────────────
 * 작업 기록 폼의 「관련 절차 항목 (선택)」은 기본값이 「연결 안 함」이었다.
 * 사람이 매번 손으로 바꿔야 이어지니, 실제로는 거의 이어지지 않았다 — 절차를
 * 밟으며 적은 기록인데 무엇을 하다 적었는지가 안 남는다.
 *
 * 그래서 기본값을 **「지금 할 일」 노드**로 둔다. 어느 것이 지금 할 일인지는
 * 여기서 다시 고르지 않는다 — pickCurrentTask(procedure-execution-focus.ts)가
 * 고른 결과를 인자로 받는다. 두 벌로 두면 큰 카드에는 7번이 서 있는데 기록은
 * 8번에 붙는 날이 오고, 타입이 같아 컴파일러는 아무 말도 안 한다.
 *
 * ──────────────────────────────────────────────────────────────────────
 * 🔴 담는 조건을 **전부**로 넓혔다 — 「진행 중」만 담으면 안 보이는 것이 있다
 * ──────────────────────────────────────────────────────────────────────
 * 전에는 IN_PROGRESS 인 노드만 담았다. 그런데 이 화면은 [시작] 없이 바로
 * [완료]할 수 있고(completeExecutionNode 는 PENDING 에서도 받는다), 자동 전진이
 * 선 노드를 빼면 사람이 [시작]을 안 누르는 일이 흔하다. 그래서
 *
 *  - 방금 **완료한** 노드는 목록에 영영 안 나타났다. 일을 끝내고 기록을 적는
 *    것이 보통 차례인데, 그때 그 노드가 이미 완료라 붙일 수가 없었다.
 *  - 「지금 할 일」이 **대기(PENDING)** 인 경우도 안 나타났다 — 기본값으로
 *    두려는 바로 그 노드가 목록에 없었다.
 *
 * 그래서 상태로 거르지 않고 **실행의 모든 노드**를 담는다. 길어지는 대신
 * (실측 22~28줄) 줄마다 번호와 상태를 적어 고를 수 있게 한다. 번호는 카드에
 * 찍힌 번호와 같은 자다(getExecutionDetail 의 orderIndex).
 *
 * 🔴 「연결 안 함」은 **그대로 남는다.** 절차와 무관한 기록이 있다(고객 통화,
 * 입고 확인 같은 것). 그 선택지를 없애면 그런 기록이 엉뚱한 노드에 붙는다 —
 * 그쪽이 안 붙은 것보다 나쁘다.
 *
 * 받는 배열은 getExecutionDetail 이 **절차 차례로** 내려준 그대로다. 여기서
 * 다시 정렬하지 않는다(procedure-execution-order.ts 머리말) — 목록의 번호가
 * 1, 2, 3 … 으로 흐르는 것이 사람이 훑는 방법이다.
 */

import {
  procedureCaseExecutionNodeStatusLabels,
  type ProcedureCaseExecutionNodeStatus,
} from "./procedure-case-execution-types";

export type WorkRecordProcedureLinkCandidate = {
  /** procedure_case_execution_nodes.id — 서버로 가는 값이다. */
  id: string;
  /** 1 부터 매긴 절차상 번호. 0 이면 번호를 안 적는다. */
  orderIndex: number;
  title: string;
  status: ProcedureCaseExecutionNodeStatus;
};

export type WorkRecordProcedureLinkOption = {
  id: string;
  /** 드롭다운 줄에 그대로 뜨는 글자. */
  label: string;
};

export type WorkRecordProcedureLink = {
  options: WorkRecordProcedureLinkOption[];
  /**
   * 처음 골라져 있을 것. 「지금 할 일」이 없으면 null 이고, 그때는 「연결 안
   * 함」이 골라진 채로 선다 — 아무거나 하나를 끌어다 기본으로 쓰면 **틀린 쪽을
   * 1순위로 만드는 것**이다.
   */
  defaultNodeId: string | null;
};

/** 지금 할 일이면 그 사실을, 아니면 상태를 적는다 — 둘은 같은 자리에서 읽힌다. */
function formatOptionLabel(node: WorkRecordProcedureLinkCandidate, isCurrentTask: boolean): string {
  const numbered = node.orderIndex > 0 ? `${node.orderIndex}. ${node.title}` : node.title;
  return `${numbered} · ${isCurrentTask ? "지금 할 일" : procedureCaseExecutionNodeStatusLabels[node.status]}`;
}

export function buildWorkRecordProcedureLink(input: {
  /** 실행의 모든 노드. getExecutionDetail 이 내려준 차례 그대로. */
  nodes: readonly WorkRecordProcedureLinkCandidate[];
  /** pickCurrentTask 가 고른 「지금 할 일」의 실행 노드 id. 없으면 null. */
  currentTaskNodeId: string | null;
}): WorkRecordProcedureLink {
  const options = input.nodes.map((node) => ({
    id: node.id,
    label: formatOptionLabel(node, node.id === input.currentTaskNodeId),
  }));

  // 🔴 받은 id 가 목록에 정말 있을 때만 기본값으로 쓴다. 없는 id 를 기본값으로
  // 두면 화면의 <select> 가 아무것도 안 고른 모양이 되는데, 그러면 **사람이
  // 고른 것처럼 보이는 빈 값**이 서버로 간다.
  const defaultNodeId =
    input.currentTaskNodeId !== null && options.some((option) => option.id === input.currentTaskNodeId)
      ? input.currentTaskNodeId
      : null;

  return { options, defaultNodeId };
}
