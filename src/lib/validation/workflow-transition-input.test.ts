import { test } from "node:test";
import assert from "node:assert/strict";
import {
  isValidExpectedVersion,
  isValidRepairCaseId,
  isValidWorkflowActionCode,
  validateReasonFormat,
} from "./workflow-transition-input";

test("isValidRepairCaseId accepts a well-formed UUID and rejects everything else", () => {
  assert.equal(isValidRepairCaseId("11111111-1111-4111-8111-111111111111"), true);
  assert.equal(isValidRepairCaseId("not-a-uuid"), false);
  assert.equal(isValidRepairCaseId(""), false);
  assert.equal(isValidRepairCaseId(null), false);
});

test("isValidExpectedVersion accepts only a positive integer", () => {
  assert.equal(isValidExpectedVersion(1), true);
  assert.equal(isValidExpectedVersion(0), false);
  assert.equal(isValidExpectedVersion(-1), false);
  assert.equal(isValidExpectedVersion(1.5), false);
  assert.equal(isValidExpectedVersion("1"), false);
});

test("isValidWorkflowActionCode accepts only the 5 known action codes", () => {
  assert.equal(isValidWorkflowActionCode("STEP_ADVANCED"), true);
  assert.equal(isValidWorkflowActionCode("STEP_RETURNED"), true);
  assert.equal(isValidWorkflowActionCode("HOLD_STARTED"), true);
  assert.equal(isValidWorkflowActionCode("HOLD_RELEASED"), true);
  assert.equal(isValidWorkflowActionCode("SHIPMENT_COMPLETED"), true);
  assert.equal(isValidWorkflowActionCode("ADMIN_OVERRIDE"), false);
  assert.equal(isValidWorkflowActionCode(""), false);
  assert.equal(isValidWorkflowActionCode(123), false);
});

test("validateReasonFormat: absent/null/empty all normalize to null", () => {
  assert.deepEqual(validateReasonFormat(undefined), { ok: true, reason: null });
  assert.deepEqual(validateReasonFormat(null), { ok: true, reason: null });
  assert.deepEqual(validateReasonFormat(""), { ok: true, reason: null });
  assert.deepEqual(validateReasonFormat("   "), { ok: true, reason: null });
});

test("validateReasonFormat: trims a valid reason", () => {
  const result = validateReasonFormat("  부품 지연  ");
  assert.equal(result.ok, true);
  if (result.ok) assert.equal(result.reason, "부품 지연");
});

test("validateReasonFormat: rejects a non-string value", () => {
  const result = validateReasonFormat(123);
  assert.equal(result.ok, false);
});

test("validateReasonFormat: rejects an overlong reason", () => {
  const result = validateReasonFormat("x".repeat(2001));
  assert.equal(result.ok, false);
});
