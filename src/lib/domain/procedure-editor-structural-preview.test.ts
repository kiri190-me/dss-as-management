import { describe, test } from "node:test";
import assert from "node:assert/strict";
import {
  previewPendingStructuralGraph,
  describeStructuralConflicts,
  PROCEDURE_STRUCTURAL_CONFLICT_LABELS,
  PROCEDURE_STRUCTURAL_OPERATION_LABELS,
  type StructuralPreviewFactories,
} from "./procedure-editor-structural-preview";
import type { PendingStructuralOperation, StructuralOperationConflict } from "./procedure-editor-structural-changes";
import { PROCEDURE_NODE_TYPE_CODES } from "./procedure-template-types";
import type { ProcedureBranchType, ProcedureNodeType } from "./procedure-template-types";

/**
 * ============================================================================
 * 저장 전 구조 변경을 **그림에 미리 그린다**(2026-11-20, 조각 4)
 * ============================================================================
 * 🔴 여기서 가장 조용히 깨지는 것은 **차례**다. 보낼 차례(갈래별로 다시 세운 것)로
 * 그리면 결과가 사람이 한 일과 달라지는데, 그 다름이 드러나는 입력은 「긋고 지우기」
 * 하나뿐이라 아무 입력으로나 재면 영영 통과한다. ⑧절이 그 한 입력을 그대로 박았다.
 *
 * 🔵 가짜 행은 **칸이 여섯뿐**이다. 이 모듈이 행의 모양을 모른다는 것이 설계의 핵심이라,
 * 시험이 진짜 EditorNodeRow 를 쓰면 그 보증이 시험에서 사라진다.
 */

type TestNode = { id: string; nodeType: ProcedureNodeType; title: string; sortOrder: number; x: number | null; y: number | null };
type TestEdge = { id: string; fromNodeId: string; toNodeId: string; branchType: ProcedureBranchType; branchLabel: string | null; sortOrder: number };

const factories: StructuralPreviewFactories<TestNode, TestEdge> = {
  createNode: (seed) => ({
    id: seed.id,
    nodeType: seed.nodeType,
    title: seed.title,
    sortOrder: seed.sortOrder,
    x: seed.position ? seed.position.x : null,
    y: seed.position ? seed.position.y : null,
  }),
  createEdge: (seed) => ({
    id: seed.id,
    fromNodeId: seed.fromNodeId,
    toNodeId: seed.toNodeId,
    branchType: seed.branchType,
    branchLabel: seed.branchLabel,
    sortOrder: seed.sortOrder,
  }),
  changeNodeType: (node, newNodeType) => ({ ...node, nodeType: newNodeType }),
  retargetEdge: (edge, fromNodeId, toNodeId) => ({ ...edge, fromNodeId, toNodeId }),
};

function node(id: string, sortOrder: number, nodeType: ProcedureNodeType = "TASK"): TestNode {
  return { id, nodeType, title: `${id} 제목`, sortOrder, x: 10, y: 20 };
}
function edge(id: string, fromNodeId: string, toNodeId: string, branchType: ProcedureBranchType = "DEFAULT", sortOrder = 0): TestEdge {
  return { id, fromNodeId, toNodeId, branchType, branchLabel: branchType === "CUSTOM" ? "라벨" : null, sortOrder };
}

const createNodeOp = (tempNodeId: string, overrides: Partial<Extract<PendingStructuralOperation, { kind: "CREATE_NODE" }>> = {}): PendingStructuralOperation => ({
  kind: "CREATE_NODE",
  tempNodeId,
  nodeType: "TASK",
  title: "새 노드",
  position: null,
  ...overrides,
});

describe("구조 미리보기 — ① 먼저 표본 확인", () => {
  test("🔵 조작이 0건이면 내용이 그대로이고, **들어온 배열을 안 건드린다**", () => {
    const nodes = [node("n1", 0), node("n2", 1)];
    const edges = [edge("e1", "n1", "n2")];
    const result = previewPendingStructuralGraph(nodes, edges, [], factories);

    assert.deepEqual(
      result.nodes.map((n) => n.id),
      ["n1", "n2"]
    );
    assert.deepEqual(
      result.edges.map((e) => e.id),
      ["e1"]
    );
    assert.deepEqual(result.addedNodeIds, []);
    assert.deepEqual(result.addedEdgeIds, []);
    // 🔴 돌려준 배열이 **들어온 바로 그 배열**이면 아래 모든 시험이 입력을 고치며
    //    돈 것이 되고, 화면에서는 memo 가 안 깨져 변화가 안 보인다.
    assert.notEqual(result.nodes, nodes);
    assert.notEqual(result.edges, edges);
    assert.equal(nodes.length, 2, "입력이 그대로여야 한다");
    assert.equal(edges.length, 1);
  });

  test("🔵 재려는 것이 실제로 있다 — 갈래 일곱 전부에 이름이 붙어 있다", () => {
    const kinds: PendingStructuralOperation["kind"][] = [
      "CREATE_NODE",
      "DELETE_NODE",
      "CHANGE_NODE_TYPE",
      "CREATE_EDGE",
      "DELETE_EDGE",
      "RETARGET_EDGE",
      "INSERT_NODE_ON_EDGE",
    ];
    assert.equal(Object.keys(PROCEDURE_STRUCTURAL_OPERATION_LABELS).length, kinds.length);
    for (const kind of kinds) assert.ok(PROCEDURE_STRUCTURAL_OPERATION_LABELS[kind].length > 0, `${kind} 에 이름이 없다`);
  });
});

describe("구조 미리보기 — ② 노드 만들기", () => {
  test("🔴 노드가 한 칸 늘고, 새 id 가 addedNodeIds 에 들어간다", () => {
    const result = previewPendingStructuralGraph([node("n1", 0)], [], [createNodeOp("tmp:node:1", { title: "배선 점검", nodeType: "INSPECTION" })], factories);

    assert.deepEqual(
      result.nodes.map((n) => n.id),
      ["n1", "tmp:node:1"]
    );
    const created = result.nodes[1];
    assert.equal(created.title, "배선 점검");
    assert.equal(created.nodeType, "INSPECTION");
    assert.deepEqual(result.addedNodeIds, ["tmp:node:1"]);
  });

  test("🔴 자리를 안 정하면 **null 로 남는다** — 0,0 으로 떨어뜨리면 진짜 노드와 포개진다", () => {
    const result = previewPendingStructuralGraph([], [], [createNodeOp("tmp:node:1")], factories);
    assert.equal(result.nodes[0].x, null);
    assert.equal(result.nodes[0].y, null);

    const placed = previewPendingStructuralGraph([], [], [createNodeOp("tmp:node:1", { position: { x: -486, y: 150 } })], factories);
    assert.deepEqual({ x: placed.nodes[0].x, y: placed.nodes[0].y }, { x: -486, y: 150 });
  });

  test("🔴 정렬 번호는 **맨 뒤 + 1** 이고, 여럿을 만들면 하나씩 올라간다(서버의 셈 그대로)", () => {
    const result = previewPendingStructuralGraph(
      [node("n1", 3), node("n2", 7)],
      [],
      [createNodeOp("tmp:node:1"), createNodeOp("tmp:node:2")],
      factories
    );
    assert.equal(result.nodes.find((n) => n.id === "tmp:node:1")!.sortOrder, 8);
    assert.equal(result.nodes.find((n) => n.id === "tmp:node:2")!.sortOrder, 9);
  });

  test("🔵 노드가 하나도 없으면 첫 번호는 0 이다(서버의 `(max ?? -1) + 1` 과 같은 값)", () => {
    const result = previewPendingStructuralGraph([], [], [createNodeOp("tmp:node:1")], factories);
    assert.equal(result.nodes[0].sortOrder, 0);
  });
});

describe("구조 미리보기 — ③ 노드 지우기 · 유형 바꾸기", () => {
  test("🔴 지운 노드가 사라진다", () => {
    const result = previewPendingStructuralGraph([node("n1", 0), node("n2", 1)], [], [{ kind: "DELETE_NODE", nodeId: "n1", reason: null }], factories);
    assert.deepEqual(
      result.nodes.map((n) => n.id),
      ["n2"]
    );
  });

  test("🔴 없는 노드를 지우라면 **조용히 지나간다** — 그릴 때 던지면 화면이 통째로 하얘진다", () => {
    const result = previewPendingStructuralGraph([node("n1", 0)], [], [{ kind: "DELETE_NODE", nodeId: "없는노드", reason: null }], factories);
    assert.deepEqual(
      result.nodes.map((n) => n.id),
      ["n1"]
    );
  });

  test("🔴 유형만 바뀌고 나머지 칸은 그대로다", () => {
    const before = node("n1", 4, "TASK");
    const result = previewPendingStructuralGraph([before], [], [{ kind: "CHANGE_NODE_TYPE", nodeId: "n1", newNodeType: "DECISION", reason: null }], factories);
    const after = result.nodes[0];
    assert.equal(after.nodeType, "DECISION");
    assert.equal(after.title, before.title);
    assert.equal(after.sortOrder, before.sortOrder);
    assert.equal(before.nodeType, "TASK", "입력 행을 제자리에서 고치면 안 된다");
  });

  test("🔵 아홉 유형 전부로 바꿔 그릴 수 있다 — 좁히는 일은 **화면**의 몫이지 그리기의 몫이 아니다", () => {
    for (const nodeType of PROCEDURE_NODE_TYPE_CODES) {
      const result = previewPendingStructuralGraph([node("n1", 0)], [], [{ kind: "CHANGE_NODE_TYPE", nodeId: "n1", newNodeType: nodeType, reason: null }], factories);
      assert.equal(result.nodes[0].nodeType, nodeType);
    }
  });
});

describe("구조 미리보기 — ④ 연결선", () => {
  test("🔴 연결선이 늘고, 분기 유형·라벨이 그대로 실린다", () => {
    const result = previewPendingStructuralGraph(
      [node("n1", 0), node("n2", 1)],
      [],
      [{ kind: "CREATE_EDGE", tempEdgeId: "tmp:edge:1", fromNodeId: "n1", toNodeId: "n2", branchType: "CUSTOM", branchLabel: "재시도", reason: "사유" }],
      factories
    );
    assert.deepEqual(result.addedEdgeIds, ["tmp:edge:1"]);
    assert.equal(result.edges[0].branchType, "CUSTOM");
    assert.equal(result.edges[0].branchLabel, "재시도");
  });

  test("🔴 연결선 번호는 **같은 시작 노드 안에서** 맨 뒤 + 1 이다", () => {
    const result = previewPendingStructuralGraph(
      [node("n1", 0), node("n2", 1), node("n3", 2)],
      [edge("e1", "n1", "n2", "DEFAULT", 5), edge("e2", "n3", "n2", "DEFAULT", 9)],
      [{ kind: "CREATE_EDGE", tempEdgeId: "tmp:edge:1", fromNodeId: "n1", toNodeId: "n3", branchType: "DEFAULT", branchLabel: null, reason: null }],
      factories
    );
    // n1 에서 나가는 선의 맨 뒤가 5 이므로 6 — n3 의 9 는 안 센다.
    assert.equal(result.edges.find((e) => e.id === "tmp:edge:1")!.sortOrder, 6);
  });

  test("🔴 지운 연결선이 사라지고, 없는 연결선은 조용히 지나간다", () => {
    const result = previewPendingStructuralGraph(
      [node("n1", 0), node("n2", 1)],
      [edge("e1", "n1", "n2")],
      [
        { kind: "DELETE_EDGE", edgeId: "e1", reason: null },
        { kind: "DELETE_EDGE", edgeId: "없는선", reason: null },
      ],
      factories
    );
    assert.deepEqual(result.edges, []);
  });

  test("🔴 재연결은 양 끝을 함께 옮긴다", () => {
    const result = previewPendingStructuralGraph(
      [node("n1", 0), node("n2", 1), node("n3", 2)],
      [edge("e1", "n1", "n2")],
      [{ kind: "RETARGET_EDGE", edgeId: "e1", newFromNodeId: "n3", newToNodeId: "n1", reason: null }],
      factories
    );
    assert.equal(result.edges[0].fromNodeId, "n3");
    assert.equal(result.edges[0].toNodeId, "n1");
  });
});

describe("구조 미리보기 — ⑤ 연결선 위 노드 끼우기", () => {
  const insertOp: PendingStructuralOperation = {
    kind: "INSERT_NODE_ON_EDGE",
    edgeId: "e1",
    tempNodeId: "tmp:node:1",
    tempSecondEdgeId: "tmp:edge:1",
    nodeType: "TASK",
    title: "중간 작업",
    position: { x: 100, y: 200 },
  };

  test("🔴 **한 번에 셋** — 노드 하나 · 원래 선의 끝이 새 노드로 · 새 노드에서 원래 대상으로 한 줄", () => {
    const result = previewPendingStructuralGraph([node("n1", 0), node("n2", 1)], [edge("e1", "n1", "n2", "NG", 3)], [insertOp], factories);

    assert.deepEqual(result.addedNodeIds, ["tmp:node:1"]);
    assert.deepEqual(result.addedEdgeIds, ["tmp:edge:1"]);

    const first = result.edges.find((e) => e.id === "e1")!;
    assert.deepEqual({ from: first.fromNodeId, to: first.toNodeId }, { from: "n1", to: "tmp:node:1" });
    // 🔴 원래 분기 유형·라벨은 **첫 구간에 그대로** 남는다.
    assert.equal(first.branchType, "NG");

    const second = result.edges.find((e) => e.id === "tmp:edge:1")!;
    assert.deepEqual({ from: second.fromNodeId, to: second.toNodeId }, { from: "tmp:node:1", to: "n2" });
    // 🔴 둘째 구간은 언제나 기본이다 — 원래 선의 판단을 베끼면 그래프의 뜻이 바뀐다.
    assert.equal(second.branchType, "DEFAULT");
    assert.equal(second.branchLabel, null);
  });

  test("🔴 쪼갤 선이 없으면 **노드도 안 만든다** — 선 없는 외톨이 칸은 사람이 시킨 적이 없다", () => {
    const result = previewPendingStructuralGraph([node("n1", 0)], [], [insertOp], factories);
    assert.deepEqual(result.nodes.map((n) => n.id), ["n1"]);
    assert.deepEqual(result.addedNodeIds, []);
    assert.deepEqual(result.addedEdgeIds, []);
  });

  test("🔵 끼운 노드는 경로점 자리에 선다", () => {
    const result = previewPendingStructuralGraph([node("n1", 0), node("n2", 1)], [edge("e1", "n1", "n2")], [insertOp], factories);
    const inserted = result.nodes.find((n) => n.id === "tmp:node:1")!;
    assert.deepEqual({ x: inserted.x, y: inserted.y }, { x: 100, y: 200 });
  });
});

describe("구조 미리보기 — ⑥ 차례가 **사람이 한 차례** 그대로다", () => {
  /**
   * 🔴 이 절이 이 파일에서 가장 중요하다. 보낼 차례
   * (PROCEDURE_STRUCTURAL_PHASE_ORDER)는 DELETE_EDGE 를 CREATE_EDGE 보다 **앞**에
   * 둔다. 그 차례로 그리면 아래 둘이 **같은 그림**이 되는데, 사람 눈에는 정반대다.
   */
  const n = [node("n1", 0), node("n2", 1)];
  const e = [edge("e1", "n1", "n2")];
  const createSecond: PendingStructuralOperation = {
    kind: "CREATE_EDGE",
    tempEdgeId: "tmp:edge:1",
    fromNodeId: "n2",
    toNodeId: "n1",
    branchType: "DEFAULT",
    branchLabel: null,
    reason: null,
  };
  const deleteFirst: PendingStructuralOperation = { kind: "DELETE_EDGE", edgeId: "e1", reason: null };

  test("🔴 「지우고 긋기」는 새 선만 남는다", () => {
    const result = previewPendingStructuralGraph(n, e, [deleteFirst, createSecond], factories);
    assert.deepEqual(result.edges.map((x) => x.id), ["tmp:edge:1"]);
  });

  test("🔴 「긋고 지우기」도 새 선만 남는다 — 다만 **지우는 대상이 다르다**", () => {
    // 같은 두 조작이라도 가리키는 것이 다르면 결과가 갈린다. 아래가 그 증거다.
    const deleteTheNewOne: PendingStructuralOperation = { kind: "DELETE_EDGE", edgeId: "tmp:edge:1", reason: null };
    const result = previewPendingStructuralGraph(n, e, [createSecond, deleteTheNewOne], factories);
    assert.deepEqual(result.edges.map((x) => x.id), ["e1"], "사람이 한 차례대로면 **방금 그은 선**이 지워져야 한다");

    // 🔴 보낼 차례(지우기가 앞)로 돌리면 e1 이 남는 대신 tmp:edge:1 이 남는다 —
    //    그 차례로 그리지 않는다는 것이 이 단언의 뜻이다.
    const wrongOrder = previewPendingStructuralGraph(n, e, [deleteTheNewOne, createSecond], factories);
    assert.deepEqual(wrongOrder.edges.map((x) => x.id), ["e1", "tmp:edge:1"]);
  });

  test("🔴 만들었다 지운 임시 노드는 **접기를 안 거쳐도** 그림에 안 남는다", () => {
    const result = previewPendingStructuralGraph(
      [node("n1", 0)],
      [],
      [createNodeOp("tmp:node:1"), { kind: "DELETE_NODE", nodeId: "tmp:node:1", reason: null }],
      factories
    );
    assert.deepEqual(result.nodes.map((x) => x.id), ["n1"]);
    // 🔵 addedNodeIds 에는 남는다 — 「이번 미리보기에서 만들어졌다」는 사실 자체는
    //    맞고, 그 목록을 쓰는 쪽(화면)은 늘 nodes 와 맞대어 읽는다.
    assert.deepEqual(result.addedNodeIds, ["tmp:node:1"]);
  });
});

describe("구조 미리보기 — ⑦ 막힌 까닭을 사람 말로", () => {
  test("🔴 까닭 넷에 전부 글이 있고, 빈 글이 없다", () => {
    const reasons = ["DANGLING_TEMP_ID", "INSERT_ON_UNSAVED_EDGE", "ENDPOINT_DELETED_IN_SAME_SAVE", "TEMP_NODE_TYPE_NOT_CREATABLE"] as const;
    assert.equal(Object.keys(PROCEDURE_STRUCTURAL_CONFLICT_LABELS).length, reasons.length);
    for (const reason of reasons) {
      assert.ok(PROCEDURE_STRUCTURAL_CONFLICT_LABELS[reason].length > 10, `${reason} 의 글이 너무 짧다`);
    }
  });

  test("🔴 한 줄에 **어떤 조작인지**와 **무엇을 해야 하는지**가 함께 적힌다", () => {
    const conflicts: StructuralOperationConflict[] = [
      {
        operation: { kind: "INSERT_NODE_ON_EDGE", edgeId: "tmp:edge:1", tempNodeId: "tmp:node:1", tempSecondEdgeId: "tmp:edge:2", nodeType: "TASK", title: "x", position: { x: 0, y: 0 } },
        reason: "INSERT_ON_UNSAVED_EDGE",
      },
      {
        operation: { kind: "CREATE_EDGE", tempEdgeId: "tmp:edge:3", fromNodeId: "n1", toNodeId: "n2", branchType: "DEFAULT", branchLabel: null, reason: null },
        reason: "ENDPOINT_DELETED_IN_SAME_SAVE",
      },
    ];
    const lines = describeStructuralConflicts(conflicts);
    assert.equal(lines.length, 2);
    assert.ok(lines[0].startsWith("연결선 위 노드 끼우기 — "));
    assert.ok(lines[0].includes("먼저 [저장]"));
    assert.ok(lines[1].startsWith("연결선 추가 — "));
    assert.ok(lines[1].includes("되돌려"));
  });

  test("🔵 막힌 것이 없으면 빈 목록이다 — 그래야 화면이 「있으면 그린다」 한 줄로 끝난다", () => {
    assert.deepEqual(describeStructuralConflicts([]), []);
  });
});
