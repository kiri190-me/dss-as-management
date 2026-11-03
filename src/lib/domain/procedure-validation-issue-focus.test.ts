import { describe, test } from "node:test";
import assert from "node:assert/strict";
import {
  buildValidationIssueFocusMap,
  describeValidationIssueTarget,
  focusHighlightProps,
  importedIssueFocusKey,
  resolveFocusFitNodeIds,
  resolveImportedIssueFocus,
  resolveStructuralIssueFocus,
  structuralIssueFocusKey,
  toggleIssueFocusKey,
  type FocusEdge,
  type FocusNode,
  type FocusNodeName,
} from "./procedure-validation-issue-focus";
import {
  validateProcedureGraphStructure,
  type StructuralValidationEdge,
  type StructuralValidationNode,
} from "./procedure-graph-structural-validation";

/**
 * 2026-11-03(줄기 B-③) — **검증 오류를 누르면 그 노드·연결선을 짚어 준다.**
 *
 * 사용자가 말한 것: "[검증]에서 이런저런 오류/경고 들이 뜨는데, 그것들을
 * 클릭하면 어느 노드, 연결선이 잘못된 건지 편집창에 표시해줘."
 *
 * ── 🔴 왜 가짜 오류가 아니라 **진짜 검증기가 내놓은 것**으로 재는가 ──────
 * 이 파일이 푸는 것은 `{ nodeId?, edgeId? }` 라는 **아주 헐거운 모양**이다.
 * 손으로 지어낸 표본만 쓰면 "구조 검증이 정말 그렇게 싣는가"를 한 번도 안
 * 재게 되고, 검증기 쪽이 칸 이름을 바꾸거나 어떤 오류에서 id 를 빠뜨려도
 * 이 시험은 영영 초록으로 남는다 — 화면에서는 "눌렀는데 엉뚱한 데가
 * 짚힌다"로 나타난다. 그래서 ②절은 validateProcedureGraphStructure 를
 * 직접 돌려 나온 건으로 잰다.
 *
 * ── 🔴 미리 세어 본 것(지시서가 물은 것) ────────────────────────────────
 * 구조 검증이 오류를 쌓는 자리는 **15곳**이고 그중 **짚을 대상이 없는 자리는
 * 0곳**이다 — 전부 nodeId 나 edgeId 를 싣는다. 셋(INVALID_SELF_EDGE ·
 * INVALID_BRANCH_TYPE_FOR_NODE · INVALID_LOOP_BACK_TARGET)은 **둘 다** 싣는다.
 * 반대로 「가져오기 시점 검증 이슈」 쪽에는 그 칸이 **아예 없다** — 그래서
 * 못 짚는 줄은 거의 다 이쪽에서 나온다. ②·③절이 각각을 못 박는다.
 *
 * 🔴 다만 "id 를 싣는다"와 "짚을 수 있다"는 같은 말이 아니다. 구조 검증
 * 쪽에도 못 짚는 건이 하나 있다 — 이 템플릿 밖의 노드를 참조하는 연결선
 * (CROSS_TEMPLATE_REFERENCE). edgeId 는 멀쩡히 실려 있지만 그림이 그 선을
 * 한 획도 안 그린다. ④절이 그 건을 따로 못 박는다.
 */

function node(id: string, nodeType: StructuralValidationNode["nodeType"]): StructuralValidationNode {
  return { id, nodeType };
}
function edge(id: string, fromNodeId: string, toNodeId: string, branchType: StructuralValidationEdge["branchType"]): StructuralValidationEdge {
  return { id, fromNodeId, toNodeId, branchType };
}

/** 그림이 들고 있는 노드/연결선(편집기의 renderedNodes/renderedEdges 가 주는 모양 중 이 파일이 읽는 것만). */
function focusNode(id: string, overrides: Partial<FocusNode> = {}): FocusNode {
  return { id, sourceWorksheet: null, sourceShapeId: null, ...overrides };
}
function focusEdge(id: string, fromNodeId: string, toNodeId: string, overrides: Partial<FocusEdge> = {}): FocusEdge {
  return { id, fromNodeId, toNodeId, sourceConnectorId: null, ...overrides };
}

describe("검증 오류 짚기 — ① 먼저 표본 확인", () => {
  test("🔵 줄 이름이 두 목록에서 섞이지 않는다 — 한쪽을 눌렀는데 양쪽이 고른 것으로 보이면 안 된다", () => {
    assert.notEqual(structuralIssueFocusKey(0), importedIssueFocusKey("0"));
    assert.notEqual(structuralIssueFocusKey(3), structuralIssueFocusKey(4));
    // 가져오기 이슈의 id 는 UUID 라 자리(index)와 겹칠 일이 없지만, 접두사가
    // 사라지면 "imported:0" 같은 id 하나로 둘이 겹칠 수 있다.
    assert.ok(structuralIssueFocusKey(0).startsWith("structural:"));
    assert.ok(importedIssueFocusKey("abc").startsWith("imported:"));
  });
});

describe("검증 오류 짚기 — ② 구조 검증: 진짜 검증기가 내놓은 건으로 잰다", () => {
  test("🔴 노드만 가리키는 오류(고립된 노드) — 그 노드 id 가 짚기로 넘어간다", () => {
    const nodes = [node("start", "START"), node("t", "TASK"), node("end", "END"), node("외톨이", "TASK")];
    const edges = [edge("e1", "start", "t", "DEFAULT"), edge("e2", "t", "end", "DEFAULT")];
    const issues = validateProcedureGraphStructure(nodes, edges);

    const orphan = issues.find((i) => i.issueType === "ORPHAN_NODE");
    assert.ok(orphan, "표본이 비었다 — 고립 노드 경고가 안 나오면 아래 단언이 공짜로 통과한다");
    assert.equal(orphan.nodeId, "외톨이");
    assert.equal(orphan.edgeId, undefined, "이 오류는 연결선을 가리키지 않는다");

    assert.deepEqual(resolveStructuralIssueFocus(orphan), { nodeIds: ["외톨이"], edgeIds: [] });
  });

  test("🔴 연결선만 가리키는 오류(중복 분기) — 그 간선 id 가 짚기로 넘어간다", () => {
    const nodes = [node("start", "START"), node("t", "TASK"), node("end", "END")];
    const edges = [
      edge("e1", "start", "t", "DEFAULT"),
      edge("e2", "t", "end", "DEFAULT"),
      edge("중복", "t", "end", "DEFAULT"),
    ];
    const issues = validateProcedureGraphStructure(nodes, edges);

    const duplicate = issues.find((i) => i.issueType === "DUPLICATE_EDGE");
    assert.ok(duplicate, "표본이 비었다 — 중복 분기 오류가 안 나왔다");
    assert.equal(duplicate.edgeId, "중복");
    assert.equal(duplicate.nodeId, undefined, "이 오류는 노드를 가리키지 않는다");

    assert.deepEqual(resolveStructuralIssueFocus(duplicate), { nodeIds: [], edgeIds: ["중복"] });
  });

  test("🔴 한 오류가 둘을 가리키는 경우가 있다 — 자기 자신으로 가는 분기는 노드와 연결선을 함께 싣는다", () => {
    const nodes = [node("start", "START"), node("t", "TASK"), node("end", "END")];
    const edges = [edge("e1", "start", "t", "DEFAULT"), edge("고리", "t", "t", "DEFAULT"), edge("e2", "t", "end", "DEFAULT")];
    const issues = validateProcedureGraphStructure(nodes, edges);

    const selfEdge = issues.find((i) => i.issueType === "INVALID_SELF_EDGE");
    assert.ok(selfEdge, "표본이 비었다 — 자기 자신 분기 오류가 안 나왔다");
    assert.deepEqual(resolveStructuralIssueFocus(selfEdge), { nodeIds: ["t"], edgeIds: ["고리"] });
  });

  test("🔴 구조 검증이 내놓는 건은 **전부** 가리키는 것이 있다 — 여러 규칙을 한꺼번에 깨뜨려 확인한다", () => {
    // 일부러 망가뜨린 그래프: 시작에 들어오는 분기 · 종료에서 나가는 분기 ·
    // 정상 경로 없는 판단 노드 · 고립 노드 · 중복 분기 · 자기 자신 분기 ·
    // 판단 전용 분기 유형을 쓴 TASK · END 로 가는 재진행 분기.
    const nodes = [
      node("start", "START"),
      node("d", "DECISION"),
      node("t", "TASK"),
      node("end", "END"),
      node("외톨이", "TASK"),
      node("참조", "DOCUMENT_REFERENCE"),
    ];
    const edges = [
      edge("e1", "start", "d", "DEFAULT"),
      edge("e2", "d", "t", "NG"),
      edge("e3", "d", "t", "NO"),
      edge("e4", "t", "end", "DEFAULT"),
      edge("e5", "t", "start", "DEFAULT"),
      edge("e6", "end", "t", "DEFAULT"),
      edge("e7", "t", "t", "DEFAULT"),
      edge("e8", "t", "end", "DEFAULT"),
      edge("e9", "t", "end", "RETRY"),
      edge("e10", "t", "d", "YES"),
      edge("e11", "참조", "t", "DEFAULT"),
    ];
    const issues = validateProcedureGraphStructure(nodes, edges);

    // 표본이 충분히 넓은지 먼저 — 한두 건만 나오면 "전부"라는 말에 힘이 없다.
    const kinds = new Set(issues.map((i) => i.issueType));
    assert.ok(issues.length >= 8, `표본이 좁다 — ${issues.length}건만 나왔다`);
    assert.ok(kinds.size >= 6, `오류 종류가 좁다 — ${kinds.size}가지만 나왔다`);

    const unpointable = issues.filter((i) => resolveStructuralIssueFocus(i) === null);
    assert.deepEqual(unpointable, [], "구조 검증 결과에 짚을 대상이 없는 건이 생겼다 — 화면에서 누를 수 없는 줄이 된다");
  });
});

describe("검증 오류 짚기 — ③ 가져오기 시점 이슈: 노드·연결선 칸이 아예 없다", () => {
  const nodes = [
    focusNode("n-1", { sourceWorksheet: "RFG", sourceShapeId: "50" }),
    focusNode("n-2", { sourceWorksheet: "RFG", sourceShapeId: "51" }),
    // 🔴 **다른 시트의 같은 도형 번호.** 도형 id 는 시트 안에서만 고유해서,
    //    시트를 안 보면 이 노드를 엉뚱하게 짚는다.
    focusNode("n-3", { sourceWorksheet: "ATT", sourceShapeId: "50" }),
  ];
  const edges = [focusEdge("e-1", "n-1", "n-2", { sourceConnectorId: "57" })];

  test("🔴 shape#… 는 **시트까지 맞는** 노드를 짚는다", () => {
    const focus = resolveImportedIssueFocus({ id: "i1", sourceWorksheet: "ATT", sourceReference: "shape#50" }, nodes, edges);
    assert.deepEqual(focus, { nodeIds: ["n-3"], edgeIds: [] }, "시트를 안 보면 n-1 을 짚는다");
  });

  test("🔴 connector#… 는 **연결선 자체**를 짚는다 — 전에는 그 선의 시작 노드로밖에 못 갔다", () => {
    const focus = resolveImportedIssueFocus({ id: "i2", sourceWorksheet: "RFG", sourceReference: "connector#57" }, nodes, edges);
    assert.deepEqual(focus, { nodeIds: [], edgeIds: ["e-1"] });
  });

  test("🔴 짚을 대상이 없는 줄이 실제로 있다 — 넷", () => {
    // ① 원본 위치 자체가 없는 건
    assert.equal(resolveImportedIssueFocus({ id: "a", sourceWorksheet: "RFG", sourceReference: null }, nodes, edges), null);
    // ② shape#/connector# 가 아닌 글자(셀 범위만 적힌 건)
    assert.equal(resolveImportedIssueFocus({ id: "b", sourceWorksheet: "RFG", sourceReference: "A1:C9" }, nodes, edges), null);
    // ③ 시트가 비어 있어 도형 번호를 어느 시트에서 찾을지 모르는 건
    assert.equal(resolveImportedIssueFocus({ id: "c", sourceWorksheet: null, sourceReference: "shape#50" }, nodes, edges), null);
    // ④ 번호는 있는데 그 도형이 노드로 들어오지 않은 건(가져오기가 못 묶은 것)
    assert.equal(resolveImportedIssueFocus({ id: "d", sourceWorksheet: "RFG", sourceReference: "shape#999" }, nodes, edges), null);
    assert.equal(resolveImportedIssueFocus({ id: "e", sourceWorksheet: "RFG", sourceReference: "connector#999" }, nodes, edges), null);
  });
});

describe("검증 오류 짚기 — ④ 지도: 이 지도에 없는 줄이 곧 「누를 수 없는 줄」", () => {
  const nodes = [focusNode("n-1", { sourceWorksheet: "RFG", sourceShapeId: "50" }), focusNode("n-2")];
  const edges = [focusEdge("e-1", "n-1", "n-2", { sourceConnectorId: "57" })];

  test("🔴 두 목록이 한 지도에 들어가고, 못 짚는 줄만 빠진다", () => {
    const map = buildValidationIssueFocusMap({
      structuralIssues: [
        { nodeId: "n-2" }, // 0번 — 노드
        { edgeId: "e-1" }, // 1번 — 연결선
        {}, // 2번 — 아무것도 안 가리킨다(구조 검증은 이런 건을 안 내놓지만, 모양상 가능하다)
      ],
      importedIssues: [
        { id: "ok", sourceWorksheet: "RFG", sourceReference: "shape#50" },
        { id: "no", sourceWorksheet: "RFG", sourceReference: null },
      ],
      nodes,
      edges,
    });

    assert.deepEqual([...map.keys()].sort(), ["imported:ok", "structural:0", "structural:1"]);
    assert.deepEqual(map.get(structuralIssueFocusKey(0)), { nodeIds: ["n-2"], edgeIds: [] });
    assert.deepEqual(map.get(structuralIssueFocusKey(1)), { nodeIds: [], edgeIds: ["e-1"] });
    assert.equal(map.has(structuralIssueFocusKey(2)), false, "가리키는 것이 없는 줄은 눌릴 수 없어야 한다");
    assert.equal(map.has(importedIssueFocusKey("no")), false);
  });

  test("🔴 이미 사라진 노드·연결선을 가리키는 오류는 누를 수 없다 — 그대로 넘기면 전부 흐려지고 환한 것이 없다", () => {
    const map = buildValidationIssueFocusMap({
      structuralIssues: [{ nodeId: "지워진노드" }, { edgeId: "지워진분기" }, { nodeId: "n-1", edgeId: "지워진분기" }],
      importedIssues: [],
      nodes,
      edges,
    });
    assert.equal(map.has(structuralIssueFocusKey(0)), false);
    assert.equal(map.has(structuralIssueFocusKey(1)), false);
    // 🔵 셋째는 **한쪽만** 사라졌다 — 남은 쪽은 짚을 수 있으므로 줄은 살아 있고,
    //    사라진 쪽만 떨어져 나간다.
    assert.deepEqual(map.get(structuralIssueFocusKey(2)), { nodeIds: ["n-1"], edgeIds: [] });
  });

  test("🔴 이 템플릿 밖의 노드를 참조하는 연결선은 누를 수 없다 — 그림이 그 선을 한 획도 안 그린다", () => {
    // 구조 검증의 CROSS_TEMPLATE_REFERENCE 가 정확히 이 선을 가리킨다. 행은
    // 남아 있지만 그림은 양 끝 노드가 둘 다 있는 선만 그리므로, 짚게 두면
    // 나머지가 전부 흐려지기만 하고 환한 것이 없다.
    const brokenEdges = [...edges, focusEdge("남의템플릿행", "n-1", "다른템플릿노드")];
    const realIssues = validateProcedureGraphStructure(
      [node("n-1", "TASK"), node("n-2", "TASK")],
      [edge("남의템플릿행", "n-1", "다른템플릿노드", "DEFAULT")]
    );
    const crossTemplate = realIssues.find((i) => i.issueType === "CROSS_TEMPLATE_REFERENCE");
    assert.ok(crossTemplate, "표본이 비었다 — 템플릿 밖 참조 오류가 안 나왔다");
    assert.equal(crossTemplate.edgeId, "남의템플릿행");

    const map = buildValidationIssueFocusMap({ structuralIssues: [crossTemplate], importedIssues: [], nodes, edges: brokenEdges });
    assert.equal(map.has(structuralIssueFocusKey(0)), false);

    // 🔵 같은 선이라도 **양 끝이 다 있으면** 누를 수 있다 — 거르기가 너무
    //    넓어서 멀쩡한 선까지 막고 있지 않다는 증거다.
    const healthy = buildValidationIssueFocusMap({
      structuralIssues: [{ edgeId: "e-1" }],
      importedIssues: [],
      nodes,
      edges: brokenEdges,
    });
    assert.deepEqual(healthy.get(structuralIssueFocusKey(0)), { nodeIds: [], edgeIds: ["e-1"] });
  });

  test("🔵 [검증]을 안 돌렸으면(구조 결과 0건) 가져오기 이슈만으로도 지도가 선다", () => {
    const map = buildValidationIssueFocusMap({
      structuralIssues: [],
      importedIssues: [{ id: "ok", sourceWorksheet: "RFG", sourceReference: "shape#50" }],
      nodes,
      edges,
    });
    assert.deepEqual([...map.keys()], ["imported:ok"]);
  });
});

describe("검증 오류 짚기 — ⑤ 그림에 넘기는 값: 빈 배열과 null 은 뜻이 정반대다", () => {
  test("🔴 노드만 가리키는 오류는 연결선 쪽에 null 을 넘긴다 — 빈 배열이면 연결선이 전부 흐려진다", () => {
    const props = focusHighlightProps({ nodeIds: ["n-1"], edgeIds: [] });
    assert.deepEqual(props.highlightedNodeIds, ["n-1"]);
    assert.equal(props.highlightedEdgeIds, null);
  });

  test("🔴 연결선만 가리키는 오류는 노드 쪽에 null 을 넘긴다", () => {
    const props = focusHighlightProps({ nodeIds: [], edgeIds: ["e-1"] });
    assert.equal(props.highlightedNodeIds, null);
    assert.deepEqual(props.highlightedEdgeIds, ["e-1"]);
  });

  test("🔴 아무것도 안 짚었으면 둘 다 null 이다 — 그림이 전과 한 글자도 다르지 않아야 한다", () => {
    assert.deepEqual(focusHighlightProps(null), { highlightedNodeIds: null, highlightedEdgeIds: null });
    assert.deepEqual(focusHighlightProps(undefined), { highlightedNodeIds: null, highlightedEdgeIds: null });
  });

  test("둘 다 가리키는 오류는 둘 다 넘어간다", () => {
    const props = focusHighlightProps({ nodeIds: ["t"], edgeIds: ["고리"] });
    assert.deepEqual(props.highlightedNodeIds, ["t"]);
    assert.deepEqual(props.highlightedEdgeIds, ["고리"]);
  });
});

describe("검증 오류 짚기 — ⑥ 카메라를 맞출 칸", () => {
  const edges = [focusEdge("e-1", "n-1", "n-2"), focusEdge("e-2", "n-2", "n-3")];

  test("노드를 가리키면 그 노드로 맞춘다", () => {
    assert.deepEqual(resolveFocusFitNodeIds({ nodeIds: ["n-2"], edgeIds: [] }, edges), ["n-2"]);
  });

  test("🔴 연결선만 가리키면 그 선의 **양 끝 칸**으로 바꾼다 — fitView 는 연결선을 못 받는다", () => {
    assert.deepEqual(resolveFocusFitNodeIds({ nodeIds: [], edgeIds: ["e-1"] }, edges), ["n-1", "n-2"]);
  });

  test("겹치는 칸은 한 번만 — 같은 칸을 두 번 넣으면 fitView 가 헛돈다", () => {
    assert.deepEqual(resolveFocusFitNodeIds({ nodeIds: ["n-2"], edgeIds: ["e-1", "e-2"] }, edges), ["n-2", "n-1", "n-3"]);
  });

  test("짚은 것이 없으면 맞출 칸도 없다 — 카메라가 움직이지 않는다", () => {
    assert.deepEqual(resolveFocusFitNodeIds(null, edges), []);
    assert.deepEqual(resolveFocusFitNodeIds({ nodeIds: [], edgeIds: ["모르는분기"] }, edges), []);
  });
});

describe("검증 오류 짚기 — ⑦ 고르기 토글", () => {
  test("🔴 같은 줄을 다시 누르면 풀린다 — 푸는 길이 있어야 한다", () => {
    assert.equal(toggleIssueFocusKey("structural:2", "structural:2"), null);
  });

  test("🔴 다른 줄을 누르면 짚기가 그쪽으로 옮겨간다 — 둘이 함께 짚히지 않는다", () => {
    assert.equal(toggleIssueFocusKey("structural:2", "structural:5"), "structural:5");
    assert.equal(toggleIssueFocusKey("structural:2", "imported:abc"), "imported:abc");
  });

  test("아무것도 안 짚은 상태에서 누르면 그 줄이 짚힌다", () => {
    assert.equal(toggleIssueFocusKey(null, "structural:0"), "structural:0");
  });
});

/**
 * ⑧ 줄기 B-④ — **줄에 보일 이름.**
 *
 * 🔴 왜 더했는가(실측 2026-11-03): 사용자 화면에서 경고 13건이 전부 같은
 * 문장이었다(「다른 노드와 연결되지 않은 고립된 노드입니다」). 목록에서 서로
 * 구분이 안 돼, 어느 노드인지 알려면 13줄을 하나씩 눌러 봐야 했다.
 *
 * 🔵 서버에 없는 값을 만드는 일이 아니다 — 이름은 이미 편집기의 renderedNodes
 * 에 있고 그림에도 그대로 그려진다. 이 함수는 짚기 지도가 푼 id 와 그 이름을
 * 맞댈 뿐이다.
 */
function namedNode(id: string, title: string, nodeCode = `N-${id}`): FocusNodeName {
  return { id, title, nodeCode };
}

describe("검증 오류 짚기 — ⑧ 줄에 보일 이름 (줄기 B-④)", () => {
  const nodes = [namedNode("n-1", "24V 전원 확인"), namedNode("n-2", "출력 파형 점검"), namedNode("n-3", "", "D-0042"), namedNode("n-4", "   ", "   ")];
  const edges = [focusEdge("e-1", "n-1", "n-2"), focusEdge("e-2", "n-2", "n-3")];

  test("🔵 먼저 표본 확인 — 지어낸 이름이 정말 이 목록에 있다", () => {
    // 이 단언이 없으면 아래가 전부 "(알 수 없는 노드)" 로 통과할 수 있다.
    assert.equal(nodes.find((n) => n.id === "n-1")?.title, "24V 전원 확인");
    assert.equal(nodes.length, 4);
  });

  test("🔴 노드를 가리키는 줄에는 그 노드의 제목이 나온다 — 같은 문장 13줄을 가르는 유일한 단서다", () => {
    assert.equal(describeValidationIssueTarget({ nodeIds: ["n-1"], edgeIds: [] }, nodes, edges), "24V 전원 확인");
  });

  test("🔴 연결선을 가리키는 줄에는 **양 끝**이 나온다 — 연결선에는 제 이름이 없다", () => {
    assert.equal(describeValidationIssueTarget({ nodeIds: [], edgeIds: ["e-1"] }, nodes, edges), "24V 전원 확인 → 출력 파형 점검");
  });

  test("🔴 둘 다 가리키는 오류(자기 자신 분기 등)는 **노드 쪽**을 쓴다 — 「A → A」보다 「A」가 짧다", () => {
    assert.equal(describeValidationIssueTarget({ nodeIds: ["n-2"], edgeIds: ["e-2"] }, nodes, edges), "출력 파형 점검");
  });

  test("🔴 제목이 빈 노드는 nodeCode 로 떨어진다 — 빈 글자를 내보내면 가운뎃점만 둘 남아 깨진 줄로 보인다", () => {
    assert.equal(describeValidationIssueTarget({ nodeIds: ["n-3"], edgeIds: [] }, nodes, edges), "D-0042");
    // 공백만 있는 제목도 "있는 제목"으로 세면 안 된다.
    assert.equal(describeValidationIssueTarget({ nodeIds: [], edgeIds: ["e-2"] }, nodes, edges), "출력 파형 점검 → D-0042");
  });

  test("🔴 제목도 번호도 비면 「(이름 없음)」 — 글자가 아예 없는 자리를 남기지 않는다", () => {
    assert.equal(describeValidationIssueTarget({ nodeIds: ["n-4"], edgeIds: [] }, nodes, edges), "(이름 없음)");
  });

  test("짚을 곳이 없는 줄에는 이름도 없다 — 지도에 없는 줄이 곧 못 누르는 줄이다", () => {
    assert.equal(describeValidationIssueTarget(null, nodes, edges), null);
    assert.equal(describeValidationIssueTarget(undefined, nodes, edges), null);
    assert.equal(describeValidationIssueTarget({ nodeIds: [], edgeIds: [] }, nodes, edges), null);
    // 지도에 없는 간선 id 만 들어오면 보일 이름이 없다(거르기를 지난 값이면 여기 안 온다).
    assert.equal(describeValidationIssueTarget({ nodeIds: [], edgeIds: ["모르는분기"] }, nodes, edges), null);
  });

  test("여러 칸을 가리키면 첫 칸 + 「외 N개」 — 줄이 가로로 늘어나 딱지를 밀어내면 안 된다", () => {
    assert.equal(describeValidationIssueTarget({ nodeIds: ["n-1", "n-2"], edgeIds: [] }, nodes, edges), "24V 전원 확인 외 1개");
    assert.equal(describeValidationIssueTarget({ nodeIds: [], edgeIds: ["e-1", "e-2"] }, nodes, edges), "24V 전원 확인 → 출력 파형 점검 외 1개");
  });

  test("🔴 진짜 검증기가 내놓은 「고립된 노드」 경고에 이름이 붙는다 — 사용자가 본 바로 그 줄이다", () => {
    const vNodes = [node("start", "START"), node("t", "TASK"), node("end", "END"), node("외톨이", "TASK")];
    const vEdges = [edge("e1", "start", "t", "DEFAULT"), edge("e2", "t", "end", "DEFAULT")];
    const issues = validateProcedureGraphStructure(vNodes, vEdges);
    const orphans = issues.filter((i) => i.issueType === "ORPHAN_NODE");
    assert.equal(orphans.length, 1, "표본이 비었다 — 고립 노드 경고가 안 나오면 아래가 공짜로 통과한다");

    const map = buildValidationIssueFocusMap({
      structuralIssues: issues,
      importedIssues: [],
      nodes: vNodes.map((n) => focusNode(n.id)),
      edges: vEdges.map((e) => focusEdge(e.id, e.fromNodeId, e.toNodeId)),
    });
    const key = structuralIssueFocusKey(issues.indexOf(orphans[0]));
    const named = [namedNode("start", "시작"), namedNode("t", "본 작업"), namedNode("end", "종료"), namedNode("외톨이", "24V 전원 확인")];
    assert.equal(describeValidationIssueTarget(map.get(key) ?? null, named, []), "24V 전원 확인");
  });
});
