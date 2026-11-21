import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  previewPendingStructuralGraph,
  type StructuralPreviewFactories,
} from "@/lib/domain/procedure-editor-structural-preview";
import {
  coalescePendingStructuralOperations,
  canSendStructuralChanges,
  makeTempEdgeId,
  makeTempNodeId,
  type PendingStructuralOperation,
} from "@/lib/domain/procedure-editor-structural-changes";
import { procedureStructuralOperationsSignature } from "@/lib/domain/procedure-editor-structural-undo";
import {
  collectStructuralIdEffects,
  includeBrandNewDraftEntries,
  includeBrandNewDraftIds,
  rebaseDraftMapAfterStructuralSave,
} from "@/lib/domain/procedure-editor-structural-save";

/**
 * ============================================================================
 * 「진단 Flowchart」 편집기 — **구조 변경도 [저장]을 눌러야 저장된다** (2026-11-21, 조각 C2)
 * ============================================================================
 * 쓰는 분의 요청으로 다섯(노드 추가·삭제 · 연결선 추가·삭제 · 연결선 위 노드
 * 끼우기)이 「누르는 즉시 서버로」에서 「모아 두었다가 [저장] 한 번에」로 바뀌었다.
 * 「기술 작업 절차」 편집기가 2026-11-20 에 먼저 그렇게 바뀌었고, 그때 만든 순수
 * 모듈 다섯을 **베끼지 않고 그대로** 쓴다.
 *
 * ── 이 파일이 재는 것 두 갈래 ────────────────────────────────────────────
 *  ㉮ **값**: 순수 모듈이 **진단 쪽 행 모양**(정렬 번호 칸이 없다)으로도 제대로
 *     도는가. 조각 C2 의 첫 단계가 바로 그 타입을 선택 칸으로 바꾼 것이라,
 *     여기가 깨지면 화면은 컴파일조차 안 된다.
 *  ㉯ **글자**: 화면이 그 모듈들을 **빠뜨리지 않고 물었는가.** 아래 다섯은 전부
 *     「빠뜨려도 오류가 한 번도 안 나는」 자리다.
 *
 * ── 🔴 여기서 가장 조용히 깨지는 것 다섯 ─────────────────────────────────
 *  ① **미리보기를 안 얹는 것.** [노드 추가]를 눌러도 그림에 아무것도 안 생긴다.
 *     단추는 멀쩡히 눌리고 오류도 없다. (③절)
 *  ② **임시 키로 적어 둔 초안을 진짜 키로 안 옮기는 것.** 막 만든 노드에 적은
 *     설명이 사라지는데 「저장 완료」까지 뜬다. (④절 ㉠)
 *  ③ **dirty 셈이 「받침에 없는 id」를 조용히 건너뛰는 것.** 같은 증상인데 원인이
 *     다르다 — 받침을 미리보기로 세우고 includeBrandNew* 로 한 겹 더 받친다. (④절 ㉡)
 *  ④ **같은 저장에서 지워진 것의 초안을 안 버리는 것.** 없는 행에 칸 값을 쓰려
 *     들어 **저장 전체가 실패한다.** (④절 ㉢)
 *  ⑤ **되돌리기 서명에 구조 목록을 안 섞는 것.** 지도 넷이 똑같아 [이전]이 한
 *     칸을 조용히 건너뛴다. (⑤절)
 *
 * ── 왜 렌더가 아니라 원본을 읽는가 ──────────────────────────────────────
 * CaseFlowchartEditorScreen 은 @xyflow/react 의 .css 와 서버 액션(→ server-only)을
 * 사슬로 물고 있어 어느 목록에서도 import 자체가 던진다. 이웃
 * case-flowchart-delete-key-ui.test.ts · case-flowchart-fault-tags.test.tsx 가
 * 같은 사정에서 같은 방식을 쓴다.
 * ============================================================================
 */

const repoUrl = new URL("../../../../", import.meta.url);
const read = (relativePath: string) => readFileSync(new URL(relativePath, repoUrl), "utf8");

/**
 * 🔴 **차례가 중요하다** — 블록 주석을 **먼저** 걷는다.
 *
 * 이웃 case-flowchart-delete-key-ui.test.ts 는 JSX 주석(중괄호로 감싼 블록 주석)을
 * 먼저 걷는데, 그 꼴은 「여는 중괄호 다음에 바로 블록 주석이 오는 모든 자리」에
 * 걸린다 — 프롭 타입 묶음(여는 중괄호 바로 뒤에 칸 설명 주석이 오는 모양)이
 * 정확히 그것이라, 비탐욕 짝짓기가 **파일 끝의 「주석 닫기 + 닫는 중괄호」까지
 * 통째로 삼킨다.** 이 파일을 쓰다 실제로 겪었다(패널 하나가 661자로 쪼그라들어
 * ①절의 길이 관문이 잡아 주었다). 블록 주석을 먼저 걷으면 JSX 주석은 **속이 비어**
 * 빈 중괄호 짝만 남으므로, 그것만 치우면 된다.
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

/**
 * 함수 하나의 몸통만 떼어 낸다.
 *
 * 🔴 **인자 자리의 `{` 를 몸통으로 착각하면 안 된다.** `function f(input: { a: string })`
 * 처럼 인자에 객체 타입이 붙으면 「start 뒤 첫 `{`」가 그 타입이라, 거기서부터 세면
 * **인자 타입만** 떼어 낸다. 그러면 아래 단언들이 빈 글자를 뒤지며 통과하거나
 * 엉뚱한 글로 깨진다. 그래서 먼저 **괄호 짝을 맞춰** 인자 자리를 건너뛴다.
 */
function functionBody(source: string, start: string): string {
  const from = source.indexOf(start);
  assert.notEqual(from, -1, `원본에서 ${start} 를 못 찾았다 — 이름이 바뀌었으면 시험도 함께 고쳐야 한다`);
  const parenOpen = source.indexOf("(", from);
  assert.notEqual(parenOpen, -1, `${start} 에 인자 괄호가 없다`);
  let parenDepth = 0;
  let parenClose = -1;
  for (let i = parenOpen; i < source.length; i += 1) {
    if (source[i] === "(") parenDepth += 1;
    else if (source[i] === ")") {
      parenDepth -= 1;
      if (parenDepth === 0) {
        parenClose = i;
        break;
      }
    }
  }
  assert.notEqual(parenClose, -1, `${start} 의 인자 괄호가 안 닫혔다`);
  const open = source.indexOf("{", parenClose);
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

/** 글자가 몇 번 나오는가. 「통로를 한 번만 지나는가」처럼 **수**가 뜻을 갖는 자리에서 쓴다. */
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
  graph: "src/components/repair-cases/flowchart/CaseFlowchartGraph.tsx",
  createNodePanel: "src/components/repair-cases/flowchart/CaseFlowchartCreateNodePanel.tsx",
  createEdgePanel: "src/components/repair-cases/flowchart/CaseFlowchartCreateEdgePanel.tsx",
  edgePanel: "src/components/repair-cases/flowchart/CaseFlowchartEdgePropertyPanel.tsx",
  nodePanel: "src/components/repair-cases/flowchart/CaseFlowchartNodePropertyPanel.tsx",
  previewModule: "src/lib/domain/procedure-editor-structural-preview.ts",
} as const;

const screenRaw = read(PATHS.screen);
const screen = stripComments(screenRaw);
const f = flat(screen);
const graphRaw = read(PATHS.graph);
const createNodePanel = flat(stripComments(read(PATHS.createNodePanel)));
const createEdgePanel = flat(stripComments(read(PATHS.createEdgePanel)));
const edgePanel = flat(stripComments(read(PATHS.edgePanel)));
const nodePanel = flat(stripComments(read(PATHS.nodePanel)));
const previewModule = stripComments(read(PATHS.previewModule));

const saveFn = flat(functionBody(screen, "async function handleGlobalSave()"));
const queueFn = flat(functionBody(screen, "function queueStructural("));
const createNodeFn = flat(functionBody(screen, "function handleQueueCreateNode("));
const createEdgeFn = flat(functionBody(screen, "function handleQueueCreateEdge("));
const insertNodeFn = flat(functionBody(screen, "function handleQueueInsertNodeOnEdge("));
const discardFn = flat(functionBody(screen, "function handleDiscardAllPending()"));
const undoFn = flat(functionBody(screen, "function handleUndo()"));
const redoFn = flat(functionBody(screen, "function handleRedo()"));

// ==================== ㉮ 값으로 재는 쪽 — 진단 행 모양 그대로 ====================

/**
 * 🔴 **진단 노드·연결선 행에는 `sortOrder` 칸이 없다.** 그 표는 엑셀 수입도 판
 * 복제도 없어 차례를 따로 들 까닭이 없다(스키마 주석). 아래 가짜 행은 화면이
 * 실제로 쓰는 CaseFlowchartGraphNode / CaseFlowchartGraphEdge 와 **같은 칸**이고,
 * ①절이 원본에서 그 사실을 다시 확인한다 — 안 그러면 이 절이 「시험 안에서만
 * 맞는 모양」을 재게 된다.
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

const nodeA: FakeNode = { id: "n-a", nodeType: "TASK", title: "A", description: null, instructions: null, positionX: 0, positionY: 0 };
const nodeB: FakeNode = { id: "n-b", nodeType: "TASK", title: "B", description: null, instructions: null, positionX: 0, positionY: 150 };
const edgeAB: FakeEdge = { id: "e-ab", fromNodeId: "n-a", toNodeId: "n-b", branchType: "DEFAULT", branchLabel: null, routePoints: null };

describe("[진단] 구조 변경 모아 두기 — ①🔵 먼저 표본 확인", () => {
  test("🔵 파일 일곱이 읽혔고, 재려는 손잡이가 실제로 거기 있다", () => {
    for (const [name, source] of Object.entries({ screen, createNodePanel, createEdgePanel, edgePanel, nodePanel, previewModule })) {
      assert.ok(source.length > 1500, `${name} 이 비어 있거나 너무 짧다 — 경로가 틀리면 아래 단언이 전부 공짜로 통과한다`);
    }
    for (const [name, body] of Object.entries({ saveFn, queueFn, createNodeFn, createEdgeFn, insertNodeFn, discardFn, undoFn, redoFn })) {
      assert.ok(body.length > 40, `${name} 몸통을 못 떼어 냈다 (길이 ${body.length})`);
    }
  });

  test("🔴 진단 행에 **정렬 번호 칸이 없다** — 아래 값 시험의 가짜 행이 실물과 같은 모양이라는 근거", () => {
    const nodeType = flat(stripComments(graphRaw).slice(stripComments(graphRaw).indexOf("export type CaseFlowchartGraphNode = {")));
    const edgeType = flat(stripComments(graphRaw).slice(stripComments(graphRaw).indexOf("export type CaseFlowchartGraphEdge = {")));
    assert.ok(nodeType.startsWith("export type CaseFlowchartGraphNode = {"), "노드 행 타입을 못 찾았다");
    for (const field of ["id: string;", "nodeType:", "title: string;", "description: string | null;", "instructions: string | null;", "positionX: number;", "positionY: number;"]) {
      assert.ok(nodeType.slice(0, 260).includes(field), `노드 행에 ${field} 가 없다 — 가짜 행의 모양이 실물과 어긋났다`);
    }
    assert.ok(!nodeType.slice(0, 260).includes("sortOrder"), "노드 행에 정렬 번호 칸이 생겼다 — 그러면 아래 ②번 결정의 전제가 바뀐다");
    assert.ok(!edgeType.slice(0, 260).includes("sortOrder"), "연결선 행에 정렬 번호 칸이 생겼다");
  });

  test("🔴 미리보기 모듈의 정렬 번호가 **선택 칸**이다 — 필수면 진단 행은 컴파일조차 안 된다", () => {
    assert.ok(previewModule.includes("type MinimalNode = { readonly id: string; readonly sortOrder?: number };"));
    assert.ok(previewModule.includes("readonly sortOrder?: number };"), "연결선 쪽도 선택 칸이어야 한다");
    // 🔵 없을 때 0 으로 친다는 근거 — 「선택 칸인데 읽을 때 터진다」가 되지 않게.
    assert.ok(previewModule.includes("(n.sortOrder ?? 0)"));
    assert.ok(previewModule.includes("(e.sortOrder ?? 0)"));
  });
});

describe("[진단] 구조 변경 모아 두기 — ②🔴 값: 미리보기가 **진단 행 모양으로도** 돈다", () => {
  test("🔴 노드 추가 — 서버 목록에 없는 노드가 그림 목록에 선다", () => {
    const operations: PendingStructuralOperation[] = [
      { kind: "CREATE_NODE", tempNodeId: makeTempNodeId(1), nodeType: "DECISION", title: "전원 정상?", position: { x: 10, y: 20 } },
    ];
    const preview = previewPendingStructuralGraph([nodeA], [], operations, fakeFactories);
    assert.equal(preview.nodes.length, 2, "서버 노드 하나 + 저장 전 노드 하나");
    assert.deepEqual(preview.addedNodeIds, ["tmp:node:1"]);
    const added = preview.nodes.find((n) => n.id === "tmp:node:1");
    assert.equal(added?.title, "전원 정상?");
    assert.equal(added?.nodeType, "DECISION");
    assert.equal(added?.positionX, 10);
    assert.equal(added?.positionY, 20);
    // 🔴 설명은 조작이 안 싣는다 — 화면이 초안 지도로 따로 나른다(아래 ④절 ㉠).
    assert.equal(added?.description, null);
  });

  test("🔴 노드 삭제 — 서버에 있는 노드가 그림에서 빠진다(아직 서버에는 그대로다)", () => {
    const preview = previewPendingStructuralGraph([nodeA, nodeB], [edgeAB], [{ kind: "DELETE_NODE", nodeId: "n-b", reason: null }], fakeFactories);
    assert.deepEqual(preview.nodes.map((n) => n.id), ["n-a"]);
    // 🔵 붙은 선은 **안 지운다** — 「노드를 지우면 붙은 선도 함께」는 진단에 아직 없다(C3).
    assert.deepEqual(preview.edges.map((e) => e.id), ["e-ab"]);
  });

  test("🔴 연결선 위 노드 끼우기 — 원래 선의 **끝이 새 노드로 옮겨지고** 둘째 선이 생긴다", () => {
    const operations: PendingStructuralOperation[] = [
      { kind: "INSERT_NODE_ON_EDGE", edgeId: "e-ab", tempNodeId: makeTempNodeId(1), tempSecondEdgeId: makeTempEdgeId(1), nodeType: "INSPECTION", title: "중간 점검", position: { x: 5, y: 75 } },
    ];
    const preview = previewPendingStructuralGraph([nodeA, nodeB], [edgeAB], operations, fakeFactories);
    assert.equal(preview.nodes.length, 3);
    assert.equal(preview.edges.length, 2);
    const first = preview.edges.find((e) => e.id === "e-ab");
    assert.equal(first?.fromNodeId, "n-a");
    assert.equal(first?.toNodeId, "tmp:node:1", "원래 선의 끝이 새 노드로 안 옮겨졌다");
    const second = preview.edges.find((e) => e.id === "tmp:edge:1");
    assert.equal(second?.fromNodeId, "tmp:node:1");
    assert.equal(second?.toNodeId, "n-b");
    assert.equal(second?.branchType, "DEFAULT", "둘째 구간은 늘 기본 연결이다(서버와 같은 규칙)");
  });

  test("🔴 만들었다 지운 것은 **보낼 것이 0건**이다 — 화면의 「변경 N건」이 그 수를 쓴다", () => {
    const operations: PendingStructuralOperation[] = [
      { kind: "CREATE_NODE", tempNodeId: makeTempNodeId(1), nodeType: "TASK", title: "임시", position: null },
      { kind: "DELETE_NODE", nodeId: makeTempNodeId(1), reason: null },
    ];
    const coalesced = coalescePendingStructuralOperations(operations);
    assert.equal(coalesced.operations.length, 0, "사람이 두 번 눌렀어도 서버에 보낼 것은 없다");
    assert.equal(coalesced.dropped.length, 2);
    assert.ok(canSendStructuralChanges(coalesced), "막힌 것이 없는데 저장이 막혔다");
  });
});

describe("[진단] 구조 변경 모아 두기 — ③🔴 화면이 미리보기를 **실제로 얹는다**", () => {
  test("🔴 그림과 받침이 **structuralPreview** 를 돈다 — 안 얹으면 노드를 추가해도 아무 일도 안 일어난다", () => {
    assert.ok(f.includes("const structuralPreview = previewPendingStructuralGraph(nodes, edges, pendingStructuralOperations, structuralPreviewFactories);"));
    assert.ok(f.includes("const renderedNodes: CaseFlowchartGraphNode[] = structuralPreview.nodes.map((n) =>"), "그림이 아직 서버 목록을 돈다");
    assert.ok(f.includes("const renderedEdges: CaseFlowchartGraphEdge[] = structuralPreview.edges.map((e) =>"), "그림이 아직 서버 목록을 돈다");
    // 🔴 받침도 함께. 서버 목록으로 받침을 세우면 저장 전에 만든 노드에 적은 값이
    //    computeDirty* 의 `if (!server)` 에서 **조용히** 사라진다.
    assert.ok(f.includes("const nodesById = new Map(structuralPreview.nodes.map((n) => [n.id, n]));"));
    assert.ok(f.includes("const edgesById = new Map(structuralPreview.edges.map((e) => [e.id, e]));"));
    // 🔵 「서버 목록을 그대로 돌던 옛 줄」이 안 남아 있다는 근거.
    assert.ok(!f.includes("= nodes.map((n) => mergeNodeForRender("), "옛 줄이 남아 있다");
    assert.ok(!f.includes("= edges.map((e) => mergeEdgeForRender("), "옛 줄이 남아 있다");
  });

  test("🔴 빈 화면 안내와 [연결 추가] 칸도 **그려진 수**를 본다 — 첫 노드가 안 보이면 아무것도 못 한다", () => {
    assert.ok(f.includes("{renderedNodes.length === 0 ? ("), "빈 안내가 아직 서버 목록을 센다 — 첫 노드를 추가해도 그림이 안 선다");
    assert.ok(f.includes('rightPanelTab === "createEdge" && canEdit && renderedNodes.length > 0'), "[연결 추가] 칸이 아직 서버 목록을 센다");
  });

  test("🔴 패널의 받침도 **그려진 것**에서 뽑는다 — 새 노드의 제목이 패널에서만 빈 칸이 되면 안 된다", () => {
    assert.ok(flat(functionBody(screen, "function nodeDraft(nodeId: string)")).includes("const serverNode = nodesById.get(nodeId);"));
    assert.ok(flat(functionBody(screen, "function edgeDraft(edgeId: string)")).includes("const serverEdge = edgesById.get(edgeId);"));
    assert.ok(flat(functionBody(screen, "function workingRoutePoints(edgeId: string)")).includes("edgesById.get(edgeId)?.routePoints"));
  });

  test("🔴 저장 대기 건수에 **구조 변경이 더해진다** — 안 더하면 노드만 추가했을 때 [저장]이 영영 안 켜진다", () => {
    assert.ok(f.includes("const structuralPendingCount = coalescedStructural.operations.length;"));
    assert.ok(
      f.includes("dirtyRouteEdgeIds.length + structuralPendingCount;"),
      "저장 대기 건수에 구조 변경이 안 들어간다 — 이번 일이 고치려던 증상이 모양만 바꿔 돌아온다"
    );
    assert.ok(f.includes("const hasAnyPendingChanges = totalPendingCount > 0;"));
  });
});

describe("[진단] 구조 변경 모아 두기 — ④🔴 다섯 자리가 **전부 한 통로**를 지난다", () => {
  test("🔴 패널 넷 어디에도 서버 액션 호출이 **하나도** 안 남았다", () => {
    for (const [name, panel] of [
      ["노드 만들기", createNodePanel],
      ["연결선 만들기", createEdgePanel],
      ["연결선 속성", edgePanel],
      ["노드 속성", nodePanel],
    ] as const) {
      assert.ok(!panel.includes("Action("), `${name} 패널이 아직 서버를 제 손으로 부른다`);
      assert.ok(!panel.includes("server/actions"), `${name} 패널이 아직 서버 액션을 물고 있다`);
    }
    // 🔵 대신 올려 보내는 줄이 실제로 있다는 근거 — 통째로 비워 버린 것이 아니다.
    assert.ok(createNodePanel.includes("onQueueCreate({ nodeType, title, description, position: nextNodePosition() });"));
    assert.ok(createEdgePanel.includes("onQueueCreate({ fromNodeId, toNodeId, branchType, branchLabel: branchLabel.trim() || null });"));
    assert.ok(edgePanel.includes("onQueueInsertNode({ nodeType: insertNodeType, title: insertNodeTitle, position: point });"));
  });

  test("🔴 쌓는 자리 다섯이 **queueStructural 하나만** 부르고, 자리마다 **정확히 한 번** 부른다", () => {
    const callers = { createNodeFn, createEdgeFn, insertNodeFn };
    for (const [name, body] of Object.entries(callers)) {
      assert.equal(countOf(body, "queueStructural("), 1, `${name} 이 통로를 여러 번 지난다 — [이전]을 그만큼 더 눌러야 한다`);
    }
    // 🔵 지우기 셋은 이웃 시험(case-flowchart-delete-key-ui.test.ts ④절 ·
    //    case-flowchart-multi-node-delete-ui.test.ts ④절)이 각각 같은 수를 센다.
    //    여기서는 **전부 합쳐 몇 자리인가**만 센다: 정의 한 줄 + 여섯.
    // 🔴 2026-11-21(조각 B3′)에 다섯에서 **여섯**이 됐다 — [범위 선택]으로 고른
    //    여럿을 지우는 handleDeleteNodes 가 붙었다. 단수 안에 가지를 치지 않고 새
    //    함수를 만든 까닭은 그 자리 주석에(「한 번만 지난다」가 [이전] 한 칸의 근거다).
    assert.equal(countOf(f, "queueStructural("), 7, "통로를 부르는 자리 수가 안 맞는다(정의 한 줄 + 여섯)");
    assert.ok(f.includes("setPendingStructuralOperations(next);"), "통로가 목록을 갈아끼우는 줄");
    assert.equal(countOf(f, "setPendingStructuralOperations("), 4, "목록을 고치는 자리는 넷뿐이다(통로 · 되돌리기 · 저장 · 모두 취소)");
  });

  test("🔴 끼우기는 **한 도장에서 번호를 둘** 받는다 — 나눠 부르면 번호가 어긋난다", () => {
    assert.ok(insertNodeFn.includes("tempNodeId: mint.nextNodeId(), tempSecondEdgeId: mint.nextEdgeId(),"));
    assert.equal(countOf(insertNodeFn, "mint.next"), 2);
  });

  test("🔴 번호를 찍는 길이 **appendPendingStructuralOperations 하나뿐**이다", () => {
    assert.ok(queueFn.includes("appendPendingStructuralOperations(pendingStructuralOperations, build)"));
    assert.ok(!screen.includes("createTempIdMinter"), "화면이 도장을 직접 만들고 있다 — 같은 번호가 두 번 나간다");
    assert.ok(!screen.includes("makeTempNodeId(") && !screen.includes("makeTempEdgeId("), "화면이 번호를 직접 짓고 있다");
  });

  test("🔴 [취소]가 **구조 목록까지** 비운다 — 안 비우면 취소한 뒤에도 다음 [저장]에 따라간다", () => {
    assert.ok(discardFn.includes("setPendingStructuralOperations([]);"));
    assert.ok(discardFn.includes("pushPendingUndoStep();"), "[취소]도 되돌릴 수 있는 한 칸이어야 한다");
  });
});

describe("[진단] 구조 변경 모아 두기 — ⑤🔴 [저장]이 **구조를 먼저** 보내고 세 겹을 다 한다", () => {
  test("🔴 구조가 먼저, 칸 값이 나중 — 뒤집히면 새 노드의 칸 값은 보낼 자리 자체가 없다", () => {
    const structuralAt = saveFn.indexOf("runProcedureStructuralSequence<null>(");
    const fieldAt = saveFn.indexOf("const steps = planSaveSteps({");
    assert.notEqual(structuralAt, -1, "구조 보내기가 [저장]에 없다");
    assert.notEqual(fieldAt, -1, "칸 값 계획이 [저장]에 없다");
    assert.ok(structuralAt < fieldAt, "칸 값 단계가 구조보다 앞에 있다");
    // 🔴 토큰은 **구조가 끝난 뒤의 것**을 이어 넘긴다. 들고 있던 값을 그대로 쓰면
    //    구조가 서버를 건드린 순간 이미 낡았다.
    assert.ok(saveFn.includes("runSaveSequence(steps, tokenAfterStructural,"), "칸 값 단계가 낡은 토큰을 쓴다");
    // 🔴 구조가 중간에 멈추면 칸 값으로 **안 넘어간다**.
    assert.ok(saveFn.includes("if (!canProceedToFieldSave(structuralOutcome)) {"));
    const guardAt = saveFn.indexOf("if (!canProceedToFieldSave(structuralOutcome)) {");
    assert.ok(saveFn.slice(guardAt, fieldAt).includes("return;"), "멈춰야 하는데 칸 값 단계로 흘러간다");
  });

  test("🔴 ㉠ 임시 키로 적어 둔 초안을 **진짜 키로 옮긴다** — 안 하면 새 노드에 적은 설명이 사라진다", () => {
    for (const call of [
      'rebaseDraftMapAfterStructuralSave(pendingNodeDraftsById, effects, "node")',
      'rebaseDraftMapAfterStructuralSave(pendingNodePositionsById, effects, "node")',
      'rebaseDraftMapAfterStructuralSave(pendingEdgeDraftsById, effects, "edge")',
      'rebaseDraftMapAfterStructuralSave(pendingRoutePointsByEdgeId, effects, "edge")',
    ]) {
      assert.ok(saveFn.includes(call), `${call} 이 없다 — 그 지도의 초안이 영영 안 나간다`);
    }
    // 🔴 연결선 초안은 **값 안의 노드 번호까지** 옮긴다 — 「방금 만든 노드로 재연결」이
    //    임시 번호인 채 서버에 가면 거절당한다.
    assert.ok(saveFn.includes("rebaseEdgeDraftTargets(rebaseDraftMapAfterStructuralSave(pendingEdgeDraftsById, effects, \"edge\"), effects.resolvedIds)"));
    // 🔴 옮긴 지도를 state 에도 꽂는다 — 안 꽂으면 다음 렌더가 옛 키를 다시 쓴다.
    for (const setter of ["setPendingNodeDraftsById(pending.nodeDrafts);", "setPendingNodePositionsById(pending.nodePositions);", "setPendingEdgeDraftsById(pending.edgeDrafts);", "setPendingRoutePointsByEdgeId(pending.routePoints);"]) {
      assert.ok(saveFn.includes(setter), `${setter} 가 없다`);
    }
    // 🔴 칸 값 단계가 **지역 변수**를 읽는다는 근거. state 를 읽으면 옮기기 전 지도를 본다.
    assert.ok(saveFn.includes("executeSaveStep(step, expectedUpdatedAt, pending)"));
    assert.ok(flat(functionBody(screen, "async function executeSaveStep(")).includes("pending.nodeDrafts.get(step.nodeId)"));
    assert.ok(flat(functionBody(screen, "async function executeSaveStep(")).includes("pending.nodePositions.get(id)"));
  });

  test("🔴 ㉡ **막 생긴 id 는 초안이 있으면 무조건 보낸다** — dirty 셈이 조용히 건너뛰는 자리를 받친다", () => {
    assert.ok(saveFn.includes("includeBrandNewDraftEntries(computeDirtyNodeEntries(pending.nodeDrafts, saveNodesById), brandNewNodeIds, pending.nodeDrafts)"));
    assert.ok(saveFn.includes("includeBrandNewDraftEntries(computeDirtyEdgeEntries(pending.edgeDrafts, saveEdgesById), brandNewEdgeIds, pending.edgeDrafts)"));
    assert.ok(saveFn.includes("includeBrandNewDraftIds(computeDirtyPositionNodeIds(pending.nodePositions, saveNodesById), brandNewNodeIds, pending.nodePositions)"));
    assert.ok(saveFn.includes("includeBrandNewDraftIds(computeDirtyRouteEdgeIds(pending.routePoints, saveEdgesById), brandNewEdgeIds, pending.routePoints)"));
    // 🔴 「막 생긴 id」가 어디서 오는가 — 구조 결과에서 뽑는다.
    assert.ok(saveFn.includes("const effects = collectStructuralIdEffects(structuralOutcome);"));
    assert.ok(saveFn.includes("brandNewNodeIds = effects.createdNodeIds;"));
    assert.ok(saveFn.includes("brandNewEdgeIds = effects.createdEdgeIds;"));
    // 🔴 **받침 둘도 함께 옮긴다.** planSaveSteps 도 `if (!server) continue;` 로 건너뛰므로,
    //    받침이 임시 번호를 든 채면 위 네 줄을 다 해도 그 걸음이 안 선다.
    assert.ok(saveFn.includes('saveNodesById = rebaseSnapshotMap(nodesById, effects, "node");'));
    assert.ok(saveFn.includes('saveEdgesById = rebaseSnapshotMap(edgesById, effects, "edge");'));
    assert.ok(saveFn.includes("serverNodesById: saveNodesById,") && saveFn.includes("serverEdgesById: saveEdgesById,"));
  });

  test("🔴 ㉢ 같은 저장에서 **지워진 것의 초안은 버려진다** — 안 버리면 저장 전체가 실패한다", () => {
    // 지우는 그 자리에서 한 번(이웃 시험이 글자를 센다), rebase 가 한 번 더 — 값으로 확인한다.
    const effects = collectStructuralIdEffects({
      succeededOperations: [{ kind: "DELETE_NODE", nodeId: "n-b", reason: null }],
      resolvedIds: new Map<string, string>(),
    });
    assert.deepEqual(effects.deletedNodeIds, ["n-b"], "표본 확인 — 지워진 id 를 못 모으면 아래가 공짜로 통과한다");
    const drafts = new Map([
      ["n-a", "살아남아야 하는 초안"],
      ["n-b", "지워진 노드의 초안"],
    ]);
    const rebased = rebaseDraftMapAfterStructuralSave(drafts, effects, "node");
    assert.deepEqual([...rebased.keys()], ["n-a"], "지워진 노드의 초안이 안 버려졌다");
  });

  test("🔴 ㉠㉡ 값으로 한 번 더 — 임시 키가 진짜 키로 옮겨지고, 그 줄이 보낼 목록에 선다", () => {
    const effects = collectStructuralIdEffects({
      succeededOperations: [{ kind: "CREATE_NODE", tempNodeId: "real-1", nodeType: "TASK", title: "새 노드", position: null }],
      resolvedIds: new Map([["tmp:node:1", "real-1"]]),
    });
    assert.deepEqual(effects.createdNodeIds, ["real-1"], "표본 확인 — 만든 id 를 못 모으면 아래가 공짜로 통과한다");

    const drafts = new Map([["tmp:node:1", { title: "새 노드", description: "코일 변색", instructions: "", nodeType: "TASK" }]]);
    const rebased = rebaseDraftMapAfterStructuralSave(drafts, effects, "node");
    assert.deepEqual([...rebased.keys()], ["real-1"], "임시 키가 진짜 키로 안 옮겨졌다");

    // 🔴 서버 스냅숏에 그 행이 **아직 없을 때**도 보내야 한다 — 그것이 ㉡의 전부다.
    const forced = includeBrandNewDraftEntries([], effects.createdNodeIds, rebased);
    assert.equal(forced.length, 1, "막 만든 노드의 초안이 보낼 목록에서 사라졌다");
    assert.equal(forced[0][0], "real-1");
    assert.equal(forced[0][1].description, "코일 변색");
    // 🔵 초안이 **없으면** 지어내지 않는다 — 지어내면 빈 값이 서버를 덮어쓴다.
    assert.deepEqual(includeBrandNewDraftEntries([], ["real-1"], new Map()), []);
    assert.deepEqual(includeBrandNewDraftIds([], ["real-1"], new Map()), []);
  });

  test("🔴 막힌 변경이 있으면 [저장]을 **아예 못 누르고**, 까닭이 줄마다 적힌다", () => {
    assert.ok(f.includes("const canSendStructural = canSendStructuralChanges(coalescedStructural);"));
    assert.ok(f.includes("disabled={!hasAnyPendingChanges || !canSendStructural || globalSaveStatus === \"saving\"}"));
    assert.ok(saveFn.includes("if (!hasAnyPendingChanges || !canSendStructural) return;"), "단추만 막고 함수는 그대로면 키·다른 길로 들어온다");
    assert.ok(f.includes("const structuralConflictMessages = describeStructuralConflicts(coalescedStructural.conflicts);"));
    assert.ok(f.includes("{structuralConflictMessages.map((message, index) => ("), "막힌 까닭을 그리는 자리가 없다 — [저장]이 꺼진 이유를 알 길이 없다");
  });
});

describe("[진단] 구조 변경 모아 두기 — ⑥🔴 되돌리기", () => {
  test("🔴 스냅샷에 **다섯째 칸**이 생겼고 서명이 그것을 센다", () => {
    assert.ok(f.includes("structuralOperations: PendingStructuralOperation[];"), "스냅샷 타입에 구조 목록이 없다");
    assert.ok(f.includes("structuralOperations: pendingStructuralOperations,"), "스냅샷을 찍을 때 구조 목록이 안 실린다");
    assert.ok(f.includes("procedureStructuralOperationsSignature(snapshot.structuralOperations),"), "서명에 구조 목록이 안 섞였다");
    assert.ok(flat(functionBody(screen, "function applyPendingSnapshot(")).includes("setPendingStructuralOperations([...snapshot.structuralOperations]);"), "되돌릴 때 구조 목록이 안 돌아온다");
  });

  test("🔴 값: 구조 목록만 다르면 **서명도 달라야** 한다 — 같으면 [이전]이 그 칸을 조용히 버린다", () => {
    const before = procedureStructuralOperationsSignature([]);
    const after = procedureStructuralOperationsSignature([{ kind: "DELETE_NODE", nodeId: "n-b", reason: null }]);
    assert.notEqual(before, after, "노드를 지운 뒤에도 서명이 같다 — 되돌리기 한 칸이 사라진다");
    // 🔵 칸 차례가 달라도 같은 목록은 같은 서명이어야 한다(헛도는 칸이 쌓이지 않게).
    assert.equal(
      procedureStructuralOperationsSignature([{ kind: "DELETE_NODE", nodeId: "n-b", reason: null }]),
      procedureStructuralOperationsSignature([{ reason: null, nodeId: "n-b", kind: "DELETE_NODE" } as PendingStructuralOperation])
    );
  });

  test("🔴 되돌리기의 **서버 왕복이 사라졌다** — 되살리려고 새 번호로 다시 만들지 않는다", () => {
    assert.ok(!screen.includes("restoreNode") && !screen.includes("restoreEdge"), "되살릴 재료를 아직 들고 다닌다");
    assert.ok(!screen.includes("pushNodeDeletionUndoStep") && !screen.includes("pushEdgeDeletionUndoStep"), "삭제 전용 되돌리기 칸이 남아 있다");
    assert.ok(!undoFn.includes("await "), "[이전]이 아직 서버를 기다린다");
    assert.ok(!undoFn.includes("Action("), "[이전]이 아직 서버를 부른다");
    assert.ok(undoFn.includes("setPendingUndoStack(result.stack);"), "되돌린 뒤 스택을 반영하는 줄이 사라졌다");
    assert.ok(undoFn.includes("if (result.restored) applyPendingSnapshot(result.restored.snapshot);"));
    // 🔴 [앞으로]의 **특례도 함께 사라졌다.** 서버 되살리기가 없어졌으므로 구조 변경도
    //    다른 변경과 똑같이 앞뒤로 오간다 — `future: []` 로 빼던 줄이 남아 있으면 안 된다.
    assert.ok(!f.includes("setPendingUndoStack({ past: result.stack.past, future: [] });"), "[앞으로]에서 빼는 옛 특례가 남아 있다");
    assert.ok(redoFn.includes("setPendingUndoStack(result.stack);"));
    // 🔵 되돌리기 단추가 「도는 중」을 말할 까닭도 없어졌다.
    assert.ok(f.includes("isUndoing={false}") && f.includes("isRedoing={false}"));
    assert.ok(!f.includes("{undoError &&"), "서버 왕복이 없는데 실패 글 자리가 남아 있다");
  });
});

describe("[진단] 구조 변경 모아 두기 — ⑦🔴 **옮기지 않기로 한 것**과 패널의 뒤처리", () => {
  test("🔴 노드 유형 변경·연결선 재연결은 **여전히 SaveStep** 이다(2026-11-21 결정)", () => {
    // 🔴 그 둘을 구조 조작으로 옮기면 같은 일을 하는 길이 두 벌 생긴다. 화면에서
    //    보이는 동작이 이미 같고, 잘 도는 것을 건드리지 않는다.
    assert.ok(!f.includes('kind: "CHANGE_NODE_TYPE"'), "노드 유형 변경이 구조 조작으로 쌓이고 있다");
    assert.ok(!f.includes('kind: "RETARGET_EDGE"'), "연결선 재연결이 구조 조작으로 쌓이고 있다");
    // 🔵 그래서 그 둘은 여전히 칸 값 단계의 걸음으로 선다는 근거.
    const execute = flat(functionBody(screen, "async function executeSaveStep("));
    assert.ok(execute.includes('if (step.kind === "NODE_TYPE") {'));
    assert.ok(execute.includes("await changeRepairCaseFlowchartNodeTypeAction({"));
    assert.ok(execute.includes('if (step.kind === "EDGE_RETARGET") {'));
    assert.ok(execute.includes("await retargetRepairCaseFlowchartEdgeAction({"));
    // 🔴 그리고 구조 보내기 쪽은 그 둘을 받으면 **소리를 낸다** — 조용히 넘기면
    //    누군가 쌓기 시작한 날 아무도 못 잡는다.
    const structural = flat(functionBody(screen, "async function executeStructuralOperation("));
    assert.ok(structural.includes('case "CHANGE_NODE_TYPE": case "RETARGET_EDGE": return { ok: false,'));
  });

  test("🔴 「붙은 선도 함께 지우기」는 **C3 에서** · [범위 선택]의 복수 삭제는 **B3′ 에서** 왔다", () => {
    // 🔴 2026-11-21 — 조각 C2 에서는 「이번 조각의 일이 아니다」로 **없음**을 재던
    //    자리다. 같은 날 조각 C3 에서 쓰는 분 결정으로 실제로 들어왔으므로 단언을
    //    **반대 방향으로** 고쳐 적었다(지우면 「들어왔다 다시 빠져도」 아무도 모른다).
    //    🔵 무엇을 쌓고 무엇을 치우는지는 이웃
    //       case-flowchart-node-delete-cascade-ui.test.ts 가 항목별로 잰다.
    assert.ok(screen.includes("planProcedureNodeDeletionOperations"), "노드 삭제가 붙은 선을 안 쌓는다 — C3 에서 들어온 것이다");
    // 🔴 2026-11-21(조각 B3′) — **복수 쪽도 들어왔다.** 전에는 「여전히 없다」를 재던
    //    두 줄이고, 단수(…ToNode)와 복수(…ToNodes)가 글자 한 자 차이라 「몰래 들어와도
    //    위 단언은 통과한다」는 까닭으로 따로 세고 있었다. 그 까닭은 **방향만 뒤집어**
    //    그대로 산다 — 복수가 조용히 **빠져도** 단수 쪽 단언은 멀쩡히 통과한다.
    assert.ok(screen.includes("findEdgesAttachedToNodes"), "복수 삭제용 셈 함수가 사라졌다");
    assert.ok(screen.includes("planProcedureNodesDeletionOperations"), "복수 삭제용 쌓기 함수가 사라졌다");
    // 🔴 둘 다 **단수와 같은 한 벌**에서 온다는 근거 — 진단이 제 손으로 베껴 적으면
    //    「노드 하나를 지우면 무엇이 쌓이는가」가 두 벌이 된다.
    assert.ok(
      flat(screenRaw).includes('} from "@/lib/domain/procedure-editor-node-deletion";'),
      "복수 짝을 절차 쪽 한 벌에서 안 들여온다"
    );
    assert.ok(flat(screenRaw).includes('import { removeNodesFromSelection } from "@/lib/graph-editor-core/box-selection";'), "집합에서 빼는 셈도 공용 한 벌이어야 한다");
    // 🔴 2026-11-21(조각 B2′) — 전에는 「[범위 선택]의 상태가 **없다**」를 재던 자리다.
    //    그 도구가 들어오면서 상태가 이 화면까지 올라왔고, B3′ 가 그것을 **읽기
    //    시작했다.** 그래서 아래 한 줄도 「늘 꺼져 있다」에서 **「렌더마다 갱신되는 ref
    //    로 건넨다」**로 뒤집어 적는다.
    assert.ok(screen.includes("const [boxSelectedNodeIds, setBoxSelectedNodeIds] = useState<ReadonlySet<string>>(() => new Set<string>());"), "[범위 선택]의 상태가 사라졌다");
    assert.ok(f.includes("boxSelectActive: deleteByKeyRef.current.boxSelectActive,") && f.includes("boxSelectedNodes: deleteByKeyRef.current.boxSelectedNodes,"));
  });

  test("🔴 만들기 패널의 뒤처리를 하나도 안 잃었다 — 입력칸 비우기 · 켜고 끄는 조건", () => {
    assert.ok(createNodePanel.includes("setTitle(\"\"); setDescription(\"\");"), "노드 만들기 뒤 입력칸 비우기가 사라졌다");
    assert.ok(createNodePanel.includes("disabled={title.trim().length === 0}"), "제목이 비면 못 누르는 조건이 사라졌다");
    assert.ok(createEdgePanel.includes("setToNodeId(\"\");"), "연결선 만들기 뒤 대상 비우기가 사라졌다");
    assert.ok(createEdgePanel.includes("const canSubmit = fromNodeId.length > 0 && toNodeId.length > 0 && !isSelfEdge && !labelRequired;"), "연결선 만들기의 켜고 끄는 조건이 바뀌었다");
    assert.ok(edgePanel.includes("setShowInsertNodeForm(false); setInsertNodeTitle(\"\");"), "끼우기 뒤 폼 접기·제목 비우기가 사라졌다");
    assert.ok(edgePanel.includes("disabled={insertNodeTitle.trim().length === 0}"), "끼우기의 켜고 끄는 조건이 사라졌다");
  });

  test("🔴 자리를 **비워서 보내지 않는다** — 미리보기가 (0,0)에 그리고 저장 뒤 자리가 뛰면 안 된다", () => {
    // 고른 노드가 없을 때도 서버와 **같은 규칙**(x 0, 맨 아래 + 150)으로 자리를 정해 보낸다.
    assert.ok(createNodePanel.includes("if (allNodes.length === 0) return { x: 0, y: 0 };"));
    assert.ok(createNodePanel.includes("+ BELOW_SELECTED_SPACING.vertical };"));
    assert.ok(createNodePanel.includes("position: { x: number; y: number }"), "자리가 선택 칸이 되면 비워 보낼 길이 다시 열린다");
    assert.ok(createNodeFn.includes("position: input.position"), "화면이 받은 자리를 안 싣는다");
  });

  test("🔴 노드 추가의 **설명 칸**이 초안으로 얹힌다 — CREATE_NODE 가 안 싣는 칸이다", () => {
    assert.ok(createNodeFn.includes("if (created?.kind !== \"CREATE_NODE\") return;"));
    assert.ok(createNodeFn.includes("next.set(created.tempNodeId, { title: input.title, description, instructions: \"\", nodeType: input.nodeType });"));
    // 🔵 비어 있으면 **안 얹는다** — 빈 초안을 얹으면 「바뀐 것 없음」이 한 건 더 세어진다.
    assert.ok(createNodeFn.includes("if (description.length === 0) return;"));
  });

  test("🔴 끼우기가 **쪼개진 선의 초안 끝점**을 새 노드로 맞춘다 — 안 맞추면 저장이 끼우기를 되돌린다", () => {
    assert.ok(insertNodeFn.includes("if (inserted?.kind !== \"INSERT_NODE_ON_EDGE\") return;"));
    assert.ok(insertNodeFn.includes("next.set(edgeId, { ...draft, toNodeId: inserted.tempNodeId });"));
    // 🔵 초안이 없으면 아무것도 안 한다(없는 초안을 지어내면 「재연결됨」이 한 건 생긴다).
    assert.ok(insertNodeFn.includes("if (!draft) return prev;"));
  });
});
