import { test } from "node:test";
import assert from "node:assert/strict";
import { addCalendarDays } from "../date-only";
import {
  createDefaultDraft,
  DEFAULT_TARGET_INSPECTION_COMPLETION_OFFSET_DAYS,
  nextTargetInspectionCompletionDate,
} from "./draft-storage";

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
