import { test } from "node:test";
import assert from "node:assert/strict";
import {
  SAVE_POPUP_EVENT,
  SAVE_POPUP_NAVIGATION_TIMEOUT_MS,
  SAVE_POPUP_PROGRESS_EVENT,
  SAVE_POPUP_VISIBLE_MS,
  isAlreadyAtSavePopupTarget,
  nextSavePopupOnProgress,
  normalizeSavePopupProgressSignal,
  normalizeSavePopupRequest,
  savePopupCountsDownToLeave,
  savePopupTargetPathname,
} from "./save-popup";

test("팝업은 0.5초 떠 있다 — 사용자가 정한 값", () => {
  assert.equal(SAVE_POPUP_VISIBLE_MS, 500);
});

test("넘긴 뒤 붙들어 두는 한도는 떠 있는 시간보다 길다", () => {
  assert.ok(SAVE_POPUP_NAVIGATION_TIMEOUT_MS > SAVE_POPUP_VISIBLE_MS);
});

/**
 * 🔵 아래 기대값마다 `historyMode: "push"` 가 붙어 있는 것은 **2026-11-01 에 갈래가 하나
 * 생겼기 때문**이다(SavePopupHistoryMode). 단언을 약하게 만든 것이 아니라 **기본값이
 * 그대로라는 것을 못 박은 것**이다 — 지금까지 팝업을 부르던 화면 수십 곳이 이 한 글자로
 * 그대로 돈다. 적지 않은 호출이 `"replace"` 로 읽히기 시작하면 여기서 터진다.
 */
test("문구와 앱 안 경로가 있으면 그대로 받는다 — 히스토리는 지금까지대로 push", () => {
  assert.deepEqual(normalizeSavePopupRequest({ message: " 등록했습니다. ", redirectTo: "/customers" }), {
    message: "등록했습니다.",
    redirectTo: "/customers",
    historyMode: "push",
  });
});

test("넘어갈 곳이 null 이면 팝업만 띄운다", () => {
  assert.deepEqual(normalizeSavePopupRequest({ message: "저장했습니다.", redirectTo: null }), {
    message: "저장했습니다.",
    redirectTo: null,
    historyMode: "push",
  });
});

test("🔴 historyMode — 아는 글자 하나만 받고, 나머지는 전부 지금까지의 push 다", () => {
  assert.equal(
    normalizeSavePopupRequest({ message: "저장했습니다.", redirectTo: "/quotes", historyMode: "replace" })
      ?.historyMode,
    "replace"
  );
  // 🔴 커스텀 이벤트로 오는 신호라 무엇이든 실릴 수 있다 — 모르는 값은 기본값으로 기운다.
  for (const historyMode of [undefined, null, "", "REPLACE", "pushState", 1, {}, ["replace"]]) {
    assert.equal(
      normalizeSavePopupRequest({ message: "저장했습니다.", redirectTo: "/quotes", historyMode })?.historyMode,
      "push",
      JSON.stringify(historyMode)
    );
  }
});

test("문구가 없거나 비어 있으면 띄우지 않는다", () => {
  assert.equal(normalizeSavePopupRequest(null), null);
  assert.equal(normalizeSavePopupRequest("저장했습니다."), null);
  assert.equal(normalizeSavePopupRequest({ redirectTo: "/customers" }), null);
  assert.equal(normalizeSavePopupRequest({ message: "   ", redirectTo: "/customers" }), null);
});

test("앱 밖으로 튀는 주소는 넘기지 않고 팝업만 띄운다", () => {
  for (const redirectTo of [
    "https://evil.example",
    "//evil.example",
    "/\\evil.example",
    "customers",
    "",
    42,
    undefined,
  ]) {
    assert.deepEqual(
      normalizeSavePopupRequest({ message: "저장했습니다.", redirectTo }),
      { message: "저장했습니다.", redirectTo: null, historyMode: "push" },
      String(redirectTo)
    );
  }
});

test("넘어갈 주소에서 경로만 떼어 낸다", () => {
  assert.equal(savePopupTargetPathname("/repair-cases"), "/repair-cases");
  assert.equal(savePopupTargetPathname("/repair-cases?status=OPEN"), "/repair-cases");
  assert.equal(savePopupTargetPathname("/repair-cases/1/quotes#top"), "/repair-cases/1/quotes");
});

test("이미 그 화면인지 — 검색어와 끝의 / 는 가리지 않는다", () => {
  assert.equal(isAlreadyAtSavePopupTarget("/repair-cases", "/repair-cases?page=2"), true);
  assert.equal(isAlreadyAtSavePopupTarget("/repair-cases/", "/repair-cases"), true);
  assert.equal(isAlreadyAtSavePopupTarget("/repair-cases/new", "/repair-cases"), false);
  assert.equal(isAlreadyAtSavePopupTarget("/", "/"), true);
});

/**
 * ============================================================================
 * 🔴 진행 중 팝업 (2026-10-12)
 * ============================================================================
 * 까닭은 save-popup.ts 머리말. 여기서 못 박는 것:
 *  · 🔴 띄우면 **저절로 닫히지 않는다**(뜨자마자 사라지지 않는다)
 *  · 🔴 끝났다고 알리면 글자가 바뀌고 **그때부터** 0.5초를 센다
 *  · 🔴 그만두면 닫히고 **아무 데도 가지 않는다**
 *  · 🔴 기존 저장 팝업은 한 글자도 달라지지 않는다 — 신호 이름도 셈도 따로다
 * ============================================================================
 */

const RUNNING = {
  phase: "start",
  message: "저장된 엑셀을 PDF 로 바꾸는 중입니다…",
  redirectTo: "/quotes",
  historyMode: "push",
} as const;

test("🔴 진행 중 팝업은 **저절로 닫히지 않는다** — 뜨자마자 0.5초를 세지 않는다", () => {
  const popup = nextSavePopupOnProgress(null, RUNNING);
  assert.deepEqual(popup, {
    message: "저장된 엑셀을 PDF 로 바꾸는 중입니다…",
    redirectTo: "/quotes",
    historyMode: "push",
    awaitingFinish: true,
  });
  // 이 한 줄이 「뜨자마자 사라진다」를 막는다 — 호스트가 이 값으로 시계를 건다.
  assert.equal(savePopupCountsDownToLeave({ ...popup!, navigating: false }), false);
});

test("🔴 끝났다고 알리면 글자가 바뀌고 **그때부터** 0.5초를 센다 — 넘어갈 곳은 그대로", () => {
  const running = nextSavePopupOnProgress(null, RUNNING)!;
  const done = nextSavePopupOnProgress(running, { phase: "finish", message: "완료되었습니다" });
  assert.deepEqual(done, {
    message: "완료되었습니다",
    redirectTo: "/quotes",
    historyMode: "push",
    awaitingFinish: false,
  });
  assert.equal(savePopupCountsDownToLeave({ ...done!, navigating: false }), true);
  assert.equal(SAVE_POPUP_VISIBLE_MS, 500);
});

test("🔴 **어떻게 넘길지도** 띄울 때의 것을 끝까지 들고 간다 — 끝남 신호는 그 값을 싣지 않는다", () => {
  const running = nextSavePopupOnProgress(null, { ...RUNNING, historyMode: "replace" })!;
  assert.equal(running.historyMode, "replace");
  const done = nextSavePopupOnProgress(running, { phase: "finish", message: "완료되었습니다" });
  // 🔴 여기서 "push" 로 되돌아가면 발판 한 칸이 남아 목록에서 뒤로가기를 두 번 눌러야 한다.
  assert.equal(done?.historyMode, "replace");
  assert.equal(done?.redirectTo, "/quotes");
});

test("🔴 그만두면 닫히고 — 아무 데도 가지 않는다", () => {
  const running = nextSavePopupOnProgress(null, RUNNING)!;
  assert.equal(nextSavePopupOnProgress(running, { phase: "cancel" }), null);
});

test("🔴 끝남 · 그만둠은 진행 중이 아닌 팝업에 닿지 않는다 — undefined(아무것도 하지 않는다)", () => {
  const plain = {
    message: "견적서를 저장했습니다.",
    redirectTo: "/quotes",
    historyMode: "push",
    awaitingFinish: false,
  } as const;
  for (const signal of [{ phase: "finish", message: "완료되었습니다" } as const, { phase: "cancel" } as const]) {
    assert.equal(nextSavePopupOnProgress(plain, signal), undefined, signal.phase);
    assert.equal(nextSavePopupOnProgress(null, signal), undefined, signal.phase);
  }
});

test("🔴 평범한 저장 팝업은 지금까지 그대로 0.5초를 센다 — 넘기는 중에만 멈춘다", () => {
  assert.equal(savePopupCountsDownToLeave({ awaitingFinish: false, navigating: false }), true);
  assert.equal(savePopupCountsDownToLeave({ awaitingFinish: false, navigating: true }), false);
});

test("진행 신호도 앱 밖으로 튀는 주소는 걸러 낸다 — 저장 팝업과 같은 자", () => {
  assert.deepEqual(normalizeSavePopupProgressSignal({ phase: "start", message: " 바꾸는 중… ", redirectTo: "/quotes" }), {
    phase: "start",
    message: "바꾸는 중…",
    redirectTo: "/quotes",
    historyMode: "push",
  });
  assert.deepEqual(
    normalizeSavePopupProgressSignal({ phase: "start", message: "바꾸는 중…", redirectTo: "https://evil.example" }),
    { phase: "start", message: "바꾸는 중…", redirectTo: null, historyMode: "push" }
  );
  // 🔴 띄우는 신호도 같은 자로 잰다 — 거르는 규칙이 두 벌이면 한쪽만 고쳐진다.
  assert.deepEqual(
    normalizeSavePopupProgressSignal({
      phase: "start",
      message: "바꾸는 중…",
      redirectTo: "/quotes",
      historyMode: "replace",
    }),
    { phase: "start", message: "바꾸는 중…", redirectTo: "/quotes", historyMode: "replace" }
  );
  assert.deepEqual(normalizeSavePopupProgressSignal({ phase: "finish", message: " 완료되었습니다 " }), {
    phase: "finish",
    message: "완료되었습니다",
  });
  assert.deepEqual(normalizeSavePopupProgressSignal({ phase: "cancel" }), { phase: "cancel" });
});

test("모양이 아닌 신호는 받지 않는다", () => {
  for (const value of [
    null,
    "start",
    { phase: "start", redirectTo: "/quotes" },
    { phase: "start", message: "   ", redirectTo: "/quotes" },
    { phase: "finish" },
    { phase: "finish", message: "  " },
    { phase: "거의-cancel" },
    {},
  ]) {
    assert.equal(normalizeSavePopupProgressSignal(value), null, JSON.stringify(value));
  }
});

test("🔴 신호 이름이 저장 팝업과 다르다 — 기존 길에 끼어들지 않는다", () => {
  assert.equal(SAVE_POPUP_EVENT, "dss:save-popup");
  assert.equal(SAVE_POPUP_PROGRESS_EVENT, "dss:save-popup-progress");
  assert.notEqual(SAVE_POPUP_EVENT, SAVE_POPUP_PROGRESS_EVENT);
});
