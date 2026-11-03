import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import ExecutionTaskEditorPanel from "./ExecutionTaskEditorPanel";
import {
  buildCaseEditEdgeRows,
  TEMPLATE_EDGE_NOT_REMOVABLE_MESSAGE,
  TEMPLATE_NODE_NOT_REMOVABLE_MESSAGE,
  PICK_NODE_TO_REMOVE_MESSAGE,
  type CaseEditEdge,
  type CaseEditNode,
} from "@/lib/domain/procedure-execution-case-edit";

/**
 * 「추가 작업 등록」 창의 **속**이 실제로 무엇을 그리는가(2026-11-03, 조각 13).
 *
 * 이웃 execution-steps-panel.test.tsx 와 같은 방법 — 이 묶음은 서버 액션도 DB
 * 조회 타입도 안 물게 적었으므로 **그려서** 잰다. 플로우차트는 @xyflow/react 의
 * .css 를 끌고 와서 여기서 import 가 던지므로 `graphSlot` 으로 바깥에서 받고,
 * 이 시험은 그 자리에 가짜를 넣는다.
 *
 * 🔴 창을 여닫고 서버를 부르는 쪽(ExecutionExtraTaskDialog)은 서버 액션을 직접
 * import 하는 클라이언트 부품이라 여기서 못 부른다 — 그쪽의 불변식은 원본
 * 글자로 확인한다(아래 마지막 묶음).
 */

function templateNode(n: number, extra: Partial<CaseEditNode> = {}): CaseEditNode {
  return { id: `e${n}`, graphNodeId: `t${n}`, orderIndex: n, title: `작업 ${n}`, isAddedInCase: false, version: 1, ...extra };
}

const ADDED: CaseEditNode = {
  id: "x9",
  graphNodeId: "x9",
  orderIndex: 4,
  title: "추가 세척",
  isAddedInCase: true,
  version: 1,
};

const NODES: CaseEditNode[] = [templateNode(1, { title: "MCU 기판 교환" }), templateNode(2), templateNode(3), ADDED];

const EDGES: CaseEditEdge[] = [
  { id: "e-t1-t2", fromNodeId: "t1", toNodeId: "t2", branchType: "DEFAULT", branchLabel: null, isAddedInCase: false },
  { id: "x-t2-x9", fromNodeId: "t2", toNodeId: "x9", branchType: "NG", branchLabel: null, isAddedInCase: true },
];

const GRAPH_SLOT = <div data-fake-graph>플로우차트가 서는 자리</div>;

function render(
  options: {
    selectedNode?: CaseEditNode | null;
    selectedEdgeId?: string | null;
    /** 🔵 2026-11-03(조각 14) — 「지도에서 대상 고르기」가 켜져 있는가. */
    isPickingEdgeTarget?: boolean;
    edgeTargetNodeId?: string | null;
  } = {}
): string {
  return renderToStaticMarkup(
    <ExecutionTaskEditorPanel
      nodes={NODES}
      edgeRows={buildCaseEditEdgeRows({ nodes: NODES, edges: EDGES })}
      graphSlot={GRAPH_SLOT}
      selectedNode={options.selectedNode ?? null}
      onSelectNode={() => {}}
      selectedEdgeId={options.selectedEdgeId ?? null}
      onSelectEdge={() => {}}
      onCreateNode={() => {}}
      onRemoveNode={() => {}}
      onCreateEdge={() => {}}
      onRemoveEdge={() => {}}
      isPickingEdgeTarget={options.isPickingEdgeTarget ?? false}
      onToggleEdgeTargetPicking={() => {}}
      edgeTargetNodeId={options.edgeTargetNodeId ?? null}
      onChangeEdgeTarget={() => {}}
      isSubmitting={false}
      errorMessage={null}
      onClose={() => {}}
    />
  );
}

describe("🔵 먼저 — 이 창이 편집기의 넷을 다 들고 있는가", () => {
  test("노드 추가 · 연결 추가 · 작업 제거 · 연결 제거 네 상자가 다 있다", () => {
    const html = render();
    assert.ok(html.includes("새 작업 추가"), "노드 추가");
    assert.ok(html.includes("새 연결 추가"), "연결 추가");
    assert.ok(html.includes("고른 작업 제거"), "노드 제거");
    assert.ok(html.includes("고른 연결 제거"), "연결 제거");
  });

  test("🔴 노드 유형을 **고를 수 있다** — 판단까지 들어 있다", () => {
    const html = render();
    for (const label of ["작업", "검사", "판단", "조치"]) {
      assert.ok(html.includes(`>${label}</option>`), `노드 유형에 「${label}」이 없다`);
    }
  });

  test("🔴 시작(START)·종료·문서 참조는 **안 보인다** — 더할 수 있는 갈래가 아니다", () => {
    const html = render();
    assert.ok(!html.includes(">시작</option>"), "시작은 시스템이 관리하는 표식이다");
    assert.ok(!html.includes(">종료</option>"), "종료는 절차의 끝점이라 진행률의 분모를 바꾼다");
    assert.ok(!html.includes(">문서 참조</option>"), "참고 문서는 실행 행이 안 생기는 갈래다");
  });

  test("분기 유형 여덟 가지를 그대로 고를 수 있다 — 편집기와 같은 목록", () => {
    const html = render();
    for (const label of ["기본", "정상", "NG", "YES", "NO", "재측정", "재진행", "사용자 정의"]) {
      assert.ok(html.includes(`>${label}</option>`), `분기 유형에 「${label}」이 없다`);
    }
  });
});

describe("🔴 못 지우는 것을 누르면 **까닭이 보인다**", () => {
  test("아무것도 안 골랐으면 「고르세요」", () => {
    const html = render();
    assert.ok(html.includes(PICK_NODE_TO_REMOVE_MESSAGE));
    assert.ok(!html.includes(TEMPLATE_NODE_NOT_REMOVABLE_MESSAGE), "아직 못 지운다는 말을 할 자리가 아니다");
  });

  test("원본 절차의 작업을 고르면 **왜 못 지우는지**가 그 자리에 뜬다", () => {
    const html = render({ selectedNode: templateNode(2) });
    assert.ok(html.includes(TEMPLATE_NODE_NOT_REMOVABLE_MESSAGE));
    assert.ok(html.includes("disabled=\"\""), "단추는 함께 흐려진다");
  });

  test("이 건에서 더한 작업을 고르면 까닭이 사라지고 단추가 선다", () => {
    const html = render({ selectedNode: ADDED });
    assert.ok(!html.includes(TEMPLATE_NODE_NOT_REMOVABLE_MESSAGE));
    assert.ok(!html.includes(PICK_NODE_TO_REMOVE_MESSAGE));
  });

  test("연결도 같다 — 원본 연결을 고르면 까닭이 뜬다", () => {
    const picked = render({ selectedEdgeId: "e-t1-t2" });
    assert.ok(picked.includes(TEMPLATE_EDGE_NOT_REMOVABLE_MESSAGE));

    const added = render({ selectedEdgeId: "x-t2-x9" });
    assert.ok(!added.includes(TEMPLATE_EDGE_NOT_REMOVABLE_MESSAGE));
  });
});

describe("목록에 무엇이 보이는가", () => {
  test("🔴 작업 목록에 **더한 것임을 적는다** — 그림에서는 둘이 똑같이 생겼다", () => {
    const html = render();
    assert.ok(html.includes("추가 세척 (이 건에서 더함)"));
    assert.ok(html.includes("1. MCU 기판 교환"), "번호와 제목이 함께 적힌다");
  });

  test("연결 목록에는 원본과 더한 것이 **둘 다** 보인다", () => {
    const html = render();
    assert.ok(html.includes("1. MCU 기판 교환 → 2. 작업 2"), "원본 연결");
    assert.ok(html.includes("2. 작업 2 → 4. 추가 세척"), "이 건에서 그은 연결");
    assert.ok(html.includes("[NG]"), "갈래 이름표가 적힌다");
  });

  test("지도가 들어갈 자리가 있다", () => {
    assert.ok(render().includes("data-fake-graph"));
  });
});

describe("🔵 자리를 사람이 정한다 — 상·하·좌·우 (조각 14)", () => {
  test("고른 작업이 있으면 네 방향을 **다** 고를 수 있다", () => {
    const html = render({ selectedNode: templateNode(2) });
    assert.ok(html.includes("data-execution-task-editor-direction"), "방향 고르는 자리가 없다");
    for (const label of ["오른쪽", "왼쪽", "아래", "위"]) {
      assert.ok(html.includes(`>${label}</button>`), `방향에 「${label}」이 없다`);
    }
  });

  test("기본값이 「오른쪽」이다 — 조각 13 까지의 동작이 그대로 나와야 한다", () => {
    const html = render({ selectedNode: templateNode(2) });
    // aria-pressed 가 선 단추가 지금 고른 방향이다.
    const pressed = [...html.matchAll(/aria-pressed="true"[^>]*>([^<]+)</g)].map((m) => m[1]);
    assert.ok(pressed.includes("오른쪽"), `지금 고른 방향이 오른쪽이 아니다: ${JSON.stringify(pressed)}`);
  });

  test("🔴 어디에 놓이는지를 **고른 작업의 이름과 함께** 적는다", () => {
    const html = render({ selectedNode: templateNode(2, { title: "조정 작업" }) });
    assert.ok(html.includes("「2. 조정 작업」의 오른쪽에 놓습니다"), "무엇의 어느 쪽인지가 안 적혀 있다");
  });

  test("🔴 **아무것도 안 골랐으면** 방향을 못 고르고, 까닭이 그 자리에 뜬다", () => {
    const html = render();
    assert.ok(!html.includes("data-execution-task-editor-direction"), "기준이 없는데 방향을 고르게 두면 안 된다");
    assert.ok(
      html.includes("기준이 될 작업을 위에서 고르면"),
      "왜 못 고르는지를 안 적으면 「왜 안 눌리지」로 끝난다"
    );
    assert.ok(html.includes("지금까지처럼 자리가 저절로 정해집니다"), "안 골랐을 때 무슨 일이 나는지가 안 적혀 있다");
  });

  test("🔵 안 골라도 [작업 추가]는 그대로 눌린다 — 자리만 저절로 정해질 뿐이다", () => {
    // 🔴 그려서 재면 안 된다 — 제목이 비어 있으면 어차피 단추가 흐려서, 고른
    //    작업 때문인지 제목 때문인지 **갈리지 않는다**. 판정이 적힌 줄을 본다.
    const panel = readFileSync("src/components/procedures/execution/ExecutionTaskEditorPanel.tsx", "utf8");
    const line = panel.split("\n").find((l) => l.includes("const canCreateNode ="));
    assert.ok(line, "작업 추가를 열고 닫는 줄을 못 찾았다");
    assert.ok(!line.includes("selectedNode"), `고른 작업이 있어야 작업을 더할 수 있게 돼 있다: ${line}`);
    assert.ok(line.includes("title.trim()"), `제목으로 가르는 줄이 아니다: ${line}`);
  });

  test("끌어 옮길 수 있다는 사실을 창이 말해 준다 — 지도에 단서가 없다", () => {
    assert.ok(render().includes("그림에서 끌어 옮길 수 있고, 놓는 순간 자리가 저장됩니다"));
  });
});

describe("🔵 연결의 대상을 지도에서 고른다 (조각 14)", () => {
  test("🔴 단추 글자 — 꺼져 있을 때와 켜져 있을 때가 다르다", () => {
    const off = render();
    assert.ok(off.includes(">지도에서 대상 고르기</button>"), "대상 고르기 단추가 없다");
    assert.ok(!off.includes("지도에서 누를 작업이 대상이 됩니다"), "안 켰는데 켠 글자가 보인다");

    const on = render({ isPickingEdgeTarget: true });
    assert.ok(on.includes(">지도에서 누를 작업이 대상이 됩니다 (취소)</button>"), "켠 글자가 안 바뀐다");
  });

  test("🔴 켜져 있는 동안 **고른 작업은 안 바뀐다**는 것을 적어 준다", () => {
    const on = render({ isPickingEdgeTarget: true });
    assert.ok(on.includes("「고른 작업」은 바뀌지 않습니다"), "시작과 대상이 어떻게 갈리는지를 안 알려 준다");
  });

  test("🔵 **드롭다운은 그대로 남아 있다** — 지도에 안 보이는 작업이 있을 수 있다", () => {
    const html = render();
    const targetBlock = html.slice(html.indexOf("대상 작업"), html.indexOf("분기 유형"));
    for (const node of NODES) {
      assert.ok(targetBlock.includes(node.title), `대상 드롭다운에 「${node.title}」이 없다`);
    }
  });

  test("지도에서 고른 대상이 드롭다운에도 그대로 비친다 — 두 길이 한 값을 본다", () => {
    const html = render({ edgeTargetNodeId: ADDED.id });
    const targetBlock = html.slice(html.indexOf("대상 작업"), html.indexOf("분기 유형"));
    assert.ok(
      targetBlock.includes(`value="${ADDED.id}" selected`) || targetBlock.includes(`selected="" value="${ADDED.id}"`),
      `고른 대상이 드롭다운에 안 비친다: ${targetBlock}`
    );
  });
});

/**
 * 🔴 그림 부품(ProcedureFlowGraph)은 @xyflow/react 의 .css 를 끌고 와서 여기서
 * 못 그린다 — 원본 글자로 잰다. 재는 것은 **끌기만 열었고, 안 넘기는 화면들은
 * 글자 하나 안 바뀌는가**이다(조각 14).
 */
describe("🔴 그림 부품에 더한 것이 **다른 화면을 안 바꾼다**", () => {
  const repoUrl = new URL("../../../../", import.meta.url);
  const read = (relativePath: string) => readFileSync(new URL(relativePath, repoUrl), "utf8");
  const graph = read("src/components/procedures/ProcedureFlowGraph.tsx");

  test("🔵 먼저 — 새 손잡이가 정말 있는가(공짜 통과 막기)", () => {
    assert.ok(graph.includes("draggableNodeIds"), "ProcedureFlowGraph 에 draggableNodeIds 가 없다");
  });

  test("🔴 기본값이 null 이다 — 안 넘기면 전역 설정(editable)이 그대로 정한다", () => {
    assert.ok(graph.includes("draggableNodeIds = null"), "기본값이 null 이 아니면 기존 화면의 끌기가 바뀐다");
  });

  test("🔴 안 넘겼을 때 칸에 `draggable: false` 를 박지 않는다 — 편집기가 아무것도 못 끌게 된다", () => {
    assert.ok(
      graph.includes("draggableNodeIdSet === null ? undefined :"),
      "null 일 때 undefined 가 아니면 React Flow 의 전역 설정이 무시된다"
    );
  });

  test("🔴 경로점 편집은 **같이 안 열린다** — editable 의 관문을 안 건드렸다", () => {
    // 경로점/「연결선 펴기」/사용자 배치 선택지는 여전히 editable 하나로만 열린다.
    assert.ok(graph.includes('if (!editable || layoutMode !== "USER") return;'), "「연결선 펴기」 관문이 바뀌었다");
    assert.ok(graph.includes('nodesDraggable={editable && layoutMode === "USER"}'), "전역 끌기 관문이 바뀌었다");
    assert.ok(graph.includes('{editable && <option value="USER">사용자 배치</option>}'), "배치 선택지 관문이 바뀌었다");
  });

  test("🔴 끌기를 여는 화면은 **「추가 작업 등록」 창 하나**다", () => {
    const callers = [
      "src/components/procedures/ProcedureTemplateDetailScreen.tsx",
      "src/components/procedures/ProcedureTemplateEditorScreen.tsx",
      "src/components/procedures/execution/ProcedureStartPickerGraph.tsx",
      // 「전체 단계 보기」 팝업 — 조각 10 의 그 창이다.
      "src/components/procedures/execution/ExecutionStepsDialog.tsx",
    ];
    for (const caller of callers) {
      assert.ok(!read(caller).includes("draggableNodeIds"), `${caller} 가 끌기를 열고 있다`);
    }
    // 🔵 `onNodeClickIntercept` 는 **조각 14 가 만든 것이 아니다** — 절차
    //    편집기의 「화면에서 선택」이 전부터 쓰던 손잡이다. 그래서 「아무도 안
    //    쓴다」로 재면 틀린다. 조각 14 가 더한 것은 **실행 쪽 감싸개로
    //    흘려보내는 길**뿐이고, 그 길을 쓰는 창은 하나다.
    assert.ok(
      read("src/components/procedures/ProcedureTemplateEditorScreen.tsx").includes("onNodeClickIntercept"),
      "편집기가 전부터 쓰던 손잡이가 사라졌다 — 그랬다면 이 시험의 전제가 틀린 것이다"
    );
    assert.ok(
      !read("src/components/procedures/execution/ExecutionStepsDialog.tsx").includes("onNodeClickIntercept"),
      "「전체 단계 보기」 팝업이 누름 가로채기를 쓰고 있다"
    );
  });

  test("🔵 감싸개도 기본값이 「없음」이다 — 「전체 단계 보기」가 안 넘겨도 된다", () => {
    const wrapper = read("src/components/procedures/execution/ExecutionStepsGraph.tsx");
    assert.ok(wrapper.includes("draggableNodeIds = null"), "감싸개의 기본값이 null 이 아니다");
    assert.ok(wrapper.includes("onNodeDragStop?:"), "놓은 자리를 올려 보낼 손잡이가 없다");
    assert.ok(wrapper.includes("onNodeClickIntercept?:"), "누름 가로채기 손잡이가 없다");
  });
});

/**
 * 🔴 창(ExecutionExtraTaskDialog)은 서버 액션을 직접 import 해서 여기서 못
 * 그린다 — 원본 글자로 잰다. 재는 것은 **사용자가 없애 달라고 한 것들이 정말로
 * 없는가**이다.
 */
describe("🔴 창 쪽 불변식 — 원본 글자로", () => {
  const dialog = readFileSync("src/components/procedures/execution/ExecutionExtraTaskDialog.tsx", "utf8");
  /** 주석을 걷어낸 알맹이. 주석에 적힌 낱말을 코드로 세면 셈이 통째로 뒤집힌다. */
  const code = dialog.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

  test("🔵 먼저 — 주석 걷기가 실제로 뭔가를 걷어냈다(공짜 통과 막기)", () => {
    assert.ok(code.length < dialog.length, "이 파일에는 주석이 있어야 아래 셈이 뜻을 가진다");
  });

  test("🔴 저장 팝업을 안 띄운다 — 모달 창 뒤로 가려진다", () => {
    assert.ok(!code.includes("showSavePopup"), "창 위에 뜨는 팝업은 아무도 못 읽는다");
  });

  test("🔴 확인 창이 없다 — 사용자가 없애 달라고 한 그것이다", () => {
    assert.ok(!code.includes("연결 검토"), "편집기의 「연결 검토」 → 확인 창은 안 가져온다");
    assert.ok(!/confirming/.test(code), "확인 대기 상태 자체가 없어야 한다");
  });

  test("🔴 다섯 통로를 다 부른다 — 하나라도 빠지면 그 단추가 죽은 단추가 된다", () => {
    for (const action of [
      "addExecutionExtraTaskAction",
      "removeExecutionExtraTaskAction",
      "addExecutionEdgeAction",
      "removeExecutionEdgeAction",
      // 🔵 2026-11-03(조각 14) — 끌어 놓은 자리를 저장하는 통로.
      "moveExecutionExtraTaskAction",
    ]) {
      assert.ok(code.includes(`${action}(`), `${action} 을 안 부른다`);
    }
  });

  test("🔴 저장한 뒤 **화면을 다시 읽는다** — 그 자리에서 지도가 바뀌는 것이 저장됐다는 증거다", () => {
    assert.ok(code.includes("router.refresh()"));
  });

  test("🔴 끌 수 있는 칸을 **이 건에서 더한 것만**으로 추린다 — 원본은 못 끈다", () => {
    const line = code.split("\n").find((l) => l.includes("isAddedInCase") && l.includes("filter"));
    assert.ok(line, "끌 수 있는 칸을 추리는 줄이 없다");
    assert.ok(code.includes("draggableNodeIds={draggableGraphNodeIds}"), "추린 목록을 지도에 안 넘긴다");
  });

  test("🔴 끌기 저장은 **expectedVersion 을 안 싣는다** — 남의 탭이 다음 작업에서 튕긴다", () => {
    const call = code.slice(code.indexOf("moveExecutionExtraTaskAction("));
    const args = call.slice(0, call.indexOf(")") + 1);
    assert.ok(!args.includes("expectedVersion"), `자리 저장에 토큰을 실었다: ${args}`);
  });

  test("🔴 끌기는 `isSubmitting` 관문을 지나지 않는다 — 한 번뿐인 동작을 조용히 거르면 안 된다", () => {
    const handler = code.slice(code.indexOf("function handleNodeDragStop"));
    const body = handler.slice(0, handler.indexOf("\n  }"));
    assert.ok(!body.includes("isSubmitting"), `놓는 순간 저장이 제출 관문에 걸려 있다: ${body}`);
    assert.ok(!body.includes("run("), "모아 두는 통로(run)를 쓰면 저장이 조용히 걸러질 수 있다");
  });
});
