import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const source = readFileSync("src/components/excel-imports/RepairCaseExcelImportScreen.tsx", "utf8");

test("Preview keeps the approved two-line compact fields and an accessible full-detail disclosure", () => {
  for (const label of [
    "Excel {row.sourceRowNumber}행",
    "보고서번호",
    "인수일",
    "L/N",
    "S/N",
    "담당자",
    "출하일",
    "상태 적용",
    "고장 증상",
    "비고",
  ]) assert.equal(source.includes(label), true, `${label} must remain visible`);
  assert.match(source, /<article/);
  assert.match(source, /<details className="mt-2 text-sm">/);
  assert.match(source, /<summary[^>]*>상세 보기<\/summary>/);
  assert.match(source, /원본 A:Y/);
  assert.match(source, /Customer 계획/);
  assert.match(source, /Product Model 계획/);
  assert.match(source, /개발 정보/);
});

test("interactive intake does not expose the Excel-only legacy report number", () => {
  const interactive = [
    readFileSync("src/components/repair-cases/new/IntakeForm.tsx", "utf8"),
    readFileSync("src/components/repair-cases/new/IntakeFormInner.tsx", "utf8"),
    readFileSync("src/lib/validation/repair-case-input.ts", "utf8"),
  ].join("\n");
  assert.doesNotMatch(interactive, /legacyReportNumber|legacy_report_number/);
});

test("Preview business-state emphasis remains a small badge instead of a strong row background", () => {
  assert.match(source, /businessColorLabel\(row\.candidate\.legacyBusinessColor\)/);
  assert.match(source, /rounded-full border border-zinc-300/);
  assert.doesNotMatch(source, /businessColorLabel[\s\S]{0,300}bg-(?:white|yellow|amber|black)-/);
});

test("same-file notice provides an explicit existing-batch navigation button", () => {
  assert.match(source, /기존 이관 기록 열기/);
  assert.match(source, /encodeURIComponent\(existingBatch\.batchId\)/);
});
