import assert from "node:assert/strict";
import { test } from "node:test";

import {
  OVERHAUL_MONTHS,
  assessOverhaul,
  formatElapsed,
  formatProduction,
  parseSerialProduction,
} from "./overhaul";

const TODAY = new Date(2026, 7, 28); // 2026-08-28

test("S/N 에서 생산 연월을 읽는다 — 사용자가 준 예시", () => {
  assert.deepEqual(parseSerialProduction("1904097"), { year: 2019, month: 4, sequence: 97 });
});

test("두 자리 연도는 70 을 경계로 편다 — 미래에 생산된 장비를 만들지 않는다", () => {
  assert.equal(parseSerialProduction("0401001")?.year, 2004);
  assert.equal(parseSerialProduction("2601001")?.year, 2026);
  assert.equal(parseSerialProduction("9901001")?.year, 1999);
});

test("🔴 형식이 다른 S/N 은 '대상 아님'이 아니라 '판정 불가'다", () => {
  // 문자 접두가 붙은 S/N 이 실제로 있다. "대상 아님"이라고 답하면 틀린 답이다.
  assert.equal(parseSerialProduction("WU8042"), null);
  assert.equal(assessOverhaul("WU8042", TODAY).kind, "UNKNOWN");
  assert.equal(assessOverhaul(null, TODAY).kind, "UNKNOWN");
  assert.equal(assessOverhaul("", TODAY).kind, "UNKNOWN");
  assert.equal(assessOverhaul(undefined, TODAY).kind, "UNKNOWN");
});

test("있을 수 없는 달은 판정하지 않는다", () => {
  assert.equal(parseSerialProduction("1913097"), null);
  assert.equal(parseSerialProduction("1900097"), null);
});

test("자릿수가 모자라면 판정하지 않는다", () => {
  assert.equal(parseSerialProduction("1904"), null);
  assert.equal(parseSerialProduction("190"), null);
});

test("생산월로부터 4년이 지나면 O/H 대상이다", () => {
  const result = assessOverhaul("1904097", TODAY);
  assert.equal(result.kind, "ASSESSED");
  if (result.kind !== "ASSESSED") return;
  assert.equal(result.isDue, true);
  // 2019-04 → 2026-08 은 88개월.
  assert.equal(result.monthsElapsed, 88);
});

test("정확히 48개월째부터 대상이다 — 경계", () => {
  // 2022-08 생산 → 2026-08 은 48개월.
  const due = assessOverhaul("2208001", TODAY);
  assert.equal(due.kind === "ASSESSED" && due.monthsElapsed, 48);
  assert.equal(due.kind === "ASSESSED" && due.isDue, true);

  // 2022-09 생산 → 47개월. 아직 아니다.
  const notYet = assessOverhaul("2209001", TODAY);
  assert.equal(notYet.kind === "ASSESSED" && notYet.monthsElapsed, 47);
  assert.equal(notYet.kind === "ASSESSED" && notYet.isDue, false);
});

test("기준 개월 수는 4년이다", () => {
  assert.equal(OVERHAUL_MONTHS, 48);
});

test("🔴 OP TIME 은 판정하지 못했다고 언제나 밝힌다", () => {
  // 그 값을 담는 칸이 아직 없다. 감추면 5만 시간을 넘긴 4년 미만 장비를
  // 시스템이 "대상 아님"이라고 잘라 말하는 셈이 된다.
  const result = assessOverhaul("2501001", TODAY);
  assert.equal(result.kind === "ASSESSED" && result.opTimeUnknown, true);
  assert.equal(result.kind === "ASSESSED" && result.isDue, false);
});

test("근거 문장", () => {
  assert.equal(formatProduction({ year: 2019, month: 4, sequence: 97 }), "2019년 4월 (97번째)");
  assert.equal(formatElapsed(88), "7년 4개월 경과");
  assert.equal(formatElapsed(48), "4년 경과");
  assert.equal(formatElapsed(7), "7개월 경과");
  assert.equal(formatElapsed(-2), "생산 예정");
});
