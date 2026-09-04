import { test } from "node:test";
import assert from "node:assert/strict";

import {
  decideAutoPreviewBackfill,
  formatPreviewBackfillProgress,
  shouldOfferManualPreviewRebuild,
  type AutoPreviewBackfillInput,
} from "./preview-backfill";

/**
 * ============================================================================
 * 저절로 도는 것은 사람이 누르는 것과 위험이 다르다
 * ============================================================================
 * 이 채우기는 사진마다 **원본을 통째로 내려받는다**. 사람이 누를 때는 누른
 * 만큼만 돌지만, 화면이 스스로 부르면 조건이 조금만 어긋나도 사내망을 계속
 * 두드리게 된다. 그래서 여기서 못박는 것은 세 가지다.
 *
 *  1. **한 번만 돈다** — 실패해도, 목록이 다시 그려져도 두 번째는 없다.
 *  2. **권한이 없으면 안 돈다** — 받아 놓고 마지막에 403 을 받는 일이 없어야 한다.
 *  3. **막혀서 남은 것이 있을 때만** 사람에게 단추를 내민다.
 * ============================================================================
 */

/** 아무 문제 없이 "지금 돌아야 하는" 상태. 시험마다 한 군데씩만 어긋뜨린다. */
function ready(overrides: Partial<AutoPreviewBackfillInput> = {}): AutoPreviewBackfillInput {
  return {
    canManage: true,
    missingCount: 10,
    hasStarted: false,
    isRunning: false,
    isBusy: false,
    ...overrides,
  };
}

// ─────────────────────────────────────────── 돌아야 할 때

test("권한이 있고 채울 것이 있으면 돈다", () => {
  assert.deepEqual(decideAutoPreviewBackfill(ready()), { run: true });
});

test("한 장만 없어도 돈다", () => {
  assert.deepEqual(decideAutoPreviewBackfill(ready({ missingCount: 1 })), { run: true });
});

// ─────────────────────────────────────────── ★ 한 번만 돈다

test("★ 이미 시작했으면 돌지 않는다 — 목록이 다시 그려져도 두 번째는 없다", () => {
  assert.deepEqual(decideAutoPreviewBackfill(ready({ hasStarted: true })), {
    run: false,
    reason: "ALREADY_STARTED",
  });
});

test("★ 시작한 뒤에는 실패해 채울 것이 그대로 남아 있어도 다시 돌지 않는다", () => {
  // 자동 재시도를 넣으면 서버가 거절할 때 원본을 계속 받아 오며 무한히
  // 두드린다. 남은 것은 사람이 단추로 처리한다(아래 shouldOffer… 시험).
  const afterFailure = ready({ hasStarted: true, missingCount: 10 });
  assert.deepEqual(decideAutoPreviewBackfill(afterFailure), {
    run: false,
    reason: "ALREADY_STARTED",
  });
});

test("★ 시작 깃발은 권한 다음, 나머지 어떤 조건보다 먼저 본다", () => {
  // 돌고 있지 않고 한가하고 채울 것이 있어도, 시작했으면 그것이 답이다.
  const decision = decideAutoPreviewBackfill(
    ready({ hasStarted: true, isRunning: false, isBusy: false })
  );
  assert.equal(decision.run, false);
  assert.equal(decision.run === false && decision.reason, "ALREADY_STARTED");
});

// ─────────────────────────────────────────── ★ 권한이 없으면 안 돈다

test("★ 고칠 권한이 없으면 돌지 않는다 — 사진마다 원본만 받고 거절당한다", () => {
  assert.deepEqual(decideAutoPreviewBackfill(ready({ canManage: false })), {
    run: false,
    reason: "NO_PERMISSION",
  });
});

test("★ 권한 판정이 가장 앞이다 — 채울 것이 많아도 권한이 먼저다", () => {
  const decision = decideAutoPreviewBackfill(
    ready({ canManage: false, missingCount: 200, hasStarted: false })
  );
  assert.equal(decision.run === false && decision.reason, "NO_PERMISSION");
});

// ─────────────────────────────────────────── 그 밖에 멈추는 이유

test("이미 돌고 있으면 겹쳐 돌지 않는다", () => {
  assert.deepEqual(decideAutoPreviewBackfill(ready({ isRunning: true })), {
    run: false,
    reason: "RUNNING",
  });
});

test("지우기·되살리기가 도는 중이면 비켜 준다", () => {
  assert.deepEqual(decideAutoPreviewBackfill(ready({ isBusy: true })), {
    run: false,
    reason: "BUSY",
  });
});

test("채울 것이 없으면 돌지 않는다", () => {
  assert.deepEqual(decideAutoPreviewBackfill(ready({ missingCount: 0 })), {
    run: false,
    reason: "NOTHING_MISSING",
  });
});

test("음수가 들어와도 돌지 않는다 — 셈이 어긋나 원본을 받아 오는 일이 없게", () => {
  assert.deepEqual(decideAutoPreviewBackfill(ready({ missingCount: -1 })), {
    run: false,
    reason: "NOTHING_MISSING",
  });
});

// ─────────────────────────────────────────── 단추를 내미는 때

test("★ 평소에는 단추를 내밀지 않는다 — 아직 한 번도 돌지 않았으면 감춘다", () => {
  assert.equal(
    shouldOfferManualPreviewRebuild({
      canManage: true,
      hasFinishedRun: false,
      missingCount: 10,
      isRunning: false,
    }),
    false
  );
});

test("★ 자동으로 채우다 막혀 남은 것이 있으면 단추를 내민다", () => {
  assert.equal(
    shouldOfferManualPreviewRebuild({
      canManage: true,
      hasFinishedRun: true,
      missingCount: 3,
      isRunning: false,
    }),
    true
  );
});

test("다 채워졌으면 단추가 사라진다", () => {
  assert.equal(
    shouldOfferManualPreviewRebuild({
      canManage: true,
      hasFinishedRun: true,
      missingCount: 0,
      isRunning: false,
    }),
    false
  );
});

test("도는 중에는 단추 대신 진행 표시가 나온다", () => {
  assert.equal(
    shouldOfferManualPreviewRebuild({
      canManage: true,
      hasFinishedRun: true,
      missingCount: 3,
      isRunning: true,
    }),
    false
  );
});

test("★ 권한이 없으면 남은 것이 있어도 단추를 내밀지 않는다 — 눌러도 거절당한다", () => {
  assert.equal(
    shouldOfferManualPreviewRebuild({
      canManage: false,
      hasFinishedRun: true,
      missingCount: 3,
      isRunning: false,
    }),
    false
  );
});

// ─────────────────────────────────────────── 진행 표시 문구

test("진행 표시는 몇 장 중 몇 장째인지 말한다", () => {
  assert.equal(formatPreviewBackfillProgress({ current: 3, total: 10 }), "미리보기 만드는 중… 3/10");
});

test("진행 표시에 경고하는 말이 없다 — 사람이 할 일이 아니다", () => {
  const text = formatPreviewBackfillProgress({ current: 1, total: 1 });
  assert.equal(text.includes("만들기"), false);
  assert.equal(text.includes("없어"), false);
});
