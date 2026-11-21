import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

/**
 * ============================================================================
 * 한 번 끌면 **고른 칸 전부**가 함께 저장된다 — 배선 (2026-11-21, 조각 B1)
 * ============================================================================
 * 쓰는 분 요청의 밑자락이다: 「[점선 네모] 아이콘을 누르면 드래그 혹은 클릭으로
 * 여러 노드를 골라 한 번에 이동」. 도구 단추와 선택 상자는 **다음 조각**이고,
 * 이 조각은 **그 밑에 깔린 길**만 넓힌다.
 *
 * ── 🔴 왜 이것을 따로 재야 하는가 ───────────────────────────────────────
 * 바탕인 React Flow 는 **여러 칸을 함께 끄는 것을 이미 한다**(@xyflow/system 의
 * `getDragItems`: `selected === true` 인 칸을 전부 끌 거리에 넣는다). 그리고
 * `onNodeDragStart`/`onNodeDrag`/`onNodeDragStop` 에 **세 번째 인자로 움직이는
 * 칸 전부**를 넘긴다(`OnNodeDrag = (event, node, nodes) => void`, v12.11.2 에서
 * 값으로 확인).
 *
 * 🔴 그런데 `GraphCanvas` 가 **그 세 번째 인자를 버리고 있었다.** 버린 채로
 * 선택 상자만 붙이면 「네모로 여럿 골랐고, 끄니까 전부 움직이는데, [저장]을
 * 누르면 하나만 옮겨져 있다」가 된다 — **오류가 안 나고 끌리는 모습도 멀쩡해서**
 * 아무도 못 알아챈다. 가장 조용히 지나칠 자리라 글자로 못 박는다.
 *
 * ── 왜 렌더가 아니라 원본 글자로 재는가 ─────────────────────────────────
 * 이웃들(procedure-editor-center-point-placement.test.ts 등)과 같은 사정이다:
 * 이 길은 **React Flow 가 실제로 마우스를 끌어야** 지나가는 자리라 이 저장소의
 * 시험 환경(브라우저 없음)에서는 손짓을 흉내 낼 수 없다. 셈 자체(축 잠금 ·
 * 네모 안에 든 칸 고르기)는 순수 함수라 값으로 잰다 —
 * src/lib/graph-editor-core/axis-lock.test.ts · box-selection.test.ts.
 * **이 파일이 재는 것은 그 셈에 무엇이 흘러 들어가는가**다.
 */

function read(path: string): string {
  return readFileSync(path, "utf8");
}

/**
 * 주석을 걷어낸 알맹이. 🔴 이 파일들에는 설명 주석이 많고, 그 안에
 * `onNodeDragStop`·`movingNodes` 같은 낱말이 **그대로 적혀 있다.** 원본 글자를
 * 그냥 세면 「코드에 있다」와 「주석에 있다」가 구별되지 않아 셈이 통째로
 * 뒤집힌다.
 */
function codeOf(path: string): string {
  return read(path)
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
}

const CANVAS = "src/components/graph-editor-core/GraphCanvas.tsx";
const PROCEDURE_GRAPH = "src/components/procedures/ProcedureFlowGraph.tsx";
const EDITOR = "src/components/procedures/ProcedureTemplateEditorScreen.tsx";
const CASE_GRAPH = "src/components/repair-cases/flowchart/CaseFlowchartGraph.tsx";

describe("🔵 먼저 — 주석 걷기가 실제로 뭔가를 걷어냈다(공짜 통과 막기)", () => {
  for (const path of [CANVAS, PROCEDURE_GRAPH, EDITOR, CASE_GRAPH]) {
    test(path, () => {
      const raw = read(path);
      const code = codeOf(path);
      assert.ok(code.length < raw.length, "이 파일에 주석이 없다면 아래 셈들은 뜻을 잃는다");
      assert.ok(code.includes("onNodeDrag"), "알맹이에서 끌기 손잡이까지 사라졌다면 걷기가 너무 많이 걷었다");
    });
  }
});

/**
 * 🔴 React Flow 가 주는 세 번째 인자를 **받아서 넘기는가.** 세 손잡이를
 * 하나하나 본다 — 전에는 셋 다 `(event, node)` 로 끊고 있었다.
 */
describe("🔴 GraphCanvas — 움직이는 칸 전부를 흘려보낸다", () => {
  const code = codeOf(CANVAS);

  for (const handler of ["onNodeDragStart", "onNodeDrag", "onNodeDragStop"]) {
    test(`${handler} 이 세 번째 인자를 받아서 위로 넘긴다`, () => {
      // JSX 속성 한 줄을 통째로 집는다. `={(` 로 시작하는 쪽이 <ReactFlow> 에
      // 넘기는 줄이고, `?:` 쪽은 프롭 선언이라 안 걸린다.
      const line = code.split("\n").find((l) => l.trim().startsWith(`${handler}={(`));
      assert.ok(line, `${handler} 을 <ReactFlow> 에 넘기는 줄이 없다`);
      const params = line.slice(line.indexOf("(") + 1, line.indexOf(")"));
      assert.equal(params.split(",").length, 3, `${handler} 이 인자를 셋 다 안 받는다(받은 것: ${params})`);
      assert.ok(
        /toDragMoves\(\s*node\s*,\s*nodes\s*\)/.test(line),
        `${handler} 이 움직이는 칸 목록을 안 넘긴다 — 여기서 버리면 여럿을 끌어도 하나만 저장된다: ${line.trim()}`
      );
    });
  }

  test("🔴 끄는 칸이 목록에 반드시 들어간다 — 빠지면 끌어 놓은 자리가 통째로 안 저장된다", () => {
    const fn = code.slice(code.indexOf("function toDragMoves"));
    const body = fn.slice(0, fn.indexOf("\n}"));
    assert.ok(body.includes("some((m) => m.nodeId === draggedNode.id)"), "끄는 칸이 들었는지 안 본다");
    assert.ok(body.includes("moves.push("), "안 들어 있을 때 넣어 주지 않는다");
  });

  test("🔵 React Flow 타입은 위로 안 나간다 — 올려보내는 모양은 {nodeId, position} 뿐이다", () => {
    assert.ok(code.includes("export type GraphCanvasDragMove = { nodeId: string; position: { x: number; y: number } }"));
  });
});

/**
 * 🔴 **[이전] 한 칸** — 끌기 한 번이 되돌리기 한 단계다. 칸마다 콜백을 부르는
 * 꼴로 고치면 되돌리기 스택이 칸 수만큼 쌓여, [이전]을 한 번 눌러도 안 돌아온다.
 */
describe("🔴 손짓 한 번에 콜백 한 번 — 칸 수와 무관하다", () => {
  test("ProcedureFlowGraph 의 drag-start 는 위로 **한 번만** 알린다", () => {
    const code = codeOf(PROCEDURE_GRAPH);
    const calls = code.match(/onNodeDragStart\?\.\(/g) ?? [];
    assert.equal(calls.length, 1, `drag-start 를 위로 알리는 자리가 ${calls.length} 곳이다 — 하나여야 한다`);
    const fn = code.slice(code.indexOf("function handleNodeDragStart"));
    const body = fn.slice(0, fn.indexOf("\n  }"));
    assert.ok(body.includes("onNodeDragStart?.(nodeId)"), "끄는 칸 하나만 올려보내는 모양이 아니다");
    // 🔴 그 한 번이 **고리 안**에 들어가면 셈은 그대로 1 이지만 실행은 칸 수만큼이다.
    const callLine = body.split("\n").find((l) => l.includes("onNodeDragStart?.("))!;
    assert.ok(!/\.(forEach|map)\s*\(|^\s*for\s*\(/.test(callLine), `칸마다 돌면서 알리고 있다: ${callLine.trim()}`);
    assert.ok(!/for\s*\(|\.forEach\s*\(/.test(body), `drag-start 안에 칸을 도는 고리가 생겼다: ${body}`);
  });

  test("ProcedureFlowGraph 의 drag-stop 도 위로 **한 번만** 알린다 — 목록을 통째로 들려 보낸다", () => {
    const code = codeOf(PROCEDURE_GRAPH);
    const calls = code.match(/onNodeDragStop\?\.\(/g) ?? [];
    assert.equal(calls.length, 1, `drag-stop 을 위로 알리는 자리가 ${calls.length} 곳이다 — 하나여야 한다`);
    assert.ok(code.includes("onNodeDragStop?.(nodeId, finalPosition, finalMoves)"), "놓은 칸 전부를 안 들려 보낸다");
  });

  test("🔴 편집기가 되돌리기 단계를 **고리 밖에서** 한 번만 찍는다", () => {
    const code = codeOf(EDITOR);
    const fn = code.slice(code.indexOf("const setPendingPositions = useCallback"));
    const body = fn.slice(0, fn.indexOf("\n  }, ["));
    const pushAt = body.indexOf("pushPendingUndoStep()");
    const loopAt = body.indexOf("for (const move of moves)");
    assert.ok(pushAt >= 0, "되돌리기 단계를 아예 안 찍는다");
    assert.ok(loopAt >= 0, "칸 여럿을 적는 고리가 없다");
    assert.ok(pushAt < loopAt, "되돌리기 단계를 고리 안에서 찍는다 — 칸 수만큼 쌓인다");
    assert.equal((body.match(/pushPendingUndoStep\(\)/g) ?? []).length, 1, "되돌리기 단계를 두 번 이상 찍는다");
    assert.ok(body.includes("if (!isNodeDraggingRef.current)"), "끌기 중에도 프레임마다 찍는 길이 열렸다");
  });
});

/**
 * 🔴 끝에서 `pendingLayoutMoves` 에 **여러 칸**이 들어가는가. 여기가 막히면
 * 앞을 아무리 넓혀도 저장은 하나다.
 */
describe("🔴 편집기 — 놓은 칸 전부가 저장 대기 칸에 들어간다", () => {
  const code = codeOf(EDITOR);

  test("drag-stop 이 목록을 그대로 흘려보낸다 — 끄는 칸 하나만 쓰지 않는다", () => {
    const fn = code.slice(code.indexOf("const handleNodeDragStop = useCallback"));
    const end = fn.indexOf("\n  );");
    assert.ok(end > 0, "handleNodeDragStop 의 끝을 못 찾았다 — 못 찾으면 아래 셈이 파일 전체를 보게 된다");
    const body = fn.slice(0, end);
    assert.ok(body.includes("setPendingPositions(moves)"), `목록을 안 넘긴다: ${body}`);
    assert.ok(!/setPendingPosition\(/.test(body), "칸 하나짜리 통로로 되돌아가 있다 — 그러면 하나만 저장된다");
  });

  test("저장 대기 지도에 칸마다 한 줄씩 들어간다", () => {
    const fn = code.slice(code.indexOf("const setPendingPositions = useCallback"));
    const body = fn.slice(0, fn.indexOf("\n  }, ["));
    assert.ok(body.includes("for (const move of moves) next.set(move.nodeId, move.position)"), `여러 칸을 안 적는다: ${body}`);
  });

  test("🔵 칸 하나짜리 통로는 **남아 있다** — 패널의 「상대 위치로 이동」·「연결선 곧게 펴기」가 그 이름으로 부른다", () => {
    assert.ok(code.includes("const setPendingPosition = useCallback"), "칸 하나짜리 통로가 사라졌다");
    assert.ok(code.includes("setPendingPositions([{ nodeId, position }])"), "껍질이 여럿짜리 통로를 안 부른다 — 셈이 두 벌이 된다");
    assert.ok(code.includes("onPositionDraftChange={(position) => setPendingPosition(selectedNode.id, position)}"), "패널이 그 이름으로 부르던 자리가 사라졌다");
  });
});

/**
 * 🔴 **[진단 Flowchart] 는 이 조각에서 안 건드린다.** 같은 `GraphCanvas` 를 쓰는
 * 두 번째 집이라, 캔버스를 고치면 저쪽이 조용히 같이 바뀔 수 있는 자리다.
 * 넓힌 인자는 **맨 뒤에 더했고** 저쪽 손잡이는 받지 않으므로 전과 똑같이 돈다.
 *
 * 🔵 다음 조각이 저쪽도 넓히면 아래 시험이 운다 — 그때 **고쳐야 하는 시험**이지
 * 지워야 하는 시험이 아니다. 「여기도 같이 넓혔다」로 고쳐 적으면 된다.
 */
describe("🔴 [진단 Flowchart] 는 이 조각에서 안 바뀐다", () => {
  const code = codeOf(CASE_GRAPH);

  test("세 손잡이를 **전과 같은 인자 수**로 받는다", () => {
    assert.ok(code.includes("function handleNodeDragStart(nodeId: string, position: Point, shiftKey: boolean) {"));
    assert.ok(code.includes("function handleNodeDrag(nodeId: string, position: Point) {"));
    assert.ok(code.includes("function handleNodeDragStop(nodeId: string, position: Point) {"));
  });

  test("위로 올려보내는 모양도 전과 같다 — 칸 하나와 자리 하나", () => {
    assert.ok(code.includes("onNodeDragStop?: (nodeId: string, position: { x: number; y: number }) => void;"));
    assert.ok(code.includes("onNodeDragStop?.(nodeId, finalPosition)"));
  });
});

/**
 * 🔴 **지금은 선택이 늘 하나다** — 이 조각이 화면 동작을 안 바꾼다는 근거다.
 *
 * React Flow 의 「함께 끌기」는 칸의 `selected` 가 참이어야 돈다. 이 저장소의
 * 두 그림은 **칸 목록을 통째로 제가 만들어 넘기고**(controlled) `onNodesChange`
 * 를 안 붙였다 — 그래서 React Flow 안에서 일어난 선택 변화는 `triggerNodeChanges`
 * 에서 **갈 곳이 없어 그대로 버려진다**(v12.11.2 의 store 에서 값으로 확인:
 * `hasDefaultNodes` 가 거짓이고 `onNodesChange` 가 없으면 아무 일도 안 한다).
 * 즉 오늘은 `selected` 가 참이 되는 길 자체가 없고, 움직이는 칸은 늘 하나다.
 *
 * 🔴 **다음 조각이 걸릴 자리가 바로 여기다**: 선택 상자를 붙이는 것만으로는
 * 안 되고, 그림이 만드는 칸에 `selected: …` 를 직접 실어야 엔진이 함께 끈다.
 */
describe("🔴 오늘 「선택이 하나뿐」인 까닭을 못 박는다", () => {
  test("두 그림 모두 onNodesChange 를 안 붙인다 — 선택 변화가 React Flow 안에 안 남는다", () => {
    assert.ok(!codeOf(CANVAS).includes("onNodesChange"), "캔버스가 선택 변화를 받기 시작했다면 위 전제가 깨진다");
  });

  test("두 그림 모두 칸에 selected 를 안 싣는다", () => {
    for (const path of [PROCEDURE_GRAPH, CASE_GRAPH]) {
      assert.ok(!/\bselected:\s/.test(codeOf(path)), `${path} 가 칸에 selected 를 싣기 시작했다 — 그 순간부터 여럿이 함께 끌린다`);
    }
  });
});
