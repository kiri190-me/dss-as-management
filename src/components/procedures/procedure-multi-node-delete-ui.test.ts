import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

/**
 * ============================================================================
 * 「기술 작업 절차」 편집기 — **[범위 선택]으로 고른 여럿을 [Delete] 로**, 화면 쪽 이음새
 * (2026-11-21, 조각 B3)
 * ============================================================================
 * 쓰는 분 요청(원문): 「2번 옮기기 + [DELETE]로 지우는 것까지 하자.」 앞 조각 둘이
 * **고르고 함께 옮기는 것**까지 깔았고(B1 밑자락 · B2 도구 단추), 이 조각이
 * **고른 것을 한 번에 지운다.**
 *
 * **무엇을 지울지**를 정하는 규칙은 순수 함수에 있고 값으로 재어진다
 * (src/lib/domain/procedure-editor-delete-key.test.ts ⑦절 — 모드가 아니면 안 본다 ·
 * 막힌 것만 빼고 지운다 · 전부 막히면 단수로 안 흘러내린다). **무엇을 쌓을지**도
 * 그렇다(procedure-editor-node-deletion.test.ts ⑦⑧절). 이 파일이 재는 것은
 * **화면이 그 둘을 제대로 물고 있는가** 하나다.
 *
 * ── 🔴 여기서 가장 조용히 깨지는 것 ─────────────────────────────────────
 *  ① **[이전] 한 칸이 아니게 되는 것.** 고리를 돌며 노드마다 쌓으면 지금은 우연히
 *     한 칸으로 접힐 수 있다(스냅샷 ref 가 한 이벤트 안에서 안 바뀐다). 그 성질은
 *     최적화이지 약속이 아니라서, 어느 날 조용히 다섯 칸이 된다 — 한 번 눌러도
 *     하나만 돌아온다.
 *  ② **뒤처리를 빠뜨리는 것.** 지워진 노드·선의 초안을 안 버리면 **같은 저장에서
 *     저장 전체가 실패한다**(2026-11-21 에 실제로 겪은 결함이다). 단수가 치우는
 *     다섯 지도를 복수도 똑같이 치워야 한다.
 *  ③ **모드를 안 보고 지우는 것.** 고른 집합은 [범위 선택] 모드에서만 테두리로
 *     보인다. 모드를 벗어나면 안 보이는 채 남는데, 그때 키가 그것을 지우면 사람은
 *     무엇이 사라졌는지도 모른다.
 *  ④ **막힌 칸까지 선택에서 비우는 것.** 못 지운 칸이 골라진 채 남아야 「N개 선택」이
 *     줄다 멈추고 그 칸만 테두리가 남는다 — 이 편집기에는 안내 줄이 없어서 그것이
 *     사람이 보는 유일한 답이다.
 *  ⑤ **상시 안내를 세 번째로 세우는 것.** 2026-11-04 · 11-20 두 번 세웠다 두 번 다
 *     지워 달라는 요청을 받았다(커밋 d57f664a).
 *
 * ── 왜 렌더가 아니라 원본을 읽는가 ──────────────────────────────────────
 * ProcedureTemplateEditorScreen 은 @xyflow/react 의 .css 와 서버 액션
 * (→ server-only)을 사슬로 물고 있어 어느 목록에서도 import 자체가 던진다.
 * 이웃들(procedure-editor-delete-key-ui.test.ts ·
 * procedure-node-delete-cascade-ui.test.ts)이 같은 사정에서 쓴 방법 그대로다.
 *
 * ── 🔴 주석을 걷어내고 센다 ─────────────────────────────────────────────
 * 이번 변경의 주석에는 쓰는 분의 요청 원문과 **[Delete]** 라는 글자가 그대로 들어
 * 있다. 안 걷으면 「안내를 안 세웠는가」 쪽이 영영 깨진다. ①절의 마지막 단언이
 * 걷어내기가 실제로 일한다는 증거다.
 * ============================================================================
 */

const repoUrl = new URL("../../../", import.meta.url);
const read = (relativePath: string) => readFileSync(new URL(relativePath, repoUrl), "utf8");

function stripComments(source: string): string {
  return source
    .replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g, " ") // JSX 주석 {/* ... */}
    .replace(/\/\*[\s\S]*?\*\//g, " ") // 블록 주석
    .split(/\r?\n/)
    .filter((line) => !/^\s*\/\//.test(line)) // 줄 주석
    .join("\n");
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
  screen: "src/components/procedures/ProcedureTemplateEditorScreen.tsx",
  graph: "src/components/procedures/ProcedureFlowGraph.tsx",
  plan: "src/lib/domain/procedure-editor-delete-key.ts",
  deletion: "src/lib/domain/procedure-editor-node-deletion.ts",
  selection: "src/lib/graph-editor-core/box-selection.ts",
} as const;

const screenRaw = read(PATHS.screen);
const screen = stripComments(screenRaw);
const f = flat(screen);
const graph = stripComments(read(PATHS.graph));
const planModule = stripComments(read(PATHS.plan));
const deletionModule = stripComments(read(PATHS.deletion));
const selectionModule = stripComments(read(PATHS.selection));

/** 복수 삭제를 쌓는 손잡이 하나. 아래 여러 절이 **이 몸통 안에서만** 센다. */
const deleteNodesHandler = flat(functionBody(screen, "function handleQueueDeleteNodes(nodeIds: readonly string[])"));
/** 단수 쪽 — 이 조각이 **한 글자도 안 건드렸다**는 것을 보이는 데 쓴다. */
const deleteNodeHandler = flat(functionBody(screen, "function handleQueueDeleteNode(nodeId: string, reason: string | null)"));
/** 키를 받는 그 한 자리. */
const keyHandler = flat(functionBody(screen, "function handleKeyDown(e: KeyboardEvent)"));

describe("여럿을 한 번에 지운다(화면) — ① 먼저 표본 확인", () => {
  test("🔵 파일 다섯이 읽혔고, 재려는 손잡이가 실제로 거기 있다", () => {
    // 🔵 길이는 **날것**으로 잰다. 순수 모듈 셋은 주석을 걷어내면 몇 백 자밖에
    //    안 남는다(거의 전부가 까닭을 적은 머리말이다) — 걷어낸 길이로 재면
    //    「파일이 비었다」와 「주석이 많다」를 못 가른다.
    for (const [name, path] of Object.entries(PATHS)) {
      assert.ok(read(path).length > 2000, `${name} 이 비어 있거나 너무 짧다 — 경로가 틀리면 아래 단언이 전부 공짜로 통과한다`);
    }
    assert.ok(deleteNodesHandler.length > 400, "복수 손잡이 몸통을 못 떼어 냈다 — 아래 절들이 빈 글자를 뒤지게 된다");
    assert.ok(deleteNodeHandler.length > 200, "단수 손잡이 몸통을 못 떼어 냈다");
    assert.ok(keyHandler.length > 200, "keydown 몸통을 못 떼어 냈다");
    assert.ok(planModule.includes('action: "DELETE_NODES"'), "판정에 복수 가지가 없다");
    assert.ok(deletionModule.includes("export function planProcedureNodesDeletionOperations("), "복수로 쌓을 줄을 정하는 본체");
    assert.ok(selectionModule.includes("export function removeNodesFromSelection("), "고른 집합에서 빼는 본체");
  });

  test("🔴 주석 걷어내기가 실제로 일을 한다 — 날것에는 요청 원문이 남아 있다", () => {
    assert.ok(screenRaw.includes("2번 옮기기 + [DELETE]로 지우는 것까지 하자"), "요청 원문이 주석에 경위로 남아 있어야 한다");
    assert.ok(!screen.includes("2번 옮기기 + [DELETE]로 지우는 것까지 하자"), "걷어낸 쪽에는 없어야 한다");
  });
});

describe("여럿을 한 번에 지운다(화면) — ②🔴 고른 집합이 편집기로 올라왔다", () => {
  test("🔴 **통제형**이다 — 편집기가 들고, 그림에 넘긴다", () => {
    assert.ok(f.includes("const [boxSelectedNodeIds, setBoxSelectedNodeIds] = useState<ReadonlySet<string>>(() => new Set<string>());"), "편집기가 집합을 안 든다");
    assert.ok(flat(graph).includes("const boxSelectedNodeIds = controlledBoxSelectedNodeIds ?? internalBoxSelectedNodeIds;"), "그림이 통제형-내부값 겹침이 아니다");
    assert.ok(flat(screen).includes("boxSelectedNodeIds={boxSelectedNodeIds} onBoxSelectionChange={setBoxSelectedNodeIds}"), "편집기가 집합을 안 넘긴다");
  });

  test("🔴 **비우는 길은 그림 안에 그대로 둘**이다 — 편집기는 제 손으로 안 비운다", () => {
    // 🔴 비우는 자리가 셋이 되면 「언제 비워지는가」가 여러 곳에 적힌다. 편집기가
    //    하는 일은 **지운 칸을 빼는 것** 하나여야 한다.
    assert.equal(
      countOf(screen, "setBoxSelectedNodeIds"),
      3,
      "편집기의 setBoxSelectedNodeIds 는 선언 · 그림에 넘기기 · 지운 칸 빼기 셋뿐이어야 한다"
    );
    assert.ok(screen.includes("setBoxSelectedNodeIds((prev) => removeNodesFromSelection(prev, nodeIds));"), "지운 칸을 빼는 그 한 줄이 없다");
    assert.ok(!f.includes("setBoxSelectedNodeIds(new Set"), "편집기가 제 손으로 비우기 시작했다");
    // 🔵 비우는 두 자리는 그대로 그림 안이다(B2 가 값으로 재는 그 둘).
    assert.ok(graph.includes("setBoxSelectedNodeIds(new Set<string>());"), "모드 전환이 안 비운다");
    assert.ok(graph.includes("setBoxSelectedNodeIds((current) => (current.size === 0 ? current : new Set<string>()));"), "빈 바탕 누르기가 안 비운다");
  });

  test("🔴 **모드 관문이 그림과 같은 값**이다 — 갈리면 안 보이는 것이 지워진다", () => {
    // 🔴 그림은 이 값으로 「칸에 테두리를 실을지」를, 편집기는 「키가 집합을 볼지」를
    //    정한다. 한쪽만 고치는 날 보이지 않는 것이 지워지거나, 보이는데 안 지워진다.
    assert.ok(graph.includes('const canUseBoxSelect = editable && layoutMode === "USER";'), "그림 쪽 관문이 바뀌었다");
    assert.ok(graph.includes('const boxSelectActive = canUseBoxSelect && canvasTool === "BOX_SELECT";'), "그림 쪽 관문이 바뀌었다");
    assert.ok(f.includes('const boxSelectActive = canEdit && layoutMode === "USER" && canvasTool === "BOX_SELECT";'), "편집기 쪽 관문이 그림과 다르다");
  });

  test("🔴 고른 칸은 **그림에 그려진 목록**에서 추린다 — 사라진 id 에 삭제가 쌓이면 [저장]이 막힌다", () => {
    // 🔴 단수 쪽이 selectedNode?.id 로 지키는 것과 같은 규칙이다. 집합을 돌며 찾으면
    //    그 사이 사라진 칸의 id 가 그대로 삭제로 쌓인다.
    assert.ok(
      f.includes("renderedNodes .filter((n) => boxSelectedNodeIds.has(n.id)) .map((n) => ({ id: n.id, deleteBlockedReason: resolveProcedureNodeDeleteBlockedReason(n) }))"),
      "그려진 목록을 돌지 않거나, 까닭을 공용 함수에서 안 받는다"
    );
  });
});

describe("여럿을 한 번에 지운다(화면) — ③🔴 판정은 순수 함수가 한다", () => {
  test("🔴 복수 가지도 **판정이 들고 나온 id** 를 그대로 지운다", () => {
    assert.ok(keyHandler.includes('if (plan.action === "DELETE_NODES") {'), "키에 복수 가지가 없다");
    assert.ok(keyHandler.includes("queueDeleteByKeyRef.current.nodes(plan.nodeIds);"), "판정이 준 목록 말고 다른 것을 지우고 있다");
    assert.ok(!keyHandler.includes("boxSelectedNodeIds"), "키가 집합을 직접 뒤지고 있다 — 판정을 건너뛰는 길이다");
  });

  test("🔴 **막힌 것을 거르는 일을 화면이 다시 하지 않는다** — 거름은 판정 안에 있다", () => {
    assert.ok(!keyHandler.includes("deleteBlockedReason"), "키가 제 손으로 거르고 있다");
    assert.ok(!deleteNodesHandler.includes("deleteBlockedReason"), "쌓는 손잡이가 제 손으로 거르고 있다");
    assert.ok(planModule.includes("const deletable = input.boxSelectedNodes.filter((node) => node.deleteBlockedReason === null);"), "판정에서 거르는 줄이 사라졌다");
  });

  test("🔴 모드와 집합은 **ref 로 나르고 렌더마다 갱신**된다 — 의존성에 넣으면 글자 한 자마다 등록이 돈다", () => {
    // 🔴 집합 목록은 렌더마다 신원이 바뀔 수 있다(renderedNodes 가 초안을 물고 있다).
    //    대신 ref 가 렌더마다 갱신되고 키는 눌린 그 순간 읽으므로 값은 늘 최신이다.
    assert.ok(keyHandler.includes("boxSelectActive: queueDeleteByKeyRef.current.boxSelectActive,"));
    assert.ok(keyHandler.includes("boxSelectedNodes: queueDeleteByKeyRef.current.boxSelectedNodes,"));
    const refresh = flat(screen.slice(screen.indexOf("queueDeleteByKeyRef.current = {")));
    assert.ok(refresh.startsWith("queueDeleteByKeyRef.current = { node: handleQueueDeleteNode, edge: handleQueueDeleteEdge, nodes: handleQueueDeleteNodes, boxSelectActive, boxSelectedNodes: boxSelectedDeleteCandidates, };"), `ref 갱신이 바뀌었다: ${refresh.slice(0, 240)}`);
    // 🔴 갱신 효과에 **의존성 배열이 없어야** 렌더마다 돈다. 하나라도 붙으면 옛 값으로 지운다.
    assert.ok(refresh.slice(0, 400).includes("});"), "갱신 효과가 안 닫혔다");
    assert.ok(!refresh.slice(0, 400).includes("}, ["), "ref 갱신 효과에 의존성 배열이 붙었다 — 옛 집합으로 지우게 된다");
  });

  test("🔴 keydown 등록은 여전히 **하나**다 — 복수를 더하면서 둘이 되기 쉬운 자리다", () => {
    assert.equal(countOf(screen, 'addEventListener("keydown"'), 1);
    assert.equal(countOf(keyHandler, "e.preventDefault();"), 1, "preventDefault 가 흩어졌다");
    assert.ok(keyHandler.indexOf('if (plan.action === "NONE") return;') < keyHandler.indexOf("e.preventDefault();"), "NONE 인데 preventDefault 를 한다");
  });
});

describe("여럿을 한 번에 지운다(화면) — ④🔴 [이전] **한 칸**", () => {
  test("🔴 쌓는 호출이 **하나**다 — 노드마다 부르면 어느 날 조용히 N칸이 된다", () => {
    assert.equal(countOf(deleteNodesHandler, "queueStructural("), 1, "삭제 한 번에 통로를 여러 번 지난다");
    assert.ok(deleteNodesHandler.includes("queueStructural(() => planProcedureNodesDeletionOperations(renderedEdges, nodeIds, null));"));
  });

  test("🔴 **합친 배열 하나**를 순수 판정이 만든다 — 화면이 고리를 돌지 않는다", () => {
    assert.ok(!deleteNodesHandler.includes("for ("), "화면이 고리를 돌며 쌓고 있다");
    assert.ok(!deleteNodesHandler.includes(".flatMap("), "화면이 제 손으로 줄을 이어 붙이고 있다");
    assert.ok(!deleteNodesHandler.includes('kind: "DELETE_NODE"'), "화면이 삭제 줄을 직접 적고 있다");
    assert.ok(!deleteNodesHandler.includes('kind: "DELETE_EDGE"'), "화면이 삭제 줄을 직접 적고 있다");
  });

  test("🔴 찾는 목록이 **그려진 선**(renderedEdges)이다 — 서버 목록이면 저장 전 선을 빠뜨린다", () => {
    assert.ok(deleteNodesHandler.includes("findEdgesAttachedToNodes(renderedEdges, nodeIds)"));
    assert.equal(countOf(f, "planProcedureNodesDeletionOperations(template.edges"), 0, "서버 목록에서 찾고 있다");
    assert.equal(countOf(f, "findEdgesAttachedToNodes(template.edges"), 0, "서버 목록에서 찾고 있다");
  });

  test("🔴 **단수 쪽은 한 글자도 안 바뀌었다** — 복수를 그 안에 넣으면 [이전] 한 칸이 깨진다", () => {
    // 🔴 단수 함수 안에 가지를 치면 queueStructural 호출이 둘이 되기 쉽다. 그래서 새 함수다.
    assert.equal(countOf(deleteNodeHandler, "queueStructural("), 1);
    assert.ok(deleteNodeHandler.includes("queueStructural(() => planProcedureNodeDeletionOperations(renderedEdges, nodeId, reason));"));
    assert.ok(!deleteNodeHandler.includes("nodeIds"), "단수 함수가 복수를 알기 시작했다");
  });
});

describe("여럿을 한 번에 지운다(화면) — ⑤🔴 뒤처리는 단수와 **똑같이**", () => {
  test("🔴 초안 다섯 지도를 전부 치운다 — 하나만 빠져도 [저장]이 통째로 실패한다", () => {
    // 🔴 2026-11-21 에 실제로 겪은 결함이다(지워진 노드의 초안이 남아 저장 전체가 실패).
    for (const setter of [
      "setPendingNodeFieldDraftsById((prev) => dropMapKeys(prev, nodeIds));",
      "setPendingLayoutMoves((prev) => dropMapKeys(prev, nodeIds));",
      "setPendingEdgeFieldDraftsById((prev) => dropMapKeys(prev, attachedEdgeIds));",
      "setPendingEdgeRouteMoves((prev) => dropMapKeys(prev, attachedEdgeIds));",
      "setPendingEdgeSaveNoteById((prev) => dropMapKeys(prev, attachedEdgeIds));",
    ]) {
      assert.ok(deleteNodesHandler.includes(setter), `복수 삭제가 ${setter} 를 안 치운다`);
    }
    // 🔵 단수가 치우는 것과 **같은 다섯**인지 수로도 맞춰 둔다.
    assert.equal(countOf(deleteNodesHandler, "dropMapKeys("), 5);
    assert.equal(countOf(deleteNodeHandler, "dropMapKeys("), 5);
  });

  test("🔴 지워진 것을 **고른 채로 두지 않는다** — 고른 경로점이 남으면 없는 선의 점을 지우러 간다", () => {
    assert.ok(deleteNodesHandler.includes("if (selectedNodeId !== null && nodeIds.includes(selectedNodeId)) setSelectedNodeId(null);"));
    assert.ok(deleteNodesHandler.includes("if (selectedEdgeId !== null && attachedEdgeIds.includes(selectedEdgeId)) {"));
    assert.ok(deleteNodesHandler.includes("setSelectedWaypoint(null);"));
  });

  test("🔴🔴 **못 지운 칸은 골라진 채 남는다** — 지운 것만 뺀다", () => {
    // 🔴 통째로 비우면 무엇이 안 지워졌는지가 화면에서 사라진다. 이 편집기에는
    //    안내 줄이 없어서, 남은 테두리와 「N개 선택」 숫자가 사람이 보는 유일한 답이다.
    assert.ok(deleteNodesHandler.includes("setBoxSelectedNodeIds((prev) => removeNodesFromSelection(prev, nodeIds));"), "지운 것만 빼는 줄이 아니다");
    assert.ok(!deleteNodesHandler.includes("new Set"), "복수 삭제가 집합을 통째로 갈아 끼우고 있다");
  });

  test("🔵 빈 목록이면 아무 일도 안 한다 — 안 그러면 아무것도 안 바뀐 [이전] 한 칸이 찍힌다", () => {
    assert.ok(deleteNodesHandler.includes("if (nodeIds.length === 0) return;"));
    const guard = deleteNodesHandler.indexOf("if (nodeIds.length === 0) return;");
    assert.ok(guard !== -1 && guard < deleteNodesHandler.indexOf("queueStructural("), "관문이 쌓기보다 뒤에 있다");
  });
});

describe("여럿을 한 번에 지운다(화면) — ⑥🔴 **상시 안내를 세 번째로 세우지 않았다**", () => {
  test("🔴 화면에 키를 설명하는 글이 없다 — 이 자리에 두 번 세웠다 두 번 다 지웠다(d57f664a)", () => {
    assert.ok(!screen.includes("[Delete]"), "편집기 화면에 키 안내가 섰다");
    assert.ok(!screen.includes("Delete 키"), "편집기 화면에 키 설명이 섰다");
    assert.ok(!screen.includes("개를 지웁니다"), "편집기 화면에 복수 삭제 안내가 섰다");
    assert.ok(!screen.includes("함께 지워집니다"), "편집기 화면에 안내 줄이 섰다");
  });

  test("🔵 확인 창도 안 띄운다 — 단수도 안 띄운다([이전] 한 번이면 전부 돌아온다)", () => {
    assert.ok(!deleteNodesHandler.includes("confirm("), "복수 삭제에 확인 창이 생겼다");
    assert.ok(!keyHandler.includes("confirm("), "키에 확인 창이 생겼다");
  });

  test("🔴 **고른 수**는 전부터 있던 자리(도구 줄) 하나뿐이다 — 새 줄을 세우지 않았다", () => {
    assert.ok(flat(graph).includes("selectedCount={boxSelectedNodeIds.size}"), "도구 줄이 수를 안 받는다");
    assert.equal(countOf(graph, "selectedCount="), 1, "고른 수를 그리는 자리가 둘이 됐다");
    assert.ok(!f.includes("selectedCount"), "편집기가 고른 수를 따로 그리기 시작했다");
  });
});
