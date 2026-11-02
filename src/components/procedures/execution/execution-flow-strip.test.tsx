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

  test("🔴 눌러도 아무 일이 없다 — 단추도 링크도 없다", () => {
    // 「눌러서 그 단계로 건너뛰기」는 절차를 건너뛰는 길을 여는 일이라 따로 정한다.
    assert.ok(!/<button/.test(html) && !/<a[\s>]/.test(html), "그려진 띠에 누를 것이 있다");
    assert.ok(!/onClick/.test(source) && !/href=/.test(source), "원본에 누르는 길이 적혀 있다");
    assert.ok(!/next\/link/.test(source));
  });

  test("🔴 편집기 그림(React Flow)을 끌어들이지 않는다", () => {
    assert.ok(!/ProcedureFlowGraph/.test(source));
    assert.ok(!/@xyflow/.test(source));
    assert.ok(!/"use client"/.test(source), "서버 컴포넌트다 — 클라이언트로 내리면 띠 하나에 번들이 따라간다");
  });

  test("가로로 넘치면 가로 스크롤이 되고, 칸은 접히지 않는다", () => {
    assert.ok(html.includes("overflow-x-auto"), "좁은 폰에서 칸이 잘리면 차례를 못 읽는다");
    assert.ok(html.includes("w-max"), "칸이 줄바꿈되면 띠가 세로로 자란다");
    assert.ok(!html.includes("flex-wrap"));
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
    assert.match(flat, /<ExecutionFlowStrip minimap=\{minimap\} \/>/);
  });

  test("기존 것은 그대로 남아 있다 — 이번 조각은 더하기만 한다", () => {
    for (const title of ["실행 가능", "진행 중", "차단됨", "완료 / 건너뜀"]) {
      assert.ok(screen.includes(`title="${title}"`), `${title} 구역이 사라지면 안 된다`);
    }
    assert.ok(screen.includes("<CurrentTaskCard"), "「지금 할 일」 큰 카드는 그대로다");
    assert.ok(!/<details/.test(screen), "목록 접기는 이 조각이 아니다");
  });
});
