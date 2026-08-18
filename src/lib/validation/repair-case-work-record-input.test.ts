import { test } from "node:test";
import assert from "node:assert/strict";
import {
  isValidUuid,
  isValidOptionalUuid,
  validateWorkRecordMemo,
  validateWorkRecordKind,
  validateInvalidationReason,
} from "./repair-case-work-record-input";

test("isValidUuid accepts a well-formed UUID and rejects everything else", () => {
  assert.equal(isValidUuid("d075bc6e-7cf1-41c5-a84e-37a8b161c951"), true);
  assert.equal(isValidUuid("not-a-uuid"), false);
  assert.equal(isValidUuid(123), false);
  assert.equal(isValidUuid(null), false);
});

test("isValidOptionalUuid treats null/undefined as valid absence, but rejects malformed strings", () => {
  assert.equal(isValidOptionalUuid(null), true);
  assert.equal(isValidOptionalUuid(undefined), true);
  assert.equal(isValidOptionalUuid("d075bc6e-7cf1-41c5-a84e-37a8b161c951"), true);
  assert.equal(isValidOptionalUuid("not-a-uuid"), false);
  assert.equal(isValidOptionalUuid(""), false);
});

test("validateWorkRecordMemo rejects blank/whitespace-only content", () => {
  assert.equal(validateWorkRecordMemo("").ok, false);
  assert.equal(validateWorkRecordMemo("   ").ok, false);
  assert.equal(validateWorkRecordMemo(null).ok, false);
  assert.equal(validateWorkRecordMemo(undefined).ok, false);
});

test("validateWorkRecordMemo trims leading/trailing whitespace", () => {
  const result = validateWorkRecordMemo("  점검 완료, 이상 없음  ");
  assert.equal(result.ok, true);
  if (result.ok) assert.equal(result.memo, "점검 완료, 이상 없음");
});

test("validateWorkRecordMemo rejects content over 4000 characters, never truncates", () => {
  const overLong = "가".repeat(4001);
  const result = validateWorkRecordMemo(overLong);
  assert.equal(result.ok, false);
  if (!result.ok) assert.ok(result.error.includes("4000"));
});

test("validateWorkRecordMemo accepts content at exactly the 4000-character limit", () => {
  const exact = "가".repeat(4000);
  const result = validateWorkRecordMemo(exact);
  assert.equal(result.ok, true);
  if (result.ok) assert.equal(result.memo.length, 4000);
});

test("validateWorkRecordKind: absent/null/empty all default to GENERAL, never rejected", () => {
  for (const value of [undefined, null, ""]) {
    const result = validateWorkRecordKind(value);
    assert.equal(result.ok, true);
    if (result.ok) assert.equal(result.recordKind, "GENERAL");
  }
});

test("validateWorkRecordKind: each migration-0023 enum value is accepted as-is", () => {
  for (const value of [
    "GENERAL",
    "INTAKE_INSPECTION_RESULT",
    "DIAGNOSIS_REPAIR_SUMMARY",
    "NEXT_PLANNED_ACTION",
  ] as const) {
    const result = validateWorkRecordKind(value);
    assert.equal(result.ok, true);
    if (result.ok) assert.equal(result.recordKind, value);
  }
});

test("validateWorkRecordKind rejects any value outside the enum, including near-misses and non-strings", () => {
  for (const value of ["general", "OTHER", "INTAKE_INSPECTION", 123, {}]) {
    assert.equal(validateWorkRecordKind(value).ok, false);
  }
});

test("validateInvalidationReason is mandatory — unlike a transition reason, there is no 'not supplied is fine' branch", () => {
  assert.equal(validateInvalidationReason("").ok, false);
  assert.equal(validateInvalidationReason(null).ok, false);
  assert.equal(validateInvalidationReason(undefined).ok, false);
  assert.equal(validateInvalidationReason("   ").ok, false);
});

test("validateInvalidationReason trims and rejects over-length reasons", () => {
  const trimmed = validateInvalidationReason("  잘못된 접수 건에 기록됨  ");
  assert.equal(trimmed.ok, true);
  if (trimmed.ok) assert.equal(trimmed.reason, "잘못된 접수 건에 기록됨");

  const overLong = validateInvalidationReason("가".repeat(2001));
  assert.equal(overLong.ok, false);
});
