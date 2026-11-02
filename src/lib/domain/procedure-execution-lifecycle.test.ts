import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { assessExecutionFinish, type ExecutionFinishCandidate } from "./procedure-execution-lifecycle";
import { buildExecutionListFold } from "./procedure-execution-list-fold";
import {
  PROCEDURE_CASE_EXECUTION_NODE_STATUS_CODES,
  type ProcedureCaseExecutionNodeStatus,
} from "./procedure-case-execution-types";

/**
 * 실행을 **끝낼 때** 무엇을 물어야 하는가(2026-11-02, 조각 5).
 *
 * 이 판정이 순수 함수인 까닭은 **화면과 서버가 같은 답을 봐야** 하기 때문이다.
 * 화면만 물으면 화면을 거치지 않는 호출(오래된 탭 · 직접 호출)이 아무것도 안 묻고
 * 끝낸다. 서버 쪽에서 그 거절이 정말 일어나는지는 db 목록의
 * procedure-case-execution.integration.test.ts 가 잰다.
 *
 * 🔵 표본이 비어 공짜로 통과하지 않게 「무엇을 재는가」를 먼저 단언한다 —
 * 상태가 다섯이라는 것과, 쓰는 표본이 실제로 그 상태를 담고 있다는 것.
 */

function nodesOf(counts: Partial<Record<ProcedureCaseExecutionNodeStatus, number>>): ExecutionFinishCandidate[] {
  const out: ExecutionFinishCandidate[] = [];
  for (const [status, count] of Object.entries(counts) as [ProcedureCaseExecutionNodeStatus, number][]) {
    for (let i = 0; i < count; i += 1) out.push({ status });
  }
  return out;
}

/** 실측 66c8ba16(2026-11-02): 대기 16 · 차단됨 1 · 완료 4 · 건너뜀 1 = 22장. */
const MEASURED_RUNNING = nodesOf({ PENDING: 16, BLOCKED: 1, COMPLETED: 4, SKIPPED: 1 });
/** 실측 dd0389d1: 28장이 전부 완료 — 끝낼 준비가 된 실행은 이 모양이다. */
const MEASURED_FINISHED = nodesOf({ COMPLETED: 28 });

describe("🔵 먼저 — 무엇을 재는가", () => {
  test("상태는 다섯 가지이고, 「남은 것」은 그중 셋이다", () => {
    assert.deepEqual(
      [...PROCEDURE_CASE_EXECUTION_NODE_STATUS_CODES],
      ["PENDING", "IN_PROGRESS", "COMPLETED", "SKIPPED", "BLOCKED"],
      "상태가 늘면 「남은 것」의 셈도 다시 정해야 한다"
    );
  });

  test("표본이 비어 있지 않다 — 둘이 서로 다른 답을 내야 이 시험이 뜻을 가진다", () => {
    assert.equal(MEASURED_RUNNING.length, 22);
    assert.equal(MEASURED_FINISHED.length, 28);
    assert.notEqual(
      assessExecutionFinish(MEASURED_RUNNING).needsConfirmation,
      assessExecutionFinish(MEASURED_FINISHED).needsConfirmation
    );
  });
});

describe("남은 것이 없으면 묻지 않는다", () => {
  const assessment = assessExecutionFinish(MEASURED_FINISHED);

  test("확인이 필요 없고, 물을 글자도 없다", () => {
    assert.equal(assessment.remainingCount, 0);
    assert.equal(assessment.blockedCount, 0);
    assert.equal(assessment.needsConfirmation, false);
    assert.equal(assessment.confirmationMessage, null, "물을 것이 없는데 글자가 남아 있으면 빈 창이 뜬다");
  });

  test("건너뛴 것도 **끝난 것**이다 — 「안 했으니 남았다」로 세지 않는다", () => {
    // 건너뛰기는 사람이 사유를 적어 「안 한다」고 정한 것이라 더 할 일이 없다.
    const assessed = assessExecutionFinish(nodesOf({ COMPLETED: 3, SKIPPED: 2 }));
    assert.equal(assessed.remainingCount, 0);
    assert.equal(assessed.needsConfirmation, false);
  });

  test("노드가 아예 없는 실행도 그냥 끝낼 수 있다", () => {
    assert.equal(assessExecutionFinish([]).needsConfirmation, false);
  });
});

describe("🔴 남은 것이 있으면 묻는다", () => {
  const assessment = assessExecutionFinish(MEASURED_RUNNING);

  test("대기 · 진행 중 · 차단됨을 모두 「남은 것」으로 센다", () => {
    assert.equal(assessment.remainingCount, 17, "대기 16 + 차단됨 1");
    assert.equal(assessment.blockedCount, 1);
    assert.equal(assessment.needsConfirmation, true);
  });

  test("진행 중도 빠뜨리지 않는다 — 하고 있던 일이 가장 아쉬운 것이다", () => {
    const assessed = assessExecutionFinish(nodesOf({ IN_PROGRESS: 1, COMPLETED: 5 }));
    assert.equal(assessed.remainingCount, 1);
    assert.equal(assessed.needsConfirmation, true);
  });

  test("확인 문구에 **수가 적혀** 있다 — 「정말요?」만 묻는 창은 아무것도 안 알려 준다", () => {
    assert.match(assessment.confirmationMessage ?? "", /17개/);
    assert.match(assessment.confirmationMessage ?? "", /차단됨 1개/);
    assert.match(assessment.confirmationMessage ?? "", /그래도 이 절차를 끝낼까요\?$/);
  });

  test("차단된 것이 없으면 그 말은 아예 안 적는다 — 「차단됨 0개」는 읽을 값이 없다", () => {
    const message = assessExecutionFinish(nodesOf({ PENDING: 3, COMPLETED: 1 })).confirmationMessage ?? "";
    assert.match(message, /3개/);
    assert.ok(!message.includes("차단됨"), message);
  });
});

describe("🔴 아래 목록과 **같은 잣대**로 센다", () => {
  test("확인 문구의 수가 「전체 단계 보기 (N)」의 N 과 같다", () => {
    // 두 자리가 다른 잣대로 세면, 「전체 단계 보기 (17)」을 보면서 확인 창에서는
    // 「15개 남았습니다」를 읽게 된다. 접는 쪽 판정은 조각 4 가 이미 정해 뒀고
    // (procedure-execution-list-fold.ts), 여기서 그것과 맞춘다.
    for (const sample of [MEASURED_RUNNING, nodesOf({ PENDING: 2, IN_PROGRESS: 1, BLOCKED: 3 }), MEASURED_FINISHED]) {
      const fold = buildExecutionListFold({ nodes: sample, isExecutionFinished: false });
      assert.equal(assessExecutionFinish(sample).remainingCount, fold.remaining?.count ?? 0);
    }
  });
});
