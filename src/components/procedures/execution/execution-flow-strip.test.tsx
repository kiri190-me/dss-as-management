import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import ExecutionFlowStrip, { type FlowStripNode } from "./ExecutionFlowStrip";
import { formatFlowEdgeLabel } from "./execution-branch-choice";
import { buildProcedureExecutionMinimap, type MinimapEdge } from "@/lib/domain/procedure-execution-minimap";
import type { ProcedureBranchType } from "@/lib/domain/procedure-template-types";
import type { ProcedureCaseExecutionNodeStatus } from "@/lib/domain/procedure-case-execution-types";

/**
 * 「지금 어디쯤인가」 띠가 **실제로 무엇을 그리는가**.
 *
 * 이웃 execution-current-task.test.ts 와 달리 **렌더해서** 잰다. 이 띠는 서버
 * 액션도 DB 조회 타입도 물지 않게 일부러 좁은 프롭 타입(FlowStripNode)으로
 * 적었으므로, react-server 조건 없이 도는 이 목록에서 그대로 import 된다.
 *
 * 다만 ProcedureExecutionScreen 은 여전히 서버 컴포넌트에 DB 조회 타입을 끌고
 * 와서 import 가 던진다 — 띠를 **어디에 세우고 무엇을 넘기는가**는 이웃 시험과
 * 같은 방법으로 원본 글자를 읽어 확인한다(주석은 걷어낸다).
 */

type Node = FlowStripNode;

function makeNodes(count: number, statusByOrder: Partial<Record<number, ProcedureCaseExecutionNodeStatus>> = {}): Node[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `e${i + 1}`,
    procedureTemplateNodeId: `t${i + 1}`,
    orderIndex: i + 1,
    title: `작업 ${i + 1}`,
    status: statusByOrder[i + 1] ?? "PENDING",
  }));
}

function edge(from: number, to: number, branchType: ProcedureBranchType = "DEFAULT", branchLabel: string | null = null): MinimapEdge {
  return { id: `edge:t${from}->t${to}`, fromNodeId: `t${from}`, toNodeId: `t${to}`, branchType, branchLabel };
}

function renderStrip(nodes: Node[], edges: MinimapEdge[], currentOrderIndex: number | null): string {
  const minimap = buildProcedureExecutionMinimap<Node>({
    nodes,
    edges,
    current: currentOrderIndex === null ? null : (nodes.find((n) => n.orderIndex === currentOrderIndex) ?? null),
  });
  return renderToStaticMarkup(<ExecutionFlowStrip minimap={minimap} />);
}

/** 그려진 칸의 제목을 **왼쪽부터 차례대로**. 띠는 차례가 전부다. */
function chipTitles(html: string): string[] {
  return [...html.matchAll(/title="([^"]*)"/g)].map((m) => m[1]);
}

describe("🔵 먼저 — 렌더가 실제로 돌고 있다", () => {
  test("곧은 길에서 칸이 그려진다", () => {
    const html = renderStrip(makeNodes(6), [edge(1, 2), edge(2, 3), edge(3, 4), edge(4, 5), edge(5, 6)], 3);
    assert.ok(html.includes("data-execution-flow-strip"), "띠 자체가 안 그려졌다");
    assert.ok(chipTitles(html).length > 0, "칸이 하나도 없으면 아래 판정이 전부 공짜로 통과한다");
  });
});

describe("무엇이 보이는가", () => {
  test("🔴 지난 쪽은 **먼 걸음부터** — 왼쪽에서 오른쪽으로 읽히는 차례로 그린다", () => {
    const html = renderStrip(makeNodes(8), [edge(1, 2), edge(2, 3), edge(3, 4), edge(4, 5), edge(5, 6), edge(6, 7)], 4);
    assert.deepEqual(chipTitles(html), ["작업 2", "작업 3", "작업 4", "작업 5", "작업 6", "작업 7"]);
  });

  test("가운데 칸이 「지금」으로 또렷하게 갈린다 — 띠 안에 하나뿐이다", () => {
    const html = renderStrip(makeNodes(5), [edge(1, 2), edge(2, 3), edge(3, 4)], 2);
    assert.equal([...html.matchAll(/data-flow-chip-current="true"/g)].length, 1);
    assert.ok(html.includes("지금"), "가운데 칸에 「지금」이라고 적는다");
    assert.ok(html.includes("border-primary-900"), "지금 칸만 굵은 테두리를 받는다");
  });

  test("칸마다 번호와 상태가 적힌다 — 끝난 것과 아직 할 것이 한눈에 갈려야 한다", () => {
    const nodes = makeNodes(4, { 1: "COMPLETED", 2: "SKIPPED", 4: "BLOCKED" });
    const html = renderStrip(nodes, [edge(1, 2), edge(2, 3), edge(3, 4)], 3);
    for (const label of ["완료", "건너뜀", "차단됨"]) {
      assert.ok(html.includes(label), `${label} 상태가 칸에 안 적혔다`);
    }
    assert.ok(/>3</.test(html), "번호가 칸에 적혀야 요약의 「N번째」와 맞댈 수 있다");
  });

  test("🔴 판단 자리에서 **갈래가 나란히** 보이고 갈래 이름이 붙는다", () => {
    const nodes = makeNodes(5);
    const html = renderStrip(nodes, [edge(1, 2), edge(2, 4, "NORMAL", "정상"), edge(2, 3, "NG", "NG")], 2);
    assert.ok(html.includes("data-flow-branch-group"), "갈래를 묶지 않으면 「차례로 간다」로 읽힌다");
    assert.deepEqual(chipTitles(html), ["작업 1", "작업 2", "작업 4", "작업 3"]);
    assert.ok(html.includes(">정상<"));
    assert.ok(html.includes(">NG<"));
  });

  test("🔴 곧은 길의 화살표에는 「기본」을 안 적는다 — 모든 화살표에 같은 글자가 붙으면 갈래 이름이 묻힌다", () => {
    const html = renderStrip(makeNodes(4), [edge(1, 2), edge(2, 3), edge(3, 4)], 2);
    assert.ok(!html.includes("기본"), "DEFAULT 갈래에는 이름을 안 붙인다");
    assert.equal(formatFlowEdgeLabel({ branchType: "DEFAULT", branchLabel: null }), null);
    assert.equal(formatFlowEdgeLabel({ branchType: "NG", branchLabel: null }), "NG");
    assert.equal(formatFlowEdgeLabel({ branchType: "DEFAULT", branchLabel: "재측정 후" }), "재측정 후");
    assert.equal(formatFlowEdgeLabel({ branchType: "NORMAL", branchLabel: "  " }), "정상", "공백뿐인 이름은 없는 것으로 친다");
  });

  test("한 걸음에 칸이 넘치면 「외 N」으로 알린다 — 조용히 지우지 않는다", () => {
    const html = renderStrip(makeNodes(8), [edge(1, 2), edge(1, 3), edge(1, 4), edge(1, 5), edge(1, 6), edge(1, 7)], 1);
    assert.equal(chipTitles(html).length, 5, "지금 칸 하나 + 갈래 네 칸");
    assert.ok(html.includes("외 2"));
  });
});

describe("🔴 그릴 수 없을 때", () => {
  test("선이 안 붙은 노드 — 빈 네모 대신 한 줄", () => {
    const html = renderStrip(makeNodes(5), [edge(1, 2)], 4);
    assert.ok(html.includes("data-execution-flow-strip"), "띠 자리는 남는다");
    assert.equal(chipTitles(html).length, 0, "점 하나짜리 그림을 그리면 안 된다");
    assert.ok(html.includes("단계끼리 선으로 이어져 있지 않습니다"));
  });

  test("사례별 추가 작업 — 까닭이 다르면 문구도 달라야 한다", () => {
    const nodes = makeNodes(3);
    const extra: Node = { id: "e99", procedureTemplateNodeId: null, orderIndex: 4, title: "추가 작업", status: "PENDING" };
    const minimap = buildProcedureExecutionMinimap<Node>({ nodes: [...nodes, extra], edges: [edge(1, 2)], current: extra });
    const html = renderToStaticMarkup(<ExecutionFlowStrip minimap={minimap} />);
    assert.ok(html.includes("추가 작업이라 이어지는 단계가 없습니다"));
  });

  test("🔴 절차 전체에 이을 선이 없으면 **아무것도 안 그린다** — 빈 띠조차 안 남긴다", () => {
    assert.equal(renderStrip(makeNodes(5), [], 1), "");
  });

  test("지금 할 일 자체가 없으면 역시 아무것도 안 그린다", () => {
    assert.equal(renderStrip(makeNodes(5), [edge(1, 2)], null), "");
  });
});

/**
 * 🔴 2026-11-02(조각 10) — 상자 머리줄에 단추 둘이 선다([전체 단계 보기] ·
 * [추가 작업 등록]). 단추는 서버 액션을 직접 부르는 클라이언트 부품이라 띠가
 * 직접 import 하면 이 시험이 import 에서 던진다 — 그래서 **슬롯**으로 받는다.
 * 여기서는 그 자리에 아무거나 넣어 **그려지는지**만 잰다.
 *
 * 재는 핵심은 하나다: **흐름이 안 그려질 때도 단추가 남는가.** 그리다 만 절차
 * (실측 「원복 검사」는 노드 22개에 선이 7개)에서는 띠가 거의 늘 못 그려지는데,
 * 그때 전체를 보고 자리를 옮길 길이 화면에서 통째로 사라지면 안 된다.
 */
describe("🔴 상자 머리줄의 단추 — 흐름이 안 그려져도 남는다", () => {
  const actions = <button type="button">전체 단계 보기</button>;

  function renderWithActions(nodes: Node[], edges: MinimapEdge[], currentOrderIndex: number | null): string {
    const minimap = buildProcedureExecutionMinimap<Node>({
      nodes,
      edges,
      current: currentOrderIndex === null ? null : (nodes.find((n) => n.orderIndex === currentOrderIndex) ?? null),
    });
    return renderToStaticMarkup(<ExecutionFlowStrip minimap={minimap} actions={actions} />);
  }

  test("🔵 먼저 — 단추를 안 넘기면 전과 똑같다(그림이 있는 경우)", () => {
    const plain = renderStrip(makeNodes(4), [edge(1, 2), edge(2, 3), edge(3, 4)], 2);
    assert.ok(!plain.includes("전체 단계 보기"), "표본 확인 — 안 넘기면 단추 글자가 없어야 아래가 뜻을 가진다");
  });

  test("그림이 그려지는 띠에도 단추가 함께 선다", () => {
    const html = renderWithActions(makeNodes(4), [edge(1, 2), edge(2, 3), edge(3, 4)], 2);
    assert.ok(html.includes("전체 단계 보기"));
    assert.ok(html.includes("data-flow-chip"), "칸도 그대로 그려져야 한다");
  });

  test("🔴 절차 전체에 선이 없어도 상자와 단추가 남고, 왜 그림이 없는지 적힌다", () => {
    const html = renderWithActions(makeNodes(5), [], 1);
    assert.ok(html.includes("data-execution-flow-strip"), "상자가 통째로 사라지면 옮길 길이 없어진다");
    assert.ok(html.includes("전체 단계 보기"));
    assert.ok(html.includes("선으로 이어져 있지 않아"), "왜 그림이 없는지 한 줄이 있어야 한다");
    assert.equal(chipTitles(html).length, 0, "그림은 안 그린다");
  });

  test("🔴 지금 할 일 자체가 없어도(마친 실행 등) 상자와 단추가 남는다 — 까닭은 다른 글이다", () => {
    const html = renderWithActions(makeNodes(5), [edge(1, 2)], null);
    assert.ok(html.includes("data-execution-flow-strip"));
    assert.ok(html.includes("전체 단계 보기"));
    assert.ok(html.includes("지금 할 일이 없어"), "「선이 없다」와 다음 행동이 다르므로 글도 달라야 한다");
    assert.ok(!html.includes("선으로 이어져 있지 않아"));
  });

  test("「한 줄 안내」로 떨어지는 자리에서도 단추가 남는다", () => {
    const html = renderWithActions(makeNodes(5), [edge(1, 2)], 4);
    assert.ok(html.includes("단계끼리 선으로 이어져 있지 않습니다"));
    assert.ok(html.includes("전체 단계 보기"));
  });
});

describe("🔴 읽기 전용이고, 폰에서 안 깨진다", () => {
  const html = renderStrip(makeNodes(6), [edge(1, 2), edge(2, 3), edge(3, 4), edge(4, 5)], 3);
  const source = readFileSync(new URL("./ExecutionFlowStrip.tsx", import.meta.url), "utf8")
    .replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g, " ")
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .split(/\r?\n/)
    .filter((line) => !/^\s*\/\//.test(line))
    .join("\n");

  test("🔵 주석 걷어내기가 실제로 돌고 있다", () => {
    assert.ok(readFileSync(new URL("./ExecutionFlowStrip.tsx", import.meta.url), "utf8").includes("🔴"));
    assert.ok(!source.includes("🔴"), "주석이 남으면 아래 「없어야 한다」가 주석만 보고 깨진다");
  });

  test("🔴 **칸은** 눌러도 아무 일이 없다 — 띠가 제 손으로 만든 단추도 링크도 없다", () => {
    // 🔵 2026-11-02(조각 10): 자리를 옮기는 길이 생겼다 — 다만 띠의 칸이 아니라
    //    상자 머리줄의 [전체 단계 보기]가 여는 창에서다. 여기서 재는 것은
    //    **칸에는 여전히 누를 것이 없다**는 것과, 띠가 제 안에 누르는 길을
    //    적어 두지 않았다(단추는 슬롯으로 받는다)는 것이다.
    assert.ok(!/<button/.test(html) && !/<a[\s>]/.test(html), "그려진 띠에 누를 것이 있다");
    assert.ok(!/onClick/.test(source) && !/href=/.test(source), "원본에 누르는 길이 적혀 있다");
    assert.ok(!/next\/link/.test(source));
    assert.ok(!/ExecutionStepsDialog|ExecutionExtraTaskDialog/.test(source), "단추를 직접 import 하면 이 시험이 import 에서 던진다");
  });

  test("🔴 편집기 그림(React Flow)을 끌어들이지 않는다", () => {
    assert.ok(!/ProcedureFlowGraph/.test(source));
    assert.ok(!/@xyflow/.test(source));
    assert.ok(!/"use client"/.test(source), "서버 컴포넌트다 — 클라이언트로 내리면 띠 하나에 번들이 따라간다");
  });

  test("가로로 넘치면 가로 스크롤이 되고, 칸은 접히지 않는다", () => {
    assert.ok(html.includes("overflow-x-auto"), "좁은 폰에서 칸이 잘리면 차례를 못 읽는다");
    assert.ok(html.includes("w-max"), "칸이 줄바꿈되면 띠가 세로로 자란다");
    // 🔴 **칸이 늘어선 자리**만 본다(2026-11-02, 조각 10). 상자 머리줄은 폰에서
    //    일부러 접히게 했고(제목 한 줄 · 단추 둘이 그 아래), 띠 전체에서
    //    flex-wrap 을 금지하면 그 머리줄 때문에 여기가 깨진다 — 재던 것은
    //    머리줄이 아니라 칸 줄이다.
    const stripAt = html.indexOf("overflow-x-auto");
    assert.ok(stripAt > 0, "칸이 늘어선 자리를 못 찾으면 아래가 아무것도 안 잰다");
    assert.ok(!html.slice(stripAt).includes("flex-wrap"), "칸이 줄바꿈되면 띠가 세로로 자란다");
  });

  test("🔴 세로로는 안 자란다 — 제목은 두 줄에서 자르고, 갈래 이름 줄은 늘 자리를 잡는다", () => {
    assert.ok(html.includes("line-clamp-2"), "긴 제목이 칸 높이를 끌고 다니면 띠가 세로로 자란다");
    const chips = [...html.matchAll(/data-flow-chip="/g)].length;
    const labelLines = [...html.matchAll(/h-4/g)].length;
    assert.ok(chips > 0, "표본 확인 — 칸이 실제로 있다");
    assert.equal(labelLines, chips, "갈래 이름이 없는 칸도 같은 높이를 잡아야 띠 높이가 안 흔들린다");
  });
});

describe("실행 화면이 띠를 어디에 세우고 무엇을 넘기는가", () => {
  const screenRaw = readFileSync(new URL("./ProcedureExecutionScreen.tsx", import.meta.url), "utf8");
  const screen = screenRaw
    .replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g, " ")
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .split(/\r?\n/)
    .filter((line) => !/^\s*\/\//.test(line))
    .join("\n");
  const flat = screen.replace(/\s+/g, " ");

  test("🔵 주석 걷어내기가 실제로 돌고 있다", () => {
    assert.ok(screenRaw.includes("🔴"));
    assert.ok(!screen.includes("🔴"));
  });

  test("🔴 요약 카드와 「지금 할 일」 큰 카드 **사이**에 선다", () => {
    const summaryAt = flat.indexOf("<ProgressSummary");
    const stripAt = flat.indexOf("<ExecutionFlowStrip");
    const currentAt = flat.indexOf("<CurrentTaskCard");
    assert.ok(summaryAt >= 0 && stripAt >= 0 && currentAt >= 0, "셋 다 화면에 있어야 한다");
    assert.ok(summaryAt < stripAt, "요약보다 위로 올라가면 「몇 번째인가」와 멀어진다");
    assert.ok(stripAt < currentAt, "큰 카드보다 아래로 내려가면 큰 카드가 화면 밖으로 밀린다");
  });

  test("🔴 띠가 고르는 노드는 큰 카드와 **같은 하나**다", () => {
    assert.match(flat, /current: currentTask\.kind === "NONE" \? null : currentTask\.node/);
    assert.match(flat, /nodes: executionDetail\.nodes/, "다시 정렬한 배열을 넘기면 차례가 화면마다 달라진다");
    assert.match(flat, /edges: executionDetail\.flowEdges/);
  });

  test("🔴 「그릴 수 있는가」 판정을 화면이 다시 하지 않는다 — 도메인 함수 하나가 정한다", () => {
    assert.match(flat, /const minimap = buildProcedureExecutionMinimap\(\{/);
    assert.ok(!/flowEdges\.length === 0/.test(screen), "화면이 간선 수로 다시 판정하면 두 벌이 된다");
    // 🔵 2026-11-02(조각 10): 단추 슬롯이 붙으면서 한 줄이 여러 줄이 됐다.
    //    재는 뜻은 그대로다 — minimap 을 **그대로** 넘긴다(화면이 다시 가르지 않는다).
    assert.match(flat, /<ExecutionFlowStrip minimap=\{minimap\} /);
  });

  test("🔴 상자 머리줄에 단추 둘을 **슬롯으로** 넘긴다 — 띠가 그것을 직접 물지 않는다", () => {
    // 사용자 결정(2026-11-02) — 「[전체 단계 보기]와 [추가 작업 등록]은
    // [절차 흐름] 상자에 버튼으로 만들어줘」.
    const stripAt = flat.indexOf("<ExecutionFlowStrip");
    const actionsAt = flat.indexOf("actions={", stripAt);
    const slotEnd = flat.indexOf("</>", actionsAt);
    assert.ok(stripAt >= 0 && actionsAt > stripAt && slotEnd > actionsAt, "띠에 단추 슬롯을 안 넘기고 있다");
    const slot = flat.slice(actionsAt, slotEnd);
    assert.ok(slot.includes("<ExecutionStepsDialog"), "[전체 단계 보기]가 상자 안에 없다");
    assert.ok(slot.includes("<ExecutionExtraTaskDialog"), "[추가 작업 등록]이 상자 안에 없다");
  });

  test("남은 것은 그대로다 — 큰 카드와 「실행 이력」 묶음", () => {
    // 🔵 2026-11-02(조각 10): 「실행 가능」·「진행 중」 구역과 그것을 담던
    //    「전체 단계 보기」 묶음이 **팝업으로 옮겨 갔다**(사용자 결정).
    //    🔵 2026-11-03(조각 12): 「완료 / 건너뜀」 카드 구역이 **「실행 이력」의
    //    시간순 줄**이 됐다(사용자 결정 — 노드 번호 차례로는 다시 밟은 기록을
    //    적을 자리가 없었다). 재는 뜻은 그대로다: 띠를 세우면서 아래가 안 사라졌다.
    //    🔴 「차단됨」은 남는다 — 막힌 절차를 푸는 유일한 집이다.
    assert.ok(screen.includes('title="차단됨"'), "차단됨 구역이 사라지면 안 된다");
    assert.ok(screen.includes("<ExecutionHistoryList"), "실행 이력 목록이 사라지면 안 된다");
    assert.ok(screen.includes("<CurrentTaskCard"), "「지금 할 일」 큰 카드는 그대로다");
    // 🔵 2026-11-02(조각 4): 아래 목록은 접힌다. 다만 접는 일은 전부
    // ExecutionFoldSection 이 하고 **화면에는 <details> 가 없다** — 화면이 직접
    // 접으면 「펼친 채로 둘 때」 판정이 두 자리에 생긴다. 접힌 모습 자체는
    // 이웃 execution-list-fold.test.tsx 가 렌더해서 잰다.
    assert.ok(!/<details/.test(screen), "접기는 ExecutionFoldSection 이 한다 — 화면에 <details> 를 다시 적지 않는다");
    assert.ok(!flat.includes("<ExecutionFoldSection group={fold.remaining}>"), "「전체 단계 보기」 묶음이 되살아났다");
    // 🔵 2026-11-02(조각 8): 「지나온 길」의 카드가 「실행 이력」 안으로 들어가면서
    //    group 이 historyFold.fold 가 됐다 — 그 묶음은 그대로 남는다.
    assert.match(flat, /<ExecutionFoldSection group=\{historyFold\.fold\}>/);
  });
});
