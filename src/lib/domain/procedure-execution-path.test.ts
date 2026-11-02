import { describe, test } from "node:test";
import assert from "node:assert/strict";
import {
  collectEndNodeIds,
  collectStartNodeIds,
  computeExecutionProgress,
  describeExecutionProgressBasis,
  executionProgressPercent,
  findShortestTemplatePath,
  formatExecutionProgressLabel,
  resolveJumpPath,
  type PathTemplateEdge,
  type PathTemplateNode,
  type ProgressExecutionNode,
} from "./procedure-execution-path";

/**
 * 절차 그림 위의 **최단 경로**와 그것으로 다시 센 진행률(2026-11-02, 조각 11).
 *
 * 🔴 이 묶음이 꼭 잡아야 하는 것 넷:
 *   ㉠ 고리가 있어도 **끝난다**. 실패가 아니라 「시험이 안 끝나는 것」으로
 *      나타나는 종류라, 고리를 넣은 표본이 반드시 있어야 한다.
 *   ㉡ 최단 경로가 여럿일 때 **늘 같은 답**. 아무것이나 고르면 같은 화면을 두
 *      번 열 때 완료되는 노드가 달라지는데, 그런 결함은 오류를 안 낸다.
 *   ㉢ **세는 잣대** — START·참고 문서는 안 세고 END 는 센다(실측 근거는 원본
 *      파일 머리말).
 *   ㉣ 경로를 못 찾으면 **옛 방식으로 떨어진다**. 실측 절차 하나가 늘 그 모습이다.
 */

// ---- 표본 ----

/**
 * 실측을 닮은 한 절차. 지시서의 그림 그대로다.
 *
 *   START → a → b → c → d → (참고) → END
 *                ╲          ╲
 *                 → x → END   → b   ← 🔴 「재측정」이 되돌아가는 고리
 *
 * 🔴 참고 문서(ref)를 길 한가운데 둔 까닭: 실행 줄이 없는 칸이라 **경로에는
 * 들어가되 세지는 않는다**. 둘을 한 표본에서 같이 재지 않으면 「경로에서 빼
 * 버리는」 잘못된 구현이 그대로 통과한다.
 */
const NODES: PathTemplateNode[] = [
  { id: "s", nodeType: "START" },
  { id: "a", nodeType: "TASK" },
  { id: "b", nodeType: "DECISION" },
  { id: "c", nodeType: "TASK" },
  { id: "d", nodeType: "INSPECTION" },
  { id: "x", nodeType: "TASK" },
  { id: "ref", nodeType: "DOCUMENT_REFERENCE" },
  { id: "end", nodeType: "END" },
];

const EDGES: PathTemplateEdge[] = [
  { id: "e0", fromNodeId: "s", toNodeId: "a", sortOrder: 0 },
  { id: "e1", fromNodeId: "a", toNodeId: "b", sortOrder: 1 },
  { id: "e2", fromNodeId: "b", toNodeId: "c", sortOrder: 2 },
  { id: "e3", fromNodeId: "c", toNodeId: "d", sortOrder: 3 },
  { id: "e4", fromNodeId: "d", toNodeId: "ref", sortOrder: 4 },
  { id: "e5", fromNodeId: "ref", toNodeId: "end", sortOrder: 5 },
  { id: "e6", fromNodeId: "b", toNodeId: "x", sortOrder: 6 },
  { id: "e7", fromNodeId: "x", toNodeId: "end", sortOrder: 7 },
  // 🔴 고리 — d 에서 판단 b 로 되돌아간다(「재측정」).
  { id: "e8", fromNodeId: "d", toNodeId: "b", sortOrder: 8 },
];

/** 실행 줄 — START 와 참고 문서에는 줄이 안 생긴다(getExecutionDetail 과 같은 잣대). */
function execNodes(overrides: Record<string, ProgressExecutionNode["status"]> = {}): ProgressExecutionNode[] {
  return ["a", "b", "c", "d", "x", "end"].map((templateNodeId) => ({
    id: `exec-${templateNodeId}`,
    procedureTemplateNodeId: templateNodeId,
    status: overrides[templateNodeId] ?? "PENDING",
  }));
}

describe("🔵 표본이 재려는 모양인가 — 먼저 확인한다", () => {
  test("시작점 하나 · 끝점 하나 · 참고 문서 하나 · 고리 하나", () => {
    assert.deepEqual(collectStartNodeIds(NODES), ["s"]);
    assert.deepEqual(collectEndNodeIds(NODES), ["end"]);
    assert.equal(NODES.filter((n) => n.nodeType === "DOCUMENT_REFERENCE").length, 1);
    // 고리가 **정말로** 있어야 아래 「안 멈춘다」가 무언가를 잰다.
    assert.ok(EDGES.some((e) => e.fromNodeId === "d" && e.toNodeId === "b"), "고리 간선이 표본에서 빠졌다");
  });

  test("실행 줄은 여섯 — START 와 참고 문서는 줄이 없다", () => {
    const ids = execNodes().map((n) => n.procedureTemplateNodeId);
    assert.deepEqual(ids, ["a", "b", "c", "d", "x", "end"]);
    assert.ok(!ids.includes("s") && !ids.includes("ref"));
  });
});

describe("최단 경로를 찾는다", () => {
  test("곧은 길 — 양끝을 포함해 돌려준다", () => {
    const path = findShortestTemplatePath({ nodes: NODES, edges: EDGES, fromNodeIds: ["s"], toNodeIds: ["c"] });
    assert.deepEqual(path, ["s", "a", "b", "c"]);
  });

  test("🔴 **짧은 쪽**을 고른다 — 먼저 적힌 쪽이 아니다", () => {
    // b → x → end 가 2걸음, b → c → d → ref → end 가 4걸음이다. 간선 차례로는
    // c 쪽(e2)이 x 쪽(e6)보다 앞서 적혀 있으므로, 길이를 안 보면 긴 쪽이 나온다.
    const path = findShortestTemplatePath({ nodes: NODES, edges: EDGES, fromNodeIds: ["b"], toNodeIds: ["end"] });
    assert.deepEqual(path, ["b", "x", "end"]);
  });

  test("🔴 고리가 있어도 **끝난다** — 되돌아가는 간선을 지나 끝점을 찾는다", () => {
    // d → b 로 되돌아가는 간선이 있다. 본 노드를 안 기억하면 여기서 안 끝난다
    // (실패가 아니라 시험이 영영 안 끝나는 것으로 나타난다).
    const path = findShortestTemplatePath({ nodes: NODES, edges: EDGES, fromNodeIds: ["d"], toNodeIds: ["end"] });
    assert.deepEqual(path, ["d", "ref", "end"]);

    // 🔵 고리만 있고 끝점으로 나가는 길이 없을 때도 끝난다 — 「없다」로 끝나야지
    //    영영 돌면 안 된다.
    const loopOnly: PathTemplateEdge[] = [
      { id: "l1", fromNodeId: "a", toNodeId: "b", sortOrder: 0 },
      { id: "l2", fromNodeId: "b", toNodeId: "a", sortOrder: 1 },
      { id: "l3", fromNodeId: "s", toNodeId: "a", sortOrder: 2 },
    ];
    assert.equal(findShortestTemplatePath({ nodes: NODES, edges: loopOnly, fromNodeIds: ["s"], toNodeIds: ["end"] }), null);
  });

  test("🔴 길이 없으면 **null** — 빈 배열이 아니다", () => {
    // 그리다 만 절차의 모습이다(실측 「원복 검사」는 노드 23에 간선 8개라
    // START 에서 닿는 노드가 9개뿐이다).
    assert.equal(findShortestTemplatePath({ nodes: NODES, edges: [], fromNodeIds: ["s"], toNodeIds: ["end"] }), null);
    // 끝점이 아예 없는 절차 — 실측 「원복 검사」가 그렇다.
    assert.equal(
      findShortestTemplatePath({ nodes: NODES, edges: EDGES, fromNodeIds: ["s"], toNodeIds: collectEndNodeIds(NODES.filter((n) => n.nodeType !== "END")) }),
      null
    );
    // 모르는 칸을 물으면 null — 남의 절차 노드 id 가 날아들 수 있다.
    assert.equal(findShortestTemplatePath({ nodes: NODES, edges: EDGES, fromNodeIds: ["s"], toNodeIds: ["없는칸"] }), null);
  });

  test("출발점이 곧 끝점이면 한 칸짜리 경로", () => {
    assert.deepEqual(findShortestTemplatePath({ nodes: NODES, edges: EDGES, fromNodeIds: ["end"], toNodeIds: ["end"] }), ["end"]);
  });
});

/**
 * 🔴 이 묶음이 이 조각에서 **가장 조용한 결함**을 막는다.
 *
 * 길이가 같은 길이 여럿일 때 아무것이나 고르면, 같은 화면을 두 번 열어도 완료되는
 * 노드가 달라진다 — 오류가 안 나고 아무도 신고하지 않는다. 그래서 「같은 입력이면
 * 같은 답」만 재지 않고 **무엇이 차례를 정하는지**까지 잰다(간선 sortOrder →
 * 간선 id).
 */
describe("🔴 최단 경로가 여럿일 때 — 늘 같은 하나를 고른다", () => {
  const diamond: PathTemplateNode[] = [
    { id: "s", nodeType: "START" },
    { id: "p", nodeType: "TASK" },
    { id: "q", nodeType: "TASK" },
    { id: "r", nodeType: "END" },
  ];

  /** s → p → r 과 s → q → r 이 **둘 다 2걸음**이다. */
  function diamondEdges(firstHop: "p" | "q"): PathTemplateEdge[] {
    return [
      { id: "d-sp", fromNodeId: "s", toNodeId: "p", sortOrder: firstHop === "p" ? 0 : 1 },
      { id: "d-sq", fromNodeId: "s", toNodeId: "q", sortOrder: firstHop === "q" ? 0 : 1 },
      { id: "d-pr", fromNodeId: "p", toNodeId: "r", sortOrder: 2 },
      { id: "d-qr", fromNodeId: "q", toNodeId: "r", sortOrder: 3 },
    ];
  }

  test("🔵 먼저 — 표본의 두 길이 정말 **같은 길이**다", () => {
    const viaP = findShortestTemplatePath({ nodes: diamond, edges: diamondEdges("p"), fromNodeIds: ["s"], toNodeIds: ["p"] });
    const viaQ = findShortestTemplatePath({ nodes: diamond, edges: diamondEdges("p"), fromNodeIds: ["s"], toNodeIds: ["q"] });
    assert.equal(viaP?.length, viaQ?.length, "길이가 다르면 이 묶음은 아무것도 안 잰다");
  });

  test("간선 **sortOrder** 가 앞선 갈래를 탄다", () => {
    assert.deepEqual(findShortestTemplatePath({ nodes: diamond, edges: diamondEdges("p"), fromNodeIds: ["s"], toNodeIds: ["r"] }), ["s", "p", "r"]);
    // 🔴 차례를 뒤집으면 **답도 바뀐다** — 안 바뀌면 sortOrder 를 안 보고 있는 것이다.
    assert.deepEqual(findShortestTemplatePath({ nodes: diamond, edges: diamondEdges("q"), fromNodeIds: ["s"], toNodeIds: ["r"] }), ["s", "q", "r"]);
  });

  test("🔴 배열에 적힌 차례가 바뀌어도 답은 같다 — sortOrder 가 정한다", () => {
    const edges = diamondEdges("p");
    const shuffled = [...edges].reverse();
    assert.deepEqual(
      findShortestTemplatePath({ nodes: diamond, edges: shuffled, fromNodeIds: ["s"], toNodeIds: ["r"] }),
      ["s", "p", "r"],
      "입력 차례가 답을 바꾸면 같은 화면이 열 때마다 다른 노드를 완료한다"
    );
  });

  test("sortOrder 가 겹치면 **간선 id** 가 가른다 — sort_order 에는 유니크 제약이 없다", () => {
    const tied: PathTemplateEdge[] = [
      { id: "zzz", fromNodeId: "s", toNodeId: "p", sortOrder: 0 },
      { id: "aaa", fromNodeId: "s", toNodeId: "q", sortOrder: 0 },
      { id: "d-pr", fromNodeId: "p", toNodeId: "r", sortOrder: 1 },
      { id: "d-qr", fromNodeId: "q", toNodeId: "r", sortOrder: 1 },
    ];
    assert.deepEqual(findShortestTemplatePath({ nodes: diamond, edges: tied, fromNodeIds: ["s"], toNodeIds: ["r"] }), ["s", "q", "r"]);
    // 열 번 불러도 같은 답 — 흔들리면 여기서 걸린다.
    for (let i = 0; i < 10; i += 1) {
      assert.deepEqual(findShortestTemplatePath({ nodes: diamond, edges: tied, fromNodeIds: ["s"], toNodeIds: ["r"] }), ["s", "q", "r"]);
    }
  });
});

describe("옮기면 지나온 길이 어느 줄인가", () => {
  test("🔴 고른 줄 자신은 빠진다 — 그 줄은 진행 중이 된다", () => {
    const result = resolveJumpPath({
      templateNodes: NODES,
      edges: EDGES,
      executionNodes: execNodes(),
      targetExecutionNodeId: "exec-c",
    });
    assert.equal(result.found, true);
    assert.deepEqual(result.executionNodeIds, ["exec-a", "exec-b"]);
  });

  test("🔴 START 와 참고 문서는 길 위에 있어도 **안 들어간다**", () => {
    // 🔴 START 에는 실행 줄이 **정말로 있다**(만들 때 바로 COMPLETED). 쓰기 쪽은
    // 실행의 모든 줄을 그대로 읽어 넘기므로, 그 줄이 섞인 모습으로 재야 한다 —
    // 화면이 보는 배열(START 가 빠진 것)로만 재면 걸러내기가 돌지 않아도 통과한다.
    const withSystemRows: ProgressExecutionNode[] = [
      { id: "exec-s", procedureTemplateNodeId: "s", status: "COMPLETED" },
      ...execNodes(),
    ];
    // 지름길(b → x)을 걷어 **참고 문서를 지나는 길**이 최단이 되게 한다.
    const throughRef = EDGES.filter((e) => e.id !== "e6" && e.id !== "e7");

    const result = resolveJumpPath({
      templateNodes: NODES,
      edges: throughRef,
      executionNodes: withSystemRows,
      targetExecutionNodeId: "exec-end",
    });
    assert.equal(result.found, true);
    // 지나는 칸은 s → a → b → c → d → ref → end 인데, 돌려주는 것은 넷뿐이다.
    assert.deepEqual(result.executionNodeIds, ["exec-a", "exec-b", "exec-c", "exec-d"]);
    assert.ok(!result.executionNodeIds.includes("exec-s"), "START 가 완료 대상에 들어갔다");
  });

  test("🔴 상태는 안 본다 — 끝난 줄을 가리는 것은 planNodeJump 의 몫이다", () => {
    const result = resolveJumpPath({
      templateNodes: NODES,
      edges: EDGES,
      executionNodes: execNodes({ a: "COMPLETED", b: "BLOCKED" }),
      targetExecutionNodeId: "exec-c",
    });
    assert.deepEqual(result.executionNodeIds, ["exec-a", "exec-b"], "두 자리가 같은 것을 두 번 가르면 잣대가 갈린다");
  });

  test("🔴 길을 못 찾으면 **found: false** 이고 한 줄도 안 돌려준다", () => {
    const noEdges = resolveJumpPath({ templateNodes: NODES, edges: [], executionNodes: execNodes(), targetExecutionNodeId: "exec-c" });
    assert.equal(noEdges.found, false);
    assert.deepEqual(noEdges.executionNodeIds, []);
  });

  test("🔵 사례별 추가 작업으로 옮기면 길이라는 말이 성립하지 않는다", () => {
    const withExtra = [...execNodes(), { id: "exec-extra", procedureTemplateNodeId: null, status: "PENDING" as const }];
    const result = resolveJumpPath({ templateNodes: NODES, edges: EDGES, executionNodes: withExtra, targetExecutionNodeId: "exec-extra" });
    assert.equal(result.found, false);
    assert.deepEqual(result.executionNodeIds, []);
  });

  test("🔵 바로 첫 작업으로 옮기면 길은 **찾았는데** 지날 줄이 없다", () => {
    const result = resolveJumpPath({ templateNodes: NODES, edges: EDGES, executionNodes: execNodes(), targetExecutionNodeId: "exec-a" });
    assert.equal(result.found, true, "「길이 없다」와 「지날 줄이 없다」는 다른 일이다");
    assert.deepEqual(result.executionNodeIds, []);
  });
});

describe("🔴 진행률을 경로 기준으로 센다", () => {
  function progressOf(templateNodeId: string, overrides: Record<string, ProgressExecutionNode["status"]> = {}) {
    return computeExecutionProgress({
      nodes: execNodes(overrides),
      templateNodes: NODES,
      edges: EDGES,
      currentExecutionNodeId: `exec-${templateNodeId}`,
    });
  }

  test("시작점 → 지금 → 끝점에서 **몇 번째**인가", () => {
    // s → a → b → c → d → (참고) → end. 참고 문서는 안 센다.
    const progress = progressOf("c");
    assert.deepEqual(progress, { basis: "PATH", current: 3, total: 5 });
  });

  test("🔴 **짧은 길이면 더 많이 온 것**이다 — 같은 걸음인데 수가 다르다", () => {
    const viaC = progressOf("c");
    const viaX = progressOf("x");
    assert.equal(viaC.basis, "PATH");
    assert.equal(viaX.basis, "PATH");
    if (viaC.basis !== "PATH" || viaX.basis !== "PATH") return;

    // 둘 다 시작점에서 세 번째 줄이다 — 다른 것은 **남은 길의 길이**뿐이다.
    assert.equal(viaC.current, 3);
    assert.equal(viaX.current, 3);
    assert.equal(viaC.total, 5, "긴 갈래");
    assert.equal(viaX.total, 4, "짧은 갈래");
    assert.ok(
      executionProgressPercent(viaX) > executionProgressPercent(viaC),
      "짧은 길로 갔는데 퍼센트가 더 낮으면 이 조각이 한 일이 없다"
    );
  });

  test("끝점에 서면 100%", () => {
    const progress = progressOf("end");
    assert.deepEqual(progress, { basis: "PATH", current: 4, total: 4 });
    assert.equal(executionProgressPercent(progress), 100);
  });

  test("🔴 **자리가 앞으로 가면 퍼센트가 줄어든다** — 되돌아갔다는 것이 수에 보여야 한다", () => {
    // 「재측정」으로 앞쪽 a 까지 되돌아간 모습과, d 까지 간 모습.
    const back = progressOf("a");
    const forward = progressOf("d");
    assert.equal(back.basis, "PATH");
    assert.equal(forward.basis, "PATH");
    if (back.basis !== "PATH" || forward.basis !== "PATH") return;
    assert.equal(back.current, 1, "자리가 앞으로 갔으면 번호도 앞이어야 한다");
    assert.ok(
      executionProgressPercent(back) < executionProgressPercent(forward),
      "되돌아갔는데 퍼센트가 그대로면 「어디쯤인가」를 아무것도 안 알려 준다"
    );
  });

  test("🔴 끝낸 수가 **퍼센트를 올리지 않는다** — 자리만이 정한다", () => {
    const none = progressOf("c");
    const many = progressOf("c", { a: "COMPLETED", b: "COMPLETED", d: "SKIPPED", x: "SKIPPED" });
    assert.deepEqual(none, many, "같은 자리면 끝낸 수가 달라도 같은 수여야 한다");
  });
});

describe("🔴 경로를 못 찾으면 옛 방식으로 떨어진다", () => {
  const COUNT_NODES = execNodes({ a: "COMPLETED", b: "COMPLETED" });

  test("지금 할 일이 없으면 끝낸 수 기준", () => {
    const progress = computeExecutionProgress({
      nodes: COUNT_NODES,
      templateNodes: NODES,
      edges: EDGES,
      currentExecutionNodeId: null,
    });
    assert.equal(progress.basis, "COUNT");
    if (progress.basis !== "COUNT") return;
    assert.deepEqual(progress.position, { total: 6, finished: 2, current: 3 });
  });

  test("🔴 끝점이 **아예 없는** 절차 — 실측 「원복 검사」가 그 모습이다", () => {
    const noEnd = NODES.filter((n) => n.nodeType !== "END");
    const progress = computeExecutionProgress({
      nodes: COUNT_NODES,
      templateNodes: noEnd,
      edges: EDGES,
      currentExecutionNodeId: "exec-c",
    });
    assert.equal(progress.basis, "COUNT", "끝점이 없으면 경로라는 말이 성립하지 않는다");
  });

  test("선이 하나도 없으면 — 그리다 만 절차", () => {
    const progress = computeExecutionProgress({ nodes: COUNT_NODES, templateNodes: NODES, edges: [], currentExecutionNodeId: "exec-c" });
    assert.equal(progress.basis, "COUNT");
  });

  test("지금 할 일이 **사례별 추가 작업**이면 — 그림에 자리가 없다", () => {
    const withExtra = [...execNodes(), { id: "exec-extra", procedureTemplateNodeId: null, status: "IN_PROGRESS" as const }];
    const progress = computeExecutionProgress({
      nodes: withExtra,
      templateNodes: NODES,
      edges: EDGES,
      currentExecutionNodeId: "exec-extra",
    });
    assert.equal(progress.basis, "COUNT");
  });

  test("🔵 떨어진 퍼센트는 **전과 똑같다** — 완료+건너뜀 / 전체", () => {
    const progress = computeExecutionProgress({
      nodes: execNodes({ a: "COMPLETED", b: "SKIPPED", c: "COMPLETED" }),
      templateNodes: NODES,
      edges: [],
      currentExecutionNodeId: "exec-d",
    });
    assert.equal(executionProgressPercent(progress), 50, "3 / 6 — 옛 화면이 그리던 바로 그 수");
  });
});

describe("무엇을 센 수인지 글자로 갈린다", () => {
  test("🔴 경로 기준에는 「전체」라는 낱말을 안 쓴다 — 수치 줄의 「전체 N」과 다른 수다", () => {
    const label = formatExecutionProgressLabel({ basis: "PATH", current: 3, total: 6 });
    assert.equal(label, "이 길에서 3번째 / 6단계");
    assert.ok(!label?.includes("전체"), "나란히 선 두 수가 같은 것을 재는 줄로 읽힌다");
  });

  test("🔴 옛 잣대로 떨어졌으면 **그 사실이 적힌다**", () => {
    const label = formatExecutionProgressLabel({ basis: "COUNT", position: { total: 22, finished: 2, current: 3 } });
    assert.equal(label, "3번째 / 전체 22 · 끝낸 수 기준");
  });

  test("🔵 다 끝났을 때는 잣대를 안 붙인다 — 「끝」이 묻힌다", () => {
    assert.equal(formatExecutionProgressLabel({ basis: "COUNT", position: { total: 5, finished: 5, current: null } }), "5 / 5 · 끝");
  });

  test("노드가 하나도 없으면 적을 글자가 없다", () => {
    assert.equal(formatExecutionProgressLabel({ basis: "COUNT", position: { total: 0, finished: 0, current: null } }), null);
  });

  test("🔵 까닭 한 줄도 잣대마다 다르다 — title 로 붙는다", () => {
    const path = describeExecutionProgressBasis({ basis: "PATH", current: 1, total: 2 });
    const count = describeExecutionProgressBasis({ basis: "COUNT", position: { total: 2, finished: 0, current: 1 } });
    assert.notEqual(path, count);
    assert.match(path, /최단 경로/);
    assert.match(count, /끝낸 작업 수/);
  });

  test("퍼센트는 0 으로 안 나눈다", () => {
    assert.equal(executionProgressPercent({ basis: "PATH", current: 0, total: 0 }), 0);
    assert.equal(executionProgressPercent({ basis: "COUNT", position: { total: 0, finished: 0, current: null } }), 0);
  });
});
