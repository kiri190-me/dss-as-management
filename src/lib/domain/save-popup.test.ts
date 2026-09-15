import { test } from "node:test";
import assert from "node:assert/strict";
import {
  SAVE_POPUP_NAVIGATION_TIMEOUT_MS,
  SAVE_POPUP_VISIBLE_MS,
  isAlreadyAtSavePopupTarget,
  normalizeSavePopupRequest,
  savePopupTargetPathname,
} from "./save-popup";

test("팝업은 0.5초 떠 있다 — 사용자가 정한 값", () => {
  assert.equal(SAVE_POPUP_VISIBLE_MS, 500);
});

test("넘긴 뒤 붙들어 두는 한도는 떠 있는 시간보다 길다", () => {
  assert.ok(SAVE_POPUP_NAVIGATION_TIMEOUT_MS > SAVE_POPUP_VISIBLE_MS);
});

test("문구와 앱 안 경로가 있으면 그대로 받는다", () => {
  assert.deepEqual(normalizeSavePopupRequest({ message: " 등록했습니다. ", redirectTo: "/customers" }), {
    message: "등록했습니다.",
    redirectTo: "/customers",
  });
});

test("넘어갈 곳이 null 이면 팝업만 띄운다", () => {
  assert.deepEqual(normalizeSavePopupRequest({ message: "저장했습니다.", redirectTo: null }), {
    message: "저장했습니다.",
    redirectTo: null,
  });
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
      { message: "저장했습니다.", redirectTo: null },
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
