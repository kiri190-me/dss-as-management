import { test } from "node:test";
import assert from "node:assert/strict";
import {
  isValidExpectedVersion,
  isValidWeeklyReportDeliveryId,
  validateWeeklyReportDeliveryFields,
} from "./weekly-report-delivery-input";

/**
 * ============================================================================
 * 주간보고 납입 예정 건 입력 검증 — 무엇을 받아들이고 무엇을 거절하는가
 * ============================================================================
 * 지키는 것은 넷이다.
 *
 *  1. **주는 월요일로 접힌다** — 사람이 수요일을 골라도 뜻은 "그 주"다. 금주
 *     목표와 **같은 함수**로 접으므로 두 상자가 같은 주를 가리킨다.
 *  2. **비고는 비어 있어도 된다** — 빈 문자열도 공백만 적힌 값도 거절하지 않고
 *     **null 하나로** 접힌다. 이것이 금주 목표(goal_text 는 비울 수 없다)와
 *     갈리는 지점이라, 그 차이를 여기서 못 박는다.
 *  3. **수리 건은 반드시 골라야 한다** — 이 줄의 여덟 칸 중 여섯이 거기서 온다.
 *  4. **차례는 1 이상의 정수이거나 없음** — 없으면 그 줄은 뒤로 간다.
 * ============================================================================
 */

const CASE_ID = "11111111-2222-3333-4444-555555555555";

function fields(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return { weekStartDate: "2026-08-24", repairCaseId: CASE_ID, ...overrides };
}

// ────────────────────────────────────────────────── 주

test("월요일은 그대로 들어간다", () => {
  const result = validateWeeklyReportDeliveryFields(fields());
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.data.weekStartDate, "2026-08-24");
});

test("수요일을 고르면 그 주 월요일로 접힌다 — 거절하지 않는다", () => {
  const result = validateWeeklyReportDeliveryFields(fields({ weekStartDate: "2026-08-26" }));
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.data.weekStartDate, "2026-08-24");
});

test("일요일은 그 앞의 월요일로 간다 — 한 주는 월요일에 시작한다", () => {
  const result = validateWeeklyReportDeliveryFields(fields({ weekStartDate: "2026-08-30" }));
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.data.weekStartDate, "2026-08-24");
});

test("실제로 없는 날짜는 거절한다", () => {
  // 형식은 맞지만 2026-02-31 은 존재하지 않는 날이다. 그대로 넘기면 Postgres 가
  // 거절해 사용자에게는 이유 없는 실패만 남는다.
  const result = validateWeeklyReportDeliveryFields(fields({ weekStartDate: "2026-02-31" }));
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.ok(result.fieldErrors.weekStartDate);
});

test("날짜가 아예 없으면 거절한다", () => {
  const result = validateWeeklyReportDeliveryFields({ repairCaseId: CASE_ID });
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.ok(result.fieldErrors.weekStartDate);
});

// ────────────────────────────────────────────────── 수리 건

test("수리 건을 고르지 않으면 거절한다", () => {
  const result = validateWeeklyReportDeliveryFields({ weekStartDate: "2026-08-24" });
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.ok(result.fieldErrors.repairCaseId);
});

test("UUID 가 아닌 수리 건 값은 거절한다", () => {
  const result = validateWeeklyReportDeliveryFields(fields({ repairCaseId: "D251107" }));
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.ok(result.fieldErrors.repairCaseId);
});

// ────────────────────────────────────────────────── 비고

test("비고를 아예 주지 않으면 null 이다 — 오류가 아니다", () => {
  const result = validateWeeklyReportDeliveryFields(fields());
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.data.note, null);
});

test("빈 문자열도 공백만 적힌 값도 같은 null 로 접힌다", () => {
  for (const raw of ["", "   ", "\t\n"]) {
    const result = validateWeeklyReportDeliveryFields(fields({ note: raw }));
    assert.equal(result.ok, true, `note=${JSON.stringify(raw)} 는 통과해야 한다`);
    if (!result.ok) return;
    assert.equal(result.data.note, null);
  }
});

test("null 을 그대로 줘도 null 이다", () => {
  const result = validateWeeklyReportDeliveryFields(fields({ note: null }));
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.data.note, null);
});

test("적힌 비고는 앞뒤 공백을 털고 들어간다", () => {
  const result = validateWeeklyReportDeliveryFields(fields({ note: "  고객사 요청으로 연기  " }));
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.data.note, "고객사 요청으로 연기");
});

test("비고 500자는 통과하고 501자는 거절한다", () => {
  const ok = validateWeeklyReportDeliveryFields(fields({ note: "가".repeat(500) }));
  assert.equal(ok.ok, true);

  const tooLong = validateWeeklyReportDeliveryFields(fields({ note: "가".repeat(501) }));
  assert.equal(tooLong.ok, false);
  if (tooLong.ok) return;
  assert.ok(tooLong.fieldErrors.note);
});

test("문자열이 아닌 비고는 거절한다", () => {
  const result = validateWeeklyReportDeliveryFields(fields({ note: 42 }));
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.ok(result.fieldErrors.note);
});

// ────────────────────────────────────────────────── 차례

test("차례를 정하지 않으면 null 이다", () => {
  for (const raw of [undefined, null, ""]) {
    const result = validateWeeklyReportDeliveryFields(fields({ displayOrder: raw }));
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.data.displayOrder, null);
  }
});

test("<input> 에서 온 문자열 숫자를 받는다", () => {
  const result = validateWeeklyReportDeliveryFields(fields({ displayOrder: "3" }));
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.data.displayOrder, 3);
});

test("0 이하·소수·글자는 거절한다", () => {
  for (const raw of [0, -1, 1.5, "일", "1.5"]) {
    const result = validateWeeklyReportDeliveryFields(fields({ displayOrder: raw }));
    assert.equal(result.ok, false, `displayOrder=${JSON.stringify(raw)} 는 거절해야 한다`);
    if (result.ok) return;
    assert.ok(result.fieldErrors.displayOrder);
  }
});

// ────────────────────────────────────────────────── id · version

test("줄 id 는 UUID 여야 한다", () => {
  assert.equal(isValidWeeklyReportDeliveryId(CASE_ID), true);
  assert.equal(isValidWeeklyReportDeliveryId("not-a-uuid"), false);
  assert.equal(isValidWeeklyReportDeliveryId(undefined), false);
});

test("version 은 1 이상의 정수다 — 금주 목표와 같은 규칙을 그대로 쓴다", () => {
  assert.equal(isValidExpectedVersion(1), true);
  assert.equal(isValidExpectedVersion(0), false);
  assert.equal(isValidExpectedVersion("1"), false);
});

// ────────────────────────────────────────────────── 여러 칸이 한꺼번에 틀렸을 때

test("틀린 칸이 여럿이면 오류도 여럿이다 — 한 번에 다 보여 준다", () => {
  const result = validateWeeklyReportDeliveryFields({
    weekStartDate: "언젠가",
    repairCaseId: "D251107",
    displayOrder: 0,
  });
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.deepEqual(Object.keys(result.fieldErrors).sort(), [
    "displayOrder",
    "repairCaseId",
    "weekStartDate",
  ]);
});
