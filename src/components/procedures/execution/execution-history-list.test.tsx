import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import ExecutionHistoryList from "./ExecutionHistoryList";
import {
  buildExecutionHistoryFeed,
  type HistoryFeedHistoryRow,
  type HistoryFeedNode,
} from "@/lib/domain/procedure-execution-history-feed";
import type { ProcedureCaseExecutionNodeStatus } from "@/lib/domain/procedure-case-execution-types";

/**
 * 「실행 이력」 목록이 **실제로 무엇을 그리는가**(2026-11-03, 조각 12).
 *
 * 그려서 잰다 — 이 묶음은 서버 액션도 DB 조회 타입도 안 물게 적었고, 단추와 메모
 * 칸은 슬롯으로 받는다(이웃 execution-list-fold.test.tsx 와 같은 방법).
 *
 * 🔴 여기서 재는 것은 **화면에서만 드러나는** 것들이다:
 *   ① 「시각 기록」이라는 제목이 **없다**(묶음 안이 하나가 됐다).
 *   ② 같은 작업이 **여러 줄**로 보인다.
 *   ③ 단추·메모 칸이 **끝난 작업의 한 줄에만** 그려진다.
 */

function node(
  n: number,
  status: ProcedureCaseExecutionNodeStatus,
  extra: Partial<HistoryFeedNode> = {}
): HistoryFeedNode {
  return {
    id: `e${n}`,
    orderIndex: n,
    title: `작업 ${n}`,
    status,
    version: 1,
    workMemo: null,
    lastActionReason: null,
    effectiveAssigneeId: "u1",
    effectiveAssigneeName: "담당자",
    startedByName: null,
    startedAt: null,
    completedByName: null,
    completedAt: null,
    ...extra,
  };
}

function row(id: string, at: string, overrides: Partial<HistoryFeedHistoryRow> = {}): HistoryFeedHistoryRow {
  return {
    id,
    executionNodeId: "e1",
    actionType: "NODE_STARTED",
    beforeState: null,
    afterState: null,
    reason: null,
    actorName: "담당자",
    createdAt: `2026-11-03T${at}:00.000Z`,
    ...overrides,
  };
}

function render(history: HistoryFeedHistoryRow[], nodes: HistoryFeedNode[], recentLimit?: number): string {
  return renderToStaticMarkup(
    <ExecutionHistoryList
      feed={buildExecutionHistoryFeed({ history, nodes, recentLimit })}
      renderNodeActions={(target) => <span data-fake-node-actions>{target.id} 의 단추와 메모 칸</span>}
    />
  );
}

/** 그려진 줄 수. 「같은 작업이 여러 줄로 남는가」를 이것으로 센다. */
const rowCount = (html: string) => (html.match(/data-history-row/g) ?? []).length;

/** 줄마다의 행위 이름을 차례대로 — 「시간순인가」를 이것으로 센다. */
const actionLabels = (html: string) =>
  [...html.matchAll(/<span class="font-medium">([^<]+)<\/span>/g)].map((m) => m[1]);

/** 한 작업을 네 번 밟은 실행 — 시작 · 완료 · 되돌림 · 다시 완료. */
const REVISITED = [
  row("h1", "01:00", { actionType: "NODE_STARTED" }),
  row("h2", "01:10", { actionType: "NODE_COMPLETED" }),
  row("h3", "02:00", { actionType: "NODE_REOPENED", reason: "재측정 필요" }),
  row("h4", "02:30", { actionType: "NODE_COMPLETED" }),
];

describe("🔵 먼저 — 렌더가 실제로 돌고 있다", () => {
  test("줄이 그려지고, 비면 그렇게 말한다", () => {
    const html = render([row("h1", "01:00")], [node(1, "PENDING")]);
    assert.ok(html.includes("data-history-row"), "줄이 하나도 안 그려지면 아래가 전부 뜻을 잃는다");
    assert.ok(html.includes("작업 1"));
    assert.ok(render([], []).includes("실행 이력이 없습니다"));
  });
});

describe("🔴 「시각 기록」이 없다 — 묶음 안이 하나가 됐다", () => {
  test("제목도 머릿수도 안 그려진다", () => {
    const html = render(REVISITED, [node(1, "COMPLETED")]);
    assert.ok(!html.includes("시각 기록"), "둘로 나뉜 옛 모습이 남아 있다");
    assert.ok(!html.includes("완료 / 건너뜀"), "노드 카드 구역이 되살아났다 — 그러면 번호 차례가 다시 생긴다");
  });

  test("🔵 대신 **무엇을 보고 있는지**를 한 줄로 적는다 — 같은 이름이 거듭 뜨는 까닭", () => {
    const html = render(REVISITED, [node(1, "COMPLETED")]);
    assert.ok(html.includes("최근 것이 위입니다"), "차례를 안 적으면 사람이 매번 다시 확인해야 한다");
    assert.ok(html.includes("다시 돌아온 기록"), "같은 작업이 거듭 뜨는 것을 「목록이 잘못됐다」로 읽는다");
  });
});

describe("🔴 같은 작업이 **여러 줄**로 보인다 — 시간순으로", () => {
  test("네 번 밟은 작업이 네 줄로, 최신이 위에", () => {
    const html = render(REVISITED, [node(1, "COMPLETED")]);
    assert.equal(rowCount(html), 4, "노드 행으로 그리면 여기서 1 줄이 된다 — 그것이 옛 화면이었다");
    assert.deepEqual(
      actionLabels(html),
      ["작업 완료", "작업 재개(되돌림)", "작업 완료", "작업 시작"],
      "시간순이 아니면 되돌린 뒤의 완료가 먼저 보이지 않는다"
    );
  });

  test("🔴 번호와 제목이 줄마다 적힌다 — 어느 작업의 기록인지 모르면 목록이 쓸모없다", () => {
    const html = render(
      [row("h1", "01:00", { executionNodeId: "e2" })],
      [node(2, "PENDING", { title: "MCU 기판 교환" })]
    );
    assert.ok(html.includes("2. "), "번호가 없다");
    assert.ok(html.includes("MCU 기판 교환"), "제목이 없다");
  });

  test("노드에 안 붙은 줄은 「이 실행」으로 — 없는 번호를 지어내지 않는다", () => {
    const html = render(
      [row("h1", "01:00", { executionNodeId: null, actionType: "EXECUTION_STARTED" })],
      [node(1, "PENDING")]
    );
    assert.ok(html.includes("이 실행"));
    assert.ok(html.includes("실행 시작"));
  });
});

describe("🔴 단추와 메모 칸은 **끝난 작업의 한 줄에만** 선다", () => {
  test("네 줄 가운데 가장 최근 줄에 딱 한 번", () => {
    const html = render(REVISITED, [node(1, "COMPLETED")]);
    assert.equal((html.match(/data-fake-node-actions/g) ?? []).length, 1, "같은 작업에 단추가 여럿 뜬다");
    assert.equal((html.match(/data-history-node-footer/g) ?? []).length, 1);
    // 🔴 **맨 위 줄**이어야 한다 — 목록 한참 아래에 숨으면 못 찾는다.
    const firstRowAt = html.indexOf("data-history-row");
    const secondRowAt = html.indexOf("data-history-row", firstRowAt + 1);
    assert.ok(html.indexOf("data-fake-node-actions") < secondRowAt, "단추가 첫 줄이 아닌 곳에 붙었다");
  });

  test("🔴 끝난 작업의 **지금 모습**이 그 자리에 적힌다 — 카드가 적던 넷", () => {
    const html = render(
      [row("h1", "01:00", { actionType: "NODE_COMPLETED" })],
      [
        node(1, "COMPLETED", {
          startedByName: "홍길동",
          startedAt: "2026-11-03T00:50:00.000Z",
          completedByName: "홍길동",
          completedAt: "2026-11-03T01:00:00.000Z",
          lastActionReason: "교환 후 재측정 완료",
        }),
      ]
    );
    assert.ok(html.includes("지금 상태: 완료"));
    assert.ok(html.includes("담당: 담당자"));
    assert.ok(html.includes("시작: 홍길동"));
    assert.ok(html.includes("완료: 홍길동"));
    assert.ok(html.includes("최근 사유: 교환 후 재측정 완료"));
  });

  test("🔵 반대로 — 아직 안 끝난 작업에는 **안 붙는다**(그 둘은 제 카드가 따로 있다)", () => {
    const html = render([row("h1", "01:00")], [node(1, "IN_PROGRESS")]);
    assert.ok(!html.includes("data-fake-node-actions"), "진행 중인 작업에까지 붙으면 단추가 화면에 두 벌이 된다");
    assert.ok(!html.includes("data-history-node-footer"));
  });
});

describe("🔴 시각을 지어내지 않는다", () => {
  test("모르는 줄은 「시각 모름」이라고 적는다", () => {
    const html = render([], [node(1, "SKIPPED", { lastActionReason: "해당 없음" })]);
    assert.ok(html.includes("시각 모름"), "Invalid Date 가 뜨거나 지금 시각이 찍히면 안 된다");
    assert.ok(!html.includes("Invalid Date"));
    assert.ok(html.includes("이력 줄이 없어"), "만들어 넣은 줄이라는 사실을 안 적으면 진짜 기록으로 읽힌다");
  });
});

describe("🔴 긴 목록은 한 겹 더 접되 **버리지 않는다**", () => {
  const many = Array.from({ length: 6 }, (_, i) => row(`h${i}`, `0${i + 1}:00`));

  test("접힌 줄이 몇 줄인지 적히고, 그 안에 실제로 들어 있다", () => {
    const html = render(many, [node(1, "PENDING")], 2);
    assert.ok(html.includes("더 오래된 4줄 보기"), "몇 줄이 접혔는지 안 적으면 목록이 잘린 줄 모른다");
    assert.ok(html.includes("data-history-older"));
    assert.equal(rowCount(html), 6, "접힌 줄이 DOM 에서도 사라지면 찾기로도 못 찾는다");
  });

  test("짧으면 접는 줄 자체가 없다", () => {
    const html = render([row("h1", "01:00")], [node(1, "PENDING")]);
    assert.ok(!html.includes("data-history-older"));
    assert.ok(!html.includes("더 오래된"));
  });
});

describe("🔴 서버 컴포넌트로 남는다 — 목록 때문에 \"use client\" 가 늘지 않았다", () => {
  const stripComments = (source: string) =>
    source
      .replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g, " ")
      .replace(/\/\*[\s\S]*?\*\//g, " ")
      .split(/\r?\n/)
      .filter((line) => !/^\s*\/\//.test(line))
      .join("\n");

  const listRaw = readFileSync(new URL("./ExecutionHistoryList.tsx", import.meta.url), "utf8");
  const list = stripComments(listRaw);
  const clientRaw = readFileSync(new URL("./ExecutionMemoField.tsx", import.meta.url), "utf8");

  test("🔵 주석 걷어내기와 「use client」 찾기가 실제로 듣는다", () => {
    assert.ok(listRaw.includes("🔴") && !list.includes("🔴"));
    assert.match(stripComments(clientRaw), /^\s*"use client";/, "표본 확인 — 진짜 클라이언트 파일은 이 잣대에 걸린다");
  });

  test('목록 자신은 클라이언트가 아니다 — 단추는 **슬롯**으로 받는다', () => {
    assert.ok(!/"use client"/.test(list), "목록이 클라이언트가 되면 아래 트리가 통째로 따라 내려간다");
    assert.ok(!/useState|useEffect/.test(list));
    assert.ok(!/server\/actions/.test(list), "서버 액션을 물면 이 시험이 import 에서 바로 던진다");
    assert.match(list.replace(/\s+/g, " "), /renderNodeActions\(row\.footerNode\)/);
  });

  test("🔴 어느 줄에 단추가 붙는지를 **목록이 다시 정하지 않는다** — 도메인이 정해 온 그대로다", () => {
    assert.ok(
      !/status === "COMPLETED"|status === "SKIPPED"/.test(list),
      "목록이 상태를 다시 가르면 판정이 두 벌이 되고, 단추가 두 줄에 뜨거나 한 줄도 안 뜬다"
    );
  });
});
