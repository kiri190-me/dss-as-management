import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

/**
 * ============================================================================
 * [점선 네모] 도구 단추와 선택 상자 (2026-11-21, 조각 B2)
 * ============================================================================
 * 쓰는 분 요청: 「동영상 편집 프로그램처럼 [마우스] 아이콘을 누르면 지금처럼 일반
 * 기능을, [점선 네모] 아이콘을 누르면 드래그 혹은 클릭으로 여러 노드를 골라 한
 * 번에 이동」. 밑자락(여럿을 끌면 여럿이 저장되는 배선 · 네모 안 칸 고르기 셈)은
 * 앞 조각 B1 이 깔았고 — procedure-multi-node-drag-plumbing.test.ts ·
 * src/lib/graph-editor-core/box-selection.test.ts — 이 조각이 **화면을 바꾼다.**
 *
 * ── 🔴 무엇을 여기서 재고, 무엇을 못 재는가 ──────────────────────────────
 * **손짓은 이 저장소가 못 잰다**(브라우저가 없다). 끌어서 네모를 그리는 일, 그
 * 네모가 보이는 일, 골라 놓고 끌면 함께 움직이는 일은 **쓰는 분의 눈**이 맡는다.
 * 값으로 재는 것은 순수 계산 쪽에 있다(box-selection.test.ts — 어느 방향으로
 * 끌든 같은 네모인가 · 닿으면 고르는가 · 그리는 네모와 고르는 네모가 같은 두
 * 점에서 나오는가 · 두 번 누르면 빠지는가).
 *
 * **이 파일이 재는 것은 「그 사이를 잇는 글자」**다. 조용히 어긋나면 오류 없이
 * 화면만 이상해지는 자리들이라, 하나씩 글자로 못 박는다:
 *   ㉠ 칸에 `selected` 를 **모드 안에서만** 싣는가(열쇠 한 줄),
 *   ㉡ 모드를 바꿀 때 **고른 것을 비우는가**(안 비우면 보이지 않는 칸이 함께 끌린다),
 *   ㉢ 네모를 **그림 좌표로** 재고, 칸 자리·크기를 **새로 추정하지 않는가**,
 *   ㉣ 네모 끝에 딸려 오는 click 이 **방금 고른 것을 안 지우는가**,
 *   ㉤ 마우스 모드의 **단수 선택을 한 글자도 안 건드리는가**,
 *   ㉥ [진단 Flowchart] 와 읽기 전용 화면 셋이 **전과 똑같은가**.
 *
 * ── 왜 렌더가 아니라 원본 글자로 재는가 ─────────────────────────────────
 * 이웃들과 같은 사정이다: 이 그림은 @xyflow/react 의 .css 를 함께 물고 있어
 * test:components 에서는 import 자체가 던진다.
 *
 * ── 🔴 주석을 걷어내고 센다 ─────────────────────────────────────────────
 * 이 저장소는 까닭을 그 자리 주석에 길게 적는다. 이 조각에서 늘어난 주석에는
 * `selected`·`boxSelection`·`panOnDrag` 같은 낱말이 **그대로 적혀 있어서**,
 * 안 걷으면 「없어졌는가」 쪽이 영영 깨지고 「있는가」 쪽이 주석만으로 영영
 * 통과한다. ①절의 마지막 단언이 걷어내기가 일하고 있다는 증거다.
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

const PATHS = {
  canvas: "src/components/graph-editor-core/GraphCanvas.tsx",
  graph: "src/components/procedures/ProcedureFlowGraph.tsx",
  picker: "src/components/procedures/visual/ProcedureCanvasToolPicker.tsx",
  editor: "src/components/procedures/ProcedureTemplateEditorScreen.tsx",
  caseGraph: "src/components/repair-cases/flowchart/CaseFlowchartGraph.tsx",
  detail: "src/components/procedures/ProcedureTemplateDetailScreen.tsx",
  startPicker: "src/components/procedures/execution/ProcedureStartPickerGraph.tsx",
  executionSteps: "src/components/procedures/execution/ExecutionStepsGraph.tsx",
} as const;

const canvas = stripComments(read(PATHS.canvas));
const graph = stripComments(read(PATHS.graph));
const picker = stripComments(read(PATHS.picker));
const editor = stripComments(read(PATHS.editor));
const caseGraph = stripComments(read(PATHS.caseGraph));

describe("조각 B2 — ① 먼저 표본 확인", () => {
  test("🔵 파일이 전부 읽혔고, 재려는 손잡이가 실제로 거기 있다", () => {
    for (const [name, source] of Object.entries({ canvas, graph, picker, editor, caseGraph })) {
      assert.ok(source.length > 500, `${name} 이 비어 있거나 너무 짧다 — 경로가 틀리면 아래 단언이 전부 공짜로 통과한다`);
    }
    assert.ok(graph.includes("<GraphCanvas"), "그림이 캔버스를 그려야 아래 단언에 뜻이 있다");
    assert.ok(picker.includes("export default function ProcedureCanvasToolPicker"), "도구 단추 부품을 못 찾았다");
  });

  test("🔴 주석 걷어내기가 실제로 일을 한다 — 날것에는 코드에 없는 글자가 주석으로 적혀 있다", () => {
    assert.ok(read(PATHS.graph).includes("보이지 않는 짝들이 함께 끌린다"), "모드 전환이 선택을 비우는 까닭이 주석에 적혀 있어야 한다");
    assert.ok(!graph.includes("보이지 않는 짝들이 함께 끌린다"), "코드에는 그 문장이 없다 — 걷어내기가 일을 안 하고 있다");
    assert.ok(read(PATHS.canvas).includes("아무것도 안 골라진다"), "캔버스 주석에 바탕 제 선택 상자를 못 쓰는 까닭이 적혀 있어야 한다");
    assert.ok(!canvas.includes("아무것도 안 골라진다"));
  });
});

/**
 * 🔴 **도구 단추** — 아이콘만 두면 무엇인지 모른다. 그리고 **새 상시 안내 줄을
 * 세우지 않는다**: 이 편집기의 안내 두 줄은 쓰는 분 요청으로 걷어낸 자리다
 * (커밋 d57f664a — 「이 설명들은 삭제해줘」). 설명은 단추 안의 글자와 `title`
 * 까지다.
 */
describe("조각 B2 — 도구 단추 둘", () => {
  test("모드는 둘뿐이고, 처음은 마우스다", () => {
    assert.ok(picker.includes('export type ProcedureCanvasTool = "POINTER" | "BOX_SELECT";'));
    assert.ok(graph.includes('const [internalCanvasTool, setInternalCanvasTool] = useState<ProcedureCanvasTool>("POINTER");'), "기본이 마우스가 아니면 그림을 열자마자 화면이 안 끌린다");
  });

  test("🔴 배치 모드와 **같은 통제형 패턴**이다 — 안 넘기면 제 안의 값으로 돈다", () => {
    assert.ok(graph.includes("const canvasTool = controlledCanvasTool ?? internalCanvasTool;"));
    assert.ok(flat(graph).includes("canvasTool?: ProcedureCanvasTool;"), "프롭은 선택이어야 한다 — 필수가 되면 호출부 넷이 전부 바뀐다");
    assert.ok(flat(graph).includes("onCanvasToolChange?: (tool: ProcedureCanvasTool) => void;"));
  });

  test("🔴 단추는 **끌 수 있는 그림에만** 선다 — 읽기 전용 그림에서 화면 옮기기를 뺏으면 안 된다", () => {
    assert.ok(graph.includes('const canUseBoxSelect = editable && layoutMode === "USER";'), "관문이 끌기 관문과 같은 값이어야 한다");
    assert.ok(graph.includes('nodesDraggable={editable && layoutMode === "USER"}'), "끌기 관문 쪽이 바뀌었다 — 둘이 갈리면 「고를 수는 있는데 못 끄는」 그림이 생긴다");
    assert.ok(
      flat(graph).includes("{canUseBoxSelect && ( <ProcedureCanvasToolPicker tool={canvasTool} onToolChange={changeCanvasTool} selectedCount={boxSelectedNodeIds.size} /> )}"),
      "단추를 그 관문 안에 안 두었다"
    );
  });

  test("🔵 아이콘은 **손으로 그린 인라인 SVG** 다 — 아이콘 묶음을 새로 안 들였다", () => {
    assert.ok(picker.includes('<svg viewBox="0 0 24 24"'), "인라인 SVG 가 아니다");
    assert.equal((picker.match(/<svg viewBox="0 0 24 24"/g) ?? []).length, 2, "아이콘이 둘이어야 한다");
    assert.ok(picker.includes('stroke: "currentColor"'), "글자색을 그대로 입어야 눌린 단추에서 아이콘이 보인다");
    const imports = picker.split("\n").filter((line) => line.startsWith("import "));
    assert.deepEqual(imports, [], `도구 단추가 무언가를 들여온다 — 아이콘 묶음이 아닌지 보라: ${imports.join(" / ")}`);
  });

  test("🔴 아이콘 옆에 **글자**가 함께 있다 — 아이콘만 두면 무엇인지 모른다", () => {
    // 🔴 **쓰는 분이 고른 낱말이다**(2026-11-21 — 처음 올린 [마우스]·[점선 네모] 를
    //    보고 「기능을 설명하는 단어였으면 좋겠어」로 고친 것이다). 글자를 또 바꾸려면
    //    이 줄도 함께 고쳐야 하고, 그래야 **누가 언제 정한 글자인지**가 남는다.
    //    🔵 코드와 주석은 여전히 처음 이름(점선 네모)으로 부른다 — 까닭은 단추 파일 머리말에.
    const labels = [...picker.matchAll(/label: "([^"]+)"/g)].map((m) => m[1]);
    assert.deepEqual(labels, ["선택·이동", "범위 선택"]);
    assert.ok(flat(picker).includes("<Icon className=\"h-3.5 w-3.5\" /> {label}"), "단추 안에 글자가 안 그려진다");
    // 🔵 설명은 **단추에 적힌 그 글자로 시작**한다. 둘이 어긋나 있으면 한쪽만 고치다 만 것이다.
    for (const label of labels) {
      assert.ok(picker.includes(`title: "${label} — `), `[${label}] 의 설명이 그 글자로 안 시작한다`);
    }
    for (const tool of ["POINTER", "BOX_SELECT"]) {
      const entry = flat(picker).slice(flat(picker).indexOf(`tool: "${tool}"`));
      assert.ok(/title: "[^"]{20,}"/.test(entry.slice(0, 400)), `${tool} 에 무엇이 되는지 적은 title 이 없다`);
    }
  });

  test("🔴 눌린 쪽은 **색이 다르다** — aria-pressed 만 바뀌면 화면에서는 어느 도구인지 알 수 없다", () => {
    assert.ok(picker.includes("aria-pressed={tool === value}"));
    const idle = /const TOOL_BUTTON_IDLE = "([^"]+)"/.exec(picker)?.[1];
    const active = /const TOOL_BUTTON_ACTIVE = "([^"]+)"/.exec(picker)?.[1];
    assert.ok(idle && active, "눌린/안 눌린 모양을 못 찾았다");
    assert.notEqual(idle, active);
    assert.ok(/\bbg-blue-/.test(active!), `눌린 쪽에 바탕색이 없다: ${active}`);
  });

  test("🔴 **걷어낸 안내 두 줄이 다른 이름으로 돌아오지 않았다** — 세 번째로 세우면 안 된다", () => {
    assert.ok(!editor.includes("노드·연결선 추가·삭제·재연결도 [저장]을 눌러야 저장됩니다"));
    assert.ok(!flat(graph).includes("점선 네모를 누르고 빈 바탕을 끌면"), "그림에 새 상시 안내 줄이 섰다 — 설명은 단추 글자와 title 까지다");
    assert.ok(!picker.includes("<p "), "도구 단추 옆에 설명 문단이 섰다");
  });
});

/**
 * 🔴 **모드를 바꾸면 고른 것을 비운다.** 안 비우면 점선 네모에서 고른 칸이 마우스
 * 모드로 돌아와서도 `selected` 를 단 채 남아, 칸 하나를 끌었을 뿐인데 보이지 않는
 * 짝들이 함께 끌린다 — 오류가 안 나고, 끌리는 모습도 멀쩡하다.
 */
describe("조각 B2 — 모드를 바꾸면 선택을 비운다", () => {
  const body = (() => {
    const fn = graph.slice(graph.indexOf("function changeCanvasTool"));
    return fn.slice(0, fn.indexOf("\n  }"));
  })();

  test("🔴 고른 집합과 단수 선택을 **둘 다** 비운다", () => {
    assert.ok(body.includes("setBoxSelectedNodeIds(new Set<string>());"), `고른 집합을 안 비운다: ${body}`);
    assert.ok(body.includes("setSelectedNodeId(null);"), `단수 선택을 안 비운다: ${body}`);
    assert.ok(body.includes("onEdgeSelectionChange?.(null);"), "연결선 선택이 남는다");
  });

  test("🔴 **도구를 바꾸는 길은 이 함수 하나**다 — 다른 길로 바꾸면 비우기를 건너뛴다", () => {
    // 🔵 `setInternalCanvasTool` 은 **선언 한 번 + 쓰는 자리 한 번**이 전부여야 한다.
    const mentions = graph.match(/setInternalCanvasTool/g) ?? [];
    assert.equal(mentions.length, 2, `도구를 갈아 끼우는 자리가 선언 말고 ${mentions.length - 1} 곳이다 — 하나여야 한다`);
    assert.equal((graph.match(/\(onCanvasToolChange \?\? setInternalCanvasTool\)\(/g) ?? []).length, 1, "갈아 끼우는 줄이 둘 이상이다");
    assert.ok(!graph.includes("onCanvasToolChange?.("), "바깥에만 알리고 제 값은 안 바꾸는 두 번째 길이 생겼다");
    assert.ok(body.includes("(onCanvasToolChange ?? setInternalCanvasTool)(nextTool);"), "갈아 끼우는 줄이 이 함수 안에 없다");
    assert.equal((graph.match(/onToolChange=\{/g) ?? []).length, 1, "단추가 다른 함수에 매여 있다");
    assert.ok(flat(graph).includes("onToolChange={changeCanvasTool}"));
  });

  test("🔴 바깥(편집기)은 제 손으로 도구를 안 바꾼다 — 넘기기만 한다", () => {
    assert.ok(flat(editor).includes("canvasTool={canvasTool} onCanvasToolChange={setCanvasTool}"), "편집기가 도구를 안 넘긴다");
    assert.equal((editor.match(/setCanvasTool/g) ?? []).length, 2, "편집기가 setCanvasTool 을 제 손으로 부른다 — 그러면 선택이 안 비워진다");
  });
});

/**
 * 🔴 **선택 상자** — 바탕 제 것을 못 써서 직접 그린다(까닭은 GraphCanvas 쪽
 * 머리말). 여기가 어긋나면 「네모는 그려지는데 엉뚱한 칸이 골라지는」, 눈으로만
 * 잡히는 결함이 난다.
 */
describe("조각 B2 — 선택 상자 (GraphCanvas)", () => {
  test("🔴 켜는 동안에는 **빈 바탕 끌기를 바탕에서 뺏어 온다**", () => {
    assert.ok(canvas.includes("panOnDrag={!boxSelectActive}"), "화면 옮기기를 안 끄면 네모를 그리는 동안 바탕이 함께 흘러간다");
    assert.ok(canvas.includes("const boxSelectActive = boxSelection?.active === true;"));
  });

  test("🔴 **빈 바탕에서 시작한 것만** 네모가 된다 — 칸 끌기를 뺏으면 안 된다", () => {
    assert.ok(canvas.includes('if (!target.classList.contains("react-flow__pane")) return;'));
    assert.ok(canvas.includes("if (!boxSelectActive || event.button !== 0) return;"), "오른쪽 단추·꺼진 모드까지 네모가 된다");
  });

  test("🔴 고르는 네모는 **그림 좌표**, 그리는 네모는 화면 px — 둘 다 끈 같은 두 점에서 나온다", () => {
    assert.ok(canvas.includes("startFlow: instance.screenToFlowPosition(startClient)"), "시작점을 그림 좌표로 안 옮긴다");
    assert.ok(
      canvas.includes('selectionBoxFromPoints(gesture.startFlow, instance.screenToFlowPosition({ x: event.clientX, y: event.clientY }))'),
      "끝점을 그림 좌표로 안 옮긴다 — 화면 px 로 재면 확대를 바꾸는 순간 어긋난다"
    );
    assert.ok(canvas.includes("setBoxOverlay(selectionOverlayRect(gesture.startClient, { x: event.clientX, y: event.clientY }, gesture.paneOrigin));"));
    // 🔴 그리는 쪽이 제 셈을 따로 적으면 두 네모가 갈린다 — 공용 함수만 쓴다.
    assert.ok(!/Math\.(min|abs)\(/.test(canvas), "캔버스가 네모 셈을 제 손으로 적기 시작했다 — box-selection.ts 한 벌만 있어야 한다");
  });

  test("🔵 끌지 않고 누르기만 하면 **고르지 않는다** — 그 자리는 빈 바탕 누르기가 맡는다", () => {
    assert.ok(canvas.includes("if (box.width === 0 || box.height === 0) return;"));
    const up = canvas.slice(canvas.indexOf("function handleBoxPointerUp"));
    const body = up.slice(0, up.indexOf("\n  }"));
    assert.ok(body.indexOf("box.width === 0") < body.indexOf("boxSelection?.onSelect(box)"), "넓이 0 인데도 고르기를 먼저 부른다");
  });

  test("🔴 네모 끝에 딸려 오는 click 이 **방금 고른 것을 안 지운다**", () => {
    assert.ok(canvas.includes("suppressPaneClickRef.current = true;"), "깃발을 안 세운다 — 고른 즉시 onPaneClick 이 비운다");
    const paneClick = flat(canvas).slice(flat(canvas).indexOf("onPaneClick={() => {"));
    assert.ok(
      paneClick.startsWith("onPaneClick={() => { if (suppressPaneClickRef.current) { suppressPaneClickRef.current = false; return; } onPaneClick?.(); }}"),
      `딸려 오는 click 을 안 거른다: ${paneClick.slice(0, 200)}`
    );
    assert.ok(
      canvas.includes("suppressPaneClickRef.current = false;\n    if (!boxSelectActive"),
      "손짓이 새로 시작할 때 깃발을 안 내린다 — 한 번 세워진 깃발이 다음 빈 바탕 누르기를 먹는다"
    );
  });

  test("🔵 그린 네모는 손짓을 **안 가로챈다**", () => {
    assert.ok(canvas.includes("pointer-events-none absolute rounded-[2px] border border-dashed border-blue-500"), "점선 네모가 아니거나 손짓을 가로챈다");
  });

  test("🟢 안 넘기는 쪽은 전과 똑같다 — 프롭 하나에 전부 매달려 있다", () => {
    assert.ok(flat(canvas).includes("boxSelection?: GraphCanvasBoxSelection;"), "프롭이 선택이 아니면 [진단 Flowchart] 가 함께 바뀐다");
    // 안 넘기면 active 가 거짓이고, 그러면 panOnDrag 가 true — React Flow 제 기본값 그대로다.
    assert.ok(canvas.includes("const boxSelectActive = boxSelection?.active === true;"));
    assert.ok(!caseGraph.includes("boxSelection"), "[진단 Flowchart] 가 선택 상자를 켜기 시작했다");
    // 끄는 손잡이 셋은 켜져 있을 때만 달린다 — 안 넘기는 쪽에는 아무것도 안 붙는다.
    for (const handler of ["onPointerMove", "onPointerUp", "onLostPointerCapture"]) {
      assert.ok(canvas.includes(`${handler}={boxSelectActive ? handleBox`), `${handler} 이 꺼진 그림에도 달린다`);
    }
    // 🔴 누르기 하나는 늘 달려 있어야 한다(깃발을 내리는 자리다).
    assert.ok(canvas.includes("onPointerDown={handleBoxPointerDown}"), "누르기까지 모드에 매달면 깃발이 선 채로 남는다");
  });
});

/**
 * 🔴 **네모에 든 칸을 고를 때 자리·크기를 새로 추정하지 않는다.** 한 벌이라도
 * 더 만들면 「그린 네모와 골라진 칸이 다른」 결함이 나고, 그건 눈으로만 잡힌다.
 */
describe("조각 B2 — 무엇을 어느 좌표로 재는가", () => {
  const body = (() => {
    const fn = graph.slice(graph.indexOf("function handleBoxSelect"));
    return fn.slice(0, fn.indexOf("\n  }"));
  })();

  test("🔵 먼저 표본 — 재려는 함수를 제대로 집었다", () => {
    assert.ok(body.length > 200 && body.length < 1200, `handleBoxSelect 를 못 집었다(길이 ${body.length})`);
    assert.ok(body.includes("setBoxSelectedNodeIds(findNodeIdsInSelectionBox(box, candidates));"), "고르는 셈을 공용 함수에 안 맡긴다");
  });

  test("🔴 자리는 「이 그림이 실제로 그린 자리」에서 받는다 — 저장된 좌표가 아니다", () => {
    assert.ok(body.includes("const position = resolveRenderedPosition(n);"), `자리를 다른 데서 읽는다: ${body}`);
    assert.ok(!body.includes("positionX"), "저장 좌표를 직접 읽는다 — 자동 배치로 그려진 칸이 통째로 어긋난다");
  });

  test("🔴 크기는 **이미 있는 규칙**에서 받는다 — 잰 값 우선, 없으면 추정값", () => {
    assert.ok(
      body.includes("resolveEffectiveNodeDimensions(instance?.getInternalNode(n.id)?.measured, nodeDimsById.get(n.id) ?? { width: 0, height: 0 })"),
      `크기 규칙이 바뀌었다: ${body}`
    );
    assert.ok(!body.includes("computeNodeDimensions("), "여기서 크기를 또 추정한다 — 같은 칸의 크기가 두 벌이 된다");
  });

  test("🔵 후보는 **거르고 남은 진짜 칸**뿐이다 — 유령 칸·단계 머리띠는 골라도 안 끌린다", () => {
    assert.ok(body.includes("filteredNodeRows.map((n)"), `후보 목록이 바뀌었다: ${body}`);
    assert.ok(!body.includes("ghost"), "유령 칸이 후보에 들어갔다 — 「골랐다고 센 수는 늘었는데 안 움직이는」 칸이 생긴다");
  });
});

/**
 * 🔴 **마우스 모드의 단수 선택을 한 글자도 안 건드린다.** 그것을 쓰는 자리가
 * 많다 — 속성 패널 · [연결 추가] 미리 채우기 · [노드 추가] 기준 · [Delete] 키 ·
 * 삭제가 막힌 까닭. 점선 네모 모드에서 하는 일은 옮기기(와 다음 조각의 지우기)뿐이라
 * 그 자리들을 하나도 안 건드려도 된다.
 */
describe("조각 B2 — 복수 선택은 따로 산다", () => {
  test("점선 네모 전용 집합이 따로 있다", () => {
    assert.ok(graph.includes("const [boxSelectedNodeIds, setBoxSelectedNodeIds] = useState<ReadonlySet<string>>(() => new Set<string>());"));
    assert.ok(graph.includes("const [selectedNodeId, setSelectedNodeId] = useState<string | null>(() => initialSelectedNodeId);"), "단수 선택이 사라졌다");
  });

  test("🔴 칸을 누르면 **넣고 뺀다** — 그리고 그 가지는 단수 선택을 안 건드린다", () => {
    const fn = graph.slice(graph.indexOf("function handleCanvasNodeClick"));
    const body = fn.slice(0, fn.indexOf("\n  }"));
    const branch = body.slice(body.indexOf("if (boxSelectActive) {"), body.indexOf("onEdgeSelectionChange?.(null);"));
    assert.ok(branch.includes("setBoxSelectedNodeIds((current) => toggleNodeInSelection(current, nodeId));"), `넣기/빼기를 공용 함수에 안 맡긴다: ${branch}`);
    assert.ok(branch.includes("return;"), "박스 모드에서도 아래 단수 선택 줄까지 흘러간다");
    assert.ok(!branch.includes("setSelectedNodeId"), `박스 모드 가지가 단수 선택을 건드린다: ${branch}`);
  });

  test("🔵 빈 바탕을 누르면 비운다", () => {
    const fn = graph.slice(graph.indexOf("function handleCanvasPaneClick"));
    const body = fn.slice(0, fn.indexOf("\n  }"));
    assert.ok(body.includes("setBoxSelectedNodeIds((current) => (current.size === 0 ? current : new Set<string>()));"), `빈 바탕 누르기가 고른 것을 안 비운다: ${body}`);
  });

  test("🔴 **고른 수**가 화면에 보인다 — 새 상시 줄이 아니라 도구 줄 안에", () => {
    assert.ok(flat(graph).includes("selectedCount={boxSelectedNodeIds.size}"), "고른 수를 안 넘긴다");
    assert.ok(flat(picker).includes('{tool === "BOX_SELECT" && ('), "마우스 모드에도 상시로 서 있다");
    assert.ok(flat(picker).includes("{selectedCount}개</span> 선택"), "고른 수를 안 그린다");
  });

  test("🔴 **복수 삭제는 다음 조각이다** — 이 조각은 [Delete] 키를 안 건드린다", () => {
    assert.ok(!editor.includes("boxSelect"), "편집기가 고른 집합을 알기 시작했다 — 지우기는 B3 의 몫이다");
    assert.ok(!graph.includes("Delete"), "그림이 키를 듣기 시작했다");
  });
});

/**
 * 🟢 **이 프롭을 안 넘기는 화면 셋은 글자 하나 안 바뀐다.** 도구 단추가 서는
 * 조건이 `editable && layoutMode === "USER"` 라, 셋 다 그 값이 거짓이다.
 */
describe("조각 B2 — 🟢 나머지 화면 셋은 전과 같다", () => {
  for (const name of ["detail", "startPicker", "executionSteps"] as const) {
    test(`${name} 이 도구 모드를 안 넘긴다`, () => {
      const source = stripComments(read(PATHS[name]));
      assert.ok(source.includes("<ProcedureFlowGraph"), "이 화면이 정말 그 그림을 그려야 아래 단언에 뜻이 있다");
      assert.ok(!source.includes("canvasTool"), `${name} 이 도구 모드를 제어하기 시작했다`);
      assert.ok(!source.includes("editable"), `${name} 이 편집을 열기 시작했다 — 그러면 도구 단추가 선다`);
    });
  }
});
