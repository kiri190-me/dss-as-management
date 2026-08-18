import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { repairCases } from "./repair-cases";

test("0038 adds only the nullable legacy report number column", () => {
  const sql = readFileSync("drizzle/0038_legacy_report_number.sql", "utf8").trim();
  assert.equal(sql, 'ALTER TABLE "repair_cases" ADD COLUMN "legacy_report_number" text;');
  assert.doesNotMatch(sql, /\b(?:DROP|RENAME|UPDATE|DELETE|UNIQUE|CHECK|DEFAULT)\b/i);
  assert.equal(repairCases.legacyReportNumber.notNull, false);
  assert.equal(repairCases.legacyReportNumber.hasDefault, false);
});
