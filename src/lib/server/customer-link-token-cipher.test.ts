import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";

import {
  decryptCustomerLinkToken,
  encryptCustomerLinkToken,
  isCustomerLinkTokenKeyConfigured,
} from "./customer-link-token-cipher";

/**
 * ============================================================================
 * 고객사 전용 주소 보관 — 넣은 것이 그대로 나오고, 남의 것은 안 나온다
 * ============================================================================
 * 확인하는 것은 여섯 가지다.
 *
 *  1. 넣은 주소가 그대로 돌아온다.
 *  2. **같은 주소도 매번 다른 암호문이 된다.** 같은 값이 나오면 DB 만 봐도
 *     "이 두 고객사는 같은 주소"라는 사실이 새고, 재발급 여부도 드러난다.
 *  3. **🔴 다른 고객사 행에 옮겨 붙이면 못 푼다.** 옮겨 붙이는 것만으로 A 사
 *     화면에 B 사 주소가 뜨는 일을 막는다.
 *  4. **🔴 키가 다르면 못 푼다.** DB 만 유출됐을 때의 상황이 이것이다.
 *  5. 망가진 값·빈 값은 던지지 않고 null 이다 — 주소 하나가 화면을 멈추면 안 된다.
 *  6. 키가 없으면 기능이 꺼진다(발급은 계속돼야 하므로 던지지 않는다).
 * ============================================================================
 */

const KEY_ENV = "CUSTOMER_LINK_TOKEN_KEY";
const KEY_A = randomBytes(32).toString("base64");
const KEY_B = randomBytes(32).toString("base64");
const CUSTOMER_A = "11111111-1111-1111-1111-111111111111";
const CUSTOMER_B = "22222222-2222-2222-2222-222222222222";
const TOKEN = randomBytes(32).toString("base64url");

let savedKey: string | undefined;

before(() => {
  savedKey = process.env[KEY_ENV];
});

after(() => {
  if (savedKey === undefined) delete process.env[KEY_ENV];
  else process.env[KEY_ENV] = savedKey;
});

describe("고객사 전용 주소 보관", () => {
  test("넣은 주소가 그대로 돌아온다", () => {
    process.env[KEY_ENV] = KEY_A;
    const cipher = encryptCustomerLinkToken(TOKEN, CUSTOMER_A);
    assert.ok(cipher);
    assert.equal(decryptCustomerLinkToken(cipher, CUSTOMER_A), TOKEN);
  });

  test("같은 주소도 매번 다른 암호문이 된다", () => {
    process.env[KEY_ENV] = KEY_A;
    const first = encryptCustomerLinkToken(TOKEN, CUSTOMER_A);
    const second = encryptCustomerLinkToken(TOKEN, CUSTOMER_A);
    assert.notEqual(first, second, "같은 암호문이면 DB 만 봐도 같은 주소인 것이 드러난다");
    // 그래도 둘 다 같은 주소로 풀린다.
    assert.equal(decryptCustomerLinkToken(first, CUSTOMER_A), TOKEN);
    assert.equal(decryptCustomerLinkToken(second, CUSTOMER_A), TOKEN);
  });

  test("🔴 다른 고객사 행에 옮겨 붙이면 못 푼다", () => {
    process.env[KEY_ENV] = KEY_A;
    const cipher = encryptCustomerLinkToken(TOKEN, CUSTOMER_A);
    assert.equal(decryptCustomerLinkToken(cipher, CUSTOMER_B), null);
  });

  test("🔴 키가 다르면 못 푼다 — DB 만 유출된 상황이 이것이다", () => {
    process.env[KEY_ENV] = KEY_A;
    const cipher = encryptCustomerLinkToken(TOKEN, CUSTOMER_A);

    process.env[KEY_ENV] = KEY_B;
    assert.equal(decryptCustomerLinkToken(cipher, CUSTOMER_A), null);
  });

  test("망가진 값·빈 값은 던지지 않고 null 이다", () => {
    process.env[KEY_ENV] = KEY_A;
    assert.equal(decryptCustomerLinkToken(null, CUSTOMER_A), null);
    assert.equal(decryptCustomerLinkToken("", CUSTOMER_A), null);
    assert.equal(decryptCustomerLinkToken("아무말", CUSTOMER_A), null);
    assert.equal(decryptCustomerLinkToken("v1.a.b.c", CUSTOMER_A), null);
    assert.equal(decryptCustomerLinkToken("v2.a.b.c.d", CUSTOMER_A), null);

    // 한 바이트만 뒤집어도 못 푼다(GCM 태그).
    //
    // 마지막 글자 하나를 바꾸는 방식은 쓰지 않는다 — base64url 의 끝 글자는
    // 남는 비트를 채우는 자리라, 다른 글자로 바꿔도 **디코딩 결과가 같을 수
    // 있다.** 실제로 그렇게 짰다가 "변조했는데 그대로 풀리는" 시험을 얻었다.
    const cipher = encryptCustomerLinkToken(TOKEN, CUSTOMER_A);
    assert.ok(cipher);
    const parts = cipher.split(".");
    const body = Buffer.from(parts[3], "base64url");
    body[0] ^= 0xff;
    parts[3] = body.toString("base64url");
    assert.equal(decryptCustomerLinkToken(parts.join("."), CUSTOMER_A), null);
  });

  test("키가 없으면 기능이 꺼진다 — 발급을 막지는 않는다", () => {
    delete process.env[KEY_ENV];
    assert.equal(isCustomerLinkTokenKeyConfigured(), false);
    assert.equal(encryptCustomerLinkToken(TOKEN, CUSTOMER_A), null);
    assert.equal(decryptCustomerLinkToken("v1.a.b.c.d", CUSTOMER_A), null);
  });

  test("키 형식이 틀리면 조용히 꺼지지 않고 던진다", () => {
    process.env[KEY_ENV] = Buffer.from("너무짧은키").toString("base64");
    assert.throws(() => isCustomerLinkTokenKeyConfigured(), /32바이트/);
  });
});
