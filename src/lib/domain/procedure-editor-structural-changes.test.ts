import { test } from "node:test";
import assert from "node:assert/strict";
import {
  TEMP_ID_PREFIX,
  TEMP_NODE_ID_PREFIX,
  TEMP_EDGE_ID_PREFIX,
  makeTempNodeId,
  makeTempEdgeId,
  isTempId,
  isTempNodeId,
  isTempEdgeId,
  createTempIdMinter,
  coalescePendingStructuralOperations,
  canSendStructuralChanges,
  planProcedureStructuralSteps,
  PROCEDURE_STRUCTURAL_PHASE_ORDER,
  findUnresolvedTempIds,
  collectResolvedStructuralIds,
  applyResolvedStructuralIds,
  type PendingStructuralOperation,
  type ProcedureStructuralOperationKind,
} from "./procedure-editor-structural-changes";

/**
 * 「기술 작업 절차」 편집기 — 구조 변경을 모아 두었다가 [저장] 때 보내기 위한
 * 순수 판정의 시험(2026-11-20, 조각 1). React 도 서버 액션도 DB 도 안 부른다.
 *
 * ── 🔴 여기서 가장 조용히 깨질 수 있는 것 ──────────────────────────────
 * ① **임시 id 가 진짜 id 자리로 새 나가는 것.** 두 칸 모두 그냥 `string` 이라
 *    tsc 가 한마디도 안 한다. 서버 액션의 isValidUuid 가 막아 주기는 하지만
 *    그건 사용자에게 FORBIDDEN 이 보인다는 뜻이다. 그래서 아래 ①절은 **서버와
 *    같은 정규식**을 그대로 옮겨 적어 두고 양쪽으로 잰다 — 「임시가 UUID 로
 *    읽히나」와 「진짜가 임시로 읽히나」 둘 다.
 * ② **접기가 너무 많이 접는 것.** 「이미 서버에 있는 노드를 지운 것」까지
 *    접히면 사용자가 지운 노드가 화면에서만 사라지고 새로고침하면 되살아난다.
 *    ②절은 접히는 쪽뿐 아니라 **안 접혀야 하는 쪽**을 같은 수만큼 잰다.
 * ③ **표본이 비어 공짜로 통과하는 것.** 접기 시험은 결과 목록이 비면 거의 전부
 *    통과한다. 그래서 어느 단언이든 **남은 것이 무엇인지**를 먼저 적는다
 *    (길이와 내용을 함께 본다).
 * ④ **치환에서 칸 하나를 빠뜨리는 것.** 특히 INSERT_NODE_ON_EDGE 는 id 를 둘
 *    돌려준다. ④절은 일부러 하나만 모아 보고 보내기 직전 관문이 우는지를 잰다.
 */

// ==================== 밑자락 ====================

/** 서버 액션의 첫 관문(src/lib/validation/*.ts 의 isValidUuid)과 **같은 글자**다. 여기 한 벌 더 적은 까닭은 머리말 ① 참고. */
const SERVER_UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** 진짜 id 표본. 서버의 randomUUID() 가 내주는 것과 같은 모양이면 되고, 실제 데이터와는 아무 상관이 없다. */
const REAL_NODE_A = "11111111-1111-4111-8111-111111111111";
const REAL_NODE_B = "22222222-2222-4222-8222-222222222222";
const REAL_NODE_C = "33333333-3333-4333-8333-333333333333";
const REAL_EDGE_1 = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const REAL_EDGE_2 = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

function createNode(tempNodeId: string, overrides: Partial<Extract<PendingStructuralOperation, { kind: "CREATE_NODE" }>> = {}): PendingStructuralOperation {
  return { kind: "CREATE_NODE", tempNodeId, nodeType: "TASK", title: "새 작업", position: null, ...overrides };
}
function deleteNode(nodeId: string): PendingStructuralOperation {
  return { kind: "DELETE_NODE", nodeId, reason: null };
}
function changeNodeType(nodeId: string, newNodeType: Extract<PendingStructuralOperation, { kind: "CHANGE_NODE_TYPE" }>["newNodeType"]): PendingStructuralOperation {
  return { kind: "CHANGE_NODE_TYPE", nodeId, newNodeType, reason: null };
}
function createEdge(tempEdgeId: string, fromNodeId: string, toNodeId: string): PendingStructuralOperation {
  return { kind: "CREATE_EDGE", tempEdgeId, fromNodeId, toNodeId, branchType: "DEFAULT", branchLabel: null, reason: null };
}
function deleteEdge(edgeId: string): PendingStructuralOperation {
  return { kind: "DELETE_EDGE", edgeId, reason: null };
}
function retargetEdge(edgeId: string, newFromNodeId: string, newToNodeId: string): PendingStructuralOperation {
  return { kind: "RETARGET_EDGE", edgeId, newFromNodeId, newToNodeId, reason: null };
}
function insertOnEdge(edgeId: string, tempNodeId: string, tempSecondEdgeId: string): PendingStructuralOperation {
  return { kind: "INSERT_NODE_ON_EDGE", edgeId, tempNodeId, tempSecondEdgeId, nodeType: "INSPECTION", title: "끼워 넣은 검사", position: { x: 10, y: 20 } };
}

const kindsOf = (ops: readonly PendingStructuralOperation[]) => ops.map((op) => op.kind);
const dropReasons = (result: ReturnType<typeof coalescePendingStructuralOperations>) => result.dropped.map((d) => `${d.operation.kind}:${d.reason}`);
const conflictReasons = (result: ReturnType<typeof coalescePendingStructuralOperations>) => result.conflicts.map((c) => `${c.operation.kind}:${c.reason}`);

// ==================== ① 임시 번호(temp id) ====================

test("임시 id: 노드용·연결선용이 각자의 머리글자를 달고 나온다", () => {
  assert.equal(makeTempNodeId(1), "tmp:node:1");
  assert.equal(makeTempEdgeId(7), "tmp:edge:7");
  assert.ok(makeTempNodeId(1).startsWith(TEMP_NODE_ID_PREFIX));
  assert.ok(makeTempEdgeId(7).startsWith(TEMP_EDGE_ID_PREFIX));
  assert.ok(TEMP_NODE_ID_PREFIX.startsWith(TEMP_ID_PREFIX) && TEMP_EDGE_ID_PREFIX.startsWith(TEMP_ID_PREFIX));
});

test("🔴 임시 id: 노드용과 연결선용은 서로로 읽히지 않는다", () => {
  const node = makeTempNodeId(3);
  const edge = makeTempEdgeId(3);
  assert.notEqual(node, edge); // 같은 번호인데 글자가 달라야 한다 — 표본이 헛돌지 않는다는 증거
  assert.equal(isTempNodeId(node), true);
  assert.equal(isTempEdgeId(node), false);
  assert.equal(isTempEdgeId(edge), true);
  assert.equal(isTempNodeId(edge), false);
  assert.equal(isTempId(node) && isTempId(edge), true);
});

test("🔴 임시 id: UUID 로는 절대 읽히지 않는다 — 서버의 그 정규식으로 잰다", () => {
  const samples = [makeTempNodeId(0), makeTempNodeId(1), makeTempNodeId(999999), makeTempEdgeId(0), makeTempEdgeId(42), TEMP_ID_PREFIX];
  assert.equal(samples.length, 6); // 표본이 비어 공짜로 통과하지 않게
  for (const sample of samples) {
    assert.equal(SERVER_UUID_PATTERN.test(sample), false, `${sample} 가 UUID 로 읽힌다 — 서버에 그대로 날아갈 수 있다`);
  }
});

test("🔴 임시 id: 진짜 UUID 는 어느 쪽으로도 임시로 읽히지 않는다", () => {
  const reals = [REAL_NODE_A, REAL_NODE_B, REAL_NODE_C, REAL_EDGE_1, REAL_EDGE_2];
  assert.equal(reals.length, 5);
  for (const real of reals) {
    assert.equal(SERVER_UUID_PATTERN.test(real), true, "표본부터 UUID 가 아니면 이 시험은 아무것도 재지 않는다");
    assert.equal(isTempId(real), false);
    assert.equal(isTempNodeId(real), false);
    assert.equal(isTempEdgeId(real), false);
  }
});

test("🔴 임시 id 도장: 같은 번호를 두 번 내주지 않고, 노드와 연결선은 따로 센다", () => {
  const minter = createTempIdMinter();
  const nodes = [minter.nextNodeId(), minter.nextNodeId(), minter.nextNodeId()];
  const edges = [minter.nextEdgeId(), minter.nextEdgeId()];
  assert.equal(new Set([...nodes, ...edges]).size, 5);
  assert.deepEqual(nodes, ["tmp:node:1", "tmp:node:2", "tmp:node:3"]);
  assert.deepEqual(edges, ["tmp:edge:1", "tmp:edge:2"]);

  // 도장이 둘이면 번호가 겹친다 — 화면은 세션당 하나만 만들어야 한다는 뜻이다.
  const second = createTempIdMinter();
  assert.equal(second.nextNodeId(), nodes[0]);
  // 이어 쓰고 싶으면 시작 번호를 준다.
  const resumed = createTempIdMinter(10);
  assert.equal(resumed.nextNodeId(), "tmp:node:10");
});

// ==================== ② 겹치는 것 접기 ====================

test("접기: 건드릴 것이 없으면 들어온 그대로 전부 남는다", () => {
  const ops = [createNode("tmp:node:1"), deleteEdge(REAL_EDGE_1), changeNodeType(REAL_NODE_A, "DECISION")];
  const result = coalescePendingStructuralOperations(ops);
  assert.deepEqual(kindsOf(result.operations), ["CREATE_NODE", "DELETE_EDGE", "CHANGE_NODE_TYPE"]);
  assert.deepEqual(result.dropped, []);
  assert.deepEqual(result.conflicts, []);
  assert.equal(canSendStructuralChanges(result), true);
});

test("접기: 빈 목록은 빈 결과", () => {
  const result = coalescePendingStructuralOperations([]);
  assert.deepEqual(result.operations, []);
  assert.deepEqual(result.dropped, []);
  assert.deepEqual(result.conflicts, []);
});

test("🔴 접기 1: 저장 전에 만들었다가 지운 임시 노드는 **둘 다** 사라진다", () => {
  const temp = makeTempNodeId(1);
  const result = coalescePendingStructuralOperations([createNode(temp), deleteNode(temp)]);
  assert.deepEqual(kindsOf(result.operations), [], "서버에 보낼 것이 하나도 없어야 한다");
  assert.deepEqual(dropReasons(result), ["CREATE_NODE:CREATED_THEN_DELETED", "DELETE_NODE:CREATED_THEN_DELETED"]);
  assert.deepEqual(result.conflicts, []);
});

test("🔴 접기 2: 사라진 임시 노드에 걸린 임시 연결선도 함께 사라진다 — 전이적으로", () => {
  const n = makeTempNodeId(1);
  const e = makeTempEdgeId(1);
  const result = coalescePendingStructuralOperations([
    createNode(n),
    createEdge(e, REAL_NODE_A, n), // 진짜 노드 → 임시 노드
    retargetEdge(e, REAL_NODE_B, n), // 그 임시 연결선을 한 번 더 옮겼다
    deleteNode(n),
  ]);
  assert.deepEqual(kindsOf(result.operations), []);
  assert.equal(result.dropped.length, 4, "넷이 전부 사라져야 한다");
  assert.deepEqual(new Set(result.dropped.map((d) => d.operation.kind)), new Set(["CREATE_NODE", "CREATE_EDGE", "RETARGET_EDGE", "DELETE_NODE"]));
  assert.deepEqual(result.conflicts, []);
});

test("🔴 접기 3: 저장 전에 만들었다가 지운 임시 연결선은 둘 다 사라진다", () => {
  const e = makeTempEdgeId(1);
  const result = coalescePendingStructuralOperations([createEdge(e, REAL_NODE_A, REAL_NODE_B), deleteEdge(e)]);
  assert.deepEqual(kindsOf(result.operations), []);
  assert.deepEqual(dropReasons(result), ["CREATE_EDGE:CREATED_THEN_DELETED", "DELETE_EDGE:CREATED_THEN_DELETED"]);
});

test("🔴 접으면 안 되는 것: 이미 서버에 있는 노드·연결선을 지운 것은 그대로 보낸다", () => {
  const result = coalescePendingStructuralOperations([deleteEdge(REAL_EDGE_1), deleteNode(REAL_NODE_A)]);
  assert.deepEqual(kindsOf(result.operations), ["DELETE_EDGE", "DELETE_NODE"]);
  assert.deepEqual(result.operations[1], deleteNode(REAL_NODE_A), "지우는 조작이 칸 하나 안 바뀌고 그대로 나가야 한다");
  assert.deepEqual(result.dropped, []);
});

test("🔴 접기 4: 임시 노드의 유형 변경은 그 노드의 CREATE_NODE 칸으로 접힌다", () => {
  const n = makeTempNodeId(1);
  const result = coalescePendingStructuralOperations([createNode(n, { nodeType: "TASK" }), changeNodeType(n, "DECISION")]);
  assert.deepEqual(kindsOf(result.operations), ["CREATE_NODE"], "왕복이 한 번으로 줄어야 한다");
  const created = result.operations[0];
  assert.equal(created.kind, "CREATE_NODE");
  assert.equal(created.kind === "CREATE_NODE" && created.nodeType, "DECISION");
  assert.deepEqual(dropReasons(result), ["CHANGE_NODE_TYPE:FOLDED_INTO_CREATE"]);
});

test("🔴 접기 5: 임시 연결선의 재연결은 그 연결선의 CREATE_EDGE 칸으로 접힌다", () => {
  const e = makeTempEdgeId(1);
  const result = coalescePendingStructuralOperations([createEdge(e, REAL_NODE_A, REAL_NODE_B), retargetEdge(e, REAL_NODE_A, REAL_NODE_C)]);
  assert.deepEqual(kindsOf(result.operations), ["CREATE_EDGE"]);
  const created = result.operations[0];
  assert.equal(created.kind === "CREATE_EDGE" && created.fromNodeId, REAL_NODE_A);
  assert.equal(created.kind === "CREATE_EDGE" && created.toNodeId, REAL_NODE_C, "마지막 대상이 만들기 칸에 들어가야 한다");
  assert.deepEqual(dropReasons(result), ["RETARGET_EDGE:FOLDED_INTO_CREATE"]);
});

test("🔴 접기 6: 같은 노드의 유형을 두 번 바꾸면 마지막 것만 남는다", () => {
  const result = coalescePendingStructuralOperations([
    changeNodeType(REAL_NODE_A, "DECISION"),
    changeNodeType(REAL_NODE_A, "INSPECTION"),
    changeNodeType(REAL_NODE_B, "TASK"), // 🔵 다른 노드는 안 건드려야 한다
  ]);
  assert.equal(result.operations.length, 2);
  const forA = result.operations.find((op) => op.kind === "CHANGE_NODE_TYPE" && op.nodeId === REAL_NODE_A);
  assert.equal(forA?.kind === "CHANGE_NODE_TYPE" && forA.newNodeType, "INSPECTION");
  const forB = result.operations.find((op) => op.kind === "CHANGE_NODE_TYPE" && op.nodeId === REAL_NODE_B);
  assert.equal(forB?.kind === "CHANGE_NODE_TYPE" && forB.newNodeType, "TASK");
  assert.deepEqual(dropReasons(result), ["CHANGE_NODE_TYPE:SUPERSEDED_BY_LATER"]);
});

test("🔴 접기 7: 같은 연결선을 두 번 재연결하면 마지막 것만", () => {
  const result = coalescePendingStructuralOperations([
    retargetEdge(REAL_EDGE_1, REAL_NODE_A, REAL_NODE_B),
    retargetEdge(REAL_EDGE_1, REAL_NODE_A, REAL_NODE_C),
    retargetEdge(REAL_EDGE_2, REAL_NODE_B, REAL_NODE_C),
  ]);
  assert.equal(result.operations.length, 2);
  const forEdge1 = result.operations.find((op) => op.kind === "RETARGET_EDGE" && op.edgeId === REAL_EDGE_1);
  assert.equal(forEdge1?.kind === "RETARGET_EDGE" && forEdge1.newToNodeId, REAL_NODE_C);
  assert.deepEqual(dropReasons(result), ["RETARGET_EDGE:SUPERSEDED_BY_LATER"]);
});

test("접기 8: 같은 저장에서 지워질 노드·연결선에 대한 유형 변경·재연결은 버린다", () => {
  const result = coalescePendingStructuralOperations([
    changeNodeType(REAL_NODE_A, "DECISION"),
    deleteNode(REAL_NODE_A),
    retargetEdge(REAL_EDGE_1, REAL_NODE_B, REAL_NODE_C),
    deleteEdge(REAL_EDGE_1),
  ]);
  assert.deepEqual(kindsOf(result.operations), ["DELETE_NODE", "DELETE_EDGE"]);
  assert.deepEqual(dropReasons(result).sort(), ["CHANGE_NODE_TYPE:TARGET_DELETED_IN_SAME_SAVE", "RETARGET_EDGE:TARGET_DELETED_IN_SAME_SAVE"]);
});

test("접기 9: 같은 것을 두 번 지우라는 줄은 하나로 접힌다", () => {
  const result = coalescePendingStructuralOperations([deleteNode(REAL_NODE_A), deleteNode(REAL_NODE_A), deleteEdge(REAL_EDGE_1), deleteEdge(REAL_EDGE_1)]);
  assert.deepEqual(kindsOf(result.operations), ["DELETE_NODE", "DELETE_EDGE"]);
  assert.deepEqual(dropReasons(result), ["DELETE_NODE:DUPLICATE_DELETE", "DELETE_EDGE:DUPLICATE_DELETE"]);
});

test("🔴 접기: 삽입이 만든 임시 노드를 지우면 **삽입 전체**가 사라진다 — 아직 아무것도 안 보냈으므로 원래 연결선이 그대로다", () => {
  const n = makeTempNodeId(1);
  const e2 = makeTempEdgeId(1);
  const result = coalescePendingStructuralOperations([insertOnEdge(REAL_EDGE_1, n, e2), deleteNode(n)]);
  assert.deepEqual(kindsOf(result.operations), []);
  assert.deepEqual(dropReasons(result), ["INSERT_NODE_ON_EDGE:CREATED_THEN_DELETED", "DELETE_NODE:CREATED_THEN_DELETED"]);
  assert.deepEqual(result.conflicts, []);
});

test("🔴 접기: 삽입의 **둘째 연결선만** 지운 것은 접지 않는다 — 쪼갤 수 없는 조작이라 보내고 나서 지운다", () => {
  const n = makeTempNodeId(1);
  const e2 = makeTempEdgeId(1);
  const result = coalescePendingStructuralOperations([insertOnEdge(REAL_EDGE_1, n, e2), deleteEdge(e2)]);
  assert.deepEqual(kindsOf(result.operations), ["INSERT_NODE_ON_EDGE", "DELETE_EDGE"], "둘 다 남아야 한다");
  assert.deepEqual(result.dropped, []);
  // 🔴 차례가 뒤집히면 「없는 연결선 지우기」가 된다 — 삽입이 먼저여야 한다.
  assert.deepEqual(kindsOf(planProcedureStructuralSteps(result.operations)), ["INSERT_NODE_ON_EDGE", "DELETE_EDGE"]);
});

test("🔴 소리를 내야 하는 것: 만든 적 없는 임시 id 는 조용히 버리지 않는다", () => {
  const result = coalescePendingStructuralOperations([deleteNode("tmp:node:77"), createEdge(makeTempEdgeId(1), REAL_NODE_A, "tmp:node:88")]);
  assert.deepEqual(kindsOf(result.operations), []);
  assert.deepEqual(result.dropped, [], "버린 것이 아니라 막은 것이다");
  assert.deepEqual(conflictReasons(result), ["DELETE_NODE:DANGLING_TEMP_ID", "CREATE_EDGE:DANGLING_TEMP_ID"]);
  assert.equal(canSendStructuralChanges(result), false);
});

test("🔴 소리를 내야 하는 것: 같은 저장에서 지워질 노드에 선을 긋거나 선을 옮기면 막는다", () => {
  const result = coalescePendingStructuralOperations([
    createEdge(makeTempEdgeId(1), REAL_NODE_A, REAL_NODE_B),
    retargetEdge(REAL_EDGE_1, REAL_NODE_C, REAL_NODE_B),
    deleteNode(REAL_NODE_B),
  ]);
  assert.deepEqual(kindsOf(result.operations), ["DELETE_NODE"]);
  assert.deepEqual(conflictReasons(result), ["CREATE_EDGE:ENDPOINT_DELETED_IN_SAME_SAVE", "RETARGET_EDGE:ENDPOINT_DELETED_IN_SAME_SAVE"]);
  assert.equal(canSendStructuralChanges(result), false);
});

test("🔴 소리를 내야 하는 것: 아직 저장 안 된 연결선 위에는 노드를 삽입할 수 없다", () => {
  const e = makeTempEdgeId(1);
  const result = coalescePendingStructuralOperations([createEdge(e, REAL_NODE_A, REAL_NODE_B), insertOnEdge(e, makeTempNodeId(1), makeTempEdgeId(2))]);
  assert.deepEqual(kindsOf(result.operations), ["CREATE_EDGE"]);
  assert.deepEqual(conflictReasons(result), ["INSERT_NODE_ON_EDGE:INSERT_ON_UNSAVED_EDGE"]);
  assert.equal(canSendStructuralChanges(result), false);
});

test("🔴 소리를 내야 하는 것: 아직 안 만든 노드를 「새로 만들 수 없는 유형」으로 바꾸면 막는다", () => {
  const n = makeTempNodeId(1);
  const result = coalescePendingStructuralOperations([createNode(n), changeNodeType(n, "CHECKLIST")]);
  assert.deepEqual(kindsOf(result.operations), ["CREATE_NODE"]);
  assert.equal(result.operations[0].kind === "CREATE_NODE" && result.operations[0].nodeType, "TASK", "접히면 안 된다 — 만들 수 없는 유형이다");
  assert.deepEqual(conflictReasons(result), ["CHANGE_NODE_TYPE:TEMP_NODE_TYPE_NOT_CREATABLE"]);
  // 🔵 반대쪽: 만들 수 있는 유형이면 막지 않고 접는다(접기 4와 같은 길).
  const ok = coalescePendingStructuralOperations([createNode(n), changeNodeType(n, "CORRECTIVE_ACTION")]);
  assert.deepEqual(ok.conflicts, []);
  assert.equal(ok.operations[0].kind === "CREATE_NODE" && ok.operations[0].nodeType, "CORRECTIVE_ACTION");
});

test("🔴 접기는 들어온 목록도 그 안의 객체도 건드리지 않는다", () => {
  const n = makeTempNodeId(1);
  const ops: PendingStructuralOperation[] = [createNode(n, { nodeType: "TASK" }), changeNodeType(n, "DECISION")];
  const before = JSON.parse(JSON.stringify(ops));
  const result = coalescePendingStructuralOperations(ops);
  assert.equal(result.operations[0].kind === "CREATE_NODE" && result.operations[0].nodeType, "DECISION", "결과는 접혀 있어야 하고");
  assert.deepEqual(JSON.parse(JSON.stringify(ops)), before, "들어온 쪽은 한 글자도 안 바뀌어야 한다");
});

// ==================== ③ 보낼 차례 세우기 ====================

test("차례: 일곱 갈래가 정해진 순서로 선다", () => {
  const steps = planProcedureStructuralSteps([
    deleteNode(REAL_NODE_A),
    createEdge(makeTempEdgeId(1), REAL_NODE_B, REAL_NODE_C),
    retargetEdge(REAL_EDGE_1, REAL_NODE_B, REAL_NODE_C),
    deleteEdge(REAL_EDGE_2),
    changeNodeType(REAL_NODE_B, "DECISION"),
    insertOnEdge(REAL_EDGE_1, makeTempNodeId(2), makeTempEdgeId(2)),
    createNode(makeTempNodeId(1)),
  ]);
  assert.deepEqual(kindsOf(steps), [...PROCEDURE_STRUCTURAL_PHASE_ORDER]);
  assert.equal(PROCEDURE_STRUCTURAL_PHASE_ORDER.length, 7, "갈래가 늘면 이 시험부터 고쳐야 한다");
});

test("🔴 차례: 노드 만들기가 연결선 만들기보다 앞 — 없는 노드에 선을 그을 수 없다", () => {
  const n = makeTempNodeId(1);
  const steps = planProcedureStructuralSteps([createEdge(makeTempEdgeId(1), REAL_NODE_A, n), createNode(n)]);
  assert.deepEqual(kindsOf(steps), ["CREATE_NODE", "CREATE_EDGE"]);
});

test("🔴 차례: 연결선 지우기·재연결이 노드 지우기보다 앞 — 선이 붙은 노드는 못 지운다", () => {
  const steps = planProcedureStructuralSteps([deleteNode(REAL_NODE_A), deleteEdge(REAL_EDGE_1), retargetEdge(REAL_EDGE_2, REAL_NODE_B, REAL_NODE_C)]);
  assert.deepEqual(kindsOf(steps), ["DELETE_EDGE", "RETARGET_EDGE", "DELETE_NODE"]);
});

test("🔴 차례: 연결선 지우기가 연결선 만들기보다 앞 — 같은 A→B 를 지우고 다시 긋는 조작이 중복으로 거절되면 안 된다", () => {
  const steps = planProcedureStructuralSteps([createEdge(makeTempEdgeId(1), REAL_NODE_A, REAL_NODE_B), deleteEdge(REAL_EDGE_1)]);
  assert.deepEqual(kindsOf(steps), ["DELETE_EDGE", "CREATE_EDGE"]);
});

test("차례: 같은 갈래 안에서는 사용자가 한 순서 그대로다", () => {
  const first = makeTempNodeId(1);
  const second = makeTempNodeId(2);
  const third = makeTempNodeId(3);
  const steps = planProcedureStructuralSteps([createNode(third), createNode(first), createNode(second)]);
  assert.deepEqual(
    steps.map((op) => (op.kind === "CREATE_NODE" ? op.tempNodeId : "")),
    [third, first, second]
  );
});

// ==================== ④ 임시 id → 진짜 id 치환 ====================

test("보내기 직전 관문: 갈래마다 「진짜여야 하는 칸」만 센다", () => {
  const n = makeTempNodeId(1);
  const e = makeTempEdgeId(1);
  // 🔴 CREATE_NODE 의 tempNodeId 는 서버에 안 간다 — 세면 멀쩡한 계획이 막힌다.
  assert.deepEqual(findUnresolvedTempIds(createNode(n)), []);
  assert.deepEqual(findUnresolvedTempIds(deleteNode(n)), [n]);
  assert.deepEqual(findUnresolvedTempIds(changeNodeType(n, "DECISION")), [n]);
  assert.deepEqual(findUnresolvedTempIds(createEdge(e, n, REAL_NODE_A)), [n], "tempEdgeId 는 안 세고 양 끝만 센다");
  assert.deepEqual(findUnresolvedTempIds(deleteEdge(e)), [e]);
  assert.deepEqual(findUnresolvedTempIds(retargetEdge(e, n, REAL_NODE_A)), [e, n]);
  assert.deepEqual(findUnresolvedTempIds(insertOnEdge(e, n, makeTempEdgeId(2))), [e], "삽입은 쪼갤 연결선만 진짜여야 한다");
});

test("보내기 직전 관문: 진짜 id 만 든 조작은 통과한다", () => {
  const ops = [
    createNode(makeTempNodeId(1)),
    deleteNode(REAL_NODE_A),
    changeNodeType(REAL_NODE_A, "DECISION"),
    createEdge(makeTempEdgeId(1), REAL_NODE_A, REAL_NODE_B),
    deleteEdge(REAL_EDGE_1),
    retargetEdge(REAL_EDGE_1, REAL_NODE_A, REAL_NODE_B),
    insertOnEdge(REAL_EDGE_1, makeTempNodeId(2), makeTempEdgeId(2)),
  ];
  assert.equal(ops.length, 7, "일곱 갈래를 전부 재고 있다");
  for (const op of ops) assert.deepEqual(findUnresolvedTempIds(op), [], `${op.kind} 가 공연히 막힌다`);
});

test("치환: 모든 id 칸이 갈아 끼워진다 — 화면 쪽 이름(temp*)까지", () => {
  const n = makeTempNodeId(1);
  const e = makeTempEdgeId(1);
  const e2 = makeTempEdgeId(2);
  const resolved = new Map([
    [n, REAL_NODE_C],
    [e, REAL_EDGE_1],
    [e2, REAL_EDGE_2],
  ]);
  const swapped = applyResolvedStructuralIds(
    [createNode(n), deleteNode(n), changeNodeType(n, "DECISION"), createEdge(e, n, REAL_NODE_A), deleteEdge(e), retargetEdge(e, n, REAL_NODE_A), insertOnEdge(e, n, e2)],
    resolved
  );
  assert.equal(swapped.length, 7);
  assert.equal(swapped[0].kind === "CREATE_NODE" && swapped[0].tempNodeId, REAL_NODE_C);
  assert.equal(swapped[1].kind === "DELETE_NODE" && swapped[1].nodeId, REAL_NODE_C);
  assert.equal(swapped[2].kind === "CHANGE_NODE_TYPE" && swapped[2].nodeId, REAL_NODE_C);
  assert.equal(swapped[3].kind === "CREATE_EDGE" && swapped[3].tempEdgeId, REAL_EDGE_1);
  assert.equal(swapped[3].kind === "CREATE_EDGE" && swapped[3].fromNodeId, REAL_NODE_C);
  assert.equal(swapped[4].kind === "DELETE_EDGE" && swapped[4].edgeId, REAL_EDGE_1);
  assert.equal(swapped[5].kind === "RETARGET_EDGE" && swapped[5].edgeId, REAL_EDGE_1);
  assert.equal(swapped[5].kind === "RETARGET_EDGE" && swapped[5].newFromNodeId, REAL_NODE_C);
  assert.equal(swapped[6].kind === "INSERT_NODE_ON_EDGE" && swapped[6].edgeId, REAL_EDGE_1);
  assert.equal(swapped[6].kind === "INSERT_NODE_ON_EDGE" && swapped[6].tempNodeId, REAL_NODE_C);
  assert.equal(swapped[6].kind === "INSERT_NODE_ON_EDGE" && swapped[6].tempSecondEdgeId, REAL_EDGE_2);
  // 🔵 치환 뒤에는 어디에도 임시 id 가 안 남아야 한다.
  for (const op of swapped) assert.deepEqual(findUnresolvedTempIds(op), []);
});

test("치환: 짝표에 없는 id 와 빈 짝표는 아무것도 안 바꾼다", () => {
  const ops = [createEdge(makeTempEdgeId(1), REAL_NODE_A, REAL_NODE_B)];
  assert.deepEqual(applyResolvedStructuralIds(ops, new Map()), ops);
  assert.deepEqual(applyResolvedStructuralIds(ops, new Map([["tmp:node:99", REAL_NODE_C]])), ops);
});

test("🔴 치환 짝표: 삽입은 id 를 **둘** 돌려준다", () => {
  const n = makeTempNodeId(1);
  const e2 = makeTempEdgeId(1);
  const resolved = collectResolvedStructuralIds(insertOnEdge(REAL_EDGE_1, n, e2), { nodeId: REAL_NODE_C, secondEdgeId: REAL_EDGE_2 });
  assert.equal(resolved.size, 2);
  assert.equal(resolved.get(n), REAL_NODE_C);
  assert.equal(resolved.get(e2), REAL_EDGE_2);

  assert.deepEqual([...collectResolvedStructuralIds(createNode(n), { nodeId: REAL_NODE_C })], [[n, REAL_NODE_C]]);
  assert.deepEqual([...collectResolvedStructuralIds(createEdge(e2, REAL_NODE_A, REAL_NODE_B), { edgeId: REAL_EDGE_2 })], [[e2, REAL_EDGE_2]]);
  assert.equal(collectResolvedStructuralIds(deleteNode(REAL_NODE_A), { nodeId: REAL_NODE_C }).size, 0, "만들지 않는 조작은 돌려줄 id 가 없다");
});

test("🔴 치환 짝표에서 secondEdgeId 를 빠뜨리면 보내기 직전 관문이 운다", () => {
  const n = makeTempNodeId(1);
  const e2 = makeTempEdgeId(1);
  const pending = [insertOnEdge(REAL_EDGE_1, n, e2), deleteEdge(e2)];
  // 일부러 nodeId 만 모은다 — 타입은 둘 다 string 이라 tsc 가 한마디도 안 한다.
  const halfResolved = collectResolvedStructuralIds(pending[0], { nodeId: REAL_NODE_C });
  const after = applyResolvedStructuralIds(pending, halfResolved);
  assert.deepEqual(findUnresolvedTempIds(after[1]), [e2], "빠뜨린 것이 여기서 드러나야 한다");

  const fullyResolved = collectResolvedStructuralIds(pending[0], { nodeId: REAL_NODE_C, secondEdgeId: REAL_EDGE_2 });
  assert.deepEqual(findUnresolvedTempIds(applyResolvedStructuralIds(pending, fullyResolved)[1]), []);
});

// ==================== ⑤ 한 바퀴 — 접기 → 차례 → 치환이 실제로 맞물리는가 ====================

test("🔴 한 바퀴: 세운 차례대로 보내면 어느 걸음에서도 임시 id 가 서버로 새 나가지 않는다", () => {
  const minter = createTempIdMinter();
  const newNode = minter.nextNodeId();
  const throwaway = minter.nextNodeId();
  const newEdge = minter.nextEdgeId();
  const throwawayEdge = minter.nextEdgeId();

  // 사람이 화면에서 한 차례 그대로.
  const pending: PendingStructuralOperation[] = [
    createNode(newNode, { nodeType: "TASK", title: "새 작업" }),
    createEdge(newEdge, REAL_NODE_A, newNode), // 진짜 노드 → 방금 만든 노드
    changeNodeType(newNode, "INSPECTION"), // 만들기로 접힌다
    createNode(throwaway), // 만들었다가
    createEdge(throwawayEdge, throwaway, REAL_NODE_B), // 선까지 그었다가
    deleteNode(throwaway), // 통째로 버렸다
    deleteEdge(REAL_EDGE_1), // 서버에 있던 선 하나를 지우고
    deleteNode(REAL_NODE_C), // 그 선에 붙어 있던 노드를 지운다
  ];

  const coalesced = coalescePendingStructuralOperations(pending);
  assert.equal(canSendStructuralChanges(coalesced), true);
  assert.deepEqual(kindsOf(coalesced.operations), ["CREATE_NODE", "CREATE_EDGE", "DELETE_EDGE", "DELETE_NODE"], "여덟이 넷으로 접혀야 한다");
  assert.equal(coalesced.operations[0].kind === "CREATE_NODE" && coalesced.operations[0].nodeType, "INSPECTION");

  const steps = planProcedureStructuralSteps(coalesced.operations);
  assert.deepEqual(kindsOf(steps), ["CREATE_NODE", "DELETE_EDGE", "CREATE_EDGE", "DELETE_NODE"]);

  // 가짜 서버로 한 걸음씩 돌려 본다 — 보내기 직전마다 관문을 통과해야 한다.
  let remaining = steps;
  const sent: string[] = [];
  for (let i = 0; i < remaining.length; i++) {
    const step = remaining[i];
    assert.deepEqual(findUnresolvedTempIds(step), [], `${i}번째 걸음(${step.kind})이 임시 id 를 들고 서버로 간다`);
    sent.push(step.kind);
    const serverIds = step.kind === "CREATE_NODE" ? { nodeId: REAL_NODE_B } : step.kind === "CREATE_EDGE" ? { edgeId: REAL_EDGE_2 } : {};
    const resolved = collectResolvedStructuralIds(step, serverIds);
    if (resolved.size > 0) remaining = [...remaining.slice(0, i + 1), ...applyResolvedStructuralIds(remaining.slice(i + 1), resolved)];
  }
  assert.deepEqual(sent, ["CREATE_NODE", "DELETE_EDGE", "CREATE_EDGE", "DELETE_NODE"], "네 걸음이 전부 돌아야 한다 — 비어 있으면 위 단언들이 공짜로 통과한다");

  // 마지막으로, 새로 그은 선이 **진짜 노드 id** 를 가리키고 있어야 한다.
  const sentEdge = remaining.find((op) => op.kind === "CREATE_EDGE");
  assert.equal(sentEdge?.kind === "CREATE_EDGE" && sentEdge.toNodeId, REAL_NODE_B);
});

test("🔴 한 바퀴: 갈래 일곱이 차례·관문·치환 어디에서도 빠지지 않았다", () => {
  const everyKind: ProcedureStructuralOperationKind[] = [
    "CREATE_NODE",
    "DELETE_NODE",
    "CHANGE_NODE_TYPE",
    "CREATE_EDGE",
    "DELETE_EDGE",
    "RETARGET_EDGE",
    "INSERT_NODE_ON_EDGE",
  ];
  assert.equal(new Set(everyKind).size, 7);
  for (const kind of everyKind) {
    assert.ok(PROCEDURE_STRUCTURAL_PHASE_ORDER.includes(kind), `${kind} 의 차례가 없다 — 정렬에서 맨 앞으로 튄다`);
  }
  assert.deepEqual([...PROCEDURE_STRUCTURAL_PHASE_ORDER].sort(), [...everyKind].sort());
});
