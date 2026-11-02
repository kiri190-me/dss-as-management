import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import ExecutionHistoryTimeline from "./ExecutionHistoryTimeline";
import type { ExecutionHistoryRow } from "@/lib/db/queries/procedure-case-execution";

/**
 * 🔴 **되돌리면서 지운 작업 메모가 실행 이력에서 보인다**(2026-11-02, 조각 11 —
 * 사용자 결정: 「한번 지나갔던 노드로 다시 돌아오게 된다면 이전 기록(메모 등)은
 * **실행 이력에 남겠지만**, [지금 할 일]에서는 기존 메모가 보이는 것이 아니라 그
 * 노드를 새로 밟는 것처럼 되야 해」).
 *
 * 왜 화면까지 재는가: 쓰기 쪽이 비우기 전 값을 beforeState 에 옮겨 적어도, **이
 * 화면이 안 그리면 「남는다」가 거짓**이 된다. 사람이 쓴 글이 DB 에는 있는데
 * 화면 어디에도 없는 상태 — 아무도 신고하지 않고, 그 글은 영영 안 읽힌다.
 *
 * 🔵 그려서 잰다. 이 묶음은 서버 액션도 DB 조회도 안 물고 타입만 가져오므로
 * import 가 안 던진다(past-executions-section.test.tsx 와 같은 방법).
 */

function row(overrides: Partial<ExecutionHistoryRow> = {}): ExecutionHistoryRow {
  return {
    id: "h1",
    executionNodeId: "n1",
    actionType: "NODE_REOPENED",
    beforeState: null,
    afterState: null,
    reason: null,
    actorName: "담당자",
    createdAt: "2026-11-02T01:00:00.000Z",
    ...overrides,
  };
}

const MEMO = "FH-CONT 전압 23.4V\n규격 하한";

describe("🔴 실행 이력이 **되돌리면서 지운 작업 메모**를 보여 준다", () => {
  test("🔵 먼저 — 표본이 비어 있지 않다", () => {
    const html = renderToStaticMarkup(<ExecutionHistoryTimeline history={[row()]} />);
    assert.ok(html.includes("담당자"), "표본이 아예 안 그려지면 아래가 아무것도 안 잰다");
    assert.ok(!html.includes("data-cleared-work-memo"), "아무 줄에나 붙으면 이 단언이 공짜로 통과한다");
  });

  test("🔴 지운 메모가 **글자 그대로** 뜬다", () => {
    const html = renderToStaticMarkup(
      <ExecutionHistoryTimeline
        history={[row({ beforeState: { status: "COMPLETED", clearedOnJump: true, workMemo: MEMO } })]}
      />
    );
    assert.ok(html.includes("data-cleared-work-memo"), "지운 메모 줄이 안 그려졌다 — 사람이 쓴 글이 통째로 사라진다");
    assert.ok(html.includes("FH-CONT 전압 23.4V"), "메모 본문이 없다");
    assert.ok(html.includes("규격 하한"), "여러 줄 메모의 뒷줄이 잘렸다");
    // 🔵 줄바꿈을 지켜 그린다 — 작업 메모는 여러 줄로 적힌다.
    assert.match(html, /whitespace-pre-wrap/);
  });

  test("🔴 표시가 없는 줄에는 **안 붙는다** — JSON 칸의 이름만 보고 꺼내면 안 된다", () => {
    const html = renderToStaticMarkup(
      <ExecutionHistoryTimeline history={[row({ actionType: "NODE_COMPLETED", beforeState: { workMemo: "남의 글" } })]} />
    );
    assert.ok(!html.includes("data-cleared-work-memo"));
    assert.ok(!html.includes("남의 글"));
  });

  test("🔵 기존 줄은 그대로다 — 사유와 action 이름이 그 자리에 있다", () => {
    const html = renderToStaticMarkup(
      <ExecutionHistoryTimeline history={[row({ actionType: "NODE_SKIPPED", reason: "이번 건에는 해당 없음" })]} />
    );
    assert.ok(html.includes("작업 건너뜀"), "action 이름이 사라졌다");
    assert.ok(html.includes("사유: 이번 건에는 해당 없음"), "사유 줄이 사라졌다");
  });

  test("이력이 비면 전과 같은 한 줄", () => {
    assert.ok(renderToStaticMarkup(<ExecutionHistoryTimeline history={[]} />).includes("실행 이력이 없습니다"));
  });
});
