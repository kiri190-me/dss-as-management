import { describe, test } from "node:test";
import assert from "node:assert/strict";
import {
  buildWorkRecordProcedureLink,
  type WorkRecordProcedureLinkCandidate,
} from "./procedure-execution-work-record-link";
import { pickCurrentTaskNode } from "./procedure-execution-focus";
import type { ProcedureCaseExecutionNodeStatus } from "./procedure-case-execution-types";

/**
 * 작업 기록을 **어느 절차 항목에 붙일 것인가**(2026-11-02, 조각 5).
 *
 * 전에는 드롭다운이 IN_PROGRESS 인 노드만 담고 기본값이 「연결 안 함」이라,
 * 사람이 매번 손으로 바꿔야 이어졌고 대부분 안 이어졌다. 여기서 재는 것은
 * 그 둘이다 — **기본값이 「지금 할 일」인가**, **담는 조건이 넓어졌는가**.
 */

function node(
  id: string,
  orderIndex: number,
  title: string,
  status: ProcedureCaseExecutionNodeStatus
): WorkRecordProcedureLinkCandidate {
  return { id, orderIndex, title, status };
}

/**
 * 절차 차례대로다(조회가 그렇게 내려준다). 🔴 [시작] 없이 바로 완료한 노드
 * (x1)와, 아직 아무도 손대지 않은 「지금 할 일」(x3, 대기)이 둘 다 들어 있다 —
 * 전에는 **둘 다** 드롭다운에 안 나타났다.
 */
const NODES = [
  node("x1", 1, "외관 점검", "COMPLETED"),
  node("x2", 2, "분해", "SKIPPED"),
  node("x3", 3, "정류 다이오드 전압 점검", "PENDING"),
  node("x4", 4, "FH-SEQ 신호 점검", "PENDING"),
  node("x5", 5, "부품 입고 대기", "BLOCKED"),
];

describe("🔵 먼저 — 표본이 재려는 것을 담고 있다", () => {
  test("진행 중인 노드가 **하나도 없다** — 옛 규칙이었다면 목록이 비었을 판이다", () => {
    assert.equal(
      NODES.filter((n) => n.status === "IN_PROGRESS").length,
      0,
      "진행 중이 섞여 있으면 「넓혔다」를 재는 것이 아니다"
    );
  });

  test("「지금 할 일」은 같은 함수가 고른다 — 여기서 따로 고르지 않는다", () => {
    assert.equal(pickCurrentTaskNode(NODES, { isExecutionFinished: false })?.id, "x3", "조각 2 의 규칙상 가장 앞선 대기가 지금 할 일이다");
  });
});

describe("기본값은 「지금 할 일」이다", () => {
  const link = buildWorkRecordProcedureLink({ nodes: NODES, currentTaskNodeId: "x3" });

  test("처음 골라져 있는 것이 지금 할 일 노드다", () => {
    assert.equal(link.defaultNodeId, "x3");
  });

  test("그 줄에 「지금 할 일」이라고 적혀 있다 — 고른 것이 무엇인지 글자로 보여야 한다", () => {
    const current = link.options.find((o) => o.id === "x3");
    assert.equal(current?.label, "3. 정류 다이오드 전압 점검 · 지금 할 일");
  });

  test("🔴 지금 할 일이 없으면(다 끝났거나 전부 차단됨) 기본값은 null — 아무거나 고르지 않는다", () => {
    const none = buildWorkRecordProcedureLink({ nodes: NODES, currentTaskNodeId: null });
    assert.equal(none.defaultNodeId, null);
    assert.equal(none.options.length, NODES.length, "기본값이 없어도 고를 것은 그대로 있다");
  });

  test("🔴 목록에 없는 id 는 기본값으로 쓰지 않는다 — <select> 가 빈 값을 고른 것처럼 보낸다", () => {
    const stale = buildWorkRecordProcedureLink({ nodes: NODES, currentTaskNodeId: "없는-노드" });
    assert.equal(stale.defaultNodeId, null);
  });
});

describe("🔴 담는 조건을 넓혔다 — 「진행 중」만 담으면 안 보이는 것이 있다", () => {
  const link = buildWorkRecordProcedureLink({ nodes: NODES, currentTaskNodeId: "x3" });

  test("완료·건너뜀·차단됨까지 **전부** 담는다", () => {
    assert.deepEqual(link.options.map((o) => o.id), ["x1", "x2", "x3", "x4", "x5"]);
  });

  test("바로 완료한 노드도 고를 수 있다 — 일을 끝내고 기록을 적는 것이 보통 차례다", () => {
    assert.equal(link.options.find((o) => o.id === "x1")?.label, "1. 외관 점검 · 완료");
  });

  test("지금 할 일이 아닌 줄에는 **상태**가 적힌다", () => {
    assert.equal(link.options.find((o) => o.id === "x2")?.label, "2. 분해 · 건너뜀");
    assert.equal(link.options.find((o) => o.id === "x5")?.label, "5. 부품 입고 대기 · 차단됨");
    assert.equal(link.options.find((o) => o.id === "x4")?.label, "4. FH-SEQ 신호 점검 · 대기");
  });

  test("번호가 안 매겨진 줄(0)은 번호를 안 적는다", () => {
    const extra = buildWorkRecordProcedureLink({
      nodes: [node("x9", 0, "이번 건만의 추가 작업", "PENDING")],
      currentTaskNodeId: null,
    });
    assert.equal(extra.options[0].label, "이번 건만의 추가 작업 · 대기");
  });

  test("차례를 다시 매기지 않는다 — 받은 그대로다(번호가 1, 2, 3 … 으로 흘러야 훑을 수 있다)", () => {
    const reversed = [...NODES].reverse();
    assert.deepEqual(
      buildWorkRecordProcedureLink({ nodes: reversed, currentTaskNodeId: "x3" }).options.map((o) => o.id),
      ["x5", "x4", "x3", "x2", "x1"]
    );
  });

  test("노드가 없으면 고를 것도 없다 — 화면이 드롭다운 자체를 안 그린다", () => {
    const empty = buildWorkRecordProcedureLink({ nodes: [], currentTaskNodeId: null });
    assert.deepEqual(empty.options, []);
    assert.equal(empty.defaultNodeId, null);
  });
});
