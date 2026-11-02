import { describe, test } from "node:test";
import assert from "node:assert/strict";
import {
  JUMP_BUTTON_LABEL,
  JUMP_RESULT_LIMIT,
  buildJumpStatusMarks,
  classifyJumpTarget,
  findJumpTarget,
  findJumpTargetByTemplateNodeId,
  planNodeJump,
  resolveJumpButtonState,
  searchJumpTargets,
  toJumpStatusMark,
  type JumpCandidateNode,
  type JumpPlanNode,
} from "./procedure-execution-jump";
import { pickCurrentTask } from "./procedure-execution-focus";
import {
  PROCEDURE_CASE_EXECUTION_NODE_STATUS_CODES,
  type ProcedureCaseExecutionNodeStatus,
} from "./procedure-case-execution-types";

/**
 * 「지금 할 일」을 **고른 노드로 옮기는** 판정(2026-11-02, 조각 10).
 *
 * 🔴 이 묶음의 핵심은 아래 「정말로 옮겨지는가」다. 옮기기는 **노드 상태만** 건드려
 * 자리를 옮기므로, 상태를 바꿔 놓고 pickCurrentTask 를 다시 돌려 봐야 「눌렀는데
 * 아무 일도 안 일어난다」가 잡힌다 — 그 결함은 오류를 안 내고 화면에서만 드러난다.
 */

/** 실측을 닮은 줄 하나. 번호는 절차 차례 그대로다. */
function node(
  n: number,
  status: ProcedureCaseExecutionNodeStatus,
  extra: Partial<JumpCandidateNode> = {}
): JumpCandidateNode {
  return {
    id: `e${n}`,
    procedureTemplateNodeId: `t${n}`,
    orderIndex: n,
    title: `작업 ${n}`,
    status,
    version: 1,
    ...extra,
  };
}

describe("🔵 먼저 — 표본이 비어 있지 않다", () => {
  test("상태 다섯이 전부 쓰이고, 세기가 서로 다르게 갈린다", () => {
    assert.equal(PROCEDURE_CASE_EXECUTION_NODE_STATUS_CODES.length, 5, "상태가 늘면 아래 표가 낡는다");
    const tones = new Set(PROCEDURE_CASE_EXECUTION_NODE_STATUS_CODES.map((s) => toJumpStatusMark(s).tone));
    // 완료와 건너뜀은 일부러 같은 세기(DONE)다 — 나머지는 다 갈린다.
    assert.equal(tones.size, 4, "세기가 하나로 뭉치면 그림에서 상태를 못 가린다");
    assert.deepEqual(toJumpStatusMark("IN_PROGRESS"), { label: "진행 중", tone: "CURRENT" });
    assert.deepEqual(toJumpStatusMark("BLOCKED"), { label: "차단됨", tone: "BLOCKED" });
    assert.deepEqual(toJumpStatusMark("PENDING"), { label: "대기", tone: "AHEAD" });
    assert.deepEqual(toJumpStatusMark("COMPLETED"), { label: "완료", tone: "DONE" });
    assert.deepEqual(toJumpStatusMark("SKIPPED"), { label: "건너뜀", tone: "DONE" });
  });
});

describe("옮길 수 있는가 — 참·거짓이 아니라 까닭", () => {
  test("대기와 진행 중만 옮길 수 있다", () => {
    assert.equal(classifyJumpTarget("PENDING").ok, true);
    assert.equal(classifyJumpTarget("IN_PROGRESS").ok, true);
  });

  test("🔴 완료·건너뜀은 못 옮긴다 — 되살리는 길([재개(되돌림)])이 따로 있다", () => {
    for (const status of ["COMPLETED", "SKIPPED"] as const) {
      const result = classifyJumpTarget(status);
      assert.equal(result.ok, false);
      if (result.ok) return;
      assert.equal(result.reason, "ALREADY_FINISHED");
      assert.match(result.message, /재개\(되돌림\)/, "어디로 가야 하는지를 안 적으면 막다른 길이 된다");
    }
  });

  test("🔴 차단됨도 못 옮긴다 — 사유 없이 푸는 길을 내지 않는다", () => {
    const result = classifyJumpTarget("BLOCKED");
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.reason, "BLOCKED");
    assert.match(result.message, /사유/);
  });

  test("🔴 실행 줄이 없는 칸(시작 지점·참고 문서)은 NOT_IN_EXECUTION 이다", () => {
    const result = classifyJumpTarget(null);
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.reason, "NOT_IN_EXECUTION");
  });

  test("까닭 셋의 글이 서로 다르다 — 사람이 할 다음 행동이 다르다", () => {
    const messages = (["COMPLETED", "BLOCKED", null] as const).map((status) => {
      const result = classifyJumpTarget(status);
      return result.ok ? "" : result.message;
    });
    assert.equal(new Set(messages).size, 3);
  });
});

describe("옮기면 무엇이 바뀌는가", () => {
  test("대기 하나를 고르면 그 줄만 세우고, 다른 진행 중을 대기로 내린다", () => {
    const nodes: JumpPlanNode[] = [
      { id: "e1", status: "COMPLETED" },
      { id: "e2", status: "IN_PROGRESS" },
      { id: "e3", status: "PENDING" },
      { id: "e4", status: "PENDING" },
    ];
    const plan = planNodeJump({ nodes, targetExecutionNodeId: "e4" });
    assert.equal(plan.kind, "MOVE");
    if (plan.kind !== "MOVE") return;
    assert.equal(plan.targetWasInProgress, false);
    assert.deepEqual(plan.standDownExecutionNodeIds, ["e2"]);
  });

  test("진행 중이 여럿이면 **전부** 내린다 — 옮기고 나면 진행 중은 하나뿐이다", () => {
    const nodes: JumpPlanNode[] = [
      { id: "e1", status: "IN_PROGRESS" },
      { id: "e2", status: "IN_PROGRESS" },
      { id: "e3", status: "PENDING" },
    ];
    const plan = planNodeJump({ nodes, targetExecutionNodeId: "e3" });
    assert.equal(plan.kind, "MOVE");
    if (plan.kind !== "MOVE") return;
    assert.deepEqual(plan.standDownExecutionNodeIds, ["e1", "e2"]);
  });

  test("🔴 이미 그 줄 **하나만** 진행 중이면 아무것도 안 바꾼다 — version 만 올리면 남의 단추가 죽는다", () => {
    const nodes: JumpPlanNode[] = [
      { id: "e1", status: "COMPLETED" },
      { id: "e2", status: "IN_PROGRESS" },
      { id: "e3", status: "PENDING" },
    ];
    assert.equal(planNodeJump({ nodes, targetExecutionNodeId: "e2" }).kind, "NO_CHANGE");
  });

  test("이미 진행 중이지만 **앞에 다른 진행 중**이 있으면 옮길 일이 남아 있다", () => {
    const nodes: JumpPlanNode[] = [
      { id: "e1", status: "IN_PROGRESS" },
      { id: "e2", status: "IN_PROGRESS" },
    ];
    const plan = planNodeJump({ nodes, targetExecutionNodeId: "e2" });
    assert.equal(plan.kind, "MOVE");
    if (plan.kind !== "MOVE") return;
    assert.equal(plan.targetWasInProgress, true, "이력의 beforeState 가 이 값으로 적힌다");
    assert.deepEqual(plan.standDownExecutionNodeIds, ["e1"]);
  });

  test("🔴 못 옮기는 줄과 없는 줄은 거절한다 — 그 까닭 그대로", () => {
    const nodes: JumpPlanNode[] = [
      { id: "e1", status: "COMPLETED" },
      { id: "e2", status: "BLOCKED" },
    ];
    for (const [id, reason] of [
      ["e1", "ALREADY_FINISHED"],
      ["e2", "BLOCKED"],
      ["없는줄", "NOT_IN_EXECUTION"],
    ] as const) {
      const plan = planNodeJump({ nodes, targetExecutionNodeId: id });
      assert.equal(plan.kind, "REJECTED", `${id} 가 통과했다`);
      if (plan.kind !== "REJECTED") return;
      assert.equal(plan.reason, reason);
      assert.ok(plan.message.length > 0, "까닭만 있고 할 말이 없으면 화면이 아무것도 못 적는다");
    }
  });
});

/**
 * 🔴 이 묶음이 이 조각의 **가장 중요한 단언**이다.
 *
 * 옮기기는 노드 상태만 건드린다. 그런데 「지금 할 일」을 고르는 것은
 * pickCurrentTask 이고, 그것은 진행 중 가운데 **절차 차례가 앞선 것**을 고른다.
 * 앞의 진행 중을 그대로 두면 **뒤로 옮길 때 아무 일도 안 일어난다** — 오류가 안
 * 나고 화면에서만 드러나는 종류다. 그래서 계획을 실제로 적용해 보고 다시 고른다.
 */
describe("🔴 정말로 옮겨지는가 — 계획을 적용하고 pickCurrentTask 를 다시 돌린다", () => {
  /** 계획대로 상태를 바꾼 배열을 돌려준다(쓰기 쪽이 하는 일과 같은 것). */
  function applied(nodes: JumpCandidateNode[], targetId: string): JumpCandidateNode[] {
    const plan = planNodeJump({ nodes, targetExecutionNodeId: targetId });
    assert.equal(plan.kind, "MOVE", "이 표본은 옮겨져야 한다");
    if (plan.kind !== "MOVE") return nodes;
    const standDown = new Set(plan.standDownExecutionNodeIds);
    return nodes.map((n) =>
      n.id === targetId ? { ...n, status: "IN_PROGRESS" as const } : standDown.has(n.id) ? { ...n, status: "PENDING" as const } : n
    );
  }

  /** 「지금 할 일」로 선 줄의 id. 없으면 null — 한 줄로 재야 아래가 읽힌다. */
  function currentId(nodes: JumpCandidateNode[]): string | null {
    const pick = pickCurrentTask(nodes, { isExecutionFinished: false });
    return pick.kind === "NONE" ? null : pick.node.id;
  }

  const running = [node(1, "COMPLETED"), node(2, "IN_PROGRESS"), node(3, "PENDING"), node(4, "PENDING")];

  test("🔵 먼저 — 옮기기 전에는 2번이 「지금 할 일」이다", () => {
    assert.equal(currentId(running), "e2", "표본이 이 모양이 아니면 아래가 아무것도 안 잰다");
  });

  test("🔴 **뒤로** 옮겨도 지금 할 일이 그 줄이 된다 — 앞의 진행 중을 안 내리면 여기서 깨진다", () => {
    assert.equal(currentId(applied(running, "e4")), "e4");
  });

  test("앞으로 옮기는 것도 같다", () => {
    const back = [node(1, "COMPLETED"), node(2, "PENDING"), node(3, "IN_PROGRESS")];
    assert.equal(currentId(applied(back, "e2")), "e2");
  });

  test("🔴 내려간 줄은 **대기**이지 건너뜀이 아니다 — 안 한 일을 했다고 적지 않는다", () => {
    const after = applied(running, "e4");
    assert.equal(after.find((n) => n.id === "e2")?.status, "PENDING");
    assert.equal(after.filter((n) => n.status === "SKIPPED").length, 0);
    assert.equal(after.filter((n) => n.status === "IN_PROGRESS").length, 1, "옮기고 나면 진행 중은 하나뿐이다");
  });
});

describe("검색", () => {
  const nodes = [
    node(1, "COMPLETED", { title: "MCU 기판 교환" }),
    node(2, "IN_PROGRESS", { title: "FH-CONT VCC 입력 케이블 탈거 후\n전원 기동 및 MCU VCC 공급 확인" }),
    node(3, "PENDING", { title: "조정 작업 실시" }),
    node(4, "BLOCKED", { title: "MCU 신호 점검" }),
    node(5, "PENDING", { title: "현장 추가 작업", procedureTemplateNodeId: null }),
  ];

  test("🔵 먼저 — 빈 검색어는 아무것도 안 돌려준다(공짜 통과 막기)", () => {
    assert.deepEqual(searchJumpTargets(nodes, "   "), { matchCount: 0, hits: [], truncated: false });
  });

  test("제목으로 찾고, 차례는 받은 그대로다", () => {
    const result = searchJumpTargets(nodes, "mcu");
    assert.equal(result.matchCount, 3);
    assert.deepEqual(
      result.hits.map((h) => h.node.id),
      ["e1", "e2", "e4"],
      "맞은 정도로 다시 줄 세우면 화면 차례와 갈린다"
    );
  });

  test("🔴 제목의 줄바꿈을 접어서 찾는다 — 사람이 읽은 대로 친 말이 걸려야 한다", () => {
    const result = searchJumpTargets(nodes, "탈거 후 전원");
    assert.equal(result.matchCount, 1);
    assert.ok(!result.hits[0].title.includes("\n"), "창이 다시 접지 않게 여기서 접는다");
  });

  test("🔵 못 옮기는 줄도 **걸리고**, 왜 못 옮기는지가 함께 온다", () => {
    const result = searchJumpTargets(nodes, "MCU");
    const blocked = result.hits.find((h) => h.node.id === "e4");
    assert.ok(blocked, "차단된 줄이 빠지면 이름을 정확히 쳐도 「없습니다」가 뜬다");
    assert.equal(blocked.eligibility.ok, false);
    assert.equal(blocked.mark.label, "차단됨");
  });

  test("추가 작업(그림에 자리가 없는 줄)도 검색에는 걸린다", () => {
    const result = searchJumpTargets(nodes, "현장");
    assert.equal(result.matchCount, 1);
    assert.equal(result.hits[0].node.procedureTemplateNodeId, null);
    assert.equal(result.hits[0].eligibility.ok, true, "그림에 자리가 없다고 못 옮기면 추가 작업이 영영 막힌다");
  });

  test("많이 걸리면 잘라 내되 **맞는 수는 그대로** 센다", () => {
    const many = Array.from({ length: JUMP_RESULT_LIMIT + 5 }, (_, i) => node(i + 1, "PENDING", { title: `같은 이름 ${i}` }));
    const result = searchJumpTargets(many, "같은 이름");
    assert.equal(result.matchCount, JUMP_RESULT_LIMIT + 5);
    assert.equal(result.hits.length, JUMP_RESULT_LIMIT);
    assert.equal(result.truncated, true);
  });
});

describe("그림에 얹는 상태 지도", () => {
  const nodes = [node(1, "COMPLETED"), node(2, "IN_PROGRESS"), node(3, "PENDING", { procedureTemplateNodeId: null })];

  test("절차 노드 id 로 찾히고, 딱지가 그 줄의 상태다", () => {
    const marks = buildJumpStatusMarks(nodes);
    assert.equal(marks.get("t1")?.label, "완료");
    assert.equal(marks.get("t2")?.tone, "CURRENT");
  });

  test("🔴 추가 작업은 지도에 안 들어간다 — 얹을 칸이 없다", () => {
    const marks = buildJumpStatusMarks(nodes);
    assert.equal(marks.size, 2);
  });
});

describe("고른 것 되찾기", () => {
  const nodes = [node(1, "COMPLETED"), node(2, "PENDING")];

  test("실행 줄 id 로 되찾으면 결과 줄과 같은 모양이다", () => {
    const hit = findJumpTarget(nodes, "e2");
    assert.ok(hit);
    assert.equal(hit.title, "작업 2");
    assert.equal(hit.mark.label, "대기");
    assert.equal(hit.eligibility.ok, true);
    assert.equal(findJumpTarget(nodes, null), null);
    assert.equal(findJumpTarget(nodes, "없는줄"), null);
  });

  test("그림이 준 **절차 노드** id 로도 되찾는다 — 실행 줄이 없으면 null", () => {
    assert.equal(findJumpTargetByTemplateNodeId(nodes, "t1")?.id, "e1");
    assert.equal(findJumpTargetByTemplateNodeId(nodes, "t99"), null, "시작 지점·참고 문서가 여기로 떨어진다");
    assert.equal(findJumpTargetByTemplateNodeId(nodes, null), null);
  });
});

describe("옮기기 단추", () => {
  const ok = findJumpTarget([node(2, "PENDING")], "e2");
  const blocked = findJumpTarget([node(2, "BLOCKED")], "e2");
  const base = { chosen: ok, isAlreadyCurrent: false, isSubmitting: false, isExecutionFinished: false, eligible: true };

  test("고른 것이 있고 옮길 수 있으면 눌린다 — 글자는 한 곳에서 온다", () => {
    const state = resolveJumpButtonState(base);
    assert.equal(state.disabled, false);
    assert.equal(state.label, JUMP_BUTTON_LABEL);
    assert.equal(state.hint, null);
  });

  test("🔴 안 눌릴 때는 **까닭이 반드시 적힌다** — 흐리기만 하면 「왜 안 되지」가 된다", () => {
    const cases = [
      { ...base, chosen: null },
      { ...base, chosen: blocked },
      { ...base, isAlreadyCurrent: true },
      { ...base, isExecutionFinished: true },
      { ...base, eligible: false },
    ];
    const hints = new Set<string>();
    for (const input of cases) {
      const state = resolveJumpButtonState(input);
      assert.equal(state.disabled, true);
      assert.ok(state.hint && state.hint.length > 0, "까닭이 없다");
      hints.add(state.hint);
    }
    assert.equal(hints.size, cases.length, "다섯 까닭의 글이 서로 달라야 사람이 무엇을 할지 안다");
  });

  test("🔴 마친 실행에서는 서버도 거절한다 — 그 까닭이 [절차 다시 잇기]를 가리킨다", () => {
    const state = resolveJumpButtonState({ ...base, isExecutionFinished: true });
    assert.match(state.hint ?? "", /절차 다시 잇기/);
  });

  test("보내는 동안에는 글자가 바뀌고 두 번 눌리지 않는다", () => {
    const state = resolveJumpButtonState({ ...base, isSubmitting: true });
    assert.equal(state.disabled, true);
    assert.notEqual(state.label, JUMP_BUTTON_LABEL);
  });
});
