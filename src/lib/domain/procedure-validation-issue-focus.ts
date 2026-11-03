import { parseSourceReference } from "./procedure-graph-navigation";

/**
 * 2026-11-03(줄기 B-③) — **검증 결과 한 줄이 그림의 어디를 가리키는가.**
 *
 * 사용자가 말한 것: "[검증]에서 이런저런 오류/경고 들이 뜨는데, 그것들을
 * 클릭하면 어느 노드, 연결선이 잘못된 건지 편집창에 표시해줘."
 *
 * ── 🔵 없는 값을 만드는 일이 아니다 ─────────────────────────────────────
 * 구조 검증(procedure-graph-structural-validation.ts)은 이미 한 건마다
 * `nodeId`/`edgeId` 를 싣는다. 그 값이 서버 액션을 그대로 지나
 * StructuralValidationSummary.issues 로 화면까지 온다 — 지금까지 화면이 그걸
 * 안 썼을 뿐이다. 이 파일은 **그 값을 그림이 받는 모양으로 옮기는** 순수 함수
 * 묶음이다. DOM·React·DB 를 모르므로 단위 시험이 그대로 잰다.
 *
 * ── 🔴 왜 두 갈래인가 ───────────────────────────────────────────────────
 * 편집기 [검증] 탭에는 목록이 **둘** 있고 출처가 다르다:
 *   ① 「구조 검증 결과」 — [검증] 단추가 방금 돌린 결과. 한 건에 nodeId/edgeId 가
 *      직접 실려 있다. 다만 **id 가 없다**(서버가 매번 새로 계산해 돌려줄 뿐
 *      어딘가에 저장되는 줄이 아니다) — 그래서 목록 안 자리(index)가 그 줄의
 *      이름이 된다.
 *   ② 「가져오기 시점 검증 이슈」 — procedure_template_validation_issues 의 행.
 *      이쪽에는 nodeId/edgeId 칸이 **아예 없다.** 가진 것은 sourceWorksheet 와
 *      `shape#50`/`connector#57` 꼴의 sourceReference 뿐이라, 노드·간선으로
 *      푸는 일을 여기서 해야 한다. 푸는 방법은 새로 짜지 않았다 — 노드는
 *      getProcedureTemplateDetail 의 openIssuesByNodeId 가 쓰는
 *      `sourceWorksheet::sourceShapeId` 짝맞춤 그대로, 간선은
 *      resolveInitialGraphTarget 이 쓰는 sourceConnectorId 짝맞춤 그대로다.
 *      두 곳이 어긋나면 **노드에 경고 딱지는 붙었는데 그 줄은 눌러도 다른 데를
 *      짚는** 화면이 된다.
 *
 * 🔵 ② 의 간선 쪽은 한 군데만 다르다. resolveInitialGraphTarget 은 연결선을
 * 찾고도 **그 시작 노드로** 보낸다(isFallback=true) — 그때는 간선을 짚을 길이
 * 아예 없었기 때문이다. 여기서는 간선 자체를 짚는다. 그것이 이 조각이 새로
 * 생긴 까닭이다.
 */

/** 한 줄이 가리키는 곳. 둘 다 비는 일은 없다 — 가리킬 것이 없으면 아예 null 을 돌려준다. */
export type ValidationIssueFocus = {
  nodeIds: readonly string[];
  edgeIds: readonly string[];
};

/** 「구조 검증 결과」 한 건에서 이 파일이 읽는 것 전부(StructuralValidationIssue 의 부분집합). */
export type StructuralIssueTarget = {
  nodeId?: string | null;
  edgeId?: string | null;
};

/** 「가져오기 시점 검증 이슈」 한 건에서 이 파일이 읽는 것 전부(EditorUnresolvedIssue 의 부분집합). */
export type ImportedIssueTarget = {
  id: string;
  sourceWorksheet: string | null;
  sourceReference: string | null;
};

export type FocusNode = {
  id: string;
  sourceWorksheet: string | null;
  sourceShapeId: string | null;
};

export type FocusEdge = {
  id: string;
  fromNodeId: string;
  toNodeId: string;
  sourceConnectorId: string | null;
};

/**
 * 줄의 이름. 두 목록이 한 화면에 함께 있으므로 **접두사로 갈라 둔다** —
 * 안 가르면 구조 검증 0번과 가져오기 이슈가 같은 이름을 가질 수 있고, 한쪽을
 * 누르면 양쪽이 고른 것으로 보인다.
 */
export function structuralIssueFocusKey(index: number): string {
  return `structural:${index}`;
}

export function importedIssueFocusKey(issueId: string): string {
  return `imported:${issueId}`;
}

/** 구조 검증 한 건 → 가리키는 곳. 실린 것이 하나도 없으면 null(= 누를 수 없는 줄). */
export function resolveStructuralIssueFocus(issue: StructuralIssueTarget): ValidationIssueFocus | null {
  const nodeIds = issue.nodeId ? [issue.nodeId] : [];
  const edgeIds = issue.edgeId ? [issue.edgeId] : [];
  if (nodeIds.length === 0 && edgeIds.length === 0) return null;
  return { nodeIds, edgeIds };
}

/**
 * 가져오기 시점 이슈 한 건 → 가리키는 곳.
 *
 * 🔴 노드 쪽이 **시트까지 맞아야** 하는 까닭: 같은 `shape#50` 이 시트마다 따로
 * 있다(도형 id 는 시트 안에서만 고유하다). 시트를 안 보면 다른 시트의 엉뚱한
 * 노드를 짚는다. openIssuesByNodeId 가 이미 같은 이유로 둘을 함께 본다 —
 * 그래서 sourceWorksheet 가 비어 있으면 노드로 풀지 않는다(딱지도 안 붙는다).
 *
 * 🔵 간선 쪽은 시트를 안 본다. 연결선은 시트를 가로지를 수 있어서 간선 행
 * 자체에 시트 칸이 없고, sourceConnectorId 가 템플릿 안에서 이미 고유하다.
 */
export function resolveImportedIssueFocus(
  issue: ImportedIssueTarget,
  nodes: readonly FocusNode[],
  edges: readonly FocusEdge[]
): ValidationIssueFocus | null {
  const { shapeId, connectorId } = parseSourceReference(issue.sourceReference);

  if (shapeId && issue.sourceWorksheet) {
    const node = nodes.find((n) => n.sourceShapeId === shapeId && n.sourceWorksheet === issue.sourceWorksheet);
    if (node) return { nodeIds: [node.id], edgeIds: [] };
  }

  if (connectorId) {
    const edge = edges.find((e) => e.sourceConnectorId === connectorId);
    if (edge) return { nodeIds: [], edgeIds: [edge.id] };
  }

  return null;
}

/**
 * 지금 그림에 **살아 있는 것만** 남긴다. 하나도 안 남으면 null.
 *
 * 🔴 이 거르기가 없으면 「전부 흐려지고 아무것도 안 환한」 화면이 난다.
 * 구조 검증 결과는 **눌렀을 때의 그림이 아니라 [검증]을 누른 순간의 그림**을
 * 재서 나온 것이고, 그 사이에 노드·연결선 삭제는 저장을 기다리지 않고 바로
 * 서버에 반영된다. 그러면 사라진 id 를 그림에 넘기게 되는데, 그림의 약속은
 * 「목록에 없는 칸은 흐려진다」라 **남은 전부가 흐려지고 환한 것은 없다.**
 * 사람 눈에는 고장으로 보인다.
 */
function keepOnlyExisting(
  focus: ValidationIssueFocus,
  nodeIdSet: ReadonlySet<string>,
  edgeIdSet: ReadonlySet<string>
): ValidationIssueFocus | null {
  const nodeIds = focus.nodeIds.filter((id) => nodeIdSet.has(id));
  const edgeIds = focus.edgeIds.filter((id) => edgeIdSet.has(id));
  if (nodeIds.length === 0 && edgeIds.length === 0) return null;
  return { nodeIds, edgeIds };
}

/**
 * 두 목록을 한꺼번에 풀어 **줄 이름 → 가리키는 곳** 지도를 만든다.
 *
 * 🔴 지도에 **없는 줄이 곧 「누를 수 없는 줄」**이다. 판정을 한 곳에서만 하려고
 * 이렇게 뒀다 — 화면이 「누를 수 있나」와 「눌렀을 때 무엇을 짚나」를 따로
 * 계산하면, 흐려 보이는데 눌리거나 눌리는데 아무 일도 안 일어나는 줄이 생긴다.
 */
export function buildValidationIssueFocusMap(input: {
  structuralIssues: readonly StructuralIssueTarget[];
  importedIssues: readonly ImportedIssueTarget[];
  nodes: readonly FocusNode[];
  edges: readonly FocusEdge[];
}): Map<string, ValidationIssueFocus> {
  const nodeIdSet = new Set(input.nodes.map((n) => n.id));
  // 🔴 「있는 연결선」이 아니라 **「그려지는 연결선」**을 센다. 그림은 양 끝
  //    노드가 둘 다 있는 선만 그린다(ProcedureFlowGraph 의 visibleEdgeRows).
  //    그래서 이 템플릿 밖의 노드를 참조하는 선은 행으로는 남아 있어도 화면에
  //    **한 획도 안 그려진다** — 구조 검증의 CROSS_TEMPLATE_REFERENCE 가 바로
  //    그 선을 가리킨다. 그대로 짚게 두면 나머지가 전부 흐려지기만 하고 환한
  //    것이 없어, 사람 눈에는 「눌렀는데 아무 일도 안 일어남」으로 보인다.
  const edgeIdSet = new Set(input.edges.filter((e) => nodeIdSet.has(e.fromNodeId) && nodeIdSet.has(e.toNodeId)).map((e) => e.id));
  const result = new Map<string, ValidationIssueFocus>();

  input.structuralIssues.forEach((issue, index) => {
    const raw = resolveStructuralIssueFocus(issue);
    if (!raw) return;
    const focus = keepOnlyExisting(raw, nodeIdSet, edgeIdSet);
    if (focus) result.set(structuralIssueFocusKey(index), focus);
  });

  for (const issue of input.importedIssues) {
    const raw = resolveImportedIssueFocus(issue, input.nodes, input.edges);
    if (!raw) continue;
    const focus = keepOnlyExisting(raw, nodeIdSet, edgeIdSet);
    if (focus) result.set(importedIssueFocusKey(issue.id), focus);
  }

  return result;
}

/**
 * 그림(ProcedureFlowGraph)에 그대로 넘길 두 프롭.
 *
 * 🔴 **빈 배열을 null 로 접는 것이 이 함수의 전부**다. 그림의 약속은
 * 「null = 아무 영향 없음 / 빈 배열 = 전부 흐려짐」이다(두 프롭의 주석에 적혀
 * 있다). 노드만 가리키는 오류에 edgeIds 로 `[]` 를 넘기면 **연결선이 전부
 * 흐려진다** — 짚으라는 노드 주변이 오히려 더 안 보인다.
 */
export function focusHighlightProps(focus: ValidationIssueFocus | null | undefined): {
  highlightedNodeIds: readonly string[] | null;
  highlightedEdgeIds: readonly string[] | null;
} {
  return {
    highlightedNodeIds: focus && focus.nodeIds.length > 0 ? focus.nodeIds : null,
    highlightedEdgeIds: focus && focus.edgeIds.length > 0 ? focus.edgeIds : null,
  };
}

/**
 * 카메라를 맞출 칸들.
 *
 * 🔵 React Flow 의 fitView 는 **노드 목록만** 받는다(간선은 못 받는다). 그래서
 * 연결선만 가리키는 오류는 그 선의 **양 끝 칸**으로 바꿔 준다 — 두 칸이 다
 * 보이면 그 사이의 선도 함께 보인다.
 */
export function resolveFocusFitNodeIds(focus: ValidationIssueFocus | null | undefined, edges: readonly FocusEdge[]): string[] {
  if (!focus) return [];
  const ids = new Set<string>(focus.nodeIds);
  const edgeById = new Map(edges.map((e) => [e.id, e]));
  for (const edgeId of focus.edgeIds) {
    const edge = edgeById.get(edgeId);
    if (!edge) continue;
    ids.add(edge.fromNodeId);
    ids.add(edge.toNodeId);
  }
  return [...ids];
}

/** 고른 줄을 다시 누르면 풀린다 — 다른 줄을 누르면 그쪽으로 옮겨간다. */
export function toggleIssueFocusKey(current: string | null, clicked: string): string | null {
  return current === clicked ? null : clicked;
}

/**
 * 줄에 **이름**을 함께 보일 때 노드에서 읽는 것 전부(EditorNodeRow 의 부분집합).
 *
 * 🔵 FocusNode 와 따로 둔 까닭: 짚을 곳을 **푸는** 일(시트·도형 번호)과 사람에게
 * **보일 이름**을 뽑는 일은 읽는 칸이 겹치지 않는다. 한 타입에 몰면 시험 표본이
 * 늘 둘 다 채워야 해서, 어느 쪽이 실제로 쓰이는지가 흐려진다.
 */
export type FocusNodeName = {
  id: string;
  title: string;
  nodeCode: string;
};

/**
 * 이름도 번호도 비어 있을 때 보일 글자.
 *
 * 🔴 빈 글자를 그대로 내보내면 「경고 ·  · 고립된 노드입니다」처럼 가운뎃점만
 * 둘 남아 **글자가 깨진 것처럼** 보인다. 실제로 제목이 빈 노드가 생길 수 있다 —
 * 편집기의 노드 추가는 제목을 비워 둔 채로도 서버가 받는다.
 */
const UNNAMED_NODE_LABEL = "(이름 없음)";
/** 지도에 없는 id 를 받은 경우. 거르기(keepOnlyExisting)를 지난 값이면 여기에 닿지 않는다. */
const UNKNOWN_NODE_LABEL = "(알 수 없는 노드)";

function resolveNodeName(node: FocusNodeName | undefined): string {
  if (!node) return UNKNOWN_NODE_LABEL;
  const title = node.title.trim();
  if (title.length > 0) return title;
  // 🔵 제목이 비면 nodeCode 로 떨어진다 — 편집기의 「부모 버전과 비교」 패널이
  //    이미 노드를 nodeCode 로 부르고 있어, 사람이 같은 이름으로 찾을 수 있다.
  const code = node.nodeCode.trim();
  return code.length > 0 ? code : UNNAMED_NODE_LABEL;
}

function joinWithOverflow(names: readonly string[]): string {
  if (names.length === 1) return names[0];
  return `${names[0]} 외 ${names.length - 1}개`;
}

/**
 * 한 줄이 가리키는 곳의 **이름**. 짚을 곳이 없으면 null(= 보일 이름도 없다).
 *
 * 🔴 왜 필요한가(2026-11-03 실측): 사용자 화면에서 경고 13건이 **전부 똑같은
 * 문장**이었다 — 「다른 노드와 연결되지 않은 고립된 노드입니다」. 목록만 보고는
 * 서로 구분이 안 되고, 어느 노드인지 알려면 13줄을 하나씩 눌러 봐야 했다.
 *
 * 🔵 **없는 값을 만들지 않는다.** 이름은 이미 화면에 와 있다 — 편집기의
 * renderedNodes 가 그림에 그리는 바로 그 제목이고, 가리키는 곳은 짚기 지도
 * (buildValidationIssueFocusMap)가 이미 풀어 둔 것이다. 이 함수는 둘을 맞댈 뿐
 * 이라 서버도 DB 도 건드리지 않는다.
 *
 * 🔴 노드가 먼저다. 한 오류가 노드와 연결선을 **둘 다** 가리키는 경우가 있는데
 * (INVALID_SELF_EDGE 등) 그때 「A → A」보다 「A」가 짧고, 줄의 목적은 어느 칸을
 * 봐야 하는지 알려 주는 것이다.
 */
export function describeValidationIssueTarget(
  focus: ValidationIssueFocus | null | undefined,
  nodes: readonly FocusNodeName[],
  edges: readonly FocusEdge[]
): string | null {
  if (!focus) return null;
  const nodeById = new Map(nodes.map((n) => [n.id, n]));

  if (focus.nodeIds.length > 0) {
    return joinWithOverflow(focus.nodeIds.map((id) => resolveNodeName(nodeById.get(id))));
  }

  const edgeById = new Map(edges.map((e) => [e.id, e]));
  const edgeNames: string[] = [];
  for (const edgeId of focus.edgeIds) {
    const edge = edgeById.get(edgeId);
    if (!edge) continue;
    edgeNames.push(`${resolveNodeName(nodeById.get(edge.fromNodeId))} → ${resolveNodeName(nodeById.get(edge.toNodeId))}`);
  }
  if (edgeNames.length > 0) return joinWithOverflow(edgeNames);

  return null;
}
