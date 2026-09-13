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
      rowColor: null,
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

test("validateCustomerUpdateFields: 팔레트에 있는 색 키는 그대로 통과한다", () => {
  const result = validateCustomerUpdateFields({
    name: "Acme",
    contactName: null,
    contactEmail: null,
    contactPhone: null,
    rowColor: "amber",
  });
  assert.equal(result.ok, true);
  if (result.ok) assert.equal(result.data.rowColor, "amber");
});

test("validateCustomerUpdateFields: 빈 색(없음)은 통과하고 null 이 된다", () => {
  for (const empty of ["", null, undefined]) {
    const result = validateCustomerUpdateFields({
      name: "Acme",
      contactName: null,
      contactEmail: null,
      contactPhone: null,
      rowColor: empty,
    });
    assert.equal(result.ok, true, `rowColor=${String(empty)} 는 통과해야 한다`);
    if (result.ok) assert.equal(result.data.rowColor, null);
  }
});

test("validateCustomerUpdateFields: rowColor 칸이 아예 없으면 색 없음으로 읽는다", () => {
  const result = validateCustomerUpdateFields({
    name: "Acme",
    contactName: null,
    contactEmail: null,
    contactPhone: null,
  });
  assert.equal(result.ok, true);
  if (result.ok) assert.equal(result.data.rowColor, null);
});

test("validateCustomerUpdateFields: 직접 고른 색 코드는 통과하고 소문자로 정리돼 저장된다", () => {
  // 🔴 설계 변경(2026-09-13 사용자 결정): 예전에는 색 코드를 거절했다. 이제는
  // 「직접 고르기」로 고른 색을 받는다 — 약화가 아니라 뜻이 바뀐 것이다.
  for (const [raw, stored] of [
    ["#FFE4B5", "#ffe4b5"],
    ["#ffe4b5", "#ffe4b5"],
    ["  #1E3A8A ", "#1e3a8a"],
  ] as const) {
    const result = validateCustomerUpdateFields({
      name: "Acme",
      contactName: null,
      contactEmail: null,
      contactPhone: null,
      rowColor: raw,
    });
    assert.equal(result.ok, true, `rowColor=${JSON.stringify(raw)} 는 통과해야 한다`);
    if (result.ok) assert.equal(result.data.rowColor, stored);
  }
});

test("validateCustomerUpdateFields: 팔레트 밖의 키와 형식이 어긋난 색 코드는 거절한다", () => {
  for (const bad of [
    "zinc",
    "AMBER",
    "rgb(255,0,0)",
    "red",
    "#12345",
    "#1234567",
    "#fff",
    "ffe4b5",
    "#gggggg",
    "   ",
    123,
    {},
    true,
  ]) {
    const result = validateCustomerUpdateFields({
      name: "Acme",
      contactName: null,
      contactEmail: null,
      contactPhone: null,
      rowColor: bad,
    });
    assert.equal(result.ok, false, `rowColor=${JSON.stringify(bad)} 는 거절해야 한다`);
    if (!result.ok) assert.ok(result.fieldErrors.rowColor);
  }
});
