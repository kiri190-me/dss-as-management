import { test } from "node:test";
import assert from "node:assert/strict";
import {
  isValidApprovalDecision,
  isValidApprovalType,
  isValidRepairCaseId,
  validateReasonFormat,
} from "./repair-case-approval-input";

test("isValidRepairCaseId accepts a well-formed UUID and rejects everything else", () => {
  assert.equal(isValidRepairCaseId("11111111-1111-4111-8111-111111111111"), true);
  assert.equal(isValidRepairCaseId("u-001"), false);
  assert.equal(isValidRepairCaseId(""), false);
  assert.equal(isValidRepairCaseId(123), false);
  assert.equal(isValidRepairCaseId(null), false);
});

test("isValidApprovalType accepts only REPAIR_INSPECTION/FINAL_SHIPMENT", () => {
  assert.equal(isValidApprovalType("REPAIR_INSPECTION"), true);
  assert.equal(isValidApprovalType("FINAL_SHIPMENT"), true);
  assert.equal(isValidApprovalType("CHANGES_REQUESTED"), false);
  assert.equal(isValidApprovalType("bogus"), false);
  assert.equal(isValidApprovalType(undefined), false);
});

test("isValidApprovalDecision accepts only APPROVED/REJECTED", () => {
  assert.equal(isValidApprovalDecision("APPROVED"), true);
  assert.equal(isValidApprovalDecision("REJECTED"), true);
  assert.equal(isValidApprovalDecision("REQUESTED"), false);
  assert.equal(isValidApprovalDecision("CANCELLED"), false);
});

test("validateReasonFormat: absent/null/empty all normalize to null", () => {
  assert.deepEqual(validateReasonFormat(undefined), { ok: true, reason: null });
  assert.deepEqual(validateReasonFormat(null), { ok: true, reason: null });
  assert.deepEqual(validateReasonFormat(""), { ok: true, reason: null });
});

test("validateReasonFormat: trims a valid reason", () => {
  assert.deepEqual(validateReasonFormat("  부품 대기  "), { ok: true, reason: "부품 대기" });
});

test("validateReasonFormat: rejects a non-string value", () => {
  const result = validateReasonFormat(42);
  assert.equal(result.ok, false);
});

test("validateReasonFormat: rejects an overlong reason", () => {
  const result = validateReasonFormat("a".repeat(2001));
  assert.equal(result.ok, false);
});
