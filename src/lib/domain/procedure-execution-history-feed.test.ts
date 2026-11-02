import { describe, test } from "node:test";
import assert from "node:assert/strict";
import {
  HISTORY_FEED_RECENT_LIMIT,
  buildExecutionHistoryFeed,
  type ExecutionHistoryFeedRow,
  type HistoryFeedHistoryRow,
  type HistoryFeedNode,
} from "./procedure-execution-history-feed";
import type { ProcedureCaseExecutionNodeStatus } from "./procedure-case-execution-types";

/**
 * 「실행 이력」이 **시간순으로 쌓인다**(2026-11-03, 조각 12 — 사용자 결정:
 * 「[실행 이력]이 시간순서대로 누적될 수 있도록 해줘. 지금은 노드 번호대로
 * 정렬되어 있어.(이미 [완료]했던 노드에 다시 돌아오더라도 [실행 이력]이 남을 수
 * 있도록)」 · 「[시각 기록]을 없애줘.」).
 *
 * 🔴 이 묶음의 핵심 단언 셋:
 *   ① 차례가 **시각**이다 — 노드 번호가 아니다.
 *   ② **같은 노드가 여러 줄**로 나온다 — 다시 밟은 기록이 덮이지 않는다.
 *   ③ 전에 끝난 노드 카드가 가지고 있던 것이 **하나도 안 버려진다** — 특히
 *      [재개(되돌림)]가 설 자리(footerNode)가 작업마다 **딱 하나** 있다.
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

/** 이력 한 줄. `at` 은 시각을 읽기 쉽게 적으려고 분 단위로만 쓴다. */
function row(
  id: string,
  at: string,
  overrides: Partial<HistoryFeedHistoryRow> = {}
): HistoryFeedHistoryRow {
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

const idsOf = (rows: ExecutionHistoryFeedRow[]) => rows.map((r) => r.id);

describe("🔵 먼저 — 표본이 비어 있지 않다", () => {
  test("줄이 그려지고, 비면 0 이다", () => {
    const feed = buildExecutionHistoryFeed({ history: [row("h1", "01:00")], nodes: [node(1, "PENDING")] });
    assert.equal(feed.totalCount, 1);
    assert.equal(feed.recent.length, 1);
    assert.equal(buildExecutionHistoryFeed({ history: [], nodes: [] }).totalCount, 0);
  });
});

describe("🔴 차례가 **시각**이다 — 노드 번호가 아니다", () => {
  /**
   * 🔴 표본을 일부러 **노드 번호와 시각이 어긋나게** 만든다. 번호대로 줄 세우면
   * h3 → h1 → h2 가 되고, 시각대로면 h2 → h1 → h3 다. 둘이 같은 표본으로 재면
   * 이 단언이 공짜로 통과한다.
   */
  const history = [
    row("h1", "02:00", { executionNodeId: "e2" }),
    row("h2", "03:00", { executionNodeId: "e3" }),
    row("h3", "01:00", { executionNodeId: "e1" }),
  ];
  const nodes = [node(1, "PENDING"), node(2, "PENDING"), node(3, "PENDING")];

  test("최신이 위다", () => {
    const feed = buildExecutionHistoryFeed({ history, nodes });
    assert.deepEqual(idsOf(feed.recent), ["h2", "h1", "h3"]);
  });

  test("🔴 노드 번호 차례가 **아니다** — 그것이 이 조각이 고친 결함이다", () => {
    const feed = buildExecutionHistoryFeed({ history, nodes });
    assert.notDeepEqual(
      feed.recent.map((r) => r.task?.orderIndex),
      [1, 2, 3],
      "번호 차례로 나오면 다시 밟은 기록이 섞이지 않는다"
    );
    assert.deepEqual(feed.recent.map((r) => r.task?.orderIndex), [3, 2, 1]);
  });

  test("받은 차례(조회가 정한 것)가 이미 최신순이어도 결과는 같다", () => {
    const already = [row("a", "03:00"), row("b", "02:00"), row("c", "01:00")];
    assert.deepEqual(idsOf(buildExecutionHistoryFeed({ history: already, nodes }).recent), ["a", "b", "c"]);
  });
});

describe("🔴 같은 노드가 **여러 줄**로 나온다 — 다시 돌아온 기록이 덮이지 않는다", () => {
  const history = [
    row("h1", "01:00", { executionNodeId: "e1", actionType: "NODE_STARTED" }),
    row("h2", "01:10", { executionNodeId: "e1", actionType: "NODE_COMPLETED" }),
    row("h3", "02:00", { executionNodeId: "e1", actionType: "NODE_REOPENED", reason: "재측정 필요" }),
    row("h4", "02:30", { executionNodeId: "e1", actionType: "NODE_COMPLETED" }),
  ];
  const nodes = [node(1, "COMPLETED")];

  test("한 작업의 네 번이 네 줄로 남는다", () => {
    const feed = buildExecutionHistoryFeed({ history, nodes });
    assert.equal(feed.totalCount, 4, "노드 행으로 그리면 여기서 1 이 된다 — 그것이 옛 화면이었다");
    assert.deepEqual(idsOf(feed.recent), ["h4", "h3", "h2", "h1"]);
    for (const line of feed.recent) assert.deepEqual(line.task, { orderIndex: 1, title: "작업 1" });
  });

  test("🔴 단추가 설 자리는 **가장 최근 줄 하나**뿐이다 — 네 줄에 다 붙으면 되돌리기가 네 개가 된다", () => {
    const feed = buildExecutionHistoryFeed({ history, nodes });
    const withFooter = feed.recent.filter((r) => r.footerNode !== null);
    assert.equal(withFooter.length, 1);
    assert.equal(withFooter[0].id, "h4", "가장 최근 줄이 아니면 목록 한참 아래에 단추가 숨는다");
    assert.equal(withFooter[0].footerNode?.id, "e1");
  });
});

describe("🔴 버린 것이 없다 — 사유 · 작업 메모 · 지운 메모 · 사람 · 시각", () => {
  const MEMO = "FH-CONT 전압 23.4V\n규격 하한";

  test("사유가 줄에 남는다", () => {
    const feed = buildExecutionHistoryFeed({
      history: [row("h1", "01:00", { actionType: "NODE_SKIPPED", reason: "이번 건에는 해당 없음" })],
      nodes: [node(1, "SKIPPED")],
    });
    assert.deepEqual(feed.recent[0].notes, [
      { kind: "REASON", label: "사유", text: "이번 건에는 해당 없음" },
    ]);
    assert.equal(feed.recent[0].actionLabel, "작업 건너뜀");
  });

  test("🔴 **그때 적은 작업 메모**가 그 줄에 남는다 — 고친 기록이 이력에 남는다는 말이 거짓이면 안 된다", () => {
    const feed = buildExecutionHistoryFeed({
      history: [
        row("h1", "01:00", {
          actionType: "NODE_MEMO_UPDATED",
          beforeState: { memo: null },
          afterState: { memo: MEMO },
        }),
      ],
      nodes: [node(1, "IN_PROGRESS", { workMemo: MEMO })],
    });
    assert.deepEqual(feed.recent[0].notes, [{ kind: "MEMO", label: "작업 메모", text: MEMO }]);
  });

  test("메모를 **비운** 저장은 그렇다고 적는다 — 아무것도 없는 줄을 남기지 않는다", () => {
    const feed = buildExecutionHistoryFeed({
      history: [row("h1", "01:00", { actionType: "NODE_MEMO_UPDATED", beforeState: { memo: MEMO }, afterState: { memo: null } })],
      nodes: [node(1, "IN_PROGRESS")],
    });
    assert.deepEqual(feed.recent[0].notes, []);
    assert.equal(feed.recent[0].via, "작업 메모를 비웠습니다.");
  });

  test("🔴 **되돌리면서 지운 작업 메모**가 남는다(조각 11 이 더한 줄)", () => {
    const feed = buildExecutionHistoryFeed({
      history: [
        row("h1", "01:00", {
          actionType: "NODE_REOPENED",
          beforeState: { status: "COMPLETED", clearedOnJump: true, workMemo: MEMO },
          afterState: { reopenedByJump: true },
        }),
      ],
      nodes: [node(1, "PENDING")],
    });
    assert.deepEqual(feed.recent[0].notes, [
      { kind: "CLEARED_MEMO", label: "되돌리면서 지운 작업 메모", text: MEMO },
    ]);
  });

  test("🔴 표시가 없는 줄에는 **안 붙는다** — JSON 칸의 이름만 보고 꺼내면 안 된다", () => {
    const feed = buildExecutionHistoryFeed({
      history: [row("h1", "01:00", { actionType: "NODE_COMPLETED", beforeState: { workMemo: "남의 글" } })],
      nodes: [node(1, "COMPLETED")],
    });
    assert.deepEqual(feed.recent[0].notes, []);
  });

  test("누가 · 언제가 줄마다 있다", () => {
    const feed = buildExecutionHistoryFeed({
      history: [row("h1", "01:00", { actorName: "홍길동" })],
      nodes: [node(1, "PENDING")],
    });
    assert.equal(feed.recent[0].actorName, "홍길동");
    assert.equal(feed.recent[0].createdAt, "2026-11-03T01:00:00.000Z");
  });

  test("🔴 끝난 작업의 **시작/완료한 사람과 시각 · 메모 · 최근 사유**가 그 줄에 실린다", () => {
    const finished = node(1, "COMPLETED", {
      workMemo: MEMO,
      lastActionReason: "교환 후 재측정 완료",
      startedByName: "홍길동",
      startedAt: "2026-11-03T00:50:00.000Z",
      completedByName: "홍길동",
      completedAt: "2026-11-03T01:00:00.000Z",
    });
    const feed = buildExecutionHistoryFeed({
      history: [row("h1", "01:00", { actionType: "NODE_COMPLETED" })],
      nodes: [finished],
    });
    assert.deepEqual(feed.recent[0].footerNode, finished, "카드가 적던 것이 한 칸이라도 빠지면 그 정보가 화면에서 사라진다");
  });
});

describe("🔴 끝났는데 이력 줄이 없는 작업 — 줄을 **만들어 넣는다**", () => {
  /**
   * 🔴 없으면 그 작업에는 [재개(되돌림)]가 설 자리가 아예 없어진다 — 되돌릴 길이
   * 화면에서 사라진다. 실측(2026-11-03, 개발 DB)으로는 START 표식 10개뿐이고 그
   * 줄은 애초에 화면 목록에 안 나오지만, 「없을 리 없다」에 기대어 단추를 지우지는
   * 않는다.
   */
  test("완료인데 이력이 없으면 한 줄이 생기고, 거기에 단추가 선다", () => {
    const orphan = node(1, "COMPLETED", { completedAt: "2026-11-03T01:00:00.000Z", completedByName: "홍길동" });
    const feed = buildExecutionHistoryFeed({ history: [], nodes: [orphan] });
    assert.equal(feed.totalCount, 1);
    assert.equal(feed.recent[0].id, "synthetic:e1");
    assert.equal(feed.recent[0].actionLabel, "작업 완료");
    assert.equal(feed.recent[0].actorName, "홍길동");
    assert.equal(feed.recent[0].footerNode?.id, "e1");
    assert.match(feed.recent[0].via ?? "", /이력 줄이 없어/);
  });

  test("건너뜀도 같다 — 사유는 노드에 남은 값으로 적는다", () => {
    const feed = buildExecutionHistoryFeed({
      history: [],
      nodes: [node(2, "SKIPPED", { lastActionReason: "이번 건에는 해당 없음" })],
    });
    assert.equal(feed.recent[0].actionLabel, "작업 건너뜀");
    assert.deepEqual(feed.recent[0].notes, [{ kind: "REASON", label: "사유", text: "이번 건에는 해당 없음" }]);
  });

  test("🔴 시각을 **지어내지 않는다** — 모르면 null 이고 맨 아래로 간다", () => {
    const feed = buildExecutionHistoryFeed({
      history: [row("h1", "01:00", { executionNodeId: "e9" })],
      nodes: [node(9, "PENDING"), node(2, "SKIPPED")],
    });
    assert.equal(feed.recent[1].id, "synthetic:e2", "시각 모르는 줄이 맨 위에 서면 방금 일어난 일로 읽힌다");
    assert.equal(feed.recent[1].createdAt, null);
  });

  test("🔵 거꾸로 — 이력 줄이 **있으면** 만들어 넣지 않는다(같은 작업이 두 번 세어진다)", () => {
    const feed = buildExecutionHistoryFeed({
      history: [row("h1", "01:00", { executionNodeId: "e1", actionType: "NODE_COMPLETED" })],
      nodes: [node(1, "COMPLETED")],
    });
    assert.equal(feed.totalCount, 1);
    assert.ok(!idsOf(feed.recent).some((id) => id.startsWith("synthetic:")));
  });

  test("아직 안 끝난 작업에는 줄을 안 만든다 — 아직 일어난 일이 없다", () => {
    const feed = buildExecutionHistoryFeed({
      history: [],
      nodes: [node(1, "PENDING"), node(2, "IN_PROGRESS"), node(3, "BLOCKED")],
    });
    assert.equal(feed.totalCount, 0);
  });
});

describe("단추가 붙는 자리 — 끝난 작업에만, 작업마다 하나씩", () => {
  test("🔵 먼저 — 끝난 작업 둘이 각각 제 줄을 가진다", () => {
    const feed = buildExecutionHistoryFeed({
      history: [
        row("h1", "01:00", { executionNodeId: "e1", actionType: "NODE_COMPLETED" }),
        row("h2", "02:00", { executionNodeId: "e2", actionType: "NODE_SKIPPED", reason: "해당 없음" }),
      ],
      nodes: [node(1, "COMPLETED"), node(2, "SKIPPED")],
    });
    assert.deepEqual(
      feed.recent.filter((r) => r.footerNode).map((r) => r.footerNode?.id),
      ["e2", "e1"]
    );
  });

  test("🔴 진행 중·대기·차단됨에는 **안 붙는다** — 그 둘은 제 카드가 따로 있다", () => {
    const feed = buildExecutionHistoryFeed({
      history: [
        row("h1", "01:00", { executionNodeId: "e1" }),
        row("h2", "02:00", { executionNodeId: "e2" }),
        row("h3", "03:00", { executionNodeId: "e3", actionType: "NODE_BLOCKED", reason: "부품 대기" }),
      ],
      nodes: [node(1, "PENDING"), node(2, "IN_PROGRESS"), node(3, "BLOCKED")],
    });
    assert.deepEqual(feed.recent.filter((r) => r.footerNode).map((r) => r.id), []);
  });

  test("노드에 안 붙은 줄(실행 시작)은 작업 이름이 없다 — 번호를 지어내지 않는다", () => {
    const feed = buildExecutionHistoryFeed({
      history: [row("h1", "01:00", { executionNodeId: null, actionType: "EXECUTION_STARTED" })],
      nodes: [node(1, "PENDING")],
    });
    assert.equal(feed.recent[0].task, null);
    assert.equal(feed.recent[0].actionLabel, "실행 시작");
  });
});

describe("「어떻게 일어났는가」 한 마디 — 쓰기 쪽이 남긴 표시로만", () => {
  const cases: [string, Partial<HistoryFeedHistoryRow>, RegExp][] = [
    ["옮겨 온 줄", { actionType: "NODE_STARTED", afterState: { jumpedTo: true } }, /옮겨 왔습니다/],
    ["저절로 선 줄", { actionType: "NODE_STARTED", afterState: { autoAdvanced: true } }, /저절로 섰습니다/],
    ["중간부터 시작", { actionType: "NODE_STARTED", afterState: { startedMidProcedure: true } }, /중간부터/],
    ["함께 완료", { actionType: "NODE_COMPLETED", afterState: { completedByJump: true } }, /함께 완료/],
    ["함께 되돌림", { actionType: "NODE_REOPENED", afterState: { reopenedByJump: true } }, /경로 밖/],
    ["다시 이음", { actionType: "EXECUTION_STARTED", afterState: { resumed: true } }, /다시 이었습니다/],
  ];

  for (const [what, overrides, pattern] of cases) {
    test(`${what} 에는 까닭이 적힌다`, () => {
      const feed = buildExecutionHistoryFeed({
        history: [row("h1", "01:00", overrides)],
        nodes: [node(1, "PENDING")],
      });
      assert.match(feed.recent[0].via ?? "", pattern);
    });
  }

  test("🔴 표시가 없으면 **아무 말도 안 적는다** — 사람이 누른 [시작]에 까닭을 붙이면 거짓이 된다", () => {
    const feed = buildExecutionHistoryFeed({
      history: [row("h1", "01:00", { actionType: "NODE_STARTED", afterState: { assignedEngineerId: "u1" } })],
      nodes: [node(1, "IN_PROGRESS")],
    });
    assert.equal(feed.recent[0].via, null);
  });

  test("JSON 칸이 무엇이든 안 터진다 — beforeState·afterState 는 타입이 없다", () => {
    for (const state of [null, undefined, 0, "글자", [], true]) {
      const feed = buildExecutionHistoryFeed({
        history: [row("h1", "01:00", { beforeState: state, afterState: state })],
        nodes: [node(1, "PENDING")],
      });
      assert.equal(feed.recent[0].via, null);
      assert.deepEqual(feed.recent[0].notes, []);
    }
  });
});

describe("🔴 길면 한 겹 더 접는다 — 버리지는 않는다", () => {
  /** 실측(2026-11-03): 한 실행의 이력이 90줄, 노드 28개. 그 모양을 닮은 표본. */
  const MEASURED_LONGEST = 90;
  const longHistory = Array.from({ length: MEASURED_LONGEST }, (_, i) =>
    row(`h${i}`, `${String(1 + Math.floor(i / 60)).padStart(2, "0")}:${String(i % 60).padStart(2, "0")}`)
  );

  test("최근 50줄만 펼쳐 두고 나머지는 접는다", () => {
    const feed = buildExecutionHistoryFeed({ history: longHistory, nodes: [node(1, "PENDING")] });
    assert.equal(HISTORY_FEED_RECENT_LIMIT, 50);
    assert.equal(feed.totalCount, MEASURED_LONGEST);
    assert.equal(feed.recent.length, 50);
    assert.equal(feed.older.length, 40);
  });

  test("🔴 접힌 쪽에도 **버린 줄이 없다** — 합이 전체와 같다", () => {
    const feed = buildExecutionHistoryFeed({ history: longHistory, nodes: [node(1, "PENDING")] });
    assert.equal(feed.recent.length + feed.older.length, feed.totalCount);
    const ids = new Set([...idsOf(feed.recent), ...idsOf(feed.older)]);
    assert.equal(ids.size, MEASURED_LONGEST);
  });

  test("🔴 접히는 것은 **오래된 쪽**이다 — 최근 것이 숨으면 안 된다", () => {
    const feed = buildExecutionHistoryFeed({ history: longHistory, nodes: [node(1, "PENDING")], recentLimit: 3 });
    assert.deepEqual(idsOf(feed.recent), ["h89", "h88", "h87"]);
    assert.equal(feed.older[0].id, "h86");
  });

  test("짧으면 접을 것이 없다", () => {
    const feed = buildExecutionHistoryFeed({ history: [row("h1", "01:00")], nodes: [node(1, "PENDING")] });
    assert.deepEqual(feed.older, []);
  });
});
