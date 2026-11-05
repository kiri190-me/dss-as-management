import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

/**
 * ============================================================================
 * 노드 자리를 **중심점 기준**으로 (2026-11-05)
 * ============================================================================
 * 사용자 지시: 「노드의 대각선 꼭지점들을 가상의 선으로 잇고, 그 교차점을 그
 * 노드의 중심점으로 삼아서 정렬해」.
 *
 * 셈 자체는 순수 함수라 값으로 잰다 — src/lib/graph-editor-core/layout.test.ts
 * (중심 y · 깊이 0 의 가로 차례)와 src/lib/domain/procedure-auto-layout.test.ts.
 * **이 파일이 재는 것은 그 셈에 무엇을 먹이는가**다: 「상대 위치로 이동」과
 * 「선택한 노드 아래 추가」가 기준 노드의 자리를 **화면에 그려진 자리**로 읽는가.
 *
 * ── 🔴 왜 그것이 따로 재야 할 일인가 ────────────────────────────────────
 * 기술 작업 절차의 노드는 position_x/position_y 가 「만든 차례대로 쌓은 숫자」다
 * (개발 DB 실측: position_x 가 전부 0). 그래서 그림은 그 값을 안 쓰고 자동
 * 배치로 그린다. 두 패널은 **저장된 그 값**을 읽고 있었고, 브라우저 실측
 * (2026-11-05)으로 이렇게 어긋났다:
 *
 *   「A 의 아래」 — A 의 화면 x 는 −486 인데 대상이 x = 0 으로 갔다(486px).
 *                   다른 노드 위에 **완전히 포개졌다.**
 *   「A 의 오른쪽」 — 대상이 x = 272 로 갔다. 제대로라면 −214 다(758px).
 *   「선택한 노드 아래 추가」 — 화면 x = −346 인 B 를 골랐는데 새 노드가
 *                   B 의 **저장 좌표** (0, 150) 아래인 (−177.5, 300)에 꽂혔다.
 *
 * ── 왜 렌더가 아니라 원본을 읽는가 ──────────────────────────────────────
 * 이웃들(procedure-editor-field-steps-ui.test.ts 등)과 같은 사정이다: 그림은
 * @xyflow/react 의 .css 를, 패널들은 서버 액션을 물고 있어 import 자체가 던진다.
 *
 * ── 🔴 주석을 걷어내고 센다 ─────────────────────────────────────────────
 * 이 조각에서 늘어난 주석에 "renderedPositions"·"중심점"·"resolveEffectiveNodePosition"
 * 같은 글자가 잔뜩 들어 있다. 안 걷으면 「없어야 한다」 쪽이 영영 깨지고
 * 「있어야 한다」 쪽이 주석만으로 영영 통과한다. ①절이 걷어내기가 실제로 일을
 * 한다는 증거를 남긴다.
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

const PATHS = {
  graph: "src/components/procedures/ProcedureFlowGraph.tsx",
  editor: "src/components/procedures/ProcedureTemplateEditorScreen.tsx",
  nodePanel: "src/components/procedures/editor/NodePropertyPanel.tsx",
  createPanel: "src/components/procedures/editor/CreateNodePanel.tsx",
} as const;

const graph = stripComments(read(PATHS.graph));
const editor = stripComments(read(PATHS.editor));
const nodePanel = stripComments(read(PATHS.nodePanel));
const createPanel = stripComments(read(PATHS.createPanel));

describe("중심점 배치 — ① 먼저 표본 확인", () => {
  test("🔵 네 파일이 전부 읽혔고, 재려는 손잡이가 실제로 거기 있다", () => {
    for (const [name, source] of Object.entries({ graph, editor, nodePanel, createPanel })) {
      assert.ok(source.length > 500, `${name} 이 비어 있거나 너무 짧다 — 경로가 틀리면 아래 단언이 전부 공짜로 통과한다`);
    }
    assert.ok(graph.includes("export default function ProcedureFlowGraph({"), "그림 부품을 못 찾았다");
    assert.ok(editor.includes("<ProcedureFlowGraph"), "편집기가 정말 이 그림을 그려야 아래 단언에 뜻이 있다");
    assert.ok(editor.includes("<NodePropertyPanel"), "속성 패널을 그리는 자리를 못 찾았다");
    assert.ok(editor.includes("<CreateNodePanel"), "노드 추가 패널을 그리는 자리를 못 찾았다");
  });

  test("🔴 주석 걷어내기가 실제로 일을 한다 — 날것에는 코드에 없는 글자가 주석으로 적혀 있다", () => {
    assert.ok(read(PATHS.graph).includes("완전히 포개져"), "그림 주석에 이 고침의 까닭(실측)이 적혀 있어야 한다");
    assert.ok(!graph.includes("완전히 포개져"), "코드에는 그 문장이 없다 — 걷어내기가 일을 안 하고 있다");
    assert.ok(read(PATHS.nodePanel).includes("사실이 아니었다"), "속성 패널 주석이 옛 주석의 거짓을 밝혀야 한다");
    assert.ok(!nodePanel.includes("사실이 아니었다"));
  });
});

describe("중심점 배치 — 🔴 그림이 **제가 그린 자리**를 올려보낸다 (계산은 한 곳에만)", () => {
  test("🔴 자리를 고르는 삼항이 **함수 하나**이고, 그리는 쪽도 올려보내는 쪽도 그것만 부른다", () => {
    const f = flat(graph);
    // 자리를 고르는 규칙이 적힌 자리는 여기 하나다.
    assert.ok(
      f.includes('const resolveRenderedPosition = useCallback( (n: ProcedureFlowGraphNode): { x: number; y: number } => layoutMode === "STAGE_SORTED" ? (stageSortedLayout.positions.get(n.id) ?? { x: n.positionX, y: n.positionY }) : resolveBaselinePosition(n),'),
      "자리를 고르는 삼항을 못 찾았다"
    );
    // 🔴 그 삼항이 **두 번 적히면 안 된다.** 복제하면 「시험은 통과하는데 화면만
    //    어긋나는」 자리가 생긴다 — 그리기 쪽과 올려보내는 쪽이 조용히 갈린다.
    const occurrences = f.split('layoutMode === "STAGE_SORTED" ? (stageSortedLayout.positions.get(n.id)').length - 1;
    assert.equal(occurrences, 1, "자리를 고르는 규칙이 두 곳에 적혀 있다");
    // 그리는 쪽이 그 함수를 쓴다(세어 놓고 안 쓰면 아무것도 안 바뀐다).
    assert.ok(f.includes("const sourcePos = resolveRenderedPosition(n);"));
    // 올려보낼 지도도 같은 함수로 센다.
    assert.ok(f.includes("for (const n of nodeRows) map.set(n.id, resolveRenderedPosition(n));"));
  });

  test("🔴 **거르기 전 전체 노드**를 담는다 — 시트 거르기를 켜면 기준 노드가 사라지면 안 된다", () => {
    const f = flat(graph);
    assert.ok(f.includes("for (const n of nodeRows) map.set"), "filteredNodeRows 로 담으면 거르는 순간 기준 노드의 자리가 「모름」이 된다");
    assert.ok(!f.includes("for (const n of filteredNodeRows) map.set"));
  });

  test("🔴 **렌더 중이 아니라 effect 에서** 올려보낸다 — 받는 쪽이 state 라 끝없이 다시 그린다", () => {
    const f = flat(graph);
    assert.ok(f.includes("useEffect(() => { if (renderedPositionsByNodeId) onRenderedPositionsChange?.(renderedPositionsByNodeId); }, [renderedPositionsByNodeId, onRenderedPositionsChange]);"));
    // 지도의 신원이 안정돼야 effect 가 자리가 정말 바뀔 때만 돈다.
    assert.ok(f.includes("}, [onRenderedPositionsChange, nodeRows, resolveRenderedPosition]);"));
  });

  test("🔵 **안 받겠다고 한 화면에서는 지도를 아예 안 만든다** — 노드 400개짜리 절차가 쓰지도 않을 셈을 치르지 않는다", () => {
    const f = flat(graph);
    assert.ok(f.includes("if (!onRenderedPositionsChange) return null;"));
    assert.ok(f.includes("onRenderedPositionsChange?: (positions: ReadonlyMap<string, { x: number; y: number }>) => void;"), "선택형이 아니면 호출부 넷이 전부 바뀐다");
  });
});

describe("중심점 배치 — 🔴 편집기는 받아서 **그대로 넘긴다** (다시 세지 않는다)", () => {
  test("🔴 그림에서 받아 한 벌만 들고 있고, 두 패널에 **같은 것**을 넘긴다", () => {
    const f = flat(editor);
    assert.ok(f.includes("onRenderedPositionsChange={handleRenderedPositionsChange}"), "그림에서 받는 길이 없으면 지도가 영영 비어 있다");
    assert.ok(f.includes("const handleRenderedPositionsChange = useCallback((positions: ReadonlyMap<string, { x: number; y: number }>) => { setRenderedNodePositions(positions); }, []);"));
    // 🔴 콜백이 안정돼야 그림 쪽 effect 가 매 렌더 다시 돌지 않는다.
    assert.ok(f.includes("}, []);"), "useCallback 의 의존 목록이 비어 있어야 참조가 안정된다");
    const handed = f.split("renderedPositions={renderedNodePositions}").length - 1;
    assert.equal(handed, 2, "두 패널(속성 · 노드 추가)에 똑같이 넘어가야 한다");
  });

  test("🔴 편집기가 자리를 **다시 세지 않는다** — 자동 배치를 여기서 또 부르면 두 곳이 갈린다", () => {
    const f = flat(editor);
    assert.ok(!f.includes("computeProcedureAutoLayout"), "자동 배치를 편집기가 직접 부르면 그림과 입력이 글자 그대로 같은지 아무도 못 지킨다");
    assert.ok(!f.includes("computeLayeredGraphLayout"));
  });
});

describe("중심점 배치 — 🔴 「연결선 곧게 펴기」도 화면 자리를 쓴다", () => {
  test("🔴 두 끝의 자리를 **resolveCurrentPosition** 으로 읽는다 — workingLayoutPositions 가 아니라", () => {
    const f = flat(editor);
    assert.ok(f.includes("const sourcePos = resolveCurrentPosition(edge.fromNodeId); const targetPos = resolveCurrentPosition(edge.toNodeId);"));
    // 의존 목록에서도 빠져야 한다 — 남아 있으면 옛 지도가 아직 어딘가로 샌다.
    assert.ok(f.includes("[template.edges, renderedNodes, resolveCurrentPosition, pendingEdgeRouteMoves, savedEdgeRoutes, setPendingPosition, resolveNodeDimensions]"));
  });

  test("🔴 차례 셋을 **편집기가 직접 적지 않는다** — 값으로 시험할 수 있게 순수 함수에 둔다", () => {
    const f = flat(editor);
    assert.ok(
      f.includes("resolveCurrentRenderedNodePosition(nodeId, { pendingLayoutMoves, renderedPositions: renderedNodePositions, savedPositions: savedLayoutPositions, })"),
      "셈을 화면에 적으면 procedure-editor-save-state.test.ts 가 재는 것과 갈린다"
    );
    // 🔵 받침이 **끌기를 안 섞은** 지도여야 세 칸의 뜻이 안 겹친다(두 번 반영 의심이 안 생긴다).
    assert.ok(!f.includes("savedPositions: workingLayoutPositions"));
  });

  test("🔴 **거짓이 된 옛 주석이 지워졌다** — workingLayoutPositions 는 「CURRENT visible position」이 아니었다", () => {
    const raw = read(PATHS.editor);
    assert.ok(!raw.includes("the CURRENT visible\n   * position, including any unsaved drag) and resolveNodeDimensions"), "거짓인 주석이 그대로 남아 있다");
    assert.ok(raw.includes("사실이 아니었다"), "왜 거짓이었는지가 안 적혀 있으면 다음 사람이 같은 주석을 다시 적는다");
  });

  test("🔴 유령 받침만 **일부러** 옛 지도를 쓰고, 그 까닭이 적혀 있다 — 안 적으면 「빠뜨린 것」으로 보고 고쳐 고리를 만든다", () => {
    const f = flat(editor);
    // 받침은 그대로 workingLayoutPositions 다.
    assert.ok(f.includes("anchorPositions: workingLayoutPositions,"));
    const raw = read(PATHS.editor);
    assert.ok(raw.includes("「빠뜨린 것」으로 보고 고치지 마라"), "고치지 말라는 말이 없으면 다음 사람이 고리를 만든다");
    assert.ok(raw.includes("신원이 수렴하지 않아"), "왜 고리가 안 멈추는지(값이 아니라 신원)가 적혀 있어야 한다");
  });
});

describe("중심점 배치 — 🔴 「경로점 추가」도 같은 출처를 쓴다", () => {
  test("🔴 선의 양 끝을 **resolveCurrentPosition** 으로 읽는다 — 중점을 꽂는 셈이라 끝점이 거짓이면 보이는 선을 벗어난다", () => {
    const f = flat(editor);
    assert.ok(f.includes("const source = edge ? resolveCurrentPosition(edge.fromNodeId) : undefined; const target = edge ? resolveCurrentPosition(edge.toNodeId) : undefined;"));
    assert.ok(f.includes("[selectedEdgeId, template.edges, resolveCurrentPosition, savedEdgeRoutes, pushPendingUndoStep]"), "의존 목록에 옛 지도가 남아 있으면 아직 어딘가로 샌다");
  });

  test("🔴 자리를 읽는 곳이 **유령 받침 하나만** 남았다 — 그 하나는 일부러 남긴 것이고 글로 그렇게 적혀 있다", () => {
    const f = flat(editor);
    // 🔴 코드에서 `workingLayoutPositions` 를 **읽는** 자리를 센다. 만드는 줄
    //    (useMemo 의 왼쪽)과 의존 목록은 빼고, 실제로 값을 꺼내 쓰는 것만.
    const uses = [...f.matchAll(/workingLayoutPositions(?!\s*=)/g)].length;
    const inDeps = [...f.matchAll(/workingLayoutPositions,\s*nextFieldStepSortOrder/g)].length;
    const asAnchor = [...f.matchAll(/anchorPositions: workingLayoutPositions,/g)].length;
    assert.equal(asAnchor, 1, "유령 받침이 사라졌거나 둘이 됐다");
    assert.equal(
      uses - inDeps - asAnchor,
      0,
      "유령 받침 말고 workingLayoutPositions 를 읽는 곳이 또 생겼다 — 자리를 읽는 일이면 resolveCurrentPosition 쪽이 맞다"
    );
    // 🔵 「다 고쳤다」와 「하나는 일부러 뒀다」가 헷갈리지 않게, 만드는 자리에도 글로 남아 있어야 한다.
    const raw = read(PATHS.editor);
    assert.ok(raw.includes("여기에 쓰임을 새로 더하지 마라"), "다음 사람이 무심코 여기에 새 쓰임을 붙인다");
  });
});

describe("중심점 배치 — 🔴 「상대 위치로 이동」 (NodePropertyPanel)", () => {
  test("🔴 기준 노드의 자리를 **화면에 그려진 자리**로 읽는다 — 저장된 position_x/y 가 아니라", () => {
    const f = flat(nodePanel);
    assert.ok(
      f.includes("function currentPosition(n: EditorNodeRow): { x: number; y: number } { const rendered = renderedPositions?.get(n.id); if (rendered) return rendered;"),
      "그려진 자리를 먼저 보지 않으면 기술 작업 절차에서 「만든 차례대로 쌓은 숫자」를 읽는다"
    );
    // 🔵 받침은 전 동작 그대로 남아 있어야 한다 — 지우면 지도가 비어 있는 첫
    //    렌더에서 자리가 통째로 사라진다.
    assert.ok(f.includes('resolveEffectiveNodePosition({ positionX: n.positionX, positionY: n.positionY, userPositionX: n.userPositionX, userPositionY: n.userPositionY }, "USER");'));
  });

  test("🔴 **거짓이 된 옛 주석이 지워졌다** — 「Current visible position」은 사실이 아니었다", () => {
    // 날것으로 본다(주석을 재는 시험이므로).
    const raw = read(PATHS.nodePanel);
    // 🔴 그 말을 **주장으로** 들고 있던 옛 주석의 머리는 없어야 한다. 나중에
    //    그것을 믿는 사람이 「자리는 이미 맞으니 다른 데가 문제겠지」로 잘못 고친다.
    assert.ok(!raw.includes("/** Current visible position (5C-6D-1D)"), "거짓인 주석이 그대로 남아 있다");
    // 🔵 다만 **그 말이 틀렸다는 기록**은 남아야 한다 — 지우기만 하면 다음 사람이
    //    같은 주석을 선의로 다시 적는다.
    assert.ok(raw.includes("Current visible position") && raw.includes("사실이 아니었다"), "옛 주석이 왜 거짓이었는지가 안 적혀 있다");
  });

  test("🔵 기준 노드도 기둥 맞춤 후보도 **같은 함수**로 자리를 읽는다 — 하나만 고치면 그 둘이 갈린다", () => {
    const f = flat(nodePanel);
    assert.ok(f.includes("const refPos = currentPosition(reference);"));
    assert.ok(f.includes("const pos = currentPosition(n);"), "기둥 맞춤 후보가 다른 길로 자리를 읽으면 스냅이 엉뚱한 열에 붙는다");
  });

  test("🔵 네 방향 모두 중심점 셈을 쓴다 — computeCenterAlignedRelativePosition", () => {
    const f = flat(nodePanel);
    assert.ok(f.includes("const candidate = computeCenterAlignedRelativePosition("));
    assert.ok(!f.includes("computeRelativePosition("), "윗변 기준 셈이 남아 있으면 UP/DOWN 이 중심 간격을 안 쓴다");
  });
});

describe("중심점 배치 — 🔴 「선택한 노드 아래 추가」 (CreateNodePanel)", () => {
  test("🔴 중심점 셈으로 갈아탔다 — 높이가 다른 노드 아래에 붙여도 중심 간 간격이 눈금이다", () => {
    const f = flat(createPanel);
    assert.ok(f.includes('computeCenterAlignedRelativePosition( { ...selectedPosition, ...resolveNodeDimensions(selectedNode) }, "DOWN", BELOW_SELECTED_SPACING, { width: newNodeDimensions.width, height: newNodeDimensions.height } )'));
    assert.ok(!f.includes("computeRelativePosition("), "윗변 기준 셈이 남아 있으면 제목 줄 수가 다를 때 간격이 150 이 아니다");
    assert.ok(f.includes("computeCenterAlignedRelativePosition } from \"@/lib/graph-editor-core/layout\";"), "import 를 안 바꾸면 위 호출이 아예 안 컴파일된다");
  });

  test("🔴 기준 노드의 자리도 **화면에 그려진 자리**다 — 받침은 전과 같은 저장 좌표", () => {
    const f = flat(createPanel);
    assert.ok(f.includes("const selectedPosition = selectedNode ? renderedPositions?.get(selectedNode.id) ?? resolveEffectiveNodePosition("));
    assert.ok(f.includes("const position = selectedNode && selectedPosition ?"), "자리를 못 구했는데 셈을 돌리면 undefined 가 좌표로 들어간다");
  });

  test("🔵 고른 노드가 없으면 전처럼 자리를 아예 안 보낸다 — 서버의 기본 쌓기가 그대로 산다", () => {
    const f = flat(createPanel);
    assert.ok(f.includes(": null;"), "null 갈래가 없으면 선택이 없을 때도 자리를 억지로 만들게 된다");
    assert.ok(f.includes("createProcedureTemplateNodeAction({ templateId, nodeType, title, position, expectedTemplateUpdatedAt })"));
  });
});
