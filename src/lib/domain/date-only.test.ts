import { test } from "node:test";
import assert from "node:assert/strict";
import { daysSinceIntake, toKstDateOnly } from "./date-only";

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
