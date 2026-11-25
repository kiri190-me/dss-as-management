import { test } from "node:test";
import assert from "node:assert/strict";
import {
  runProcedureStructuralSequence,
  canProceedToFieldSave,
  collectStructuralIdEffects,
  rebaseDraftMapAfterStructuralSave,
  includeBrandNewDraftEntries,
  includeBrandNewDraftIds,
  type ProcedureStructuralExecutor,
  type ProcedureStructuralStepResult,
} from "./procedure-editor-structural-save";
import {
  coalescePendingStructuralOperations,
  planProcedureStructuralSteps,
  makeTempNodeId,
  makeTempEdgeId,
  type PendingStructuralOperation,
} from "./procedure-editor-structural-changes";
import {
  computeDirtyProcedureNodeFieldEntries,
  computeDirtyProcedurePositionNodeIds,
  type ProcedureNodeFieldDraft,
  type ProcedureServerNodeSnapshot,
  type Position,
} from "./procedure-editor-save-state";

/**
 * 「기술 작업 절차」 편집기 — 모아 둔 구조 변경을 [저장] 한 번에 보내는 길의
 * 시험(2026-11-20, 조각 2). 서버 액션도 DB 도 React 도 안 부른다. 보내는 쪽
 * 함수를 **가짜로 끼워** 「무엇이 어떤 차례로 어떤 값을 들고 나갔는가」를 직접
 * 들여다본다.
 *
 * ── 🔴 여기서 가장 조용히 깨질 수 있는 것 넷 ─────────────────────────────
 * ① **치환을 한 걸음 건너뛰는 것.** 앞 걸음이 받아 온 진짜 id 를 뒤 걸음에
 *    안 먹이면 임시 id 가 그대로 서버로 간다. 타입은 둘 다 `string` 이라 아무
 *    말도 안 한다. 그래서 아래 ②절은 **실행 함수가 실제로 받은 값**을 쌓아 두고
 *    거기서 읽는다 — 「결과가 ok 인가」로는 절대 안 잡힌다.
 * ② **id 를 둘 돌려주는 삽입(INSERT_NODE_ON_EDGE)에서 하나만 거두는 것.**
 *    ②절이 일부러 하나만 돌려주고 관문이 우는지, 그리고 **그 요청이 서버로
 *    안 갔는지**(호출 수)까지 잰다.
 * ③ **부분 실패에서 성공한 것이 「아직 안 보냄」으로 되돌아가는 것.** 다시 보내면
 *    같은 노드가 두 번 만들어진다. ③절이 그 목록을 통째로 맞댄다.
 * ④ **막 생긴 노드의 칸 값이 소리 없이 사라지는 것.** ⑥절이 세는 함수까지
 *    끼워서 끝에서 끝까지 잰다 — 옮기기를 빼면 0건이 되는 것을 **같은 시험
 *    안에서** 먼저 보여 준다(표본이 비어 공짜로 통과하지 않게).
 */

// ==================== 밑자락 ====================

/** 진짜 id 표본. 서버의 randomUUID() 가 내주는 모양이면 되고, 실제 데이터와는 아무 상관이 없다. */
const REAL_NODE_A = "11111111-1111-4111-8111-111111111111";
const REAL_NODE_B = "22222222-2222-4222-8222-222222222222";
const REAL_NODE_C = "33333333-3333-4333-8333-333333333333";
const REAL_EDGE_1 = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const REAL_EDGE_2 = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const REAL_EDGE_3 = "99999999-9999-4999-8999-999999999999";
/** 서버가 이번 저장에서 **새로 찍어 주는** id 표본. */
const MINTED_NODE_1 = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const MINTED_NODE_2 = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const MINTED_EDGE_1 = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
const MINTED_EDGE_2 = "ffffffff-ffff-4fff-8fff-ffffffffffff";

const TMP_NODE_1 = makeTempNodeId(1);
const TMP_NODE_2 = makeTempNodeId(2);
const TMP_EDGE_1 = makeTempEdgeId(1);
const TMP_EDGE_2 = makeTempEdgeId(2);

/** 구조 검증 요약 대역. 이 모듈은 속을 들여다보지 않고 그대로 나르기만 하므로 모양은 아무래도 좋다. */
type FakeValidation = { readonly tag: string };

function createNode(tempNodeId: string, title = "새 작업"): PendingStructuralOperation {
  return { kind: "CREATE_NODE", tempNodeId, nodeType: "TASK", title, position: null };
}
function createEdge(tempEdgeId: string, fromNodeId: string, toNodeId: string): PendingStructuralOperation {
  return { kind: "CREATE_EDGE", tempEdgeId, fromNodeId, toNodeId, branchType: "DEFAULT", branchLabel: null, reason: null };
}
function deleteNode(nodeId: string): PendingStructuralOperation {
  return { kind: "DELETE_NODE", nodeId, reason: null };
}
function deleteEdge(edgeId: string): PendingStructuralOperation {
  return { kind: "DELETE_EDGE", edgeId, reason: null };
}
function retargetEdge(edgeId: string, newFromNodeId: string, newToNodeId: string): PendingStructuralOperation {
  return { kind: "RETARGET_EDGE", edgeId, newFromNodeId, newToNodeId, reason: null };
}
function changeNodeType(nodeId: string): PendingStructuralOperation {
  return { kind: "CHANGE_NODE_TYPE", nodeId, newNodeType: "DECISION", reason: null };
}
function insertOnEdge(edgeId: string, tempNodeId: string, tempSecondEdgeId: string): PendingStructuralOperation {
  return { kind: "INSERT_NODE_ON_EDGE", edgeId, tempNodeId, tempSecondEdgeId, nodeType: "TASK", title: "끼워 넣은 작업", position: { x: 10, y: 20 } };
}

type SpyCall = { operation: PendingStructuralOperation; expectedUpdatedAt: string };

/**
 * 가짜 서버. 🔴 **넘어온 조작을 그대로 쌓아 둔다** — 치환이 걸음마다 새 객체를
 * 만들기 때문에, 여기 쌓인 것이 곧 「그 순간 실제로 보낸 모습」이다.
 */
function spyExecutor<TValidation>(
  respond: (operation: PendingStructuralOperation, stepIndex: number) => ProcedureStructuralStepResult<TValidation>
): { calls: SpyCall[]; execute: ProcedureStructuralExecutor<TValidation> } {
  const calls: SpyCall[] = [];
  const execute: ProcedureStructuralExecutor<TValidation> = async (operation, expectedUpdatedAt) => {
    calls.push({ operation, expectedUpdatedAt });
    return respond(operation, calls.length - 1);
  };
  return { calls, execute };
}

/** 성공 응답 하나 — 그 조작이 실제로 돌려주는 id 칸까지 서버와 같은 모양으로 채운다. */
function ok(operation: PendingStructuralOperation, updatedAt: string, mint: { nodeId?: string; edgeId?: string; secondEdgeId?: string } = {}): ProcedureStructuralStepResult<FakeValidation> {
  switch (operation.kind) {
    case "CREATE_NODE":
      return { ok: true, updatedAt, nodeId: mint.nodeId ?? MINTED_NODE_1 };
    case "CREATE_EDGE":
      return { ok: true, updatedAt, edgeId: mint.edgeId ?? MINTED_EDGE_1 };
    case "INSERT_NODE_ON_EDGE":
      return { ok: true, updatedAt, nodeId: mint.nodeId ?? MINTED_NODE_1, secondEdgeId: mint.secondEdgeId ?? MINTED_EDGE_1 };
    default:
      return { ok: true, updatedAt };
  }
}

// ==================== ① 차례와 토큰 ====================

test("구조 저장: 계획한 차례 그대로 **한 건씩** 보내고 토큰을 이어 넘긴다", async () => {
  const pending: PendingStructuralOperation[] = [
    deleteNode(REAL_NODE_B),
    createNode(TMP_NODE_1),
    deleteEdge(REAL_EDGE_1),
  ];
  // 🔵 무엇을 재는지 먼저 — 세 건 전부 살아남아야 이 시험에 뜻이 있다.
  assert.equal(coalescePendingStructuralOperations(pending).operations.length, 3);

  const spy = spyExecutor<FakeValidation>((operation, step) => ok(operation, `t${step + 1}`));
  const outcome = await runProcedureStructuralSequence(pending, "t0", spy.execute);

  assert.equal(outcome.status, "ALL_SENT");
  assert.equal(canProceedToFieldSave(outcome), true);
  // 차례: 만들기(0) → 연결선 지우기(3) → 노드 지우기(6). 사람이 적은 차례와 다르다.
  assert.deepEqual(
    spy.calls.map((call) => call.operation.kind),
    ["CREATE_NODE", "DELETE_EDGE", "DELETE_NODE"]
  );
  assert.deepEqual(
    spy.calls.map((call) => call.operation.kind),
    planProcedureStructuralSteps(coalescePendingStructuralOperations(pending).operations).map((operation) => operation.kind)
  );
  // 🔴 토큰이 이어진다 — 첫 걸음은 넘긴 값으로, 그 뒤는 앞 걸음이 돌려준 값으로.
  assert.deepEqual(
    spy.calls.map((call) => call.expectedUpdatedAt),
    ["t0", "t1", "t2"]
  );
  assert.equal(outcome.finalUpdatedAt, "t3");
  assert.equal(outcome.succeededOperations.length, 3);
  assert.deepEqual(outcome.remainingOperations, []);
  assert.equal(outcome.failedOperation, null);
  assert.equal(outcome.failureCause, null);
});

test("구조 저장: 보낼 것이 없으면 한 번도 안 부르고 그대로 통과한다(토큰도 그대로)", async () => {
  // 만들었다 지운 임시 노드 — 접기가 둘 다 걷어내 보낼 것이 0건이다.
  const pending = [createNode(TMP_NODE_1), deleteNode(TMP_NODE_1)];
  assert.equal(coalescePendingStructuralOperations(pending).operations.length, 0);

  const spy = spyExecutor<FakeValidation>((operation, step) => ok(operation, `t${step + 1}`));
  const outcome = await runProcedureStructuralSequence(pending, "t0", spy.execute);

  assert.equal(spy.calls.length, 0);
  assert.equal(outcome.status, "ALL_SENT");
  assert.equal(outcome.finalUpdatedAt, "t0");
  assert.equal(outcome.coalesced.dropped.length, 2);
});

// ==================== ② 임시 id 치환 — 걸음마다 ====================

test("🔴 치환: 앞 걸음이 받아 온 진짜 id 를 **뒤 걸음이 들고 나간다**", async () => {
  const pending = [createNode(TMP_NODE_1), createEdge(TMP_EDGE_1, REAL_NODE_A, TMP_NODE_1)];
  // 🔵 무엇을 재는지 먼저 — 보내기 전에는 둘째 조작이 **임시 id 를 들고 있다.**
  const planned = planProcedureStructuralSteps(coalescePendingStructuralOperations(pending).operations);
  const plannedEdge = planned[1];
  assert.equal(plannedEdge.kind === "CREATE_EDGE" && plannedEdge.toNodeId, TMP_NODE_1);

  const spy = spyExecutor<FakeValidation>((operation, step) => ok(operation, `t${step + 1}`, { nodeId: MINTED_NODE_1 }));
  const outcome = await runProcedureStructuralSequence(pending, "t0", spy.execute);

  assert.equal(outcome.status, "ALL_SENT");
  const sentEdge = spy.calls[1].operation;
  assert.equal(sentEdge.kind, "CREATE_EDGE");
  // 🔴 이 줄이 이 시험의 전부다 — 임시 id 가 그대로 나갔으면 서버가 FORBIDDEN 을 낸다.
  assert.equal(sentEdge.kind === "CREATE_EDGE" && sentEdge.toNodeId, MINTED_NODE_1);
  assert.deepEqual([...outcome.resolvedIds], [[TMP_NODE_1, MINTED_NODE_1], [TMP_EDGE_1, MINTED_EDGE_1]]);
});

test("🔴 치환: 삽입이 돌려주는 id **둘**을 모두 거둔다(노드 · 둘째 연결선)", async () => {
  const pending = [
    insertOnEdge(REAL_EDGE_1, TMP_NODE_1, TMP_EDGE_1),
    // 끼워 넣은 노드에서 다른 데로 선을 긋고, 딸려 생긴 둘째 연결선은 지운다.
    createEdge(TMP_EDGE_2, TMP_NODE_1, REAL_NODE_B),
    deleteEdge(TMP_EDGE_1),
  ];
  const spy = spyExecutor<FakeValidation>((operation, step) =>
    ok(operation, `t${step + 1}`, { nodeId: MINTED_NODE_1, secondEdgeId: MINTED_EDGE_1, edgeId: MINTED_EDGE_2 })
  );
  const outcome = await runProcedureStructuralSequence(pending, "t0", spy.execute);

  assert.equal(outcome.status, "ALL_SENT");
  assert.deepEqual(spy.calls.map((call) => call.operation.kind), ["INSERT_NODE_ON_EDGE", "DELETE_EDGE", "CREATE_EDGE"]);
  const sentDelete = spy.calls[1].operation;
  const sentCreate = spy.calls[2].operation;
  // 🔴 둘째 연결선 id 를 안 거뒀으면 여기가 tmp:edge:1 로 남는다.
  assert.equal(sentDelete.kind === "DELETE_EDGE" && sentDelete.edgeId, MINTED_EDGE_1);
  // 🔴 노드 id 쪽.
  assert.equal(sentCreate.kind === "CREATE_EDGE" && sentCreate.fromNodeId, MINTED_NODE_1);
});

test("🔴 치환을 빠뜨리면 **보내기 직전에 운다** — 그 요청은 서버로 가지 않는다", async () => {
  const pending = [
    insertOnEdge(REAL_EDGE_1, TMP_NODE_1, TMP_EDGE_1),
    deleteEdge(TMP_EDGE_1),
  ];
  // 일부러 둘째 연결선 id 를 안 돌려준다(부르는 쪽이 칸 하나를 빠뜨린 모습).
  const spy = spyExecutor<FakeValidation>((operation, step) => {
    if (operation.kind === "INSERT_NODE_ON_EDGE") return { ok: true, updatedAt: `t${step + 1}`, nodeId: MINTED_NODE_1 };
    return ok(operation, `t${step + 1}`);
  });
  const outcome = await runProcedureStructuralSequence(pending, "t0", spy.execute);

  assert.equal(outcome.status, "STOPPED_AT_FAILURE");
  assert.equal(outcome.failureCause, "UNRESOLVED_TEMP_ID");
  assert.equal(canProceedToFieldSave(outcome), false);
  // 🔴 임시 id 를 든 요청이 **서버로 가지 않았다** — 삽입 한 번만 불렸다.
  assert.equal(spy.calls.length, 1);
  assert.ok(outcome.failureMessage?.includes(TMP_EDGE_1), `까닭에 어느 번호인지가 적혀야 한다: ${outcome.failureMessage}`);
  // 삽입은 성공했으므로 되돌리면 안 된다.
  assert.deepEqual(outcome.succeededOperations.map((operation) => operation.kind), ["INSERT_NODE_ON_EDGE"]);
  assert.deepEqual(outcome.remainingOperations.map((operation) => operation.kind), ["DELETE_EDGE"]);
  assert.equal(outcome.finalUpdatedAt, "t1");
});

test("🔵 계획 전체에 미리 검사하지 않는다 — 뒤 걸음이 임시 id 를 들고 있어도 막지 않는다", async () => {
  // 위 ②-1 과 같은 입력이지만 여기서는 **막히지 않는다는 것 자체**를 잰다.
  const pending = [createNode(TMP_NODE_1), createEdge(TMP_EDGE_1, TMP_NODE_1, REAL_NODE_B)];
  const spy = spyExecutor<FakeValidation>((operation, step) => ok(operation, `t${step + 1}`, { nodeId: MINTED_NODE_1 }));
  const outcome = await runProcedureStructuralSequence(pending, "t0", spy.execute);

  assert.equal(outcome.status, "ALL_SENT");
  assert.equal(outcome.failureCause, null);
  assert.equal(spy.calls.length, 2);
});

// ==================== ③ 중간에 실패했을 때 ====================

test("🔴 부분 실패: 성공한 것은 **다시 보낼 목록에 없고**, 실패한 것부터가 남는다", async () => {
  const pending = [createNode(TMP_NODE_1), deleteEdge(REAL_EDGE_1), deleteNode(REAL_NODE_B)];
  const spy = spyExecutor<FakeValidation>((operation, step) => {
    if (operation.kind === "DELETE_EDGE") return { ok: false, message: "다른 사람이 먼저 바꿨습니다." };
    return ok(operation, `t${step + 1}`, { nodeId: MINTED_NODE_1 });
  });
  const outcome = await runProcedureStructuralSequence(pending, "t0", spy.execute);

  assert.equal(outcome.status, "STOPPED_AT_FAILURE");
  assert.equal(outcome.failureCause, "SERVER_REJECTED");
  assert.equal(outcome.failureMessage, "다른 사람이 먼저 바꿨습니다.");
  // 🔴 첫 실패에서 멈춘다 — 셋째(노드 지우기)는 **안 불렸다.**
  assert.deepEqual(spy.calls.map((call) => call.operation.kind), ["CREATE_NODE", "DELETE_EDGE"]);
  // 🔴 성공한 CREATE_NODE 가 남은 목록에 **없다**(있으면 다시 보내 노드가 둘 생긴다).
  assert.deepEqual(outcome.succeededOperations.map((operation) => operation.kind), ["CREATE_NODE"]);
  assert.deepEqual(outcome.remainingOperations.map((operation) => operation.kind), ["DELETE_EDGE", "DELETE_NODE"]);
  assert.equal(outcome.failedOperation?.kind, "DELETE_EDGE");
  // 🔴 임시 id 가 진짜로 바뀐 것은 부분 실패여도 확정이다.
  assert.deepEqual([...outcome.resolvedIds], [[TMP_NODE_1, MINTED_NODE_1]]);
  // 토큰은 **마지막으로 성공한** 걸음의 것.
  assert.equal(outcome.finalUpdatedAt, "t1");
});

test("🔴 **첫** 걸음에서 실패해도 실패로 읽힌다(자리 번호 0 이 falsy 라서 묻히기 쉽다)", async () => {
  const pending = [createNode(TMP_NODE_1), deleteNode(REAL_NODE_B)];
  const spy = spyExecutor<FakeValidation>(() => ({ ok: false, message: "권한이 없습니다." }));
  const outcome = await runProcedureStructuralSequence(pending, "t0", spy.execute);

  assert.equal(outcome.status, "STOPPED_AT_FAILURE");
  assert.equal(outcome.failedOperation?.kind, "CREATE_NODE");
  assert.deepEqual(outcome.succeededOperations, []);
  assert.deepEqual(outcome.remainingOperations.map((operation) => operation.kind), ["CREATE_NODE", "DELETE_NODE"]);
  assert.equal(outcome.finalUpdatedAt, "t0");
  assert.equal(spy.calls.length, 1);
});

test("🔵 남은 목록을 그대로 다시 접어도 똑같다 — 다음 [저장]이 안전하다", async () => {
  const pending = [createNode(TMP_NODE_1), createEdge(TMP_EDGE_1, REAL_NODE_A, TMP_NODE_1), deleteEdge(REAL_EDGE_1), deleteNode(REAL_NODE_B)];
  const spy = spyExecutor<FakeValidation>((operation, step) => {
    if (operation.kind === "DELETE_EDGE") return { ok: false, message: "거절" };
    return ok(operation, `t${step + 1}`, { nodeId: MINTED_NODE_1 });
  });
  const outcome = await runProcedureStructuralSequence(pending, "t0", spy.execute);
  assert.equal(outcome.remainingOperations.length, 3);

  const again = coalescePendingStructuralOperations(outcome.remainingOperations);
  assert.deepEqual(again.operations, outcome.remainingOperations);
  assert.deepEqual(again.dropped, []);
  assert.deepEqual(again.conflicts, []);
});

test("🔴 예외는 삼키지 않는다 — 「거절당했다」와 「모른다」가 한 칸에 섞이면 안 된다", async () => {
  const pending = [createNode(TMP_NODE_1)];
  const execute: ProcedureStructuralExecutor<FakeValidation> = async () => {
    throw new Error("네트워크가 끊겼습니다.");
  };
  await assert.rejects(() => runProcedureStructuralSequence(pending, "t0", execute), /네트워크가 끊겼습니다/);
});

// ==================== ④ 보낼 수 없는 것이 있으면 한 건도 안 보낸다 ====================

test("🔴 conflicts 가 있으면 **아무것도 안 보내고** 들어온 목록을 그대로 돌려준다", async () => {
  const pending = [
    createNode(TMP_NODE_1),
    createEdge(TMP_EDGE_1, REAL_NODE_A, REAL_NODE_B),
    // 아직 저장 안 된 연결선 위에 삽입 — 접을 수도 보낼 수도 없다.
    insertOnEdge(TMP_EDGE_1, TMP_NODE_2, TMP_EDGE_2),
  ];
  const spy = spyExecutor<FakeValidation>((operation, step) => ok(operation, `t${step + 1}`));
  const outcome = await runProcedureStructuralSequence(pending, "t0", spy.execute);

  assert.equal(outcome.status, "BLOCKED_BY_CONFLICTS");
  assert.equal(canProceedToFieldSave(outcome), false);
  // 🔴 반쯤 보내 놓고 막히는 쪽이 훨씬 나쁘다 — 한 번도 안 불렀다.
  assert.equal(spy.calls.length, 0);
  assert.equal(outcome.finalUpdatedAt, "t0");
  assert.equal(outcome.coalesced.conflicts.length, 1);
  assert.equal(outcome.coalesced.conflicts[0].reason, "INSERT_ON_UNSAVED_EDGE");
  // 🔴 남은 목록은 **접기 전 원본 그대로**다. 접힌 것을 돌려주면 사람이 한 일이 사라진다.
  assert.deepEqual(outcome.remainingOperations, pending);
  assert.deepEqual(outcome.succeededOperations, []);
  assert.deepEqual([...outcome.resolvedIds], []);
});

// ==================== ⑤ 구조 검증 요약 ====================

test("검증 요약: 여러 개가 와도 **마지막 것**만 남는다", async () => {
  const pending = [changeNodeType(REAL_NODE_A), createEdge(TMP_EDGE_1, REAL_NODE_A, REAL_NODE_B)];
  const spy = spyExecutor<FakeValidation>((operation, step) => {
    const base = ok(operation, `t${step + 1}`);
    return base.ok ? { ...base, structuralValidation: { tag: operation.kind } } : base;
  });
  const outcome = await runProcedureStructuralSequence(pending, "t0", spy.execute);

  assert.deepEqual(spy.calls.map((call) => call.operation.kind), ["CHANGE_NODE_TYPE", "CREATE_EDGE"]);
  assert.deepEqual(outcome.lastStructuralValidation, { tag: "CREATE_EDGE" });
});

test("검증 요약: 요약을 안 주는 걸음이 뒤에 서도 **받아 둔 마지막 것**이 남는다 · 한 번도 안 오면 null", async () => {
  // 🔵 지우는 노드는 **선을 그은 두 끝과 다른** 노드여야 한다 — 같으면 접기가
  //    ENDPOINT_DELETED_IN_SAME_SAVE 로 막아 한 건도 안 나간다(위 ④절).
  const withSummary = [createEdge(TMP_EDGE_1, REAL_NODE_A, REAL_NODE_B), deleteNode(REAL_NODE_C)];
  const spy = spyExecutor<FakeValidation>((operation, step) => {
    const base = ok(operation, `t${step + 1}`);
    if (operation.kind === "CREATE_EDGE" && base.ok) return { ...base, structuralValidation: { tag: "선을 그은 뒤" } };
    return base;
  });
  const outcome = await runProcedureStructuralSequence(withSummary, "t0", spy.execute);
  // 🔵 요약을 준 걸음(CREATE_EDGE)이 **마지막이 아니다** — 그 뒤에 요약 없는 걸음이 선다.
  assert.deepEqual(spy.calls.map((call) => call.operation.kind), ["CREATE_EDGE", "DELETE_NODE"]);
  assert.deepEqual(outcome.lastStructuralValidation, { tag: "선을 그은 뒤" });

  const silent = spyExecutor<FakeValidation>((operation, step) => ok(operation, `t${step + 1}`));
  const quiet = await runProcedureStructuralSequence([deleteEdge(REAL_EDGE_1)], "t0", silent.execute);
  assert.equal(quiet.lastStructuralValidation, null);
});

// ==================== ⑥ 두 계획의 이음새 ====================

test("id 효과: 만든 것 · 지운 것을 갈라 센다(삽입은 노드와 둘째 연결선 **둘**)", async () => {
  const pending = [
    createNode(TMP_NODE_1),
    insertOnEdge(REAL_EDGE_1, TMP_NODE_2, TMP_EDGE_1),
    deleteEdge(REAL_EDGE_2),
    deleteNode(REAL_NODE_B),
    changeNodeType(REAL_NODE_A),
    // 🔵 재연결은 가리키는 대상만 바꾼다 — 만든 것도 지운 것도 아니다.
    retargetEdge(REAL_EDGE_3, REAL_NODE_A, TMP_NODE_1),
  ];
  const spy = spyExecutor<FakeValidation>((operation, step) =>
    ok(operation, `t${step + 1}`, {
      nodeId: operation.kind === "CREATE_NODE" ? MINTED_NODE_1 : MINTED_NODE_2,
      secondEdgeId: MINTED_EDGE_1,
    })
  );
  const outcome = await runProcedureStructuralSequence(pending, "t0", spy.execute);
  assert.equal(outcome.status, "ALL_SENT");

  // 재연결도 치환을 받는다 — 세 칸(연결선 · 새 시작 · 새 대상) 모두 진짜 id 로 나간다.
  const sentRetarget = spy.calls.find((call) => call.operation.kind === "RETARGET_EDGE")?.operation;
  assert.equal(sentRetarget?.kind === "RETARGET_EDGE" && sentRetarget.newToNodeId, MINTED_NODE_1);

  const effects = collectStructuralIdEffects(outcome);
  assert.deepEqual(effects.createdNodeIds, [MINTED_NODE_1, MINTED_NODE_2]);
  assert.deepEqual(effects.createdEdgeIds, [MINTED_EDGE_1]);
  assert.deepEqual(effects.deletedNodeIds, [REAL_NODE_B]);
  assert.deepEqual(effects.deletedEdgeIds, [REAL_EDGE_2]);
  // 🔵 쪼개진 원래 연결선은 그대로 살아 있다 — 만든 것도 지운 것도 아니다.
  assert.equal(effects.createdEdgeIds.includes(REAL_EDGE_1), false);
  assert.equal(effects.deletedEdgeIds.includes(REAL_EDGE_1), false);
});

test("초안 지도 옮기기: 임시 키는 진짜 키로 · 지워진 키는 버린다 · 아직 안 만들어진 키는 그대로 둔다", () => {
  const effects = {
    resolvedIds: new Map([[TMP_NODE_1, MINTED_NODE_1]]),
    createdNodeIds: [MINTED_NODE_1],
    createdEdgeIds: [],
    deletedNodeIds: [REAL_NODE_B],
    deletedEdgeIds: [REAL_EDGE_1],
  };
  const drafts = new Map([
    [TMP_NODE_1, "막 만든 노드의 초안"],
    [TMP_NODE_2, "아직 안 만들어진 노드의 초안"],
    [REAL_NODE_A, "원래 있던 노드의 초안"],
    [REAL_NODE_B, "이번에 지워진 노드의 초안"],
  ]);
  assert.equal(drafts.size, 4);

  const rebased = rebaseDraftMapAfterStructuralSave(drafts, effects, "node");
  assert.deepEqual(
    [...rebased],
    [
      [MINTED_NODE_1, "막 만든 노드의 초안"],
      [TMP_NODE_2, "아직 안 만들어진 노드의 초안"],
      [REAL_NODE_A, "원래 있던 노드의 초안"],
    ]
  );

  // 연결선 지도는 연결선 쪽 목록으로만 걸러진다 — 노드 삭제 목록이 새 들어오면 안 된다.
  const edgeDrafts = new Map([
    [REAL_EDGE_1, "이번에 지워진 연결선의 초안"],
    [REAL_EDGE_2, "남아 있는 연결선의 초안"],
    [REAL_NODE_B, "노드 id 를 키로 쓴 적 없는 자리(섞이면 안 된다)"],
  ]);
  const rebasedEdges = rebaseDraftMapAfterStructuralSave(edgeDrafts, effects, "edge");
  assert.deepEqual([...rebasedEdges.keys()], [REAL_EDGE_2, REAL_NODE_B]);
});

test("🔴 끝에서 끝까지: 막 만든 노드의 **설명이 사라지지 않는다**", async () => {
  // 사람이 한 일: 노드를 하나 만들고, 그 노드에 설명을 적고, 자리를 옮겼다.
  const pending = [createNode(TMP_NODE_1, "새로 만든 점검")];
  const draft: ProcedureNodeFieldDraft = {
    title: "새로 만든 점검",
    description: "이 설명이 사라지면 안 된다",
    instructions: "",
    sortOrder: 0,
    isActive: true,
    nextProcedureTemplateId: null,
    shareDocRelativePath: null,
  };
  const nodeFieldDrafts = new Map<string, ProcedureNodeFieldDraft>([[TMP_NODE_1, draft]]);
  const layoutMoves = new Map<string, Position>([[TMP_NODE_1, { x: 120, y: 240 }]]);

  // 서버 스냅숏에는 **원래 있던 노드만** 있다. 방금 만든 노드는 새로고침 전이라 없다.
  const serverNodesById = new Map<string, ProcedureServerNodeSnapshot>([
    [
      REAL_NODE_A,
      { id: REAL_NODE_A, title: "원래 있던 노드", description: null, instructions: null, sortOrder: 0, isActive: true, nextProcedureTemplateId: null, shareDocRelativePath: null, positionX: 0, positionY: 0 },
    ],
  ]);

  // 🔵 **무엇을 재는지 먼저** — 아무것도 안 하면 이 초안은 0건으로 센다. 오류도
  //    안 나고 「저장됐습니다」가 뜬 채로 설명이 사라지는 그 모습이다.
  assert.deepEqual(computeDirtyProcedureNodeFieldEntries(nodeFieldDrafts, serverNodesById), []);
  assert.deepEqual(computeDirtyProcedurePositionNodeIds(layoutMoves, serverNodesById), []);

  const spy = spyExecutor<FakeValidation>((operation, step) => ok(operation, `t${step + 1}`, { nodeId: MINTED_NODE_1 }));
  const outcome = await runProcedureStructuralSequence(pending, "t0", spy.execute);
  assert.equal(outcome.status, "ALL_SENT");
  const effects = collectStructuralIdEffects(outcome);

  const rebasedDrafts = rebaseDraftMapAfterStructuralSave(nodeFieldDrafts, effects, "node");
  const rebasedLayout = rebaseDraftMapAfterStructuralSave(layoutMoves, effects, "node");

  const dirtyEntries = includeBrandNewDraftEntries(
    computeDirtyProcedureNodeFieldEntries(rebasedDrafts, serverNodesById),
    effects.createdNodeIds,
    rebasedDrafts
  );
  const dirtyPositionIds = includeBrandNewDraftIds(
    computeDirtyProcedurePositionNodeIds(rebasedLayout, serverNodesById),
    effects.createdNodeIds,
    rebasedLayout
  );

  // 🔴 여기가 이 시험의 전부 — 키가 진짜 id 로 옮겨지고, 그 줄이 보낼 것으로 센다.
  assert.deepEqual(dirtyEntries, [[MINTED_NODE_1, draft]]);
  assert.equal(dirtyEntries[0][1].description, "이 설명이 사라지면 안 된다");
  assert.deepEqual(dirtyPositionIds, [MINTED_NODE_1]);
});

test("막 생긴 것 끼워 넣기: 이미 세어진 줄은 두 번 넣지 않고 · 초안이 없으면 안 넣는다", () => {
  const drafts = new Map([
    [MINTED_NODE_1, "초안 있음"],
    [REAL_NODE_A, "원래 있던 노드"],
  ]);
  const already: [string, string][] = [[REAL_NODE_A, "원래 있던 노드"]];

  // 초안이 있는 새 노드만 들어온다(MINTED_NODE_2 는 사람이 아무것도 안 적었다).
  assert.deepEqual(includeBrandNewDraftEntries(already, [MINTED_NODE_1, MINTED_NODE_2], drafts), [
    [REAL_NODE_A, "원래 있던 노드"],
    [MINTED_NODE_1, "초안 있음"],
  ]);
  // 이미 세어진 줄이면 그대로 하나다.
  const counted: [string, string][] = [[MINTED_NODE_1, "초안 있음"]];
  assert.deepEqual(includeBrandNewDraftEntries(counted, [MINTED_NODE_1], drafts), [[MINTED_NODE_1, "초안 있음"]]);
  // 🔵 원본을 건드리지 않는다.
  assert.deepEqual(already, [[REAL_NODE_A, "원래 있던 노드"]]);

  assert.deepEqual(includeBrandNewDraftIds([REAL_NODE_A], [MINTED_NODE_1, MINTED_NODE_2], drafts), [REAL_NODE_A, MINTED_NODE_1]);
  assert.deepEqual(includeBrandNewDraftIds([MINTED_NODE_1], [MINTED_NODE_1], drafts), [MINTED_NODE_1]);
});
