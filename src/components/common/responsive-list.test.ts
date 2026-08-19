import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveShowTable } from "./responsive-list";

// 목록이 표를 보여 줄지 카드를 보여 줄지 정하는 단 하나의 판단. 이 규칙이
// 흔들리면 13개 목록이 한꺼번에 흔들리므로 여기서 못 박아 둔다.

test("고른 적이 없으면 폭이 정한다 — 예전 규칙 그대로", () => {
  assert.equal(resolveShowTable(null, true), true, "들어가면 표");
  assert.equal(resolveShowTable(null, false), false, "안 들어가면 카드");
});

test("한 번 고르면 그 선택이 폭을 이긴다", () => {
  assert.equal(resolveShowTable("CARD", true), false, "표가 들어가도 카드를 골랐으면 카드");
  assert.equal(resolveShowTable("TABLE", false), true, "안 들어가도 표를 골랐으면 표(가로 스크롤)");
});

test("고른 대로 보여 준 뒤에도 폭 판정은 계속 유효하다", () => {
  // 표를 골라 둔 사람이 창을 넓혀도 계속 표다 — fits가 true로 바뀌었다고
  // 선택이 초기화되지는 않는다.
  assert.equal(resolveShowTable("TABLE", true), true);
  assert.equal(resolveShowTable("CARD", false), false);
});
