/**
 * 절차 그림 위의 **최단 경로**와, 그것으로 다시 센 **진행률**. 순수 함수만 —
 * DOM 도 React 도 DB 도 건드리지 않는다(procedure-execution-order.ts ·
 * procedure-execution-minimap.ts 와 같은 규약).
 *
 * ──────────────────────────────────────────────────────────────────────
 * 왜 이 파일이 생겼는가 (사용자 말 그대로, 2026-11-02)
 * ──────────────────────────────────────────────────────────────────────
 * 「현재 진행 단계보다 뒤에 있는 노드로 옮겨가면 그 노드 이전의 노드들은 [완료]
 *  처리되도록 해줘. 즉, 노드의 위치에 따라 남은 절차의 수가 달라질 수 있는거지.
 *  현재보다 이전단계에 위치한 노드로 이동하면 시작점 부터 그 노드까지의 경로에
 *  있는 노드들만 [완료]처리 되도록 해줘.」
 * 「최단 경로를 계산하고, 절차 진행바의 진행 퍼센트를 계산할 때는 시작점에서
 *  현재 노드를 경유해서 끝점까지 이어지는 최단 경로중에 현재 진행 퍼센트를
 *  표시하도록 해줘.」
 *
 * ──────────────────────────────────────────────────────────────────────
 * 🔴 고리가 **실제로** 있다 — 본 노드를 기억한다
 * ──────────────────────────────────────────────────────────────────────
 * 「재측정」·「재진행」 갈래가 앞쪽 노드로 되돌아간다. 실측(2026-11-02)으로
 * 「기본 통전 검사 (3상 입력)」의 간선 42개 가운데 **14개**가 시작점에서 더
 * 가깝거나 같은 거리의 노드로 되돌아간다. 본 노드를 기억하지 않으면 BFS 가 영영
 * 안 끝난다 — 실패가 아니라 **화면이 안 돌아오는 것**으로 나타나서 나중에 아무도
 * 못 찾는다. 조각 3 의 흐름 띠(minimap 의 walk)와 조각 5 의 참고 문서 건너뛰기가
 * 같은 문제를 같은 방법으로 푼다.
 *
 * ──────────────────────────────────────────────────────────────────────
 * 🔴 최단 경로가 **여럿일 때 무엇으로 하나를 고르는가**
 * ──────────────────────────────────────────────────────────────────────
 * 길이가 같은 길이 여럿일 수 있다(실측: 「기본 통전 검사」에 같은 거리의 부모를
 * 둘 가진 노드가 하나 있다). 아무것이나 고르면 **같은 화면을 두 번 열 때 완료되는
 * 노드가 달라진다** — 그런 결함은 오류를 안 내고 아무도 신고하지 않는다.
 *
 * 그래서 차례를 못 박는다:
 *
 *   1. 간선은 **sortOrder** 가 앞선 것부터, 같으면 **간선 id** 가 앞선 것부터
 *      따라간다. sortOrder 는 절차 상세·흐름 띠·갈래 단추가 이미 쓰고 있는 그
 *      차례라(getExecutionDetail 의 orderBy), 그림에서 **왼쪽/위에 그려진 갈래**가
 *      먼저 잡힌다. sortOrder 에는 유니크 제약이 없어 겹칠 수 있으므로 id 를
 *      마지막 열쇠로 둔다(procedure-execution-order.ts 가 겹친 sort_order 를
 *      다루는 것과 같은 잣대).
 *   2. 출발점이 여럿이면(START 가 둘 이상 그려진 절차) **받은 배열 차례**가
 *      앞선 쪽. 부르는 쪽이 템플릿의 sort_order 로 정렬해 넘긴다.
 *
 * 너비 우선이므로 **먼저 닿은 쪽이 곧 최단**이고, 위 차례가 「먼저」를 정한다.
 *
 * ──────────────────────────────────────────────────────────────────────
 * 시작점·끝점을 무엇으로 잡는가 — 자료로 확인했다(2026-11-02)
 * ──────────────────────────────────────────────────────────────────────
 *  - **시작점** … nodeType 이 START 인 절차 노드. 실측 두 절차 다 하나씩 있다.
 *  - **끝점** … nodeType 이 END 인 절차 노드. 🔴 **「원복 검사 및 개선 작업
 *    (3상 입력)」에는 END 가 한 개도 없다** — 그 절차에서는 끝까지 이어지는 길
 *    자체가 성립하지 않고, 진행률은 옛 방식으로 떨어진다(아래 COUNT).
 *
 * 🔴 **셋을 가려서 다룬다.**
 *  - START 는 실행 행이 생기지만(만들 때 바로 COMPLETED) 사람이 할 일 목록에는
 *    없다(getExecutionDetail 이 뺀다). **경로에는 넣되 세지도 완료하지도 않는다.**
 *  - 참고 문서(DOCUMENT_REFERENCE)는 실행 행이 아예 없다. 간선은 그 노드를
 *    **지나가므로**(실측 rfg-full-lifecycle) 경로에는 넣되 역시 안 센다.
 *  - 🔴 **END 는 실행 행이 있고 사람이 할 일로 샌다.** 지시서에는 「END 도 실행
 *    행이 없다」고 적혀 있었지만 실측은 반대다 — isExecutableNodeType 이 END 를
 *    포함하고(procedure-execution-topology.ts), getExecutionDetail 이 빼는 것은
 *    START 하나뿐이다. 실제로 「기본 통전 검사」의 할 일 27개에 END(「완료」)가
 *    들어 있다. 그래서 END 는 **세고, 경로 위에 있으면 완료 대상이기도 하다.**
 *
 * 세는 잣대를 「실행 줄이 있는가」 하나로 둔 까닭이 이것이다 — 노드 갈래마다 다시
 * 가르면 화면의 번호(orderIndex)와 여기 수가 조용히 어긋난다.
 */

import { isSystemEntryNodeType } from "./procedure-execution-topology";
import { computeExecutionPosition, formatExecutionPositionLabel, type ExecutionPosition } from "./procedure-execution-order";
import type { ProcedureCaseExecutionNodeStatus } from "./procedure-case-execution-types";
import type { ProcedureNodeType } from "./procedure-template-types";

/** 절차 그림의 한 칸 — 경로 찾기에 필요한 것만. */
export type PathTemplateNode = {
  /** procedure_template_nodes.id */
  id: string;
  nodeType: ProcedureNodeType;
};

/** 절차 그림의 한 선 — 차례를 못 박는 데 sortOrder 가 필요하다(위 머리말). */
export type PathTemplateEdge = {
  /** procedure_template_edges.id */
  id: string;
  fromNodeId: string;
  toNodeId: string;
  sortOrder: number;
};

/** 실행 줄 — 경로 위의 칸을 실행 줄로 되찾는 데 필요한 것만. */
export type PathExecutionNode = {
  /** procedure_case_execution_nodes.id */
  id: string;
  /** 사례별 추가 작업은 null — 절차 그림에 자리가 없다. */
  procedureTemplateNodeId: string | null;
};

export function collectStartNodeIds(nodes: readonly PathTemplateNode[]): string[] {
  return nodes.filter((n) => n.nodeType === "START").map((n) => n.id);
}

export function collectEndNodeIds(nodes: readonly PathTemplateNode[]): string[] {
  return nodes.filter((n) => n.nodeType === "END").map((n) => n.id);
}

/**
 * 시작 후보에서 끝 후보까지의 **최단 경로**를 절차 노드 id 배열로 돌려준다.
 * 양끝을 포함하고, 못 찾으면 null 이다.
 *
 * 🔴 **못 찾는 경우가 흔하다.** 실측 「원복 검사 및 개선 작업 (3상 입력)」은 노드
 * 23개에 간선이 8개뿐이라 START 에서 닿는 노드가 **9개뿐**이다(14개는 아무 선에도
 * 안 닿아 있다). 그리다 만 절차가 그렇다 — 그때 null 을 돌려받은 쪽이 「아무것도
 * 안 한다」를 고르게 하려고, 빈 배열이 아니라 **null** 로 가른다. 빈 배열은
 * 「길이 0인 경로」와 섞인다.
 */
export function findShortestTemplatePath(input: {
  nodes: readonly PathTemplateNode[];
  edges: readonly PathTemplateEdge[];
  fromNodeIds: readonly string[];
  toNodeIds: readonly string[];
}): string[] | null {
  const knownNodeIds = new Set(input.nodes.map((n) => n.id));
  const sources = input.fromNodeIds.filter((id) => knownNodeIds.has(id));
  const targets = new Set(input.toNodeIds.filter((id) => knownNodeIds.has(id)));
  if (sources.length === 0 || targets.size === 0) return null;

  // 차례를 **여기서 한 번만** 정한다 — 부르는 쪽이 정렬해 줬는지에 기대면 호출
  // 자리마다 답이 달라질 수 있다(머리말의 「같은 입력이면 같은 답」).
  const outgoing = new Map<string, PathTemplateEdge[]>();
  const ordered = input.edges
    .filter((e) => knownNodeIds.has(e.fromNodeId) && knownNodeIds.has(e.toNodeId))
    .slice()
    .sort((a, b) => a.sortOrder - b.sortOrder || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  for (const edge of ordered) {
    const list = outgoing.get(edge.fromNodeId);
    if (list) list.push(edge);
    else outgoing.set(edge.fromNodeId, [edge]);
  }

  // 🔴 `parent` 가 「본 노드」 자리를 겸한다 — 한 번 들어온 노드는 다시 안 넣으므로
  // 고리가 있어도 반드시 끝난다(머리말). 출발점의 부모는 null 이다.
  const parent = new Map<string, string | null>();
  const queue: string[] = [];
  for (const source of sources) {
    if (parent.has(source)) continue;
    parent.set(source, null);
    queue.push(source);
  }

  for (let i = 0; i < queue.length; i += 1) {
    const current = queue[i];
    // 꺼낼 때 가린다 — 너비 우선이라 **먼저 꺼낸 끝점이 곧 최단**이다. 넣을 때
    // 가리면 같은 걸음의 다른 끝점과 차례가 뒤섞인다.
    if (targets.has(current)) {
      const path: string[] = [];
      for (let at: string | null = current; at !== null; at = parent.get(at) ?? null) path.push(at);
      return path.reverse();
    }
    for (const edge of outgoing.get(current) ?? []) {
      if (parent.has(edge.toNodeId)) continue;
      parent.set(edge.toNodeId, current);
      queue.push(edge.toNodeId);
    }
  }

  return null;
}

/**
 * 경로 위의 절차 노드를 **실행 줄**로 옮긴다. 실행 줄이 없는 칸(참고 문서)과
 * 시작(START) 표식은 빠진다 — 머리말의 세는 잣대 그대로다.
 */
function toExecutionNodeIdsOnPath<T extends PathExecutionNode>(
  path: readonly string[],
  templateNodes: readonly PathTemplateNode[],
  executionNodes: readonly T[]
): string[] {
  const nodeTypeById = new Map(templateNodes.map((n) => [n.id, n.nodeType]));
  const executionNodeByTemplateNodeId = new Map<string, T>();
  for (const node of executionNodes) {
    if (node.procedureTemplateNodeId === null) continue;
    // 먼저 나온 것을 남긴다 — 입력이 절차 차례이므로 「앞선 것이 이긴다」가 되고,
    // 같은 입력이면 언제나 같은 답이 나온다(minimap 과 같은 규약).
    if (!executionNodeByTemplateNodeId.has(node.procedureTemplateNodeId)) {
      executionNodeByTemplateNodeId.set(node.procedureTemplateNodeId, node);
    }
  }

  const ids: string[] = [];
  for (const templateNodeId of path) {
    const nodeType = nodeTypeById.get(templateNodeId);
    if (nodeType !== undefined && isSystemEntryNodeType(nodeType)) continue;
    const executionNode = executionNodeByTemplateNodeId.get(templateNodeId);
    if (!executionNode) continue;
    ids.push(executionNode.id);
  }
  return ids;
}

export type JumpPathResult = {
  /**
   * 시작점에서 고른 노드까지 이어지는 길을 **찾았는가**. 🔴 false 와 「찾았는데
   * 지나는 줄이 없다」는 다른 일이다 — 전자는 아무것도 완료하지 않을 근거이고,
   * 후자는 바로 첫 작업으로 옮긴 것이다. 참·거짓 하나로 뭉치면 둘이 섞인다.
   */
  found: boolean;
  /** 지나온 실행 줄 — **고른 줄 자신은 빠진다**(그 줄은 진행 중이 된다). 경로 차례 그대로. */
  executionNodeIds: string[];
};

/**
 * 「여기로 옮기기」가 **지나온 길**로 삼을 실행 줄들.
 *
 * 🔴 상태는 안 본다 — 이미 끝났는지·막혔는지를 가리는 것은 planNodeJump 의 몫이다
 * (procedure-execution-jump.ts). 여기서도 가리면 「무엇이 바뀌는가」가 두 벌이 되고,
 * 쓰기 쪽과 시험이 서로 다른 잣대로 세게 된다.
 *
 * 🔵 사례별 추가 작업으로 옮기면 언제나 `found: false` 다 — 절차 그림에 자리가
 * 없어서 「지나온 길」이라는 말 자체가 성립하지 않는다.
 */
export function resolveJumpPath<T extends PathExecutionNode>(input: {
  templateNodes: readonly PathTemplateNode[];
  edges: readonly PathTemplateEdge[];
  executionNodes: readonly T[];
  targetExecutionNodeId: string;
}): JumpPathResult {
  const target = input.executionNodes.find((n) => n.id === input.targetExecutionNodeId) ?? null;
  if (target === null || target.procedureTemplateNodeId === null) return { found: false, executionNodeIds: [] };

  const path = findShortestTemplatePath({
    nodes: input.templateNodes,
    edges: input.edges,
    fromNodeIds: collectStartNodeIds(input.templateNodes),
    toNodeIds: [target.procedureTemplateNodeId],
  });
  if (path === null) return { found: false, executionNodeIds: [] };

  const ids = toExecutionNodeIdsOnPath(path, input.templateNodes, input.executionNodes).filter(
    (id) => id !== input.targetExecutionNodeId
  );
  return { found: true, executionNodeIds: ids };
}

// ---- 진행률 ----

export type ProgressExecutionNode = PathExecutionNode & { status: ProcedureCaseExecutionNodeStatus };

/**
 * 진행률을 **무엇으로 셌는가**. 두 잣대의 수가 서로 다르므로(아래), 화면이 그
 * 차이를 적을 수 있게 갈래를 그대로 돌려준다.
 *
 *  - PATH  … 시작점 → 지금 작업 → 끝점 최단 경로에서 **몇 번째**인가.
 *  - COUNT … 옛 잣대(끝낸 수 + 1 / 전체). 경로를 못 찾을 때 떨어지는 자리다.
 */
export type ExecutionProgress =
  | {
      basis: "PATH";
      /** 경로에서 지금 작업이 몇 번째인가(1부터). 지금 작업 자신을 포함해 센다. */
      current: number;
      /** 그 경로가 지나는 **할 일 수**. 🔴 절차의 전체 할 일 수와 다른 값이다. */
      total: number;
    }
  | { basis: "COUNT"; position: ExecutionPosition };

/**
 * 「지금 몇 번째인가」를 **경로 기준**으로 다시 센다(2026-11-02, 조각 11).
 *
 * ──────────────────────────────────────────────────────────────────────
 * 🔴 왜 바꿨는가 — 「전체」가 **어느 길로 가느냐에 따라 달라진다**
 * ──────────────────────────────────────────────────────────────────────
 * 옛 잣대는 「끝낸 수 + 1 / 전체」였다(computeExecutionPosition). 분모가 절차의
 * 할 일 **전부**라서, 갈래를 어느 쪽으로 타든 늘 같은 수였다 — 판단 노드가 8할인
 * 이 절차들에서 **안 가는 길의 노드까지** 세고 있었다는 뜻이다(실측 「기본 통전
 * 검사」는 할 일 27개인데, 실제로 지나는 길은 7~16단계다).
 *
 * 🔵 옮기기와 **같은 경로**를 본다는 것도 뜻이 있다(조각 11). 옮기면 그 경로 위가
 * 완료가 되고 경로 밖의 완료는 대기로 돌아가므로, **끝낸 수와 경로상 자리가 저절로
 * 맞물린다.** 두 잣대가 서로 다른 그림을 가리키지 않는다.
 *
 * 🔴 그렇다고 **한 함수로 묶지는 않는다.** 분모가 다르다 — 진행률은 시작점 →
 * 지금 → **끝점**이고, 완료 처리는 시작점 → **지금**까지다.
 *
 * ──────────────────────────────────────────────────────────────────────
 * 🔵 짧은 길이면 더 많이 온 것이다
 * ──────────────────────────────────────────────────────────────────────
 *   START → A → B → C → D → E → END      지금 C  →  3 / 6
 *             ╲
 *              → X → END                 지금 X  →  2 / 3
 *
 * 「전체」가 절차의 할 일 수가 아니라 **이 길의 길이**이므로, 갈래를 어느 쪽으로
 * 탔는지에 따라 남은 수가 달라진다. 사용자가 요구한 것이 그것이다.
 *
 * ──────────────────────────────────────────────────────────────────────
 * 🔴 떨어지는 자리(COUNT) — 드물지 않다
 * ──────────────────────────────────────────────────────────────────────
 *  - 지금 할 일이 없다(다 끝남 · 전부 차단 · 마친 실행). 경유할 노드가 없으니
 *    경로라는 말이 성립하지 않는다.
 *  - 지금 할 일이 **사례별 추가 작업**이다 — 절차 그림에 자리가 없다.
 *  - 시작점에서 지금 작업까지, 또는 지금 작업에서 끝점까지 **길이 없다.**
 *    실측(2026-11-02): 「원복 검사 및 개선 작업 (3상 입력)」은 END 가 아예 없어
 *    언제나 여기로 떨어지고, 「기본 통전 검사 (3상 입력)」도 할 일 27개 가운데
 *    **4개**는 END 로 가는 길이 없다.
 *
 * 떨어진 것을 화면이 **알아볼 수 있어야** 한다 — 두 잣대의 수가 서로 다르기
 * 때문이다(formatExecutionProgressLabel 이 그 글자를 만든다).
 */
export function computeExecutionProgress(input: {
  /** 사람이 할 일 전부 — getExecutionDetail 이 내려준 배열 그대로(START 는 이미 빠져 있다). */
  nodes: readonly ProgressExecutionNode[];
  /** 절차 **그림 재료** — START · 참고 문서까지 전부. */
  templateNodes: readonly PathTemplateNode[];
  edges: readonly PathTemplateEdge[];
  /** pickCurrentTask 가 고른 「지금 할 일」. 🔴 화면이 다시 고르지 않는다. */
  currentExecutionNodeId: string | null;
}): ExecutionProgress {
  const fallback: ExecutionProgress = { basis: "COUNT", position: computeExecutionPosition(input.nodes) };
  if (input.currentExecutionNodeId === null) return fallback;

  const current = input.nodes.find((n) => n.id === input.currentExecutionNodeId) ?? null;
  if (current === null || current.procedureTemplateNodeId === null) return fallback;

  const head = findShortestTemplatePath({
    nodes: input.templateNodes,
    edges: input.edges,
    fromNodeIds: collectStartNodeIds(input.templateNodes),
    toNodeIds: [current.procedureTemplateNodeId],
  });
  if (head === null) return fallback;

  const tail = findShortestTemplatePath({
    nodes: input.templateNodes,
    edges: input.edges,
    fromNodeIds: [current.procedureTemplateNodeId],
    toNodeIds: collectEndNodeIds(input.templateNodes),
  });
  if (tail === null) return fallback;

  const headIds = toExecutionNodeIdsOnPath(head, input.templateNodes, input.nodes);
  const tailIds = toExecutionNodeIdsOnPath(tail, input.templateNodes, input.nodes);
  // 두 토막의 **이음매가 지금 작업**이라 한 번씩 들어 있다 — 그래서 1 을 뺀다.
  //
  // 🔵 앞 토막과 뒤 토막에 **같은 줄이 또 나올 수 있다**(고리가 있는 절차에서
  // 「재측정」으로 되돌아가는 길). 그때는 두 번 센다 — 실제로 그 작업을 두 번
  // 하는 길이고, 빼 버리면 current + 남은 수가 total 과 안 맞는다.
  const total = headIds.length + tailIds.length - 1;
  if (headIds.length === 0 || total <= 0) return fallback;

  return { basis: "PATH", current: headIds.length, total };
}

/**
 * 진행바가 쓰는 퍼센트. 🔴 **위의 자리 수와 같은 자**를 쓴다 — 전에는 바가
 * 「완료+건너뜀 / 전체」, 글자가 「끝낸 수 + 1 / 전체」라 둘이 다른 것을 재고
 * 있었다. 한 상자 안에서 다른 자를 쓰면 어느 쪽을 믿어야 할지 알 수 없다.
 */
export function executionProgressPercent(progress: ExecutionProgress): number {
  if (progress.basis === "PATH") {
    return progress.total === 0 ? 0 : Math.round((progress.current / progress.total) * 100);
  }
  const { finished, total } = progress.position;
  return total === 0 ? 0 : Math.round((finished / total) * 100);
}

/**
 * 요약 상자에 적을 한 줄. 노드가 하나도 없으면 null — 부르는 쪽이 아무것도 안
 * 그린다.
 *
 * 🔴 두 잣대의 글자가 **서로 달라야** 한다. 바로 아래 수치 줄에 「전체 27」이
 * 적혀 있는데 여기에도 「전체 6」이 뜨면, 나란히 선 두 수가 같은 것을 재는 줄
 * 알고 「왜 다르지」가 된다. 그래서
 *
 *  - 경로 기준은 **「이 길에서」** 로 시작하고 「전체」라는 낱말을 안 쓴다.
 *    「6단계」는 **이 길이 지나는 할 일 수**이지 절차의 할 일 수가 아니다.
 *  - 옛 잣대로 떨어졌으면 **「· 끝낸 수 기준」** 을 붙여 그 사실을 적는다.
 *    안 붙이면 같은 화면이 어떤 때는 경로를, 어떤 때는 끝낸 수를 말하는데
 *    사람은 그 차이를 알 길이 없다.
 */
export function formatExecutionProgressLabel(progress: ExecutionProgress): string | null {
  if (progress.basis === "PATH") return `이 길에서 ${progress.current}번째 / ${progress.total}단계`;
  const label = formatExecutionPositionLabel(progress.position);
  if (label === null) return null;
  // 다 끝났을 때(「N / M · 끝」)는 잣대를 안 붙인다 — 그 글자에는 경로 기준의
  // 짝이 애초에 없고, 「끝」 뒤에 덧말이 붙으면 끝났다는 말이 묻힌다.
  if (progress.position.current === null) return label;
  return `${label} · 끝낸 수 기준`;
}

/** 그 수가 **무엇을 센 것인지** — 글자 줄에 붙는 title. 길게 적어도 화면을 안 민다. */
export function describeExecutionProgressBasis(progress: ExecutionProgress): string {
  return progress.basis === "PATH"
    ? "시작 지점에서 지금 작업을 거쳐 종료까지 이어지는 최단 경로에서 몇 번째인지입니다. 갈래를 어느 쪽으로 타느냐에 따라 남은 수가 달라집니다."
    : "이 절차에는 지금 작업을 거쳐 종료까지 이어지는 길이 없어, 끝낸 작업 수로 셉니다.";
}
