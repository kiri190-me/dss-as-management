import { test } from "node:test";
import assert from "node:assert/strict";
import { addCalendarDays, daysSinceIntake, toKstDateOnly } from "./date-only";

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
