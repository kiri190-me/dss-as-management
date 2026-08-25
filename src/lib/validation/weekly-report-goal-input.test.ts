import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import {
  isValidExpectedVersion,
  isValidWeeklyReportGoalId,
  normalizeWeekStart,
  validateWeeklyReportGoalCopy,
  validateWeeklyReportGoalFields,
} from "./weekly-report-goal-input";

/**
 * 이 파일이 지키는 것은 셋이다.
 *
 *  1. **주는 언제나 월요일로 접힌다** — 같은 주가 두 값으로 갈리면 지난주
 *     목록이 두 벌이 되고, 방금 적은 줄이 보이지 않는 화면이 만들어진다.
 *  2. **목표 문장은 비울 수 없다** — 비운 줄은 아무 말도 하지 않는 줄이다.
 *  3. **오류는 칸 단위 한국어다** — 어느 칸이 틀렸는지 화면이 짚어 줄 수 있어야
 *     한다.
 */

const REPAIR_CASE_ID = randomUUID();

function raw(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    weekStartDate: "2026-08-24",
    repairCaseId: REPAIR_CASE_ID,
    goalText: "견적서 발행",
    ...overrides,
  };
}

// ────────────────────────────────────────────────── 주 접기

test("월요일은 그대로 통과한다", () => {
  assert.equal(normalizeWeekStart("2026-08-24"), "2026-08-24");
});

test("주중 아무 날이나 그 주 월요일로 접힌다 — 거절하지 않는다", () => {
  assert.equal(normalizeWeekStart("2026-08-27"), "2026-08-24");
  assert.equal(normalizeWeekStart("2026-08-30"), "2026-08-24", "일요일은 앞의 월요일이다");
});

test("앞뒤 공백은 다듬어진다", () => {
  assert.equal(normalizeWeekStart("  2026-08-27  "), "2026-08-24");
});

test("실제로 없는 날짜는 접히지 않는다", () => {
  // 2026-02-31 은 형식은 맞지만 존재하지 않는 날이다. 그대로 넘기면
  // Postgres 가 22008 로 거절해 사용자에게는 이유 없는 실패만 남는다.
  assert.equal(normalizeWeekStart("2026-02-31"), null);
  assert.equal(normalizeWeekStart("2026-8-24"), null, "두 자리로 적히지 않은 값");
  assert.equal(normalizeWeekStart(""), null);
  assert.equal(normalizeWeekStart(null), null);
  assert.equal(normalizeWeekStart(20260824), null);
});

test("저장도 주를 월요일로 접어 넣는다", () => {
  const result = validateWeeklyReportGoalFields(raw({ weekStartDate: "2026-08-27" }));
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.data.weekStartDate, "2026-08-24");
});

test("주가 없거나 날짜가 아니면 그 칸에 오류가 붙는다", () => {
  for (const bad of [undefined, "", "어제", "2026-13-01"]) {
    const result = validateWeeklyReportGoalFields(raw({ weekStartDate: bad }));
    assert.equal(result.ok, false, String(bad));
    if (result.ok) return;
    assert.ok(result.fieldErrors.weekStartDate, String(bad));
  }
});

// ────────────────────────────────────────────────── 수리 건 연결

test("수리 건 연결은 비울 수 없다 — NOT NULL 이다", () => {
  for (const bad of [undefined, null, "", "not-a-uuid"]) {
    const result = validateWeeklyReportGoalFields(raw({ repairCaseId: bad }));
    assert.equal(result.ok, false, String(bad));
    if (result.ok) return;
    assert.ok(result.fieldErrors.repairCaseId, String(bad));
  }
});

test("UUID 면 그대로 통과한다 — 실제로 있는지는 mutation 이 본다", () => {
  const result = validateWeeklyReportGoalFields(raw());
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.data.repairCaseId, REPAIR_CASE_ID);
});

// ────────────────────────────────────────────────── 목표 문장

test("목표 문장 앞뒤 공백은 다듬어진다", () => {
  const result = validateWeeklyReportGoalFields(raw({ goalText: "  견적서 발행  " }));
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.data.goalText, "견적서 발행");
});

test("빈 목표는 거절한다 — 비우고 싶으면 그 줄을 지우는 것이 맞다", () => {
  for (const bad of ["", "   ", undefined, null, 3]) {
    const result = validateWeeklyReportGoalFields(raw({ goalText: bad }));
    assert.equal(result.ok, false, String(bad));
    if (result.ok) return;
    assert.ok(result.fieldErrors.goalText, String(bad));
  }
});

test("500자를 넘는 목표는 거절한다", () => {
  const ok = validateWeeklyReportGoalFields(raw({ goalText: "가".repeat(500) }));
  assert.equal(ok.ok, true);
  const tooLong = validateWeeklyReportGoalFields(raw({ goalText: "가".repeat(501) }));
  assert.equal(tooLong.ok, false);
  if (tooLong.ok) return;
  assert.ok(tooLong.fieldErrors.goalText);
});

test("괄호가 붙은 실제 목표 문장이 그대로 통과한다", () => {
  const result = validateWeeklyReportGoalFields(
    raw({ goalText: "견적서 발행 (교산의 부품견적 대기 중)" })
  );
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.data.goalText, "견적서 발행 (교산의 부품견적 대기 중)");
});

// ────────────────────────────────────────────────── 차례

test("차례를 적지 않으면 null 이다", () => {
  for (const empty of [undefined, null, ""]) {
    const result = validateWeeklyReportGoalFields(raw({ displayOrder: empty }));
    assert.equal(result.ok, true, String(empty));
    if (!result.ok) return;
    assert.equal(result.data.displayOrder, null, String(empty));
  }
});

test("입력칸에서 온 문자열 숫자도 받는다", () => {
  const result = validateWeeklyReportGoalFields(raw({ displayOrder: "3" }));
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.data.displayOrder, 3);
});

test("0 이하·소수·글자는 거절한다", () => {
  for (const bad of [0, -1, 1.5, "abc", "1.5"]) {
    const result = validateWeeklyReportGoalFields(raw({ displayOrder: bad }));
    assert.equal(result.ok, false, String(bad));
    if (result.ok) return;
    assert.ok(result.fieldErrors.displayOrder, String(bad));
  }
});

test("integer 범위를 넘는 차례는 거절한다 — DB 에서 터지기 전에 잡는다", () => {
  const result = validateWeeklyReportGoalFields(raw({ displayOrder: 2_147_483_648 }));
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.ok(result.fieldErrors.displayOrder);
});

// ────────────────────────────────────────────────── id · version

test("id 는 UUID 여야 한다", () => {
  assert.equal(isValidWeeklyReportGoalId(randomUUID()), true);
  assert.equal(isValidWeeklyReportGoalId("1234"), false);
  assert.equal(isValidWeeklyReportGoalId(null), false);
});

test("version 은 1 이상의 정수다", () => {
  assert.equal(isValidExpectedVersion(1), true);
  assert.equal(isValidExpectedVersion(0), false);
  assert.equal(isValidExpectedVersion(-3), false);
  assert.equal(isValidExpectedVersion(1.5), false);
  assert.equal(isValidExpectedVersion("1"), false);
});

// ────────────────────────────────────────────────── 복사

test("복사는 두 주를 모두 월요일로 접는다", () => {
  const result = validateWeeklyReportGoalCopy({
    fromWeekStart: "2026-08-19", // 수요일
    toWeekStart: "2026-08-28", // 금요일
  });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.data.fromWeekStart, "2026-08-17");
  assert.equal(result.data.toWeekStart, "2026-08-24");
});

test("같은 주로는 복사할 수 없다 — 접고 나서 같아지는 경우까지 잡는다", () => {
  const result = validateWeeklyReportGoalCopy({
    fromWeekStart: "2026-08-24", // 월요일
    toWeekStart: "2026-08-27", // 같은 주의 목요일
  });
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.ok(result.fieldErrors.toWeekStart);
});

test("복사도 실제로 없는 날짜를 거절한다", () => {
  const result = validateWeeklyReportGoalCopy({
    fromWeekStart: "2026-02-31",
    toWeekStart: "2026-08-24",
  });
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.ok(result.fieldErrors.fromWeekStart);
});
