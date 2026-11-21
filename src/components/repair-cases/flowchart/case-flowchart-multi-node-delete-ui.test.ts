import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

/**
 * ============================================================================
 * 「진단 Flowchart」 편집기 — **[범위 선택]으로 고른 여럿을 [Delete] 로**, 화면 쪽 이음새
 * (2026-11-21, 조각 B3′)
 * ============================================================================
 * 쓰는 분의 요청(원문): 「[진단 FLOWCHART]에서도 같은 동작이 되야 해.」 — 「기술 작업
 * 절차」 편집기에 붙인 다섯을 이쪽으로 옮기는 **마지막 조각**이다. 앞 조각 둘이
 * **고르고 함께 옮기는 것**까지 깔았고(B1′ 밑자락 · B2′ 도구 단추), 이 조각이
 * **고른 것을 한 번에 지운다.**
 *
 * **무엇을 지울지**를 정하는 규칙은 순수 함수에 있고 값으로 재어진다
 * (src/lib/domain/procedure-editor-delete-key.test.ts ⑦절 — 모드가 아니면 안 본다 ·
 * 막힌 것만 빼고 지운다 · 전부 막히면 단수로 안 흘러내린다). **무엇을 쌓을지**도
 * 그렇다(src/lib/domain/procedure-editor-node-deletion.test.ts ⑦⑧절 — 선 먼저 ·
 * 겹치는 선은 한 번만 · 접기가 중복을 한 줄로 만든다). 🔵 그 둘은 절차와 **같은 한
 * 벌**이다. 이름이 `procedure-` 로 시작해도 import 가 하나도 없고 입력이 전부
 * string · boolean · null 이라 그대로 쓴다 — 베끼면 두 잣대가 생긴다.
 *
 * **이 파일이 재는 것은 화면이 그 둘을 제대로 물고 있는가** 하나다.
 *
 * ── 🔴 여기서 가장 조용히 깨지는 것 ─────────────────────────────────────
 *  ① **[이전] 한 칸이 아니게 되는 것.** 고리를 돌며 노드마다 쌓으면 지금은 우연히
 *     한 칸으로 접힐 수 있다(스냅샷 ref 가 한 이벤트 안에서 안 바뀐다). 그 성질은
 *     최적화이지 약속이 아니라서, 어느 날 조용히 다섯 칸이 된다 — 한 번 눌러도
 *     하나만 돌아온다.
 *  ② **뒤처리를 빠뜨리는 것.** 지워진 노드·선의 저장 전 수정을 안 버리면 **같은
 *     저장에서 없는 행에 값을 쓰려 들어 저장 전체가 실패한다.** 단수가 치우는 지도
 *     넷을 복수도 똑같이 치워야 한다.
 *  ③ **찾는 목록을 바꾸는 것.** 이 편집기는 연결선 재연결을 구조 조작이 아니라
 *     **초안 지도**로 들고 있어서, 미리보기 목록(structuralPreview.edges)은 저장 전에
 *     옮긴 선의 **옛 양 끝**을 들고 있다. 그것으로 세면 떠난 선을 지우고 옮겨 온
 *     선은 남긴다 — 둘 다 사람이 시킨 적 없는 일이고, 남은 쪽은 [저장]에서 실패한다.
 *     🔵 단수 쪽에서 값으로 확인된 자리다(case-flowchart-node-delete-cascade-ui.test.ts).
 *  ④ **모드를 안 보고 지우는 것.** 고른 집합은 [범위 선택] 모드에서만 테두리로
 *     보인다. 모드를 벗어나면 안 보이는 채 남는데, 그때 키가 그것을 지우면 사람은
 *     무엇이 사라졌는지도 모른다.
 *  ⑤ **단수 함수 안에 가지를 치는 것.** 그러면 그 함수가 통로를 두 번 지나기 쉽고,
 *     「삭제 한 번에 한 번」이 깨진다(이웃 시험 둘이 단수를 정확히 1회로 못 박는다).
 *  ⑥ **상시 안내를 세우는 것.** 절차 쪽에서 두 번 세웠다 두 번 다 지워 달라는
 *     요청을 받았다(커밋 d57f664a). 진단 쪽에도 안 세운다.
 *
 * 🔵 이 조각이 함께 바로잡은 **「[범위 선택] 모드에서 「화면에서 선택」이 먼저
 *    이긴다」**는 이웃 case-flowchart-box-selection-tool.test.ts ⑧절이 잰다 —
 *    그 차례는 그림(CaseFlowchartGraph)의 일이고 이 파일은 편집기만 본다.
 *
 * ── 왜 렌더가 아니라 원본을 읽는가 ──────────────────────────────────────
 * CaseFlowchartEditorScreen 은 @xyflow/react 의 .css 와 서버 액션(→ server-only)을
 * 사슬로 물고 있어 어느 목록에서도 import 자체가 던진다. 이웃들
 * (case-flowchart-delete-key-ui.test.ts · case-flowchart-node-delete-cascade-ui.test.ts)이
 * 같은 사정에서 쓴 방법 그대로다.
 *
 * ── 🔴 주석을 걷어내고 센다 ─────────────────────────────────────────────
 * 이번 변경의 주석에는 쓰는 분의 요청 원문과 **[Delete]** 라는 글자가 그대로 들어
 * 있다. 안 걷으면 「안내를 안 세웠는가」 쪽이 영영 깨진다. ①절의 마지막 단언이
 * 걷어내기가 실제로 일한다는 증거다.
 * ============================================================================
 */

const repoUrl = new URL("../../../../", import.meta.url);
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
  screen: "src/components/repair-cases/flowchart/CaseFlowchartEditorScreen.tsx",
  graph: "src/components/repair-cases/flowchart/CaseFlowchartGraph.tsx",
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
const deleteNodesFn = flat(functionBody(screen, "function handleDeleteNodes(nodeIds: readonly string[])"));
/** 단수 쪽 — 이 조각이 **한 글자도 안 건드렸다**는 것을 보이는 데 쓴다. */
const deleteNodeFn = flat(functionBody(screen, "function handleDeleteNode(nodeId: string)"));
/** 키를 받는 그 한 자리. */
const keyHandler = flat(functionBody(screen, "function handleKeyDown(e: KeyboardEvent)"));

describe("[진단] 여럿을 한 번에 지운다 — ① 먼저 표본 확인", () => {
  test("🔵 파일 다섯이 읽혔고, 재려는 손잡이가 실제로 거기 있다", () => {
    // 🔵 길이는 **날것**으로 잰다. 순수 모듈 셋은 주석을 걷어내면 몇 백 자밖에
    //    안 남는다(거의 전부가 까닭을 적은 머리말이다) — 걷어낸 길이로 재면
    //    「파일이 비었다」와 「주석이 많다」를 못 가른다.
    for (const [name, path] of Object.entries(PATHS)) {
      assert.ok(read(path).length > 2000, `${name} 이 비어 있거나 너무 짧다 — 경로가 틀리면 아래 단언이 전부 공짜로 통과한다`);
    }
    assert.ok(deleteNodesFn.length > 400, `복수 손잡이 몸통을 못 떼어 냈다(길이 ${deleteNodesFn.length}) — 아래 절들이 빈 글자를 뒤지게 된다`);
    assert.ok(deleteNodeFn.length > 300, `단수 손잡이 몸통을 못 떼어 냈다(길이 ${deleteNodeFn.length})`);
    assert.ok(keyHandler.length > 200, `keydown 몸통을 못 떼어 냈다(길이 ${keyHandler.length})`);
    assert.ok(planModule.includes('action: "DELETE_NODES"'), "판정에 복수 가지가 없다");
    assert.ok(deletionModule.includes("export function planProcedureNodesDeletionOperations("), "복수로 쌓을 줄을 정하는 본체");
    assert.ok(deletionModule.includes("export function findEdgesAttachedToNodes("), "여러 노드에 붙은 선을 찾는 본체");
    assert.ok(selectionModule.includes("export function removeNodesFromSelection("), "고른 집합에서 빼는 본체");
  });

  test("🔴 주석 걷어내기가 실제로 일을 한다 — 날것에는 요청 원문과 [Delete] 글자가 남아 있다", () => {
    assert.ok(screenRaw.includes("[진단 FLOWCHART]에서도 같은 동작이 되야 해"), "요청 원문이 주석에 경위로 남아 있어야 한다");
    assert.ok(!screen.includes("[진단 FLOWCHART]에서도 같은 동작이 되야 해"), "걷어낸 쪽에는 없어야 한다");
    assert.ok(screenRaw.includes("[Delete]"), "주석에 [Delete] 글자가 있어야 ⑥절의 「없다」가 뜻을 갖는다");
  });
});

describe("[진단] 여럿을 한 번에 지운다 — ②🔴 고른 집합을 **편집기가 읽는다**", () => {
  test("🔴 **통제형**이다 — 편집기가 들고, 그림에 넘긴다", () => {
    assert.ok(f.includes("const [boxSelectedNodeIds, setBoxSelectedNodeIds] = useState<ReadonlySet<string>>(() => new Set<string>());"), "편집기가 집합을 안 든다");
    assert.ok(flat(graph).includes("const boxSelectedNodeIds = controlledBoxSelectedNodeIds ?? internalBoxSelectedNodeIds;"), "그림이 통제형-내부값 겹침이 아니다");
    assert.ok(flat(screen).includes("boxSelectedNodeIds={boxSelectedNodeIds} onBoxSelectionChange={setBoxSelectedNodeIds}"), "편집기가 집합을 안 넘긴다");
  });

  test("🔴 **모드 관문이 그림과 같은 값**이다 — 갈리면 안 보이는 것이 지워진다", () => {
    // 🔴 그림은 이 값으로 「칸에 테두리를 실을지」를, 편집기는 「키가 집합을 볼지」를
    //    정한다. 한쪽만 고치는 날 보이지 않는 것이 지워지거나, 보이는데 안 지워진다 —
    //    둘 다 오류를 한 번도 안 낸다.
    // 🔵 그림의 관문은 둘로 나뉘어 있다(쓸 수 있는 그림인가 + 지금 그 모드인가).
    //    편집기는 그 둘을 합친 값을 제 손에 든 둘(canEdit · canvasTool)로 다시 센다 —
    //    그림에 넘기는 `editable` 이 곧 `canEdit` 이라 같은 값이 나온다.
    assert.ok(graph.includes("const canUseBoxSelect = editable;"), "그림 쪽 관문 ①이 바뀌었다");
    assert.ok(graph.includes('const boxSelectActive = canUseBoxSelect && canvasTool === "BOX_SELECT";'), "그림 쪽 관문 ②가 바뀌었다");
    assert.ok(flat(graph).includes("editable={canEdit}") === false, "이 줄은 편집기 쪽에 있어야 한다(그림이 제 손으로 적으면 안 된다)");
    assert.ok(f.includes("editable={canEdit}"), "편집기가 그림에 넘기는 값이 canEdit 이 아니다 — 두 관문이 갈린다");
    assert.ok(f.includes('const boxSelectActive = canEdit && canvasTool === "BOX_SELECT";'), "편집기 쪽 관문이 그림과 다르다");
  });

  test("🔴 고른 칸은 **그림에 그려진 목록**에서 추린다 — 사라진 id 에 삭제가 쌓이면 [저장]이 막힌다", () => {
    // 🔴 단수 쪽이 `selectedNode?.id` 로 지키는 것과 같은 규칙이다. 집합을 돌며 노드를
    //    찾으면 그 사이 사라진 칸(되돌리기로 없어진 노드)의 id 가 그대로 삭제로 쌓인다.
    // 🔴 그리고 **막는 까닭은 칸마다 null** 이다 — 절차가 보는 칸(체크리스트 · 고장
    //    진단표)이 진단 노드 행에는 아예 없어 셀 수조차 없다. 다른 값이 들어가는 날
    //    단추와 키가 다른 답을 내기 시작한다(단추 쪽에는 미리 막는 판정이 없다).
    assert.ok(
      f.includes("const boxSelectedDeleteCandidates = renderedNodes .filter((n) => boxSelectedNodeIds.has(n.id)) .map((n) => ({ id: n.id, deleteBlockedReason: null }));"),
      "고른 칸을 추리는 줄이 바뀌었다"
    );
    assert.ok(!screen.includes("resolveProcedureNodeDeleteBlockedReason"), "진단 화면이 절차의 셈 함수를 부르고 있다 — 진단 노드 행에는 그 칸이 없다");
    // 🔵 판정 쪽에 그 칸이 실제로 있다는 근거 — 이름이 바뀌면 위 null 이 「없는 칸에
    //    넘기는 글자」가 되어 영영 통과한다.
    assert.ok(planModule.includes("readonly deleteBlockedReason: string | null }"), "판정이 칸마다 받는 자리가 사라졌다");
  });
});

describe("[진단] 여럿을 한 번에 지운다 — ③🔴 판정은 **순수 함수**가 한다", () => {
  test("🔴 복수 가지도 **판정이 들고 나온 id** 를 그대로 지운다", () => {
    assert.ok(keyHandler.includes('if (plan.action === "DELETE_NODES") {'), "키에 복수 가지가 없다");
    assert.ok(keyHandler.includes("deleteByKeyRef.current.nodes(plan.nodeIds);"), "판정이 준 목록 말고 다른 것을 지우고 있다");
    assert.ok(!keyHandler.includes("boxSelectedNodeIds"), "키가 집합을 직접 뒤지고 있다 — 판정을 건너뛰는 길이다");
    // 🔴 복수가 **단수보다 앞**이다. 오늘은 둘이 동시에 설 수 없어 눈에 안 보이지만,
    //    어느 쪽이 이기는지는 코드에 적혀 있어야 한다(판정의 차례와 같아야 한다).
    assert.ok(
      keyHandler.indexOf('if (plan.action === "DELETE_NODES") {') < keyHandler.indexOf('if (plan.action === "DELETE_NODE") {'),
      "복수 갈래가 단수보다 뒤에 있다 — 판정의 차례와 어긋난다"
    );
  });

  test("🔴 **막힌 것을 거르는 일을 화면이 다시 하지 않는다** — 거름은 판정 안에 있다", () => {
    assert.ok(!keyHandler.includes("deleteBlockedReason:"), "키가 제 손으로 까닭을 적고 있다");
    assert.ok(!deleteNodesFn.includes("deleteBlockedReason"), "쌓는 손잡이가 제 손으로 거르고 있다");
    assert.ok(planModule.includes("const deletable = input.boxSelectedNodes.filter((node) => node.deleteBlockedReason === null);"), "판정에서 거르는 줄이 사라졌다");
    // 🔴 판정이 **모드를 안 보면** 안 보이는 것이 지워진다. 그 관문이 거기 있다는 근거.
    assert.ok(planModule.includes("if (input.boxSelectActive && input.boxSelectedNodes.length > 0) {"), "판정의 모드 관문이 사라졌다");
  });

  test("🔴 모드와 집합은 **ref 로 나르고 렌더마다 갱신**된다 — 의존성에 넣으면 글자 한 자마다 등록이 돈다", () => {
    // 🔴 고른 칸 목록은 렌더마다 새 배열이다(renderedNodes 가 초안을 물고 있어 칸 하나에
    //    글자를 칠 때마다 신원이 바뀐다). 의존성에 넣으면 keydown 등록·해제가 그때마다
    //    돈다. ref 는 렌더마다 갱신되고 키는 눌린 그 순간 읽으므로 값은 늘 최신이다.
    assert.ok(keyHandler.includes("boxSelectActive: deleteByKeyRef.current.boxSelectActive,"));
    assert.ok(keyHandler.includes("boxSelectedNodes: deleteByKeyRef.current.boxSelectedNodes,"));
    const refresh = flat(screen.slice(screen.indexOf("deleteByKeyRef.current = {")));
    assert.ok(
      refresh.startsWith(
        "deleteByKeyRef.current = { node: handleDeleteNode, edge: handleDeleteEdge, nodes: handleDeleteNodes, removeSelectedWaypoint: handleRemoveSelectedWaypoint, boxSelectActive, boxSelectedNodes: boxSelectedDeleteCandidates, };"
      ),
      `ref 갱신이 바뀌었다: ${refresh.slice(0, 260)}`
    );
    // 🔴 갱신 효과에 **의존성 배열이 없어야** 렌더마다 돈다. 하나라도 붙으면 옛 값으로 지운다.
    assert.ok(refresh.slice(0, 400).includes("});"), "갱신 효과가 안 닫혔다");
    assert.ok(!refresh.slice(0, 400).includes("}, ["), "ref 갱신 효과에 의존성 배열이 붙었다 — 옛 집합으로 지우게 된다");
    // 🔵 거꾸로, 키 등록 쪽 의존성에는 그 둘이 **없어야** 한다(있으면 위 아낌이 헛돈다).
    const deps = f.slice(f.indexOf('window.addEventListener("keydown", handleKeyDown)'), f.indexOf('window.addEventListener("keydown", handleKeyDown)') + 300);
    assert.ok(!deps.includes("boxSelect"), `keydown 의존성에 모드·집합이 들어갔다: ${deps.slice(0, 200)}`);
  });

  test("🔴 keydown 등록은 여전히 **하나**다 — 복수를 더하면서 둘이 되기 쉬운 자리다", () => {
    assert.equal(countOf(screen, 'addEventListener("keydown"'), 1);
    assert.equal(countOf(keyHandler, "e.preventDefault();"), 1, "preventDefault 가 흩어졌다");
    assert.ok(keyHandler.indexOf('if (plan.action === "NONE") return;') < keyHandler.indexOf("e.preventDefault();"), "NONE 인데 preventDefault 를 한다");
  });
});

describe("[진단] 여럿을 한 번에 지운다 — ④🔴 [이전] **한 칸**", () => {
  test("🔴 쌓는 호출이 **하나**다 — 노드마다 부르면 어느 날 조용히 N칸이 된다", () => {
    assert.equal(countOf(deleteNodesFn, "queueStructural("), 1, "삭제 한 번에 통로를 여러 번 지난다");
    assert.ok(deleteNodesFn.includes("queueStructural(() => planProcedureNodesDeletionOperations(renderedEdges, nodeIds, null));"));
    // 🔵 그 통로가 **목록을 고치기 전에** 되돌리기 한 칸을 찍는다는 근거 — 뒤에 찍으면
    //    이미 바뀐 목록이 담겨 [이전]이 한 칸씩 밀린다.
    const queueFn = flat(functionBody(screen, "function queueStructural("));
    assert.ok(queueFn.indexOf("pushPendingUndoStep();") < queueFn.indexOf("appendPendingStructuralOperations("), "되돌리기 한 칸이 목록을 고친 뒤에 찍힌다");
  });

  test("🔴 **합친 배열 하나**를 순수 판정이 만든다 — 화면이 고리를 돌지 않는다", () => {
    assert.ok(!deleteNodesFn.includes("for ("), "화면이 고리를 돌며 쌓고 있다");
    assert.ok(!deleteNodesFn.includes(".flatMap("), "화면이 제 손으로 줄을 이어 붙이고 있다");
    assert.ok(!deleteNodesFn.includes('kind: "DELETE_NODE"'), "화면이 삭제 줄을 직접 적고 있다");
    assert.ok(!deleteNodesFn.includes('kind: "DELETE_EDGE"'), "화면이 삭제 줄을 직접 적고 있다");
    // 🔵 그 순수 함수가 **선 먼저 · 노드 나중**으로 적어 낸다는 근거(서버는 선이 붙은
    //    노드를 아직 거절한다 — 차례 하나가 이 기능 전체를 떠받친다).
    assert.ok(deletionModule.includes("...attachedEdgeIds.map((edgeId): PendingStructuralOperation => ({ kind: \"DELETE_EDGE\", edgeId, reason })),"), "순수 쪽 차례가 바뀌었다");
  });

  test("🔴 찾는 목록이 **그려진 선**(renderedEdges)이다 — 다른 목록이면 옮긴 선이 어긋난다", () => {
    assert.ok(deleteNodesFn.includes("const attachedEdgeIds = findEdgesAttachedToNodes(renderedEdges, nodeIds);"), "붙은 선을 세는 줄");
    assert.equal(countOf(f, "findEdgesAttachedToNodes(edges,"), 0, "서버 목록에서 찾고 있다");
    assert.equal(countOf(f, "findEdgesAttachedToNodes(structuralPreview.edges,"), 0, "초안을 안 얹은 목록에서 찾고 있다");
    assert.equal(countOf(f, "planProcedureNodesDeletionOperations(edges,"), 0, "서버 목록으로 쌓고 있다");
    assert.equal(countOf(f, "planProcedureNodesDeletionOperations(structuralPreview.edges,"), 0, "초안을 안 얹은 목록으로 쌓고 있다");
    // 🔵 「renderedEdges 가 정말 초안을 얹은 목록인가」라는 전제도 함께 센다 — 그 줄이
    //    바뀌면 위 단언들이 가리키던 뜻이 통째로 달라진다.
    assert.ok(
      f.includes("const renderedEdges: CaseFlowchartGraphEdge[] = structuralPreview.edges.map((e) => mergeEdgeForRender(e, pendingEdgeDraftsById.get(e.id), pendingRoutePointsByEdgeId.get(e.id)) );"),
      "그려진 선을 만드는 줄이 바뀌었다"
    );
  });

  test("🔴 **단수 쪽은 한 글자도 안 바뀌었다** — 복수를 그 안에 넣으면 [이전] 한 칸이 깨진다", () => {
    // 🔴 단수 함수 안에 가지를 치면 queueStructural 호출이 둘이 되기 쉽다. 그래서 새 함수다.
    assert.equal(countOf(deleteNodeFn, "queueStructural("), 1);
    assert.ok(deleteNodeFn.includes("queueStructural(() => planProcedureNodeDeletionOperations(renderedEdges, nodeId, null));"));
    assert.ok(!deleteNodeFn.includes("nodeIds"), "단수 함수가 복수를 알기 시작했다");
    assert.ok(!deleteNodeFn.includes("boxSelect"), "단수 함수가 고른 집합을 건드리기 시작했다");
  });
});

describe("[진단] 여럿을 한 번에 지운다 — ⑤🔴 뒤처리는 단수와 **똑같이**", () => {
  test("🔴 초안 지도 넷을 전부 치운다 — 하나만 빠져도 [저장]이 통째로 실패한다", () => {
    for (const setter of [
      "setPendingNodeDraftsById((prev) => dropKeys(prev, nodeIds));",
      "setPendingNodePositionsById((prev) => dropKeys(prev, nodeIds));",
      "setPendingEdgeDraftsById((prev) => dropKeys(prev, attachedEdgeIds));",
      "setPendingRoutePointsByEdgeId((prev) => dropKeys(prev, attachedEdgeIds));",
    ]) {
      assert.ok(deleteNodesFn.includes(setter), `복수 삭제가 ${setter} 를 안 치운다`);
    }
    // 🔵 단수가 치우는 것과 **같은 넷**인지 수로도 맞춰 둔다. 🔴 선 쪽 둘이 특히
    //    빠지기 쉽다 — 노드만 치우고 끝내면 딸려 지워진 선의 초안이 남아, [저장]이
    //    **없는 선**에 칸 값·경로점을 쓰려 든다(절차 쪽에서 실제로 겪은 결함이다).
    assert.equal(countOf(deleteNodesFn, "dropKeys("), 4, "복수 삭제가 치우는 지도 수가 안 맞는다");
    assert.equal(countOf(deleteNodeFn, "dropKeys("), 4, "단수 삭제가 치우는 지도 수가 바뀌었다 — 둘을 같게 둔다는 전제가 깨졌다");
    assert.equal(countOf(deleteNodesFn, "attachedEdgeIds"), 4, "딸려 지워지는 선의 id 를 쓰는 자리가 안 맞는다(뽑기 1 + 치우기 2 + 선택 풀기 1)");
  });

  test("🔴 지워진 것을 **고른 채로 두지 않는다** — 고른 경로점이 남으면 없는 선의 점을 지우러 간다", () => {
    assert.ok(deleteNodesFn.includes("if (selectedNodeId !== null && nodeIds.includes(selectedNodeId)) setSelectedNodeId(null);"));
    assert.ok(
      deleteNodesFn.includes("if (selectedEdgeId !== null && attachedEdgeIds.includes(selectedEdgeId)) { setSelectedEdgeId(null); setSelectedWaypointIndex(null); }"),
      "딸려 지워진 선을 고른 채였을 때 선택·경로점을 안 푼다"
    );
  });

  test("🔴🔴 **지운 것만 뺀다** — 집합을 통째로 갈아 끼우지 않는다", () => {
    // 🔵 진단에는 미리 막는 까닭이 하나도 없어서 **오늘은** 고른 것이 전부 지워지고
    //    집합이 빈다. 그래도 「비우기」가 아니라 「지운 것 빼기」로 적는 까닭 둘:
    //    ① 비우는 길은 그림 안의 둘(모드 전환 · 빈 바탕 누르기)뿐이어야 하고,
    //    ② 막는 까닭이 생기는 날 남는 칸이 테두리로 제 자리를 말해야 한다.
    assert.ok(deleteNodesFn.includes("setBoxSelectedNodeIds((prev) => removeNodesFromSelection(prev, nodeIds));"), "지운 것만 빼는 줄이 아니다");
    assert.ok(!deleteNodesFn.includes("new Set"), "복수 삭제가 집합을 통째로 갈아 끼우고 있다");
    assert.ok(!f.includes("setBoxSelectedNodeIds(new Set"), "편집기가 제 손으로 비우기 시작했다");
    // 🔵 비우는 두 길은 그대로 그림 안이다.
    assert.ok(graph.includes("setBoxSelectedNodeIds(new Set<string>());"), "모드 전환이 안 비운다");
    assert.ok(graph.includes("setBoxSelectedNodeIds((current) => (current.size === 0 ? current : new Set<string>()));"), "빈 바탕 누르기가 안 비운다");
  });

  test("🔴 울타리 둘 — 권한과 **빈 목록**, 그리고 둘 다 쌓기보다 앞이다", () => {
    assert.ok(deleteNodesFn.includes("if (!canEdit) return;"), "권한 울타리가 없다");
    assert.ok(deleteNodesFn.includes("if (nodeIds.length === 0) return;"), "빈 목록 관문이 없다 — 아무것도 안 바뀐 [이전] 한 칸이 찍힌다");
    assert.ok(deleteNodesFn.indexOf("if (nodeIds.length === 0) return;") < deleteNodesFn.indexOf("queueStructural("), "관문이 쌓기보다 뒤에 있다");
    // 🔴 돌아가는 길은 **그 둘뿐**이다. 수로 재야 「다른 까닭으로 조용히 안 지워지는」
    //    가지가 새로 생겼을 때 걸린다 — 그 가지는 오류를 안 낸다.
    assert.equal(countOf(deleteNodesFn, "return;"), 2, "복수 삭제에 돌아가는 길이 늘었다");
  });
});

describe("[진단] 여럿을 한 번에 지운다 — ⑥🔴 **상시 안내도 확인 창도 안 세웠다**", () => {
  test("🔴 화면에 키를 설명하는 글이 없다 — 절차 쪽에서 두 번 세웠다 두 번 다 지웠다(d57f664a)", () => {
    assert.ok(!screen.includes("[Delete]"), "편집기 화면에 키 안내가 섰다");
    assert.ok(!screen.includes("Delete 키"), "편집기 화면에 키 설명이 섰다");
    assert.ok(!screen.includes("개를 지웁니다"), "편집기 화면에 복수 삭제 안내가 섰다");
    assert.ok(!screen.includes("함께 지워집니다"), "편집기 화면에 안내 줄이 섰다");
    // 🔵 원래 있던 안내 줄은 그대로라는 근거 — 「글이 없다」가 화면이 통째로 비어서
    //    통과하는 것이 아니다.
    assert.ok(screen.includes("편집 모드 — 노드를 드래그해 위치를 조정하고"), "원래 있던 안내 줄은 그대로여야 한다");
  });

  test("🔵 확인 창도 안 띄운다 — 단수도 안 띄운다([이전] 한 번이면 전부 돌아온다)", () => {
    assert.ok(!deleteNodesFn.includes("confirm("), "복수 삭제에 확인 창이 생겼다");
    assert.ok(!keyHandler.includes("confirm("), "키에 확인 창이 생겼다");
  });

  test("🔴 **고른 수**는 전부터 있던 자리(도구 줄) 하나뿐이다 — 새 줄을 세우지 않았다", () => {
    assert.ok(flat(graph).includes("selectedCount={boxSelectedNodeIds.size}"), "도구 줄이 수를 안 받는다");
    assert.equal(countOf(graph, "selectedCount="), 1, "고른 수를 그리는 자리가 둘이 됐다");
    assert.ok(!f.includes("selectedCount"), "편집기가 고른 수를 따로 그리기 시작했다");
  });
});
