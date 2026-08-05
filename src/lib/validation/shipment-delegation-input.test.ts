import { test } from "node:test";
import assert from "node:assert/strict";
import {
  isValidUserId,
  validateReasonFormat,
  validateDelegationDateRange,
} from "./shipment-delegation-input";

test("isValidUserId accepts a well-formed UUID and rejects everything else", () => {
  assert.equal(isValidUserId("11111111-1111-4111-8111-111111111111"), true);
  assert.equal(isValidUserId("u-001"), false);
  assert.equal(isValidUserId(""), false);
  assert.equal(isValidUserId(123), false);
});

test("validateReasonFormat: absent/null/empty all normalize to null", () => {
  assert.deepEqual(validateReasonFormat(undefined), { ok: true, reason: null });
  assert.deepEqual(validateReasonFormat(null), { ok: true, reason: null });
  assert.deepEqual(validateReasonFormat(""), { ok: true, reason: null });
});

test("validateReasonFormat: trims and rejects overlong", () => {
  assert.deepEqual(validateReasonFormat("  부재 중 위임  "), { ok: true, reason: "부재 중 위임" });
  assert.equal(validateReasonFormat("a".repeat(2001)).ok, false);
});

test("validateDelegationDateRange: valid range parses correctly", () => {
  const result = validateDelegationDateRange("2099-01-01T00:00:00.000Z", "2099-01-31T00:00:00.000Z");
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.startsAt.toISOString(), "2099-01-01T00:00:00.000Z");
  assert.equal(result.endsAt.toISOString(), "2099-01-31T00:00:00.000Z");
});

test("validateDelegationDateRange: rejects non-string input", () => {
  assert.equal(validateDelegationDateRange(undefined, "2099-01-31T00:00:00.000Z").ok, false);
  assert.equal(validateDelegationDateRange("2099-01-01T00:00:00.000Z", null).ok, false);
});

test("validateDelegationDateRange: rejects unparseable dates", () => {
  assert.equal(validateDelegationDateRange("not-a-date", "2099-01-31T00:00:00.000Z").ok, false);
});

test("validateDelegationDateRange: rejects ends_at <= starts_at", () => {
  assert.equal(validateDelegationDateRange("2099-01-31T00:00:00.000Z", "2099-01-01T00:00:00.000Z").ok, false);
  assert.equal(validateDelegationDateRange("2099-01-01T00:00:00.000Z", "2099-01-01T00:00:00.000Z").ok, false);
});
