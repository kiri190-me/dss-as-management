import { describe, test } from "node:test";
import assert from "node:assert/strict";
import {
  buildPastExecutionPanel,
  classifyPastExecution,
  resolveAbandonBlockedReason,
  resolveResumeBlockedReason,
  type PastExecutionCandidate,
  type PastExecutionOutcome,
} from "./procedure-execution-past-runs";
import { assessExecutionFinish } from "./procedure-execution-lifecycle";
import { buildExecutionListFold } from "./procedure-execution-list-fold";
import {
  PROCEDURE_CASE_EXECUTION_NODE_STATUS_CODES,
  type ProcedureCaseExecutionNodeStatus,
} from "./procedure-case-execution-types";

/**
 * 「이 건의 다른 절차」 한 줄씩 — 배지 · 진행도 · 차례(2026-11-02, 조각 6).
 *
 * 표본은 **개발 DB 에서 그대로 읽어 온 것**이다(2026-11-02 실측, SELECT 만).
 * 사용자가 화면에서 직접 눌러 만든 세 갈래가 그 안에 다 들어 있어서, 지어낸
 * 숫자보다 낫다 — 특히 「중단 마침」은 남은 19장의 속이 대기·진행 중·차단됨
 * 셋으로 섞여 있어 잣대가 어긋나면 바로 드러난다.
 *
 * 묶음이 실제로 어떤 모습으로 그려지는지는 components 목록의
 * past-executions-section.test.tsx 가, 조회가 무엇을 싣고 무엇을 거르는지는 db
 * 목록의 procedure-case-execution.integration.test.ts 가 잰다.
 */

function nodesOf(counts: Partial<Record<ProcedureCaseExecutionNodeStatus, number>>): { status: ProcedureCaseExecutionNodeStatus }[] {
  const out: { status: ProcedureCaseExecutionNodeStatus }[] = [];
  for (const [status, count] of Object.entries(counts) as [ProcedureCaseExecutionNodeStatus, number][]) {
    for (let i = 0; i < count; i += 1) out.push({ status });
  }
  return out;
}

function candidate(overrides: Partial<PastExecutionCandidate> = {}): PastExecutionCandidate {
  return {
    executionId: "exec-1",
    templateName: "원복 검사 및 개선 작업 (3상 입력)",
    templateCode: "7",
    nodes: nodesOf({ COMPLETED: 1 }),
    startedAt: "2026-11-02T01:00:00.000Z",
    startedByName: "홍길동",
    completedAt: "2026-11-02T02:00:00.000Z",
    // 실행 행 자신의 낙관적 잠금 토큰. 줄에 붙는 [실행 그만두기]가 그대로 넘긴다.
    version: 1,
    isDeleted: false,
    deletedAt: null,
    deletedByName: null,
    deleteReason: null,
    ...overrides,
  };
}

/**
 * 실측 dd0389d1 — 사람이 할 일 27장이 전부 완료. START 1장은 조회가 이미 뺀
 * 뒤라 여기 없다(분모가 27 이지 28 이 아닌 까닭).
 */
const MEASURED_COMPLETED_ALL = candidate({
  executionId: "dd0389d1-bbf8-46a4-a2fd-8b6ab6b1c1cd",
  templateName: "기본 통전 검사 (3상 입력)",
  // 🔵 실측 그대로 — 이 절차는 코드 칸에 **이름이 그대로** 들어 있다.
  templateCode: "기본 통전 검사 (3상 입력)",
  nodes: nodesOf({ COMPLETED: 27 }),
  startedAt: "2026-11-02T03:19:52.100Z",
  completedAt: "2026-11-02T06:02:10.922Z",
  startedByName: "홍길동",
});

/** 실측 66c8ba16 — 마쳤는데 대기 16 · 진행 중 2 · 차단됨 1 이 남아 있다. */
const MEASURED_FINISHED_WITH_REMAINING = candidate({
  executionId: "66c8ba16-aa06-43a5-ab74-ff799abb77ac",
  nodes: nodesOf({ PENDING: 16, IN_PROGRESS: 2, BLOCKED: 1, COMPLETED: 2, SKIPPED: 1 }),
  startedAt: "2026-11-02T02:15:18.596Z",
  completedAt: "2026-11-02T06:00:59.628Z",
  startedByName: "홍길동",
});

/** 실측 f7244886 — 하나를 시작한 채로 그만뒀다. 사유는 한 글자(「.」)였다. */
const MEASURED_ABANDONED = candidate({
  executionId: "f7244886-925f-49e9-af19-6e22bdb0649a",
  nodes: nodesOf({ PENDING: 21, IN_PROGRESS: 1 }),
  startedAt: "2026-11-02T01:25:50.070Z",
  completedAt: null,
  isDeleted: true,
  deletedAt: "2026-11-02T06:00:19.036Z",
  deletedByName: "홍길동",
  deleteReason: ".",
});

/** 실측 e5e9424a — 마치지도 그만두지도 않았다. 아직 도는 실행이다. */
const MEASURED_STILL_RUNNING = candidate({
  executionId: "e5e9424a-d4dd-41d8-99ee-083dd4285776",
  nodes: nodesOf({ PENDING: 22 }),
  startedAt: "2026-11-02T06:10:11.048Z",
  completedAt: null,
});

const outcomeOf = (input: PastExecutionCandidate) => classifyPastExecution(input).outcome;

describe("🔵 먼저 — 무엇을 재는가", () => {
  test("표본 넷이 서로 **다른** 답을 낸다 — 하나로 쏠리면 아래가 전부 공짜로 통과한다", () => {
    assert.deepEqual(
      [MEASURED_COMPLETED_ALL, MEASURED_FINISHED_WITH_REMAINING, MEASURED_ABANDONED, MEASURED_STILL_RUNNING].map(outcomeOf),
      ["COMPLETED_ALL", "FINISHED_WITH_REMAINING", "ABANDONED", "STILL_RUNNING"]
    );
  });

  test("표본이 비어 있지 않다 — 실측한 머릿수 그대로다", () => {
    assert.equal(MEASURED_COMPLETED_ALL.nodes.length, 27);
    assert.equal(MEASURED_FINISHED_WITH_REMAINING.nodes.length, 22);
    assert.equal(MEASURED_ABANDONED.nodes.length, 22);
  });

  test("상태는 다섯 가지다 — 늘면 「남은 것」의 셈도 다시 정해야 한다", () => {
    assert.deepEqual(
      [...PROCEDURE_CASE_EXECUTION_NODE_STATUS_CODES],
      ["PENDING", "IN_PROGRESS", "COMPLETED", "SKIPPED", "BLOCKED"]
    );
  });
});

describe("🔴 배지 넷이 각각 갈린다", () => {
  test("완주 — 마쳤고 남은 것이 0", () => {
    assert.deepEqual(classifyPastExecution(MEASURED_COMPLETED_ALL), {
      outcome: "COMPLETED_ALL",
      label: "완주",
      tone: "SUCCESS",
    });
  });

  test("중단 마침 — 마쳤는데 남은 것이 있다", () => {
    assert.deepEqual(classifyPastExecution(MEASURED_FINISHED_WITH_REMAINING), {
      outcome: "FINISHED_WITH_REMAINING",
      label: "중단 마침",
      tone: "INFO",
    });
  });

  test("그만둠 — is_deleted", () => {
    assert.deepEqual(classifyPastExecution(MEASURED_ABANDONED), { outcome: "ABANDONED", label: "그만둠", tone: "MUTED" });
  });

  test("🔴 진행 중 — 마치지도 그만두지도 않았다", () => {
    // 🔴 이 갈래가 없으면 둘째로 불러온 기술 작업 절차가 **화면 어디에도 안
    // 뜬다** — 큰 카드는 하나뿐이고, 끝난 것만 담던 처음 판은 이것을 걸러 냈다.
    assert.deepEqual(classifyPastExecution(MEASURED_STILL_RUNNING), {
      outcome: "STILL_RUNNING",
      label: "진행 중",
      tone: "ACTIVE",
    });
  });

  test("🔵 넷 중 **경고색이 하나도 없다** — 「중단 마침」도 「진행 중」도 나무람이 아니다", () => {
    // 색 이름은 화면(PastExecutionsSection)이 정하지만, 「급한 것」을 뜻하는
    // tone 자체가 없어야 거기서 빨강·호박색을 고를 길이 막힌다. 🔴 ATTENTION 은
    // 차단됨 딱지(ExecutionFoldNote)가 쓰는 값이다 — 그것이 여기 섞이면 안 된다.
    for (const sample of [MEASURED_COMPLETED_ALL, MEASURED_FINISHED_WITH_REMAINING, MEASURED_ABANDONED, MEASURED_STILL_RUNNING]) {
      const tone = classifyPastExecution(sample).tone;
      assert.ok(["SUCCESS", "INFO", "MUTED", "ACTIVE"].includes(tone), tone);
    }
  });

  test("🔴 넷의 tone 이 서로 다르다 — 같으면 배지를 나눈 뜻이 없다", () => {
    const tones = [MEASURED_COMPLETED_ALL, MEASURED_FINISHED_WITH_REMAINING, MEASURED_ABANDONED, MEASURED_STILL_RUNNING].map(
      (sample) => classifyPastExecution(sample).tone
    );
    assert.equal(new Set(tones).size, 4, tones.join(" | "));
  });

  test("한 장도 없는 실행을 마쳤으면 **완주**다 — 남은 것이 0 이라는 사실은 같다", () => {
    assert.equal(outcomeOf(candidate({ nodes: [] })), "COMPLETED_ALL");
  });

  test("🔴 거르는 답이 없다 — 어떤 실행이든 배지 하나를 받는다", () => {
    // 「담을까 말까」를 여기서 가르면, 못 담은 실행이 화면 어디에도 안 뜬다.
    for (const sample of [
      candidate({ completedAt: null }),
      candidate({ completedAt: null, isDeleted: true, deletedAt: null }),
      candidate({ nodes: [] }),
    ]) {
      assert.ok(classifyPastExecution(sample).label.length > 0);
    }
  });
});

describe("🔴 둘 다 찬 자료 — 그만둠이 이긴다", () => {
  /**
   * 그만두기는 completed_at 을 안 건드리지만, **마친 뒤에 그만두는** 길은
   * 일부러 열려 있다(잘못 끝냈을 때 되돌릴 유일한 길). 그러니 둘 다 찬 행은
   * 드문 자료가 아니라 되돌린 자국이다.
   *
   * 🔴 판정 순서를 누가 뒤집어도 여기서 걸린다 — 안 그러면 되돌린 실행이
   * 「완주」로 뜨고, 그 글자를 본 사람이 다 끝난 절차로 읽는다.
   */
  const bothSet = candidate({
    nodes: nodesOf({ COMPLETED: 27 }),
    completedAt: "2026-11-02T06:02:10.922Z",
    isDeleted: true,
    deletedAt: "2026-11-02T06:40:00.000Z",
    deletedByName: "홍길동",
    deleteReason: "끝내기를 잘못 눌렀습니다",
  });

  test("남은 것이 0 이어도(완주 조건을 채워도) 「그만둠」으로 읽는다", () => {
    assert.equal(assessExecutionFinish(bothSet.nodes).remainingCount, 0, "표본이 완주 조건을 정말 채우고 있어야 한다");
    assert.equal(outcomeOf(bothSet), "ABANDONED");
  });

  test("남은 것이 있을 때도(중단 마침 조건) 「그만둠」이 이긴다", () => {
    assert.equal(outcomeOf({ ...bothSet, nodes: nodesOf({ PENDING: 5, COMPLETED: 2 }) }), "ABANDONED");
  });

  test("끝난 때는 **그만둔 때**로 적힌다 — 나중에 내린 판단이 그것이다", () => {
    const panel = buildPastExecutionPanel([bothSet]);
    assert.ok(panel);
    assert.equal(panel.rows[0].whenAt, "2026-11-02T06:40:00.000Z");
    assert.equal(panel.rows[0].whenNote, "홍길동님이 그만둠");
    assert.equal(panel.rows[0].abandonReason, "끝내기를 잘못 눌렀습니다");
  });
});

describe("🔴 「남은 노드」 잣대가 조각 4·5 와 **같은 수**를 낸다", () => {
  const samples = [
    MEASURED_COMPLETED_ALL.nodes,
    MEASURED_FINISHED_WITH_REMAINING.nodes,
    MEASURED_ABANDONED.nodes,
    nodesOf({ PENDING: 2, IN_PROGRESS: 1, BLOCKED: 3 }),
    nodesOf({ COMPLETED: 3, SKIPPED: 2 }),
  ];

  test("끝내기 확인 창(assessExecutionFinish)과 수가 같다", () => {
    for (const nodes of samples) {
      const row = buildPastExecutionPanel([candidate({ nodes, isDeleted: true, deletedAt: "2026-11-02T07:00:00.000Z" })]);
      assert.ok(row);
      assert.equal(row.rows[0].remainingCount, assessExecutionFinish(nodes).remainingCount);
    }
  });

  test("「전체 단계 보기 (N)」(buildExecutionListFold)의 N 과도 같다", () => {
    // 세 자리가 다른 잣대로 세면 같은 실행에서 「전체 단계 보기 (19)」를 보면서
    // 배지는 「완주」인 화면이 된다.
    for (const nodes of samples) {
      const fold = buildExecutionListFold({ nodes, isExecutionFinished: false });
      const row = buildPastExecutionPanel([candidate({ nodes, isDeleted: true, deletedAt: "2026-11-02T07:00:00.000Z" })]);
      assert.ok(row);
      assert.equal(row.rows[0].remainingCount, fold.remaining?.count ?? 0);
    }
  });

  test("🔵 실측 한 건으로 수를 못 박는다 — 대기 16 + 진행 중 2 + 차단됨 1 = 19", () => {
    const panel = buildPastExecutionPanel([MEASURED_FINISHED_WITH_REMAINING]);
    assert.ok(panel);
    assert.equal(panel.rows[0].remainingCount, 19);
    assert.equal(panel.rows[0].doneCount, 3, "완료 2 + 건너뜀 1");
    assert.equal(panel.rows[0].totalCount, 22);
  });
});

describe("한 줄에 적히는 것", () => {
  const panel = buildPastExecutionPanel([MEASURED_FINISHED_WITH_REMAINING, MEASURED_ABANDONED, MEASURED_COMPLETED_ALL]);

  test("🔵 먼저 — 세 줄이 다 들어왔다", () => {
    assert.ok(panel);
    assert.equal(panel.rows.length, 3);
  });

  test("진행도의 분모는 **사람이 할 일 수**이고, 글자까지 도메인이 만든다", () => {
    assert.ok(panel);
    const byId = new Map(panel.rows.map((r) => [r.executionId, r]));
    assert.equal(byId.get(MEASURED_COMPLETED_ALL.executionId)?.progressLabel, "진행 27 / 27");
    assert.equal(byId.get(MEASURED_FINISHED_WITH_REMAINING.executionId)?.progressLabel, "진행 3 / 22");
    assert.equal(byId.get(MEASURED_ABANDONED.executionId)?.progressLabel, "진행 0 / 22");
  });

  test("🔵 건너뜀도 **지나온 것**으로 센다 — 요약 카드의 퍼센트와 같은 자다", () => {
    const panelOf = buildPastExecutionPanel([candidate({ nodes: nodesOf({ COMPLETED: 2, SKIPPED: 3, PENDING: 5 }) })]);
    assert.ok(panelOf);
    assert.equal(panelOf.rows[0].progressLabel, "진행 5 / 10");
  });

  test("🔴 코드가 이름과 같으면 괄호를 안 붙인다 — 실측 절차 하나가 그렇다", () => {
    assert.ok(panel);
    const byId = new Map(panel.rows.map((r) => [r.executionId, r]));
    assert.equal(byId.get(MEASURED_COMPLETED_ALL.executionId)?.title, "기본 통전 검사 (3상 입력)");
    assert.equal(
      byId.get(MEASURED_ABANDONED.executionId)?.title,
      "원복 검사 및 개선 작업 (3상 입력) (7)",
      "코드가 다르면 괄호로 붙는다 — 같은 이름의 절차가 둘일 때 가를 수단이 그것뿐이다"
    );
  });

  test("🔴 마친 줄에는 **사람 이름이 안 붙는다** — 누가 마쳤는지는 DB 에 없다", () => {
    // procedure_case_executions 에 completed_by 칸이 아예 없다. 시작한 사람을
    // 그 자리에 빌려 쓰면 「이 사람이 마쳤다」로 읽히는 거짓이 된다.
    assert.ok(panel);
    const finished = panel.rows.find((r) => r.executionId === MEASURED_COMPLETED_ALL.executionId);
    assert.equal(finished?.whenNote, "마침");
    assert.equal(finished?.startedNote, "홍길동님이 시작", "시작한 사람은 「시작」이라고 밝혀서 따로 적는다");
    assert.equal(finished?.abandonReason, null, "마친 줄에 사유 자리가 생기면 안 된다");
  });

  test("그만둔 줄에는 **누가·왜**가 붙는다", () => {
    assert.ok(panel);
    const abandoned = panel.rows.find((r) => r.executionId === MEASURED_ABANDONED.executionId);
    assert.equal(abandoned?.whenAt, "2026-11-02T06:00:19.036Z");
    assert.equal(abandoned?.whenNote, "홍길동님이 그만둠");
    assert.equal(abandoned?.abandonReason, ".", "한 글자라도 사람이 적은 것은 그대로 보인다");
  });

  test("이름을 모르면 그 자리를 비운다 — 「null님이 그만둠」이 되지 않는다", () => {
    const panelOf = buildPastExecutionPanel([
      candidate({ isDeleted: true, deletedAt: "2026-11-02T07:00:00.000Z", deletedByName: null, startedByName: null }),
    ]);
    assert.ok(panelOf);
    assert.equal(panelOf.rows[0].whenNote, "그만둠");
    assert.equal(panelOf.rows[0].startedNote, null);
  });

  test("그만둔 때가 비어 있으면(네 칸을 반만 채운 옛 자료) 시작한 때로 내려간다", () => {
    const panelOf = buildPastExecutionPanel([candidate({ completedAt: null, isDeleted: true, deletedAt: null })]);
    assert.ok(panelOf);
    assert.equal(panelOf.rows[0].whenAt, "2026-11-02T01:00:00.000Z", "차례를 정하는 열쇠라 비워 둘 수 없다");
  });
});

describe("🔴 차례 — 도는 것이 맨 위, 그다음은 최근에 끝난 것부터", () => {
  test("🔴 아직 도는 줄이 **맨 위**다 — 늦게 시작했어도 그렇다", () => {
    // 이 줄들이 생긴 까닭의 절반이 「불러왔는데 사라졌다」를 막는 것이다. 끝난
    // 줄들 아래로 내려가면 그 목적이 반감된다.
    const panel = buildPastExecutionPanel([
      MEASURED_COMPLETED_ALL, // 06:02:10 에 마침 — 도는 것보다 **나중**이다
      MEASURED_STILL_RUNNING, // 06:10:11 에 시작
      MEASURED_ABANDONED,
    ]);
    assert.ok(panel);
    assert.equal(panel.rows[0].badge.outcome, "STILL_RUNNING");
    assert.deepEqual(
      panel.rows.map((r) => r.badge.outcome),
      ["STILL_RUNNING", "COMPLETED_ALL", "ABANDONED"]
    );
  });

  test("도는 것이 둘이면 그 안에서도 최근에 시작한 것이 위다", () => {
    const older = candidate({ executionId: "run-older", completedAt: null, startedAt: "2026-11-02T01:00:00.000Z" });
    const newer = candidate({ executionId: "run-newer", completedAt: null, startedAt: "2026-11-02T05:00:00.000Z" });
    assert.deepEqual(buildPastExecutionPanel([older, newer])?.rows.map((r) => r.executionId), ["run-newer", "run-older"]);
  });

  test("실측 세 건이 끝난 차례의 역순으로 늘어선다", () => {
    // 끝난 때: 그만둠 06:00:19 < 중단 마침 06:00:59 < 완주 06:02:10
    const panel = buildPastExecutionPanel([MEASURED_ABANDONED, MEASURED_COMPLETED_ALL, MEASURED_FINISHED_WITH_REMAINING]);
    assert.ok(panel);
    assert.deepEqual(
      panel.rows.map((r) => r.badge.outcome),
      ["COMPLETED_ALL", "FINISHED_WITH_REMAINING", "ABANDONED"]
    );
  });

  test("🔴 **시작한 차례가 아니다** — 오래전에 시작해 방금 마친 절차가 맨 위다", () => {
    const oldButJustFinished = candidate({
      executionId: "old-start-new-finish",
      startedAt: "2026-10-01T00:00:00.000Z",
      completedAt: "2026-11-02T23:00:00.000Z",
    });
    const newButFinishedEarlier = candidate({
      executionId: "new-start-old-finish",
      startedAt: "2026-11-02T20:00:00.000Z",
      completedAt: "2026-11-02T21:00:00.000Z",
    });
    const panel = buildPastExecutionPanel([newButFinishedEarlier, oldButJustFinished]);
    assert.ok(panel);
    assert.deepEqual(panel.rows.map((r) => r.executionId), ["old-start-new-finish", "new-start-old-finish"]);
  });

  test("끝난 때가 같으면 id 로 가른다 — 새로고침마다 줄이 자리를 바꾸면 안 된다", () => {
    const a = candidate({ executionId: "aaa", completedAt: "2026-11-02T10:00:00.000Z" });
    const b = candidate({ executionId: "bbb", completedAt: "2026-11-02T10:00:00.000Z" });
    assert.deepEqual(buildPastExecutionPanel([b, a])?.rows.map((r) => r.executionId), ["aaa", "bbb"]);
    assert.deepEqual(buildPastExecutionPanel([a, b])?.rows.map((r) => r.executionId), ["aaa", "bbb"]);
  });
});

describe("🔴 담을 줄이 없으면 묶음을 **안 그린다**", () => {
  test("실행이 아예 없으면 null — 그때만 null 이다", () => {
    assert.equal(buildPastExecutionPanel([]), null);
  });

  test("🔴 도는 실행 하나만 있어도 **그린다** — 이것이 안 뜨면 「사라졌다」가 그대로 남는다", () => {
    const panel = buildPastExecutionPanel([MEASURED_STILL_RUNNING]);
    assert.ok(panel, "처음 판은 여기서 null 이라 둘째로 불러온 절차가 통째로 숨었다");
    assert.equal(panel.rows.length, 1);
    assert.equal(panel.rows[0].badge.label, "진행 중");
    assert.equal(panel.rows[0].progressLabel, "진행 0 / 22");
  });

  test("도는 줄의 시각은 **시작한 때**이고, 같은 말을 두 번 안 적는다", () => {
    const panel = buildPastExecutionPanel([MEASURED_STILL_RUNNING]);
    assert.ok(panel);
    assert.equal(panel.rows[0].whenAt, "2026-11-02T06:10:11.048Z", "끝난 때가 없으니 시작한 때를 적는다");
    assert.equal(panel.rows[0].whenNote, "홍길동님이 시작");
    assert.equal(panel.rows[0].startedNote, null, "위에 이미 적었는데 또 적으면 한 줄에 같은 말이 두 번 뜬다");
    assert.equal(panel.rows[0].abandonReason, null);
  });

  test("접힌 줄의 글자와 머릿수 — 기본은 **접힘**", () => {
    const panel = buildPastExecutionPanel([MEASURED_ABANDONED, MEASURED_COMPLETED_ALL]);
    assert.ok(panel);
    assert.equal(panel.fold.summary, "이 건의 다른 절차 (2)");
    assert.equal(panel.fold.count, 2);
    assert.equal(panel.fold.open, false, "펼쳐져 있으면 지금 할 일이 아래로 밀린다");
    assert.equal(panel.fold.openReason, null);
    // 🔵 2026-11-02(조각 8 보완)에 딱지가 **갈래별 수 전부**로 바뀌었다 — 전에는
    //    「진행 중」이 없으면 딱지도 없었다. 사용자가 「완주 몇 중단 마침 몇,
    //    그만둠 몇을 적어줘」라고 정했다. 시험은 지우지 않고 새 글자를 잰다.
    assert.deepEqual(panel.fold.note, { text: "완주 1 · 그만둠 1", tone: "MUTED" });
  });

  test("🔴 도는 것이 섞이면 **제목 줄에 「진행 중 N」**이 남는다 — 접어 둔 채로도 보여야 한다", () => {
    // 접기는 언제나 접힘이 기본이다(2026-11-02 사용자 결정). 그래서 이 딱지가
    // 「아직 도는 것이 이 안에 있다」를 알리는 유일한 자리다 — 차단됨 딱지와
    // 똑같은 규약.
    const panel = buildPastExecutionPanel([MEASURED_STILL_RUNNING, MEASURED_ABANDONED, MEASURED_COMPLETED_ALL]);
    assert.ok(panel);
    assert.equal(panel.fold.summary, "이 건의 다른 절차 (3)");
    // 🔵 조각 8 보완에서 딱지에 **나머지 갈래도 함께** 적게 됐다. 「진행 중」은
    //    여전히 **맨 앞**이라 눈에 먼저 들어온다 — 재는 뜻은 그대로다.
    assert.deepEqual(panel.fold.note, { text: "진행 중 1 · 완주 1 · 그만둠 1", tone: "MUTED" });
    assert.match(panel.fold.note!.text, /^진행 중 1/, "도는 것이 뒤로 밀리면 찾으러 온 사람이 또 못 찾는다");
    assert.equal(panel.fold.open, false, "딱지로 알리기로 했으니 펼치지는 않는다");
  });
});

/**
 * 🔴 2026-11-02(조각 8 보완) — 줄마다 [실행 그만두기]가 붙는다. 사용자 말:
 * 「[실행 그만두기]가 [중단 마침]인 해당 건에 대한 [실행 그만두기]인지 모든
 * [중단 마침]에 대한 그만두기인지 모르겠어. [중단 마침] 건별로 [실행 그만두기]가
 * 있도록 해주고.」 그리고 범위를 좁혀 — 「[중단 마침], [진행중]에만 붙이면 돼.」
 */
describe("🔴 어느 줄에 [실행 그만두기]가 붙는가", () => {
  /** 네 갈래를 **한 표본에** 담는다 — 「둘만 붙는다」가 한눈에 보이게. */
  const ALL_FOUR = [MEASURED_COMPLETED_ALL, MEASURED_FINISHED_WITH_REMAINING, MEASURED_ABANDONED, MEASURED_STILL_RUNNING];

  test("🔵 먼저 — 표본에 네 갈래가 **다 들어 있다**", () => {
    assert.deepEqual(new Set(ALL_FOUR.map(outcomeOf)).size, 4, "갈래가 빠지면 아래가 그 갈래를 안 잰다");
  });

  test("🔴 붙는 것은 **중단 마침 · 진행 중** 둘뿐이다", () => {
    const panel = buildPastExecutionPanel(ALL_FOUR);
    assert.ok(panel);
    assert.deepEqual(
      panel.rows.map((row) => [row.badge.label, row.abandonBlockedReason]),
      [
        ["진행 중", null],
        ["완주", "COMPLETED_ALL"],
        ["중단 마침", null],
        ["그만둠", "ALREADY_ABANDONED"],
      ]
    );
  });

  test("🔴 **완주에는 안 붙는다** — 끝까지 다 한 기록이라 치울 이유가 없다", () => {
    // 2026-11-02 사용자 결정. 그만두기는 「잘못 불러왔거나 안 쓰게 된 것을 치우는」
    // 길인데(단추의 title 그대로), 완주한 절차는 그 어느 쪽도 아니다.
    // 🔵 서버가 막는 것이 아니다 — 끝낸 실행도 서버는 그만둘 수 있게 열어 두고
    //    있다. 화면에 쓸모없는 단추를 안 두는 것이고, 되돌리는 자리가 이 함수다.
    assert.equal(resolveAbandonBlockedReason(classifyPastExecution(MEASURED_COMPLETED_ALL)), "COMPLETED_ALL");
  });

  test("🔴 이미 그만둔 줄에도 안 붙는다 — 두 번 치울 수 없다", () => {
    assert.equal(resolveAbandonBlockedReason(classifyPastExecution(MEASURED_ABANDONED)), "ALREADY_ABANDONED");
  });

  test("🔴 못 붙는 까닭 둘이 **서로 다른 값**이다 — 한 값으로 뭉치면 왜인지 못 묻는다", () => {
    const blocked = ALL_FOUR.map((c) => resolveAbandonBlockedReason(classifyPastExecution(c))).filter((r) => r !== null);
    assert.equal(new Set(blocked).size, 2, blocked.join(" | "));
  });

  test("🔴 네 갈래 **어느 것도 빠뜨리지 않는다** — 판정이 전부 돌아간다", () => {
    const outcomes: PastExecutionOutcome[] = ["COMPLETED_ALL", "FINISHED_WITH_REMAINING", "ABANDONED", "STILL_RUNNING"];
    for (const outcome of outcomes) {
      const reason = resolveAbandonBlockedReason({ outcome, label: "x", tone: "MUTED" });
      assert.equal(
        reason === null,
        outcome === "FINISHED_WITH_REMAINING" || outcome === "STILL_RUNNING",
        `${outcome} 의 답이 바뀌었다: ${reason}`
      );
    }
  });

  test("🔴 줄마다 **제 version** 을 싣는다 — 한 벌을 돌려 쓰면 남의 실행을 치우려 든다", () => {
    const panel = buildPastExecutionPanel([
      candidate({ executionId: "a", version: 7, completedAt: null, nodes: nodesOf({ PENDING: 2 }) }),
      candidate({ executionId: "b", version: 12, completedAt: null, nodes: nodesOf({ PENDING: 2 }) }),
    ]);
    assert.ok(panel);
    assert.deepEqual(
      panel.rows.map((row) => [row.executionId, row.version]).sort(),
      [
        ["a", 7],
        ["b", 12],
      ]
    );
    // 🔵 둘이 다른 값이어야 「돌려 쓴다」가 공짜로 통과하지 않는다.
    assert.notEqual(panel.rows[0].version, panel.rows[1].version);
  });
});

/**
 * 🔴 2026-11-02(조각 9) — 마친 실행을 **다시 잇는** 단추가 생겼다. 사용자 말:
 * 「절차를 다 진행하지 않고 절차를 마친 경우는 마쳐진 노드부터 절차를 재개할 수
 * 있도록 해주고.」
 *
 * 🔴 이 묶음이 잡아야 하는 고장은 **짝인 [실행 그만두기]와 붙는 줄이 다르다**는
 * 것이다. 둘을 한 답으로 뭉치면 「이미 돌고 있는 실행에 다시 잇기」가 뜨거나(눌러도
 * 아무 일이 없다) 「중단 마침에 그만두기가 사라진다」가 조용히 생긴다.
 */
describe("🔴 어느 줄에 [절차 다시 잇기]가 붙는가", () => {
  /** 네 갈래를 **한 표본에** 담는다 — 「하나에만 붙는다」가 한눈에 보이게. */
  const ALL_FOUR = [MEASURED_COMPLETED_ALL, MEASURED_FINISHED_WITH_REMAINING, MEASURED_ABANDONED, MEASURED_STILL_RUNNING];

  test("🔵 먼저 — 표본에 네 갈래가 **다 들어 있다**", () => {
    assert.equal(new Set(ALL_FOUR.map(outcomeOf)).size, 4, "갈래가 빠지면 아래가 그 갈래를 안 잰다");
  });

  test("🔴 붙는 것은 **중단 마침 하나**뿐이다", () => {
    const panel = buildPastExecutionPanel(ALL_FOUR);
    assert.ok(panel);
    assert.deepEqual(
      panel.rows.map((row) => [row.badge.label, row.resumeBlockedReason]),
      [
        ["진행 중", "ALREADY_RUNNING"],
        ["완주", "COMPLETED_ALL"],
        ["중단 마침", null],
        ["그만둠", "ALREADY_ABANDONED"],
      ]
    );
  });

  test("🔴 짝인 [실행 그만두기]와 **붙는 줄이 다르다** — 한 답으로 뭉치면 안 된다", () => {
    // 그만두기는 둘(중단 마침 · 진행 중), 다시 잇기는 하나(중단 마침)다. 🔴 「진행
    // 중」 줄에서 둘의 답이 갈리는 것이 이 시험의 본체다 — 거기에 다시 잇기가
    // 뜨면 눌러도 아무 일이 없는 단추가 된다(이미 돌고 있다).
    const panel = buildPastExecutionPanel(ALL_FOUR);
    assert.ok(panel);
    const byLabel = new Map(panel.rows.map((row) => [row.badge.label, row]));
    assert.equal(byLabel.get("진행 중")!.abandonBlockedReason, null, "그만두기는 붙는다");
    assert.equal(byLabel.get("진행 중")!.resumeBlockedReason, "ALREADY_RUNNING", "다시 잇기는 안 붙는다");
    // 나머지 셋에서는 두 답이 같다 — 그래서 「진행 중」 하나가 둘을 가르는 자리다.
    for (const label of ["완주", "중단 마침", "그만둠"]) {
      const row = byLabel.get(label)!;
      assert.equal(
        row.resumeBlockedReason === null,
        row.abandonBlockedReason === null,
        `${label} 줄에서 둘의 답이 갈렸다`
      );
    }
  });

  test("🔴 **완주에는 안 붙는다** — 이어서 할 것이 한 장도 없다", () => {
    // 다시 이어 봤자 「지금 할 일」 자리에 「모든 작업이 끝났습니다」만 서는 빈
    // 화면이 된다.
    // 🔵 서버가 막는 것이 아니다 — 완주한 실행도 서버는 다시 이을 수 있게 열어 두고
    //    있다(resumeProcedureExecution). 화면에 쓸모없는 단추를 안 두는 것이다.
    assert.equal(resolveResumeBlockedReason(classifyPastExecution(MEASURED_COMPLETED_ALL)), "COMPLETED_ALL");
  });

  test("🔴 이미 그만둔 줄에도 안 붙는다 — 치운 것은 되살리지 않는다", () => {
    assert.equal(resolveResumeBlockedReason(classifyPastExecution(MEASURED_ABANDONED)), "ALREADY_ABANDONED");
  });

  test("🔴 도는 줄에도 안 붙는다 — 이미 돌고 있다", () => {
    assert.equal(resolveResumeBlockedReason(classifyPastExecution(MEASURED_STILL_RUNNING)), "ALREADY_RUNNING");
  });

  test("🔴 못 붙는 까닭 셋이 **서로 다른 값**이다 — 한 값으로 뭉치면 왜인지 못 묻는다", () => {
    const blocked = ALL_FOUR.map((c) => resolveResumeBlockedReason(classifyPastExecution(c))).filter((r) => r !== null);
    assert.equal(new Set(blocked).size, 3, blocked.join(" | "));
  });

  test("🔴 네 갈래 **어느 것도 빠뜨리지 않는다** — 판정이 전부 돌아간다", () => {
    const outcomes: PastExecutionOutcome[] = ["COMPLETED_ALL", "FINISHED_WITH_REMAINING", "ABANDONED", "STILL_RUNNING"];
    for (const outcome of outcomes) {
      const reason = resolveResumeBlockedReason({ outcome, label: "x", tone: "MUTED" });
      assert.equal(reason === null, outcome === "FINISHED_WITH_REMAINING", `${outcome} 의 답이 바뀌었다: ${reason}`);
    }
  });

  test("🔴 **「마친 뒤에 그만둔 행」은 그만둠으로 읽는다** — 배지 하나를 따르므로 어긋날 길이 없다", () => {
    // 두 칸이 다 찬 행에서 completed_at 만 보고 가르면 「다시 잇기」가 치운 줄에
    // 뜬다 — 서버는 그 실행을 아예 못 찾으므로 눌러도 거절로만 끝난다.
    const bothSet = candidate({
      nodes: nodesOf({ PENDING: 5, COMPLETED: 2 }),
      completedAt: "2026-11-02T06:02:10.922Z",
      isDeleted: true,
      deletedAt: "2026-11-02T06:40:00.000Z",
      deletedByName: "홍길동",
      deleteReason: "끝내기를 잘못 눌렀습니다",
    });
    assert.ok(bothSet.completedAt, "표본 확인 — 마친 칸이 정말 차 있다");
    const panel = buildPastExecutionPanel([bothSet]);
    assert.equal(panel?.rows[0].resumeBlockedReason, "ALREADY_ABANDONED");
  });
});

/**
 * 🔴 2026-11-02(조각 8 보완) — 사용자 말: 「[이 건의 다른 절차]가 접혀 있을 때
 * 완주 몇 중단 마침 몇, 그만둠 몇을 적어줘.」 전에는 「진행 중 N」 하나뿐이었다.
 */
describe("🔴 접힌 줄의 딱지에 **갈래별 수**가 다 적힌다", () => {
  /** 사용자가 적어 준 모습 그대로 — 완주 1 · 중단 마침 1 · 그만둠 2. */
  const SECOND_ABANDONED = candidate({
    executionId: "11111111-2222-3333-4444-555555555555",
    nodes: nodesOf({ PENDING: 5 }),
    startedAt: "2026-11-02T00:10:00.000Z",
    completedAt: null,
    isDeleted: true,
    deletedAt: "2026-11-02T00:40:00.000Z",
    deletedByName: "홍길동",
    deleteReason: "다른 절차로 바꿨습니다",
  });

  /** 딱지 글자에서 수만 뽑아 더한다 — 괄호 안 수와 맞춰 보려고. */
  function sumOfNote(text: string): number {
    return (text.match(/\d+/g) ?? []).reduce((acc, n) => acc + Number(n), 0);
  }

  test("네 갈래가 다 있으면 **이 글자 그대로** 뜬다", () => {
    const panel = buildPastExecutionPanel([
      MEASURED_COMPLETED_ALL,
      MEASURED_FINISHED_WITH_REMAINING,
      MEASURED_ABANDONED,
      MEASURED_STILL_RUNNING,
    ]);
    assert.ok(panel);
    assert.deepEqual(panel.fold.note, { text: "진행 중 1 · 완주 1 · 중단 마침 1 · 그만둠 1", tone: "MUTED" });
  });

  test("사용자가 적어 준 모습 — 「완주 1 · 중단 마침 1 · 그만둠 2」", () => {
    const panel = buildPastExecutionPanel([
      MEASURED_COMPLETED_ALL,
      MEASURED_FINISHED_WITH_REMAINING,
      MEASURED_ABANDONED,
      SECOND_ABANDONED,
    ]);
    assert.ok(panel);
    assert.equal(panel.fold.summary, "이 건의 다른 절차 (4)");
    assert.equal(panel.fold.note?.text, "완주 1 · 중단 마침 1 · 그만둠 2");
  });

  test("🔴 **0 은 안 적는다** — 없는 갈래는 글자에 아예 안 나온다", () => {
    const panel = buildPastExecutionPanel([MEASURED_ABANDONED]);
    assert.ok(panel);
    assert.equal(panel.fold.note?.text, "그만둠 1");
    for (const word of ["완주", "중단 마침", "진행 중", "0"]) {
      assert.ok(!panel.fold.note!.text.includes(word), `${word} 가 적혔다: ${panel.fold.note!.text}`);
    }
  });

  test("🔴 딱지 수의 **합 = 괄호 안 수**다 — 갈래가 늘면 조용히 안 맞게 된다", () => {
    const samples = [
      [MEASURED_ABANDONED],
      [MEASURED_STILL_RUNNING, MEASURED_ABANDONED],
      [MEASURED_COMPLETED_ALL, MEASURED_FINISHED_WITH_REMAINING, MEASURED_ABANDONED, SECOND_ABANDONED],
      [MEASURED_COMPLETED_ALL, MEASURED_FINISHED_WITH_REMAINING, MEASURED_ABANDONED, MEASURED_STILL_RUNNING],
    ];
    for (const sample of samples) {
      const panel = buildPastExecutionPanel(sample);
      assert.ok(panel?.fold.note, "딱지가 없으면 접힌 줄에서 갈래가 통째로 안 보인다");
      assert.equal(sumOfNote(panel.fold.note.text), panel.fold.count, panel.fold.note.text);
      assert.equal(panel.fold.count, sample.length);
    }
  });

  test("🔵 「실행 이력」 딱지와 **같은 모양**이다 — 가름표도 tone 도", () => {
    // 두 묶음이 다른 모양이면 읽는 사람이 둘을 다른 것으로 본다. 거기는
    // 「완료 4 · 건너뜀 1」이다(buildExecutionHistoryFold).
    const panel = buildPastExecutionPanel([MEASURED_COMPLETED_ALL, MEASURED_ABANDONED]);
    assert.ok(panel?.fold.note);
    assert.match(panel.fold.note.text, / · /);
    assert.equal(panel.fold.note.tone, "MUTED", "경고색을 쓰면 「고장」으로 읽힌다");
  });

  test("🔵 **진행 중이 맨 앞**이다 — 줄 차례와 같은 잣대(도는 것이 맨 위)", () => {
    const panel = buildPastExecutionPanel([MEASURED_ABANDONED, MEASURED_STILL_RUNNING]);
    assert.ok(panel?.fold.note);
    assert.equal(panel.fold.note.text, "진행 중 1 · 그만둠 1");
    assert.equal(panel.rows[0].badge.outcome, "STILL_RUNNING", "딱지 차례와 줄 차례가 어긋나면 서로를 설명하지 못한다");
  });
});
