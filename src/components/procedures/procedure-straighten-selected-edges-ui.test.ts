import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

/**
 * ============================================================================
 * 「기술 작업 절차」 편집기 — **[연결 정렬]: 고른 노드들 사이의 선을 한 번에 곧게**,
 * 화면 쪽 이음새 (2026-11-22, 조각 D1)
 * ============================================================================
 * 쓰는 분 요청(2026-11-21): 「[범위 선택]으로 여러 노드를 선택한 상태에서 연결선
 * 정렬을 할 수 있도록 하자.」 뜻은 2026-11-22 에 **「고른 것끼리의 선을 곧게」**로
 * 정해졌다 — `A→B` 와 `B→C` 를 둘 다 고르면 둘 다 펴져 한 줄이 되고, `A→D` 처럼
 * **한쪽만 고른 선은 그대로 둔다.**
 *
 * **무엇을, 어떤 차례로** 펼지는 순수 함수가 답하고 값으로 재어진다
 * (src/lib/graph-editor-core/straighten-selection.test.ts — 한쪽만 고른 선을
 * 빼는가 · 차례가 앞선 노드부터인가 · 되돌아가는 선이 섞였을 때 · 자기 자신을
 * 가리키는 선). **곧게 펴는 셈**도 그렇다(graph-editor-core/layout.test.ts).
 * 이 파일이 재는 것은 **화면이 그 둘을 제대로 물고 있는가** 하나다.
 *
 * ── 🔴 여기서 가장 조용히 깨지는 것 ─────────────────────────────────────
 *  ① **자리의 출처가 단수와 갈리는 것.** 2026-11-05 에 곧게 펴기가
 *     workingLayoutPositions(저장된 값 — 기술 작업 절차에서는 x 가 전부 0 인
 *     「만든 차례」다)를 읽다가 노드를 **화면 밖으로** 보냈다. 복수 쪽이 그 길로
 *     되돌아가면 같은 결함이 그대로 재현된다.
 *  ② **[이전]이 한 칸이 아니게 되는 것.** 선마다 통로를 부르면 선 수만큼 쌓여
 *     한 번 눌러서는 안 돌아온다.
 *  ③ **앞의 결과를 안 보고 다음을 재는 것.** 전부를 처음 자리 기준으로 한꺼번에
 *     계산하면 C 가 **옛 자리의 B** 에 맞은 뒤 B 가 움직여 **사슬이 한 줄이 안
 *     된다.** 오류는 안 나고, 단추를 한 번 더 눌러야 비로소 펴진다.
 *  ④ **펼 선이 없는데 되돌리기 칸을 찍는 것.** 아무것도 안 바뀐 칸은 [이전]을 한
 *     번 헛돌게 한다 — 사람 눈에는 「단추가 안 먹었다」로 보인다.
 *  ⑤ **ProcedureCanvasToolPicker 안에 단추를 심는 것.** 그 부품은 진단
 *     Flowchart 와 **함께 쓰는 것**이라, 거기 심으면 이 기능을 아직 안 붙인 저쪽
 *     화면에 **죽은 단추**가 선다.
 *  ⑥ **상시 안내를 또 세우는 것.** 이 편집기의 안내 줄은 쓰는 분 요청으로 두 번
 *     걷어낸 자리다(커밋 d57f664a). 설명은 단추의 `title` 까지다.
 *
 * ── 왜 렌더가 아니라 원본을 읽는가 ──────────────────────────────────────
 * ProcedureTemplateEditorScreen 은 @xyflow/react 의 .css 와 서버 액션
 * (→ server-only)을 사슬로 물고 있어 어느 목록에서도 import 자체가 던진다.
 * 이웃들(procedure-multi-node-delete-ui.test.ts ·
 * procedure-editor-delete-key-ui.test.ts)이 같은 사정에서 쓴 방법 그대로다.
 *
 * ── 🔴 주석을 걷어내고 센다 ─────────────────────────────────────────────
 * 이번 변경의 주석에는 쓰는 분의 요청 원문과 **[연결 정렬]** 이라는 글자가 그대로
 * 들어 있다. 안 걷으면 「안내를 안 세웠는가」 쪽이 영영 통과한다. ①절의 마지막
 * 단언이 걷어내기가 실제로 일한다는 증거다.
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

/** `start` 로 시작해 괄호 깊이가 0으로 돌아올 때까지 — 함수/블록 하나의 몸통만 떼어 낸다. */
function blockBody(source: string, start: string, open = "{", close = "}"): string {
  const from = source.indexOf(start);
  assert.notEqual(from, -1, `원본에서 ${start} 를 못 찾았다 — 이름이 바뀌었으면 시험도 함께 고쳐야 한다`);
  const openAt = source.indexOf(open, from);
  let depth = 0;
  for (let i = openAt; i < source.length; i += 1) {
    if (source[i] === open) depth += 1;
    else if (source[i] === close) {
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
  picker: "src/components/procedures/visual/ProcedureCanvasToolPicker.tsx",
  plan: "src/lib/graph-editor-core/straighten-selection.ts",
  caseScreen: "src/components/repair-cases/flowchart/CaseFlowchartEditorScreen.tsx",
} as const;

const screenRaw = read(PATHS.screen);
const screen = stripComments(screenRaw);
const graph = stripComments(read(PATHS.graph));
const picker = stripComments(read(PATHS.picker));
const planModule = stripComments(read(PATHS.plan));
const caseScreen = stripComments(read(PATHS.caseScreen));

/** 복수 정렬을 적용하는 손잡이 하나. 아래 여러 절이 **이 몸통 안에서만** 센다. */
const straightenHandler = blockBody(screen, "const handleStraightenBoxSelection = useCallback(");
const straightenHandlerFlat = flat(straightenHandler);
/** 단수 쪽 — 이 조각이 **한 글자도 안 건드렸다**는 것과, 출처가 **같다**는 것을 보이는 데 쓴다. */
const doubleClickHandler = flat(blockBody(screen, "const handleEdgeDoubleClick = useCallback("));
/** 도구 줄에서 [범위 선택] 관련을 그리는 그 한 덩이. */
const toolRowBlock = flat(blockBody(graph, "{canUseBoxSelect && (", "(", ")"));

describe("[연결 정렬] 복수 — ① 먼저 표본 확인", () => {
  test("🔵 파일 다섯이 읽혔고, 재려는 손잡이가 실제로 거기 있다", () => {
    // 🔵 길이는 **날것**으로 잰다. 순수 모듈은 주석을 걷어내면 몇십 줄밖에 안 남는다
    //    (거의 전부가 까닭을 적은 머리말이다) — 걷어낸 길이로 재면 「파일이 비었다」와
    //    「주석이 많다」를 못 가른다.
    for (const [name, path] of Object.entries(PATHS)) {
      assert.ok(read(path).length > 1000, `${name}(${path}) 이 비었거나 자리가 바뀌었다`);
    }
    assert.ok(straightenHandler.length > 500, "복수 정렬 손잡이의 몸통이 너무 짧다 — blockBody 가 엉뚱한 곳을 떼어 왔을 수 있다");
    assert.ok(doubleClickHandler.length > 500, "단수(더블클릭) 손잡이의 몸통이 너무 짧다");
    assert.ok(toolRowBlock.length > 200, "도구 줄 덩이가 너무 짧다");
  });

  test("🔴 주석 걷어내기가 실제로 일한다 — 날것에만 있는 글이 걷어낸 쪽에는 없다", () => {
    assert.ok(screenRaw.includes("앞의 결과를 보고 다음을 잰다"), "날것에서 이 조각의 주석을 못 찾았다 — 아래 단언이 뜻을 잃는다");
    assert.ok(!screen.includes("앞의 결과를 보고 다음을 잰다"), "주석이 안 걷혔다");
  });
});

describe("[연결 정렬] 복수 — ②🔴 자리·크기·목록의 출처가 **단수와 글자 그대로 같다**", () => {
  test("🔴 선은 renderedEdges, 노드는 renderedNodes 에서 찾는다", () => {
    assert.ok(flat(screen).includes("planStraightenEdgeOrder(renderedEdges, boxSelectedNodeIds)"), "계획을 renderedEdges 로 세지 않는다");
    assert.ok(straightenHandlerFlat.includes("renderedNodes.find((n) => n.id === edge.fromNodeId)"), "시작 노드를 renderedNodes 에서 안 찾는다");
    assert.ok(straightenHandlerFlat.includes("renderedNodes.find((n) => n.id === edge.toNodeId)"), "도착 노드를 renderedNodes 에서 안 찾는다");
    assert.ok(doubleClickHandler.includes("renderedEdges.find("), "단수 쪽이 바뀌었다 — 둘의 출처가 갈렸다");
  });

  test("🔴 자리는 resolveCurrentPosition(그림이 올려보낸 화면 자리) — workingLayoutPositions 가 아니다", () => {
    assert.ok(straightenHandlerFlat.includes("resolveCurrentPosition(edge.fromNodeId)"));
    assert.ok(straightenHandlerFlat.includes("resolveCurrentPosition(edge.toNodeId)"));
    assert.ok(
      !straightenHandlerFlat.includes("workingLayoutPositions"),
      "2026-11-05 에 노드를 화면 밖으로 보낸 그 지도를 다시 읽기 시작했다"
    );
    assert.ok(!straightenHandlerFlat.includes("savedLayoutPositions"), "저장된 자리를 직접 읽기 시작했다");
    assert.ok(doubleClickHandler.includes("resolveCurrentPosition(edge.fromNodeId)"), "단수 쪽이 바뀌었다 — 둘의 출처가 갈렸다");
  });

  test("🔴 크기는 resolveNodeDimensions(측정값 우선) — 제 손으로 또 추정하지 않는다", () => {
    assert.ok(straightenHandlerFlat.includes("resolveNodeDimensions(sourceNode)"));
    assert.ok(straightenHandlerFlat.includes("resolveNodeDimensions(targetNode)"));
    assert.ok(!straightenHandlerFlat.includes("computeNodeDimensions("), "크기 추정이 두 벌이 됐다");
  });

  test("🔴 곧게 펴는 셈은 **그 함수 하나**다 — 화면에 식을 다시 적지 않았다", () => {
    assert.equal(countOf(straightenHandlerFlat, "computeStraightenedConnectedNodePosition("), 1, "곧게 펴는 셈을 두 번 부르거나 한 번도 안 부른다");
    assert.ok(!straightenHandlerFlat.includes("width / 2"), "중심 셈을 화면에 베껴 적었다 — layout.ts 와 갈린다");
    assert.ok(!straightenHandlerFlat.includes("Math.abs("), "어느 축으로 펼지를 화면이 제 손으로 정하기 시작했다");
  });
});

describe("[연결 정렬] 복수 — ③🔴 [이전] 한 번에 전부 돌아간다", () => {
  test("🔴 자리를 적는 통로를 **정확히 한 번** 부른다 — 선마다 부르면 [이전]이 선 수만큼 쌓인다", () => {
    assert.equal(countOf(straightenHandlerFlat, "setPendingPositions("), 1);
    assert.equal(
      countOf(straightenHandlerFlat, "setPendingPosition("),
      0,
      "칸 하나짜리 통로(setPendingPosition)를 고리 안에서 부르면 [이전]이 칸 수만큼 쌓인다"
    );
  });

  test("🔴 되돌리기를 **제 손으로 안 찍는다** — setPendingPositions 가 제 안에서 찍는 규약을 그대로 쓴다", () => {
    assert.equal(
      countOf(straightenHandlerFlat, "pushPendingUndoStep"),
      0,
      "여기서 또 찍으면 한 번 누른 단추에 [이전] 두 칸이 쌓인다(통로가 이미 찍는다)"
    );
    // 🔵 그 규약이 실제로 통로에 있다는 것까지 여기서 못 박는다 — 통로가 찍기를
    //    그만두면 이 단추의 [이전]이 **한 칸도 안 남는다.**
    assert.ok(
      flat(blockBody(screen, "const setPendingPositions = useCallback(")).includes("if (!isNodeDraggingRef.current) pushPendingUndoStep();"),
      "setPendingPositions 가 되돌리기를 안 찍기 시작했다 — 이 단추가 [이전]으로 안 돌아간다"
    );
  });

  test("🔴 수동 경로점 되돌리기도 **한 번에 묶어서** 적는다", () => {
    assert.equal(countOf(straightenHandlerFlat, "setPendingEdgeRouteMoves("), 1, "경로 되돌리기를 선마다 부르면 그쪽으로 [이전]이 쌓인다");
    assert.ok(straightenHandlerFlat.includes("for (const edgeId of routeResetEdgeIds) next.set(edgeId, null);"), "모아 둔 선들을 한 지도에 함께 적지 않는다");
  });

  test("🔴 단수(더블클릭·[연결 정렬] 패널 단추)는 **한 글자도 안 바뀌었다**", () => {
    assert.ok(doubleClickHandler.includes("setPendingPosition(targetNode.id, straightened.position);"), "단수가 복수 통로로 갈아탔다 — 그 안에 가지를 치면 통로를 두 번 지나기 쉽다");
    assert.ok(!doubleClickHandler.includes("planStraightenEdgeOrder"), "단수가 계획 함수를 물기 시작했다");
    assert.ok(!doubleClickHandler.includes("boxSelect"), "단수가 고른 집합을 보기 시작했다");
  });
});

describe("[연결 정렬] 복수 — ④🔴 **앞의 결과를 보고** 다음을 잰다", () => {
  test("🔴 양 끝의 자리를 읽을 때 **이번에 옮겨 놓은 자리가 먼저**다", () => {
    assert.ok(
      straightenHandlerFlat.includes("movedPositions.get(edge.fromNodeId) ?? resolveCurrentPosition(edge.fromNodeId)"),
      "시작 노드가 옮겨졌는데도 옛 자리를 읽는다 — 사슬이 한 줄이 안 된다"
    );
    assert.ok(
      straightenHandlerFlat.includes("movedPositions.get(edge.toNodeId) ?? resolveCurrentPosition(edge.toNodeId)"),
      "도착 노드 쪽도 같은 규칙이어야 한다 — 같은 칸이 두 선의 도착일 수 있다"
    );
  });

  test("🔴 옮긴 자리를 고리 **안에서** 기록한다 — 선언은 고리 밖, 기록은 고리 안", () => {
    const declaredAt = straightenHandler.indexOf("const movedPositions = new Map<string, Position>();");
    const loopAt = straightenHandler.indexOf("for (const edge of boxSelectionStraightenPlan)");
    const recordedAt = straightenHandler.indexOf("movedPositions.set(targetNode.id, straightened.position);");
    assert.notEqual(declaredAt, -1, "옮긴 자리를 담을 지도가 없다");
    assert.notEqual(loopAt, -1, "계획을 차례대로 도는 고리가 없다");
    assert.notEqual(recordedAt, -1, "옮긴 자리를 기록하지 않는다");
    assert.ok(declaredAt < loopAt, "지도를 고리 안에서 만들면 선마다 비워져 앞의 결과가 사라진다");
    assert.ok(loopAt < recordedAt, "기록이 고리 밖이면 마지막 한 선만 남는다");
  });

  test("🔴 곧게 펴는 셈이 **고리 안**에 있다 — 한꺼번에 미리 재지 않는다", () => {
    const loopAt = straightenHandler.indexOf("for (const edge of boxSelectionStraightenPlan)");
    const computeAt = straightenHandler.indexOf("computeStraightenedConnectedNodePosition(");
    assert.ok(loopAt !== -1 && computeAt > loopAt, "자리를 고리 밖에서 한꺼번에 계산하면 B 가 움직인 것을 C 가 모른다");
  });

  test("🔴 적용 차례는 **순수 함수가 준 그대로**다 — 화면이 다시 정렬하지 않는다", () => {
    assert.ok(straightenHandlerFlat.includes("for (const edge of boxSelectionStraightenPlan)"), "계획을 받은 차례대로 안 돈다");
    assert.ok(!straightenHandlerFlat.includes(".sort("), "화면이 차례를 제 손으로 다시 정한다 — 두 편집기의 답이 갈린다");
    assert.ok(!straightenHandlerFlat.includes(".reverse("), "화면이 차례를 뒤집는다");
  });
});

describe("[연결 정렬] 복수 — ⑤🔴 펼 선이 없으면 아무 일도 안 한다", () => {
  test("🔴 계획이 비면 **맨 먼저** 돌아 나간다 — 되돌리기 칸도 안 찍는다", () => {
    const guardAt = straightenHandler.indexOf("if (boxSelectionStraightenPlan.length === 0) return;");
    const writeAt = straightenHandler.indexOf("setPendingPositions(moves);");
    assert.notEqual(guardAt, -1, "계획이 빈 경우를 안 막는다 — 아무것도 안 바뀐 [이전] 칸이 쌓인다");
    assert.ok(guardAt < writeAt, "관문이 쓰기보다 뒤에 있다");
  });

  test("🔴 계획엔 선이 있었는데 적용이 0건이어도 **안 쓴다**(그 사이 칸이 사라진 경우)", () => {
    const guardAt = straightenHandler.indexOf("if (moves.length === 0) return;");
    const writeAt = straightenHandler.indexOf("setPendingPositions(moves);");
    assert.notEqual(guardAt, -1, "적용이 0건인 경우를 안 막는다");
    assert.ok(guardAt < writeAt, "관문이 쓰기보다 뒤에 있다");
  });

  test("🔴 경로 되돌리기도 **적을 것이 있을 때만** — 안 그러면 손 안 댄 선에 빈 자국이 남는다", () => {
    assert.ok(straightenHandlerFlat.includes("if (routeResetEdgeIds.length > 0)"), "되돌릴 경로가 없어도 지도에 적는다");
  });

  test("🔴 단추도 **같은 수**로 흐려진다 — 눌러도 아무 일 없는 단추를 살려 두지 않는다", () => {
    assert.ok(toolRowBlock.includes("disabled={boxSelectionStraighten.straightenableEdgeCount === 0}"), "펼 선이 0 인데 단추가 살아 있다");
    assert.ok(
      flat(screen).includes("straightenableEdgeCount: boxSelectionStraightenPlan.length"),
      "그림에 넘기는 수가 실제로 펼 목록의 길이가 아니다 — 단추와 손잡이의 답이 갈린다"
    );
  });
});

describe("[연결 정렬] 복수 — ⑥🔴 「무엇을 어떤 차례로」는 **공용 자리의 순수 함수**가 답한다", () => {
  test("🔴 화면은 graph-editor-core 에서 그 함수를 불러다 쓴다", () => {
    assert.ok(
      flat(screen).includes('import { planStraightenEdgeOrder } from "@/lib/graph-editor-core/straighten-selection";'),
      "공용 자리의 함수를 안 쓴다 — 다음 조각의 진단 Flowchart 와 답이 갈린다"
    );
    // 🔴 **부르는 자리가 하나**여야 한다(import 줄에는 괄호가 없어 안 세어진다).
    //    둘이면 단추를 흐리게 할 때 세는 목록과 실제로 펴는 목록이 갈릴 수 있다.
    assert.equal(countOf(flat(screen), "planStraightenEdgeOrder("), 1, "부르는 자리가 둘이 됐다 — 세는 목록과 펴는 목록이 갈린다");
    assert.ok(straightenHandlerFlat.includes("boxSelectionStraightenPlan"), "손잡이가 미리 세어 둔 그 목록을 안 쓴다");
  });

  test("🔴 **화면이 「양 끝이 고른 집합 안인가」를 제 손으로 안 센다** — 그 울타리는 순수 함수에 있다", () => {
    assert.ok(!straightenHandlerFlat.includes("boxSelectedNodeIds"), "화면이 고른 집합을 손잡이 안에서 다시 들여다본다");
    assert.ok(!straightenHandlerFlat.includes(".has("), "화면이 제 손으로 집합을 걸러내기 시작했다");
    // 🔴 그 울타리가 실제로 순수 모듈에 **있다**는 것까지 같은 줄에서 센다 —
    //    「화면에 없다」만 재면 **양쪽 다 없어도** 통과한다.
    assert.ok(planModule.includes("selectedNodeIds.has(e.fromNodeId) && selectedNodeIds.has(e.toNodeId)"), "순수 모듈이 양 끝을 둘 다 안 본다");
    assert.ok(planModule.includes("e.fromNodeId !== e.toNodeId"), "순수 모듈이 자기 자신을 가리키는 선을 안 뺀다");
  });

  test("🔴 순수 모듈은 **도메인을 안 탄다** — 다음 조각이 그대로 가져다 쓸 수 있어야 한다", () => {
    assert.ok(!planModule.includes("import "), "순수 모듈이 무언가를 물기 시작했다 — 공용 자리의 뜻이 사라진다");
    for (const word of ["procedure", "Procedure", "repairCase", "RepairCase", "nodeType", "branch"]) {
      assert.ok(!planModule.includes(word), `순수 모듈에 도메인 낱말(${word})이 들어왔다`);
    }
  });

  test("🔴 진단 Flowchart 도 **같은 순수 함수**를 쓴다 — 두 편집기의 답이 안 갈린다", () => {
    // 🔴 2026-11-22(조각 D2) — 이 단언이 **뒤집혔다.** D1 때는 「진단 Flowchart 는
    //    아직 이 손잡이를 안 받는다」(= `!includes`)였고, 바로 그 자리에 「붙이는 날
    //    지우지 말고 뒤집어라」고 적어 두었다. 지우면 저쪽이 **제 손으로 베껴 적는
    //    날**이 와도 아무도 모른다 — 두 편집기가 서로 다른 셈을 갖게 되는 것이 이
    //    조각이 막으려는 바로 그것이다.
    assert.ok(caseScreen.includes("planStraightenEdgeOrder(renderedEdges, boxSelectedNodeIds)"), "진단 Flowchart 가 같은 순수 함수를 안 쓴다");
    // 🔴 「쓴다」만 재면 **베낀 한 벌을 옆에 또 두어도** 통과한다. 그래서 저쪽이
    //    그 함수를 **공용 자리에서 들여온다**는 것까지 같은 줄에서 센다.
    assert.ok(
      read(PATHS.caseScreen).includes('import { planStraightenEdgeOrder } from "@/lib/graph-editor-core/straighten-selection";'),
      "진단 Flowchart 가 공용 자리가 아닌 데서 그 함수를 들여온다"
    );
    // 🔵 저쪽 화면의 이음새(출처·[이전] 한 칸·앞의 결과를 보고 재기)는 그 집의
    //    시험이 따로 못 박는다 — case-flowchart-straighten-selected-edges-ui.test.ts.
  });
});

describe("[연결 정렬] 복수 — ⑦🔴 수동 경로점 되돌리기가 **단수와 같다**", () => {
  test("🔴 수동 경로가 있는 선만 자동 경로로 되돌린다 — 판정 식이 단수와 같은 한 줄이다", () => {
    assert.ok(straightenHandlerFlat.includes("currentWorkingRoutePoints(pendingEdgeRouteMoves, edge.id).length > 0"));
    assert.ok(doubleClickHandler.includes("currentWorkingRoutePoints(pendingEdgeRouteMoves, edgeId)"), "단수 쪽이 바뀌었다 — 둘의 판정이 갈렸다");
    assert.ok(doubleClickHandler.includes("next.set(edgeId, null);"), "단수가 자동 경로로 안 되돌린다");
  });

  test("🔴 되돌림은 **그 선에만** 걸린다 — 모아 둔 목록을 통째로 비우지 않는다", () => {
    assert.ok(straightenHandlerFlat.includes("const next = new Map(prev);"), "앞의 지도를 그대로 물려받지 않는다");
    assert.ok(!straightenHandlerFlat.includes("new Map()"), "모아 둔 경로 지도를 통째로 비우기 시작했다");
  });
});

describe("[연결 정렬] 복수 — ⑧🔴 단추는 **도구 줄의 그 부품 옆**에, 부품 안이 아니다", () => {
  test("🔴 ProcedureCanvasToolPicker 는 **한 글자도 안 바뀌었다** — 진단 Flowchart 와 함께 쓰는 부품이다", () => {
    assert.ok(!picker.includes("연결 정렬"), "함께 쓰는 부품에 단추를 심었다 — 저쪽 화면에 죽은 단추가 선다");
    assert.ok(!picker.includes("traighten"), "함께 쓰는 부품이 곧게 펴기를 알기 시작했다");
    // 🔵 TOOLS 목록의 칸만 센다 — `tool: ProcedureCanvasTool` 같은 타입 자리까지
    //    세면 여섯이 되어 「단추가 몇 개인가」를 못 잰다.
    assert.equal(countOf(picker, 'tool: "'), 2, "도구 단추가 둘(POINTER · BOX_SELECT)이어야 한다");
  });

  test("🔴 단추는 그림의 조작줄에, **그 부품 바로 뒤**에 선다", () => {
    const pickerAt = toolRowBlock.indexOf("<ProcedureCanvasToolPicker");
    const buttonAt = toolRowBlock.indexOf("연결 정렬");
    assert.notEqual(pickerAt, -1, "도구 줄 덩이에서 부품을 못 찾았다");
    assert.notEqual(buttonAt, -1, "도구 줄 덩이에 단추가 없다");
    assert.ok(pickerAt < buttonAt, "단추가 부품보다 앞에 섰다 — 「N개 선택」 옆이어야 한다");
    assert.ok(toolRowBlock.includes('className="flex items-center gap-2"'), "둘을 한 덩이로 묶지 않았다 — 눈으로 떨어져 보인다");
  });

  test("🔴 서는 조건은 **[범위 선택] 모드이고 고른 칸이 둘 이상**일 때다", () => {
    assert.ok(
      toolRowBlock.includes("{boxSelectActive && boxSelectedNodeIds.size >= 2 && boxSelectionStraighten && ("),
      "조건이 바뀌었다 — 하나만 고른 상태에서는 펼 선이 아예 없다"
    );
  });

  test("🔵 글자는 연결선 패널의 그 단추와 **같다** — 같은 일에 다른 낱말을 쓰지 않는다", () => {
    assert.ok(stripComments(read("src/components/procedures/editor/EdgePropertyPanel.tsx")).includes("연결 정렬"), "패널 쪽 글자가 바뀌었다 — 둘을 함께 고쳐야 한다");
  });

  test("🔴 흐릴 때의 **까닭이 title 에** 있다 — 이 편집기에는 안내 줄을 못 세운다", () => {
    assert.ok(toolRowBlock.includes("title={"), "단추에 설명이 없다");
    assert.ok(toolRowBlock.includes("이어진 연결선이 없어서 지금은 펼 것이 없습니다"), "흐린 까닭이 어디에도 안 적혀 있다 — 고장으로 읽힌다");
    assert.ok(toolRowBlock.includes("한쪽만 고른 연결선은 그대로 둡니다"), "무엇이 안 움직이는지가 안 적혀 있다");
  });

  test("🔴 안 넘기는 화면 셋은 글자 하나 안 바뀐다 — 프롭이 선택이고 기본이 없음이다", () => {
    assert.ok(graph.includes("boxSelectionStraighten = null"), "기본값이 없어 프롭을 안 넘기는 화면이 깨진다");
    for (const path of [
      "src/components/procedures/ProcedureTemplateDetailScreen.tsx",
      "src/components/procedures/execution/ExecutionStepsGraph.tsx",
      "src/components/procedures/execution/ProcedureStartPickerGraph.tsx",
    ]) {
      assert.ok(!read(path).includes("boxSelectionStraighten"), `${path} 이 이 프롭을 넘기기 시작했다`);
    }
  });
});

describe("[연결 정렬] 복수 — ⑨🔴 상시 안내를 또 세우지 않았다", () => {
  test("🔴 도구 줄 덩이에 새로 생긴 것은 **단추 하나뿐**이다 — 설명 줄이 없다", () => {
    assert.equal(countOf(toolRowBlock, "<button"), 1, "도구 줄 덩이에 단추가 둘이 됐거나 사라졌다");
    assert.equal(countOf(toolRowBlock, "<p"), 0, "도구 줄에 안내 문단이 섰다 — 쓰는 분이 두 번 걷어낸 자리다");
  });

  test("🔴 설명 글자는 **단추 글자와 title 뿐**이다 — 화면 어디에도 또 적히지 않았다", () => {
    assert.equal(countOf(graph, "연결 정렬"), 3, "단추 글자 하나 + title 둘이어야 한다");
    assert.ok(!flat(screen).includes("연결 정렬"), "편집기 화면이 같은 글자를 또 그리기 시작했다");
    assert.ok(!flat(screen).includes("곧게 폅니다"), "편집기 화면에 안내 줄이 섰다");
  });

  test("🔵 확인 창도 안 띄운다 — [이전] 한 번이면 전부 돌아온다", () => {
    assert.ok(!straightenHandlerFlat.includes("confirm("), "복수 정렬에 확인 창이 생겼다");
  });
});
