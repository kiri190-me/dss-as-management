import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildGoalPrefix,
  formatGoalLine,
  mondayOfDateOnly,
  sortWeeklyReportGoals,
  weekLabel,
  weekStartOfKst,
  type WeeklyReportGoalPrefixSource,
} from "./weekly-report-goal";

/**
 * ============================================================================
 * 주간보고 금주 목표 — 규칙이 실제로 그렇게 도는가
 * ============================================================================
 * 지키는 것은 넷이다.
 *
 *  1. **주는 월요일에 시작한다** — 일곱 요일 전부, 그리고 달·해 경계.
 *  2. **한국 기준이다** — UTC 자정 함정. 한국시간 오전 0시와 오전 9시 직전후에
 *     같은 답이 나와야 한다. 이 저장소가 실제로 겪은 회귀라
 *     (repair-case-overdue.test.ts) 같은 자물쇠를 여기에도 건다.
 *  3. **없는 조각은 건너뛴다** — `__` 같은 빈 자리가 생기면 안 된다. 공백만
 *     적힌 값도 "없음"이다.
 *  4. **차례는 display_order, 같으면 적은 차례** — NULL 은 뒤로.
 * ============================================================================
 */

// ────────────────────────────────────────────────── 주의 시작(월요일)

test("월요일은 그날 그대로다", () => {
  // 2026-08-24 는 월요일이다 — 지시서의 예시 상자 머리말이 이 날이다.
  assert.equal(mondayOfDateOnly("2026-08-24"), "2026-08-24");
});

test("한 주의 일곱 날이 전부 같은 월요일로 접힌다", () => {
  const week = [
    "2026-08-24", // 월
    "2026-08-25", // 화
    "2026-08-26", // 수
    "2026-08-27", // 목
    "2026-08-28", // 금
    "2026-08-29", // 토
    "2026-08-30", // 일
  ];
  for (const day of week) {
    assert.equal(mondayOfDateOnly(day), "2026-08-24", day);
  }
});

test("일요일은 다음 주가 아니라 그 앞의 월요일로 간다", () => {
  // 한 주는 월요일에 시작해 일요일에 끝난다. 여기가 틀리면 일요일에 적은
  // 목표만 다음 주 상자로 새어 들어가고, 일주일에 하루만 나타나는 증상이 된다.
  assert.equal(mondayOfDateOnly("2026-08-30"), "2026-08-24");
  assert.equal(mondayOfDateOnly("2026-08-31"), "2026-08-31", "그다음 날은 새 주의 월요일이다");
});

test("월 경계를 넘는다 — 9월 1일(화)의 주는 8월 31일에서 시작한다", () => {
  assert.equal(mondayOfDateOnly("2026-09-01"), "2026-08-31");
  assert.equal(mondayOfDateOnly("2026-09-06"), "2026-08-31", "9월 6일은 그 주 일요일이다");
});

test("연말·연초 경계를 넘는다 — 12월 28일~1월 3일이 한 주다", () => {
  // 2025-12-29 는 월요일이고, 그 주는 2026-01-04(일)까지다.
  for (const day of [
    "2025-12-29",
    "2025-12-30",
    "2025-12-31",
    "2026-01-01",
    "2026-01-02",
    "2026-01-03",
    "2026-01-04",
  ]) {
    assert.equal(mondayOfDateOnly(day), "2025-12-29", day);
  }
  // 해가 바뀌는 자리에서 월·일을 따로 빼서 셈하면 여기서 1월 -6일 같은 값이
  // 만들어진다. addCalendarDays 가 진짜 날짜 셈을 하는 것이 이 줄의 보장이다.
  assert.equal(mondayOfDateOnly("2026-01-01"), "2025-12-29");
});

test("윤년 2월 29일도 제자리를 찾는다", () => {
  // 2028-02-29 는 화요일이다.
  assert.equal(mondayOfDateOnly("2028-02-29"), "2028-02-28");
});

// ────────────────────────────────────────────────── 한국 기준(UTC 자정 함정)

test("KST 경계: 한국 월요일 오전 0시 30분에도 그 주 월요일이 나온다", () => {
  // UTC 로는 아직 일요일(2026-08-23 15:30Z)이다. UTC 요일로 접는 구현이라면
  // 여기서 **지난주** 월요일이 나온다.
  const mondayJustAfterMidnightKst = new Date("2026-08-23T15:30:00.000Z");
  assert.equal(weekStartOfKst(mondayJustAfterMidnightKst), "2026-08-24");
});

test("KST 경계: 한국 월요일 오전 9시 직전후가 같은 주를 가리킨다", () => {
  // 한국 09:00 = UTC 00:00. 이 언저리에서 UTC 달력 날짜가 하루 뒤로 넘어가므로,
  // 실제 시각을 그대로 견주는 구현은 여기서 답이 바뀐다.
  const justBeforeNineAmKst = new Date("2026-08-23T23:30:00.000Z"); // 한국 08-24 08:30
  const justAfterNineAmKst = new Date("2026-08-24T00:30:00.000Z"); // 한국 08-24 09:30
  assert.equal(weekStartOfKst(justBeforeNineAmKst), "2026-08-24");
  assert.equal(weekStartOfKst(justAfterNineAmKst), "2026-08-24");
});

test("KST 경계: 한국 일요일 밤 11시 59분은 아직 그 주다", () => {
  // 한국 2026-08-30 23:59 = UTC 2026-08-30 14:59.
  const lastMinuteOfWeekKst = new Date("2026-08-30T14:59:00.000Z");
  assert.equal(weekStartOfKst(lastMinuteOfWeekKst), "2026-08-24");
});

test("KST 경계: 한국 월요일이 되는 순간 다음 주로 넘어간다", () => {
  // 한국 2026-08-31 00:00 = UTC 2026-08-30 15:00.
  const firstMinuteOfNextWeekKst = new Date("2026-08-30T15:00:00.000Z");
  assert.equal(weekStartOfKst(firstMinuteOfNextWeekKst), "2026-08-31");
});

test("KST 경계: 해가 바뀌는 자리에서도 한국 달력을 따른다", () => {
  // 한국 2026-01-01 00:30 = UTC 2025-12-31 15:30. UTC 로는 아직 작년이다.
  const newYearKst = new Date("2025-12-31T15:30:00.000Z");
  assert.equal(weekStartOfKst(newYearKst), "2025-12-29");
});

// ────────────────────────────────────────────────── 상자 머리말

test("머리말은 엑셀에 적혀 있던 말 그대로다", () => {
  assert.equal(weekLabel("2026-08-24"), "08월24일 주간 목표");
});

test("한 자리 월·일도 0을 붙여 두 자리로 나간다", () => {
  assert.equal(weekLabel("2026-01-05"), "01월05일 주간 목표");
});

// ────────────────────────────────────────────────── 앞부분 만들기

function source(overrides: Partial<WeeklyReportGoalPrefixSource> = {}): WeeklyReportGoalPrefixSource {
  return {
    customerName: "INVENIA",
    intakeNumber: "D260706",
    modelName: "RFK300FH-AD1",
    lotNumber: "2111171",
    serialNumber: "WT7351",
    ...overrides,
  };
}

test("다섯 조각이 다 있으면 원본 엑셀의 그 줄이 그대로 나온다", () => {
  assert.equal(buildGoalPrefix(source()), "[INVENIA] D260706_RFK300FH-AD1_2111171_WT7351");
});

test("L/N 이 없으면 빈 자리를 남기지 않고 건너뛴다", () => {
  assert.equal(
    buildGoalPrefix(source({ lotNumber: null })),
    "[INVENIA] D260706_RFK300FH-AD1_WT7351"
  );
});

test("S/N 이 없어도 끝에 `_` 가 남지 않는다", () => {
  assert.equal(
    buildGoalPrefix(source({ serialNumber: null })),
    "[INVENIA] D260706_RFK300FH-AD1_2111171"
  );
});

test("L/N 과 S/N 이 둘 다 없어도 `__` 가 생기지 않는다", () => {
  assert.equal(
    buildGoalPrefix(source({ lotNumber: null, serialNumber: null })),
    "[INVENIA] D260706_RFK300FH-AD1"
  );
});

test("공백만 적힌 값은 없는 것으로 접는다", () => {
  // 빈 문자열과 공백 한 칸을 값으로 치면 `__` 가 생기고, 그것을 본 사람은
  // 값이 지워진 줄로 읽는다.
  assert.equal(
    buildGoalPrefix(source({ lotNumber: "   ", serialNumber: "" })),
    "[INVENIA] D260706_RFK300FH-AD1"
  );
});

test("값 앞뒤의 공백은 다듬어져 나간다", () => {
  assert.equal(
    buildGoalPrefix(source({ customerName: "  ICD  ", intakeNumber: " D260309 " })),
    "[ICD] D260309_RFK300FH-AD1_2111171_WT7351"
  );
});

test("고객사가 없으면 빈 괄호를 만들지 않는다", () => {
  assert.equal(
    buildGoalPrefix(source({ customerName: null })),
    "D260706_RFK300FH-AD1_2111171_WT7351"
  );
  assert.equal(
    buildGoalPrefix(source({ customerName: "  " })),
    "D260706_RFK300FH-AD1_2111171_WT7351"
  );
});

test("고객사만 있으면 괄호만 나온다", () => {
  assert.equal(
    buildGoalPrefix({
      customerName: "JUSUNG",
      intakeNumber: null,
      modelName: null,
      lotNumber: null,
      serialNumber: null,
    }),
    "[JUSUNG]"
  );
});

test("다섯이 전부 비면 빈 문자열이다", () => {
  assert.equal(
    buildGoalPrefix({
      customerName: null,
      intakeNumber: null,
      modelName: null,
      lotNumber: null,
      serialNumber: null,
    }),
    ""
  );
});

test("인수번호만 있으면 그것만 나온다", () => {
  assert.equal(
    buildGoalPrefix({
      customerName: null,
      intakeNumber: "D260706",
      modelName: null,
      lotNumber: null,
      serialNumber: null,
    }),
    "D260706"
  );
});

// ────────────────────────────────────────────────── 한 줄로 인쇄하기

test("한 줄은 `앞부분: 목표` 다", () => {
  assert.equal(
    formatGoalLine("[INVENIA] D260706_RFK300FH-AD1_2111171_WT7351", "견적서 발행"),
    "[INVENIA] D260706_RFK300FH-AD1_2111171_WT7351: 견적서 발행"
  );
});

test("괄호가 붙은 목표 문장도 그대로 실린다", () => {
  assert.equal(
    formatGoalLine("[JUSUNG] D260707_MBK300-JS1_1507048_WU2085", "견적서 발행 (교산의 부품견적 대기 중)"),
    "[JUSUNG] D260707_MBK300-JS1_1507048_WU2085: 견적서 발행 (교산의 부품견적 대기 중)"
  );
});

test("앞부분이 없으면 콜론을 붙이지 않는다", () => {
  // `: 견적서 발행` 은 무언가 빠진 줄로 보이지만 `견적서 발행` 은 짧은 줄이다.
  assert.equal(formatGoalLine("", "견적서 발행"), "견적서 발행");
});

// ────────────────────────────────────────────────── 차례

function at(iso: string): Date {
  return new Date(iso);
}

test("차례는 display_order 오름차순이다", () => {
  const sorted = sortWeeklyReportGoals([
    { id: "c", displayOrder: 3, createdAt: at("2026-08-24T00:00:00.000Z") },
    { id: "a", displayOrder: 1, createdAt: at("2026-08-24T00:00:00.000Z") },
    { id: "b", displayOrder: 2, createdAt: at("2026-08-24T00:00:00.000Z") },
  ]);
  assert.deepEqual(sorted.map((row) => row.id), ["a", "b", "c"]);
});

test("차례가 같으면 적은 차례(created_at)로 갈린다", () => {
  const sorted = sortWeeklyReportGoals([
    { id: "later", displayOrder: 1, createdAt: at("2026-08-24T05:00:00.000Z") },
    { id: "earlier", displayOrder: 1, createdAt: at("2026-08-24T01:00:00.000Z") },
  ]);
  assert.deepEqual(sorted.map((row) => row.id), ["earlier", "later"]);
});

test("차례를 정하지 않은 줄은 뒤로 간다 — SQL 의 asc 와 같은 자리다", () => {
  const sorted = sortWeeklyReportGoals([
    { id: "none", displayOrder: null, createdAt: at("2026-08-24T00:00:00.000Z") },
    { id: "two", displayOrder: 2, createdAt: at("2026-08-24T09:00:00.000Z") },
    { id: "one", displayOrder: 1, createdAt: at("2026-08-24T09:00:00.000Z") },
  ]);
  assert.deepEqual(sorted.map((row) => row.id), ["one", "two", "none"]);
});

test("차례 없는 줄끼리는 적은 차례로 갈린다", () => {
  const sorted = sortWeeklyReportGoals([
    { id: "second", displayOrder: null, createdAt: at("2026-08-24T09:00:00.000Z") },
    { id: "first", displayOrder: null, createdAt: at("2026-08-24T08:00:00.000Z") },
  ]);
  assert.deepEqual(sorted.map((row) => row.id), ["first", "second"]);
});

test("원본 배열을 건드리지 않는다", () => {
  const rows = [
    { id: "b", displayOrder: 2, createdAt: at("2026-08-24T00:00:00.000Z") },
    { id: "a", displayOrder: 1, createdAt: at("2026-08-24T00:00:00.000Z") },
  ];
  sortWeeklyReportGoals(rows);
  assert.deepEqual(rows.map((row) => row.id), ["b", "a"], "조회 결과를 그대로 다시 쓸 수 있어야 한다");
});
