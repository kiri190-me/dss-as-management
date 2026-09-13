import { describe, test } from "node:test";
import assert from "node:assert/strict";

import {
  CUSTOMER_CONTACT_EMAIL_MAX,
  CUSTOMER_CONTACT_MEMO_MAX,
  CUSTOMER_CONTACT_NAME_MAX,
  CUSTOMER_CONTACT_PHONE_MAX,
  CUSTOMER_CONTACT_TITLE_MAX,
  validateCustomerContactFields,
} from "./customer-contact-input";

/**
 * 이 파일이 지키는 것은 넷이다.
 *
 *  1. **이름만 필수다** — 앞뒤 공백을 걷고 비면 거절한다.
 *  2. **선택 칸은 걷고 나서 비면 null이다** — 빈 글자를 저장하지 않는다.
 *  3. **칸마다 상한까지는 받고, 한 글자라도 넘으면 거절한다.**
 *  4. **이메일 형식 규칙은 End-User 담당자와 같다** — "@"가 있는지만 본다.
 */

describe("이름", () => {
  test("앞뒤 공백을 걷는다", () => {
    const result = validateCustomerContactFields({ contactName: "  홍길동  " });
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.data.contactName, "홍길동");
  });

  test("비었거나 공백뿐이거나 없으면 거절한다", () => {
    for (const raw of [{ contactName: "" }, { contactName: "   " }, { contactName: "\t\n" }, {}]) {
      const result = validateCustomerContactFields(raw);
      assert.equal(result.ok, false, JSON.stringify(raw));
      if (result.ok) return;
      assert.equal(result.fieldErrors.contactName, "담당자명을 입력해 주세요.");
    }
  });

  test("글자가 아니면 거절한다", () => {
    for (const bad of [null, 3, {}, ["홍길동"]]) {
      const result = validateCustomerContactFields({ contactName: bad });
      assert.equal(result.ok, false, String(bad));
      if (result.ok) return;
      assert.ok(result.fieldErrors.contactName, String(bad));
    }
  });

  test("상한까지는 받고, 한 글자라도 넘으면 거절한다", () => {
    const ok = validateCustomerContactFields({ contactName: "가".repeat(CUSTOMER_CONTACT_NAME_MAX) });
    assert.equal(ok.ok, true);

    const tooLong = validateCustomerContactFields({ contactName: "가".repeat(CUSTOMER_CONTACT_NAME_MAX + 1) });
    assert.equal(tooLong.ok, false);
    if (tooLong.ok) return;
    assert.equal(tooLong.fieldErrors.contactName, `담당자명은 ${CUSTOMER_CONTACT_NAME_MAX}자를 넘을 수 없습니다.`);
  });
});

describe("선택 칸 — 직급·전화·이메일·메모", () => {
  test("모두 채우면 앞뒤 공백을 걷어 그대로 돌려준다", () => {
    const result = validateCustomerContactFields({
      contactName: "홍길동",
      title: "  과장 ",
      phone: " 010-1234-5678 ",
      email: " hong@example.com ",
      memo: "  오전에만 통화 가능\n금요일 휴무  ",
    });
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.deepEqual(result.data, {
      contactName: "홍길동",
      title: "과장",
      phone: "010-1234-5678",
      email: "hong@example.com",
      memo: "오전에만 통화 가능\n금요일 휴무",
    });
  });

  test("없거나 null이거나 빈 글자·공백뿐이면 null이다", () => {
    for (const empty of [undefined, null, "", "   "]) {
      const result = validateCustomerContactFields({
        contactName: "홍길동",
        title: empty,
        phone: empty,
        email: empty,
        memo: empty,
      });
      assert.equal(result.ok, true, JSON.stringify(empty));
      if (!result.ok) return;
      assert.deepEqual(result.data, { contactName: "홍길동", title: null, phone: null, email: null, memo: null });
    }
  });

  test("글자가 아니면 칸마다 거절한다", () => {
    const result = validateCustomerContactFields({ contactName: "홍길동", title: 1, phone: {}, email: [], memo: true });
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.deepEqual(Object.keys(result.fieldErrors).sort(), ["email", "memo", "phone", "title"]);
  });

  const limits: ReadonlyArray<{ key: "title" | "phone" | "email" | "memo"; label: string; max: number; fill: (n: number) => string }> = [
    { key: "title", label: "직급", max: CUSTOMER_CONTACT_TITLE_MAX, fill: (n) => "가".repeat(n) },
    { key: "phone", label: "전화", max: CUSTOMER_CONTACT_PHONE_MAX, fill: (n) => "1".repeat(n) },
    { key: "email", label: "이메일", max: CUSTOMER_CONTACT_EMAIL_MAX, fill: (n) => "a".repeat(n - "@x.kr".length) + "@x.kr" },
    { key: "memo", label: "메모", max: CUSTOMER_CONTACT_MEMO_MAX, fill: (n) => "가".repeat(n) },
  ];

  for (const { key, label, max, fill } of limits) {
    test(`${label}: 상한(${max})까지는 받고, 한 글자라도 넘으면 거절한다`, () => {
      const exact = fill(max);
      assert.equal(exact.length, max);
      const ok = validateCustomerContactFields({ contactName: "홍길동", [key]: exact });
      assert.equal(ok.ok, true);
      if (!ok.ok) return;
      assert.equal(ok.data[key], exact);

      const tooLong = validateCustomerContactFields({ contactName: "홍길동", [key]: fill(max + 1) });
      assert.equal(tooLong.ok, false);
      if (tooLong.ok) return;
      assert.equal(tooLong.fieldErrors[key], `${label}은(는) ${max}자를 넘을 수 없습니다.`);
    });

    test(`${label}: 상한은 앞뒤 공백을 걷은 뒤에 센다`, () => {
      const result = validateCustomerContactFields({ contactName: "홍길동", [key]: `  ${fill(max)}  ` });
      assert.equal(result.ok, true);
    });
  }
});

describe("이메일 형식", () => {
  test('"@"가 없으면 거절한다', () => {
    const result = validateCustomerContactFields({ contactName: "홍길동", email: "not-an-email" });
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.fieldErrors.email, "올바른 이메일 형식이 아닙니다.");
  });

  test('"@"만 있으면 받는다 — End-User 담당자와 같은 규칙이다', () => {
    const result = validateCustomerContactFields({ contactName: "홍길동", email: "a@b" });
    assert.equal(result.ok, true);
  });
});

describe("오류 모음", () => {
  test("여러 칸이 틀리면 칸마다 오류를 한꺼번에 돌려준다", () => {
    const result = validateCustomerContactFields({
      contactName: " ",
      email: "없음",
      memo: "가".repeat(CUSTOMER_CONTACT_MEMO_MAX + 1),
    });
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.deepEqual(Object.keys(result.fieldErrors).sort(), ["contactName", "email", "memo"]);
  });
});
