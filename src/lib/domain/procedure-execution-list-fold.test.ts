import { describe, test } from "node:test";
import assert from "node:assert/strict";
import {
  buildExecutionHistoryFold,
  buildExecutionListFold,
  type ExecutionFoldGroup,
  type ExecutionHistoryFold,
  type FoldCandidate,
} from "./procedure-execution-list-fold";
import { pickCurrentTask, pickCurrentTaskNode } from "./procedure-execution-focus";
import type { ProcedureCaseExecutionNodeStatus } from "./procedure-case-execution-types";

/**
 * 아래 목록을 **접을지 · 아예 안 그릴지**와 접힌 줄에 적을 글자.
 *
 * ── 표본을 실측에서 가져온 까닭 ─────────────────────────────────────────
 * 개발 DB 의 실행 4건을 세어서(2026-11-02) 그대로 옮겼다. 꾸며낸 분포로 재면
 * 「다 끝난 실행」도 「차단됨이 있는 실행」도 가정이 되는데, 둘 다 **지금 DB 에
 * 실제로 있는 상태**다.
 *
 *   dd0389d1 「기본 통전 검사」 … 27장이 전부 완료(남은 것이 0장)
 *   66c8ba16 「원복 검사 및 개선 작업」 … 대기 16 · 차단됨 1 · 완료 4 · 건너뜀 1
 *   4165df42 같은 절차 … 대기 17 · 진행 중 2 · 차단됨 1 · 완료 2
 *
 * (START 는 조회가 이미 걸러낸다 — 사람이 할 일 목록에 안 나온다.)
 *
 * ── 🔴 2026-11-02 에 규칙 둘이 **없어졌다**(사용자 결정) ────────────────
 * 전에는 「지금 할 일이 없으면」·「차단됨이 있으면」 「전체 단계 보기」를 펼친
 * 채로 뒀다. 눈으로 보니 평소 화면에서 자꾸 펼쳐져 있어 접기가 거의 듣지
 * 않았다. 이제 **언제나 접혀 있다.** 그 두 규칙을 재던 시험은 지우지 않고
 * **반대를 재도록** 고쳤다(아래 「어떤 경우에도 안 펼쳐진다」) — 지우면 규칙이
 * 슬그머니 되살아나도 아무 데서도 안 걸린다.
 *
 * ── 🔴 2026-11-02(조각 8) 에 묶음 하나가 **다른 묶음 안으로 들어갔다** ──
 * 「지나온 길」(완료 · 건너뜀 카드)이 「실행 이력」 안으로 들어갔다 — 사용자의 말
 * 그대로 「[실행 이력]에 [지나온 길]의 내용을 넣자」. 그래서 buildExecutionListFold
 * 는 이제 「전체 단계 보기」 하나만 돌려주고, 끝난 카드는 buildExecutionHistoryFold
 * 가 함께 담는다.
 *
 * 「지나온 길」을 재던 시험들은 **지우지 않고** 새 자리(아래 「실행 이력 묶음」)로
 * 옮겨 같은 것을 잰다 — 머릿수 · 건너뜀 가르기 · 「담을 것이 없으면 안 그린다」.
 * 지우면 합치는 과정에서 무엇이 새도 아무 데서도 안 걸린다.
 */

function nodesOf(counts: Partial<Record<ProcedureCaseExecutionNodeStatus, number>>): FoldCandidate[] {
  const out: FoldCandidate[] = [];
  for (const [status, count] of Object.entries(counts) as [ProcedureCaseExecutionNodeStatus, number][]) {
    for (let i = 0; i < count; i += 1) out.push({ status });
  }
  return out;
}

/** 아직 도는 실행에서 접는다 — 아래 대부분이 쓰는 형편이다. */
const running = (nodes: readonly FoldCandidate[]) => buildExecutionListFold({ nodes, isExecutionFinished: false });
/** 사람이 [절차 끝내기]를 눌러 마친 실행. */
const finished = (nodes: readonly FoldCandidate[]) => buildExecutionListFold({ nodes, isExecutionFinished: true });
/** 「실행 이력」 묶음 — 이력 줄 수와 **노드 배열**을 함께 받는다. */
const historyOf = (historyCount: number, nodes: readonly FoldCandidate[] = []) =>
  buildExecutionHistoryFold({ historyCount, nodes });

/**
 * 「이 표본에서는 묶음이 **그려져야** 한다」까지 함께 재는 꺼내기. null 이면
 * 그 자리에서 실패한다 — `?.` 로 조용히 넘기면 묶음이 통째로 사라진 날에도
 * 아래 단언들이 undefined 끼리 맞아떨어져 통과할 수 있다.
 */
function drawn(group: ExecutionFoldGroup | null, what: string): ExecutionFoldGroup {
  if (group === null) assert.fail(`${what} 묶음이 null 이다 — 이 표본에서는 그려져야 한다`);
  return group;
}

/**
 * 위와 같은 뜻 — 「실행 이력」 묶음 쪽.
 *
 * 🔵 2026-11-03(조각 12)에 이 그릇에서 `showsTrail` 이 빠졌다. 「끝난 노드 카드
 * 구역을 그리는가」였는데 **그 구역 자체가 없어졌다**(그 자리는 이제 시간순
 * 이력 목록이다). 그것을 재던 단언들은 지우지 않고 **새 자리에서 같은 것을
 * 재도록** 옮겼다 — 「끝난 것이 저 안에 있다」는 이제 덧말(완료 N · 건너뜀 N)이
 * 말하고, 그 줄이 정말 그려지는지는 procedure-execution-history-feed.test.ts 가
 * 잰다.
 */
function drawnHistory(fold: ExecutionHistoryFold | null): ExecutionHistoryFold {
  if (fold === null) assert.fail("실행 이력 묶음이 null 이다 — 이 표본에서는 그려져야 한다");
  return fold;
}

/** 실측 66c8ba16 — 평소 화면이 이 모양이다. */
const MEASURED_RUNNING = nodesOf({ PENDING: 16, BLOCKED: 1, COMPLETED: 4, SKIPPED: 1 });
/** 실측 dd0389d1 — 27장이 전부 완료라 남은 것이 0장. */
const MEASURED_FINISHED = nodesOf({ COMPLETED: 27 });
/** 남은 것은 있는데 전부 차단됨 — 「지금 할 일이 없다」의 **다른** 까닭. */
const ALL_BLOCKED = nodesOf({ BLOCKED: 3, COMPLETED: 2 });

/**
 * 🔴 화면이 네 구역을 만드는 방법 **그대로**. 여기서 센 합이 접힌 줄의 괄호 안
 * 수(또는 덧말의 수)와 같아야 한다 — 화면 코드(ProcedureExecutionScreen)가 같은
 * 배열을 같은 status 로 걸러 카드로 그린다.
 */
function screenSectionCounts(nodes: readonly FoldCandidate[]) {
  const pending = nodes.filter((n) => n.status === "PENDING").length;
  const inProgress = nodes.filter((n) => n.status === "IN_PROGRESS").length;
  const blocked = nodes.filter((n) => n.status === "BLOCKED").length;
  const completed = nodes.filter((n) => n.status === "COMPLETED").length;
  const skipped = nodes.filter((n) => n.status === "SKIPPED").length;
  return { pending, inProgress, blocked, completed, skipped, done: completed + skipped };
}

describe("🔵 먼저 — 표본이 비어 있지 않다", () => {
  test("실측 표본이 실제로 카드 22장·27장이다(빈 배열로 공짜 통과하지 않는다)", () => {
    assert.equal(MEASURED_RUNNING.length, 22);
    assert.equal(MEASURED_FINISHED.length, 27);
    const sections = screenSectionCounts(MEASURED_RUNNING);
    assert.ok(sections.pending > 0 && sections.blocked > 0 && sections.done > 0, "셋 다 있어야 아래 판정이 뜻을 가진다");
    assert.ok(sections.completed > 0 && sections.skipped > 0, "완료와 건너뜀이 **둘 다** 있어야 덧말 가르기를 잴 수 있다");
  });

  test("「지금 할 일」이 안 뽑히는 표본이 둘이고, 까닭이 서로 다르다", () => {
    // 둘을 한 표본으로 뭉치면 「다 끝났다」와 「전부 막혔다」가 같은 것이 된다.
    const ctx = { isExecutionFinished: false };
    assert.deepEqual(pickCurrentTask(MEASURED_FINISHED, ctx), { kind: "NONE", reason: "ALL_FINISHED" });
    assert.deepEqual(pickCurrentTask(ALL_BLOCKED, ctx), { kind: "NONE", reason: "ALL_BLOCKED" });
  });

  test("🔴 이제 **어느 묶음도 저절로 안 펼쳐진다** — 펼침은 사람이 누르는 것뿐이다", () => {
    // 2026-11-02(조각 8): 마지막 하나였던 「지나온 길」의 ALL_FINISHED 가 그 묶음과
    // 함께 사라졌다. 끝난 카드는 이제 「실행 이력」 안에 있고, 그쪽은 접힌 채가
    // 기본이다(조각 5 사용자 결정).
    //
    // 🔵 그래도 그릇(open)은 살아 있다 — 값이 true 면 <details> 가 펼쳐져 그려진다는
    // 것은 execution-list-fold.test.tsx 가 손으로 만든 묶음으로 확인한다. 그래서
    // 아래 「false 다」가 아무것도 안 재는 단언이 아니다.
    assert.equal(drawnHistory(historyOf(9, MEASURED_FINISHED)).fold.open, false);
    assert.equal(drawn(running(MEASURED_RUNNING).remaining, "전체 단계 보기").open, false);
  });
});

describe("🔴 「전체 단계 보기」는 어떤 경우에도 안 펼쳐진다", () => {
  test("평범한 실행에서 접혀 있다", () => {
    const fold = running(nodesOf({ PENDING: 15, IN_PROGRESS: 1, COMPLETED: 5, SKIPPED: 1 }));
    const remaining = drawn(fold.remaining, "전체 단계 보기");
    assert.equal(remaining.open, false);
    assert.equal(remaining.openReason, null);
  });

  test("🔴 지금 할 일이 없어도(남은 것이 전부 차단됨) 접혀 있다", () => {
    // 전에는 여기서 펼쳐 뒀다(NO_CURRENT_TASK). 2026-11-02 에 없앤 규칙이다.
    const remaining = drawn(running(ALL_BLOCKED).remaining, "전체 단계 보기");
    assert.equal(remaining.open, false);
    assert.equal(remaining.openReason, null);
  });

  test("🔴 차단됨이 있어도 접혀 있다 — 대신 **제목 줄에 적는다**", () => {
    // 전에는 여기서 펼쳐 뒀다(HAS_BLOCKED). 막힌 것을 알리는 일은 이제 덧말이
    // 혼자 맡는다 — 그래서 덧말이 사라지면 안 된다.
    const remaining = drawn(running(MEASURED_RUNNING).remaining, "전체 단계 보기");
    assert.equal(remaining.open, false);
    assert.equal(remaining.openReason, null);
    assert.deepEqual(remaining.note, { text: "차단됨 1", tone: "ATTENTION" });
  });

  test("🔴 어떤 분포를 넣어도 open 이 true 가 되지 않는다", () => {
    const samples = [
      MEASURED_RUNNING,
      ALL_BLOCKED,
      nodesOf({ PENDING: 22 }),
      nodesOf({ IN_PROGRESS: 3, BLOCKED: 2, COMPLETED: 1 }),
      nodesOf({ BLOCKED: 1 }),
      nodesOf({ PENDING: 1, SKIPPED: 9 }),
    ];
    for (const nodes of samples) {
      const remaining = running(nodes).remaining;
      if (remaining === null) continue; // 담을 카드가 없는 표본은 아예 안 그려진다
      assert.equal(remaining.open, false, JSON.stringify(screenSectionCounts(nodes)));
    }
  });
});

describe("🔴 마친 실행에서는 「전체 단계 보기」를 아예 안 그린다", () => {
  // 끝까지 안 가고 [절차 끝내기]를 눌러도 마친 것이다. 남은 카드 열몇 장이
  // 그대로 떠 있으면 마친 것처럼 보이지 않는다(2026-11-02 눈 확인).
  const halfDone = nodesOf({ PENDING: 12, IN_PROGRESS: 1, BLOCKED: 1, COMPLETED: 8 });

  test("🔵 표본 확인 — 아직 도는 실행이면 같은 배열에서 **그려진다**", () => {
    assert.equal(drawn(running(halfDone).remaining, "전체 단계 보기").count, 14);
  });

  test("남은 것이 14장이어도 null 이다", () => {
    assert.equal(finished(halfDone).remaining, null);
  });

  test("🔵 끝난 카드는 **남는다** — 「실행 이력」 안에서. 마친 뒤 볼 것이 그것이다", () => {
    // 🔴 이 묶음은 「마쳤는가」를 아예 안 본다 — 마쳐도 안 마쳐도 끝난 카드는 그대로
    // 담는다. 그래서 인자에 isExecutionFinished 가 없다.
    const history = drawnHistory(historyOf(11, halfDone));
    assert.deepEqual(history.fold.note, { text: "완료 8", tone: "MUTED" }, "끝난 것이 저 안에 있다는 말이 접힌 줄에서 사라졌다");
  });
});

describe("🔴 담을 카드가 없는 묶음은 아예 안 그린다", () => {
  test("남은 것이 0장이면 「전체 단계 보기」를 안 그린다 — 「(0)」을 펼쳐 「…없습니다」를 보이지 않는다", () => {
    assert.equal(running(MEASURED_FINISHED).remaining, null);
  });

  test("🔴 경계 — 노드도 이력도 아예 없으면 묶음 **둘 다** 안 그린다", () => {
    assert.equal(running([]).remaining, null);
    assert.equal(historyOf(0, []), null);
  });

  test("거꾸로 — 끝낸 것이 0장이면 「실행 이력」 줄에 그 덧말이 아예 안 뜬다(막 시작한 실행)", () => {
    // 같은 규칙을 두 자리에 똑같이 적용한다. 한쪽에만 두면 비대칭이 생긴다.
    const fresh = running(nodesOf({ PENDING: 22 }));
    assert.equal(drawn(fresh.remaining, "전체 단계 보기").summary, "전체 단계 보기 (22)");

    const history = drawnHistory(historyOf(1, nodesOf({ PENDING: 22 })));
    assert.equal(history.fold.note, null, "「완료 0」은 읽을 가치가 없다");
    assert.equal(history.fold.summary, "실행 이력 (1)", "이력 줄은 있으므로 묶음 자체는 그려진다");
  });
});

describe("괄호 안 수는 화면 구역 머릿수의 합이다", () => {
  test("🔴 실측 분포에서 전체 단계 보기 = 대기 + 진행 중 + 차단됨", () => {
    for (const nodes of [MEASURED_RUNNING, MEASURED_FINISHED, nodesOf({ PENDING: 17, IN_PROGRESS: 2, BLOCKED: 1, COMPLETED: 2 })]) {
      const sections = screenSectionCounts(nodes);
      // 안 그려진 묶음은 0장 — 그려진 묶음의 수와 합쳐서 전체가 맞아야 한다.
      assert.equal(running(nodes).remaining?.count ?? 0, sections.pending + sections.inProgress + sections.blocked);
    }
  });

  test("🔴 덧말의 완료·건너뜀을 더하면 「실행 이력」 안 카드 구역의 수다 — 어느 상태도 셈에서 새지 않는다", () => {
    const nodes = nodesOf({ PENDING: 3, IN_PROGRESS: 2, BLOCKED: 4, COMPLETED: 5, SKIPPED: 6 });
    const sections = screenSectionCounts(nodes);
    const remaining = drawn(running(nodes).remaining, "전체 단계 보기");
    const history = drawnHistory(historyOf(7, nodes));
    assert.equal(remaining.count, 9);
    assert.deepEqual(history.fold.note, { text: "완료 5 · 건너뜀 6", tone: "MUTED" });
    assert.equal(remaining.count + sections.done, nodes.length, "9 + 11 = 20 — 남은 것과 지나온 것이 전체를 덮는다");
  });

  test("🔴 「지금 할 일」로 위에 올라간 한 장도 센다 — 그 자리는 점선 한 줄로 남아 있다", () => {
    const ctx = { isExecutionFinished: false };
    const picked = pickCurrentTaskNode(MEASURED_RUNNING, ctx);
    assert.equal(pickCurrentTask(MEASURED_RUNNING, ctx).kind, "PENDING", "표본 확인 — 실제로 한 장이 위로 올라간다");
    assert.ok(picked !== null, "표본 확인 — 뽑힌 한 장이 있어야 빼고 세어 볼 수 있다");

    const withIt = running(MEASURED_RUNNING);
    const withoutIt = running(MEASURED_RUNNING.filter((n) => n !== picked));
    assert.equal(drawn(withIt.remaining, "전체 단계 보기").count, 17);
    assert.equal(drawn(withIt.remaining, "전체 단계 보기").summary, "전체 단계 보기 (17)");
    // 🔵 빼면 수가 줄어드는 자리다 — 「빼지 않는다」가 공짜로 통과하지 않는다.
    assert.equal(drawn(withoutIt.remaining, "전체 단계 보기").count, 16);
    assert.equal(drawn(withoutIt.remaining, "전체 단계 보기").summary, "전체 단계 보기 (16)");
  });
});

describe("접힌 줄에 뜨는 글자", () => {
  test("실측 분포에서 **그대로** 이렇게 적힌다", () => {
    assert.equal(drawn(running(MEASURED_RUNNING).remaining, "전체 단계 보기").summary, "전체 단계 보기 (17)");
    assert.equal(drawnHistory(historyOf(12, MEASURED_RUNNING)).fold.summary, "실행 이력 (12)");
  });

  test("🔴 차단됨 수가 덧말로 붙고, 눈에 띄는 쪽(ATTENTION)이다", () => {
    const fold = running(nodesOf({ PENDING: 10, BLOCKED: 2 }));
    assert.deepEqual(drawn(fold.remaining, "전체 단계 보기").note, { text: "차단됨 2", tone: "ATTENTION" });
  });

  test("없는 것은 0 으로 적지 않고 아예 안 적는다 — 「차단됨 0」은 읽을 가치가 없다", () => {
    assert.equal(drawn(running(nodesOf({ PENDING: 5, COMPLETED: 2 })).remaining, "전체 단계 보기").note, null);
  });
});

/**
 * 🔴 2026-11-02(조각 8)에 **「지나온 길」을 품게 된** 묶음이다. 전에 그 묶음이
 * 재던 것(머릿수 · 건너뜀 가르기 · 빈 묶음 안 그리기)을 여기서 이어 잰다.
 */
describe("🔴 「실행 이력」 묶음 — 「지나온 길」을 품는다", () => {
  test("접혀 있고, 괄호 안은 **이력 줄 수**다", () => {
    const history = drawnHistory(historyOf(12, MEASURED_RUNNING));
    assert.equal(history.fold.open, false);
    assert.equal(history.fold.openReason, null);
    assert.equal(history.fold.summary, "실행 이력 (12)");
    assert.equal(history.fold.count, 12);
  });

  test("🔴 괄호 안에 **카드 수를 더하지 않는다** — 종류가 다른 둘을 더하면 아무 수도 아니다", () => {
    // 카드 5장 + 이력 12줄 = 17 이 되면, 이력 줄을 세어 본 사람이 제 눈과 다른
    // 수를 본다. 카드 수는 괄호가 아니라 **덧말**에 적는다.
    const history = drawnHistory(historyOf(12, MEASURED_RUNNING));
    assert.equal(history.fold.count, 12);
    assert.ok(!history.fold.summary.includes("17"), history.fold.summary);
  });

  test("🔴 덧말이 **완료와 건너뜀을 갈라** 적는다 — 합쳐 「5」로만 적으면 「다섯 개 했다」로 읽힌다", () => {
    // 전에 「지나온 길」의 덧말이 하던 일이다(건너뜀은 **안 한 일**이다).
    const history = drawnHistory(historyOf(9, MEASURED_RUNNING));
    assert.deepEqual(history.fold.note, { text: "완료 4 · 건너뜀 1", tone: "MUTED" });
  });

  test("한쪽이 0 이면 그쪽은 아예 안 적는다", () => {
    assert.deepEqual(drawnHistory(historyOf(3, nodesOf({ COMPLETED: 27 }))).fold.note, { text: "완료 27", tone: "MUTED" });
    assert.deepEqual(drawnHistory(historyOf(3, nodesOf({ SKIPPED: 2, PENDING: 1 }))).fold.note, {
      text: "건너뜀 2",
      tone: "MUTED",
    });
  });

  test("🔵 경고색을 안 쓴다 — 지나온 것은 알아 두면 되는 것(MUTED)이다", () => {
    assert.equal(drawnHistory(historyOf(3, MEASURED_RUNNING)).fold.note?.tone, "MUTED");
  });

  test("이력 줄이 한 줄도 없어도 끝난 작업이 있으면 묶음을 그린다 — 통째로 사라지면 안 된다", () => {
    // 🔵 실제로는 이 경우에 목록이 **줄을 만들어 넣으므로**(끝난 작업의 단추가 설
    //    자리가 있어야 한다 — procedure-execution-history-feed.ts) 화면에서는
    //    괄호 안이 0 으로 남지 않는다. 그래도 이 함수는 받은 수를 그대로 적어야
    //    한다 — 세는 일은 목록의 몫이고, 여기서 또 세면 두 벌이 된다.
    const history = drawnHistory(historyOf(0, MEASURED_FINISHED));
    assert.equal(history.fold.summary, "실행 이력 (0)");
    assert.deepEqual(history.fold.note, { text: "완료 27", tone: "MUTED" });
  });

  test("둘 다 없으면 null — 화면이 그 자리에 아무것도 안 그린다", () => {
    assert.equal(historyOf(0, []), null);
    assert.equal(historyOf(-1, []), null);
    assert.equal(historyOf(-1, nodesOf({ PENDING: 3 })), null, "아직 아무것도 안 끝낸 실행은 담을 것이 없다");
  });

  test("🔵 아래 목록과 **같은 모양**을 돌려준다 — 그릇을 함께 쓸 수 있어야 한다", () => {
    const history = drawnHistory(historyOf(3, nodesOf({ COMPLETED: 1 })));
    const list = drawn(running(nodesOf({ PENDING: 3 })).remaining, "전체 단계 보기");
    assert.deepEqual(Object.keys(history.fold).sort(), Object.keys(list).sort());
  });
});
