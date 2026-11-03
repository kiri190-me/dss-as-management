/**
 * 「추가 작업 등록」 창이 **무엇을 고를 수 있고 무엇을 못 지우는지**
 * (2026-11-03, 조각 13). 순수 함수만 — DOM 도 React 도 DB 도 건드리지 않는다
 * (procedure-execution-jump.ts 와 같은 규약).
 *
 * ──────────────────────────────────────────────────────────────────────
 * 왜 이 파일이 생겼는가 (사용자 말 그대로, 2026-11-02)
 * ──────────────────────────────────────────────────────────────────────
 * 「[추가 작업 등록]을 누르면 팝업으로 내용을 적을 수 있도록 해줘.」
 * 「[추가 작업 등록]에서의 팝업은 플로우차트 편집화면에서처럼 노드종류를
 *  선택하고, 만들고, 잇는 기능들이 포함되도록 해줘.」
 * 「12의 추가 작업 등록은 [기술작업절차]편집기에 있는 노드 추가/제거, 연결선
 *  추가/제거 ui대로 편집기능들을 만들어줘.」
 *
 * ──────────────────────────────────────────────────────────────────────
 * 🔴 **못 지우는 것을 누르면 까닭이 보여야 한다**
 * ──────────────────────────────────────────────────────────────────────
 * 이 창은 **이 건에서 더한 것만** 지운다 — 원본 절차의 단계와 연결은 그대로
 * 둔다(2026-11-02 결정). 그런데 그림에서는 둘이 똑같이 생겼고 둘 다 눌러진다.
 * 못 지우는 것을 눌렀을 때 단추만 조용히 흐려지면 **고장으로 읽힌다** — 그래서
 * 「왜 안 되는지」를 글자로 돌려준다(classifyStartNode · classifyJumpTarget 과
 * 같은 규약: 참·거짓이 아니라 까닭을 돌려준다).
 *
 * 🔴 글자를 **여기 한 곳에만** 적는다. 쓰기 쪽도 같은 말을 하지만(서버가 제
 * 손으로 다시 가른다), 화면이 먼저 보여 주는 글이 여기 있다 — 두 벌로 적어 두면
 * 한쪽만 고치는 날이 오고, 사람은 같은 거절에 두 가지 말을 듣게 된다.
 */

import { procedureBranchTypeLabels, type ProcedureBranchType } from "./procedure-template-types";
import { flattenNodeTitle } from "./procedure-start-picker";

/** 창이 다루는 **한 작업**. ExecutionNodeDetail 이 이 모양을 품고 있어 화면은 넘기기만 한다. */
export type CaseEditNode = {
  /** procedure_case_execution_nodes.id — 서버로 보내는 것이 이 값이다. */
  id: string;
  /** 그림 위 자리 id — 그림에서 고른 칸을 이 줄로 되찾는 열쇠. */
  graphNodeId: string;
  orderIndex: number;
  title: string;
  /** 🔴 이 건에서 더한 작업만 지울 수 있다. */
  isAddedInCase: boolean;
  /** 그 줄 **자신의** 낙관적 동시성 토큰 — 치울 때 실어 보낸다. */
  version: number;
};

/** 창이 다루는 **한 연결**. 양끝은 그림 위 자리 id 다. */
export type CaseEditEdge = {
  id: string;
  fromNodeId: string;
  toNodeId: string;
  branchType: ProcedureBranchType;
  branchLabel: string | null;
  /** 🔴 이 건에서 그은 연결만 지울 수 있다. */
  isAddedInCase: boolean;
};

export type CaseEditRemovability = { ok: true } | { ok: false; message: string };

/** 🔴 글자는 여기서만 정한다 — 시험도 이것을 본다(화면이 제 글을 따로 적으면 두 벌이 된다). */
export const PICK_NODE_TO_REMOVE_MESSAGE = "지울 작업을 먼저 고르세요.";
export const TEMPLATE_NODE_NOT_REMOVABLE_MESSAGE =
  "원본 절차에서 온 작업은 이 창에서 지울 수 없습니다. 하지 않을 작업이면 [건너뛰기]로 사유를 남겨 주세요.";
export const PICK_EDGE_TO_REMOVE_MESSAGE = "지울 연결을 먼저 고르세요.";
export const TEMPLATE_EDGE_NOT_REMOVABLE_MESSAGE =
  "원본 절차에 그려진 연결은 이 창에서 지울 수 없습니다. 이 건에서 더한 연결만 지울 수 있습니다.";

/**
 * 고른 작업을 치울 수 있는가. `null` 은 **아직 안 골랐다**는 뜻이다 — 「못
 * 지운다」와 가르는 까닭은 사람이 해야 할 다음 행동이 다르기 때문이다(하나는
 * 고르는 것, 하나는 포기하는 것).
 */
export function classifyNodeRemoval(node: CaseEditNode | null): CaseEditRemovability {
  if (node === null) return { ok: false, message: PICK_NODE_TO_REMOVE_MESSAGE };
  if (!node.isAddedInCase) return { ok: false, message: TEMPLATE_NODE_NOT_REMOVABLE_MESSAGE };
  return { ok: true };
}

export function classifyEdgeRemoval(edge: CaseEditEdge | null): CaseEditRemovability {
  if (edge === null) return { ok: false, message: PICK_EDGE_TO_REMOVE_MESSAGE };
  if (!edge.isAddedInCase) return { ok: false, message: TEMPLATE_EDGE_NOT_REMOVABLE_MESSAGE };
  return { ok: true };
}

/**
 * 그림에서 누른 **칸**이 어느 작업 줄인지 되찾는다. 없으면 null — 시작 지점과
 * 참고 문서가 그렇다(실행 행 자체가 안 생긴다). 아무것도 안 골랐을 때도 null.
 */
export function findCaseEditNodeByGraphNodeId<T extends CaseEditNode>(
  nodes: readonly T[],
  graphNodeId: string | null
): T | null {
  if (graphNodeId === null) return null;
  return nodes.find((n) => n.graphNodeId === graphNodeId) ?? null;
}

// ---- 연결 목록에 적는 한 줄 ----

export type CaseEditEdgeRow = {
  edge: CaseEditEdge;
  /** 「3. 조정 작업 → 추가 세척」처럼 사람이 읽는 한 줄. */
  label: string;
  /** 「NG」·「사용자 정의("재측정")」 — 갈래 이름. DEFAULT 는 null(적을 것이 없다). */
  branchLabel: string | null;
  removability: CaseEditRemovability;
};

/** 번호와 제목을 한 덩이로. 번호가 없는 줄(0)은 제목만. */
function describeNode(node: CaseEditNode | undefined, fallback: string): string {
  if (!node) return fallback;
  const title = flattenNodeTitle(node.title);
  return node.orderIndex > 0 ? `${node.orderIndex}. ${title}` : title;
}

/**
 * 「연결 제거」 목록에 그릴 줄들.
 *
 * 🔵 **원본 절차의 연결도 싣는다.** 빼 버리면 지금 어떤 선이 그려져 있는지를
 * 이 창에서 볼 수 없고, 「내가 그은 선이 사라졌나」와 「원본 선이라 안 보이나」가
 * 안 갈린다. 못 지우는 줄에는 **왜 못 지우는지**가 그 자리에 적힌다.
 *
 * 🔴 양끝이 **작업 줄로 안 풀리는 선은 뺀다.** 시작 지점·참고 문서로 가는 선이
 * 그렇다 — 이 창은 「작업과 작업 사이」만 다루고, 그 선들은 고를 대상이 아니다.
 * (그림에는 그대로 그려진다 — 거기서는 절차 전체를 보여 준다.)
 *
 * 🔵 차례는 **받은 그대로**다. 조회가 sort_order 로 줄을 세워 내려주므로, 이
 * 목록의 차례가 그림의 갈래 차례와 같다.
 */
export function buildCaseEditEdgeRows(input: {
  nodes: readonly CaseEditNode[];
  edges: readonly CaseEditEdge[];
}): CaseEditEdgeRow[] {
  const byGraphNodeId = new Map<string, CaseEditNode>();
  for (const node of input.nodes) {
    if (!byGraphNodeId.has(node.graphNodeId)) byGraphNodeId.set(node.graphNodeId, node);
  }

  const rows: CaseEditEdgeRow[] = [];
  for (const edge of input.edges) {
    const from = byGraphNodeId.get(edge.fromNodeId);
    const to = byGraphNodeId.get(edge.toNodeId);
    if (!from || !to) continue;
    rows.push({
      edge,
      label: `${describeNode(from, "-")} → ${describeNode(to, "-")}`,
      branchLabel: formatCaseEditBranchLabel(edge),
      removability: classifyEdgeRemoval(edge),
    });
  }
  return rows;
}

/**
 * 갈래 이름 한 조각. DEFAULT 는 **아무것도 안 적는다** — 절차의 거의 모든 선이
 * DEFAULT 라, 적으면 목록이 「기본값」으로 도배된다(원본 절차의 쓰임이 그렇다 —
 * procedure_template_edges 의 머리말).
 */
export function formatCaseEditBranchLabel(edge: Pick<CaseEditEdge, "branchType" | "branchLabel">): string | null {
  if (edge.branchType === "DEFAULT" && !edge.branchLabel) return null;
  const name = procedureBranchTypeLabels[edge.branchType];
  return edge.branchLabel ? `${name} (${edge.branchLabel})` : name;
}
