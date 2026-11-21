import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

/**
 * ============================================================================
 * 「진단 Flowchart」 — 한 번 끌면 **옮긴 칸 전부**가 저장되는 배선 (2026-11-21, B1′)
 * ============================================================================
 * 「기술 작업 절차」 편집기가 같은 순서로 먼저 갔다(B1 `b4ee0166` → B2 `ced82c74`).
 * 이 조각은 그 가운데 **앞의 하나**, 곧 [범위 선택] 밑에 깔릴 **길**만 넓힌다.
 *
 * ── 🔴 B1′ 의 합격 기준은 「화면이 안 바뀐다」였다 ────────────────────────
 * 그때 이 그림은 칸을 **하나씩만** 고를 수 있었다(칸에 React Flow 의 선택 표시를
 * 안 싣고, 선택 상자도 안 넘겼다). 그래서 한 손짓이 옮기는 칸은 늘 하나였고,
 * 끌어 옮기고 [저장]하는 동작이 한 치도 달라지면 안 됐다.
 *
 * 🔴 **2026-11-21(조각 B2′)에 여럿 고르기가 실제로 들어왔다** — [범위 선택] 도구.
 * ④절이 「아직 없음」을 재던 자리라, 단언을 **반대 방향으로 고쳐 적었다**(지운 것이
 * 아니다). ②·③절이 재는 **길**은 한 글자도 안 바뀌었고, 이제 그 길에 칸이 여럿
 * 흐른다는 것만 달라졌다. 🔵 도구 단추 · 좌표계 · 비우는 길처럼 그 조각만 보는
 * 깊은 셈은 이웃 case-flowchart-box-selection-tool.test.ts 에 따로 있다.
 *
 * ── 🔴 여기서 가장 조용히 깨지는 것 ─────────────────────────────────────
 *  ① **목록을 버리는 것.** React Flow 는 함께 끄는 칸 전부를 세 번째 인자로
 *     넘기고 GraphCanvas 가 그것을 흘려준다. 받는 쪽이 끄는 칸 하나만 쓰면
 *     「화면은 전부 움직였는데 [저장]을 누르니 하나만 옮겨져 있다」가 된다 —
 *     **오류가 안 나고 끌리는 모습도 멀쩡해서** 아무도 못 알아챈다. (②·③절)
 *  ② **되돌리기가 칸 수만큼 쌓이는 것.** 고리 안에서 찍으면 [이전]을 칸 수만큼
 *     눌러야 한 걸음이 돌아간다. (③절)
 *  ③ **끌고 있는 동안 찍는 것.** 드래그 중 콜백은 **프레임마다** 온다 — 거기서
 *     찍으면 한 번 끌 때마다 되돌리기 기록이 수백 칸 쌓인다. (②·③절)
 *  ④ **축 잠금이 끄는 칸 하나만 거는 것.** Shift 로 끌 때 함께 끌리는 칸이 제
 *     축을 안 지키면, 잠근 축으로만 간 것은 끄는 칸뿐이고 나머지는 비스듬히
 *     따라간다. 셈 자체는 값으로 재는 쪽이 따로 있다
 *     (src/lib/graph-editor-core/axis-lock.test.ts 의 applyAxisLockToMoves) —
 *     여기서 재는 것은 **그 셈을 부르고 있는가**다. (②절)
 *
 * ── 왜 렌더가 아니라 원본 글자로 재는가 ─────────────────────────────────
 * 이 길은 **React Flow 가 실제로 마우스를 끌어야** 지나가는 자리라 이 저장소의
 * 시험 환경(브라우저 없음)에서는 손짓을 흉내 낼 수 없다. 게다가
 * CaseFlowchartEditorScreen 은 @xyflow/react 의 .css 와 서버 액션(→ server-only)을
 * 사슬로 물고 있어 어느 목록에서도 import 자체가 던진다 — 이웃
 * case-flowchart-delete-key-ui.test.ts 와 같은 사정이다.
 *
 * ── 🔴 주석을 걷어내고 센다 ─────────────────────────────────────────────
 * 두 파일의 주석에는 `movingNodes`·`onNodeDragStop`·`boxSelection` 같은 낱말이
 * **글자 그대로** 들어 있다(이 변경들이 그 까닭을 길게 적었다). 안 걷으면 「있는가」도
 * 「없어졌는가」도 셈이 통째로 뒤집힌다. ①절이 걷어내기가 실제로 일한다는 증거다.
 *
 * 🔵 절차 쪽과 **같은 모양인가**는 저쪽 집에서 함께 본다 —
 * src/components/procedures/procedure-multi-node-drag-plumbing.test.ts.
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

/** 글자가 몇 번 나오는가. 「한 번뿐인가」처럼 **수**가 뜻을 갖는 자리에서 쓴다. */
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
  axisLock: "src/lib/graph-editor-core/axis-lock.ts",
} as const;

const graphRaw = read(PATHS.graph);
const graph = stripComments(graphRaw);
const screenRaw = read(PATHS.screen);
const screen = stripComments(screenRaw);
const canvas = stripComments(read(PATHS.canvas));

// ────────────────────────────────────────────────────────────────────────────
// ① 공짜 통과 막기 — 주석 걷기가 **실제로 뭔가를 걷어냈는가**
// ────────────────────────────────────────────────────────────────────────────
describe("🔵 ① 먼저 — 주석 걷기가 일하고 있다", () => {
  for (const [name, { raw, code }] of Object.entries({
    그림: { raw: graphRaw, code: graph },
    편집기: { raw: screenRaw, code: screen },
  })) {
    test(`${name}: 걷어낸 알맹이가 원본보다 짧고, 셈의 대상은 남아 있다`, () => {
      assert.ok(code.length < raw.length, "이 파일에 주석이 없다면 아래 셈들은 뜻을 잃는다");
      assert.ok(code.includes("handleNodeDragStop"), "알맹이에서 끌기 손잡이까지 사라졌다면 걷기가 너무 많이 걷었다");
    });
  }

  test("🔴 주석 걷기가 **실제로 일한다** — ④절이 거기 기대고 있다는 증거", () => {
    // 🔴 2026-11-21(조각 B2′) — 전에는 이 자리가 「`selected:` 는 **주석에만** 있다」였다.
    //    그때는 ④절이 「칸에 안 싣는다」를 재고 있어서, 주석에 적힌 그 낱말을 안 걷으면
    //    셈이 통째로 뒤집혔기 때문이다. 이 조각이 [범위 선택]을 붙이면서 그 낱말은
    //    **코드가 됐다.** 그래서 걷기가 일한다는 증거를 **여전히 주석에만 있는 다른
    //    문장**으로 옮겨 적었다 — 지운 것이 아니다(지우면 ④절이 어느 날 주석만으로
    //    통과하기 시작해도 아무도 모른다).
    const commentOnly = "엔진이 함께 끌어 주는 열쇠가 이 한 줄이다";
    assert.ok(graphRaw.includes(commentOnly), "그림 원본에 그 문장이 없다면 아래 단언은 걷기와 무관하게 통과한다");
    assert.ok(!graph.includes(commentOnly), "걷어낸 뒤에도 남았다면 걷기가 일을 안 하고 있다");
    // 🔴 그리고 `selected:` 는 **알맹이 쪽에 남아 있어야** 한다 — ④절이 그것을 센다.
    assert.ok(/\bselected:\s/.test(graph), "걷기가 코드까지 걷어 갔다면 ④절이 공짜로 깨진다");
  });
});

// ────────────────────────────────────────────────────────────────────────────
// ② 그림(CaseFlowchartGraph) — 세 손잡이가 **움직이는 칸 전부**를 받는다
// ────────────────────────────────────────────────────────────────────────────
describe("🔴 ② 그림 — 움직이는 칸 전부를 받아 위로 들려 보낸다", () => {
  test("캔버스가 흘려주는 목록을 **세 손잡이 모두** 받는다", () => {
    for (const signature of [
      "function handleNodeDragStart(nodeId: string, position: Point, shiftKey: boolean, movingNodes: readonly CaseFlowchartNodeDragMove[]) {",
      "function handleNodeDrag(nodeId: string, position: Point, _shiftKey: boolean, movingNodes: readonly CaseFlowchartNodeDragMove[]) {",
      "function handleNodeDragStop(nodeId: string, position: Point, movingNodes: readonly CaseFlowchartNodeDragMove[]) {",
    ]) {
      assert.ok(graph.includes(signature), `이 모양이 아니다 — 받다 마는 손잡이가 있으면 거기서 목록이 끊긴다:\n${signature}`);
    }
  });

  test("🔴 받는 목록의 모양이 **캔버스가 주는 모양**과 같다 — 어긋나면 tsc 가 잡지만, 이름이 사라지는 쪽은 안 잡는다", () => {
    assert.ok(
      graph.includes("export type CaseFlowchartNodeDragMove = { nodeId: string; position: { x: number; y: number } };"),
      "이 집의 이름이 사라졌다 — 편집기가 React Flow 타입을 직접 물게 된다"
    );
    assert.ok(
      canvas.includes("export type GraphCanvasDragMove = { nodeId: string; position: { x: number; y: number } }"),
      "캔버스가 주는 모양이 바뀌었다 — 두 모양이 갈리면 이 집만 조용히 뒤처진다"
    );
    assert.ok(!graph.includes('from "@xyflow/system"'), "React Flow 의 속 타입을 끌고 오기 시작했다");
  });

  test("🔴 위로 올려보내는 모양에 목록이 실려 있다 — 칸 하나만 보내면 저장도 하나다", () => {
    assert.ok(
      flat(graph).includes("onNodeDragStop?: (nodeId: string, position: { x: number; y: number }, moves: readonly CaseFlowchartNodeDragMove[]) => void;"),
      "프롭이 아직 칸 하나와 자리 하나다"
    );
    assert.ok(graph.includes("onNodeDragStop?.(nodeId, finalPosition, finalMoves)"), "놓은 칸 전부를 안 들려 보낸다");
    assert.ok(!graph.includes("onNodeDragStop?.(nodeId, finalPosition)"), "칸 하나만 올려보내던 모양이 되살아났다");
  });

  test("🔴 축 잠금이 **복수용**으로 갈아탔다 — 끄는 동안에도, 놓는 순간에도", () => {
    const duringDrag = functionBody(graph, "function handleNodeDrag(");
    const onDrop = functionBody(graph, "function handleNodeDragStop(");
    assert.ok(duringDrag.includes("applyAxisLockToMoves(movingNodes, drag.startById, drag.axis)"), `끄는 동안 복수용을 안 쓴다:\n${duringDrag}`);
    assert.ok(onDrop.includes("applyAxisLockToMoves(movingNodes, drag.startById, lockedAxis)"), `놓는 순간 복수용을 안 쓴다:\n${onDrop}`);
    // 🔵 단수 applyAxisLock 은 **남아 있어야** 한다 — 목록에서 끄는 칸을 못 찾았을
    //    때 전에 쓰던 셈으로 떨어지는 마지막 받침이다.
    assert.ok(onDrop.includes("applyAxisLock(drag.start, position, lockedAxis)"), "마지막 받침(칸 하나짜리 셈)이 사라졌다");
    assert.ok(
      stripComments(read(PATHS.axisLock)).includes("export function applyAxisLockToMoves("),
      "부르고 있는 복수용 셈이 공용 모듈에서 사라졌다 — 여기 단언들이 가리킬 곳이 없어진다"
    );
  });

  test("🔴 축은 **끄는 칸 하나**로 정한다 — 칸마다 정하면 문턱 넘는 순간이 갈려 축이 섞인다", () => {
    const duringDrag = functionBody(graph, "function handleNodeDrag(");
    assert.equal(countOf(duringDrag, "resolveDragAxis("), 1, `축을 정하는 자리가 하나가 아니다:\n${duringDrag}`);
    assert.ok(duringDrag.includes("drag.axis = resolveDragAxis(drag.start, position);"), "끄는 칸의 시작·지금으로 안 정한다");
  });

  test("🔴 각 칸은 **제 시작 자리**를 받침으로 삼는다 — 끌기 시작에 한 번 거둔다", () => {
    const onStart = functionBody(graph, "function handleNodeDragStart(");
    assert.ok(
      onStart.includes("const startById = new Map<string, Point>(movingNodes.map((m) => [m.nodeId, { x: m.position.x, y: m.position.y }]));"),
      `움직이는 칸 전부의 시작 자리를 안 거둔다:\n${onStart}`
    );
    assert.ok(onStart.includes("startById.set(nodeId, position);"), "끄는 칸의 받침을 손잡이가 준 값으로 못 박지 않는다 — 전과 답이 달라질 수 있다");
  });

  test("🔴 끌고 있는 **동안에는 위로 아무것도 안 알린다** — 프레임마다 오는 자리다", () => {
    const duringDrag = functionBody(graph, "function handleNodeDrag(");
    assert.ok(!duringDrag.includes("onNodeDragStop?."), "드래그 중에 저장 손잡이를 부른다 — 되돌리기가 프레임마다 쌓인다");
    assert.ok(!duringDrag.includes("onNodeDragStart?."), "드래그 중에 시작 손잡이를 부른다 — 되돌리기가 프레임마다 쌓인다");
    // 프레임마다 하는 일은 **그림을 다시 꽂는 것** 하나뿐이다.
    assert.ok(duringDrag.includes("reactFlowInstanceRef.current?.setNodes("), "잠근 자리를 화면에 다시 꽂지 않는다 — Shift 로 끌어도 비스듬히 간다");
  });

  test("🔴 손짓 한 번에 콜백 한 번 — 고리 안에서 부르지 않는다", () => {
    for (const handler of ["onNodeDragStart?.(", "onNodeDragStop?.("]) {
      assert.equal(countOf(graph, handler), 1, `${handler} 를 부르는 자리가 하나가 아니다`);
    }
    const onStart = functionBody(graph, "function handleNodeDragStart(");
    const onDrop = functionBody(graph, "function handleNodeDragStop(");
    for (const [name, body] of [["drag-start", onStart], ["drag-stop", onDrop]] as const) {
      const callLine = body.split("\n").find((l) => /onNodeDrag(Start|Stop)\?\.\(/.test(l))!;
      assert.ok(!/\.(forEach|map)\s*\(/.test(callLine), `${name} 을 칸마다 돌면서 알린다: ${callLine.trim()}`);
      assert.ok(!/\bfor\s*\(|\.forEach\s*\(/.test(body), `${name} 안에 칸을 도는 고리가 생겼다:\n${body}`);
    }
  });
});

// ────────────────────────────────────────────────────────────────────────────
// ③ 편집기(CaseFlowchartEditorScreen) — 목록을 **돌며** 쌓고, 되돌리기는 한 번
// ────────────────────────────────────────────────────────────────────────────
describe("🔴 ③ 편집기 — 놓은 칸 전부가 저장 대기 지도에 들어간다", () => {
  test("drag-stop 이 목록을 **그대로** 흘려보낸다 — 끄는 칸 하나만 쓰지 않는다", () => {
    const body = functionBody(screen, "function handleNodeDragStop(");
    assert.ok(
      body.startsWith("function handleNodeDragStop(_nodeId: string, _position: Position, moves: readonly CaseFlowchartNodeDragMove[])"),
      `목록을 안 받는다:\n${body}`
    );
    assert.ok(body.includes("setPendingNodePositions(moves);"), `목록을 안 넘긴다:\n${body}`);
    assert.ok(!/setPendingNodePosition\(/.test(body), "칸 하나짜리 통로로 되돌아가 있다 — 그러면 하나만 저장된다");
    // 권한 관문과 끌기 깃발 내리기는 **전과 같은 자리**에 그대로 있어야 한다.
    assert.ok(body.includes("if (!canEdit) return;"), "볼 권한만 있는 사람에게도 저장 대기 칸이 생긴다");
    assert.ok(body.includes("isNodeDraggingRef.current = false;"), "끌기 깃발을 안 내린다 — 다음 버튼 조작이 되돌리기 단계를 안 찍는다");
  });

  test("🔴 저장 대기 지도에 **칸마다 한 줄**씩 들어간다", () => {
    const body = functionBody(screen, "function setPendingNodePositions(");
    assert.ok(body.includes("for (const move of moves) next.set(move.nodeId, move.position);"), `여러 칸을 안 적는다:\n${body}`);
    assert.ok(body.includes("const next = new Map(prev);"), "지도를 새로 안 만들고 고친다 — 다시 그리기가 안 돈다");
    assert.ok(body.includes("if (moves.length === 0) return;"), "빈 목록에도 되돌리기 단계를 찍는다 — [이전]이 헛도는 칸을 얻는다");
  });

  test("🔴 되돌리기를 **고리 밖에서 한 번만** 찍는다", () => {
    const body = functionBody(screen, "function setPendingNodePositions(");
    const pushAt = body.indexOf("pushPendingUndoStep()");
    const loopAt = body.indexOf("for (const move of moves)");
    assert.ok(pushAt >= 0, "되돌리기 단계를 아예 안 찍는다");
    assert.ok(loopAt >= 0, "칸 여럿을 적는 고리가 없다 — 이 단언이 가리킬 고리가 있어야 뜻이 선다");
    assert.ok(pushAt < loopAt, "되돌리기 단계를 고리 안에서 찍는다 — 칸 수만큼 쌓인다");
    assert.equal(countOf(body, "pushPendingUndoStep()"), 1, "되돌리기 단계를 두 번 이상 찍는다");
  });

  test("🔴 **끌고 있는 동안에는 안 찍는다** — 시작할 때 한 번 찍은 그 한 칸뿐이다", () => {
    const body = functionBody(screen, "function setPendingNodePositions(");
    assert.ok(body.includes("if (!isNodeDraggingRef.current) pushPendingUndoStep();"), "끌기 관문 없이 찍는다 — 한 번 끌 때마다 되돌리기가 쌓인다");
    const onStart = functionBody(screen, "function handleNodeDragStart(");
    assert.ok(onStart.includes("pushPendingUndoStep();"), "끌기 시작에 직전 상태를 안 찍는다 — [이전]이 끌기를 못 되돌린다");
    assert.ok(onStart.includes("isNodeDraggingRef.current = true;"), "끌기 깃발을 안 세운다 — 위 관문이 늘 열려 있게 된다");
  });

  test("🔵 칸 하나짜리 통로는 **남아 있고**, 제 손으로 지도를 고치지 않는다 — 셈이 두 벌이 되면 한쪽만 고치는 날이 온다", () => {
    const shell = functionBody(screen, "function setPendingNodePosition(nodeId: string, position: Position)");
    assert.ok(shell.includes("setPendingNodePositions([{ nodeId, position }]);"), `껍질이 여럿짜리 통로를 안 부른다:\n${shell}`);
    assert.ok(!shell.includes("setPendingNodePositionsById("), "껍질이 제 손으로 지도를 고친다 — 되돌리기 규칙이 두 벌이 된다");
    // 그 이름으로 부르던 **두 자리**가 살아 있어야 한다.
    assert.ok(screen.includes("setPendingNodePosition(targetNode.id, straightened.position);"), "「연결선 곧게 펴기」가 그 이름으로 부르던 자리가 사라졌다");
    assert.ok(
      flat(screen).includes("onPositionDraftChange={(position) => setPendingNodePosition(selectedNode.id, position)}"),
      "속성 패널의 「상대 위치로 이동」이 그 이름으로 부르던 자리가 사라졌다"
    );
  });

  test("🔴 저장하는 길은 **한 글자도 안 바뀌었다** — 지도 하나가 그대로 [저장]으로 나간다", () => {
    assert.ok(screen.includes("const [pendingNodePositionsById, setPendingNodePositionsById] = useState<Map<string, Position>>(new Map());"), "저장 대기 지도의 모양이 바뀌었다");
    assert.ok(screen.includes("const dirtyPositionNodeIds = computeDirtyPositionNodeIds(pendingNodePositionsById, nodesById);"), "더러움 판정이 그 지도를 안 본다");
    assert.ok(flat(screen).includes("nodePositions: pendingNodePositionsById,"), "되돌리기 스냅샷이 그 지도를 안 담는다");
  });
});

// ────────────────────────────────────────────────────────────────────────────
// ④ 🔴 여럿 고르기 — **B2′ 에서 실제로 들어왔다**(B1′ 때는 「아직 없음」을 재던 자리)
//
// 🔴 2026-11-21 — 이 절은 원래 「화면 동작이 전과 똑같은가」였다(B1′ 의 합격 기준).
//    그 자리에 「뒤 조각이 여럿 고르기를 붙이면 이 시험이 운다, 그때 **고쳐 적을**
//    시험이지 지울 시험이 아니다」라고 적혀 있었고, B2′ 가 바로 그 조각이다. 그래서
//    **단언을 반대 방향으로** 고쳐 적었다 — 지우면 「들어왔다 다시 빠져도」 아무도
//    모른다. 🔵 깊은 셈(도구 단추 · 좌표계 · 비우는 길)은 이웃
//    case-flowchart-box-selection-tool.test.ts 가 항목별로 잰다.
// ────────────────────────────────────────────────────────────────────────────
describe("🔴 ④ 여럿 고르기가 들어왔다 — 다만 **모드 안에서만**이다", () => {
  test("🔴 칸에 React Flow 의 선택 표시를 **싣는다** — 그것이 여럿이 함께 끌리는 열쇠다", () => {
    assert.ok(/\bselected:\s/.test(graph), "칸에 selected 를 안 싣는다 — 네모로 골라 놓고 끌면 하나만 움직인다");
    assert.ok(graph.includes("selected: isBoxSelected,"), `싣는 값이 [범위 선택]의 것이 아니다: ${/.*\bselected:.*/.exec(graph)?.[0]}`);
    // 🔴 **모드 안에서만** 참이어야 한다 — 모드를 벗어나도 참이면 [선택·이동] 으로
    //    돌아와 칸 하나를 끌었을 뿐인데 보이지 않는 짝들이 함께 끌린다.
    assert.ok(
      graph.includes("const isBoxSelected = boxSelectActive && boxSelectedNodeIds.has(n.id);"),
      "모드 관문 없이 고른 집합만 보고 있다"
    );
    assert.ok(graph.includes('const boxSelectActive = canUseBoxSelect && canvasTool === "BOX_SELECT";'), "모드 관문의 정의가 바뀌었다");
    // 🔵 `selectable` 은 전부터 있던 것이고 **선택 표시가 아니다**(고를 수 있는가).
    //    둘을 헷갈려 위 단언을 느슨하게 만들지 않도록 여기서 가른다.
    assert.ok(graph.includes("selectable: true,"), "고를 수 있는 성질까지 사라졌다 — 노드를 눌러 속성 패널을 여는 길이 끊긴다");
  });

  test("🔴 선택 상자(점선 네모)를 **넘긴다** — 다만 켜지는 것은 모드 안에서다", () => {
    assert.ok(
      flat(graph).includes("boxSelection={{ active: boxSelectActive, onSelect: handleBoxSelect }}"),
      "선택 상자를 안 넘긴다 — 빈 바탕을 끌어도 네모가 안 그려진다"
    );
    // 캔버스 쪽 전제가 그대로인지도 함께 본다 — 켜고 끄는 열쇠가 저 `active` 하나다.
    assert.ok(canvas.includes("const boxSelectActive = boxSelection?.active === true;"), "캔버스가 켜지는 조건이 바뀌었다");
    assert.ok(canvas.includes("panOnDrag={!boxSelectActive}"), "빈 바탕 끌기를 뺏어 오는 줄이 바뀌었다");
  });

  test("🔴 Shift 는 여전히 **축 잠금 전용**이다 — React Flow 제 선택 상자를 끈 그대로다", () => {
    assert.ok(graph.includes("selectionKeyCode={null}"), "Shift 가 다시 선택 상자로 넘어갔다 — Shift+끌기가 축 잠금이 아니게 된다");
  });

  test("🔵 끌 수 있는 조건도 전과 같다 — 볼 권한만 있으면 못 끈다", () => {
    assert.ok(graph.includes("nodesDraggable={editable}"), "끌 수 있는 조건이 바뀌었다");
    assert.ok(graph.includes("nodesConnectable={false}"), "그림에서 선을 긋는 길이 열렸다");
  });

  test("🔴 캔버스는 여전히 `onNodesChange` 를 안 붙인다 — 그래서 선택이 React Flow 안에 안 남는다(④의 첫 단언이 서는 근거)", () => {
    assert.ok(!canvas.includes("onNodesChange"), "캔버스가 선택 변화를 받기 시작했다면 「안 싣는다 = 하나만 끌린다」가 더는 참이 아니다");
  });
});
