import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

/**
 * 줄기 B-⑧ — 현장에서 더한 단계를 **희미하게** 보이고 「절차에 넣을까요?」 묻는다.
 *
 * ── 왜 렌더가 아니라 원본을 읽는가 ──────────────────────────────────────
 * 이웃들(procedure-editor-layout-mode.test.ts 등)과 같은 사정이다:
 * ProcedureFlowGraph/편집기 화면은 @xyflow/react 의 .css 와 서버 액션을 함께
 * 물고 있어 import 자체가 던진다.
 *
 * ── 🔴 주석을 걷어내고 센다 ─────────────────────────────────────────────
 * 이 저장소는 까닭을 그 자리 주석에 길게 적는다. 이 조각에서 늘어난 주석에는
 * "ghostNodes"·"모달"·"selectable" 같은 글자가 잔뜩 들어 있어서, 안 걷으면
 * 「없어야 한다」 쪽이 영영 깨지고 「있어야 한다」 쪽이 주석만으로 영영 통과한다.
 * ①절의 마지막 단언이 걷어내기가 실제로 일을 한다는 증거다.
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
  panel: "src/components/procedures/editor/FieldAddedStepsPanel.tsx",
  page: "src/app/(app)/procedures/[id]/edit/page.tsx",
  detail: "src/components/procedures/ProcedureTemplateDetailScreen.tsx",
  picker: "src/components/procedures/execution/ProcedureStartPickerGraph.tsx",
  executionSteps: "src/components/procedures/execution/ExecutionStepsGraph.tsx",
} as const;

const graph = stripComments(read(PATHS.graph));
const editor = stripComments(read(PATHS.editor));
const panel = stripComments(read(PATHS.panel));
const page = stripComments(read(PATHS.page));
const detail = stripComments(read(PATHS.detail));
const picker = stripComments(read(PATHS.picker));
const executionSteps = stripComments(read(PATHS.executionSteps));

describe("줄기 B-⑧ — ① 먼저 표본 확인", () => {
  test("🔵 일곱 파일이 전부 읽혔고, 재려는 손잡이가 실제로 거기 있다", () => {
    for (const [name, source] of Object.entries({ graph, editor, panel, page, detail, picker, executionSteps })) {
      assert.ok(source.length > 500, `${name} 이 비어 있거나 너무 짧다 — 경로가 틀리면 아래 단언이 전부 공짜로 통과한다`);
    }
    assert.ok(graph.includes("export default function ProcedureFlowGraph({"), "그림 부품을 못 찾았다");
    assert.ok(editor.includes("<ProcedureFlowGraph"), "편집기가 정말 이 그림을 그려야 아래 단언에 뜻이 있다");
    for (const source of [detail, picker, executionSteps]) {
      assert.ok(source.includes("<ProcedureFlowGraph"), "읽기 전용 셋도 같은 그림을 써야 「안 바뀐다」에 뜻이 있다");
    }
  });

  test("🔴 주석 걷어내기가 실제로 일을 한다 — 날것에는 코드에 없는 글자가 주석으로 적혀 있다", () => {
    assert.ok(read(PATHS.graph).includes("절차 전체가 흐려진다"), "그림 주석에 유령을 못 고르게 한 까닭이 적혀 있어야 한다");
    assert.ok(!graph.includes("절차 전체가 흐려진다"), "코드에는 그 문장이 없다 — 걷어내기가 일을 안 하고 있다");
    assert.ok(read(PATHS.panel).includes("두 번 묻는"), "패널 주석에 창을 안 띄우는 까닭이 적혀 있어야 한다");
    assert.ok(!panel.includes("두 번 묻는"));
  });
});

describe("줄기 B-⑧ — 그림: 유령은 **얹히기만** 한다", () => {
  test("🔴 두 프롭의 기본값이 null 이고 선택형이다 — 안 넘기는 화면 셋이 안 바뀌는 근거", () => {
    const f = flat(graph);
    assert.ok(f.includes("ghostNodes = null,"), "기본값이 없으면 안 넘긴 화면이 undefined 로 떨어져 가지마다 달리 읽힌다");
    assert.ok(f.includes("ghostEdges = null,"));
    assert.ok(f.includes("ghostNodes?: readonly ProcedureFlowGraphGhostNode[] | null;"), "필수가 되면 호출부 넷이 전부 바뀐다");
    assert.ok(f.includes("ghostEdges?: readonly ProcedureFlowGraphGhostEdge[] | null;"));
  });

  /**
   * ────────────────────────────────────────────────────────────────────────
   * 🔴 **뒤집힌 불변식** (2026-11-04, 사용자 결정 「A로 가자」)
   * ────────────────────────────────────────────────────────────────────────
   * 줄기 B-⑧ 은 여기서 「유령이 자리 계산 **셋 어디에도** 안 섞인다」를 지켰다.
   * 까닭은 「섞이면 자리 값 없는 기존 노드가 유령 때문에 움직인다」였고, 그
   * 전제가 틀렸다 — 움직이는 것은 유령 탓이 아니라 **노드가 하나 느는 것**
   * 자체여서, 유령을 빼 두면 같은 움직임이 「넣기」를 누른 뒤로 미뤄질 뿐이었다.
   * 게다가 유령만 저장 좌표계에 서서 미리 보기가 엉뚱한 자리였다.
   *
   * 지금의 불변식은 **「셋 가운데 자동 배치 하나에만 섞는다」**이다. 나머지 둘을
   * 그대로 둔 것은 게으름이 아니라 **채택도 그 둘을 안 바꾸기 때문**이다(채택이
   * 만드는 노드는 source_worksheet 가 null 이라 시트 띠에 한 줄도 안 보태고,
   * 단계별 정렬은 편집기에서 고를 수조차 없다). 그래서 이 시험의 두 쪽을 모두
   * 지켜야 「켠 그림 = 채택 뒤 그림」이 성립한다.
   *
   * 🔵 자리가 정말 같아지는지는 소스 글자가 아니라 **값으로** 잰다 —
   * src/lib/domain/procedure-auto-layout.test.ts.
   */
  test("🔴 유령은 **자동 배치에만** 섞인다 — 시트 띠·단계별 정렬은 진짜 절차만 본다", () => {
    const f = flat(graph);
    // 이 둘은 여전히 nodeRows/edgeRows 만 본다(= 진짜 절차만). 한 글자도 안 바뀌었다.
    assert.ok(f.includes("const { bands } = useMemo(() => groupNodesByWorksheet(nodeRows), [nodeRows]);"));
    assert.ok(f.includes("computeStageSortedLayout(nodeRows, edgeRows, worksheets)"));
    // 그 둘이 사는 구역에는 ghost 라는 글자가 **아예 없다**.
    const from = graph.indexOf("const { bands } = useMemo");
    const to = graph.indexOf("const layeredLayout = useMemo");
    assert.ok(from !== -1 && to > from, "구역을 못 잘랐다");
    assert.ok(flat(graph.slice(from, to)).includes("computeStageSortedLayout("), "표본 확인 — 구역이 비면 아래가 공짜로 통과한다");
    assert.ok(!graph.slice(from, to).includes("ghost"), "시트 띠·단계별 정렬에 유령이 들어오면 채택 뒤와 오히려 달라진다");
  });

  test("🔴 **자동 배치에는 유령을 함께 넘긴다** — 그래야 켠 그림이 채택 뒤와 같은 좌표가 된다", () => {
    const f = flat(graph);
    assert.ok(f.includes("useAutoLayoutForUnpositionedNodes ? computeProcedureAutoLayout({ nodes: nodeRows, edges: edgeRows,"));
    assert.ok(f.includes("ghostNodes: (ghostNodes ?? []).map(toAutoLayoutGhostNode), ghostEdges: ghostEdges ?? [],"));
    // 🔴 옮기는 규칙을 이 파일이 **직접 적지 않는다** — 시험과 화면이 같은 함수를
    //    써야 「시험은 통과하는데 화면만 어긋나는」 자리가 안 생긴다.
    assert.ok(!f.includes("pinnedX: g.hasUserPosition"), "옮기는 규칙이 여기 다시 적히면 두 곳이 조용히 갈린다");
    // 의존 목록에 빠지면 유령이 바뀌어도 자리가 안 다시 세어진다.
    assert.ok(f.includes("[useAutoLayoutForUnpositionedNodes, nodeRows, edgeRows, ghostNodes, ghostEdges]"));
  });

  test("🔴 유령의 **자리를 고르는 규칙이 진짜 노드와 같은 차례**다 — 사람이 정한 자리 → 자동 배치 → 받침", () => {
    const f = flat(graph);
    assert.ok(f.includes("if (ghost.hasUserPosition) return { x: ghost.x, y: ghost.y };"));
    assert.ok(f.includes("if (useAutoLayoutForUnpositionedNodes) return layeredLayout.get(ghost.id) ?? { x: ghost.x, y: ghost.y };"));
    assert.ok(f.includes("position: resolveGhostPosition(ghost),"), "세어 놓고 안 쓰면 유령은 그대로 저장 좌표에 선다");
    // 진짜 노드 쪽의 같은 차례(resolveBaselinePosition)도 그대로 있어야 짝이 맞는다.
    assert.ok(f.includes("if (useAutoLayoutForUnpositionedNodes) return layeredLayout.get(n.id) ?? { x: n.positionX, y: n.positionY + bandOffsetY };"));
  });

  test("🔴 유령 칸은 **고를 수도 끌 수도 이을 수도 없다** — 고르면 절차 전체가 흐려진다", () => {
    const f = flat(graph);
    assert.ok(f.includes("for (const ghost of ghostNodes ?? []) {"), "유령을 얹는 자리를 못 찾았다");
    assert.ok(f.includes("id: ghost.id, type: \"procedureNode\", position: resolveGhostPosition(ghost), selectable: false, draggable: false, connectable: false,"));
    assert.ok(f.includes("isGhost: true,"));
    // 진짜 노드는 그 반대다 — 둘이 같은 값이면 위 단언이 뜻을 잃는다.
    assert.ok(f.includes("isGhost: false,"), "진짜 노드 쪽 깃발이 없으면 유령 판정이 모든 칸에 걸린다");
  });

  test("🔴 **희미하게** 그려진다 — 반투명 + 점선 테두리", () => {
    const f = flat(graph);
    assert.ok(f.includes('className={data.isGhost ? "relative opacity-50" : "relative"}'), "흐리기가 없으면 「희미하게」가 아니다");
    assert.ok(f.includes('style={data.isGhost ? GHOST_NODE_OUTLINE_STYLE : undefined}'));
    assert.ok(f.includes('const GHOST_NODE_OUTLINE_STYLE = { outline: "2px dashed #a1a1aa", outlineOffset: 3, borderRadius: 8 }'), "색 이름 대신 값으로 박아야 사이트마다 달리 풀리지 않는다");
    // 선도 같은 말을 해야 한다.
    assert.ok(f.includes('strokeDasharray: "4 4", opacity: 0.5'), "유령 선이 실선이면 진짜 연결로 읽힌다");
  });

  test("🔴 유령이 하나도 없으면 **간선 배열의 신원까지 그대로**다 — 셋이 안 바뀐다는 가장 센 근거", () => {
    const f = flat(graph);
    assert.ok(f.includes("ghostFlowEdges.length === 0 ? flowEdges : [...flowEdges, ...ghostFlowEdges]"));
    assert.ok(f.includes("edges={flowEdgesWithGhosts}"), "만들어 놓고 안 넘기면 아무것도 안 바뀐다");
    assert.ok(f.includes("if (!ghostEdges || ghostEdges.length === 0) return [];"), "빈 배열을 새로 만들면 매 렌더마다 신원이 바뀐다");
  });

  test("🔴 양끝이 그림에 **둘 다** 있는 선만 그린다 — 한쪽 끝이 없으면 콘솔 경고로만 남는다", () => {
    const f = flat(graph);
    assert.ok(f.includes("const drawableIds = new Set<string>([...filteredNodeRows.map((n) => n.id), ...(ghostNodes ?? []).map((g) => g.id)]);"));
    assert.ok(f.includes(".filter((e) => drawableIds.has(e.fromNodeId) && drawableIds.has(e.toNodeId))"));
  });
});

describe("줄기 B-⑧ — 🟢 나머지 화면 셋은 글자 하나 안 바뀌었다", () => {
  test("🔴 셋 다 ghostNodes·ghostEdges 를 안 넘긴다", () => {
    for (const [name, source] of Object.entries({ detail, picker, executionSteps })) {
      assert.ok(!source.includes("ghostNodes"), `${name} 이 유령 칸을 넘기기 시작했다`);
      assert.ok(!source.includes("ghostEdges"), `${name} 이 유령 선을 넘기기 시작했다`);
    }
  });

  test("🔵 넘기는 곳은 **편집기 하나**다", () => {
    assert.ok(flat(editor).includes("ghostNodes={fieldStepGhostGraph.nodes} ghostEdges={fieldStepGhostGraph.edges}"));
  });
});

describe("줄기 B-⑧ — 편집기: 유령은 그림에만, 저장·검증에는 안 들어간다", () => {
  test("🔴 renderedNodes/renderedEdges 에 유령을 **안 섞는다** — 섞으면 [저장]이 없는 노드를 저장하려 든다", () => {
    const f = flat(editor);
    // 그림에 넘기는 두 목록이 **그 둘 그대로**다 — 유령을 펼쳐 넣지 않았다.
    assert.ok(f.includes("nodes={renderedNodes} edges={renderedEdges}"), "두 목록에 무언가를 보태면 저장·검증·비교가 함께 그것을 본다");
    const from = editor.indexOf("const renderedNodes: EditorNodeRow[] = useMemo(");
    const to = editor.indexOf("const fieldStepGhostGraph = useMemo(");
    assert.ok(from !== -1 && to > from, "구역을 못 잘랐다");
    const renderedBlock = editor.slice(from, to);
    assert.ok(renderedBlock.includes("template.edges.map((e) => {"), "표본 확인 — 구역이 비어 있으면 아래가 공짜로 통과한다");
    assert.ok(!renderedBlock.includes("fieldStep"), "그려지는 목록과 저장되는 목록이 같아지면 안 된다");
  });

  test("🔵 유령의 **받침 자리**는 지금 그려지고 있는 자리를 기준으로 센다", () => {
    const f = flat(editor);
    assert.ok(
      f.includes("buildFieldStepGhostGraph({ steps: fieldAddedSteps, anchorPositions: workingLayoutPositions, nextSortOrder: nextFieldStepSortOrder, })"),
      "저장된 자리만 보면 끌고 있는 노드 옆에서 유령이 떨어진다"
    );
    // 🔴 번호는 **채택이 줄 값**(이 초안 최댓값 + 1)이어야 한다 — 자동 배치에서
    //    뿌리의 가로 차례를 이 번호가 정한다(procedure-auto-layout.test.ts 가 값으로 잰다).
    assert.ok(f.includes("renderedNodes.reduce((max, n) => (n.sortOrder > max ? n.sortOrder : max), -1) + 1"));
  });

  test("🔴 넣은 뒤에는 **구조 변경 통로**로 간다 — 아니면 [이전]이 이 걸음을 건너뛴다", () => {
    assert.ok(flat(editor).includes("onAdopted={handleStructuralSaved}"));
  });
});

describe("줄기 B-⑧ — 탭: 할 일이 있을 때만 서고, 숫자는 **안 넣은 것**만 센다", () => {
  test("🔴 현장에서 더한 것이 하나도 없으면 탭 자체가 안 선다", () => {
    assert.ok(flat(editor).includes('...(fieldAddedSteps.length > 0 ? (["fieldSteps"] as const) : []),'));
  });

  test("🔴 딱지의 숫자는 pending 만 센다 — 다 넣고 나면 숫자가 사라져야 한다", () => {
    const f = flat(editor);
    assert.ok(f.includes("const pendingFieldStepCount = useMemo(() => pendingFieldSteps(fieldAddedSteps).length, [fieldAddedSteps]);"));
    assert.ok(f.includes("`현장 단계${pendingFieldStepCount > 0 ? ` ${pendingFieldStepCount}` : \"\"}`"));
    // 전체 수로 세면 「이미 넣은 것」까지 할 일처럼 보인다.
    assert.ok(!f.includes("현장 단계 ${fieldAddedSteps.length}"), "전체 수로 세면 다 처리한 뒤에도 딱지가 안 사라진다");
  });

  test("🔴 기본으로 열리는 탭은 **여전히 속성/검증**이다 — 현장 단계가 끼어들면 그것이 곧 「묻는」 것이다", () => {
    assert.ok(
      flat(editor).includes('useState<RightPanelTab>(navigationTarget.nodeId ? "properties" : "validation")'),
      "기본 탭이 바뀌면 편집기를 열 때마다 현장 단계가 가로막는다"
    );
  });
});

describe("줄기 B-⑧ — 패널: 창으로 안 띄운다 · id 둘만 보낸다", () => {
  test("🔴 **창(모달)이 아니다** — 「안 넣기로 했다」를 기억하지 않으므로 열 때마다 가로막게 된다", () => {
    assert.ok(!panel.includes("window.confirm"), "확인 창을 띄우면 열 때마다 같은 질문이 가로막는다");
    assert.ok(!panel.includes("<dialog"));
    assert.ok(!panel.includes('role="dialog"'));
    assert.ok(!panel.includes("fixed inset-0"), "덮개를 깔면 그것이 곧 창이다");
    assert.ok(!panel.includes("useEffect"), "뜨자마자 무엇을 여는 길이 아예 없어야 한다");
  });

  test("🔵 「이미 넣은 것」은 **접혀** 있다 — 할 일이 아니지만 확인할 길은 남긴다", () => {
    const f = flat(panel);
    assert.ok(f.includes("const [showAdopted, setShowAdopted] = useState(false);"), "처음부터 펴져 있으면 할 일 목록이 길어진다");
    assert.ok(f.includes("이미 넣은 단계 {adopted.length}개"));
    assert.ok(f.includes("aria-expanded={showAdopted}"));
  });

  test("🔴 서버로 보내는 것은 **id 둘과 토큰뿐**이다 — 제목·갈래·자리를 안 보낸다", () => {
    const f = flat(panel);
    assert.ok(
      f.includes("await adoptFieldAddedStepAction({ templateId, executionNodeId: step.executionNodeId, expectedTemplateUpdatedAt, });"),
      "보내는 모양이 바뀌었다"
    );
    assert.ok(!f.includes("title: step.title"), "제목을 보내면 「현장이 적은 것」이 아니라 「화면에서 고쳐 보낸 것」이 절차에 들어간다");
    assert.ok(!f.includes("nodeType: step.nodeType"));
  });

  test("🔴 돌고 있는 동안 **둘째 누르기를 막는다** — 이 저장소에서 실제로 났던 결함이다", () => {
    const f = flat(panel);
    assert.ok(f.includes("if (adoptingId !== null) return;"));
    assert.ok(f.includes("disabled={adoptingId !== null}"));
  });

  test("🔴 **못 그은 연결 수를 사람에게 말한다** — 안 말하면 「연결도 올 줄 알았는데」가 된다", () => {
    const f = flat(panel);
    assert.ok(f.includes("result.skippedEdgeCount > 0"));
    assert.ok(f.includes("이 초안에 상대가 없어 못 그었습니다"));
  });

  test("🔵 고객 이름이 아니라 **접수 번호**만 적는다 — 절차를 고치는 자리다", () => {
    assert.ok(flat(panel).includes("{step.intakeNumber ? `${step.intakeNumber} · ` : \"\"}"));
    assert.ok(!panel.includes("customerName"), "고객 이름이 절차 편집기에 들어오면 안 된다");
  });

  test("🔴 권한 프롭에 **기본값이 없다** — 넘기는 것을 잊으면 컴파일이 멈춘다", () => {
    assert.ok(!flat(panel).includes("canEdit = false"), "기본값을 두면 잊었을 때 조용히 지나간다");
    assert.ok(flat(panel).includes("canEdit: boolean;"));
    // 편집기는 노드 추가와 **같은 관문**을 넘긴다.
    assert.ok(flat(editor).includes("steps={fieldAddedSteps} canEdit={canDeleteGraph}"));
  });
});

/**
 * ────────────────────────────────────────────────────────────────────────────
 * 뒷정리(2026-11-04) — 「현장 단계」를 그림에서 **한 번에 끄고 켜기**
 * ────────────────────────────────────────────────────────────────────────────
 * 사용자 요청: 「편집기에서 [현장 단계]를 모두 비가시 처리할 수 있는 기능을
 * 넣어줘」. 🔴 끄는 것은 **그림의 유령**이지 「현장 단계가 있다는 사실」이 아니다 —
 * 탭 · 딱지 숫자 · [절차에 넣기] 는 꺼도 그대로여야 한다. 아래 넷이 그것을 지킨다.
 */
const ghostVisibilityHook = stripComments(read("src/components/procedures/editor/use-field-step-ghost-visibility.ts"));

describe("줄기 B-⑧ 뒷정리 — 끄기: 그림에서만 사라진다", () => {
  test("🔵 표본 확인 — 끄고 켠 상태를 들고 있는 파일이 실제로 읽혔다", () => {
    assert.ok(ghostVisibilityHook.length > 300, "경로가 틀리면 아래 단언이 전부 공짜로 통과한다");
    assert.ok(ghostVisibilityHook.includes("export function useFieldStepGhostVisibility()"));
  });

  test("🔴 **그림 부품은 끄고 켠 상태를 모른다** — 알기 시작하면 나머지 셋도 그 프롭을 받는다", () => {
    assert.ok(!graph.includes("ghostsVisible"), "그림 부품이 이 상태를 알기 시작하면 나머지 셋도 그 프롭을 받는다");
    assert.ok(!graph.includes("현장 단계 표시"), "체크표시는 [현장 단계] 패널에 있다(2026-11-04) — 그림 부품이 아니다");
    assert.ok(!graph.includes("localStorage"), "보기 상태를 그림이 기억하면 네 화면이 서로의 설정을 본다");
    // 끄고 켜는 일은 **넘길 것을 비우는** 것으로 끝난다(그림은 null/빈 목록을 이미 안다).
    assert.ok(flat(editor).includes("ghostNodes={fieldStepGhostGraph.nodes} ghostEdges={fieldStepGhostGraph.edges}"));
  });

  test("🔴 끄면 그림에 넘기는 것이 **빈 한 벌**이다 — 매번 새 빈 배열이면 「전과 똑같다」 보증이 깨진다", () => {
    const f = flat(editor);
    assert.ok(
      f.includes(
        "ghostsVisible ? buildFieldStepGhostGraph({ steps: fieldAddedSteps, anchorPositions: workingLayoutPositions, nextSortOrder: nextFieldStepSortOrder, }) : EMPTY_FIELD_STEP_GHOST_GRAPH"
      ),
      "끄는 길이 없거나, 끌 때 새 빈 배열을 만들고 있다"
    );
    assert.ok(f.includes("[ghostsVisible, fieldAddedSteps, workingLayoutPositions, nextFieldStepSortOrder]"), "의존 목록에 빠지면 꺼도 그림이 안 바뀐다");
  });

  test("🔴 꺼도 **탭과 딱지 숫자는 그대로**다 — 꺼 둔 사람이 새 현장 단계를 영영 모르면 안 된다", () => {
    const f = flat(editor);
    // 탭이 서는 조건도, 딱지가 세는 것도 이 설정을 **안 본다**.
    assert.ok(f.includes('...(fieldAddedSteps.length > 0 ? (["fieldSteps"] as const) : []),'));
    assert.ok(f.includes("const pendingFieldStepCount = useMemo(() => pendingFieldSteps(fieldAddedSteps).length, [fieldAddedSteps]);"));
    assert.ok(!f.includes("ghostsVisible && fieldAddedSteps.length > 0"), "탭까지 함께 숨기면 알림이 사라진다");
    assert.ok(!f.includes("ghostsVisible ? pendingFieldStepCount"), "딱지가 설정을 따라가면 끈 사람의 숫자가 0 이 된다");
  });

  /**
   * ────────────────────────────────────────────────────────────────────────
   * 🔴 **자리가 바뀐 스위치** (2026-11-04, 사용자 결정)
   * ────────────────────────────────────────────────────────────────────────
   * 「기능은 좋은데 [현장단계]안에 체크표시가 있도록 해줘. 설명은 필요없다.」
   * 처음에는 **그림 바로 위**에 긴 설명 한 줄과 함께 서 있었고, 그 자리를 고른
   * 까닭도 적혀 있었다(「끄면 그림만 달라지는데 그 까닭을 보려면 탭을 열어야 하는
   * 단추가 된다」). 사용자 결정이 그것을 덮었다 — 판단이 뒤집힌 기록은 편집기
   * 주석에 그대로 남겨 두었고, 아래가 바뀐 자리를 지킨다.
   */
  test("🔴 체크표시는 **[현장 단계] 탭 패널 안**에 있다 — 끌 유령이 있을 때만 선다", () => {
    const f = flat(panel);
    assert.ok(f.includes("{pending.length > 0 && ( <label"), "다 넣고 나면 끌 것이 없다 — 그때 남은 스위치는 사람을 헷갈리게 한다");
    assert.ok(f.includes('<input type="checkbox" checked={ghostsVisible} onChange={(e) => onGhostsVisibleChange(e.target.checked)}'));
    assert.ok(f.includes("현장 단계 표시"));
    // 🔴 상태는 패널이 들고 있지 않다 — 그림에 무엇을 넘길지 정하는 쪽과 같은 값을
    //    봐야 한다(그리고 끈 상태는 이 브라우저에 남는다).
    assert.ok(!f.includes("useState(ghostsVisible"), "패널이 제 사본을 들면 그림과 어긋난다");
    assert.ok(f.includes("onGhostsVisibleChange: (visible: boolean) => void;"));
    assert.ok(flat(editor).includes("ghostsVisible={ghostsVisible} onGhostsVisibleChange={setGhostsVisible}"));
  });

  test("🔴 **그림 위에는 체크표시가 없다** — 옮긴 것이지 하나 더 만든 것이 아니다", () => {
    const f = flat(editor);
    assert.ok(f.includes("<ProcedureFlowGraph"), "표본 확인");
    assert.ok(!f.includes('<input type="checkbox" checked={ghostsVisible}'), "두 곳에 서면 하나만 눌러도 다른 쪽이 안 따라오는 것처럼 보인다");
    assert.ok(!f.includes("setGhostsVisible(e.target.checked)"), "편집기가 직접 켜고 끄는 자리가 남아 있다");
  });

  test("🔴 체크표시 옆의 **긴 설명이 없다** — 사용자가 「설명은 필요없다」고 했다", () => {
    const f = flat(panel);
    // 표본 확인 — 체크표시 자체는 있어야 「설명이 없다」가 뜻을 가진다.
    assert.ok(f.includes("현장 단계 표시"));
    assert.ok(!f.includes("희미한 점선으로 겹쳐 그립니다"), "옛 설명이 패널로 따라왔다");
    assert.ok(!flat(editor).includes("희미한 점선으로 겹쳐 그립니다"), "그림 위의 옛 설명이 남아 있다");
    assert.ok(!f.includes("꺼도 [현장 단계] 탭에서"), "탭 안에서 탭을 가리키는 안내는 뜻이 없다");
  });

  test("🔴 꺼도 **[절차에 넣기]는 그대로** 눌린다 — 숨기는 것은 그림이지 할 일이 아니다", () => {
    const from = panel.indexOf("{pending.length === 0 ?");
    const to = panel.indexOf("{adopted.length > 0 &&");
    assert.ok(from !== -1 && to > from, "구역을 못 잘랐다");
    const pendingBlock = panel.slice(from, to);
    assert.ok(pendingBlock.includes("void handleAdopt(step)"), "표본 확인 — 구역에 넣는 단추가 있어야 아래가 뜻을 가진다");
    assert.ok(!pendingBlock.includes("ghostsVisible"), "넣는 단추가 보기 설정을 보면 꺼 둔 사람은 넣을 수 없다");
  });

  test("🔴 패널의 안내가 **상태 둘을 갈라** 말한다 — 꺼 둔 사람에게 「그려집니다」는 거짓말이다", () => {
    const f = flat(panel);
    assert.ok(f.includes("ghostsVisible ? \"그림에 희미한 점선으로 그려집니다.\""));
    assert.ok(f.includes("지금은 그림에서 숨겨 두었습니다"));
    assert.ok(f.includes("ghostsVisible: boolean;"), "기본값을 두면 넘기는 것을 잊었을 때 조용히 「그려집니다」가 된다");
    assert.ok(flat(editor).includes("canEdit={canDeleteGraph} ghostsVisible={ghostsVisible}"));
  });

  test("🔴 기억하는 곳은 **이 브라우저**뿐이다 — 서버로도 DB 로도 안 간다", () => {
    const f = flat(ghostVisibilityHook);
    assert.ok(f.includes("window.localStorage"));
    assert.ok(f.includes("useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)"), "효과에서 읽으면 꺼 둔 사람 화면에 유령이 한 프레임 스친다");
    assert.ok(f.includes("function getServerSnapshot(): boolean { return true; }"), "서버 몫이 보임이 아니면 hydration 이 어긋난다");
    assert.ok(!f.includes("Action("), "서버 액션을 부르면 보기 설정이 남의 화면까지 끈다");
    assert.ok(!f.includes("fetch("));
    // 저장소에 손대는 것 자체가 던지는 브라우저가 있다.
    assert.ok(f.includes("try {") && f.includes("catch {"), "감싸지 않으면 사생활 보호 창에서 편집기가 통째로 죽는다");
  });
});

describe("줄기 B-⑧ — 페이지: 서버에서 읽어 넘긴다", () => {
  test("🔴 세 조회를 함께 받고, 그중 하나가 현장 단계다", () => {
    const f = flat(page);
    assert.ok(f.includes("const [historyView, comparison, fieldAddedSteps] = await Promise.all(["));
    assert.ok(f.includes("getFieldAddedStepsForDraft(template.id),"));
    assert.ok(f.includes("fieldAddedSteps={fieldAddedSteps}"), "읽어 놓고 안 넘기면 탭이 영영 안 선다");
  });
});
