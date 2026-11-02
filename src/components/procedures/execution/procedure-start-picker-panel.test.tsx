import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import ProcedureStartPickerPanel from "./ProcedureStartPickerPanel";
import {
  findStartNode,
  resolveStartButtonState,
  searchStartNodes,
  type StartPickerNode,
  type StartPickerTemplate,
} from "@/lib/domain/procedure-start-picker";
import type { ProcedureNodeType } from "@/lib/domain/procedure-template-types";

/**
 * 「기술 절차 불러오기」 창이 **실제로 무엇을 그리는가**(2026-11-02, 조각 7).
 *
 * 이웃 execution-list-fold.test.tsx · past-executions-section.test.tsx 와 같은
 * 방법 — 창의 속(ProcedureStartPickerPanel)은 상태도 서버 액션도 DB 조회 타입도
 * 안 물게 적었으므로 **그려서** 잰다. 반대로 ExecutionStartCard 는 서버 액션을
 * 직접 import 하고 플로우차트(@xyflow/react 의 .css)를 끌고 와서 import 자체가
 * 던지므로, **무엇을 어디로 넘기는가**는 원본 글자로 확인한다 — 🔴 주석을 걷어낸
 * 뒤에. 이 저장소는 주석에 낱말이 적혀 있다는 이유로 셈이 틀린 적이 있다.
 *
 * 무엇이 걸리고 무엇을 고를 수 있는지의 **규칙 자체**는 unit 목록의
 * procedure-start-picker.test.ts, 서버가 정말 거절하는지는 db 목록의
 * procedure-case-execution.integration.test.ts 58~64번이 잰다.
 */

function stripComments(source: string): string {
  return source
    .replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g, " ") // JSX 주석 {/* ... */}
    .replace(/\/\*[\s\S]*?\*\//g, " ") // 블록 주석
    .split(/\r?\n/)
    .filter((line) => !/^\s*\/\//.test(line)) // 줄 주석
    .join("\n");
}

const flat = (source: string) => source.replace(/\s+/g, " ");
const read = (file: string) => readFileSync(new URL(file, import.meta.url), "utf8");

type TestNode = StartPickerNode;

function node(sortOrder: number, title: string, nodeType: ProcedureNodeType = "DECISION"): TestNode {
  return { id: `n-${sortOrder}`, title, nodeType, nodeCode: `manual-${sortOrder}`, sortOrder };
}

/** 실측 2026-11-02 — 개발 DB 에 게시돼 있는 절차 둘(일부 노드). */
const RESTORE: StartPickerTemplate<TestNode> = {
  id: "tpl-restore",
  code: "7",
  name: "원복 검사 및 개선 작업 (3상 입력)",
  nodes: [
    node(0, "확인된 고장품, 예방교환 부품 교환 및 조정, 개선 작업 실시", "START"),
    node(19, "MCU 신호 점검"),
    node(20, "MCU 기판 교환"),
  ],
};
const POWER_ON: StartPickerTemplate<TestNode> = {
  id: "tpl-power",
  code: "기본 통전 검사 (3상 입력)", // 🔴 code 칸에 이름이 그대로 들어 있다(실측).
  name: "기본 통전 검사 (3상 입력)",
  nodes: [node(0, "220V 스위칭 전원 직접 입력", "START"), node(4, "MCU VCC 확인"), node(22, "MCU 기판 교환", "TASK")],
};
const TEMPLATES = [RESTORE, POWER_ON];

function renderPanel(options: {
  scopeTemplateId?: string | null;
  query?: string;
  chosenNodeId?: string | null;
  isSubmitting?: boolean;
  errorMessage?: string | null;
  graph?: boolean;
}): string {
  const scopeTemplateId = options.scopeTemplateId ?? null;
  const query = options.query ?? "";
  const chosenNodeId = options.chosenNodeId ?? null;
  // 🔵 판정은 도메인 함수 그대로 — 시험이 창과 다른 잣대로 재면 둘 다 틀려도 통과한다.
  const search = searchStartNodes(TEMPLATES, query, scopeTemplateId);
  const chosen = findStartNode(TEMPLATES, scopeTemplateId, chosenNodeId);
  const button = resolveStartButtonState({ scopeTemplateId, chosenNodeId, isSubmitting: options.isSubmitting ?? false });
  return renderToStaticMarkup(
    <ProcedureStartPickerPanel
      templates={TEMPLATES}
      scopeTemplateId={scopeTemplateId}
      onScopeChange={() => {}}
      query={query}
      onQueryChange={() => {}}
      search={search}
      onHitSelect={() => {}}
      chosen={chosen}
      onClearChoice={() => {}}
      button={button}
      onStart={() => {}}
      onCancel={() => {}}
      errorMessage={options.errorMessage ?? null}
      graphSlot={options.graph === false ? null : <div data-test-graph="1">그림</div>}
    />
  );
}

describe("🔴 드롭다운 기본값은 「모든 절차」다", () => {
  const html = renderPanel({});

  test("「모든 절차」가 골라진 채로 선다", () => {
    assert.match(html, /모든 절차/);
    // 고른 것은 value="" 인 줄이다 — 어느 절차도 미리 안 골라져 있다.
    const selected = html.match(/<option[^>]*selected[^>]*>([^<]*)<\/option>/);
    assert.ok(selected, "골라진 줄을 못 찾았다");
    assert.equal(selected[1], "모든 절차");
  });

  test("게시된 절차가 모두 줄로 서고, 이름은 formatProcedureTemplateTitle 모양이다", () => {
    assert.match(html, /원복 검사 및 개선 작업 \(3상 입력\) \(7\)/, "코드가 이름과 다르면 괄호로 붙는다");
    assert.ok(!html.includes("기본 통전 검사 (3상 입력) (기본 통전 검사 (3상 입력))"), "「이름 (이름)」이 떴다");
  });

  test("🔴 「모든 절차」에서는 플로우차트 대신 **한 줄 안내**가 선다 — 빈 네모는 고장으로 읽힌다", () => {
    assert.match(html, /절차를 고르거나 검색 결과를 누르면 여기에 흐름이 그려집니다/);
    assert.ok(!html.includes('data-test-graph'), "「모든 절차」인데 그림이 그려졌다");
  });
});

describe("🔴 검색 결과 — 절차 이름은 「모든 절차」에서만 앞에 붙는다", () => {
  test("「모든 절차」에서 MCU 를 찾으면 **두 절차의** 노드가 절차 이름과 함께 나온다", () => {
    const html = renderPanel({ query: "MCU" });
    assert.match(html, /맞는 노드 4개/, "표본 확인 — 실제로 네 줄이 걸린다");
    assert.match(flat(html), /원복 검사 및 개선 작업 \(3상 입력\) \(7\) › /);
    assert.match(flat(html), /기본 통전 검사 \(3상 입력\) › /);
  });

  test("🔴 같은 이름 「MCU 기판 교환」이 두 줄인데 **서로 갈린다**", () => {
    const html = flat(renderPanel({ query: "MCU 기판 교환" }));
    assert.match(html, /원복 검사 및 개선 작업 \(3상 입력\) \(7\) › <\/span><span class="font-medium">2\. MCU 기판 교환/);
    assert.match(html, /기본 통전 검사 \(3상 입력\) › <\/span><span class="font-medium">2\. MCU 기판 교환/);
  });

  test("절차를 고른 상태에서는 절차 이름이 **안 붙는다** — 드롭다운에 이미 적혀 있다", () => {
    const html = flat(renderPanel({ query: "MCU", scopeTemplateId: "tpl-power" }));
    assert.match(html, /맞는 노드 2개/, "좁혀서 둘만 걸린다");
    assert.ok(!/› <\/span>/.test(html), "좁혔는데도 절차 이름이 줄마다 붙어 있다");
  });

  test("검색어가 비면 결과 목록 자체를 안 그린다", () => {
    const html = renderPanel({ query: "" });
    assert.ok(!html.includes("맞는 노드"));
    assert.ok(!html.includes("일치하는 작업이 없습니다"));
  });

  test("안 걸리면 한 줄로 말해 준다", () => {
    assert.match(renderPanel({ query: "없는이름zzz" }), /일치하는 작업이 없습니다/);
  });
});

describe("🔴 실행 행이 없는 노드는 눌러지지 않는다", () => {
  /** 결과 목록(ul) 안만 본다 — 창 아래 시작 단추도 상황에 따라 disabled 라 섞이면 못 가린다. */
  function resultList(html: string): string {
    const flattened = flat(html);
    const start = flattened.indexOf("<ul>");
    assert.ok(start >= 0, "결과 목록이 안 그려졌다");
    return flattened.slice(start, flattened.indexOf("</ul>") + 5);
  }

  test("START 줄이 결과에 **나오되** 비활성이고 까닭이 적힌다", () => {
    const list = resultList(renderPanel({ query: "220V 스위칭 전원 직접 입력" }));
    assert.match(list, /220V 스위칭 전원 직접 입력/, "통째로 빼면 사람이 제 오타로 읽는다");
    assert.match(list, /시작\(START\) 지점은 시스템이 자동으로 관리/);
    assert.match(list, /<button type="button" disabled=""/);
  });

  test("🔵 표본 확인 — 평범한 노드 줄은 비활성이 아니다", () => {
    const list = resultList(renderPanel({ query: "MCU VCC 확인" }));
    assert.match(list, /MCU VCC 확인/);
    assert.ok(!/disabled=""/.test(list), "고를 수 있는 줄까지 막혔다");
  });
});

describe("🔴 시작 단추의 글자가 고른 것에 따라 바뀐다", () => {
  test("아무것도 안 고르면 「처음부터 시작」", () => {
    const html = renderPanel({ scopeTemplateId: "tpl-restore" });
    assert.match(html, /처음부터 시작<\/button>/);
    assert.ok(!html.includes("여기서부터 시작"));
    assert.match(html, /고른 것 없음 — 절차 처음부터 시작합니다\./);
  });

  test("노드를 고르면 「여기서부터 시작」이고, 고른 것이 번호와 함께 적힌다", () => {
    const html = flat(renderPanel({ scopeTemplateId: "tpl-restore", chosenNodeId: "n-19" }));
    assert.match(html, /여기서부터 시작<\/button>/);
    assert.ok(!html.includes("처음부터 시작<"), "두 글자가 함께 떠 있으면 어느 쪽인지 알 수 없다");
    assert.match(html, /고른 것: <\/span><span class="font-medium[^"]*">1\. MCU 신호 점검<\/span>/);
    assert.match(html, /처음부터로 되돌리기/, "고른 것을 무를 길이 있어야 한다");
  });

  test("🔴 「모든 절차」에서는 단추가 안 눌리고 까닭이 한 줄로 뜬다", () => {
    // 🔴 「처음부터 시작」은 바로 위 안내 문구에도 들어 있다(「절차 처음부터
    // 시작합니다.」) — 단추를 집을 때 `>…</button>` 로 끊지 않으면 엉뚱한 자리를 잰다.
    const startButtonTag = (html: string) => {
      const end = html.indexOf(">처음부터 시작</button>");
      assert.ok(end >= 0, "시작 단추를 못 찾았다");
      return html.slice(html.lastIndexOf("<button", end), end);
    };

    const html = flat(renderPanel({}));
    assert.match(startButtonTag(html), /disabled=""/, "「모든 절차」에서는 시작할 절차가 안 정해진다");
    assert.match(startButtonTag(html), /title="먼저 절차를 고르세요/);
    assert.match(html, /먼저 절차를 고르세요\. 검색 결과를 눌러도 절차가 정해집니다\./);
    // 🔵 표본 확인 — 절차를 고르면 같은 단추가 눌린다(늘 흐린 단추가 아니다).
    assert.ok(!/disabled=""/.test(startButtonTag(flat(renderPanel({ scopeTemplateId: "tpl-restore" })))));
  });

  test("서버가 돌려준 실패 이유를 그대로 보인다", () => {
    assert.match(renderPanel({ scopeTemplateId: "tpl-restore", errorMessage: "잠금된 접수 건입니다." }), /잠금된 접수 건입니다\./);
  });
});

describe("절차를 고르면 플로우차트 자리가 선다", () => {
  test("고른 절차에서는 넘겨받은 그림을 그대로 그린다", () => {
    const html = renderPanel({ scopeTemplateId: "tpl-restore" });
    assert.match(html, /data-test-graph="1"/);
    assert.ok(!html.includes("절차를 고르거나 검색 결과를 누르면"), "그림과 안내가 함께 떠 있다");
  });
});

describe("🔴 창이 그림과 검색을 어떻게 엮는가 — 원본 글자로 확인", () => {
  const card = stripComments(read("./ExecutionStartCard.tsx"));
  const graph = stripComments(read("./ProcedureStartPickerGraph.tsx"));
  const panel = stripComments(read("./ProcedureStartPickerPanel.tsx"));

  test("🔵 주석 걷어내기가 실제로 돌고 있다", () => {
    assert.ok(read("./ExecutionStartCard.tsx").includes("🔴"));
    assert.ok(!card.includes("🔴"), "주석이 남으면 아래 「없어야 한다」가 주석만 보고 통과한다");
  });

  test("🔴 드롭다운 기본값이 「모든 절차」(null)다", () => {
    assert.match(flat(card), /useState<string \| null>\(null\)/, "첫 절차를 미리 고르면 검색이 엉뚱한 데서 돈다");
    assert.match(flat(card), /setScopeTemplateId\(null\)/, "창을 열 때마다 「모든 절차」로 돌아가야 한다");
  });

  test("🔴 검색 결과를 누르면 드롭다운이 **그 절차로 바뀌고** 그림이 그 노드로 옮겨 간다", () => {
    const handler = flat(card).slice(flat(card).indexOf("function handleHitSelect"));
    const body = handler.slice(0, handler.indexOf("const handlePickedNodeChange"));
    assert.match(body, /setScopeTemplateId\(hit\.templateId\)/);
    assert.match(body, /setChosenNodeId\(hit\.node\.id\)/);
    assert.match(body, /setFocusNodeId\(hit\.node\.id\)/);
    assert.match(body, /setFocusSeq\(\(seq\) => seq \+ 1\)/, "같은 결과를 두 번 눌러도 카메라가 움직여야 한다");
  });

  test("🔴 절차를 바꾸면 고른 노드를 **비운다** — 남의 절차 노드가 서버로 가면 안 된다", () => {
    const handler = flat(card).slice(flat(card).indexOf("function handleScopeChange"));
    const body = handler.slice(0, handler.indexOf("function handleHitSelect"));
    assert.match(body, /setChosenNodeId\(null\)/);
  });

  test("🔴 고른 노드를 서버로 실어 보낸다", () => {
    assert.match(flat(card), /startAtProcedureTemplateNodeId: chosenNodeId/);
  });

  test("🔴 검색어가 비면 강조를 **null 로** 넘긴다 — 빈 배열이면 그림이 통째로 흐려진다", () => {
    assert.match(flat(card), /if \(query\.trim\(\) === ""\) return null;/);
  });

  test("🔴 「모든 절차」에서는 그림을 아예 안 만든다", () => {
    assert.match(flat(card), /scopedTemplate === null \? null : \( <ProcedureStartPickerGraph/);
  });

  test("🔴 고를 수 있는 노드는 도메인 함수가 정한다 — 화면이 조건을 다시 적지 않는다", () => {
    assert.match(flat(card), /classifyStartNode\(node\.nodeType\)\.ok/);
    assert.ok(!/nodeType !== "START"/.test(card), "화면이 제 손으로 종류를 가르면 서버와 말이 갈린다");
  });

  test("🔴 그림은 **보고 고르는 것만** 한다 — 편집용 상호작용이 한 줄도 없다", () => {
    assert.ok(!/editable/.test(graph), "editable 을 넘기면 노드 드래그와 경로점 편집이 함께 열린다");
    assert.ok(!/onNodeDragStop|onNodeDragStart|onWaypointMove|onWaypointSelectionChange|edgeRoutesByEdgeId|onEdgeDoubleClick/.test(graph));
    assert.match(flat(graph), /showChrome=\{false\}/, "제 검색 칸이 또 서면 어느 쪽이 무엇인지 알 수 없다");
    assert.match(flat(graph), /onNodeClickIntercept=\{\(nodeId\) => !pickableNodeIds\.has\(nodeId\)\}/);
  });

  test("🔴 창의 속은 상태를 안 들고 있다 — 그림과 목록이 같은 값을 봐야 한다", () => {
    assert.ok(!/useState|useReducer/.test(panel), "여기에 상태가 생기면 그림과 목록이 서로를 못 본다");
  });

  test("🔴 \"use client\" 가 안 늘었다", () => {
    for (const [label, source] of [
      ["ExecutionStartCard", card],
      ["ProcedureStartPickerGraph", graph],
      ["ProcedureStartPickerPanel", panel],
    ] as const) {
      const occurrences = source.match(/"use client"/g) ?? [];
      assert.equal(occurrences.length, 1, `${label} 에 "use client" 가 ${occurrences.length}개다`);
    }
  });

  test("🔴 옛 창의 안내(목록이 비었을 때)는 그대로 남아 있다", () => {
    assert.match(card, /불러올 수 있는 기술 절차가 없습니다\./);
    assert.match(flat(card), /게시된<\/span> 절차만 나타납니다/);
  });
});
