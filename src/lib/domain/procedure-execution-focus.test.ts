import { describe, test } from "node:test";
import assert from "node:assert/strict";
import {
  classifyAutoAdvanceTarget,
  pickCurrentTask,
  pickCurrentTaskNode,
  resolveAutoAdvanceTarget,
  type AutoAdvanceCandidate,
  type AutoAdvanceEdge,
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
    const pick = pickCurrentTask(list);
    assert.equal(pick.kind, "IN_PROGRESS");
    assert.equal(pick.kind === "IN_PROGRESS" ? pick.node.id : null, "n3");
  });

  test("진행 중이 여럿이면 절차 차례가 가장 앞선 것(배열에서 먼저 나오는 것)", () => {
    const list = nodes(["n1", "COMPLETED"], ["n2", "IN_PROGRESS"], ["n3", "IN_PROGRESS"]);
    assert.equal(pickCurrentTaskNode(list)?.id, "n2");
  });

  test("진행 중이 없으면 대기 중 가장 앞선 것", () => {
    const list = nodes(["n1", "COMPLETED"], ["n2", "SKIPPED"], ["n3", "PENDING"], ["n4", "PENDING"]);
    const pick = pickCurrentTask(list);
    assert.equal(pick.kind, "PENDING");
    assert.equal(pick.kind === "PENDING" ? pick.node.id : null, "n3");
  });

  test("🔴 차단됨은 고르지 않는다 — 앞에 있어도 뒤의 대기를 고른다", () => {
    const list = nodes(["n1", "BLOCKED"], ["n2", "PENDING"]);
    assert.equal(pickCurrentTaskNode(list)?.id, "n2");
  });

  test("🔴 남은 것이 전부 차단됨이면 「지금 할 일 없음」 — 차단을 골라 채우지 않는다", () => {
    const list = nodes(["n1", "COMPLETED"], ["n2", "BLOCKED"], ["n3", "BLOCKED"]);
    const pick = pickCurrentTask(list);
    assert.deepEqual(pick, { kind: "NONE", reason: "ALL_BLOCKED" });
    assert.equal(pickCurrentTaskNode(list), null);
  });

  test("🔴 다 끝났으면 없음 — 차단됨과 다른 까닭으로 갈린다(화면 문구가 반대다)", () => {
    const list = nodes(["n1", "COMPLETED"], ["n2", "SKIPPED"]);
    assert.deepEqual(pickCurrentTask(list), { kind: "NONE", reason: "ALL_FINISHED" });
  });

  test("노드가 하나도 없으면 NO_NODES — 「다 끝났습니다」라고 하면 거짓말이다", () => {
    assert.deepEqual(pickCurrentTask([]), { kind: "NONE", reason: "NO_NODES" });
  });

  test("원본 배열을 건드리지 않는다", () => {
    const list = nodes(["n1", "PENDING"], ["n2", "IN_PROGRESS"]);
    const before = list.map((n) => n.id);
    pickCurrentTask(list);
    assert.deepEqual(list.map((n) => n.id), before, "여기서 다시 정렬하면 화면마다 차례가 달라진다");
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

function execNodes(...spec: [string, string | null, ProcedureCaseExecutionNodeStatus][]): AutoAdvanceCandidate[] {
  return spec.map(([id, procedureTemplateNodeId, status]) => ({ id, procedureTemplateNodeId, status }));
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
        completedTemplateNodeId: "t3",
        isDecision: true,
        selectedOutgoingEdgeId: "e4",
        edges: EDGES,
        executionNodes: ALL_PENDING,
      }),
      { kind: "ADVANCE", executionNodeId: "x5", viaEdgeId: "e4" }
    );
  });

  test("🔴 판단 — 다른 갈래(YES)를 고르면 다른 노드가 선다. 같은 입력에서 답이 갈려야 한다", () => {
    const yes = resolveAutoAdvanceTarget({
      completedTemplateNodeId: "t3",
      isDecision: true,
      selectedOutgoingEdgeId: "e3",
      edges: EDGES,
      executionNodes: ALL_PENDING,
    });
    assert.deepEqual(yes, { kind: "ADVANCE", executionNodeId: "x4", viaEdgeId: "e3" });
  });

  test("🔴 판단인데 고른 갈래가 이 노드에서 나가는 것이 아니면 아무것도 안 세운다 — 첫 간선으로 흘러가지 않는다", () => {
    for (const selectedOutgoingEdgeId of [null, "e1", "없는-간선"]) {
      assert.deepEqual(
        resolveAutoAdvanceTarget({
          completedTemplateNodeId: "t3",
          isDecision: true,
          selectedOutgoingEdgeId,
          edges: EDGES,
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
        completedTemplateNodeId: "t2",
        isDecision: false,
        selectedOutgoingEdgeId: null,
        edges: EDGES,
        executionNodes: ALL_PENDING,
      }),
      { kind: "ADVANCE", executionNodeId: "x3", viaEdgeId: "e2" }
    );
  });

  test("🔴 판단이 아닌데 나가는 간선이 여럿이면 아무것도 안 세운다 — 첫째를 고르면 틀린 쪽이 1순위가 된다", () => {
    assert.deepEqual(
      resolveAutoAdvanceTarget({
        completedTemplateNodeId: "t3",
        isDecision: false,
        selectedOutgoingEdgeId: null,
        edges: EDGES,
        executionNodes: ALL_PENDING,
      }),
      { kind: "SKIP", reason: "AMBIGUOUS_OUTGOING_EDGES" }
    );
  });

  test("나가는 간선이 없으면(END·그리다 만 가지) 안 세운다", () => {
    assert.deepEqual(
      resolveAutoAdvanceTarget({
        completedTemplateNodeId: "t4",
        isDecision: false,
        selectedOutgoingEdgeId: null,
        edges: EDGES,
        executionNodes: ALL_PENDING,
      }),
      { kind: "SKIP", reason: "NO_OUTGOING_EDGE" }
    );
  });

  test("끝낸 것이 사례별 추가 작업이면 그래프에 자리가 없다", () => {
    assert.deepEqual(
      resolveAutoAdvanceTarget({
        completedTemplateNodeId: null,
        isDecision: false,
        selectedOutgoingEdgeId: null,
        edges: EDGES,
        executionNodes: ALL_PENDING,
      }),
      { kind: "SKIP", reason: "NOT_IN_GRAPH" }
    );
  });

  test("간선이 가리키는 노드에 실행 행이 없으면(참고 문서) 안 세운다", () => {
    assert.deepEqual(
      resolveAutoAdvanceTarget({
        completedTemplateNodeId: "t2",
        isDecision: false,
        selectedOutgoingEdgeId: null,
        edges: EDGES,
        // t3 의 실행 행을 뺀 판 — 참고 문서는 실행 행을 만들지 않는다.
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
        completedTemplateNodeId: "t5",
        isDecision: false,
        selectedOutgoingEdgeId: null,
        edges: EDGES,
        executionNodes: afterLoop,
      }),
      { kind: "SKIP", reason: "TARGET_ALREADY_FINISHED" }
    );
  });

  test("🔴 건너뛴 노드도 되살리지 않는다 — 건너뜀은 사람이 「안 한다」고 정한 것이다", () => {
    assert.deepEqual(
      resolveAutoAdvanceTarget({
        completedTemplateNodeId: "t2",
        isDecision: false,
        selectedOutgoingEdgeId: null,
        edges: EDGES,
        executionNodes: execNodes(["x2", "t2", "COMPLETED"], ["x3", "t3", "SKIPPED"]),
      }),
      { kind: "SKIP", reason: "TARGET_ALREADY_FINISHED" }
    );
  });

  test("🔴 다음 것이 차단됨이면 자동으로 풀지 않는다", () => {
    assert.deepEqual(
      resolveAutoAdvanceTarget({
        completedTemplateNodeId: "t2",
        isDecision: false,
        selectedOutgoingEdgeId: null,
        edges: EDGES,
        executionNodes: execNodes(["x2", "t2", "COMPLETED"], ["x3", "t3", "BLOCKED"]),
      }),
      { kind: "SKIP", reason: "TARGET_BLOCKED" }
    );
  });

  test("🔴 다음 것이 이미 진행 중이면 건드리지 않는다 — 남이 하고 있는 일이다", () => {
    assert.deepEqual(
      resolveAutoAdvanceTarget({
        completedTemplateNodeId: "t2",
        isDecision: false,
        selectedOutgoingEdgeId: null,
        edges: EDGES,
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
      completedTemplateNodeId: "t2",
      isDecision: false,
      selectedOutgoingEdgeId: null,
      edges: EDGES,
      executionNodes: execNodes(["x2", "t2", "COMPLETED"], ["x3", "t3", "PENDING"], ["x4", "t4", "IN_PROGRESS"]),
    });
    assert.deepEqual(decision, { kind: "ADVANCE", executionNodeId: "x3", viaEdgeId: "e2" });
    assert.deepEqual(Object.keys(decision).sort(), ["executionNodeId", "kind", "viaEdgeId"]);
  });

  test("간선을 템플릿 전체로 줘도 끝낸 노드에서 나가는 것만 본다", () => {
    const extra: AutoAdvanceEdge[] = [...EDGES, { id: "e9", fromNodeId: "t9", toNodeId: "t4" }];
    assert.deepEqual(
      resolveAutoAdvanceTarget({
        completedTemplateNodeId: "t2",
        isDecision: false,
        selectedOutgoingEdgeId: null,
        edges: extra,
        executionNodes: ALL_PENDING,
      }),
      { kind: "ADVANCE", executionNodeId: "x3", viaEdgeId: "e2" }
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
