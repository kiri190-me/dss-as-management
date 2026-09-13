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
  if (result.ok) {
    assert.deepEqual(result.data, { contactName: "홍길동", contactEmail: null, title: null, phone: null, memo: null });
  }
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

// ── 직급·전화·메모(2026-09-13 사용자 요청 — 고객사 담당자와 같은 칸) ─────────

test("validateEndUserContactFields: 직급·전화·메모를 받고 앞뒤 공백을 걷는다", () => {
  const result = validateEndUserContactFields({
    contactName: "홍길동",
    contactEmail: "hong@example.com",
    title: "  과장 ",
    phone: " 010-1234-5678  ",
    memo: "  오전에만 통화 가능  ",
  });
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.deepEqual(result.data, {
      contactName: "홍길동",
      contactEmail: "hong@example.com",
      title: "과장",
      phone: "010-1234-5678",
      memo: "오전에만 통화 가능",
    });
  }
});

test("validateEndUserContactFields: 직급·전화·메모는 선택 — 없거나 비었거나 공백뿐이면 null", () => {
  for (const empty of [undefined, null, "", "   "]) {
    const result = validateEndUserContactFields({ contactName: "홍길동", title: empty, phone: empty, memo: empty });
    assert.equal(result.ok, true, `값=${JSON.stringify(empty)} 는 통과해야 한다`);
    if (result.ok) {
      assert.equal(result.data.title, null);
      assert.equal(result.data.phone, null);
      assert.equal(result.data.memo, null);
    }
  }
});

test("validateEndUserContactFields: 직급·전화는 200자, 메모는 500자까지 — 넘으면 그 칸만 오류", () => {
  const atMax = validateEndUserContactFields({
    contactName: "홍길동",
    title: "가".repeat(200),
    phone: "1".repeat(200),
    memo: "메".repeat(500),
  });
  assert.equal(atMax.ok, true);

  const over = validateEndUserContactFields({
    contactName: "홍길동",
    title: "가".repeat(201),
    phone: "1".repeat(201),
    memo: "메".repeat(501),
  });
  assert.equal(over.ok, false);
  if (!over.ok) {
    assert.deepEqual(Object.keys(over.fieldErrors).sort(), ["memo", "phone", "title"]);
  }
});

test("validateEndUserContactFields: 글자가 아닌 직급·전화·메모는 오류", () => {
  const result = validateEndUserContactFields({ contactName: "홍길동", title: 1, phone: {}, memo: true });
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.ok(result.fieldErrors.title);
    assert.ok(result.fieldErrors.phone);
    assert.ok(result.fieldErrors.memo);
  }
});

test("validateEndUserContactFields: 메모의 CRLF 는 LF 로 바꾼 뒤 센다 — 500자에 맞춘 여러 줄 메모가 넘치지 않는다", () => {
  // 줄 250개(글자 1 + 줄바꿈 1)를 LF 로 세면 499자다. CRLF 그대로 세면 748자라 넘친다.
  const lines = Array.from({ length: 250 }, () => "a");
  const result = validateEndUserContactFields({ contactName: "홍길동", memo: lines.join("\r\n") });
  assert.equal(result.ok, true);
  if (result.ok) assert.equal(result.data.memo, lines.join("\n"));

  const bareCr = validateEndUserContactFields({ contactName: "홍길동", memo: "첫 줄\r둘째 줄" });
  assert.equal(bareCr.ok, true);
  if (bareCr.ok) assert.equal(bareCr.data.memo, "첫 줄\n둘째 줄");
});

test("validateEndUserContactFields: 새 칸이 늘어도 담당자명·이메일 오류는 예전 그대로다", () => {
  const result = validateEndUserContactFields({ contactName: "   ", contactEmail: "not-an-email", title: "과장" });
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.deepEqual(result.fieldErrors, {
      contactName: "담당자명을 입력해 주세요.",
      contactEmail: "올바른 이메일 형식이 아닙니다.",
    });
  }
});
