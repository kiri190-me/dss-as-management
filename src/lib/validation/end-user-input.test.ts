import { test } from "node:test";
import assert from "node:assert/strict";
import {
  isValidCustomerId,
  isValidEndUserContactId,
  isValidEndUserId,
  isValidExpectedUpdatedAt,
  validateEndUserContactFields,
  validateEndUserNameField,
} from "./end-user-input";

test("isValidCustomerId/isValidEndUserId/isValidEndUserContactId accept a well-formed UUID and reject everything else", () => {
  const uuid = "11111111-1111-4111-8111-111111111111";
  for (const check of [isValidCustomerId, isValidEndUserId, isValidEndUserContactId]) {
    assert.equal(check(uuid), true);
    assert.equal(check("not-a-uuid"), false);
    assert.equal(check(""), false);
    assert.equal(check(123), false);
    assert.equal(check(null), false);
  }
});

test("isValidExpectedUpdatedAt accepts any non-empty string and rejects everything else", () => {
  assert.equal(isValidExpectedUpdatedAt("2026-08-16T00:00:00.000Z"), true);
  assert.equal(isValidExpectedUpdatedAt(""), false);
  assert.equal(isValidExpectedUpdatedAt(null), false);
  assert.equal(isValidExpectedUpdatedAt(123), false);
});

test("validateEndUserNameField: trims a valid name", () => {
  const result = validateEndUserNameField({ name: "  본사실험실  " });
  assert.equal(result.ok, true);
  if (result.ok) assert.equal(result.data.name, "본사실험실");
});

test("validateEndUserNameField: blank/missing name fails", () => {
  assert.equal(validateEndUserNameField({ name: "   " }).ok, false);
  assert.equal(validateEndUserNameField({}).ok, false);
});

test("validateEndUserNameField: overlong name fails", () => {
  const result = validateEndUserNameField({ name: "a".repeat(201) });
  assert.equal(result.ok, false);
  if (!result.ok) assert.ok(result.fieldErrors.name);
});

test("validateEndUserContactFields: valid submission trims name and normalizes empty email to null", () => {
  const result = validateEndUserContactFields({ contactName: "  홍길동  ", contactEmail: "" });
  assert.equal(result.ok, true);
  if (result.ok) assert.deepEqual(result.data, { contactName: "홍길동", contactEmail: null });
});

test("validateEndUserContactFields: email is optional — omitted entirely still succeeds", () => {
  const result = validateEndUserContactFields({ contactName: "홍길동" });
  assert.equal(result.ok, true);
  if (result.ok) assert.equal(result.data.contactEmail, null);
});

test("validateEndUserContactFields: blank contactName fails", () => {
  const result = validateEndUserContactFields({ contactName: "   ", contactEmail: null });
  assert.equal(result.ok, false);
  if (!result.ok) assert.ok(result.fieldErrors.contactName);
});

test("validateEndUserContactFields: invalid email format fails", () => {
  const result = validateEndUserContactFields({ contactName: "홍길동", contactEmail: "not-an-email" });
  assert.equal(result.ok, false);
  if (!result.ok) assert.ok(result.fieldErrors.contactEmail);
});

test("validateEndUserContactFields: overlong contactName fails", () => {
  const result = validateEndUserContactFields({ contactName: "a".repeat(201), contactEmail: null });
  assert.equal(result.ok, false);
  if (!result.ok) assert.ok(result.fieldErrors.contactName);
});
