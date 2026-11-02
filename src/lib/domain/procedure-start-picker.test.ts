import { describe, test } from "node:test";
import assert from "node:assert/strict";
import {
  classifyStartNode,
  findStartNode,
  flattenNodeTitle,
  indexStartPickerNodes,
  resolveStartButtonState,
  searchStartNodes,
  START_PICKER_RESULT_LIMIT,
  type StartPickerNode,
  type StartPickerTemplate,
} from "./procedure-start-picker";
import type { ProcedureNodeType } from "./procedure-template-types";

/**
 * 「기술 절차 불러오기」 창의 판정(2026-11-02, 조각 7).
 *
 * ──────────────────────────────────────────────────────────────────────
 * 표본은 꾸며내지 않았다 — 개발 DB 의 게시된 절차 둘을 그대로 옮겼다
 * ──────────────────────────────────────────────────────────────────────
 * 실측(2026-11-02)으로 게시돼 있고 실행에 쓸 수 있는 절차는 둘뿐이다:
 *
 *   - 「원복 검사 및 개선 작업 (3상 입력)」 code=7, 노드 23(START 1 + 할 일 22),
 *     간선 8. 15개가 아무 선에도 안 닿아 있다.
 *   - 「기본 통전 검사 (3상 입력)」 code=이름과 같음, 노드 28(START 1 + 할 일 27),
 *     간선 42.
 *
 * 🔴 **지시서에 적힌 「MCU 신호 점검이 두 절차에 있다」는 사실이 아니었다.** 세어
 * 보니 그 이름은 원복에만 있다(19번). 절차를 **가로질러** 겹치는 이름은
 * 「MCU 기판 교환」(원복 20번 · 기본 통전 22번)과 「일본 교산에 연락」(원복 10번 ·
 * 기본 통전 19번)이다. 중복을 재는 시험은 실제로 겹치는 그 이름으로 적었다 —
 * 안 그러면 「구별된다」가 표본이 비어서 공짜로 통과한다.
 */

type TestNode = StartPickerNode & { marker?: string };

function node(sortOrder: number, title: string, nodeType: ProcedureNodeType = "DECISION"): TestNode {
  return { id: `n-${sortOrder}-${title}`, title, nodeType, nodeCode: `manual-${sortOrder}`, sortOrder };
}

/** 실측 「원복 검사 및 개선 작업 (3상 입력)」의 sort_order·제목·종류 그대로(일부). */
const RESTORE: StartPickerTemplate<TestNode> = {
  id: "tpl-restore",
  code: "7",
  name: "원복 검사 및 개선 작업 (3상 입력)",
  nodes: [
    node(0, "확인된 고장품, 예방교환 부품 교환 및 조정, 개선 작업 실시", "START"),
    node(1, "440V INPUT 케이블 및 \n데이터 검사용 계측기 연결", "TASK"),
    node(6, "FH-SEQ 신호 점검"),
    node(10, "일본 교산에 연락", "TASK"),
    node(15, "FH-SEQ 신호 점검"),
    node(19, "MCU 신호 점검"),
    node(20, "MCU 기판 교환"),
    node(22, "COVER OPEN 알람 발생 유무 확인", "INSPECTION"),
  ],
};

/** 실측 「기본 통전 검사 (3상 입력)」 — 🔴 code 칸에 **이름이 그대로** 들어 있다. */
const POWER_ON: StartPickerTemplate<TestNode> = {
  id: "tpl-power",
  code: "기본 통전 검사 (3상 입력)",
  name: "기본 통전 검사 (3상 입력)",
  nodes: [
    node(0, "220V 스위칭 전원 직접 입력", "START"),
    node(4, "MCU VCC 확인"),
    node(6, "MCU 교환 및 기동 확인", "INSPECTION"),
    node(19, "일본 교산에 연락", "CORRECTIVE_ACTION"),
    node(22, "MCU 기판 교환", "TASK"),
    node(27, "완료", "END"),
  ],
};

const TEMPLATES = [RESTORE, POWER_ON];

describe("🔴 출발점이 될 수 있는 노드", () => {
  test("시작(START)은 안 된다 — 실행을 만드는 순간 시스템이 완료로 적는 표식이다", () => {
    const verdict = classifyStartNode("START");
    assert.equal(verdict.ok, false);
    if (!verdict.ok) {
      assert.equal(verdict.reason, "SYSTEM_ENTRY");
      assert.match(verdict.message, /시작\(START\)/, "왜 못 고르는지가 사람 말로 적혀야 한다");
    }
  });

  test("참고 문서는 안 된다 — 실행 행 자체가 안 생긴다", () => {
    const verdict = classifyStartNode("DOCUMENT_REFERENCE");
    assert.equal(verdict.ok, false);
    if (!verdict.ok) assert.equal(verdict.reason, "NO_EXECUTION_ROW");
  });

  test("🔴 그 절차에 없는 노드(null)는 NOT_IN_TEMPLATE — 서버가 화면이 보낸 값을 되찾아 본 결과를 그대로 넣는다", () => {
    const verdict = classifyStartNode(null);
    assert.equal(verdict.ok, false);
    if (!verdict.ok) assert.equal(verdict.reason, "NOT_IN_TEMPLATE");
  });

  test("🔵 나머지 일곱은 전부 고를 수 있다 — 표본 확인(전부 거절하는 함수가 아니다)", () => {
    const pickable: ProcedureNodeType[] = ["TASK", "INSPECTION", "DECISION", "CORRECTIVE_ACTION", "CHECKLIST", "TROUBLESHOOTING", "END"];
    for (const nodeType of pickable) {
      assert.equal(classifyStartNode(nodeType).ok, true, `${nodeType} 를 거절했다`);
    }
    assert.equal(pickable.length, 7);
  });
});

describe("절차상 번호", () => {
  test("🔴 START 를 빼고 1부터 매긴다 — 실행 화면의 「전체 N」과 같은 잣대다", () => {
    const byId = indexStartPickerNodes(RESTORE.nodes);
    assert.equal(byId.size, RESTORE.nodes.length - 1, "START 하나만 빠져야 한다");
    assert.equal(byId.get(RESTORE.nodes[0].id), undefined, "START 에는 번호가 없다");
    assert.equal(byId.get(RESTORE.nodes[1].id), 1, "START 다음이 1번");
  });

  test("차례는 sort_order 가 정한다 — 배열에 적힌 차례가 아니다", () => {
    const scrambled = [...RESTORE.nodes].reverse();
    assert.deepEqual(indexStartPickerNodes(scrambled), indexStartPickerNodes(RESTORE.nodes));
  });

  test("참고 문서도 번호에서 빠진다", () => {
    const withReference: TestNode[] = [node(0, "시작", "START"), node(1, "첫 작업", "TASK"), node(2, "참고", "DOCUMENT_REFERENCE"), node(3, "둘째 작업", "TASK")];
    const byId = indexStartPickerNodes(withReference);
    assert.equal(byId.get(withReference[3].id), 2, "참고 문서를 세면 3번이 됐을 것이다");
  });
});

describe("🔴 「모든 절차」에서 검색하면 여러 절차의 노드가 나오고 절차 이름이 붙는다", () => {
  const result = searchStartNodes(TEMPLATES, "MCU", null);

  test("🔵 먼저 — 표본이 비지 않았다", () => {
    assert.ok(result.matchCount >= 4, `표본이 너무 적다(${result.matchCount})`);
  });

  test("두 절차의 노드가 **함께** 나온다", () => {
    const templateIds = new Set(result.hits.map((h) => h.templateId));
    assert.deepEqual([...templateIds].sort(), ["tpl-power", "tpl-restore"]);
  });

  test("🔴 줄마다 절차 이름이 실린다 — formatProcedureTemplateTitle 로 만든 그것", () => {
    const restoreHit = result.hits.find((h) => h.templateId === "tpl-restore")!;
    const powerHit = result.hits.find((h) => h.templateId === "tpl-power")!;
    // 코드가 이름과 다르면 괄호로 붙고,
    assert.equal(restoreHit.templateTitle, "원복 검사 및 개선 작업 (3상 입력) (7)");
    // 🔴 코드가 이름과 **같으면 안 붙는다** — 「이름 (이름)」이 다시 생기면 안 된다.
    assert.equal(powerHit.templateTitle, "기본 통전 검사 (3상 입력)");
  });
});

describe("🔴 절차를 고르면 그 안에서만 검색된다", () => {
  test("좁힌 결과가 「모든 절차」의 부분집합이고, 다른 절차가 한 줄도 안 섞인다", () => {
    const all = searchStartNodes(TEMPLATES, "MCU", null);
    const scoped = searchStartNodes(TEMPLATES, "MCU", "tpl-power");
    assert.ok(scoped.matchCount > 0, "표본 확인 — 좁혀도 걸리는 것이 있다");
    assert.ok(scoped.matchCount < all.matchCount, "좁혔는데 수가 그대로다 — 범위가 안 먹었다");
    assert.equal(scoped.hits.every((h) => h.templateId === "tpl-power"), true);
  });

  test("없는 절차 id 로 좁히면 아무것도 안 나온다", () => {
    assert.equal(searchStartNodes(TEMPLATES, "MCU", "tpl-nonexistent").matchCount, 0);
  });
});

describe("🔴 같은 이름 노드가 여럿일 때 구별된다", () => {
  test("절차를 **가로질러** 겹치는 「MCU 기판 교환」 — 절차 이름이 갈라 준다", () => {
    const hits = searchStartNodes(TEMPLATES, "MCU 기판 교환", null).hits;
    assert.equal(hits.length, 2, "실측으로 두 절차에 하나씩 있다");
    const titles = hits.map((h) => `${h.templateTitle} › ${h.orderIndex}. ${h.title}`);
    assert.equal(new Set(titles).size, 2, "두 줄이 글자까지 똑같으면 사람이 못 고른다");
    // 🔵 번호는 **이 표본 안에서의** 차례다(실제 절차는 22·27장이라 번호가 더 크다).
    // 여기서 재는 것은 「두 줄이 서로 갈리는가」이지 실제 번호가 몇인가가 아니다.
    assert.deepEqual(titles, [
      "원복 검사 및 개선 작업 (3상 입력) (7) › 6. MCU 기판 교환",
      "기본 통전 검사 (3상 입력) › 4. MCU 기판 교환",
    ]);
  });

  test("한 절차 **안에서** 겹치는 「FH-SEQ 신호 점검」 — 번호가 갈라 준다", () => {
    const hits = searchStartNodes(TEMPLATES, "FH-SEQ 신호 점검", "tpl-restore").hits;
    assert.equal(hits.length, 2, "실측 원복에 같은 이름이 두 번 있다(sort_order 6·15)");
    assert.notEqual(hits[0].orderIndex, hits[1].orderIndex, "번호까지 같으면 가를 수단이 없다");
    assert.deepEqual(hits.map((h) => h.orderIndex), [2, 4], "절차 차례대로 늘어서야 앞의 것/뒤의 것으로 집는다");
    assert.notEqual(hits[0].node.id, hits[1].node.id, "서로 다른 노드여야 한다");
  });

  test("🔵 절차를 가로지르는 「일본 교산에 연락」도 마찬가지 — 둘 다 걸린다", () => {
    const hits = searchStartNodes(TEMPLATES, "일본 교산", null).hits;
    assert.deepEqual(hits.map((h) => h.templateId), ["tpl-restore", "tpl-power"]);
  });
});

describe("검색이 무엇을 보고 무엇을 안 보는가", () => {
  test("대소문자를 안 가린다", () => {
    assert.equal(searchStartNodes(TEMPLATES, "mcu", null).matchCount, searchStartNodes(TEMPLATES, "MCU", null).matchCount);
  });

  test("🔴 node_code 는 안 본다 — 손으로 만든 절차의 코드는 `manual-<uuid>` 라 아무 말이나 걸린다", () => {
    assert.equal(searchStartNodes(TEMPLATES, "manual-", null).matchCount, 0);
  });

  test("🔴 제목에 박힌 줄바꿈을 접어서 본다 — 실측 제목에 줄바꿈이 들어 있다", () => {
    // 원본은 「440V INPUT 케이블 및 ⏎데이터 검사용 계측기 연결」.
    const hits = searchStartNodes(TEMPLATES, "케이블 및 데이터", null).hits;
    assert.equal(hits.length, 1, "사람이 읽은 대로 친 말이 안 걸렸다");
    assert.equal(hits[0].title, "440V INPUT 케이블 및 데이터 검사용 계측기 연결", "결과 줄도 접힌 제목이어야 한다");
  });

  test("빈 검색어는 아무것도 안 돌려준다 — 전부 걸리면 목록이 뜻을 잃는다", () => {
    assert.equal(searchStartNodes(TEMPLATES, "", null).matchCount, 0);
    assert.equal(searchStartNodes(TEMPLATES, "   ", null).matchCount, 0);
  });

  test("flattenNodeTitle 은 연속 공백과 앞뒤 공백을 한 칸으로 접는다", () => {
    assert.equal(flattenNodeTitle("  가  \n 나 \t 다 "), "가 나 다");
  });
});

describe("🔴 고를 수 없는 노드도 결과에 나오되 까닭이 붙는다", () => {
  test("START 의 제목을 그대로 쳐도 「없습니다」가 아니라 **못 고르는 까닭**이 뜬다", () => {
    const hits = searchStartNodes(TEMPLATES, "220V 스위칭 전원 직접 입력", null).hits;
    assert.equal(hits.length, 1, "통째로 빼면 사람이 이름을 잘못 쳤다고 읽는다");
    assert.equal(hits[0].eligibility.ok, false);
    assert.equal(hits[0].orderIndex, null, "고를 수 없는 노드에는 번호가 없다");
  });

  test("🔵 표본 확인 — 바로 옆의 평범한 노드는 고를 수 있다", () => {
    const hits = searchStartNodes(TEMPLATES, "MCU VCC 확인", "tpl-power").hits;
    assert.equal(hits.length, 1);
    assert.equal(hits[0].eligibility.ok, true);
    assert.equal(hits[0].orderIndex, 1, "START 다음 노드라 1번");
  });
});

describe("결과가 많을 때", () => {
  test("맞는 수는 잘라내기 **전**의 수이고, 잘렸다는 사실이 따로 온다", () => {
    const many: StartPickerTemplate<TestNode> = {
      id: "tpl-many",
      code: "many",
      name: "많은 절차",
      nodes: Array.from({ length: START_PICKER_RESULT_LIMIT + 5 }, (_, i) => node(i + 1, `점검 ${i + 1}`, "TASK")),
    };
    const result = searchStartNodes([many], "점검", null);
    assert.equal(result.matchCount, START_PICKER_RESULT_LIMIT + 5);
    assert.equal(result.hits.length, START_PICKER_RESULT_LIMIT);
    assert.equal(result.truncated, true);
  });

  test("한도 안이면 안 잘린다", () => {
    assert.equal(searchStartNodes(TEMPLATES, "MCU", null).truncated, false);
  });
});

describe("고른 것 되찾기", () => {
  test("절차와 노드가 맞으면 검색 결과와 **같은 모양**으로 온다", () => {
    const target = RESTORE.nodes.find((n) => n.title === "MCU 신호 점검")!;
    const hit = findStartNode(TEMPLATES, "tpl-restore", target.id);
    assert.ok(hit);
    assert.equal(hit.title, "MCU 신호 점검");
    assert.equal(hit.templateTitle, "원복 검사 및 개선 작업 (3상 입력) (7)");
    assert.equal(hit.orderIndex, 5);
    assert.equal(hit.eligibility.ok, true);
  });

  test("🔴 **남의 절차** 노드 id 를 들고 있으면 null — 화면이 그 값을 서버로 보내지 않게 한다", () => {
    const foreign = POWER_ON.nodes.find((n) => n.title === "MCU VCC 확인")!;
    assert.equal(findStartNode(TEMPLATES, "tpl-restore", foreign.id), null);
  });

  test("절차나 노드가 비면 null", () => {
    assert.equal(findStartNode(TEMPLATES, null, "whatever"), null);
    assert.equal(findStartNode(TEMPLATES, "tpl-restore", null), null);
  });
});

describe("🔴 시작 단추의 글자", () => {
  test("고른 것이 없으면 **「처음부터 시작」**이다 — 지금까지의 동작 그대로", () => {
    const state = resolveStartButtonState({ scopeTemplateId: "tpl-restore", chosenNodeId: null, isSubmitting: false });
    assert.equal(state.label, "처음부터 시작");
    assert.equal(state.disabled, false);
    assert.equal(state.hint, null);
  });

  test("고른 것이 있으면 **「여기서부터 시작」**이다", () => {
    const state = resolveStartButtonState({ scopeTemplateId: "tpl-restore", chosenNodeId: "n-19", isSubmitting: false });
    assert.equal(state.label, "여기서부터 시작");
    assert.equal(state.disabled, false);
  });

  test("🔴 두 글자가 **다르다** — 같으면 사람이 자기가 고른 자리가 쓰였는지 알 수 없다", () => {
    assert.notEqual(
      resolveStartButtonState({ scopeTemplateId: "t", chosenNodeId: null, isSubmitting: false }).label,
      resolveStartButtonState({ scopeTemplateId: "t", chosenNodeId: "n", isSubmitting: false }).label
    );
  });

  test("🔴 「모든 절차」에서는 못 누르고, 왜 못 누르는지가 한 줄로 온다", () => {
    const state = resolveStartButtonState({ scopeTemplateId: null, chosenNodeId: null, isSubmitting: false });
    assert.equal(state.disabled, true);
    assert.ok(state.hint && state.hint.length > 0, "흐리기만 하면 「왜 안 눌리지」가 된다");
  });

  test("보내는 중이면 글자가 바뀌고 못 누른다", () => {
    const state = resolveStartButtonState({ scopeTemplateId: "t", chosenNodeId: "n", isSubmitting: true });
    assert.equal(state.label, "시작하는 중...");
    assert.equal(state.disabled, true);
  });
});
