import { describe, test } from "node:test";
import assert from "node:assert/strict";
import {
  buildCaseEditEdgeRows,
  classifyEdgeRemoval,
  classifyNodeRemoval,
  findCaseEditNodeByGraphNodeId,
  formatCaseEditBranchLabel,
  PICK_EDGE_TO_REMOVE_MESSAGE,
  PICK_NODE_TO_REMOVE_MESSAGE,
  TEMPLATE_EDGE_NOT_REMOVABLE_MESSAGE,
  TEMPLATE_NODE_NOT_REMOVABLE_MESSAGE,
  type CaseEditEdge,
  type CaseEditNode,
} from "./procedure-execution-case-edit";

/**
 * 「추가 작업 등록」 창의 판정 시험(2026-11-03, 조각 13).
 *
 * 🔵 표본이 비어서 공짜로 통과하지 않도록, 지우기 시험은 **둘 다** 잰다 —
 * 「이 건에서 더한 것은 지워진다」와 「원본에서 온 것은 안 지워진다」. 한쪽만
 * 재면 함수가 늘 false 를 돌려줘도 통과한다.
 */

function templateNode(n: number, extra: Partial<CaseEditNode> = {}): CaseEditNode {
  return { id: `e${n}`, graphNodeId: `t${n}`, orderIndex: n, title: `작업 ${n}`, isAddedInCase: false, version: 1, ...extra };
}

function addedNode(n: number, extra: Partial<CaseEditNode> = {}): CaseEditNode {
  return {
    id: `x${n}`,
    graphNodeId: `x${n}`,
    orderIndex: n,
    title: `추가 작업 ${n}`,
    isAddedInCase: true,
    version: 1,
    ...extra,
  };
}

function edge(id: string, from: string, to: string, extra: Partial<CaseEditEdge> = {}): CaseEditEdge {
  return { id, fromNodeId: from, toNodeId: to, branchType: "DEFAULT", branchLabel: null, isAddedInCase: false, ...extra };
}

describe("무엇을 지울 수 있는가", () => {
  test("🔴 이 건에서 더한 작업은 지울 수 있다", () => {
    assert.deepEqual(classifyNodeRemoval(addedNode(5)), { ok: true });
  });

  test("🔴 원본 절차에서 온 작업은 못 지우고 **까닭이 글자로** 나온다", () => {
    const result = classifyNodeRemoval(templateNode(3));
    assert.equal(result.ok, false);
    if (result.ok) throw new Error("unreachable");
    assert.equal(result.message, TEMPLATE_NODE_NOT_REMOVABLE_MESSAGE);
    assert.match(result.message, /건너뛰기/, "대신 할 수 있는 일을 짚어 줘야 한다");
  });

  test("아직 안 골랐을 때와 못 지울 때는 **다른 말**이다", () => {
    const notPicked = classifyNodeRemoval(null);
    assert.equal(notPicked.ok, false);
    if (notPicked.ok) throw new Error("unreachable");
    assert.equal(notPicked.message, PICK_NODE_TO_REMOVE_MESSAGE);
    assert.notEqual(notPicked.message, TEMPLATE_NODE_NOT_REMOVABLE_MESSAGE);
  });

  test("🔴 연결도 같은 잣대 — 더한 것만 지워지고 원본은 까닭이 나온다", () => {
    assert.deepEqual(classifyEdgeRemoval(edge("x1", "t1", "x1", { isAddedInCase: true })), { ok: true });

    const template = classifyEdgeRemoval(edge("e1", "t1", "t2"));
    assert.equal(template.ok, false);
    if (template.ok) throw new Error("unreachable");
    assert.equal(template.message, TEMPLATE_EDGE_NOT_REMOVABLE_MESSAGE);

    const notPicked = classifyEdgeRemoval(null);
    assert.equal(notPicked.ok, false);
    if (notPicked.ok) throw new Error("unreachable");
    assert.equal(notPicked.message, PICK_EDGE_TO_REMOVE_MESSAGE);
  });
});

describe("그림에서 고른 칸 되찾기", () => {
  const nodes = [templateNode(1), templateNode(2), addedNode(9)];

  test("템플릿 칸은 템플릿 노드 id 로, 더한 작업은 제 실행 노드 id 로 찾힌다", () => {
    assert.equal(findCaseEditNodeByGraphNodeId(nodes, "t2")?.id, "e2");
    assert.equal(findCaseEditNodeByGraphNodeId(nodes, "x9")?.id, "x9");
  });

  test("🔴 실행 줄이 없는 칸(시작 지점·참고 문서)과 안 고른 경우는 null", () => {
    assert.equal(findCaseEditNodeByGraphNodeId(nodes, "start"), null);
    assert.equal(findCaseEditNodeByGraphNodeId(nodes, null), null);
  });
});

describe("연결 목록 한 줄", () => {
  const nodes = [templateNode(1, { title: "MCU 기판 교환" }), templateNode(2), addedNode(9, { title: "추가 세척" })];

  test("번호와 제목으로 「어디서 어디로」를 적는다", () => {
    const rows = buildCaseEditEdgeRows({ nodes, edges: [edge("e1", "t1", "t2")] });
    assert.equal(rows.length, 1);
    assert.equal(rows[0].label, "1. MCU 기판 교환 → 2. 작업 2");
  });

  test("🔴 원본 연결도 목록에 싣되 **왜 못 지우는지**가 그 줄에 붙는다", () => {
    const rows = buildCaseEditEdgeRows({
      nodes,
      edges: [edge("e1", "t1", "t2"), edge("x1", "t2", "x9", { isAddedInCase: true })],
    });
    assert.equal(rows.length, 2, "원본 연결을 빼면 지금 무엇이 그려져 있는지를 이 창에서 못 본다");
    assert.equal(rows[0].removability.ok, false);
    assert.equal(rows[1].removability.ok, true);
  });

  test("🔴 양끝이 작업 줄로 안 풀리는 선은 뺀다 — 시작 지점·참고 문서로 가는 선", () => {
    const rows = buildCaseEditEdgeRows({ nodes, edges: [edge("e0", "start", "t1"), edge("e9", "t2", "ref")] });
    assert.deepEqual(rows, []);
  });

  test("차례는 **받은 그대로** — 조회가 정한 갈래 차례가 그림과 같아야 한다", () => {
    const rows = buildCaseEditEdgeRows({
      nodes,
      edges: [edge("e2", "t2", "t1"), edge("e1", "t1", "t2")],
    });
    assert.deepEqual(
      rows.map((r) => r.edge.id),
      ["e2", "e1"]
    );
  });
});

describe("갈래 이름표", () => {
  test("🔴 기본(DEFAULT)에는 아무것도 안 적는다 — 적으면 목록이 「기본값」으로 도배된다", () => {
    assert.equal(formatCaseEditBranchLabel({ branchType: "DEFAULT", branchLabel: null }), null);
  });

  test("기본이라도 이름표를 적었으면 그것은 보인다", () => {
    assert.equal(formatCaseEditBranchLabel({ branchType: "DEFAULT", branchLabel: "먼저" }), "기본 (먼저)");
  });

  test("NG · 사용자 정의는 이름이 적히고, 이름표가 있으면 괄호로 붙는다", () => {
    assert.equal(formatCaseEditBranchLabel({ branchType: "NG", branchLabel: null }), "NG");
    assert.equal(formatCaseEditBranchLabel({ branchType: "CUSTOM", branchLabel: "재측정" }), "사용자 정의 (재측정)");
  });
});
