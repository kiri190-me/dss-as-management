import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  nextTempSequencesFor,
  appendPendingStructuralOperations,
  procedureStructuralOperationsSignature,
  pendingStructuralOperationsEqual,
} from "./procedure-editor-structural-undo";
import { isTempId, makeTempNodeId, makeTempEdgeId, type PendingStructuralOperation } from "./procedure-editor-structural-changes";

/**
 * 「기술 작업 절차」 편집기 — 저장 전 구조 변경의 되돌리기(2026-11-20, 조각 3)가
 * 쓰는 순수 규칙 둘의 시험. React 도 서버 액션도 DB 도 안 부른다.
 *
 * ── 🔴 여기서 가장 조용히 깨질 수 있는 것 ──────────────────────────────
 * ① **번호가 겹치는 것.** 조각 2 가 콕 집어 경고한 자리다 — 되돌리기로 조작
 *    목록을 되살릴 때 도장을 1 부터 다시 만들면 같은 임시 번호가 두 번 나간다.
 *    그러면 조각 1 의 접기가 두 노드를 한 덩어리로 보고, 하나를 지웠을 때 다른
 *    하나가 같이 사라진다. **오류는 한 번도 안 난다.** 그래서 ①절은 「다음
 *    번호가 몇인가」를 값으로 재고, 되돌렸다 다시 쌓는 시나리오까지 돌려 본다.
 * ② **temp 가 안 붙은 칸에 남은 임시 번호를 못 보는 것.** 조각 2 의 치환이 돈
 *    뒤의 목록은 `CREATE_EDGE.fromNodeId` 에만 임시 번호가 남아 있는 것이
 *    정상이다. 거기를 안 세면 그 번호를 다시 내준다.
 * ③ **서명이 칸 차례에 흔들리는 것.** 조각 2 의 치환은 `{ ...operation, … }` 로
 *    조작을 다시 만든다. 내용이 같은데 다르다고 읽히면 아무것도 안 바뀐 자리에
 *    되돌리기 칸이 한 개 더 쌓인다([이전]을 눌러도 화면이 그대로인 헛도는 단계).
 * ④ **표본이 비어 공짜로 통과하는 것.** 번호 시험은 목록이 비면 거의 전부
 *    통과한다. 그래서 단언마다 **무엇이 목록에 들어 있는지**를 먼저 적는다.
 */

// ==================== 밑자락 ====================

/** 진짜 id 표본. 서버의 randomUUID() 와 같은 모양이면 되고, 실제 데이터와는 아무 상관이 없다. */
const REAL_NODE_A = "11111111-1111-4111-8111-111111111111";
const REAL_NODE_B = "22222222-2222-4222-8222-222222222222";
const REAL_EDGE_1 = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

/** 🔵 돌려주는 타입을 **좁은 쪽**으로 둔다 — 아래 「칸 차례만 다르다」 시험이 `{ ...op, … }` 로 조작을 다시 만드는데, 합집합을 펼치면 타입이 서지 않는다. */
type Op<K extends PendingStructuralOperation["kind"]> = Extract<PendingStructuralOperation, { kind: K }>;

function createNode(tempNodeId: string, title = "새 작업"): Op<"CREATE_NODE"> {
  return { kind: "CREATE_NODE", tempNodeId, nodeType: "TASK", title, position: null };
}
function createEdge(tempEdgeId: string, fromNodeId: string, toNodeId: string): Op<"CREATE_EDGE"> {
  return { kind: "CREATE_EDGE", tempEdgeId, fromNodeId, toNodeId, branchType: "DEFAULT", branchLabel: null, reason: null };
}
function deleteNode(nodeId: string): Op<"DELETE_NODE"> {
  return { kind: "DELETE_NODE", nodeId, reason: null };
}
function insertOnEdge(edgeId: string, tempNodeId: string, tempSecondEdgeId: string): Op<"INSERT_NODE_ON_EDGE"> {
  return { kind: "INSERT_NODE_ON_EDGE", edgeId, tempNodeId, tempSecondEdgeId, nodeType: "INSPECTION", title: "끼워 넣은 검사", position: { x: 10, y: 20 } };
}

/** 목록 전체에 **글자로** 들어 있는 임시 id 를 전부 긁는다 — 「겹치지 않는가」를 재는 쪽은 칸 이름을 모르는 편이 낫다. */
function allTempIdsIn(operations: readonly PendingStructuralOperation[]): string[] {
  const found: string[] = [];
  for (const operation of operations) {
    for (const value of Object.values(operation)) {
      if (typeof value === "string" && isTempId(value)) found.push(value);
    }
  }
  return found;
}

describe("저장 전 구조 변경 되돌리기 — ① 번호 도장은 목록에서 뽑는다", () => {
  test("🔵 표본부터 — 빈 목록이면 1 번부터 나간다", () => {
    assert.deepEqual(nextTempSequencesFor([]), { node: 1, edge: 1 });
    const minted = appendPendingStructuralOperations([], (mint) => [createNode(mint.nextNodeId())]);
    assert.equal(minted.length, 1, "한 건도 안 쌓이면 아래 단언들이 공짜로 통과한다");
    assert.deepEqual(minted[0], createNode(makeTempNodeId(1)));
  });

  test("🔴 목록에 tmp:node:3 이 남아 있으면 다음은 **4** 다 — 1 이 아니다(조각 2 의 경고 ㄴ)", () => {
    // 되돌리기가 옛 목록을 되살린 바로 그 상황. 도장을 새로 만들어 1 부터
    // 세면 tmp:node:3 과 같은 번호가 또 나가고, 접기가 둘을 한 노드로 본다.
    const restored = [createNode(makeTempNodeId(3))];
    assert.equal(nextTempSequencesFor(restored).node, 4);

    const next = appendPendingStructuralOperations(restored, (mint) => [createNode(mint.nextNodeId())]);
    assert.equal(next.length, 2);
    assert.deepEqual(allTempIdsIn(next), ["tmp:node:3", "tmp:node:4"]);
    assert.equal(new Set(allTempIdsIn(next)).size, 2, "같은 번호가 두 번 나가면 안 된다");
  });

  test("노드와 연결선은 **따로** 센다 — 번호가 뜀뛰지 않는다", () => {
    const operations = [createNode(makeTempNodeId(5))];
    assert.deepEqual(nextTempSequencesFor(operations), { node: 6, edge: 1 });
    const next = appendPendingStructuralOperations(operations, (mint) => [createEdge(mint.nextEdgeId(), REAL_NODE_A, REAL_NODE_B)]);
    assert.deepEqual(allTempIdsIn(next), ["tmp:node:5", "tmp:edge:1"]);
  });

  test("🔴 `temp` 가 안 붙은 **가리키는 칸**에만 남은 번호도 센다(부분 실패 뒤의 정상적인 모습)", () => {
    // 조각 2 의 치환이 돌면 CREATE_NODE 는 진짜 id 를 받아 사라지고, 그것을
    // 가리키던 연결선만 임시 번호를 든 채 남는 일이 실제로 생긴다.
    const remaining = [createEdge(makeTempEdgeId(2), makeTempNodeId(7), REAL_NODE_B)];
    assert.deepEqual(allTempIdsIn(remaining), ["tmp:edge:2", "tmp:node:7"], "표본에 두 갈래가 다 들어 있어야 아래가 뜻이 있다");
    assert.deepEqual(nextTempSequencesFor(remaining), { node: 8, edge: 3 });
  });

  test("🔴 INSERT_NODE_ON_EDGE 는 번호를 **둘** 들고 있다 — 둘 다 센다", () => {
    const operations = [insertOnEdge(REAL_EDGE_1, makeTempNodeId(4), makeTempEdgeId(9))];
    assert.deepEqual(nextTempSequencesFor(operations), { node: 5, edge: 10 });
  });

  test("진짜 id 만 남은 목록이면 다시 1 번부터 — 겹칠 상대가 없다", () => {
    const sent = [deleteNode(REAL_NODE_A), createEdge(REAL_EDGE_1, REAL_NODE_A, REAL_NODE_B)];
    assert.deepEqual(allTempIdsIn(sent), [], "임시 번호가 하나라도 남아 있으면 이 시험이 뜻을 잃는다");
    assert.deepEqual(nextTempSequencesFor(sent), { node: 1, edge: 1 });
  });

  test("한 번에 여러 줄을 적어도 **한 도장**에서 받는다 — 서로 겹치지 않는다", () => {
    // 조각 1 이 적어 둔 「저장 안 된 연결선 위에 노드 삽입」의 우회로가 이 모양이다.
    const built = appendPendingStructuralOperations([], (mint) => {
      const first = mint.nextNodeId();
      const second = mint.nextNodeId();
      return [createNode(first), createNode(second), createEdge(mint.nextEdgeId(), first, second)];
    });
    assert.equal(built.length, 3);
    assert.deepEqual(allTempIdsIn(built), ["tmp:node:1", "tmp:node:2", "tmp:edge:1", "tmp:node:1", "tmp:node:2"]);
    assert.deepEqual([...new Set(allTempIdsIn(built))], ["tmp:node:1", "tmp:node:2", "tmp:edge:1"], "만들어진 번호는 셋이고 나머지는 그것을 가리키는 것이다");
  });

  test("🔴 되돌렸다 다시 쌓아도 **살아 있는 목록 안에서 번호가 겹치지 않는다**", () => {
    let operations = appendPendingStructuralOperations([], (mint) => [createNode(mint.nextNodeId())]);
    const afterFirst = operations; // ← 되돌리기가 되살릴 스냅샷

    operations = appendPendingStructuralOperations(operations, (mint) => [createNode(mint.nextNodeId())]);
    operations = appendPendingStructuralOperations(operations, (mint) => [createEdge(mint.nextEdgeId(), makeTempNodeId(1), makeTempNodeId(2))]);
    assert.equal(operations.length, 3, "되돌리기 전에 셋이 쌓여 있어야 아래가 뜻이 있다");

    // [이전] 두 번 — PENDING 스냅샷이 통째로 갈아끼워지는 것과 같은 일이다.
    operations = afterFirst;
    assert.deepEqual(allTempIdsIn(operations), ["tmp:node:1"]);

    const again = appendPendingStructuralOperations(operations, (mint) => [createNode(mint.nextNodeId())]);
    const minted = allTempIdsIn(again);
    assert.deepEqual(minted, ["tmp:node:1", "tmp:node:2"], "되살아난 1 번을 다시 내주지 않는다");
    assert.equal(new Set(minted).size, minted.length);
  });

  test("들어온 목록을 건드리지 않는다(순수 함수의 약속)", () => {
    const operations: readonly PendingStructuralOperation[] = [createNode(makeTempNodeId(1))];
    const before = JSON.stringify(operations);
    const next = appendPendingStructuralOperations(operations, (mint) => [createNode(mint.nextNodeId())]);
    assert.equal(operations.length, 1);
    assert.equal(JSON.stringify(operations), before);
    assert.equal(next.length, 2);
  });
});

describe("저장 전 구조 변경 되돌리기 — ② 견주기(서명)", () => {
  test("🔵 표본부터 — 빈 목록과 한 건짜리는 다르고, 같은 목록은 같다", () => {
    const one = [createNode(makeTempNodeId(1))];
    assert.notEqual(procedureStructuralOperationsSignature([]), procedureStructuralOperationsSignature(one));
    assert.equal(procedureStructuralOperationsSignature(one), procedureStructuralOperationsSignature([createNode(makeTempNodeId(1))]));
    assert.equal(pendingStructuralOperationsEqual([], []), true);
  });

  test("🔴 칸 하나만 달라도 다른 목록이다 — 이것이 같다고 읽히면 되돌리기 한 단계가 사라진다", () => {
    const a = [createNode(makeTempNodeId(1), "검사 준비")];
    const b = [createNode(makeTempNodeId(1), "검사 준비 2")];
    assert.equal(pendingStructuralOperationsEqual(a, b), false);
  });

  test("차례가 다르면 다른 목록이다 — 보낼 차례를 그 순서에서 뽑기 때문이다", () => {
    const first = createNode(makeTempNodeId(1));
    const second = deleteNode(REAL_NODE_A);
    assert.equal(pendingStructuralOperationsEqual([first, second], [second, first]), false);
  });

  test("🔴 **칸 차례만** 다른 같은 내용은 같다(조각 2 의 치환이 `{ ...operation }` 으로 다시 만든다)", () => {
    const original = createNode(makeTempNodeId(1));
    // 같은 값, 다른 키 차례. JSON 을 그대로 찍으면 여기서 갈린다.
    const rebuilt: Op<"CREATE_NODE"> = { title: "새 작업", position: null, nodeType: "TASK", tempNodeId: makeTempNodeId(1), kind: "CREATE_NODE" };
    assert.notEqual(JSON.stringify([original]), JSON.stringify([rebuilt]), "표본 확인 — 날것으로는 정말 다르게 보인다");
    assert.equal(pendingStructuralOperationsEqual([original], [rebuilt]), true);
  });

  test("한 겹 더 들어간 값(position)의 칸 차례에도 안 흔들린다", () => {
    const inserted = insertOnEdge(REAL_EDGE_1, makeTempNodeId(1), makeTempEdgeId(1));
    const swapped: Op<"INSERT_NODE_ON_EDGE"> = { ...inserted, position: { y: 20, x: 10 } };
    assert.notEqual(JSON.stringify([inserted]), JSON.stringify([swapped]), "표본 확인 — 날것으로는 다르게 보인다");
    assert.equal(pendingStructuralOperationsEqual([inserted], [swapped]), true);

    // 🔵 값 자체가 다르면 당연히 다르다(위 단언이 「늘 같다」로 통과한 것이 아니다).
    const moved: Op<"INSERT_NODE_ON_EDGE"> = { ...inserted, position: { x: 11, y: 20 } };
    assert.equal(pendingStructuralOperationsEqual([inserted], [moved]), false);
  });
});
