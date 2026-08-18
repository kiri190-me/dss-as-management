import { test } from "node:test";
import assert from "node:assert/strict";
import {
  isValidCustomerId,
  isValidExpectedUpdatedAt,
  validateCustomerUpdateFields,
} from "./customer-update-input";

test("isValidCustomerId accepts a well-formed UUID and rejects everything else", () => {
  assert.equal(isValidCustomerId("11111111-1111-4111-8111-111111111111"), true);
  assert.equal(isValidCustomerId("not-a-uuid"), false);
  assert.equal(isValidCustomerId(""), false);
  assert.equal(isValidCustomerId(123), false);
  assert.equal(isValidCustomerId(null), false);
});

test("isValidExpectedUpdatedAt accepts any non-empty string and rejects everything else", () => {
  assert.equal(isValidExpectedUpdatedAt("2026-08-16T00:00:00.000Z"), true);
  assert.equal(isValidExpectedUpdatedAt(""), false);
  assert.equal(isValidExpectedUpdatedAt(null), false);
  assert.equal(isValidExpectedUpdatedAt(123), false);
});

test("validateCustomerUpdateFields: valid full submission trims and normalizes empty contact fields to null", () => {
  const result = validateCustomerUpdateFields({
    name: "  Acme Corp  ",
    contactName: "",
    contactEmail: "  ops@acme.example  ",
    contactPhone: null,
  });
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.deepEqual(result.data, {
      name: "Acme Corp",
      contactName: null,
      contactEmail: "ops@acme.example",
      contactPhone: null,
    });
  }
});

test("validateCustomerUpdateFields: blank name fails", () => {
  const result = validateCustomerUpdateFields({ name: "   ", contactName: null, contactEmail: null, contactPhone: null });
  assert.equal(result.ok, false);
  if (!result.ok) assert.ok(result.fieldErrors.name);
});

test("validateCustomerUpdateFields: missing name fails", () => {
  const result = validateCustomerUpdateFields({ contactName: null, contactEmail: null, contactPhone: null });
  assert.equal(result.ok, false);
  if (!result.ok) assert.ok(result.fieldErrors.name);
});

test("validateCustomerUpdateFields: overlong name fails", () => {
  const result = validateCustomerUpdateFields({
    name: "a".repeat(201),
    contactName: null,
    contactEmail: null,
    contactPhone: null,
  });
  assert.equal(result.ok, false);
  if (!result.ok) assert.ok(result.fieldErrors.name);
});

test("validateCustomerUpdateFields: invalid contactEmail format fails", () => {
  const result = validateCustomerUpdateFields({ name: "Acme", contactName: null, contactEmail: "not-an-email", contactPhone: null });
  assert.equal(result.ok, false);
  if (!result.ok) assert.ok(result.fieldErrors.contactEmail);
});

test("validateCustomerUpdateFields: overlong contactPhone fails", () => {
  const result = validateCustomerUpdateFields({
    name: "Acme",
    contactName: null,
    contactEmail: null,
    contactPhone: "1".repeat(201),
  });
  assert.equal(result.ok, false);
  if (!result.ok) assert.ok(result.fieldErrors.contactPhone);
});

test("validateCustomerUpdateFields: non-string contactName fails", () => {
  const result = validateCustomerUpdateFields({ name: "Acme", contactName: 123, contactEmail: null, contactPhone: null });
  assert.equal(result.ok, false);
  if (!result.ok) assert.ok(result.fieldErrors.contactName);
});
