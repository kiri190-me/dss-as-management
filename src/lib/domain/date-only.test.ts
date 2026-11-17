import { test } from "node:test";
import assert from "node:assert/strict";
import {
  addCalendarDays,
  addCalendarMonths,
  daysSinceIntake,
  isKstMidnight,
  kstMidnightInstant,
  toKstDateOnly,
} from "./date-only";

test("received today (KST) -> 0일", () => {
  const now = new Date("2026-08-10T05:00:00.000Z"); // 2026-08-10 14:00 KST
  assert.equal(daysSinceIntake("2026-08-10", now), 0);
});

test("received yesterday (KST) -> 1일", () => {
  const now = new Date("2026-08-10T05:00:00.000Z"); // 2026-08-10 14:00 KST
  assert.equal(daysSinceIntake("2026-08-09", now), 1);
});

test("received a week ago -> 7일", () => {
  const now = new Date("2026-08-10T05:00:00.000Z");
  assert.equal(daysSinceIntake("2026-08-03", now), 7);
});

test("KST day boundary: 08:59 UTC is still the previous KST calendar day (UTC+9)", () => {
  // 2026-08-10T08:59:00Z = 2026-08-10 17:59 KST -> still Aug 10 in KST.
  const stillAug10Kst = new Date("2026-08-10T08:59:00.000Z");
  assert.equal(daysSinceIntake("2026-08-10", stillAug10Kst), 0);

  // 2026-08-09T15:30:00Z = 2026-08-10 00:30 KST -> already Aug 10 in KST,
  // even though the UTC calendar date is still Aug 9. A UTC-based
  // implementation would wrongly report 1 here.
  const alreadyAug10Kst = new Date("2026-08-09T15:30:00.000Z");
  assert.equal(daysSinceIntake("2026-08-10", alreadyAug10Kst), 0);
});

test("toKstDateOnly formats as YYYY-MM-DD", () => {
  assert.equal(toKstDateOnly(new Date("2026-08-09T15:30:00.000Z")), "2026-08-10");
});

/**
 * ── kstMidnightInstant · isKstMidnight (2026-11-17) ─────────────────────
 * toKstDateOnly 의 거꾸로다. 🔴 **UTC 자정이 아니다** — `new Date("2026-11-18")` 은
 * 한국시간으로 그날 오전 9시라, 기간의 경계를 그렇게 잡으면 아홉 시간이 어긋나고
 * 그 어긋남은 하루 중 00:00~09:00 에만 드러난다. 쓰는 자리는 결재권 위임의 기간
 * (domain/approval-route-delegation.ts 의 delegationPeriodFromDateOnly).
 */

test("kstMidnightInstant: 한국시간 자정은 그 전날 15:00 UTC 다", () => {
  assert.equal(kstMidnightInstant("2026-11-18").toISOString(), "2026-11-17T15:00:00.000Z");
  // 🔴 UTC 자정과 **다른 값**이다. 같아지면 아홉 시간이 밀린 채로 조용히 돈다.
  assert.notEqual(
    kstMidnightInstant("2026-11-18").getTime(),
    new Date("2026-11-18T00:00:00.000Z").getTime()
  );
});

test("kstMidnightInstant: toKstDateOnly 와 왕복해도 같은 날이다 (달·해 넘김 포함)", () => {
  for (const dateOnly of ["2026-01-01", "2026-11-18", "2026-12-31", "2028-02-29"]) {
    assert.equal(toKstDateOnly(kstMidnightInstant(dateOnly)), dateOnly);
  }
});

test("isKstMidnight: 한국시간 자정만 참이다 — UTC 자정도 1밀리초 차이도 거짓", () => {
  assert.equal(isKstMidnight(new Date("2026-11-17T15:00:00.000Z")), true); // 11-18 00:00 KST
  assert.equal(isKstMidnight(new Date("2026-11-18T00:00:00.000Z")), false); // 11-18 09:00 KST
  assert.equal(isKstMidnight(new Date("2026-11-17T15:00:00.001Z")), false);
  assert.equal(isKstMidnight(new Date("2026-11-18T12:25:00.000Z")), false);
});

test("addCalendarDays: +14 days within the same month", () => {
  assert.equal(addCalendarDays("2026-08-01", 14), "2026-08-15");
});

test("addCalendarDays: +14 days rolls over to the next month", () => {
  assert.equal(addCalendarDays("2026-08-16", 14), "2026-08-30");
});

test("addCalendarDays: +14 days rolls over both month and year (Dec -> Jan)", () => {
  assert.equal(addCalendarDays("2026-12-25", 14), "2027-01-08");
});

test("addCalendarDays: rolls over a short February in a non-leap year", () => {
  assert.equal(addCalendarDays("2027-02-20", 14), "2027-03-06");
});

test("addCalendarDays: 0 days returns the same date; negative days subtracts", () => {
  assert.equal(addCalendarDays("2026-08-16", 0), "2026-08-16");
  assert.equal(addCalendarDays("2026-08-16", -14), "2026-08-02");
});

/**
 * ── addCalendarMonths ───────────────────────────────────────────────────
 * "두 달"은 달력 기준이지 60일이 아니다. 대응 날짜가 없는 달은 말일로
 * 접는다 — 접지 않으면 "2월 31일"이 3월로 넘어가, 두 달이 지나기 전에 걸리는
 * 건이 생긴다(장기 PO 미발행 판정이 이 함수 위에 서 있다).
 */

test("addCalendarMonths: 6월 30일 + 2개월은 8월 30일이다 (60일이 아니다)", () => {
  assert.equal(addCalendarMonths("2026-06-30", 2), "2026-08-30");
});

test("addCalendarMonths: 대응 날짜가 없으면 그 달 말일로 접는다 (12/31 + 2개월 -> 2/28)", () => {
  assert.equal(addCalendarMonths("2026-12-31", 2), "2027-02-28");
});

test("addCalendarMonths: 윤년이면 말일이 29일이다 (2027/12/31 + 2개월 -> 2028/02/29)", () => {
  assert.equal(addCalendarMonths("2027-12-31", 2), "2028-02-29");
});

test("addCalendarMonths: 1월 31일 + 1개월은 2월 28일, 8월 31일 + 1개월은 9월 30일", () => {
  assert.equal(addCalendarMonths("2026-01-31", 1), "2026-02-28");
  assert.equal(addCalendarMonths("2026-08-31", 1), "2026-09-30");
});

test("addCalendarMonths: 해를 넘어간다", () => {
  assert.equal(addCalendarMonths("2026-11-15", 2), "2027-01-15");
  assert.equal(addCalendarMonths("2026-12-01", 12), "2027-12-01");
});

test("addCalendarMonths: 0개월은 같은 날, 음수는 거슬러 올라간다", () => {
  assert.equal(addCalendarMonths("2026-08-16", 0), "2026-08-16");
  assert.equal(addCalendarMonths("2026-01-15", -2), "2025-11-15");
  assert.equal(addCalendarMonths("2026-03-31", -1), "2026-02-28");
});
