import { test } from "node:test";
import assert from "node:assert/strict";
import { addCalendarDays, toKstDateOnly } from "../date-only";
import {
  createDefaultDraft,
  DEFAULT_TARGET_INSPECTION_COMPLETION_OFFSET_DAYS,
  isDraftEmpty,
  nextTargetInspectionCompletionDate,
} from "./draft-storage";

test("createDefaultDraft: 인수일 기본값은 한국 기준 오늘이다(고정 데모 기준일이 아니다)", () => {
  const draft = createDefaultDraft();
  assert.equal(draft.receivedAt, toKstDateOnly(new Date()));
});

test("createDefaultDraft: 사내 목표 검수 완료일 defaults to 인수일 + 14 days, untouched", () => {
  const draft = createDefaultDraft();
  assert.equal(
    draft.internalTargetInspectionCompletionDate,
    addCalendarDays(draft.receivedAt, DEFAULT_TARGET_INSPECTION_COMPLETION_OFFSET_DAYS)
  );
  assert.equal(draft.internalTargetInspectionCompletionDateTouched, false);
});

test("nextTargetInspectionCompletionDate: untouched -> recomputes to newReceivedAt + 14 days", () => {
  const result = nextTargetInspectionCompletionDate({
    newReceivedAt: "2026-08-16",
    touched: false,
    currentValue: "2026-08-20", // stale, must be overwritten since untouched
  });
  assert.equal(result, "2026-08-30");
});

test("nextTargetInspectionCompletionDate: untouched -> handles month/year rollover (Dec -> Jan)", () => {
  const result = nextTargetInspectionCompletionDate({
    newReceivedAt: "2026-12-25",
    touched: false,
    currentValue: "",
  });
  assert.equal(result, "2027-01-08");
});

test("nextTargetInspectionCompletionDate: untouched but receivedAt mid-typing (not yet a valid date) -> blank, never a stale/garbage date", () => {
  const result = nextTargetInspectionCompletionDate({
    newReceivedAt: "2026-08",
    touched: false,
    currentValue: "2026-08-20",
  });
  assert.equal(result, "");
});

test("nextTargetInspectionCompletionDate: touched -> the user's manually-set value is preserved verbatim when receivedAt changes", () => {
  const result = nextTargetInspectionCompletionDate({
    newReceivedAt: "2026-09-01",
    touched: true,
    currentValue: "2026-09-10", // deliberately NOT newReceivedAt + 14 (2026-09-15) — must not be recomputed
  });
  assert.equal(result, "2026-09-10");
});

test("nextTargetInspectionCompletionDate: touched + manually cleared (empty string) stays cleared across a receivedAt change", () => {
  const result = nextTargetInspectionCompletionDate({
    newReceivedAt: "2026-09-01",
    touched: true,
    currentValue: "",
  });
  assert.equal(result, "", "an explicit clear is itself an override — must not be silently refilled");
});

test("isDraftEmpty: 보고서번호만 입력해도 빈 초안이 아니다", () => {
  const draft = createDefaultDraft();
  assert.equal(isDraftEmpty(draft), true);
  assert.equal(isDraftEmpty({ ...draft, legacyReportNumber: "R-2026-018" }), false);
});
