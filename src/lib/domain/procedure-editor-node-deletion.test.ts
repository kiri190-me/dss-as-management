import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  findEdgesAttachedToNode,
  findEdgesAttachedToNodes,
  planProcedureNodeDeletionOperations,
  planProcedureNodesDeletionOperations,
  resolveProcedureNodeDeleteBlockedReason,
  PROCEDURE_NODE_DELETE_BLOCKED_BY_CONTENT,
  type NodeDeletionEdge,
} from "./procedure-editor-node-deletion";
import {
  coalescePendingStructuralOperations,
  canSendStructuralChanges,
  planProcedureStructuralSteps,
  PROCEDURE_STRUCTURAL_PHASE_ORDER,
  type PendingStructuralOperation,
} from "./procedure-editor-structural-changes";
import { previewPendingStructuralGraph, type StructuralPreviewFactories } from "./procedure-editor-structural-preview";

/**
 * 「기술 작업 절차」 편집기 — **노드를 지우면 붙은 연결선도 함께 지운다**(2026-11-21)의
 * 순수 판정 시험. React 도 DOM 도 서버 액션도 DB 도 안 부른다.
 *
 * 쓰는 분의 결정(원문): 「노드를 지우면 연결된 연결선도 함께 지워지는 걸로 하자 —
 * 연결선을 지우지 않아도 노드를 지울 수 있도록.」
 *
 * ── 🔴 여기서 가장 크게 다칠 수 있는 것 ────────────────────────────────
 * ① **선 하나를 빠뜨리는 것.** 서버는 선이 붙은 노드를 여전히
 *    NODE_HAS_CONNECTED_EDGES 로 거절한다. 한 줄만 빠져도 [저장]이 통째로 실패하고,
 *    그때쯤이면 그림에서 노드는 이미 사라져 보인다. ②③절.
 * ② **보낼 차례가 뒤집히는 것.** 이 기능은 「DELETE_EDGE 가 DELETE_NODE 보다
 *    앞」이라는 차례에 **전적으로** 기대고 있다. 그 차례를 누가 바꾸면 이 기능의
 *    모든 삭제가 실패한다 — ④절이 값으로 못 박는다.
 * ③ **접기가 삼켜 버리는 것.** 저장 전에 그은 선 · 이미 지우기로 쌓아 둔 선이
 *    섞이면 겹침이 생긴다. ⑤절이 「무엇이 남고 무엇이 사라지는가」를 건수와 함께 잰다.
 * ④ **서버 목록으로 세는 것.** 저장 전에 긋거나 옮긴 선이 안 잡힌다. ⑥절이 두
 *    목록의 답이 **실제로 갈린다**는 것을 보인다 — 안 갈리면 ⑥절은 아무것도 안 재는
 *    시험이 된다.
 *
 * ── 🔵 표본이 비어 공짜로 통과하지 않게 ────────────────────────────────
 * ①절이 표본 그래프에 **붙은 선과 안 붙은 선이 둘 다** 있다는 것을 먼저 보인다.
 * 안 그러면 「안 붙은 선은 안 지운다」가 선이 하나도 없어서 통과할 수 있다.
 */

/** 🔵 진짜 id 모양이면 되고 실제 데이터와는 아무 상관이 없다(서버의 randomUUID() 와 같은 꼴). */
const NODE_A = "11111111-1111-4111-8111-111111111111";
const NODE_B = "22222222-2222-4222-8222-222222222222";
const NODE_C = "33333333-3333-4333-8333-333333333333";
const EDGE_AB = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const EDGE_CA = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const EDGE_BC = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

/**
 * B 를 가운데 두고 **들어오는 선 하나(A→B) · 나가는 선 하나(B→C) · 아무 상관 없는
 * 선 하나(C→A)**. 세 모양을 한 그래프에 담아 두어야 아래 단언들이 서로를 지킨다.
 */
const GRAPH: NodeDeletionEdge[] = [
  { id: EDGE_AB, fromNodeId: NODE_A, toNodeId: NODE_B },
  { id: EDGE_BC, fromNodeId: NODE_B, toNodeId: NODE_C },
  { id: EDGE_CA, fromNodeId: NODE_C, toNodeId: NODE_A },
];

const kindsOf = (ops: readonly PendingStructuralOperation[]) => ops.map((op) => op.kind);
const dropReasons = (result: ReturnType<typeof coalescePendingStructuralOperations>) => result.dropped.map((d) => `${d.operation.kind}:${d.reason}`);

describe("노드 삭제에 선이 딸려 간다 — ① 먼저 표본 확인", () => {
  test("🔵 표본 그래프에 **붙은 선과 안 붙은 선이 둘 다** 있다", () => {
    assert.equal(GRAPH.length, 3);
    const attached = findEdgesAttachedToNode(GRAPH, NODE_B);
    assert.deepEqual(attached, [EDGE_AB, EDGE_BC], "B 에 붙은 선이 둘이어야 아래 단언이 뜻을 갖는다");
    assert.ok(GRAPH.some((e) => !attached.includes(e.id)), "안 붙은 선이 하나도 없으면 「안 지운다」가 공짜로 통과한다");
  });
});

describe("노드 삭제에 선이 딸려 간다 — ② 무엇이 잡히는가", () => {
  test("🔴 **들어오는 선도 나가는 선도** 잡힌다 — 방향을 안 가린다", () => {
    // 🔴 한쪽만 세면 반대 방향 선이 남아 서버가 NODE_HAS_CONNECTED_EDGES 로 거절한다.
    assert.deepEqual(findEdgesAttachedToNode(GRAPH, NODE_B), [EDGE_AB, EDGE_BC]);
    assert.deepEqual(findEdgesAttachedToNode(GRAPH, NODE_A), [EDGE_AB, EDGE_CA]);
    assert.deepEqual(findEdgesAttachedToNode(GRAPH, NODE_C), [EDGE_BC, EDGE_CA]);
  });

  test("🔴 **안 붙은 선은 안 건드린다**", () => {
    assert.ok(!findEdgesAttachedToNode(GRAPH, NODE_B).includes(EDGE_CA));
  });

  test("🔵 선이 하나도 안 붙은 노드면 **빈 목록**이다 — 지금까지의 삭제와 같은 모습", () => {
    const lonely = "44444444-4444-4444-8444-444444444444";
    assert.deepEqual(findEdgesAttachedToNode(GRAPH, lonely), []);
  });

  test("🔵 자기 자신으로 가는 선은 **한 번만** 잡힌다 — 두 번 쌓으면 둘째가 없는 선을 지운다", () => {
    // 🔵 서버는 그런 선을 거절하지만 저장 **전**에는 그릴 수 있다(값 검증은 서버 몫).
    const selfLoop: NodeDeletionEdge[] = [{ id: EDGE_AB, fromNodeId: NODE_A, toNodeId: NODE_A }];
    assert.deepEqual(findEdgesAttachedToNode(selfLoop, NODE_A), [EDGE_AB]);
  });

  test("🔵 차례는 **받은 목록 그대로**다 — 화면이 보여 준 차례와 같아야 사람이 수를 맞춰 읽는다", () => {
    const reversed = [...GRAPH].reverse();
    assert.deepEqual(findEdgesAttachedToNode(reversed, NODE_B), [EDGE_BC, EDGE_AB]);
  });
});

describe("노드 삭제에 선이 딸려 간다 — ③ 쌓이는 줄", () => {
  test("🔴 **선이 먼저, 노드가 마지막** — 그리고 줄 수는 선 수 + 1 이다", () => {
    const ops = planProcedureNodeDeletionOperations(GRAPH, NODE_B, null);
    assert.equal(ops.length, 3, "선 둘 + 노드 하나");
    assert.deepEqual(kindsOf(ops), ["DELETE_EDGE", "DELETE_EDGE", "DELETE_NODE"]);
    assert.deepEqual(ops, [
      { kind: "DELETE_EDGE", edgeId: EDGE_AB, reason: null },
      { kind: "DELETE_EDGE", edgeId: EDGE_BC, reason: null },
      { kind: "DELETE_NODE", nodeId: NODE_B, reason: null },
    ]);
  });

  test("🔴 붙은 선이 없으면 **노드 한 줄뿐**이다 — 쓸데없는 줄을 만들지 않는다", () => {
    const lonely = "44444444-4444-4444-8444-444444444444";
    assert.deepEqual(planProcedureNodeDeletionOperations(GRAPH, lonely, null), [{ kind: "DELETE_NODE", nodeId: lonely, reason: null }]);
  });

  test("🔵 사유는 **모든 줄에** 실린다 — 선이 왜 사라졌는지에 대한 답이 그것뿐이다", () => {
    const ops = planProcedureNodeDeletionOperations(GRAPH, NODE_B, "중복 단계라 걷어냄");
    assert.equal(ops.length, 3);
    for (const op of ops) {
      assert.equal("reason" in op ? op.reason : null, "중복 단계라 걷어냄");
    }
  });

  test("🔴 **한 번에 돌려준다** — 화면이 이 배열을 통째로 쌓아야 [이전] 한 칸이 된다", () => {
    // 🔴 돌려주는 것이 배열 하나라는 사실 자체가 「한 칸」의 근거다. 화면의
    //    queueStructural 은 목록을 고치기 **전에** 되돌리기 한 칸을 찍고 받은
    //    배열을 통째로 붙인다(appendPendingStructuralOperations). 선을 따로 쌓도록
    //    쪼개 부르면 [이전]을 선 수만큼 더 눌러야 노드가 돌아온다.
    const ops = planProcedureNodeDeletionOperations(GRAPH, NODE_B, null);
    assert.ok(Array.isArray(ops));
    assert.equal(ops.filter((op) => op.kind === "DELETE_NODE").length, 1, "노드 삭제는 한 줄이어야 한다");
  });
});

describe("노드 삭제에 선이 딸려 간다 — ④🔴 보낼 차례가 이 기능을 떠받친다", () => {
  test("🔴 차례 세우기를 지나면 **DELETE_EDGE 가 전부 DELETE_NODE 보다 앞**이다", () => {
    // 🔴 이것이 깨지면 서버가 NODE_HAS_CONNECTED_EDGES 로 거절한다 — 화면에서는
    //    「지웠는데 저장이 실패한다」로 나타난다.
    const ops = planProcedureNodeDeletionOperations(GRAPH, NODE_B, null);
    const coalesced = coalescePendingStructuralOperations(ops);
    assert.equal(coalesced.conflicts.length, 0, "막힌 줄이 있으면 [저장] 자체가 안 된다");
    assert.equal(coalesced.operations.length, 3, "접기가 멀쩡한 줄을 삼켰다");
    const planned = planProcedureStructuralSteps(coalesced.operations);
    const nodeAt = planned.findIndex((op) => op.kind === "DELETE_NODE");
    const edgeIndexes = planned.map((op, i) => (op.kind === "DELETE_EDGE" ? i : -1)).filter((i) => i !== -1);
    assert.equal(edgeIndexes.length, 2, "선 삭제 둘이 계획에 안 들어 있다");
    assert.notEqual(nodeAt, -1);
    for (const at of edgeIndexes) assert.ok(at < nodeAt, `연결선 삭제(${at})가 노드 삭제(${nodeAt})보다 뒤다`);
  });

  test("🔴 차례표 자체가 **DELETE_EDGE → DELETE_NODE** 로 적혀 있다 — 뒤집으면 이 기능이 통째로 깨진다", () => {
    const edgePhase = PROCEDURE_STRUCTURAL_PHASE_ORDER.indexOf("DELETE_EDGE");
    const nodePhase = PROCEDURE_STRUCTURAL_PHASE_ORDER.indexOf("DELETE_NODE");
    assert.notEqual(edgePhase, -1);
    assert.notEqual(nodePhase, -1);
    assert.ok(edgePhase < nodePhase, `연결선 삭제 ${edgePhase}단계가 노드 삭제 ${nodePhase}단계보다 뒤다`);
  });
});

describe("노드 삭제에 선이 딸려 간다 — ⑤ 이미 쌓인 것과 겹칠 때", () => {
  test("🔵 같은 선을 두 번 지우라고 적혀도 **접기가 한 줄로** 만든다", () => {
    // 🔵 화면은 미리보기에서 찾으므로 이미 지우기로 쌓아 둔 선은 애초에 안 잡힌다
    //    (⑥절). 그래도 그 그물이 받아 준다는 것을 값으로 확인해 둔다 — 두 겹으로
    //    막아 두는 자리이지, 어느 한쪽만 있어도 되는 자리가 아니다.
    const already: PendingStructuralOperation[] = [{ kind: "DELETE_EDGE", edgeId: EDGE_AB, reason: null }];
    const ops = [...already, ...planProcedureNodeDeletionOperations(GRAPH, NODE_B, null)];
    assert.equal(ops.length, 4);
    const coalesced = coalescePendingStructuralOperations(ops);
    assert.equal(coalesced.operations.length, 3, "겹친 줄이 안 접혔다");
    assert.deepEqual(dropReasons(coalesced), ["DELETE_EDGE:DUPLICATE_DELETE"]);
    assert.equal(coalesced.operations.filter((op) => op.kind === "DELETE_EDGE" && op.edgeId === EDGE_AB).length, 1);
    assert.equal(canSendStructuralChanges(coalesced), true);
  });

  test("🔴 **저장 전에 그은 선**은 만들기와 함께 사라진다 — 보낼 것이 0건이다", () => {
    const pending: PendingStructuralOperation[] = [
      { kind: "CREATE_NODE", tempNodeId: "tmp:node:1", nodeType: "TASK", title: "새 작업", position: null },
      { kind: "CREATE_EDGE", tempEdgeId: "tmp:edge:1", fromNodeId: NODE_A, toNodeId: "tmp:node:1", branchType: "DEFAULT", branchLabel: null, reason: null },
    ];
    // 사람이 방금 만든 노드를 다시 지운다 — 미리보기에는 임시 선이 서 있다.
    const previewEdges: NodeDeletionEdge[] = [...GRAPH, { id: "tmp:edge:1", fromNodeId: NODE_A, toNodeId: "tmp:node:1" }];
    const ops = [...pending, ...planProcedureNodeDeletionOperations(previewEdges, "tmp:node:1", null)];
    assert.deepEqual(kindsOf(ops), ["CREATE_NODE", "CREATE_EDGE", "DELETE_EDGE", "DELETE_NODE"]);

    const coalesced = coalescePendingStructuralOperations(ops);
    assert.deepEqual(coalesced.operations, [], "서버에 보낼 것이 남았다 — 만든 적도 없는 것을 지우러 간다");
    assert.equal(coalesced.conflicts.length, 0);
    assert.equal(coalesced.dropped.length, 4, "네 줄이 전부 접혀야 한다");
  });

  test("🔴 저장 전에 그은 선을 **안 쌓으면** 그 선이 [저장]을 통째로 막는다 — 이 기능이 고치려던 것보다 나쁜 꼴", () => {
    // 🔴 「붙은 선을 함께 쌓는다」를 빼면 어떻게 되는지를 값으로 보여 둔다.
    //    DELETE_NODE 한 줄만 쌓는 **옛 모습**이다.
    const pending: PendingStructuralOperation[] = [
      { kind: "CREATE_EDGE", tempEdgeId: "tmp:edge:1", fromNodeId: NODE_A, toNodeId: NODE_B, branchType: "DEFAULT", branchLabel: null, reason: null },
      { kind: "DELETE_NODE", nodeId: NODE_B, reason: null },
    ];
    const blocked = coalescePendingStructuralOperations(pending);
    assert.deepEqual(
      blocked.conflicts.map((c) => c.reason),
      ["ENDPOINT_DELETED_IN_SAME_SAVE"]
    );
    assert.equal(canSendStructuralChanges(blocked), false);

    // 🔵 붙은 선을 함께 쌓으면(지금 모습) 그 막음이 사라진다.
    const previewEdges: NodeDeletionEdge[] = [{ id: "tmp:edge:1", fromNodeId: NODE_A, toNodeId: NODE_B }];
    const now = coalescePendingStructuralOperations([pending[0], ...planProcedureNodeDeletionOperations(previewEdges, NODE_B, null)]);
    assert.equal(now.conflicts.length, 0, "저장이 여전히 막힌다");
    assert.equal(canSendStructuralChanges(now), true);
    assert.deepEqual(kindsOf(now.operations), ["DELETE_NODE"], "임시 선은 만들기와 함께 사라지고 노드 삭제만 남는다");
  });
});

describe("노드 삭제에 선이 딸려 간다 — ⑥🔴 **그려진 목록**에서 찾아야 한다", () => {
  /** 미리보기 모듈이 요구하는 최소 모양. 칸이 이것뿐이라 시험이 db/queries 타입을 안 문다. */
  type Node = { readonly id: string; readonly sortOrder: number };
  type Edge = { readonly id: string; readonly fromNodeId: string; readonly toNodeId: string; readonly sortOrder: number };
  const factories: StructuralPreviewFactories<Node, Edge> = {
    createNode: (seed) => ({ id: seed.id, sortOrder: seed.sortOrder }),
    createEdge: (seed) => ({ id: seed.id, fromNodeId: seed.fromNodeId, toNodeId: seed.toNodeId, sortOrder: seed.sortOrder }),
    changeNodeType: (node) => node,
    retargetEdge: (edge, fromNodeId, toNodeId) => ({ ...edge, fromNodeId, toNodeId }),
  };
  const serverNodes: Node[] = [NODE_A, NODE_B, NODE_C].map((id, i) => ({ id, sortOrder: i }));
  const serverEdges: Edge[] = GRAPH.map((e, i) => ({ ...e, sortOrder: i }));

  test("🔴 저장 전에 **옮긴 선**: 서버 목록으로 세면 떠난 선을 지우고 옮겨 온 선은 남긴다", () => {
    // C→A 를 C→B 로 옮겼다. 이제 B 에는 선이 셋, A 에는 하나다.
    const pending: PendingStructuralOperation[] = [{ kind: "RETARGET_EDGE", edgeId: EDGE_CA, newFromNodeId: NODE_C, newToNodeId: NODE_B, reason: null }];
    const preview = previewPendingStructuralGraph(serverNodes, serverEdges, pending, factories);

    assert.deepEqual(findEdgesAttachedToNode(preview.edges, NODE_B), [EDGE_AB, EDGE_BC, EDGE_CA], "그려진 목록 — 옮겨 온 선까지 셋");
    assert.deepEqual(findEdgesAttachedToNode(serverEdges, NODE_B), [EDGE_AB, EDGE_BC], "서버 목록 — 옮겨 온 선을 못 본다(남으면 서버가 거절한다)");
    assert.deepEqual(findEdgesAttachedToNode(preview.edges, NODE_A), [EDGE_AB], "그려진 목록 — 떠난 선은 안 잡힌다");
    assert.deepEqual(findEdgesAttachedToNode(serverEdges, NODE_A), [EDGE_AB, EDGE_CA], "서버 목록 — 남의 선을 지우러 간다");
  });

  test("🔴 저장 전에 **이미 지운 선**은 그려진 목록에 없다 — 두 번 쌓일 일이 없다", () => {
    const pending: PendingStructuralOperation[] = [{ kind: "DELETE_EDGE", edgeId: EDGE_AB, reason: null }];
    const preview = previewPendingStructuralGraph(serverNodes, serverEdges, pending, factories);
    assert.deepEqual(findEdgesAttachedToNode(preview.edges, NODE_B), [EDGE_BC]);

    const ops = [...pending, ...planProcedureNodeDeletionOperations(preview.edges, NODE_B, null)];
    assert.deepEqual(kindsOf(ops), ["DELETE_EDGE", "DELETE_EDGE", "DELETE_NODE"], "선 삭제가 둘(먼저 지운 것 + 나머지)");
    const coalesced = coalescePendingStructuralOperations(ops);
    assert.equal(coalesced.dropped.length, 0, "접기가 손댈 겹침이 애초에 없어야 한다");
    assert.deepEqual(
      coalesced.operations.map((op) => (op.kind === "DELETE_EDGE" ? op.edgeId : op.kind === "DELETE_NODE" ? op.nodeId : op.kind)),
      [EDGE_AB, EDGE_BC, NODE_B]
    );
  });

  test("🔴 지운 뒤의 **그림과 보낼 목록이 같은 말을 한다** — 노드도 선도 남지 않는다", () => {
    const ops = planProcedureNodeDeletionOperations(serverEdges, NODE_B, null);
    const preview = previewPendingStructuralGraph(serverNodes, serverEdges, ops, factories);
    assert.deepEqual(
      preview.nodes.map((n) => n.id),
      [NODE_A, NODE_C],
      "그림에서 B 가 안 사라졌다"
    );
    assert.deepEqual(
      preview.edges.map((e) => e.id),
      [EDGE_CA],
      "B 에 붙어 있던 선이 그림에 남아 있다"
    );
    // 🔴 보낼 목록도 같은 말을 해야 한다 — 그림에서만 사라지면 새로고침에 되살아난다.
    const coalesced = coalescePendingStructuralOperations(ops);
    assert.equal(coalesced.operations.length, 3);
    assert.equal(canSendStructuralChanges(coalesced), true);
  });
});

/**
 * ============================================================================
 * ⑦ [범위 선택]으로 고른 **여럿**을 한 번에 (2026-11-21, 조각 B3)
 * ============================================================================
 * 쓰는 분 요청(원문): 「2번 옮기기 + [DELETE]로 지우는 것까지 하자.」
 *
 * 🔴 여기서 가장 크게 다칠 수 있는 것:
 *  ① **[이전] 한 칸이 아니게 되는 것.** 노드마다 쌓으면 한 번 눌러 하나만 돌아온다.
 *     배열 하나로 돌려주는지, 그 배열 안에 노드 수만큼 DELETE_NODE 가 있는지를 잰다.
 *  ② **두 노드가 공유하던 선을 두 번 지우러 가는 것.** 접기가 받아 준다는 것을
 *     값으로 확인해 둔다 — 「알아서 되겠지」로 두면 어느 날 조용히 안 된다.
 *  ③ **단수와 복수가 다르게 지우는 것.** 복수는 단수를 그대로 돌려야 한다.
 */
describe("여럿을 한 번에 지운다 — ⑦ 쌓이는 줄", () => {
  test("🔵 먼저 표본 — A 와 B 를 함께 지우면 **그 둘을 잇던 선이 겹친다**(아래 단언이 뜻을 갖는 조건)", () => {
    assert.ok(findEdgesAttachedToNode(GRAPH, NODE_A).includes(EDGE_AB));
    assert.ok(findEdgesAttachedToNode(GRAPH, NODE_B).includes(EDGE_AB), "겹치는 선이 없으면 접기 단언이 공짜로 통과한다");
  });

  test("🔴 **단수를 그대로 이어 붙인 것**이다 — 복수가 제 셈을 따로 적으면 둘이 갈린다", () => {
    const together = planProcedureNodesDeletionOperations(GRAPH, [NODE_A, NODE_C], null);
    const apart = [...planProcedureNodeDeletionOperations(GRAPH, NODE_A, null), ...planProcedureNodeDeletionOperations(GRAPH, NODE_C, null)];
    assert.deepEqual(together, apart);
  });

  test("🔴 **배열 하나**로 돌려준다 — 그것이 [이전] 한 칸의 근거다", () => {
    const ops = planProcedureNodesDeletionOperations(GRAPH, [NODE_A, NODE_B], null);
    assert.ok(Array.isArray(ops));
    assert.equal(ops.filter((op) => op.kind === "DELETE_NODE").length, 2, "고른 노드 수만큼 노드 삭제가 있어야 한다");
    assert.deepEqual(kindsOf(ops), ["DELETE_EDGE", "DELETE_EDGE", "DELETE_NODE", "DELETE_EDGE", "DELETE_EDGE", "DELETE_NODE"]);
  });

  test("🔵 **겹치는 선은 접기가 한 줄로** 만든다 — 그래서 노드마다 붙은 선을 넣는 것을 겁낼 까닭이 없다", () => {
    // A 에는 AB·CA, B 에는 AB·BC 가 붙어 있다 — AB 가 두 번 적힌다.
    const ops = planProcedureNodesDeletionOperations(GRAPH, [NODE_A, NODE_B], null);
    assert.equal(ops.filter((op) => op.kind === "DELETE_EDGE" && op.edgeId === EDGE_AB).length, 2, "겹침이 없으면 이 시험이 아무것도 안 잰다");

    const coalesced = coalescePendingStructuralOperations(ops);
    assert.equal(coalesced.conflicts.length, 0, "막힌 줄이 있으면 [저장] 자체가 안 된다");
    assert.deepEqual(dropReasons(coalesced), ["DELETE_EDGE:DUPLICATE_DELETE"]);
    assert.equal(coalesced.operations.filter((op) => op.kind === "DELETE_EDGE" && op.edgeId === EDGE_AB).length, 1);
    assert.equal(coalesced.operations.length, 5, "선 셋 + 노드 둘");
    assert.equal(canSendStructuralChanges(coalesced), true);
  });

  test("🔴 차례 세우기를 지나면 **선 삭제가 전부 노드 삭제보다 앞**이다 — 복수에서도 그 차례가 떠받친다", () => {
    const coalesced = coalescePendingStructuralOperations(planProcedureNodesDeletionOperations(GRAPH, [NODE_A, NODE_B], null));
    const planned = planProcedureStructuralSteps(coalesced.operations);
    const firstNodeAt = planned.findIndex((op) => op.kind === "DELETE_NODE");
    const edgeIndexes = planned.map((op, i) => (op.kind === "DELETE_EDGE" ? i : -1)).filter((i) => i !== -1);
    assert.equal(edgeIndexes.length, 3);
    assert.notEqual(firstNodeAt, -1);
    for (const at of edgeIndexes) assert.ok(at < firstNodeAt, `연결선 삭제(${at})가 노드 삭제(${firstNodeAt})보다 뒤다`);
  });

  test("🔴 **셋을 지우면 그림에 아무것도 안 남는다** — 그림과 보낼 목록이 같은 말을 한다", () => {
    const ops = planProcedureNodesDeletionOperations(GRAPH, [NODE_A, NODE_B, NODE_C], null);
    const coalesced = coalescePendingStructuralOperations(ops);
    assert.equal(coalesced.conflicts.length, 0);
    assert.deepEqual(
      coalesced.operations.filter((op) => op.kind === "DELETE_NODE").map((op) => (op.kind === "DELETE_NODE" ? op.nodeId : "")),
      [NODE_A, NODE_B, NODE_C]
    );
    assert.equal(coalesced.operations.filter((op) => op.kind === "DELETE_EDGE").length, 3, "선 셋이 각각 한 줄씩이어야 한다");
  });

  test("🔵 빈 목록이면 **빈 배열**이다 — 아무것도 안 바뀐 [이전] 한 칸을 찍으면 안 된다", () => {
    assert.deepEqual(planProcedureNodesDeletionOperations(GRAPH, [], null), []);
  });

  test("🔵 사유는 **모든 줄에** 실린다(단수와 같다)", () => {
    const ops = planProcedureNodesDeletionOperations(GRAPH, [NODE_A, NODE_B], "중복 단계라 걷어냄");
    assert.ok(ops.length > 0);
    for (const op of ops) assert.equal("reason" in op ? op.reason : null, "중복 단계라 걷어냄");
  });
});

describe("여럿을 한 번에 지운다 — ⑦' 붙은 선 모으기", () => {
  test("🔴 **겹치는 선은 한 번만** 나온다 — 수를 세는 데 쓰면 거짓이 된다", () => {
    assert.deepEqual(findEdgesAttachedToNodes(GRAPH, [NODE_A, NODE_B]), [EDGE_AB, EDGE_BC, EDGE_CA]);
    assert.deepEqual(findEdgesAttachedToNodes(GRAPH, [NODE_A]), findEdgesAttachedToNode(GRAPH, NODE_A), "하나면 단수와 같은 답이어야 한다");
  });

  test("🔵 차례는 **받은 목록 그대로**다 — 그림이 그린 차례와 같아야 한다", () => {
    const reversed = [...GRAPH].reverse();
    assert.deepEqual(findEdgesAttachedToNodes(reversed, [NODE_B]), [EDGE_BC, EDGE_AB]);
  });

  test("🔵 빈 목록이면 빈 답이고, 상관없는 노드는 아무것도 안 집어 온다", () => {
    assert.deepEqual(findEdgesAttachedToNodes(GRAPH, []), []);
    assert.deepEqual(findEdgesAttachedToNodes(GRAPH, ["44444444-4444-4444-8444-444444444444"]), []);
  });
});

/**
 * ============================================================================
 * ⑧🔴 **막혔는지 가르는 잣대는 한 벌**이다 (2026-11-21, 조각 B3)
 * ============================================================================
 * 2026-11-21 까지 이 판정은 편집기 화면 안에 손으로 적혀 있었다(고른 노드 하나만
 * 보면 됐다). [범위 선택]으로 고른 여럿을 지우면서 **묻는 자리가 둘**이 됐고,
 * 두 벌이 되면 「패널이 지울 수 있다고 말한 노드를 복수가 빼거나 그 반대」가 된다 —
 * 그때 오류는 한 번도 안 난다.
 */
describe("막힌 노드 — ⑧ 잣대 한 벌", () => {
  test("🔵 먼저 표본 — **안 막힌 노드는 null** 이다(아래 「막는다」가 공짜로 통과하지 않게)", () => {
    assert.equal(resolveProcedureNodeDeleteBlockedReason({ hasChecklistContent: false, hasTroubleshootingContent: false }), null);
  });

  test("🔴 체크리스트가 걸렸으면 막는다", () => {
    assert.equal(
      resolveProcedureNodeDeleteBlockedReason({ hasChecklistContent: true, hasTroubleshootingContent: false }),
      PROCEDURE_NODE_DELETE_BLOCKED_BY_CONTENT
    );
  });

  test("🔴 고장 진단표가 걸렸어도 막는다 — **둘 중 하나라도**다", () => {
    assert.equal(
      resolveProcedureNodeDeleteBlockedReason({ hasChecklistContent: false, hasTroubleshootingContent: true }),
      PROCEDURE_NODE_DELETE_BLOCKED_BY_CONTENT
    );
    assert.equal(
      resolveProcedureNodeDeleteBlockedReason({ hasChecklistContent: true, hasTroubleshootingContent: true }),
      PROCEDURE_NODE_DELETE_BLOCKED_BY_CONTENT
    );
  });

  test("🔵 고른 것이 없으면(null) 막을 것도 없다 — 화면이 selectedNode 를 그대로 넘긴다", () => {
    assert.equal(resolveProcedureNodeDeleteBlockedReason(null), null);
  });

  test("🔴 **글자가 화면이 쓰던 그것 그대로**다 — 바꾸면 패널의 빨간 줄과 키의 답이 함께 바뀐다", () => {
    // 🔴 이 글자는 사람이 읽는 유일한 까닭이다(이 편집기에는 상시 안내가 없다).
    assert.equal(PROCEDURE_NODE_DELETE_BLOCKED_BY_CONTENT, "체크리스트 또는 고장 진단표 내용이 연결되어 있어 삭제할 수 없습니다.");
    // 🔵 **선은 이제 막는 조건이 아니다**(2026-11-21 — 붙은 선은 함께 지워진다).
    assert.ok(!PROCEDURE_NODE_DELETE_BLOCKED_BY_CONTENT.includes("연결선"), "없어진 막음의 글자가 돌아왔다");
  });
});
