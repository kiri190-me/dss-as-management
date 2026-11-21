import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  findEdgesAttachedToNode,
  planProcedureNodeDeletionOperations,
} from "@/lib/domain/procedure-editor-node-deletion";
import {
  coalescePendingStructuralOperations,
  planProcedureStructuralSteps,
  PROCEDURE_STRUCTURAL_PHASE_ORDER,
  makeTempEdgeId,
  type PendingStructuralOperation,
} from "@/lib/domain/procedure-editor-structural-changes";
import {
  previewPendingStructuralGraph,
  type StructuralPreviewFactories,
} from "@/lib/domain/procedure-editor-structural-preview";

/**
 * ============================================================================
 * 「진단 Flowchart」 편집기 — **노드를 지우면 붙은 연결선도 함께** (2026-11-21, 조각 C3)
 * ============================================================================
 * 쓰는 분의 결정(원문): 「노드를 지우면 연결된 연결선도 지워지는 거로 하자(연결선을
 * 지우지 않아도 노드를 지울 수 있도록).」 같은 날 아침 「기술 작업 절차」 편집기가
 * 먼저 그렇게 바뀌었고(커밋 1972ab29), 이번에 진단 쪽도 같게 만들었다.
 *
 * 🔴 **그리고 앞뒤를 다시 잇지 않는다** — 이것도 쓰는 분이 글자로 못 박았다:
 * 「중간에 연결된 노드를 삭제하면 앞뒤 노드는 연결되지 않은채로 둬줘.」 A→B→C 에서
 * B 를 지우면 선 둘이 다 사라지고 **끝**이다. A→C 를 대신 그어 주지 않는다.
 *
 * ── 이 파일이 재는 것 두 갈래 ────────────────────────────────────────────
 *  ㉮ **값**: 무엇이 쌓이고, 무엇이 **안** 쌓이는가. 쌓을 줄을 정하는 순수 함수는
 *     절차와 **같은 한 벌**(procedure-editor-node-deletion.ts)이라 「붙은 선을 전부
 *     잡는가」 같은 기본은 그쪽 시험이 이미 값으로 잰다. 여기서는 **이 기능에서만
 *     틀릴 수 있는 것**을 잰다 — 앞뒤를 다시 잇지 않는가, 보낼 차례가 선 먼저인가,
 *     그 차례가 서버 관문을 실제로 비켜 가는가.
 *  ㉯ **글자**: 화면이 그 판정을 제대로 물었는가.
 *
 * ── 🔴 여기서 가장 조용히 깨지는 것 ─────────────────────────────────────
 *  ① **앞뒤를 다시 이어 주는 것.** 「친절한 기본값」처럼 보여서 들어오기 쉽고,
 *     들어와도 오류가 안 난다 — 사람이 그림을 보고서야 「안 시킨 선」을 발견한다.
 *     그리고 그 선은 [저장]과 함께 서버에 진짜로 생긴다. (③절)
 *  ② **쌓는 호출이 둘로 쪼개지는 것.** 그 순간 [이전] 한 칸이 아니게 된다 —
 *     한 번 눌러도 노드만(또는 선만) 돌아온다. (⑤절)
 *  ③ **딸려 지워지는 선의 초안·경로점을 안 버리는 것.** [저장]이 **없는 선**에
 *     값을 쓰려 들어 **저장 전체가 실패한다.** 절차 쪽에서 실제로 겪은 결함이다. (⑤절)
 *  ④ **초안을 안 얹은 목록에서 선을 찾는 것.** 이 편집기는 연결선 재연결을 구조
 *     조작이 아니라 **초안 지도**로 들고 있어(RETARGET_EDGE 를 안 쌓는다),
 *     structuralPreview.edges 는 저장 전에 옮긴 선의 **옛 양 끝**을 들고 있다. (⑤절)
 *  ⑤ **보낼 차례가 뒤집히는 것.** 서버는 선이 붙은 노드를 여전히 거절한다 —
 *     차례가 이 기능을 떠받치는 유일한 받침이다. (④절)
 *
 * ── 왜 화면은 렌더가 아니라 원본을 읽는가 ───────────────────────────────
 * CaseFlowchartEditorScreen 은 @xyflow/react 의 .css 와 서버 액션(→ server-only)을
 * 사슬로 물고 있어 어느 목록에서도 import 자체가 던진다. 이웃
 * case-flowchart-delete-key-ui.test.ts · case-flowchart-structural-deferred-save.test.ts
 * 가 같은 사정에서 같은 방식을 쓴다.
 * ============================================================================
 */

const repoUrl = new URL("../../../../", import.meta.url);
const read = (relativePath: string) => readFileSync(new URL(relativePath, repoUrl), "utf8");

/**
 * 🔴 **차례가 중요하다** — 블록 주석을 **먼저** 걷는다(이웃
 * case-flowchart-structural-deferred-save.test.ts 가 겪은 그것이다). JSX 주석을 먼저
 * 걷으면 그 꼴이 「여는 중괄호 바로 뒤의 블록 주석」에도 걸려, 프롭 타입 묶음에서
 * 파일 끝까지를 통째로 삼킨다.
 */
function stripComments(source: string): string {
  return source
    .split(/\r?\n/)
    .filter((line) => !/^\s*\/\//.test(line)) // 줄 주석
    .join("\n")
    .replace(/\/\*[\s\S]*?\*\//g, " ") // 블록 주석(JSX 주석의 속도 여기서 걷힌다)
    .replace(/\{\s*\}/g, " "); // 속이 걷히고 남은 빈 JSX 주석 자리
}

/** 줄바꿈·들여쓰기 차이로 시험이 깨지지 않도록 공백을 하나로 접는다. */
const flat = (source: string) => source.replace(/\s+/g, " ");

/** `start` 로 시작해 괄호 깊이가 0으로 돌아올 때까지 — 함수 하나의 몸통만 떼어 낸다. */
function functionBody(source: string, start: string): string {
  const from = source.indexOf(start);
  assert.notEqual(from, -1, `원본에서 ${start} 를 못 찾았다 — 이름이 바뀌었으면 시험도 함께 고쳐야 한다`);
  const open = source.indexOf("{", from);
  let depth = 0;
  for (let i = open; i < source.length; i += 1) {
    if (source[i] === "{") depth += 1;
    else if (source[i] === "}") {
      depth -= 1;
      if (depth === 0) return source.slice(from, i + 1);
    }
  }
  assert.fail(`${start} 의 몸통이 안 닫혔다`);
}

/** 글자가 몇 번 나오는가. 「호출이 하나뿐인가」처럼 **수**가 뜻을 갖는 자리에서 쓴다. */
function countOf(haystack: string, needle: string): number {
  let count = 0;
  let at = haystack.indexOf(needle);
  while (at !== -1) {
    count += 1;
    at = haystack.indexOf(needle, at + needle.length);
  }
  return count;
}

const PATHS = {
  screen: "src/components/repair-cases/flowchart/CaseFlowchartEditorScreen.tsx",
  nodePanel: "src/components/repair-cases/flowchart/CaseFlowchartNodePropertyPanel.tsx",
  plan: "src/lib/domain/procedure-editor-node-deletion.ts",
  serverMutation: "src/lib/db/mutations/repair-case-flowchart-graph.ts",
} as const;

const screenRaw = read(PATHS.screen);
const screen = stripComments(screenRaw);
const f = flat(screen);
const nodePanelRaw = read(PATHS.nodePanel);
const nodePanel = flat(stripComments(nodePanelRaw));
const planModule = stripComments(read(PATHS.plan));
const serverMutation = stripComments(read(PATHS.serverMutation));

/** 삭제를 쌓는 손잡이 하나. 아래 여러 절이 **이 몸통 안에서만** 센다. */
const deleteNodeFn = flat(functionBody(screen, "function handleDeleteNode(nodeId: string)"));
const deleteEdgeFn = flat(functionBody(screen, "function handleDeleteEdge(edgeId: string)"));

// ==================== ㉮ 값으로 재는 쪽 — 진단 행 모양 그대로 ====================

/**
 * 🔴 진단 노드·연결선 행에는 `sortOrder` 칸이 없다(그 사실 자체는 이웃
 * case-flowchart-structural-deferred-save.test.ts ①절이 원본에서 잰다). 아래 가짜
 * 행은 화면이 실제로 쓰는 CaseFlowchartGraphNode / CaseFlowchartGraphEdge 와 같은
 * 모양이고, 미리보기가 그 모양으로도 도는 것은 같은 이웃이 이미 확인했다.
 */
type FakeNode = { id: string; nodeType: string; title: string; description: string | null; instructions: string | null; positionX: number; positionY: number };
type FakeEdge = { id: string; fromNodeId: string; toNodeId: string; branchType: string; branchLabel: string | null; routePoints: null };

const fakeFactories: StructuralPreviewFactories<FakeNode, FakeEdge> = {
  createNode: (seed) => ({
    id: seed.id,
    nodeType: seed.nodeType,
    title: seed.title,
    description: null,
    instructions: null,
    positionX: seed.position ? seed.position.x : 0,
    positionY: seed.position ? seed.position.y : 0,
  }),
  createEdge: (seed) => ({
    id: seed.id,
    fromNodeId: seed.fromNodeId,
    toNodeId: seed.toNodeId,
    branchType: seed.branchType,
    branchLabel: seed.branchLabel,
    routePoints: null,
  }),
  changeNodeType: (node, newNodeType) => ({ ...node, nodeType: newNodeType }),
  retargetEdge: (edge, fromNodeId, toNodeId) => ({ ...edge, fromNodeId, toNodeId }),
};

const node = (id: string, title: string): FakeNode => ({ id, nodeType: "TASK", title, description: null, instructions: null, positionX: 0, positionY: 0 });
const edge = (id: string, fromNodeId: string, toNodeId: string): FakeEdge => ({ id, fromNodeId, toNodeId, branchType: "DEFAULT", branchLabel: null, routePoints: null });

/** A → B → C 한 줄. 가운데 B 가 이 파일이 가장 자주 지우는 노드다. */
const NODES = [node("n-a", "A"), node("n-b", "B"), node("n-c", "C")];
const EDGE_AB = edge("e-ab", "n-a", "n-b");
const EDGE_BC = edge("e-bc", "n-b", "n-c");
const EDGES = [EDGE_AB, EDGE_BC];

describe("[진단] 노드 삭제에 선이 딸려 간다 — ①🔵 먼저 표본 확인", () => {
  test("🔵 파일 넷이 읽혔고, 재려는 손잡이가 실제로 거기 있다", () => {
    // 🔵 길이는 **날것**으로 잰다. 판정 모듈은 주석을 걷어내면 1천 자가 안 되는데
    //    (거의 전부가 까닭을 적은 머리말이다), 걷어낸 길이로 재면 「파일이 비었다」와
    //    「주석이 많다」를 못 가른다.
    for (const [name, source] of Object.entries({ screenRaw, nodePanelRaw, planRaw: read(PATHS.plan), serverRaw: read(PATHS.serverMutation) })) {
      assert.ok(source.length > 2000, `${name} 이 비어 있거나 너무 짧다 — 경로가 틀리면 아래 단언이 전부 공짜로 통과한다`);
    }
    assert.ok(planModule.includes("export function planProcedureNodeDeletionOperations("), "쌓을 줄을 정하는 본체");
    assert.ok(planModule.includes("export function findEdgesAttachedToNode("), "붙은 선을 찾는 본체");
    assert.ok(deleteNodeFn.length > 200, "손잡이 몸통을 못 떼어 냈다 — 아래 절들이 빈 글자를 뒤지게 된다");
  });

  test("🔵 표본이 **실제로 이어져 있다** — 안 이어져 있으면 아래 절이 전부 공짜로 통과한다", () => {
    // 🔴 「선이 함께 지워지는가」도 「앞뒤를 안 잇는가」도, 애초에 B 에 선이 안 붙어
    //    있으면 아무것도 안 재고 초록이 된다. 무엇을 재는지를 먼저 단언한다.
    assert.deepEqual(findEdgesAttachedToNode(EDGES, "n-b"), ["e-ab", "e-bc"], "가운데 노드에 선이 둘 붙어 있어야 한다");
    assert.deepEqual(findEdgesAttachedToNode(EDGES, "n-a"), ["e-ab"]);
    assert.deepEqual(findEdgesAttachedToNode(EDGES, "n-c"), ["e-bc"]);
    const before = previewPendingStructuralGraph(NODES, EDGES, [], fakeFactories);
    assert.equal(before.nodes.length, 3);
    assert.equal(before.edges.length, 2, "아무것도 안 쌓았을 때 선이 둘이어야 한다");
  });

  test("🔴 주석 걷어내기가 실제로 일을 한다 — 날것에는 **없어진 막음의 문구**가 경위로 남아 있다", () => {
    assert.ok(
      screenRaw.includes("이 노드에 연결된 분기가 N개 있어 삭제할 수 없습니다. 먼저 연결된 분기를 삭제해 주세요."),
      "뒤집기 전 문구가 주석에 경위로 남아 있어야 한다"
    );
    assert.ok(!screen.includes("삭제할 수 없습니다"), "걷어낸 쪽에 남아 있으면 화면이 아직 막고 있는 것이다");
  });
});

describe("[진단] 노드 삭제에 선이 딸려 간다 — ②🔴 값: 붙은 선이 **전부** 들어간다", () => {
  test("🔴 선이 둘 붙은 노드 — DELETE_EDGE 둘 + DELETE_NODE 하나", () => {
    const ops = planProcedureNodeDeletionOperations(EDGES, "n-b", null);
    assert.deepEqual(ops, [
      { kind: "DELETE_EDGE", edgeId: "e-ab", reason: null },
      { kind: "DELETE_EDGE", edgeId: "e-bc", reason: null },
      { kind: "DELETE_NODE", nodeId: "n-b", reason: null },
    ]);
  });

  test("🔴 선이 **셋** 붙은 노드도 하나도 안 빠진다 — 「둘까지만 본다」가 아니다", () => {
    // 🔴 들어오는 선 둘 · 나가는 선 하나를 섞는다. 방향을 가르면 여기서 깨진다.
    const hub = [edge("e-ab", "n-a", "n-b"), edge("e-cb", "n-c", "n-b"), edge("e-bd", "n-b", "n-d")];
    const ops = planProcedureNodeDeletionOperations(hub, "n-b", null);
    assert.equal(ops.filter((o) => o.kind === "DELETE_EDGE").length, 3, "붙은 선 셋이 다 안 들어갔다");
    assert.equal(ops.filter((o) => o.kind === "DELETE_NODE").length, 1);
    assert.equal(ops.length, 4);
  });

  test("🔵 외톨이 노드는 **선 줄 없이** 저 혼자 간다 — 쓸데없는 줄이 안 붙는다", () => {
    assert.deepEqual(planProcedureNodeDeletionOperations(EDGES, "n-z", null), [{ kind: "DELETE_NODE", nodeId: "n-z", reason: null }]);
  });

  test("🔴 저장 전에 그은 선(tmp)도 **함께** 들어간다 — 남으면 [저장]이 통째로 막힌다", () => {
    // 🔴 미리보기에만 있고 서버 목록에는 없는 선이다. 빠뜨리면 그 선이 지워질
    //    노드에 매달린 채 남아 접기가 ENDPOINT_DELETED_IN_SAME_SAVE 를 올린다.
    const withTemp = [...EDGES, edge(makeTempEdgeId(1), "n-b", "n-c")];
    const ops = planProcedureNodeDeletionOperations(withTemp, "n-b", null);
    assert.equal(ops.filter((o) => o.kind === "DELETE_EDGE").length, 3);
    assert.ok(ops.some((o) => o.kind === "DELETE_EDGE" && o.edgeId === makeTempEdgeId(1)), "저장 전에 그은 선이 빠졌다");
  });
});

describe("[진단] 노드 삭제에 선이 딸려 간다 — ③🔴 값: **앞뒤를 새로 잇지 않는다**", () => {
  test("🔴 A→B→C 에서 B 를 지우면 **CREATE_EDGE 가 한 줄도 안 생긴다**", () => {
    // 🔴 쓰는 분이 글자로 못 박은 것(원문): 「중간에 연결된 노드를 삭제하면 앞뒤
    //    노드는 연결되지 않은채로 둬줘.」 A→C 를 대신 그어 주는 것이 「친절한
    //    기본값」처럼 보여 들어오기 쉬운데, 들어와도 **오류가 한 번도 안 난다** —
    //    사람이 그림을 보고서야 안 시킨 선을 발견하고, 그 선은 [저장]과 함께 진짜로
    //    서버에 생긴다.
    const ops = planProcedureNodeDeletionOperations(EDGES, "n-b", null);
    assert.equal(ops.filter((o) => o.kind === "CREATE_EDGE").length, 0, "앞뒤를 다시 이어 주고 있다");
    assert.equal(ops.filter((o) => o.kind === "RETARGET_EDGE").length, 0, "선을 지우는 대신 옮기고 있다 — 그것도 앞뒤를 잇는 것이다");
    // 🔵 「아무것도 안 쌓였다」로 공짜 통과하지 않게 — 쌓인 줄이 셋인 것을 함께 센다.
    assert.equal(ops.length, 3, "쌓인 줄이 셋이 아니다 — 위 두 단언의 표본이 비었을 수 있다");
  });

  test("🔴 **그림에서도** A 와 C 가 안 이어져 있다 — 줄만 세면 미리보기가 몰래 이어 줄 수 있다", () => {
    // 🔴 줄 목록은 「무엇을 보낼까」이고 미리보기는 「사람이 무엇을 볼까」다. 둘이
    //    갈릴 수 있으므로 **그림 쪽도 값으로** 잰다.
    // 🔴 **남의 선이 있는 그림**으로 잰다. A→B→C→D 에서 B 를 지우면 e-cd 는 살아야
    //    한다 — 「선이 하나도 안 남았다」로만 재면 「전부 지운다」는 결함이 통과한다.
    const nodes = [...NODES, node("n-d", "D")];
    const edges = [...EDGES, edge("e-cd", "n-c", "n-d")];
    const preview = previewPendingStructuralGraph(nodes, edges, planProcedureNodeDeletionOperations(edges, "n-b", null), fakeFactories);
    assert.deepEqual(
      preview.nodes.map((n) => n.id),
      ["n-a", "n-c", "n-d"],
      "가운데 노드가 안 사라졌거나 앞뒤까지 사라졌다"
    );
    assert.deepEqual(
      preview.edges.map((e) => e.id),
      ["e-cd"],
      "붙었던 선 둘이 안 사라졌거나, 남의 선까지 사라졌다"
    );
    assert.ok(
      !preview.edges.some((e) => (e.fromNodeId === "n-a" && e.toNodeId === "n-c") || (e.fromNodeId === "n-c" && e.toNodeId === "n-a")),
      "앞뒤를 잇는 선이 새로 그어졌다"
    );
    assert.ok(!preview.edges.some((e) => e.fromNodeId === "n-b" || e.toNodeId === "n-b"), "없어진 노드에 매달린 선이 남았다");
  });

  test("🔴 화면에도 선을 **긋는** 줄이 없다 — 삭제 손잡이 안에서 센다", () => {
    assert.ok(!deleteNodeFn.includes("CREATE_EDGE"), "노드 삭제가 선을 긋고 있다");
    assert.ok(!deleteNodeFn.includes("RETARGET_EDGE"), "노드 삭제가 선을 옮기고 있다");
    // 🔵 「화면에 그 낱말이 아예 없다」로는 못 센다 — 연결선 추가가 쓰는 낱말이다.
    assert.ok(f.includes('kind: "CREATE_EDGE"'), "연결선 추가까지 사라졌다면 이 시험의 전제가 바뀐 것이다");
  });
});

describe("[진단] 노드 삭제에 선이 딸려 간다 — ④🔴 값: **차례가 이 기능을 떠받친다**", () => {
  test("🔴 보낼 차례를 세우면 **선이 전부 노드보다 앞**이다", () => {
    // 🔴 서버는 한 글자도 안 바꿨다 — 선이 붙은 노드를 여전히 거절한다. 막음을
    //    걷어낼 수 있는 까닭은 그 규칙이 없어져서가 아니라 **차례** 때문이다.
    const steps = planProcedureStructuralSteps(planProcedureNodeDeletionOperations(EDGES, "n-b", null));
    const lastEdge = steps.map((s) => s.kind).lastIndexOf("DELETE_EDGE");
    const firstNode = steps.map((s) => s.kind).indexOf("DELETE_NODE");
    assert.notEqual(lastEdge, -1, "선 삭제가 한 줄도 없다 — 표본이 비었다");
    assert.notEqual(firstNode, -1, "노드 삭제가 없다 — 표본이 비었다");
    assert.ok(lastEdge < firstNode, `선이 노드보다 뒤에 간다 — [저장]이 NODE_HAS_CONNECTED_EDGES 로 통째로 멈춘다 (${steps.map((s) => s.kind).join(" → ")})`);
  });

  test("🔴 그 차례가 **갈래 표에 실제로 그렇게 적혀** 있다 — 뒤집히면 이 기능 전체가 멈춘다", () => {
    const edgeAt = PROCEDURE_STRUCTURAL_PHASE_ORDER.indexOf("DELETE_EDGE");
    const nodeAt = PROCEDURE_STRUCTURAL_PHASE_ORDER.indexOf("DELETE_NODE");
    assert.notEqual(edgeAt, -1);
    assert.notEqual(nodeAt, -1);
    assert.ok(edgeAt < nodeAt, "갈래 표에서 노드가 선보다 앞선다");
  });

  test("🔴 서버 관문은 **그대로 있다** — 화면이 비켜 갈 뿐, 서버는 서버대로 지킨다", () => {
    // 🔴 「막음을 걷어냈다」가 「서버도 열었다」로 읽히면 안 된다. 여기가 빠지면
    //    언젠가 누가 「화면에서 안 막으니 서버도 필요 없다」고 걷어낸다.
    assert.ok(serverMutation.includes("NODE_HAS_CONNECTED_EDGES"), "서버의 거절 갈래가 사라졌다");
    assert.ok(serverMutation.includes("이 노드에 연결된 분기가 있어 삭제할 수 없습니다. 먼저 분기를 삭제하세요."), "서버의 거절 글이 사라졌다");
  });

  test("🔵 같은 선이 두 번 쌓여도 접기가 한 줄로 만든다 — 그물에 기대지는 않는다", () => {
    // 🔵 지금 화면은 선을 두 번 쌓지 않는다(미리보기에서 이미 빠져 있다). 그래도
    //    접기가 받아 준다는 것을 **값으로** 확인해 두면, 나중에 복수 삭제가 들어올 때
    //    「두 노드가 공유하는 선」을 겁낼 까닭이 없다는 근거가 된다.
    const twice: PendingStructuralOperation[] = [
      ...planProcedureNodeDeletionOperations(EDGES, "n-b", null),
      { kind: "DELETE_EDGE", edgeId: "e-ab", reason: null },
    ];
    const coalesced = coalescePendingStructuralOperations(twice);
    assert.equal(coalesced.operations.filter((o) => o.kind === "DELETE_EDGE" && o.edgeId === "e-ab").length, 1, "같은 선이 두 줄 남았다");
    assert.equal(coalesced.conflicts.length, 0, "접기가 부딪힘을 올렸다 — 그러면 [저장]이 막힌다");
  });
});

describe("[진단] 노드 삭제에 선이 딸려 간다 — ⑤🔴 글자: 화면이 그 판정을 제대로 물었다", () => {
  test("🔴 쌓는 줄을 순수 판정이 만든다 — 화면이 제 손으로 세지 않는다", () => {
    // 🔴 화면이 다시 세면 「화면이 말한 수」와 「실제로 지워지는 수」가 갈린다.
    assert.ok(deleteNodeFn.includes("queueStructural(() => planProcedureNodeDeletionOperations(renderedEdges, nodeId, null));"));
    assert.ok(!deleteNodeFn.includes('kind: "DELETE_EDGE"'), "화면이 연결선 삭제 줄을 직접 적고 있다");
    assert.ok(!deleteNodeFn.includes('kind: "DELETE_NODE"'), "화면이 노드 삭제 줄을 직접 적고 있다");
    assert.ok(!deleteNodeFn.includes(".filter("), "화면이 붙은 선을 제 손으로 거르고 있다");
    // 🔵 절차와 **같은 한 벌**을 쓴다는 근거 — 베껴 오면 두 잣대가 된다.
    assert.ok(screen.includes('from "@/lib/domain/procedure-editor-node-deletion"'), "판정을 베껴 왔다");
  });

  test("🔴 쌓는 호출이 **하나**다 — 둘로 쪼개지면 [이전] 한 칸이 아니게 된다", () => {
    // 🔴 queueStructural 은 부를 때마다 되돌리기 한 칸을 찍는다. 선과 노드를 나눠
    //    부르면 [이전] 한 번에 선만(또는 노드만) 돌아온다. 선이 셋 붙은 노드를
    //    지우면 [이전]을 넷 눌러야 한다.
    assert.equal(countOf(deleteNodeFn, "queueStructural("), 1, "삭제 한 번에 통로를 여러 번 지난다");
    // 🔵 그 통로가 목록을 고치기 **전에** 한 칸을 찍는다는 근거(이웃 시험들도 잰다).
    const queue = flat(functionBody(screen, "function queueStructural("));
    assert.ok(queue.indexOf("pushPendingUndoStep();") < queue.indexOf("setPendingStructuralOperations("));
  });

  test("🔴 찾는 목록이 **그려진 선**(renderedEdges)이다 — 초안을 안 얹은 목록이면 옮긴 선이 어긋난다", () => {
    // 🔴 이 편집기는 연결선 재연결을 **구조 조작이 아니라 초안 지도**로 들고 있다
    //    (RETARGET_EDGE 를 안 쌓는다 — 2026-11-21 결정). 그래서
    //    structuralPreview.edges 는 저장 전에 옮긴 선의 **옛 양 끝**을 들고 있고,
    //    그것으로 세면 ① 이 노드에서 **떠난** 선을 지우고 ② 이 노드로 **옮겨 온**
    //    선은 남긴다. 남은 쪽은 [저장]에서 없어진 노드로 재연결하려다 실패한다.
    //    🔵 절차 쪽은 재연결이 구조 조작이라 사정이 다르다 — 그래도 답은 같다
    //       (renderedEdges). 같은 낱말을 쓰되 까닭은 이 편집기 것이어야 한다.
    assert.ok(deleteNodeFn.includes("findEdgesAttachedToNode(renderedEdges, nodeId)"));
    assert.equal(countOf(f, "planProcedureNodeDeletionOperations(edges,"), 0, "서버 목록으로 쌓고 있다");
    assert.equal(countOf(f, "planProcedureNodeDeletionOperations(structuralPreview.edges,"), 0, "초안을 안 얹은 목록으로 쌓고 있다");
    assert.equal(countOf(f, "findEdgesAttachedToNode(edges,"), 0, "서버 목록에서 찾고 있다");
    assert.equal(countOf(f, "findEdgesAttachedToNode(structuralPreview.edges,"), 0, "초안을 안 얹은 목록에서 찾고 있다");
    // 🔴 **재연결이 아직 초안 지도라는 근거.** 그것이 구조 조작으로 옮겨 가는 날
    //    위 까닭의 절반이 사라지므로, 그때 이 주석도 함께 고쳐야 한다.
    assert.ok(!f.includes('kind: "RETARGET_EDGE"'), "재연결이 구조 조작으로 옮겨 갔다 — 위 까닭을 다시 써야 한다");
    assert.ok(f.includes("toNodeId: pendingDraft?.toNodeId") || screen.includes("mergeEdgeForRender"), "그려진 선이 초안을 얹는다는 근거가 사라졌다");
  });

  test("🔴 함께 지워지는 선의 **칸 초안·경로점도 버린다** — 안 버리면 없는 선을 고치려 든다", () => {
    // 🔴 handleDeleteEdge 가 선 하나에 하던 뒤처리 둘이다. 딸려 지워지는 선에만
    //    안 해 주면 「어떻게 지웠느냐」에 따라 뒤처리가 갈리고, 남은 초안이 [저장]을
    //    통째로 실패시킨다(절차 쪽에서 실제로 겪은 결함이다).
    assert.ok(deleteNodeFn.includes("const attachedEdgeIds = findEdgesAttachedToNode(renderedEdges, nodeId);"), "버릴 선의 id 를 뽑는 줄");
    assert.ok(deleteNodeFn.includes("setPendingEdgeDraftsById((prev) => dropKeys(prev, attachedEdgeIds));"));
    assert.ok(deleteNodeFn.includes("setPendingRoutePointsByEdgeId((prev) => dropKeys(prev, attachedEdgeIds));"));
    // 🔵 노드 쪽 둘(초안 · 자리)은 전부터 있던 뒤처리다 — 함께 산다.
    assert.ok(deleteNodeFn.includes("setPendingNodeDraftsById((prev) => dropKeys(prev, [nodeId]));"));
    assert.ok(deleteNodeFn.includes("setPendingNodePositionsById((prev) => dropKeys(prev, [nodeId]));"));
    // 🔴 **선 하나만 지울 때와 같은 지도를 치운다**는 근거 — 한쪽에만 지도가 늘면
    //    그 어긋남은 [저장]이 끝난 뒤에야 드러난다.
    for (const map of ["setPendingEdgeDraftsById", "setPendingRoutePointsByEdgeId"]) {
      assert.ok(deleteEdgeFn.includes(map), `연결선 삭제가 ${map} 를 안 치운다 — 두 길의 뒤처리가 갈렸다`);
    }
  });

  test("🔴 지워진 선을 **고른 채였으면 선택도 푼다** — 경로점이 남으면 없는 선의 점을 지우러 간다", () => {
    assert.ok(deleteNodeFn.includes("setSelectedNodeId(null);"), "지운 노드를 고른 채로 둔다");
    assert.ok(
      deleteNodeFn.includes("if (selectedEdgeId !== null && attachedEdgeIds.includes(selectedEdgeId)) { setSelectedEdgeId(null); setSelectedWaypointIndex(null); }"),
      "딸려 지워진 선의 선택·경로점을 안 푼다"
    );
    // 🔵 **고른 선이 안 지워졌으면 건드리지 않는다**는 근거 — 조건 없이 비우면
    //    남의 노드를 지울 때마다 보고 있던 연결선 패널이 닫힌다.
    const guard = deleteNodeFn.indexOf("if (selectedEdgeId !== null");
    const clear = deleteNodeFn.indexOf("setSelectedEdgeId(null);");
    assert.ok(guard !== -1 && clear !== -1 && guard < clear, "선택 풀기가 조건 밖에 있다 — 늘 풀면 패널이 제멋대로 닫힌다");
  });
});

describe("[진단] 노드 삭제에 선이 딸려 간다 — ⑥🔴 **막는 길이 사라졌다**(죽은 프롭이 안 남았다)", () => {
  test("🔴 화면이 미리 막는 자리가 **하나도 없다**", () => {
    assert.ok(!deleteNodeFn.includes("if (attachedEdgeIds.length > 0) {"), "붙은 선이 있으면 돌아가는 관문이 아직 있다");
    assert.ok(!screen.includes("삭제할 수 없습니다"), "화면이 아직 못 지운다고 말한다");
    assert.ok(!screen.includes("먼저 연결된 분기를 삭제해 주세요"), "사람이 선을 먼저 지우라고 아직 말하고 있다");
    // 🔴 **돌아가는 길은 권한 울타리 하나뿐**이다. 수로 재야 「다른 까닭으로 조용히
    //    안 지워지는」 가지가 새로 생겼을 때 걸린다 — 그 가지는 오류를 안 낸다.
    assert.equal(countOf(deleteNodeFn, "return;"), 1, "노드 삭제에 돌아가는 길이 늘었다");
    assert.ok(deleteNodeFn.includes("if (!canEdit) return;"), "그 하나가 권한 울타리라는 근거");
  });

  test("🔴 막음을 띄우던 칸·프롭·표시 자리를 **전부 걷어냈다** — 남기면 꺼도 아무 일 없는 스위치다", () => {
    // 🔴 이 화면이 미리 막던 까닭은 「연결선이 붙어 있다」 하나뿐이었다. 그것이
    //    없어졌으므로 까닭을 쥐고 내려보내던 state 와 받던 프롭이 영영 null 이 된다.
    //    🔵 쓰던 자리 다섯을 전부 세고 지웠다: ① 화면의 state 선언 ② 막을 때 넣던
    //       줄 ③ 들어올 때 비우던 줄 ④ 패널로 내려보내는 프롭 ⑤ 패널의 받는 칸·
    //       타입·`<p>` 표시 자리.
    for (const dead of ["nodeDeleteBlockedMessage", "setNodeDeleteBlockedMessage", "deleteBlockedMessage"]) {
      assert.ok(!screen.includes(dead), `화면에 ${dead} 가 남아 있다`);
      assert.ok(!nodePanel.includes(dead), `노드 패널에 ${dead} 가 남아 있다`);
    }
    // 🔵 **삭제 칸 전체를 걷어낸 것이 아니라는** 근거 — 단추도 상자도 그대로 산다.
    assert.ok(nodePanel.includes("노드 삭제</h4>"), "삭제 상자까지 걷어냈다");
    assert.ok(nodePanel.includes("> 노드 삭제 </button>"), "삭제 단추까지 걷어냈다");
    assert.ok(f.includes("onDelete={() => handleDeleteNode(selectedNode.id)}"), "패널이 삭제를 부르는 줄까지 걷어냈다");
  });

  test("🔴 **단추를 잠그는 값이 안 생겼다** — 안 보이는 막음은 더 나쁘다", () => {
    // 🔴 글을 안 띄우고 단추만 흐리면 사람은 까닭을 영영 모른다. 삭제 단추에
    //    disabled 가 붙는 날 이 단언이 운다.
    const box = nodePanel.slice(nodePanel.indexOf("노드 삭제</h4>"));
    const button = box.slice(0, box.indexOf("</button>") + 9);
    assert.ok(button.includes("onClick={onDelete}"), "삭제 단추를 못 떼어 냈다 — 아래 단언이 공짜로 통과한다");
    // 🔵 `disabled` 라는 **낱말**로는 못 센다 — 흐려 보이게 하는 Tailwind 갈래
    //    (`disabled:opacity-50`)가 그 글자를 달고 있고, 그것은 잠그는 값이 아니다.
    //    실제로 잠그는 것은 JSX 프롭 `disabled={...}` 하나뿐이다.
    assert.ok(button.includes("disabled:opacity-50"), "흐려 보이게 하는 갈래가 사라졌다면 이 단언의 전제가 바뀐 것이다");
    assert.ok(!button.includes("disabled="), "삭제 단추에 잠그는 값이 생겼다");
  });

  test("🔵 [Delete] 키도 **같은 답**을 낸다 — 키 쪽은 한 글자도 안 고쳤다", () => {
    // 🔵 키 판정은 막힌 까닭을 제가 세지 않고 화면이 준 값만 본다. 그 값이 null 로
    //    남아 있으므로 키로도 똑같이 지워진다(그것이 맞는 동작이다).
    assert.ok(f.includes("nodeDeleteBlockedReason: null,"), "키에 넘기는 값이 바뀌었다");
    assert.ok(f.includes("deleteByKeyRef.current.node(plan.nodeId)"), "키가 부르는 함수가 바뀌었다");
    assert.ok(f.includes("const deleteByKeyRef = useRef({ node: handleDeleteNode,"), "키가 단추와 다른 함수를 부른다");
  });
});
