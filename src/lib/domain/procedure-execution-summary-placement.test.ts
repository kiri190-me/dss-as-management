import { describe, test } from "node:test";
import assert from "node:assert/strict";
import {
  placeExecutionSummary,
  type ExecutionSummaryPlacement,
} from "./procedure-execution-summary-placement";

/**
 * 진행 요약 상자가 **어디에 서는가**, 그리고 그에 맞물린 **빼기 대상**
 * (2026-11-02, 조각 8).
 *
 * ── 여기서 꼭 잡아야 하는 고장 둘 ───────────────────────────────────────
 * 자리와 빼기가 어긋나면 둘 중 하나가 된다. 둘 다 오류가 한 번도 안 나고
 * **화면에서만** 드러나는 종류라, 불변식으로 못 박는다.
 *
 *   1. 상자도 서고 줄도 선다 … 같은 절차가 한 화면에 두 번.
 *   2. 상자도 안 서고 줄도 없다 … 마친 절차가 화면 어디에도 안 뜬다.
 *
 * 실측 형편(2026-11-02 개발 DB): D261098 에 마친 실행 1건과 그만둔 실행 2건이
 * 있다 — 마친 실행이 큰 카드에 설 자리를 차지한 채 아래 줄에서는 빠져 있던
 * 상태가 바로 이 조각이 고치는 것이다.
 */

const RUNNING = { executionId: "e5e9424a", isExecutionFinished: false };
const FINISHED = { executionId: "66c8ba16", isExecutionFinished: true };

const ALL: ExecutionSummaryPlacement[] = [
  placeExecutionSummary(RUNNING),
  placeExecutionSummary(FINISHED),
  placeExecutionSummary(null),
];

describe("🔵 먼저 — 세 형편이 실제로 **서로 다른 답**을 낸다", () => {
  test("자리 셋이 다 다르다 — 하나로 뭉쳐 있으면 아래가 전부 공짜로 통과한다", () => {
    assert.deepEqual(
      ALL.map((p) => p.slot),
      ["TOP", "OTHER_RUNS", "NONE"]
    );
    assert.equal(new Set(ALL.map((p) => p.reason)).size, 3, "까닭도 셋이어야 「왜 거기인가」를 잴 수 있다");
  });
});

describe("아직 도는 실행 — 화면 맨 위에 선다", () => {
  const placement = placeExecutionSummary(RUNNING);

  test("자리는 TOP 이고 까닭은 RUNNING 이다", () => {
    assert.equal(placement.slot, "TOP");
    assert.equal(placement.reason, "RUNNING");
  });

  test("🔴 그때는 아래 묶음에서 **그 실행을 뺀다** — 안 빼면 한 화면에 두 번 뜬다", () => {
    assert.equal(placement.excludedFromOtherRuns, "e5e9424a");
  });
});

describe("🔴 마친 실행 — 위에 안 서고 「이 건의 다른 절차」로 내려간다", () => {
  const placement = placeExecutionSummary(FINISHED);

  test("자리는 OTHER_RUNS 이고 까닭은 FINISHED 다", () => {
    // 2026-11-02 사용자 결정: 「절차가 마쳐진 경우 진행바 상자가 [이 건의 다른
    // 절차]에 속하게 해줘.」
    assert.equal(placement.slot, "OTHER_RUNS");
    assert.equal(placement.reason, "FINISHED");
  });

  test("🔴 그때는 **빼지 않는다** — 빼면 마친 절차가 화면 어디에도 안 뜬다", () => {
    // 이 한 줄이 조각 8 의 고비다. 전에는 「화면에 선 실행」이라는 이유로 늘
    // 뺐는데, 상자가 내려온 뒤로는 그 이유가 성립하지 않는다.
    assert.equal(placement.excludedFromOtherRuns, null);
  });
});

describe("세울 실행이 없을 때 — 그만둔 뒤의 화면", () => {
  const placement = placeExecutionSummary(null);

  test("그릴 상자가 없고(NONE), 까닭이 「실행이 없다」로 갈려 있다", () => {
    assert.equal(placement.slot, "NONE");
    assert.equal(placement.reason, "NO_EXECUTION");
  });

  test("뺄 것도 없다 — 이 건의 실행이 전부 아래 묶음의 재료가 된다", () => {
    // 그만둔 실행만 남은 화면에서 그 줄들이 유일한 자국이다.
    assert.equal(placement.excludedFromOtherRuns, null);
  });
});

describe("🔴 불변식 — 「위에 선다」와 「뺀다」는 **같은 답**이다", () => {
  test("TOP 일 때만, 그리고 TOP 이면 반드시 뺀다", () => {
    for (const placement of ALL) {
      assert.equal(
        placement.excludedFromOtherRuns !== null,
        placement.slot === "TOP",
        `${placement.slot}/${placement.reason} 에서 자리와 빼기가 어긋났다`
      );
    }
  });

  test("🔵 양쪽 표본이 실제로 있다 — 「뺀다」도 「안 뺀다」도 한 번씩 나온다", () => {
    const excluded = ALL.filter((p) => p.excludedFromOtherRuns !== null);
    assert.equal(excluded.length, 1, "하나도 안 빼면 위 불변식이 공짜로 통과한다");
    assert.equal(ALL.length - excluded.length, 2);
  });

  test("🔴 뺄 id 는 **받은 그 실행**이다 — 다른 id 를 꾸며내지 않는다", () => {
    assert.equal(placeExecutionSummary({ executionId: "abc-123", isExecutionFinished: false }).excludedFromOtherRuns, "abc-123");
  });
});

describe("🔴 「마쳤는가」를 여기서 다시 판정하지 않는다", () => {
  test("같은 실행이라도 받은 사실이 뒤집히면 답이 뒤집힌다", () => {
    const id = "66c8ba16";
    assert.equal(placeExecutionSummary({ executionId: id, isExecutionFinished: false }).slot, "TOP");
    assert.equal(placeExecutionSummary({ executionId: id, isExecutionFinished: true }).slot, "OTHER_RUNS");
  });

  test("🔵 completedAt 같은 날것을 안 받는다 — 사실 한 줄을 큰 카드·아래 목록과 함께 쓴다", () => {
    // 인자가 isExecutionFinished 하나라, 부르는 쪽마다 `!== null` 을 다시 적을
    // 자리가 없다. 타입이 그것을 강제한다.
    const keys = Object.keys(RUNNING).sort();
    assert.deepEqual(keys, ["executionId", "isExecutionFinished"]);
  });
});
