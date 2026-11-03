import { describe, test } from "node:test";
import assert from "node:assert/strict";
import {
  classifyAutoAdvanceTarget,
  pickCurrentTask,
  pickCurrentTaskNode,
  resolveAutoAdvanceTarget,
  type AutoAdvanceCandidate,
  type AutoAdvanceEdge,
  type AutoAdvanceGraphNode,
} from "./procedure-execution-focus";
import { PROCEDURE_CASE_EXECUTION_NODE_STATUS_CODES, type ProcedureCaseExecutionNodeStatus } from "./procedure-case-execution-types";

/**
 * 「지금 할 일 하나」와 「다음 하나」. 두 규칙 다 화면이 아니라 여기서 정하므로
 * 여기서 재면 된다.
 *
 * 🔵 표본이 비어 공짜로 통과하지 않게, 「무엇을 재는가」를 먼저 단언한다 —
 * 상태 목록이 다섯이라는 것과, 뒤섞은 배열이 실제로 뒤섞여 있다는 것.
 */

type Node = { id: string; status: ProcedureCaseExecutionNodeStatus };

/** 조회가 이미 절차 차례로 정렬해 주므로, 배열 차례 = 절차 차례다. */
function nodes(...spec: [string, ProcedureCaseExecutionNodeStatus][]): Node[] {
  return spec.map(([id, status]) => ({ id, status }));
}

/**
 * 아직 도는 실행에서 고른다 — 아래 대부분의 시험이 쓰는 형편이다.
 * 🔴 마친 실행은 **따로** 잰다(아래 describe) — 인자를 감춰 두면 그쪽이 안 재어진다.
 */
const pickRunning = (list: readonly Node[]) => pickCurrentTask(list, { isExecutionFinished: false });
const pickRunningNode = (list: readonly Node[]) => pickCurrentTaskNode(list, { isExecutionFinished: false });

describe("지금 할 일 하나 고르기", () => {
  test("🔵 표본 확인 — 상태는 다섯 가지이고 이 시험이 다섯을 모두 쓴다", () => {
    assert.deepEqual(
      [...PROCEDURE_CASE_EXECUTION_NODE_STATUS_CODES],
      ["PENDING", "IN_PROGRESS", "COMPLETED", "SKIPPED", "BLOCKED"],
      "상태가 늘면 이 파일의 분기도 늘어야 한다"
    );
  });

  test("진행 중이 있으면 그것 — 절차 차례가 뒤쪽이라도 대기보다 먼저다", () => {
    const list = nodes(["n1", "PENDING"], ["n2", "PENDING"], ["n3", "IN_PROGRESS"]);
    const pick = pickRunning(list);
    assert.equal(pick.kind, "IN_PROGRESS");
    assert.equal(pick.kind === "IN_PROGRESS" ? pick.node.id : null, "n3");
  });

  test("진행 중이 여럿이면 절차 차례가 가장 앞선 것(배열에서 먼저 나오는 것)", () => {
    const list = nodes(["n1", "COMPLETED"], ["n2", "IN_PROGRESS"], ["n3", "IN_PROGRESS"]);
    assert.equal(pickRunningNode(list)?.id, "n2");
  });

  test("진행 중이 없으면 대기 중 가장 앞선 것", () => {
    const list = nodes(["n1", "COMPLETED"], ["n2", "SKIPPED"], ["n3", "PENDING"], ["n4", "PENDING"]);
    const pick = pickRunning(list);
    assert.equal(pick.kind, "PENDING");
    assert.equal(pick.kind === "PENDING" ? pick.node.id : null, "n3");
  });

  test("🔴 차단됨은 고르지 않는다 — 앞에 있어도 뒤의 대기를 고른다", () => {
    const list = nodes(["n1", "BLOCKED"], ["n2", "PENDING"]);
    assert.equal(pickRunningNode(list)?.id, "n2");
  });

  test("🔴 남은 것이 전부 차단됨이면 「지금 할 일 없음」 — 차단을 골라 채우지 않는다", () => {
    const list = nodes(["n1", "COMPLETED"], ["n2", "BLOCKED"], ["n3", "BLOCKED"]);
    const pick = pickRunning(list);
    assert.deepEqual(pick, { kind: "NONE", reason: "ALL_BLOCKED" });
    assert.equal(pickRunningNode(list), null);
  });

  test("🔴 다 끝났으면 없음 — 차단됨과 다른 까닭으로 갈린다(화면 문구가 반대다)", () => {
    const list = nodes(["n1", "COMPLETED"], ["n2", "SKIPPED"]);
    assert.deepEqual(pickRunning(list), { kind: "NONE", reason: "ALL_FINISHED" });
  });

  test("노드가 하나도 없으면 NO_NODES — 「다 끝났습니다」라고 하면 거짓말이다", () => {
    assert.deepEqual(pickRunning([]), { kind: "NONE", reason: "NO_NODES" });
  });

  test("원본 배열을 건드리지 않는다", () => {
    const list = nodes(["n1", "PENDING"], ["n2", "IN_PROGRESS"]);
    const before = list.map((n) => n.id);
    pickRunning(list);
    assert.deepEqual(list.map((n) => n.id), before, "여기서 다시 정렬하면 화면마다 차례가 달라진다");
  });
});

/**
 * 🔴 **마친 실행에서는 지금 할 일이 없다**(2026-11-02 눈 확인).
 *
 * 끝까지 안 가고 [절차 끝내기]를 눌렀을 때 남은 작업 카드가 그대로 떠 있어서
 * 마친 것처럼 보이지 않았다. 사람이 「마쳤다」고 했으면 마친 것이다.
 */
describe("🔴 마친 실행에서는 아무것도 안 고른다", () => {
  const halfDone = nodes(["n1", "COMPLETED"], ["n2", "PENDING"], ["n3", "IN_PROGRESS"], ["n4", "BLOCKED"]);

  test("🔵 표본 확인 — 같은 배열이 아직 도는 실행에서는 **하나를 고른다**", () => {
    // 이 줄이 없으면 아래 「안 고른다」가 「원래 고를 것이 없었다」로도 통과한다.
    assert.equal(pickRunningNode(halfDone)?.id, "n3");
  });

  test("남은 것이 있어도 안 고르고, 까닭이 EXECUTION_FINISHED 다", () => {
    assert.deepEqual(pickCurrentTask(halfDone, { isExecutionFinished: true }), {
      kind: "NONE",
      reason: "EXECUTION_FINISHED",
    });
    assert.equal(pickCurrentTaskNode(halfDone, { isExecutionFinished: true }), null);
  });

  test("🔴 까닭이 ALL_FINISHED 와 **갈린다** — 화면이 하는 일이 다르다", () => {
    // ALL_FINISHED 는 「모든 작업이 끝났습니다」 안내를 세우고,
    // EXECUTION_FINISHED 는 그 자리를 **통째로 비운다**(위 「절차를 마쳤습니다」
    // 하나만 말한다). 둘을 한 까닭으로 묶으면 화면이 그 둘을 못 가른다.
    const allDone = nodes(["n1", "COMPLETED"], ["n2", "SKIPPED"]);
    assert.deepEqual(pickRunning(allDone), { kind: "NONE", reason: "ALL_FINISHED" });
    assert.deepEqual(pickCurrentTask(allDone, { isExecutionFinished: true }), {
      kind: "NONE",
      reason: "EXECUTION_FINISHED",
    });
  });

  test("노드가 아예 없는 마친 실행도 EXECUTION_FINISHED 다 — 마친 쪽이 더 큰 사정이다", () => {
    assert.deepEqual(pickCurrentTask([], { isExecutionFinished: true }), {
      kind: "NONE",
      reason: "EXECUTION_FINISHED",
    });
  });
});

/**
 * 간선은 이 모양이다(통합 시험의 판과 같다):
 *
 *   t1 --e1--> t2 --e2--> t3(판단) --e3(YES)--> t4
 *                           ^                  t3 --e4(NG)--> t5
 *                           |                  t5 --e5(재측정)--> t3
 */
const EDGES: AutoAdvanceEdge[] = [
  { id: "e1", fromNodeId: "t1", toNodeId: "t2" },
  { id: "e2", fromNodeId: "t2", toNodeId: "t3" },
  { id: "e3", fromNodeId: "t3", toNodeId: "t4" },
  { id: "e4", fromNodeId: "t3", toNodeId: "t5" },
  { id: "e5", fromNodeId: "t5", toNodeId: "t3" },
];

/**
 * 노드 갈래. 실행 행이 없는 노드가 **참고 문서라서** 없는 것인지 가르는 데 쓴다 —
 * 여기 다섯은 전부 실행 가능한 갈래다(참고 문서는 아래 REFERENCE_* 판에서 따로
 * 세운다).
 */
const TEMPLATE_NODES: AutoAdvanceGraphNode[] = [
  { id: "t1", nodeType: "START" },
  { id: "t2", nodeType: "TASK" },
  { id: "t3", nodeType: "DECISION" },
  { id: "t4", nodeType: "TASK" },
  { id: "t5", nodeType: "CORRECTIVE_ACTION" },
];

function execNodes(...spec: [string, string, ProcedureCaseExecutionNodeStatus][]): AutoAdvanceCandidate[] {
  return spec.map(([id, graphNodeId, status]) => ({ id, graphNodeId, status }));
}

const ALL_PENDING = execNodes(
  ["x2", "t2", "PENDING"],
  ["x3", "t3", "PENDING"],
  ["x4", "t4", "PENDING"],
  ["x5", "t5", "PENDING"]
);

describe("완료하면 다음 하나가 저절로 선다", () => {
  test("🔵 표본 확인 — 판단 노드 t3 에서 나가는 간선이 정말 둘이다", () => {
    assert.equal(EDGES.filter((e) => e.fromNodeId === "t3").length, 2, "하나뿐이면 「갈래를 고른다」를 재지 못한다");
    assert.equal(EDGES.filter((e) => e.fromNodeId === "t2").length, 1);
  });

  test("판단 — 고른 갈래가 가리키는 노드를 세운다(NG 를 고르면 NG 쪽)", () => {
    assert.deepEqual(
      resolveAutoAdvanceTarget({
        completedGraphNodeId: "t3",
        isDecision: true,
        selectedOutgoingEdgeId: "e4",
        edges: EDGES,
        graphNodes: TEMPLATE_NODES,
        executionNodes: ALL_PENDING,
      }),
      { kind: "ADVANCE", executionNodeId: "x5", viaEdgeId: "e4" }
    );
  });

  test("🔴 판단 — 다른 갈래(YES)를 고르면 다른 노드가 선다. 같은 입력에서 답이 갈려야 한다", () => {
    const yes = resolveAutoAdvanceTarget({
      completedGraphNodeId: "t3",
      isDecision: true,
      selectedOutgoingEdgeId: "e3",
      edges: EDGES,
      graphNodes: TEMPLATE_NODES,
      executionNodes: ALL_PENDING,
    });
    assert.deepEqual(yes, { kind: "ADVANCE", executionNodeId: "x4", viaEdgeId: "e3" });
  });

  test("🔴 판단인데 고른 갈래가 이 노드에서 나가는 것이 아니면 아무것도 안 세운다 — 첫 간선으로 흘러가지 않는다", () => {
    for (const selectedOutgoingEdgeId of [null, "e1", "없는-간선"]) {
      assert.deepEqual(
        resolveAutoAdvanceTarget({
          completedGraphNodeId: "t3",
          isDecision: true,
          selectedOutgoingEdgeId,
          edges: EDGES,
          graphNodes: TEMPLATE_NODES,
          executionNodes: ALL_PENDING,
        }),
        { kind: "SKIP", reason: "SELECTED_BRANCH_MISSING" },
        `고른 갈래 = ${String(selectedOutgoingEdgeId)}`
      );
    }
  });

  test("판단이 아니고 나가는 간선이 하나면 그 노드를 세운다", () => {
    assert.deepEqual(
      resolveAutoAdvanceTarget({
        completedGraphNodeId: "t2",
        isDecision: false,
        selectedOutgoingEdgeId: null,
        edges: EDGES,
        graphNodes: TEMPLATE_NODES,
        executionNodes: ALL_PENDING,
      }),
      { kind: "ADVANCE", executionNodeId: "x3", viaEdgeId: "e2" }
    );
  });

  test("🔴 판단이 아닌데 나가는 간선이 여럿이면 아무것도 안 세운다 — 첫째를 고르면 틀린 쪽이 1순위가 된다", () => {
    assert.deepEqual(
      resolveAutoAdvanceTarget({
        completedGraphNodeId: "t3",
        isDecision: false,
        selectedOutgoingEdgeId: null,
        edges: EDGES,
        graphNodes: TEMPLATE_NODES,
        executionNodes: ALL_PENDING,
      }),
      { kind: "SKIP", reason: "AMBIGUOUS_OUTGOING_EDGES" }
    );
  });

  test("나가는 간선이 없으면(END·그리다 만 가지) 안 세운다", () => {
    assert.deepEqual(
      resolveAutoAdvanceTarget({
        completedGraphNodeId: "t4",
        isDecision: false,
        selectedOutgoingEdgeId: null,
        edges: EDGES,
        graphNodes: TEMPLATE_NODES,
        executionNodes: ALL_PENDING,
      }),
      { kind: "SKIP", reason: "NO_OUTGOING_EDGE" }
    );
  });

  /**
   * 🔴 2026-11-03(조각 13)에 **뜻이 바뀐 시험**이다. 전에는 이름이 「끝낸 것이
   * 사례별 추가 작업이면 그래프에 자리가 없다」였고 까닭이 NOT_IN_GRAPH 였다 —
   * 그 까닭 자체가 없어졌다. 이제 추가 작업도 그림의 한 칸이고, 아무 데도 안
   * 이었으면 **나가는 선이 없는 것**일 뿐이다(템플릿의 END 와 같은 자리).
   */
  test("🔴 아직 아무 데도 안 이은 추가 작업은 **나가는 선이 없는 것**으로 읽는다", () => {
    const withExtra: AutoAdvanceCandidate[] = [...ALL_PENDING, { id: "x9", graphNodeId: "x9", status: "PENDING" }];
    assert.deepEqual(
      resolveAutoAdvanceTarget({
        completedGraphNodeId: "x9",
        isDecision: false,
        selectedOutgoingEdgeId: null,
        edges: EDGES,
        graphNodes: [...TEMPLATE_NODES, { id: "x9", nodeType: "TASK" }],
        executionNodes: withExtra,
      }),
      { kind: "SKIP", reason: "NO_OUTGOING_EDGE" }
    );
  });

  test("🔴 이어 붙인 추가 작업을 끝내면 **그 선을 따라** 다음이 선다", () => {
    const withExtra: AutoAdvanceCandidate[] = [...ALL_PENDING, { id: "x9", graphNodeId: "x9", status: "PENDING" }];
    // 표본 확인 — 선을 안 주면 아무것도 안 선다(바로 위 시험).
    assert.deepEqual(
      resolveAutoAdvanceTarget({
        completedGraphNodeId: "x9",
        isDecision: false,
        selectedOutgoingEdgeId: null,
        edges: EDGES,
        graphNodes: [...TEMPLATE_NODES, { id: "x9", nodeType: "TASK" }],
        executionNodes: withExtra,
      }).kind,
      "SKIP"
    );

    assert.deepEqual(
      resolveAutoAdvanceTarget({
        completedGraphNodeId: "x9",
        isDecision: false,
        selectedOutgoingEdgeId: null,
        edges: [...EDGES, { id: "added-1", fromNodeId: "x9", toNodeId: "t4" }],
        graphNodes: [...TEMPLATE_NODES, { id: "x9", nodeType: "TASK" }],
        executionNodes: withExtra,
      }),
      { kind: "ADVANCE", executionNodeId: "x4", viaEdgeId: "added-1" }
    );
  });

  test("🔴 템플릿 작업을 끝냈을 때도 **이 건에서 그은 선**을 따라간다", () => {
    const withExtra: AutoAdvanceCandidate[] = [...ALL_PENDING, { id: "x9", graphNodeId: "x9", status: "PENDING" }];
    // t4 는 EDGES 에 나가는 선이 없다 — 거기에 이 건에서 그은 선 하나만 붙인다.
    assert.deepEqual(
      resolveAutoAdvanceTarget({
        completedGraphNodeId: "t4",
        isDecision: false,
        selectedOutgoingEdgeId: null,
        edges: [...EDGES, { id: "added-2", fromNodeId: "t4", toNodeId: "x9" }],
        graphNodes: [...TEMPLATE_NODES, { id: "x9", nodeType: "TASK" }],
        executionNodes: withExtra,
      }),
      { kind: "ADVANCE", executionNodeId: "x9", viaEdgeId: "added-2" }
    );
  });

  /**
   * 🔴 2026-11-02(조각 5)에 **뜻이 뒤집힌 시험**이다. 전에는 이 시험의 이름이
   * 「실행 행이 없으면(참고 문서) 안 세운다」였다 — 그때는 참고 문서를 만나면
   * 거기서 멈추는 것이 사양이었고, 그 멈춤이 바로 이번에 고친 결함이다.
   *
   * 단언을 약하게 하지 않고 **표본을 바꿨다**: 이제 TARGET_NOT_EXECUTABLE 은
   * 「실행 행이 없는데 **참고 문서도 아닌**」 자리에만 남는다. 참고 문서는 아래
   * 묶음이 따로 잰다.
   */
  test("🔴 실행 행이 없는데 참고 문서도 아니면 안 세운다 — 건너뛸 근거가 없다", () => {
    assert.deepEqual(
      resolveAutoAdvanceTarget({
        completedGraphNodeId: "t2",
        isDecision: false,
        selectedOutgoingEdgeId: null,
        edges: EDGES,
        // t3 는 판단(DECISION)이라 실행 행이 **있어야 한다.** 그런데 없다.
        graphNodes: TEMPLATE_NODES,
        executionNodes: execNodes(["x2", "t2", "PENDING"], ["x4", "t4", "PENDING"]),
      }),
      { kind: "SKIP", reason: "TARGET_NOT_EXECUTABLE" }
    );
  });

  test("갈래를 모르는 노드로 가는 간선도 안 세운다 — 템플릿에 없는 id 를 건너뛰면 아무 데나 흘러간다", () => {
    assert.deepEqual(
      resolveAutoAdvanceTarget({
        completedGraphNodeId: "t2",
        isDecision: false,
        selectedOutgoingEdgeId: null,
        edges: EDGES,
        graphNodes: TEMPLATE_NODES.filter((n) => n.id !== "t3"),
        executionNodes: execNodes(["x2", "t2", "PENDING"], ["x4", "t4", "PENDING"]),
      }),
      { kind: "SKIP", reason: "TARGET_NOT_EXECUTABLE" }
    );
  });

  test("🔴 고리가 있는 절차 — 「재측정」으로 돌아가도 이미 끝난 판단을 되살리지 않는다", () => {
    // t5(NG 조치)를 끝내면 간선 e5 가 판단 t3 로 돌아간다. 그런데 t3 는 이미
    // 완료 상태다 — 되살리면 끝난 일이 다시 「지금 할 일」로 올라온다.
    const afterLoop = execNodes(
      ["x2", "t2", "COMPLETED"],
      ["x3", "t3", "COMPLETED"],
      ["x4", "t4", "PENDING"],
      ["x5", "t5", "COMPLETED"]
    );
    assert.deepEqual(
      resolveAutoAdvanceTarget({
        completedGraphNodeId: "t5",
        isDecision: false,
        selectedOutgoingEdgeId: null,
        edges: EDGES,
        graphNodes: TEMPLATE_NODES,
        executionNodes: afterLoop,
      }),
      { kind: "SKIP", reason: "TARGET_ALREADY_FINISHED" }
    );
  });

  test("🔴 건너뛴 노드도 되살리지 않는다 — 건너뜀은 사람이 「안 한다」고 정한 것이다", () => {
    assert.deepEqual(
      resolveAutoAdvanceTarget({
        completedGraphNodeId: "t2",
        isDecision: false,
        selectedOutgoingEdgeId: null,
        edges: EDGES,
        graphNodes: TEMPLATE_NODES,
        executionNodes: execNodes(["x2", "t2", "COMPLETED"], ["x3", "t3", "SKIPPED"]),
      }),
      { kind: "SKIP", reason: "TARGET_ALREADY_FINISHED" }
    );
  });

  test("🔴 다음 것이 차단됨이면 자동으로 풀지 않는다", () => {
    assert.deepEqual(
      resolveAutoAdvanceTarget({
        completedGraphNodeId: "t2",
        isDecision: false,
        selectedOutgoingEdgeId: null,
        edges: EDGES,
        graphNodes: TEMPLATE_NODES,
        executionNodes: execNodes(["x2", "t2", "COMPLETED"], ["x3", "t3", "BLOCKED"]),
      }),
      { kind: "SKIP", reason: "TARGET_BLOCKED" }
    );
  });

  test("🔴 다음 것이 이미 진행 중이면 건드리지 않는다 — 남이 하고 있는 일이다", () => {
    assert.deepEqual(
      resolveAutoAdvanceTarget({
        completedGraphNodeId: "t2",
        isDecision: false,
        selectedOutgoingEdgeId: null,
        edges: EDGES,
        graphNodes: TEMPLATE_NODES,
        executionNodes: execNodes(["x2", "t2", "COMPLETED"], ["x3", "t3", "IN_PROGRESS"]),
      }),
      { kind: "SKIP", reason: "TARGET_ALREADY_IN_PROGRESS" }
    );
  });

  test("🔴 세우는 대상은 언제나 하나다 — 돌려주는 것에 다른 노드가 섞이지 않는다", () => {
    // 「남의 진행 중을 끄지 않는다」의 구조적 근거: 이 함수는 **세울 하나의 id**
    // 말고는 아무것도 돌려주지 않으므로, 부르는 쪽이 다른 행을 건드릴 재료가
    // 애초에 없다.
    const decision = resolveAutoAdvanceTarget({
      completedGraphNodeId: "t2",
      isDecision: false,
      selectedOutgoingEdgeId: null,
      edges: EDGES,
      graphNodes: TEMPLATE_NODES,
      executionNodes: execNodes(["x2", "t2", "COMPLETED"], ["x3", "t3", "PENDING"], ["x4", "t4", "IN_PROGRESS"]),
    });
    assert.deepEqual(decision, { kind: "ADVANCE", executionNodeId: "x3", viaEdgeId: "e2" });
    assert.deepEqual(Object.keys(decision).sort(), ["executionNodeId", "kind", "viaEdgeId"]);
  });

  test("간선을 템플릿 전체로 줘도 끝낸 노드에서 나가는 것만 본다", () => {
    const extra: AutoAdvanceEdge[] = [...EDGES, { id: "e9", fromNodeId: "t9", toNodeId: "t4" }];
    assert.deepEqual(
      resolveAutoAdvanceTarget({
        completedGraphNodeId: "t2",
        isDecision: false,
        selectedOutgoingEdgeId: null,
        edges: extra,
        graphNodes: TEMPLATE_NODES,
        executionNodes: ALL_PENDING,
      }),
      { kind: "ADVANCE", executionNodeId: "x3", viaEdgeId: "e2" }
    );
  });
});

/**
 * 🔴 **참고 문서를 건너뛴다**(2026-11-02, 조각 5).
 *
 * 판은 개발 DB 의 rfg-full-lifecycle 모양을 그대로 옮겼다(실측 2026-11-02):
 *
 *   s31-45(TASK) → s31-50(참고) → s31-53(END)
 *                  s31-50(참고) → s31-56(참고) → s31-58(END)
 *
 * 꾸며낸 가정이 아니다 — 들어오는 선과 나가는 선을 다 가진 참고 문서가 실제로
 * 둘이고, 그중 하나는 나가는 선이 **둘**이며, 둘이 **연달아** 붙어 있다.
 * 지금은 그 절차가 초안이라 안 터지지만 게시하는 날 그 자리에서 멈춘다.
 */
const REF_NODES: AutoAdvanceGraphNode[] = [
  { id: "p45", nodeType: "TASK" },
  { id: "p50", nodeType: "DOCUMENT_REFERENCE" },
  { id: "p56", nodeType: "DOCUMENT_REFERENCE" },
  { id: "p53", nodeType: "END" },
  { id: "p58", nodeType: "END" },
];

/** 한 줄로 이어지는 판 — p45 → p50(참고) → p58. 갈래가 안 벌어진다. */
const REF_CHAIN_EDGES: AutoAdvanceEdge[] = [
  { id: "r1", fromNodeId: "p45", toNodeId: "p50" },
  { id: "r2", fromNodeId: "p50", toNodeId: "p58" },
];

/** 참고 문서가 **연달아** 둘 — p45 → p50(참고) → p56(참고) → p58. */
const REF_DOUBLE_EDGES: AutoAdvanceEdge[] = [
  { id: "r1", fromNodeId: "p45", toNodeId: "p50" },
  { id: "r3", fromNodeId: "p50", toNodeId: "p56" },
  { id: "r4", fromNodeId: "p56", toNodeId: "p58" },
];

/** 실측 그대로 — p50 에서 나가는 선이 **둘**(END 로도, 다음 참고 문서로도). */
const REF_FANOUT_EDGES: AutoAdvanceEdge[] = [
  { id: "r1", fromNodeId: "p45", toNodeId: "p50" },
  { id: "r2", fromNodeId: "p50", toNodeId: "p53" },
  { id: "r3", fromNodeId: "p50", toNodeId: "p56" },
];

/** 🔴 참고 문서 둘이 서로를 가리킨다 — 기억하지 않으면 영영 안 끝난다. */
const REF_LOOP_EDGES: AutoAdvanceEdge[] = [
  { id: "r1", fromNodeId: "p45", toNodeId: "p50" },
  { id: "r3", fromNodeId: "p50", toNodeId: "p56" },
  { id: "r5", fromNodeId: "p56", toNodeId: "p50" },
];

/** 실행 행은 **참고 문서 빼고** 생긴다 — 시작할 때의 분류 그대로다. */
const REF_EXEC_NODES: AutoAdvanceCandidate[] = execNodes(
  ["y45", "p45", "COMPLETED"],
  ["y53", "p53", "PENDING"],
  ["y58", "p58", "PENDING"]
);

function advanceFromP45(edges: AutoAdvanceEdge[], executionNodes: AutoAdvanceCandidate[] = REF_EXEC_NODES) {
  return resolveAutoAdvanceTarget({
    completedGraphNodeId: "p45",
    isDecision: false,
    selectedOutgoingEdgeId: null,
    edges,
    graphNodes: REF_NODES,
    executionNodes,
  });
}

describe("🔴 참고 문서를 만나면 멈추지 말고 건너뛴다", () => {
  test("🔵 표본 확인 — 참고 문서에는 실행 행이 정말 없다", () => {
    for (const referenceNodeId of ["p50", "p56"]) {
      assert.equal(
        REF_EXEC_NODES.some((n) => n.graphNodeId === referenceNodeId),
        false,
        `${referenceNodeId} 에 실행 행이 있으면 「건너뛴다」를 재는 것이 아니다`
      );
    }
    assert.equal(REF_FANOUT_EDGES.filter((e) => e.fromNodeId === "p50").length, 2, "하나뿐이면 「갈래 여럿」을 못 잰다");
  });

  test("참고 문서 하나를 건너뛰어 **그다음**이 선다", () => {
    assert.deepEqual(advanceFromP45(REF_CHAIN_EDGES), {
      kind: "ADVANCE",
      executionNodeId: "y58",
      // 🔴 세운 노드로 **들어가는** 간선이다(사람이 고른 첫 간선 r1 이 아니다) —
      // 이력에 적히는 값이라 세운 노드로 안 가는 간선이면 줄이 앞뒤가 안 맞는다.
      viaEdgeId: "r2",
    });
  });

  test("참고 문서가 **연달아** 둘이어도 끝까지 건너뛴다", () => {
    assert.deepEqual(advanceFromP45(REF_DOUBLE_EDGES), {
      kind: "ADVANCE",
      executionNodeId: "y58",
      viaEdgeId: "r4",
    });
  });

  test("🔴 건너뛴 끝에서 갈래가 여럿이면 **안 세운다** — 어느 쪽인지는 사람만 안다", () => {
    // 실측 s31-50 이 바로 이 모양이다. 참고 문서는 판단이 아니므로 고른 갈래라는
    // 것이 없고, 첫째를 고르면 틀린 쪽이 1순위가 된다.
    assert.deepEqual(advanceFromP45(REF_FANOUT_EDGES), { kind: "SKIP", reason: "AMBIGUOUS_OUTGOING_EDGES" });
  });

  test("🔴 참고 문서가 고리를 이루면 돌지 않고 멈춘다", () => {
    // 이 시험이 깨지는 모습은 「실패」가 아니라 **시험이 안 끝나는 것**이다.
    assert.deepEqual(advanceFromP45(REF_LOOP_EDGES), { kind: "SKIP", reason: "REFERENCE_CHAIN_LOOPS" });
  });

  test("🔴 자기를 가리키는 참고 문서도 한 바퀴에 멈춘다", () => {
    assert.deepEqual(
      advanceFromP45([
        { id: "r1", fromNodeId: "p45", toNodeId: "p50" },
        { id: "r6", fromNodeId: "p50", toNodeId: "p50" },
      ]),
      { kind: "SKIP", reason: "REFERENCE_CHAIN_LOOPS" }
    );
  });

  test("읽고 끝나는 참고 문서(나가는 선 없음)는 갈 곳이 없다", () => {
    assert.deepEqual(advanceFromP45([{ id: "r1", fromNodeId: "p45", toNodeId: "p50" }]), {
      kind: "SKIP",
      reason: "NO_OUTGOING_EDGE",
    });
  });

  test("🔴 건너뛴 끝의 상태 판정은 그대로다 — 끝난 것을 되살리지 않는다", () => {
    assert.deepEqual(
      advanceFromP45(REF_CHAIN_EDGES, execNodes(["y45", "p45", "COMPLETED"], ["y58", "p58", "COMPLETED"])),
      { kind: "SKIP", reason: "TARGET_ALREADY_FINISHED" }
    );
    assert.deepEqual(
      advanceFromP45(REF_CHAIN_EDGES, execNodes(["y45", "p45", "COMPLETED"], ["y58", "p58", "BLOCKED"])),
      { kind: "SKIP", reason: "TARGET_BLOCKED" }
    );
  });

  test("판단에서 고른 갈래가 참고 문서를 가리켜도 건너뛴다", () => {
    assert.deepEqual(
      resolveAutoAdvanceTarget({
        completedGraphNodeId: "p45",
        isDecision: true,
        selectedOutgoingEdgeId: "r1",
        edges: REF_CHAIN_EDGES,
        graphNodes: REF_NODES,
        executionNodes: REF_EXEC_NODES,
      }),
      { kind: "ADVANCE", executionNodeId: "y58", viaEdgeId: "r2" }
    );
  });
});

describe("classifyAutoAdvanceTarget — 잠그기 전과 잠근 뒤가 같은 잣대를 쓴다", () => {
  test("다섯 상태를 빠짐없이 가른다", () => {
    assert.deepEqual(
      PROCEDURE_CASE_EXECUTION_NODE_STATUS_CODES.map((s) => [s, classifyAutoAdvanceTarget(s)]),
      [
        ["PENDING", null],
        ["IN_PROGRESS", "TARGET_ALREADY_IN_PROGRESS"],
        ["COMPLETED", "TARGET_ALREADY_FINISHED"],
        ["SKIPPED", "TARGET_ALREADY_FINISHED"],
        ["BLOCKED", "TARGET_BLOCKED"],
      ],
      "세울 수 있는 상태는 대기 하나뿐이다"
    );
  });
});
