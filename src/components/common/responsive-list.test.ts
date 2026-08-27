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

// ── defaultMode — 폭이 정하게 두면 안 되는 목록만 ──────────────────────────
// 사진 격자처럼 무엇을 보러 온 자리인지가 이미 정해진 목록을 위한 것이다.
// 나머지 목록은 이 인자를 넘기지 않고, 넘기지 않은 쪽이 위 세 시험 그대로다.

test("defaultMode 를 주면 고른 적이 없을 때 폭 대신 그것이 정한다", () => {
  // 넓은 화면(fits=true)에서도 사진 격자부터 보인다 — 표가 들어간다는 사실이
  // "사진을 보러 온 사람에게 글자 표를 먼저 내밀 이유"가 되지는 않는다.
  assert.equal(resolveShowTable(null, true, "CARD"), false, "들어가도 카드");
  assert.equal(resolveShowTable(null, false, "CARD"), false, "안 들어가도 카드");
  // 반대 방향도 같은 규칙이다.
  assert.equal(resolveShowTable(null, false, "TABLE"), true, "안 들어가도 표");
  assert.equal(resolveShowTable(null, true, "TABLE"), true, "들어가도 표");
});

test("defaultMode 가 있어도 사람이 고른 값이 언제나 이긴다", () => {
  // 이 성질이 깨지면 "골라 놨는데 새로고침하면 되돌아간다"가 된다.
  assert.equal(resolveShowTable("TABLE", false, "CARD"), true, "표를 골랐으면 표");
  assert.equal(resolveShowTable("TABLE", true, "CARD"), true);
  assert.equal(resolveShowTable("CARD", true, "TABLE"), false, "카드를 골랐으면 카드");
  assert.equal(resolveShowTable("CARD", false, "TABLE"), false);
});

test("defaultMode 를 넘기지 않으면 예전 규칙 그대로다", () => {
  // 인자를 아예 안 준 호출과 undefined 를 준 호출이 같아야, 이 인자를 모르는
  // 나머지 목록이 한 픽셀도 달라지지 않는다.
  for (const fits of [true, false]) {
    assert.equal(resolveShowTable(null, fits, undefined), resolveShowTable(null, fits));
    assert.equal(resolveShowTable(null, fits, undefined), fits);
    assert.equal(resolveShowTable("TABLE", fits, undefined), true);
    assert.equal(resolveShowTable("CARD", fits, undefined), false);
  }
});
