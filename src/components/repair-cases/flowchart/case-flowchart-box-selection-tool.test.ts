import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

/**
 * ============================================================================
 * 「진단 Flowchart」 — [범위 선택] 도구 (2026-11-21, 조각 B2′)
 * ============================================================================
 * 쓰는 분 요청 원문: 「동영상 편집 프로그램처럼 [마우스] 아이콘을 누르면 지금처럼
 * 일반 기능을, [점선 네모] 아이콘을 누르면 드래그 혹은 클릭으로 여러 노드를 골라
 * 한 번에 이동」. 「기술 작업 절차」 편집기가 같은 순서로 먼저 갔다
 * (B1 `b4ee0166` → B2 `ced82c74`), 이 집은 B1′ `f7e6d87d` → 이 조각이다.
 *
 * 밑자락은 앞 조각들이 깔았다 — 여럿을 끌면 여럿이 저장되는 배선
 * (case-flowchart-multi-node-drag-plumbing.test.ts)과 「네모에 닿은 칸 고르기」
 * 셈(src/lib/graph-editor-core/box-selection.test.ts). **이 조각이 화면을 바꾼다.**
 *
 * ── 🔴 무엇을 여기서 재고, 무엇을 못 재는가 ──────────────────────────────
 * **손짓은 이 저장소가 못 잰다**(브라우저가 없다). 끌어서 네모가 그려지는 일, 그
 * 네모에 닿은 칸이 골라지는 일, 골라 놓고 끌면 함께 움직이는 일은 **쓰는 분의
 * 눈**이 맡는다. 셈 자체는 순수 함수 쪽에서 값으로 잰다(위 box-selection.test.ts —
 * 어느 방향으로 끌든 같은 네모인가 · 닿으면 고르는가 · 그리는 네모와 고르는 네모가
 * 같은 두 점에서 나오는가 · 두 번 누르면 빠지는가).
 *
 * **이 파일이 재는 것은 「그 사이를 잇는 글자」**다. 어긋나도 오류가 한 번도 안
 * 나고 화면만 이상해지는 자리들이라 하나씩 글자로 못 박는다:
 *   ㉠ 도구 단추를 **베끼지 않고 그대로 들여왔는가**(베끼면 두 화면의 글자가
 *      갈리는 날이 온다 — 화면에 나가는 글자는 저쪽 TOOLS 한 곳뿐이다),
 *   ㉡ 단추가 **끌 수 있는 그림에만** 서는가(읽기 전용 그림에서 빈 바탕 끌기를
 *      뺏으면 화면을 옮길 유일한 길이 사라진다),
 *   ㉢ 칸에 `selected` 를 **모드 안에서만** 싣는가(여럿이 함께 끌리는 열쇠 한 줄),
 *   ㉣ 모드를 바꿀 때 **양쪽 선택을 비우는가**, 그리고 바꾸는 길이 **함수 하나**인가,
 *   ㉤ 네모를 **그림 좌표로** 재고 칸 자리·크기를 **새로 추정하지 않는가**,
 *   ㉥ 지금의 **단수 선택을 한 글자도 안 건드리는가**(그 값을 쓰는 자리가 많다),
 *   ㉦ 공용 캔버스·순수 모듈·도구 단추 부품을 **안 고쳤는가**,
 *   ㉧ [Delete] 는 **아직 아무 일도 안 하는가**(복수 삭제는 다음 조각 B3′).
 *
 * ── 왜 렌더가 아니라 원본 글자로 재는가 ─────────────────────────────────
 * 이웃들과 같은 사정이다: 이 그림은 @xyflow/react 의 .css 를 물고 있고
 * CaseFlowchartEditorScreen 은 서버 액션(→ server-only)까지 사슬로 물어, 어느
 * 목록에서도 import 자체가 던진다.
 *
 * ── 🔴 주석을 걷어내고 센다 ─────────────────────────────────────────────
 * 이 저장소는 까닭을 그 자리 주석에 길게 적는다. 이번 변경이 늘린 주석에는
 * `selected`·`boxSelection`·`positionX` 같은 낱말이 **글자 그대로** 들어 있어서,
 * 안 걷으면 「없어졌는가」 쪽이 영영 깨지고 「있는가」 쪽이 주석만으로 영영
 * 통과한다. ①절이 걷어내기가 실제로 일한다는 증거다.
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

/** 글자가 몇 번 나오는가. 「한 곳뿐인가」처럼 **수**가 뜻을 갖는 자리에서 쓴다. */
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
  graph: "src/components/repair-cases/flowchart/CaseFlowchartGraph.tsx",
  screen: "src/components/repair-cases/flowchart/CaseFlowchartEditorScreen.tsx",
  canvas: "src/components/graph-editor-core/GraphCanvas.tsx",
  picker: "src/components/procedures/visual/ProcedureCanvasToolPicker.tsx",
  pureBox: "src/lib/graph-editor-core/box-selection.ts",
  readOnlyPage: "src/app/(app)/repair-cases/[id]/diagnosis/work-records/page.tsx",
} as const;

const graphRaw = read(PATHS.graph);
const graph = stripComments(graphRaw);
const screenRaw = read(PATHS.screen);
const screen = stripComments(screenRaw);
const canvas = stripComments(read(PATHS.canvas));
const picker = stripComments(read(PATHS.picker));
const pureBox = stripComments(read(PATHS.pureBox));
const readOnlyPage = stripComments(read(PATHS.readOnlyPage));

// ────────────────────────────────────────────────────────────────────────────
// ① 공짜 통과 막기 — 파일을 제대로 읽었고, 주석 걷기가 실제로 뭔가를 걷어냈는가
// ────────────────────────────────────────────────────────────────────────────
describe("🔵 ① 먼저 — 표본이 비어 있지 않다", () => {
  test("여섯 파일이 전부 읽혔고, 재려는 것이 실제로 거기 있다", () => {
    for (const [name, source] of Object.entries({ graph, screen, canvas, picker, pureBox, readOnlyPage })) {
      assert.ok(source.length > 400, `${name} 이 비었거나 너무 짧다 — 경로가 틀리면 아래 단언이 전부 공짜로 통과한다`);
    }
    assert.ok(graph.includes("<GraphCanvas"), "그림이 캔버스를 그려야 아래 단언에 뜻이 있다");
    assert.ok(picker.includes("export default function ProcedureCanvasToolPicker"), "도구 단추 부품을 못 찾았다");
    assert.ok(pureBox.includes("export function findNodeIdsInSelectionBox("), "고르는 셈 함수를 못 찾았다");
    assert.ok(readOnlyPage.includes("<CaseFlowchartGraph"), "읽기 전용 화면이 정말 이 그림을 그려야 ⑨절에 뜻이 있다");
  });

  test("🔴 주석 걷어내기가 실제로 일을 한다 — 날것에는 알맹이에 없는 글자가 주석으로 적혀 있다", () => {
    assert.ok(graphRaw.includes("보이지 않는 짝들이 함께 끌린다"), "모드 전환이 선택을 비우는 까닭이 그림 주석에 있어야 한다");
    assert.ok(!graph.includes("보이지 않는 짝들이 함께 끌린다"), "걷어내기가 일을 안 하고 있다");
    assert.ok(screenRaw.includes("엉뚱한 칸이 함께 끌린다"), "편집기가 제 손으로 안 바꾸는 까닭이 주석에 있어야 한다");
    assert.ok(!screen.includes("엉뚱한 칸이 함께 끌린다"));
  });
});

// ────────────────────────────────────────────────────────────────────────────
// ② 도구 단추 — 🔴 **베끼지 않고 그대로 들여왔는가**
//
// 🔴 베끼면 「화면에 나가는 글자는 저쪽 TOOLS 의 label·title 뿐」이라는 보증이
//    깨지고, 두 화면의 글자가 갈리는 날이 온다. 글자를 고치는 사람은 한 집만
//    고치고 끝내기 때문이다.
// ────────────────────────────────────────────────────────────────────────────
describe("🔴 ② 도구 단추 — 저쪽 부품을 그대로 쓴다", () => {
  test("🔴 들여오기 한 줄로 쓴다 — 아이콘도 단추 모양도 글자도 안 베꼈다", () => {
    assert.ok(
      graphRaw.includes('import ProcedureCanvasToolPicker, { type ProcedureCanvasTool } from "@/components/procedures/visual/ProcedureCanvasToolPicker";'),
      "도구 단추 부품을 안 들여온다"
    );
    assert.ok(!graph.includes("<svg"), "아이콘을 베껴 왔다 — 두 화면의 아이콘이 갈린다");
    assert.ok(!graph.includes("TOOL_BUTTON"), "단추 모양(눌린 색 포함)을 베껴 왔다");
    assert.ok(!/label: "/.test(graph), "단추 글자를 이 집에서 또 적었다 — 화면 글자는 저쪽 TOOLS 한 곳뿐이어야 한다");
    assert.ok(!graph.includes('"BOX_SELECT" | '), "도구 값의 종류를 이 집에서 다시 정의했다");
  });

  test("🔴 화면에 나가는 글자는 **저쪽 한 곳**에 있다 — 쓰는 분이 고른 낱말이다", () => {
    // 🔵 2026-11-21 쓰는 분 결정: 처음 올린 [마우스]·[점선 네모] 를 「기능을 설명하는
    //    단어였으면 좋겠어」로 고쳤다. 진단 쪽도 **같은 글자**를 써야 하고, 같은 글자인
    //    까닭이 「같은 부품을 쓴다」 하나다.
    const labels = [...picker.matchAll(/label: "([^"]+)"/g)].map((m) => m[1]);
    assert.deepEqual(labels, ["선택·이동", "범위 선택"]);
  });

  test("🔴 단추는 **끌 수 있는 그림에만** 선다 — 읽기 전용에서 화면 옮기기를 뺏으면 안 된다", () => {
    assert.ok(graph.includes("const canUseBoxSelect = editable;"), "관문이 끌기 관문과 같은 값이어야 한다");
    assert.ok(graph.includes("nodesDraggable={editable}"), "끌기 관문 쪽이 바뀌었다 — 둘이 갈리면 「고를 수는 있는데 못 끄는」 그림이 생긴다");
    // 🔴 2026-11-22(조각 D2) — 이 단언이 **덩이 전체**에서 **덩이의 머리**로 짧아졌다.
    //    그 뒤에 [연결 정렬] 단추가 들어왔기 때문이다. 🔴 짧아지기만 하면 관문이
    //    텅 비어도 통과하므로, 아래에서 **관문이 품은 것을 수로** 함께 센다.
    assert.ok(
      flat(graph).includes("{canUseBoxSelect && ( <div className=\"flex flex-wrap items-center gap-3 px-2 pt-2 text-xs\"> <ProcedureCanvasToolPicker tool={canvasTool} onToolChange={changeCanvasTool} selectedCount={boxSelectedNodeIds.size} />"),
      "단추를 그 관문 안에 안 두었다"
    );
    const flatGraph = flat(graph);
    const toolRow = flatGraph.slice(flatGraph.indexOf("{canUseBoxSelect && ("), flatGraph.indexOf("<GraphCanvas"));
    assert.ok(toolRow.length > 200 && toolRow.length < 2500, `도구 줄 덩이를 못 집었다(길이 ${toolRow.length})`);
    assert.equal(countOf(toolRow, "<ProcedureCanvasToolPicker"), 1, "도구 단추 부품이 관문 안에서 사라졌거나 둘이 됐다");
    // 🔵 그 관문 안으로 **2026-11-22(D2)에 단추 하나가 더 들어왔다.** 여기서는
    //    「있는가」만 센다 — 조건·흐림·title·출처는 그 조각의 시험이 못 박는다
    //    (case-flowchart-straighten-selected-edges-ui.test.ts).
    assert.ok(toolRow.includes("연결 정렬"), "[연결 정렬] 단추가 도구 줄에서 사라졌다");
    assert.equal(countOf(toolRow, "<button"), 1, "도구 줄에 단추가 둘이 됐거나 사라졌다 — 늘었다면 이 수를 올려 적을 것");
  });

  test("모드는 둘뿐이고 처음은 [선택·이동] 이다 — 배치 모드와 같은 통제형 패턴", () => {
    assert.ok(picker.includes('export type ProcedureCanvasTool = "POINTER" | "BOX_SELECT";'));
    assert.ok(graph.includes('const [internalCanvasTool, setInternalCanvasTool] = useState<ProcedureCanvasTool>("POINTER");'), "기본이 [범위 선택] 이면 그림을 열자마자 화면이 안 끌린다");
    assert.ok(graph.includes("const canvasTool = controlledCanvasTool ?? internalCanvasTool;"), "안 넘기면 제 안의 값으로 돌아야 한다");
    assert.ok(flat(graph).includes("canvasTool?: ProcedureCanvasTool;"), "프롭은 선택이어야 한다 — 필수가 되면 읽기 전용 화면이 함께 바뀐다");
    assert.ok(flat(graph).includes("onCanvasToolChange?: (tool: ProcedureCanvasTool) => void;"));
  });

  test("🔴 **새 상시 안내 줄을 안 세웠다** — 고른 수는 단추 옆에만 뜬다", () => {
    assert.ok(!graph.includes("<p "), "그림에 설명 문단이 섰다 — 설명은 단추 글자와 title 까지다");
    assert.ok(flat(graph).includes("selectedCount={boxSelectedNodeIds.size}"), "고른 수를 안 넘긴다");
    assert.ok(flat(picker).includes('{tool === "BOX_SELECT" && ('), "[선택·이동] 에도 「0개 선택」이 상시로 서 있다");
  });
});

// ────────────────────────────────────────────────────────────────────────────
// ③ 🔴 모드를 바꾸면 **양쪽 선택을 비운다**, 그리고 바꾸는 길은 함수 하나다
//
// 안 비우면 [범위 선택]에서 고른 칸이 [선택·이동] 으로 돌아와서도 `selected` 를 단
// 채 남아, 칸 하나를 끌었을 뿐인데 보이지 않는 짝들이 함께 끌린다 — 오류가 안 나고
// 끌리는 모습도 멀쩡하다.
// ────────────────────────────────────────────────────────────────────────────
describe("🔴 ③ 모드를 바꾸면 비운다", () => {
  const body = flat(functionBody(graph, "function changeCanvasTool(nextTool: ProcedureCanvasTool)"));

  test("🔵 먼저 표본 — 재려는 함수를 제대로 집었다", () => {
    assert.ok(body.length > 80 && body.length < 600, `changeCanvasTool 를 못 집었다(길이 ${body.length})`);
  });

  test("🔴 고른 집합과 **단수 선택**을 둘 다 비운다", () => {
    assert.ok(body.includes("setBoxSelectedNodeIds(new Set<string>());"), `고른 집합을 안 비운다: ${body}`);
    // 🔴 이 그림은 단수 선택을 제가 안 들고 있다 — 편집기가 들고, 비우는 한 줄을
    //    `onPaneClick`(노드·연결선·경로점 셋을 한 번에 푼다)에 걸어 두었다. 그래서
    //    여기서 부르는 것이 그 길이다. 비우기 전용 프롭을 새로 만들면 「선택을
    //    비운다」가 편집기에 두 벌로 적히고, 어느 날 한쪽만 고쳐진다.
    assert.ok(body.includes("onPaneClick?.();"), `단수 선택(편집기가 들고 있다)을 안 비운다: ${body}`);
    assert.ok(
      flat(screen).includes("onPaneClick={() => { setSelectedNodeId(null); setSelectedEdgeId(null); setSelectedWaypointIndex(null); }}"),
      "편집기의 「비우기」 한 줄이 바뀌었다 — 모드 전환이 무엇을 비우는지도 함께 바뀐 것이다"
    );
  });

  test("🔴 **도구를 바꾸는 길은 이 함수 하나**다 — 다른 길로 바꾸면 비우기를 건너뛴다", () => {
    // 🔵 `setInternalCanvasTool` 은 **선언 한 번 + 쓰는 자리 한 번**이 전부여야 한다.
    assert.equal(countOf(graph, "setInternalCanvasTool"), 2, "도구를 갈아 끼우는 자리가 선언 말고 둘 이상이다");
    assert.equal(countOf(graph, "(onCanvasToolChange ?? setInternalCanvasTool)("), 1, "갈아 끼우는 줄이 둘 이상이다");
    assert.ok(!graph.includes("onCanvasToolChange?.("), "바깥에만 알리고 제 값은 안 바꾸는 두 번째 길이 생겼다");
    assert.ok(body.includes("(onCanvasToolChange ?? setInternalCanvasTool)(nextTool);"), "갈아 끼우는 줄이 이 함수 안에 없다");
    assert.equal(countOf(graph, "onToolChange={"), 1, "단추가 다른 함수에도 매여 있다");
    assert.ok(flat(graph).includes("onToolChange={changeCanvasTool}"));
  });

  test("🔴 바깥(편집기)은 제 손으로 도구를 안 바꾼다 — 넘기기만 한다", () => {
    assert.ok(flat(screen).includes("canvasTool={canvasTool} onCanvasToolChange={setCanvasTool}"), "편집기가 도구를 안 넘긴다");
    assert.equal(countOf(screen, "setCanvasTool"), 2, "편집기가 setCanvasTool 을 제 손으로 부른다 — 그러면 선택이 안 비워진다");
  });

  test("🔴 바깥은 **고른 집합도** 제 손으로 안 비운다 — 비우는 길은 그림 안의 둘뿐이다", () => {
    assert.ok(
      flat(screen).includes("boxSelectedNodeIds={boxSelectedNodeIds} onBoxSelectionChange={setBoxSelectedNodeIds}"),
      "편집기가 고른 집합을 안 넘긴다"
    );
    // 🔴 2026-11-21(조각 B3′) — 수가 **셋에서 넷**이 됐다. B2′ 때는 「선언 1 + 그림에
    //    넘기는 둘」이 전부였는데, B3′ 가 [Delete] 복수 삭제를 붙이면서 **읽는 자리
    //    하나**가 더 생겼다(고른 칸을 renderedNodes 에서 추리는 줄). 지우지 않고
    //    **수를 올려 적는** 까닭은 그대로다 — 수로 안 재면 넷째·다섯째가 몰래 생겨도
    //    위 단언이 멀쩡히 통과한다.
    // 🔴 2026-11-22(조각 D2) — 수가 **넷에서 다섯**이 됐다. 늘어난 하나는 [연결 정렬]이
    //    「무엇을 어떤 차례로 펼지」를 **공용 순수 함수에 묻는 줄**이다. 여기서도
    //    여전히 **읽기만** 한다 — 갈아 끼우는 쪽(setBoxSelectedNodeIds)은 아래에서
    //    따로 세고, 그 수는 안 바뀌었다.
    assert.equal(countOf(flat(screen), "boxSelectedNodeIds"), 5, "편집기에서 고른 집합을 쓰는 자리가 늘었다");
    assert.ok(
      flat(screen).includes("renderedNodes .filter((n) => boxSelectedNodeIds.has(n.id))"),
      "그 넷째 자리가 **그려진 목록에서 추리는 줄**이 아니다 — 집합을 돌며 찾으면 사라진 id 에 삭제가 쌓인다"
    );
    assert.ok(
      flat(screen).includes("planStraightenEdgeOrder(renderedEdges, boxSelectedNodeIds)"),
      "그 다섯째 자리가 **[연결 정렬]의 계획을 세는 줄**이 아니다 — 늘어난 자리가 무엇인지 모른 채 수만 올리면 이 단언이 뜻을 잃는다"
    );
    // 🔴 갈아 끼우는 쪽도 **둘에서 셋**이다. 늘어난 하나는 「비우기」가 아니라
    //    **「지운 칸만 빼기」**다 — 그 둘은 뜻이 다르고, 비우기는 여전히 그림 안의
    //    둘뿐이어야 한다(아래 두 줄이 그 둘을 센다).
    assert.equal(countOf(flat(screen), "setBoxSelectedNodeIds"), 3, "편집기가 고른 집합을 제 손으로 갈아 끼운다");
    assert.ok(
      flat(screen).includes("setBoxSelectedNodeIds((prev) => removeNodesFromSelection(prev, nodeIds));"),
      "늘어난 하나가 「지운 칸만 빼기」가 아니다"
    );
    assert.ok(!flat(screen).includes("setBoxSelectedNodeIds(new Set"), "편집기가 제 손으로 비우기 시작했다");
    // 🔵 그림 안의 **두 길**이 그대로 있다는 근거.
    assert.ok(graph.includes("function changeCanvasTool(nextTool: ProcedureCanvasTool)"), "모드 전환 쪽 비우기가 사라졌다");
    assert.ok(graph.includes("function handleCanvasPaneClick()"), "빈 바탕 누르기 쪽 비우기가 사라졌다");
  });
});

// ────────────────────────────────────────────────────────────────────────────
// ④ 🔴 칸에 `selected` 를 **모드 안에서만** 싣는다 — 여럿이 함께 끌리는 열쇠
// ────────────────────────────────────────────────────────────────────────────
describe("🔴 ④ 여럿이 함께 끌리는 열쇠 — 칸에 실은 selected", () => {
  test("🔵 먼저 — 바탕 제 선택 기능으로는 그 값을 못 만든다(그래서 직접 싣는다)", () => {
    assert.ok(!canvas.includes("onNodesChange"), "캔버스가 선택 변화를 받기 시작했다면 「직접 실어야 한다」는 전제가 깨진다");
  });

  test("🔴 싣는다 — 그리고 **모드를 벗어나면 안 싣는다**", () => {
    assert.ok(graph.includes("selected: isBoxSelected,"), "칸에 selected 를 안 싣는다 — 네모로 골라도 하나만 끌린다");
    assert.ok(
      graph.includes("const isBoxSelected = boxSelectActive && boxSelectedNodeIds.has(n.id);"),
      "모드 관문 없이 고른 집합만 보고 있다 — [선택·이동] 으로 돌아와도 여럿이 함께 끌린다"
    );
    assert.ok(graph.includes("const boxSelectActive = canUseBoxSelect && canvasTool === \"BOX_SELECT\";"), "모드 관문의 정의가 바뀌었다");
    // 🔴 싣는 자리는 **한 곳**이어야 한다 — 두 곳이 되면 한쪽만 모드 관문을 잃는다.
    assert.equal(countOf(graph, "selected: "), 1, "칸에 selected 를 싣는 자리가 둘 이상이다");
  });

  test("🔴 **고른 것이 눈에 보인다** — 이 그림의 「고름」은 칸이 제 손으로 그리는 테두리다", () => {
    // 🔴 React Flow 기본 `.selected` 스타일은 이 저장소의 칸에 안 걸린다(칸을
    //    ProcedureNodeChip 이 제 손으로 그린다). 위 `selected` 는 **엔진에게** 주는
    //    값일 뿐이라, 그것만 실으면 골라도 화면이 그대로다.
    assert.ok(graph.includes("const isSelected = n.id === selectedNodeId || isBoxSelected;"), "고른 칸이 화면에 표시되지 않는다");
    assert.ok(flat(graph).includes("isSelected={data.isSelected}"), "칸이 그 값을 받아 그리지 않는다");
    // 🔵 그 값이 실제로 **테두리**가 된다는 근거 — 칸 부품 쪽에서 함께 센다.
    const chip = stripComments(read("src/components/procedures/visual/ProcedureNodeChip.tsx"));
    assert.ok(/isSelected \? "ring-/.test(chip), "칸 부품이 고름을 테두리로 안 그린다 — 골라도 화면에 아무 표시가 없다");
  });

  test("🔴 칸 목록을 다시 만드는 조건에 **모드와 고른 집합**이 들어 있다 — 빠지면 골라도 화면이 그대로다", () => {
    const memo = graph.slice(graph.indexOf("const flowNodes = useMemo<Node[]>"));
    const deps = memo.slice(memo.indexOf("}, ["), memo.indexOf("]);"));
    assert.ok(deps.length > 10 && deps.length < 300, `flowNodes 의 의존성 배열을 못 집었다: ${deps}`);
    assert.ok(deps.includes("boxSelectedNodeIds"), `의존성에 고른 집합이 없다: ${deps}`);
    assert.ok(deps.includes("boxSelectActive"), `의존성에 모드가 없다: ${deps}`);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// ⑤ 🔴 **무엇을 어느 좌표로 재는가** — 가장 조용히 어긋날 자리
//
// 네모는 **그림 좌표**로 들어온다(캔버스가 screenToFlowPosition 으로 옮겨서
// 넘긴다). 칸 자리를 재는 쪽이 같은 좌표계가 아니면 **확대를 바꾸는 순간**
// 어긋나는데, 오류는 한 번도 안 난다.
// ────────────────────────────────────────────────────────────────────────────
describe("🔴 ⑤ 무엇을 어느 좌표로 재는가", () => {
  const body = flat(functionBody(graph, "function handleBoxSelect(box: SelectionBox)"));

  test("🔵 먼저 표본 — 재려는 함수를 제대로 집었다", () => {
    assert.ok(body.length > 150 && body.length < 800, `handleBoxSelect 를 못 집었다(길이 ${body.length})`);
    assert.ok(body.includes("setBoxSelectedNodeIds(findNodeIdsInSelectionBox(box, candidates));"), "고르는 셈을 공용 순수 함수에 안 맡긴다");
  });

  test("🔴 자리는 **이 그림이 실제로 그리는 자리**에서 받는다 — 한 벌뿐이어야 한다", () => {
    assert.ok(body.includes("const position = renderedPosition(n);"), `자리를 다른 데서 읽는다: ${body}`);
    assert.ok(!body.includes("positionX"), "저장 좌표를 여기서 직접 읽는다 — 그리는 쪽과 갈릴 수 있다");
    // 🔴 **그리는 쪽도 같은 함수**를 쓴다는 근거. 그래야 「그린 네모와 골라진 칸」이
    //    같은 좌표에서 나온다.
    assert.ok(graph.includes("position: renderedPosition(n),"), "칸을 그리는 자리가 그 함수를 안 쓴다");
    // 🔴 저장 좌표를 읽는 자리는 **그 함수 안 한 곳**뿐이다. 수로 재지 않으면 둘째
    //    자리가 몰래 생겨도 위 단언들은 멀쩡히 통과한다.
    assert.equal(countOf(graph, "n.positionX"), 1, "저장 좌표를 읽는 자리가 둘 이상이다");
    assert.equal(countOf(graph, "n.positionY"), 1, "저장 좌표를 읽는 자리가 둘 이상이다");
  });

  test("🔴 크기는 **이미 있는 규칙**에서 받는다 — 잰 값 우선, 없으면 추정값", () => {
    assert.ok(body.includes("const dimensions = resolveNodeDimensions(n);"), `크기를 다른 데서 읽는다: ${body}`);
    assert.ok(!body.includes("computeNodeDimensions("), "여기서 크기를 또 추정한다 — 같은 칸의 크기가 두 벌이 된다");
    assert.ok(
      graph.includes("return resolveEffectiveNodeDimensions(reactFlowInstanceRef.current?.getInternalNode(n.id)?.measured, estimatedNodeDimensions(n));"),
      "크기 규칙(잰 값 우선)이 바뀌었다"
    );
    // 🔴 추정값을 만드는 자리도 **한 곳**이어야 한다 — 연결선이 붙는 자리와 네모에
    //    닿는 자리가 서로 다른 크기를 보면 안 된다.
    assert.equal(countOf(graph, "computeNodeDimensions({"), 1, "크기 추정을 적은 자리가 둘 이상이다");
    assert.ok(graph.includes("const dims = estimatedNodeDimensions(n);"), "연결선 쪽이 같은 추정 함수를 안 쓴다");
  });

  test("🔴 캔버스가 넘기는 네모가 **그림 좌표**라는 전제가 그대로다", () => {
    // 🔵 그리는 네모(화면 px)와 고르는 네모(그림 좌표)가 **끈 같은 두 점**에서
    //    나온다는 근거. 이 파일이 고칠 수 있는 자리가 아니라 **전제**라서 함께 센다.
    assert.ok(canvas.includes("startFlow: instance.screenToFlowPosition(startClient)"), "시작점을 그림 좌표로 안 옮긴다");
    assert.ok(
      canvas.includes("selectionBoxFromPoints(gesture.startFlow, instance.screenToFlowPosition({ x: event.clientX, y: event.clientY }))"),
      "끝점을 그림 좌표로 안 옮긴다 — 화면 px 로 재면 확대를 바꾸는 순간 어긋난다"
    );
    assert.ok(canvas.includes("setBoxOverlay(selectionOverlayRect(gesture.startClient, { x: event.clientX, y: event.clientY }, gesture.paneOrigin));"), "그리는 네모가 같은 두 점에서 안 나온다");
  });
});

// ────────────────────────────────────────────────────────────────────────────
// ⑥ 🔴 두 선택이 **따로 산다** — 단수 선택을 한 글자도 안 건드린다
//
// 단수 선택을 쓰는 자리가 많다: 속성 패널 · [연결 추가]의 대상 고르기 ·
// [상대 위치로 이동]의 기준 · [Delete] 키 · 이웃 강조/흐리기. [범위 선택]에서 하는
// 일은 옮기기(와 다음 조각의 지우기)뿐이라 그 자리들을 하나도 안 건드려도 된다.
// ────────────────────────────────────────────────────────────────────────────
describe("🔴 ⑥ 두 선택이 따로 산다", () => {
  test("[범위 선택] 전용 집합이 따로 있고, 단수 선택은 그대로다", () => {
    assert.ok(graph.includes("const [internalBoxSelectedNodeIds, setInternalBoxSelectedNodeIds] = useState<ReadonlySet<string>>(() => new Set<string>());"));
    assert.ok(graph.includes("const boxSelectedNodeIds = controlledBoxSelectedNodeIds ?? internalBoxSelectedNodeIds;"), "안 넘기면 제 안의 값으로 돌아야 한다");
    assert.ok(graph.includes("const setBoxSelectedNodeIds = onBoxSelectionChange ?? setInternalBoxSelectedNodeIds;"), "갈아 끼우는 손잡이도 같은 겹침이어야 한다");
    assert.ok(flat(graph).includes("boxSelectedNodeIds?: ReadonlySet<string>;"), "프롭은 선택이어야 한다 — 필수가 되면 읽기 전용 화면이 함께 바뀐다");
    // 🔵 앞 값을 보고 다음 값을 정하는 자리가 둘이라(넣기/빼기 · 이미 비었으면 그대로)
    //    값만 받는 콜백으로 좁히면 그 둘이 렌더 시점의 옛 집합을 읽는다.
    assert.ok(flat(graph).includes("onBoxSelectionChange?: Dispatch<SetStateAction<ReadonlySet<string>>>;"));
    // 🔴 단수 선택은 여전히 **편집기가 들고 내려보낸다** — 이 조각이 손댄 적 없다.
    assert.ok(screen.includes("const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);"), "편집기의 단수 선택이 사라졌다");
    assert.ok(flat(graph).includes("selectedNodeId?: string | null;"), "그림이 단수 선택을 받는 프롭이 사라졌다");
  });

  test("🔴 칸을 누르면 **넣고 뺀다** — 그 가지는 위로 아무것도 안 알린다", () => {
    const body = flat(functionBody(graph, "function handleCanvasNodeClick(nodeId: string)"));
    assert.ok(body.length > 60 && body.length < 400, `handleCanvasNodeClick 를 못 집었다(길이 ${body.length})`);
    const branch = body.slice(body.indexOf("if (boxSelectActive) {"), body.indexOf("onNodeClick?.(nodeId);"));
    assert.ok(branch.length > 20, `[범위 선택] 가지를 못 집었다: ${body}`);
    assert.ok(branch.includes("setBoxSelectedNodeIds((current) => toggleNodeInSelection(current, nodeId));"), `넣기/빼기를 공용 순수 함수에 안 맡긴다: ${branch}`);
    assert.ok(branch.includes("return;"), "[범위 선택] 모드에서도 아래 단수 선택 줄까지 흘러간다");
    assert.ok(!branch.includes("onNodeClick"), `그 가지가 편집기에 알린다 — 고르기만 했는데 패널이 통째로 바뀐다: ${branch}`);
    // 🔵 보조키를 안 쓴다 — Shift 는 축 잠금이 이미 쓰고 있다(⑦절).
    assert.ok(!body.includes("shiftKey") && !body.includes("ctrlKey") && !body.includes("metaKey"), "보조키로 가르기 시작했다");
  });

  test("🔵 빈 바탕을 누르면 비운다 — 이미 비었으면 같은 집합 그대로", () => {
    const body = flat(functionBody(graph, "function handleCanvasPaneClick()"));
    assert.ok(body.includes("setBoxSelectedNodeIds((current) => (current.size === 0 ? current : new Set<string>()));"), `빈 바탕 누르기가 고른 것을 안 비운다: ${body}`);
    assert.ok(body.includes("onPaneClick?.();"), `빈 바탕 누르기가 편집기 쪽 비우기를 잃었다: ${body}`);
    // 🔵 끌지 않고 누르기만 한 손짓(넓이 0)은 캔버스가 아예 안 알린다 — 그래서
    //    「비우기」가 이 길 하나로 들어온다는 전제.
    assert.ok(canvas.includes("if (box.width === 0 || box.height === 0) return;"), "넓이 0 짜리 네모가 고르기로 흘러가기 시작했다");
  });
});

// ────────────────────────────────────────────────────────────────────────────
// ⑦ 🔴 **Shift 는 여전히 축 잠금 전용**이고, 공용 것은 하나도 안 고쳤다
// ────────────────────────────────────────────────────────────────────────────
describe("🔴 ⑦ Shift · 그리고 공용 것을 안 고쳤다", () => {
  test("🔴 Shift 가 바탕 제 선택 상자로 안 넘어간다 — 두 모드 모두에서 축 잠금이다", () => {
    assert.ok(graph.includes("selectionKeyCode={null}"), "Shift 가 다시 선택 상자로 넘어갔다 — Shift+끌기가 축 잠금이 아니게 된다");
    // 🔴 **우리 네모와 부딪히지 않는 까닭**(@xyflow/react 12.11.2 에서 값으로 확인):
    //    `isSelecting = selectionKeyPressed || userSelectionActive || (selectionOnDrag
    //    && panOnDrag !== true)` 인데, keyCode 가 null 이면 useKeyPress 가 듣는 사람을
    //    아예 안 붙여 첫 항이 영영 거짓이고, `selectionOnDrag` 를 안 넘기므로 셋째
    //    항도 거짓이다. 🔴 거꾸로 **그것을 넘기는 날** 바탕이 제 네모를 함께 그린다
    //    ([범위 선택] 모드에서는 panOnDrag 가 false 라 셋째 항이 참이 된다).
    assert.ok(!graph.includes("selectionOnDrag"), "바탕 제 선택 상자가 함께 켜지기 시작했다 — 네모가 두 벌 그려진다");
    assert.ok(!canvas.includes("selectionOnDrag={"), "캔버스가 바탕 제 선택 상자를 켜기 시작했다");
    // 🔵 축 잠금 쪽이 그대로라는 근거 — 이 조각은 끌기 셈을 한 글자도 안 고쳤다.
    assert.ok(graph.includes("applyAxisLockToMoves(movingNodes, drag.startById, drag.axis)"), "끄는 동안의 축 잠금이 바뀌었다");
    assert.ok(graph.includes("applyAxisLockToMoves(movingNodes, drag.startById, lockedAxis)"), "놓는 순간의 축 잠금이 바뀌었다");
  });

  test("🔴 공용 캔버스는 **이미 준비돼 있던 프롭**만 쓴다 — 고치지 않았다", () => {
    assert.ok(flat(canvas).includes("boxSelection?: GraphCanvasBoxSelection;"), "캔버스의 프롭이 선택이 아니게 됐다");
    assert.ok(canvas.includes("const boxSelectActive = boxSelection?.active === true;"), "캔버스가 켜지는 조건이 바뀌었다");
    assert.ok(canvas.includes("panOnDrag={!boxSelectActive}"), "캔버스가 빈 바탕 끌기를 뺏어 오는 줄이 바뀌었다");
    assert.ok(flat(graph).includes("boxSelection={{ active: boxSelectActive, onSelect: handleBoxSelect }}"), "그림이 선택 상자를 안 넘긴다");
  });

  test("🔴 순수 모듈도 그대로 쓴다 — 셈을 이 집에 베껴 적지 않았다", () => {
    assert.ok(
      graphRaw.includes('import { findNodeIdsInSelectionBox, toggleNodeInSelection, type BoxSelectableNode, type SelectionBox } from "@/lib/graph-editor-core/box-selection";'),
      "순수 모듈을 안 들여온다"
    );
    assert.ok(!/Math\.(min|max|abs)\(/.test(graph), "그림이 네모 셈을 제 손으로 적기 시작했다 — box-selection.ts 한 벌만 있어야 한다");
  });
});

// ────────────────────────────────────────────────────────────────────────────
// ⑧ 🔴 [Delete] 는 **B3′ 에서 붙었다** — 그래도 키를 듣는 자리는 그림이 아니다
// ────────────────────────────────────────────────────────────────────────────
describe("🔴 ⑧ [Delete] — 듣는 자리는 그림이 아니다", () => {
  test("🔴 키를 듣는 자리는 **그림이 아니다** — 그림이 들으면 등록이 둘이 된다", () => {
    assert.ok(!graph.includes("Delete"), "그림이 키를 듣기 시작했다");
    assert.ok(!graph.includes("addEventListener"), "그림이 전역 키·마우스를 직접 듣기 시작했다");
  });

  test("🔴 고른 집합은 **편집기를 거쳐** 키 판정으로 간다 — 키가 집합을 직접 뒤지지 않는다", () => {
    // 🔴 2026-11-21(조각 B3′) — 이 절의 전제가 뒤집혔다. B2′ 때는 「고른 집합이 키
    //    판정으로 **안 흘러간다**」(false / [] 를 박아 두었다)였는데, 바로 그 일을
    //    하는 것이 B3′ 다. 지우지 않고 **반대 방향으로** 고쳐 적는다 — 지우면
    //    「들어왔다 다시 빠져도」 아무도 모른다.
    // 🔴 **이 절이 계속 지키는 것**: 키는 집합을 **제 손으로 뒤지지 않는다.** 무엇을
    //    지울지는 순수 판정이 정하고(모드 관문 · 막힌 것 거르기가 거기 있다), 화면은
    //    렌더마다 갱신되는 ref 로 **값만** 건넨다.
    const keyHandler = flat(functionBody(screen, "function handleKeyDown(e: KeyboardEvent)"));
    assert.ok(keyHandler.length > 200, `키 처리를 못 집었다(길이 ${keyHandler.length})`);
    assert.ok(keyHandler.includes("boxSelectActive: deleteByKeyRef.current.boxSelectActive,"), "모드를 판정에 안 넘긴다");
    assert.ok(keyHandler.includes("boxSelectedNodes: deleteByKeyRef.current.boxSelectedNodes,"), "고른 칸들을 판정에 안 넘긴다");
    assert.ok(!keyHandler.includes("boxSelectedNodeIds"), "고른 집합을 키가 직접 뒤진다 — 판정을 건너뛰는 길이다");
    assert.ok(keyHandler.includes('if (plan.action === "DELETE_NODES") {'), "판정이 복수를 가리켜도 키가 안 받는다");
    // 🔵 단수 쪽은 그대로다 — 그 모드에서는 단수 선택이 늘 비어 있다(모드를 바꿀 때
    //    그림이 비우고, 칸을 눌러도 단수 선택은 안 바뀐다 — ③·⑥절).
    assert.ok(keyHandler.includes("selectedNodeId: deletableNodeId,"), "키가 보는 단수 선택이 바뀌었다");
    // 🔴 모드 관문이 **그림과 같은 값**이어야 한다 — 갈리면 보이지 않는 것이 지워지거나
    //    보이는데 안 지워진다(오류는 안 난다).
    assert.ok(graph.includes("const canUseBoxSelect = editable;"), "그림 쪽 관문이 바뀌었다");
    assert.ok(flat(screen).includes("const boxSelectActive = canEdit && canvasTool === \"BOX_SELECT\";"), "편집기 쪽 관문이 그림과 다르다");
  });

  test("🔴 [범위 선택] 모드에서도 **「화면에서 선택」이 먼저 이긴다** — 안 그러면 눌러도 아무 일이 없다", () => {
    // 🔴 2026-11-21(조각 B3′) — B2′ 가 **알고 남겨 둔 자리**다. 그때는 칸 누르기를
    //    [범위 선택]이 먼저 가져가서, [연결 추가]의 대상 고르기와 [상대 위치로 이동]의
    //    기준 고르기가 그 모드에서 **아무 일도 안 했다**(오류조차 안 났다). 절차 그림과
    //    같게 — 가로채기가 **앞**이다.
    const body = flat(functionBody(graph, "function handleCanvasNodeClick(nodeId: string)"));
    const interceptAt = body.indexOf("if (onNodeClickIntercept?.(nodeId)) return;");
    const boxAt = body.indexOf("if (boxSelectActive) {");
    assert.notEqual(interceptAt, -1, "가로채기 통로가 없다 — 그 모드에서 「화면에서 선택」이 죽은 단추가 된다");
    assert.notEqual(boxAt, -1, "[범위 선택] 가지가 사라졌다");
    assert.ok(interceptAt < boxAt, "가로채기가 [범위 선택] 뒤에 있다 — 고르기 모드가 다시 죽는다");
    // 🔵 절차 그림도 같은 차례라는 근거(베낀 것이 아니라 **맞춘** 것이다).
    const procedureGraph = stripComments(read("src/components/procedures/ProcedureFlowGraph.tsx"));
    const procedureBody = flat(functionBody(procedureGraph, "function handleCanvasNodeClick(nodeId: string)"));
    assert.ok(
      procedureBody.indexOf("if (onNodeClickIntercept?.(nodeId)) return;") < procedureBody.indexOf("if (boxSelectActive) {"),
      "절차 쪽 차례가 바뀌었다 — 둘을 같게 맞춰 둔 전제가 깨졌다"
    );
    // 🔴 편집기가 그 손잡이를 실제로 쓴다 — 「프롭은 있는데 아무도 안 쓴다」가 되면
    //    고르기 모드는 여전히 죽어 있다.
    assert.ok(flat(screen).includes("onNodeClickIntercept={(nodeId) => {"), "편집기가 가로채기를 안 넘긴다");
    const intercept = flat(functionBody(screen, "onNodeClickIntercept={(nodeId) =>"));
    assert.ok(intercept.includes("if (isPickingEdgeTarget) {"), "대상 노드 고르기가 가로채기 안에 없다");
    assert.ok(intercept.includes("if (isPickingReferenceNode) {"), "기준 노드 고르기가 가로채기 안에 없다");
    assert.equal(countOf(intercept, "return true;"), 2, "고르기 둘이 「내가 썼다」를 안 돌려준다");
    assert.ok(intercept.includes("return false;"), "고르기가 아닐 때 아래로 안 흘려보낸다");
    // 🔴 그리고 **선택을 옮기는 줄은 가로채기 안에 없어야** 한다 — 옮기면 패널이
    //    작성 중이던 내용을 비운다(그 둘을 한 손잡이에 섞지 않는 까닭).
    assert.ok(!intercept.includes("setSelectedNodeId("), "가로채기가 선택을 옮긴다 — 고르는 동안 패널이 초기화된다");
  });
});

// ────────────────────────────────────────────────────────────────────────────
// ⑨ 🟢 읽기 전용 화면은 **전과 똑같다** — 도구 단추가 안 선다
// ────────────────────────────────────────────────────────────────────────────
describe("🟢 ⑨ 읽기 전용 화면은 전과 같다", () => {
  test("작업 기록 흐름도는 도구도 고른 집합도 안 넘긴다 — editable 이 거짓이라 단추가 안 선다", () => {
    assert.ok(readOnlyPage.includes("<CaseFlowchartGraph nodes={nodes} edges={edges} editable={false} />"), "읽기 전용 호출부가 바뀌었다");
    assert.ok(!readOnlyPage.includes("canvasTool"), "읽기 전용 화면이 도구 모드를 제어하기 시작했다");
    assert.ok(!readOnlyPage.includes("boxSelect"), "읽기 전용 화면이 고른 집합을 제어하기 시작했다");
  });
});
