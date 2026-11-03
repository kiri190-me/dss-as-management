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

function render(options: { selectedNode?: CaseEditNode | null; selectedEdgeId?: string | null } = {}): string {
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

  test("🔴 네 통로를 다 부른다 — 하나라도 빠지면 그 단추가 죽은 단추가 된다", () => {
    for (const action of [
      "addExecutionExtraTaskAction",
      "removeExecutionExtraTaskAction",
      "addExecutionEdgeAction",
      "removeExecutionEdgeAction",
    ]) {
      assert.ok(code.includes(`${action}(`), `${action} 을 안 부른다`);
    }
  });

  test("🔴 저장한 뒤 **화면을 다시 읽는다** — 그 자리에서 지도가 바뀌는 것이 저장됐다는 증거다", () => {
    assert.ok(code.includes("router.refresh()"));
  });
});
