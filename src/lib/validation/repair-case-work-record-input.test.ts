import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
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

// ───────────────────────────── 고치기도 남길 때와 같은 검사를 지난다 (2026-10-02)

/** 주석은 걷어내고 읽는다 — 「이렇게 한다」고 적어 둔 주석이 코드로 잘못 잡히면 안 된다. */
function readSourceWithoutComments(url: URL): string {
  return readFileSync(url, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .filter((line) => !line.trimStart().startsWith("//"))
    .join("\n");
}

test("🔴 작업 기록 고치기가 남길 때와 **같은** 글·구분 검사를 지난다", () => {
  const action = readSourceWithoutComments(
    new URL("../server/actions/repair-case-work-records.ts", import.meta.url)
  );
  const editAction = action.slice(action.indexOf("export async function editWorkRecordAction"));
  assert.ok(editAction.length > 0, "editWorkRecordAction 이 있어야 한다");
  assert.ok(
    editAction.includes("validateWorkRecordMemo(input.memo)"),
    "글은 남길 때와 같은 validateWorkRecordMemo 를 지나야 한다 — 빈 글 금지는 표의 memo_not_blank 검사와 짝이다"
  );
  assert.ok(
    editAction.includes("validateWorkRecordKind(input.recordKind)"),
    "기록 구분도 남길 때와 같은 validateWorkRecordKind 를 지나야 한다"
  );
  // 🔴 고칠 때만 따로 다듬는 길(소문자화·치환·자르기 등)이 끼어들면 교산
  //    연락서의 일본어 원문이 저장된 글자와 달라진다. 다듬기는 앞뒤 공백
  //    제거뿐이어야 하고, 그 규칙은 위 두 검사 함수 안에만 있어야 한다.
  assert.ok(
    !/input\.memo\s*\.\s*(replace|toLowerCase|normalize|slice|substring)/.test(editAction),
    "고치는 길에서 글을 따로 손대면 안 된다 — 저장은 사람이 친 글자 그대로다"
  );
});

test("🔴 빈 글로는 고칠 수 없다 — 남길 때와 같은 거절이다", () => {
  for (const value of ["", "   ", null, undefined]) {
    assert.equal(validateWorkRecordMemo(value).ok, false);
  }
});
