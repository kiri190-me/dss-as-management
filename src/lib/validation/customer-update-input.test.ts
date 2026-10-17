import { test } from "node:test";
import assert from "node:assert/strict";
import { CUSTOMER_PORTAL_FORMS } from "@/lib/domain/customer-portal-forms";
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
      contactTitle: null,
      contactMemo: null,
      rowColor: null,
      portalFormId: null,
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

// ── 고객 안내 양식(portal_form_id) — 등록부가 문지기다 (2026-10-17) ──────────
//
// 🔴 DB 에는 CHECK 도 enum 도 없다(schema/customers.ts — 「등록부는 코드다」). 그래서
// 막는 자리가 이 검증뿐이고, 못 막으면 오타 한 번이 그 고객사의 표를 **아무 오류
// 없이** 없앤다(표를 그리는 길은 칸에 값이 있으면 그 값으로만 가리고, 못 풀면 이름
// 으로 되돌아가지 않는다 — resolvePortalFormForCustomer).
//
// 🔴 「맞으면 되나」와 「틀리면 안 되나」를 둘 다 본다. 고를 수 있는 값은 손으로 적지
// 않고 등록부에서 가져온다 — 양식이 늘면 이 시험도 저절로 그 양식을 잰다.

test("validateCustomerUpdateFields: 등록부에 있는 양식 id 는 그대로 통과한다", () => {
  assert.ok(CUSTOMER_PORTAL_FORMS.length > 0, "등록부가 비면 이 시험은 아무것도 재지 않는다");
  for (const form of CUSTOMER_PORTAL_FORMS) {
    const result = validateCustomerUpdateFields({ name: "Acme", portalFormId: form.id });
    assert.equal(result.ok, true, `portalFormId=${form.id} 는 통과해야 한다`);
    if (result.ok) assert.equal(result.data.portalFormId, form.id);
  }
});

test("validateCustomerUpdateFields: 「없음」은 통과하고 null 이 된다 — 빈 글자가 아니다", () => {
  // 공백뿐인 값도 「안 고름」이다 — resolvePortalFormForCustomer 가 같은 자로 본다.
  for (const empty of ["", null, undefined, "   "]) {
    const result = validateCustomerUpdateFields({ name: "Acme", portalFormId: empty });
    assert.equal(result.ok, true, `portalFormId=${JSON.stringify(empty)} 는 통과해야 한다`);
    if (result.ok) assert.equal(result.data.portalFormId, null);
  }
});

test("validateCustomerUpdateFields: portalFormId 칸이 아예 없으면 양식 없음으로 읽는다", () => {
  const result = validateCustomerUpdateFields({ name: "Acme" });
  assert.equal(result.ok, true);
  if (result.ok) assert.equal(result.data.portalFormId, null);
});

test("🔴 validateCustomerUpdateFields: 등록부에 없는 양식은 거절한다 — 대소문자도 접지 않는다", () => {
  for (const bad of [
    "icd",
    "Icd",
    "invenia",
    "NOPE",
    "ICD 양식",
    "__proto__",
    "constructor",
    "ICD,JUSUNG",
    7,
    {},
    [],
    true,
  ]) {
    const result = validateCustomerUpdateFields({ name: "Acme", portalFormId: bad });
    assert.equal(result.ok, false, `portalFormId=${JSON.stringify(bad)} 는 거절해야 한다`);
    if (!result.ok) assert.equal(result.fieldErrors.portalFormId, "고를 수 없는 양식입니다.");
  }
});

test("validateCustomerUpdateFields: 양식 id 의 앞뒤 공백은 떼고 본다", () => {
  const result = validateCustomerUpdateFields({ name: "Acme", portalFormId: "  JUSUNG  " });
  assert.equal(result.ok, true);
  if (result.ok) assert.equal(result.data.portalFormId, "JUSUNG");
});

// ── 대표 담당자 직급·메모(2026-09-13 사용자 요청 — 고객사 담당자와 같은 칸) ───

test("validateCustomerUpdateFields: 대표 담당자의 직급·메모를 받고 앞뒤 공백을 걷는다", () => {
  const result = validateCustomerUpdateFields({
    name: "Acme",
    contactName: "김대표",
    contactEmail: null,
    contactPhone: null,
    contactTitle: "  부장 ",
    contactMemo: "  견적은 메일로  ",
  });
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.data.contactTitle, "부장");
    assert.equal(result.data.contactMemo, "견적은 메일로");
  }
});

test("validateCustomerUpdateFields: 직급·메모는 선택 — 없거나 비었거나 공백뿐이면 null", () => {
  for (const empty of [undefined, null, "", "   "]) {
    const result = validateCustomerUpdateFields({
      name: "Acme",
      contactName: null,
      contactEmail: null,
      contactPhone: null,
      contactTitle: empty,
      contactMemo: empty,
    });
    assert.equal(result.ok, true, `값=${JSON.stringify(empty)} 는 통과해야 한다`);
    if (result.ok) {
      assert.equal(result.data.contactTitle, null);
      assert.equal(result.data.contactMemo, null);
    }
  }
});

test("validateCustomerUpdateFields: 직급은 200자, 메모는 500자까지 — 넘으면 그 칸만 오류", () => {
  const atMax = validateCustomerUpdateFields({
    name: "Acme",
    contactTitle: "가".repeat(200),
    contactMemo: "메".repeat(500),
  });
  assert.equal(atMax.ok, true);

  const over = validateCustomerUpdateFields({
    name: "Acme",
    contactTitle: "가".repeat(201),
    contactMemo: "메".repeat(501),
  });
  assert.equal(over.ok, false);
  if (!over.ok) {
    assert.deepEqual(Object.keys(over.fieldErrors).sort(), ["contactMemo", "contactTitle"]);
  }
});

test("validateCustomerUpdateFields: 글자가 아닌 직급·메모는 오류", () => {
  const result = validateCustomerUpdateFields({ name: "Acme", contactTitle: 3, contactMemo: ["x"] });
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.ok(result.fieldErrors.contactTitle);
    assert.ok(result.fieldErrors.contactMemo);
  }
});

test("validateCustomerUpdateFields: 메모의 CRLF 는 LF 로 바꾼 뒤 센다 — 500자에 맞춘 여러 줄 메모가 넘치지 않는다", () => {
  // 줄 250개(글자 1 + 줄바꿈 1)를 LF 로 세면 499자다. CRLF 그대로 세면 748자라 넘친다.
  const lines = Array.from({ length: 250 }, () => "a");
  const result = validateCustomerUpdateFields({ name: "Acme", contactMemo: lines.join("\r\n") });
  assert.equal(result.ok, true);
  if (result.ok) assert.equal(result.data.contactMemo, lines.join("\n"));

  const bareCr = validateCustomerUpdateFields({ name: "Acme", contactMemo: "첫 줄\r둘째 줄" });
  assert.equal(bareCr.ok, true);
  if (bareCr.ok) assert.equal(bareCr.data.contactMemo, "첫 줄\n둘째 줄");
});

// ── 대표 담당자 칸의 오류 문구 — 화면 이름표와 같은 이름(「대표 …」)으로 부른다 ───
// 같은 화면에 「고객사 담당자」 목록이 따로 있어서 「담당자 성함이 너무 깁니다」만으로는
// 어느 쪽 칸인지 알 수 없다(2026-09-13). 규칙(길이·빈 값·글자 여부)은 예전 그대로다.

test("validateCustomerUpdateFields: 길이를 넘은 대표 담당자 칸은 「대표 …」 이름으로 부른다 — 형식 오류 문구는 그대로", () => {
  const result = validateCustomerUpdateFields({
    name: "   ",
    contactName: "가".repeat(201),
    contactEmail: "not-an-email",
    contactPhone: "1".repeat(201),
    contactTitle: "부장",
  });
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.deepEqual(result.fieldErrors, {
      name: "고객사명을 입력해 주세요.",
      contactName: "대표 담당자 성함이 너무 깁니다.",
      contactEmail: "올바른 이메일 형식이 아닙니다.",
      contactPhone: "대표 연락처(전화)가 너무 깁니다.",
    });
  }

  const tooLong = validateCustomerUpdateFields({
    name: "Acme",
    // 201자 — 「@」 가 있어도 길이가 먼저 걸린다.
    contactEmail: `${"a".repeat(195)}@x.com`,
    contactTitle: "가".repeat(201),
    contactMemo: "메".repeat(501),
  });
  assert.equal(tooLong.ok, false);
  if (!tooLong.ok) {
    assert.deepEqual(tooLong.fieldErrors, {
      contactEmail: "대표 연락처(이메일)가 너무 깁니다.",
      contactTitle: "대표 담당자 직급은 200자를 넘을 수 없습니다.",
      contactMemo: "대표 담당자 메모는 500자를 넘을 수 없습니다.",
    });
  }
});

test("validateCustomerUpdateFields: 글자가 아닌 대표 담당자 칸도 「대표 …」 이름으로 부른다", () => {
  const result = validateCustomerUpdateFields({
    name: "Acme",
    contactName: 1,
    contactEmail: 2,
    contactPhone: 3,
    contactTitle: 4,
    contactMemo: 5,
  });
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.deepEqual(result.fieldErrors, {
      contactName: "대표 담당자 성함 값을 확인할 수 없습니다.",
      contactEmail: "대표 연락처(이메일) 값을 확인할 수 없습니다.",
      contactPhone: "대표 연락처(전화) 값을 확인할 수 없습니다.",
      contactTitle: "대표 담당자 직급 값을 확인할 수 없습니다.",
      contactMemo: "대표 담당자 메모 값을 확인할 수 없습니다.",
    });
  }
});
