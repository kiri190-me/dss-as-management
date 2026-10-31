import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  UNSAVED_LEAVE_CONFIRM_TITLE,
  UNSAVED_LEAVE_SENTINEL_KEY,
  unsavedLeaveHistoryMode,
  unsavedLeaveInstallsSentinel,
  unsavedLeaveOnExitRequest,
  unsavedLeaveOnPopState,
  unsavedLeaveSentinelState,
  unsavedLeaveWarnsOnUnload,
} from "./unsaved-leave-guard";

/**
 * ============================================================================
 * 🔴 **저장 안 된 내용을 두고 나가려 할 때 막는다** (2026-11-01)
 * ============================================================================
 * 🔴 **브라우저에서 Alt+← 를 실제로 눌러 볼 수 없는 자리**다. 그래서 여기서 재는 것은
 * 「눌렀을 때 무엇을 하기로 했는가」 — 값이다. 그 값을 창·히스토리로 옮기는 일은
 * components/common/useUnsavedLeaveGuard.ts 하나가 한다.
 *
 * 못 박는 것 다섯:
 *   1. 🔴 **안 바뀐 상태에서는 막지 않는다** — 세 갈래 전부.
 *   2. 🔴 **바뀌면 세 갈래가 함께** 막는다(한 갈래만 고쳐지는 일이 없게).
 *   3. 🔴 발판은 **고친 뒤에만** 세우고, **나가기로 한 뒤에는** 세우지 않는다.
 *   4. 🔴 남의 `popstate` 에는 손대지 않고, **우리가 걷어낸 것**도 다시 세우지 않는다.
 *   5. 🔴 발판이 서 있으면 **replace** 로 나간다(안 그러면 뒤로가기를 두 번 눌러야 한다).
 * ============================================================================
 */

describe("🔴 ① 안 바뀐 상태에서는 아무도 막지 않는다", () => {
  test("[취소]는 묻지 않고 바로 나간다", () => {
    assert.equal(unsavedLeaveOnExitRequest(false), "GO");
  });

  test("🔴 뒤로가기는 **그대로 통과시킨다** — 발판이 먹은 한 번을 돌려준다", () => {
    assert.equal(
      unsavedLeaveOnPopState({ ours: true, leaving: false, dirty: false }),
      "FORWARD_BACK"
    );
  });

  test("탭 닫기 · 새로고침에도 경고하지 않는다", () => {
    assert.equal(unsavedLeaveWarnsOnUnload(false), false);
  });

  test("발판을 세우지도 않는다 — 세워 두면 뒤로가기 한 번이 아무 일도 안 한다", () => {
    assert.equal(
      unsavedLeaveInstallsSentinel({ dirty: false, armed: false, leaving: false }),
      false
    );
  });
});

describe("🔴 ② 바뀌면 **세 갈래가 함께** 막는다", () => {
  /**
   * 🔴 이 한 시험이 「한 갈래만 고쳐지는 일」을 막는다. 셋 가운데 하나라도 제 값을 따로
   * 재기 시작하면 아래 `deepEqual` 이 터진다 — 실제로 보고서 화면에서 **머리의 나가기가
   * 링크라 묻지 않던** 일이 있었다(2026-10-19 에 고쳤다).
   */
  test("🔴 [취소] · 뒤로가기 · 탭 닫기 — 셋이 **같은 값 하나**로 움직인다", () => {
    for (const dirty of [true, false]) {
      const blocks = [
        unsavedLeaveOnExitRequest(dirty) === "ASK",
        unsavedLeaveOnPopState({ ours: true, leaving: false, dirty }) === "REARM_AND_ASK",
        unsavedLeaveWarnsOnUnload(dirty),
      ];
      assert.deepEqual(blocks, [dirty, dirty, dirty], `dirty=${dirty} 인데 갈래마다 답이 다르다`);
    }
  });

  test("창에 적는 글은 **사용자가 정한 그대로**다", () => {
    assert.equal(UNSAVED_LEAVE_CONFIRM_TITLE, "저장되지 않는 내용이 있습니다. 저장하시겠습니까?");
  });
});

describe("🔴 ③ 발판은 고친 뒤에만 · 한 칸만 · 나가기로 한 뒤에는 안 세운다", () => {
  test("고치면 세운다", () => {
    assert.equal(
      unsavedLeaveInstallsSentinel({ dirty: true, armed: false, leaving: false }),
      true
    );
  });

  test("🔴 이미 서 있으면 **더 쌓지 않는다** — 글자를 칠 때마다 쌓이면 뒤로가기가 열 번 먹힌다", () => {
    assert.equal(unsavedLeaveInstallsSentinel({ dirty: true, armed: true, leaving: false }), false);
  });

  test("🔴 나가기로 한 뒤에는 세우지 않는다 — 떠나는 중에 쌓으면 도착한 화면에서 두 번 눌러야 한다", () => {
    assert.equal(unsavedLeaveInstallsSentinel({ dirty: true, armed: false, leaving: true }), false);
  });

  test("발판 state 에 알아볼 표식이 실린다 — 흔한 이름이 아니다", () => {
    assert.deepEqual(unsavedLeaveSentinelState(), { [UNSAVED_LEAVE_SENTINEL_KEY]: true });
    assert.ok(UNSAVED_LEAVE_SENTINEL_KEY.startsWith("__dss"), UNSAVED_LEAVE_SENTINEL_KEY);
    // Next 가 같은 상자에 넣는 제 값들과 부딪치면 안 된다.
    for (const theirs of ["__NA", "_N", "__PRIVATE_NEXTJS_INTERNALS_TREE"]) {
      assert.notEqual(UNSAVED_LEAVE_SENTINEL_KEY, theirs);
    }
  });
});

describe("🔴 ④ 남의 뒤로가기에는 손대지 않는다", () => {
  test("🔴 우리 발판이 아니면 **아무것도 하지 않는다** — 고쳤든 안 고쳤든", () => {
    for (const dirty of [true, false]) {
      assert.equal(
        unsavedLeaveOnPopState({ ours: false, leaving: false, dirty }),
        "IGNORE",
        `dirty=${dirty}`
      );
    }
  });

  test("🔴 우리가 걷어낸 것도 다시 세우지 않는다 — 세우면 영영 못 나간다", () => {
    assert.equal(unsavedLeaveOnPopState({ ours: true, leaving: true, dirty: true }), "IGNORE");
  });

  test("🔴 고친 것이 있으면 **다시 세우고 묻는다** — 그래야 [취소] 뒤에 또 눌러도 또 뜬다", () => {
    assert.equal(
      unsavedLeaveOnPopState({ ours: true, leaving: false, dirty: true }),
      "REARM_AND_ASK"
    );
  });
});

describe("🔴 ⑤ 발판이 서 있으면 replace 로 나간다", () => {
  test("🔴 안 걷으면 도착한 목록에서 뒤로가기를 **두 번** 눌러야 한다", () => {
    assert.equal(unsavedLeaveHistoryMode(true), "replace");
  });

  test("🔵 발판이 없으면 지금까지 그대로 push — 다른 화면 수십 곳이 이 값으로 돈다", () => {
    assert.equal(unsavedLeaveHistoryMode(false), "push");
  });
});
