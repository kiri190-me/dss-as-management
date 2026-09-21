import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { SignJWT, generateKeyPair, type CryptoKey } from "jose";
import {
  PORTAL_TOKEN_MAX_LIFETIME_SECONDS,
  PORTAL_TOKEN_PURPOSES,
  readBearerToken,
  verifyPortalTokenWithKey,
} from "./portal-service-token";

/**
 * ============================================================================
 * 🔴 남의 알림을 볼 수 있는 문 — 이 파일이 그 자물쇠를 돌려 본다
 * ============================================================================
 * 실제 키 한 쌍을 만들어 진짜 토큰을 굽고, 진짜 jose 로 검증한다. 네트워크는
 * 타지 않는다 — 검증 함수가 열쇠를 **인자로** 받도록 만들어 둔 덕분이다
 * (실제 요청에서는 그 자리에 포털의 JWKS 가 들어간다).
 * ============================================================================
 */

const ISSUER = "http://portal.test:3100";
const AUDIENCE = "rf-service-system";
const PURPOSE = PORTAL_TOKEN_PURPOSES.notificationsRead;
const SUBJECT = "portal-user-0001";

let privateKey: CryptoKey;
let publicKey: CryptoKey;
/** 다른 열쇠로 서명한 토큰(= 서명이 틀린 토큰)을 만들기 위한 한 쌍. */
let otherPrivateKey: CryptoKey;

const originalConsoleError = console.error;

before(async () => {
  ({ privateKey, publicKey } = await generateKeyPair("RS256"));
  ({ privateKey: otherPrivateKey } = await generateKeyPair("RS256"));
  // 거절 경로마다 서버 로그가 한 줄씩 남는다 — 시험 출력만 어지럽힌다.
  console.error = () => {};
});

after(() => {
  console.error = originalConsoleError;
});

type Claims = {
  issuer?: string;
  audience?: string;
  subject?: string | null;
  purpose?: unknown;
  nonce?: string;
  iat?: number;
  exp?: number;
  key?: CryptoKey;
};

async function sign(claims: Claims = {}): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const payload: Record<string, unknown> = {};
  if (claims.purpose !== null) payload.purpose = claims.purpose ?? PURPOSE;
  if (claims.nonce !== undefined) payload.nonce = claims.nonce;

  let jwt = new SignJWT(payload)
    .setProtectedHeader({ alg: "RS256" })
    .setIssuer(claims.issuer ?? ISSUER)
    .setAudience(claims.audience ?? AUDIENCE)
    .setIssuedAt(claims.iat ?? now)
    .setExpirationTime(claims.exp ?? now + 60);
  const subject = claims.subject === undefined ? SUBJECT : claims.subject;
  if (subject !== null) jwt = jwt.setSubject(subject);
  return jwt.sign(claims.key ?? privateKey);
}

function verify(token: string | null) {
  return verifyPortalTokenWithKey({
    token,
    key: publicKey,
    issuer: ISSUER,
    audience: AUDIENCE,
    purpose: PURPOSE,
  });
}

describe("포털 서비스 토큰 검증", () => {
  test("제대로 구운 토큰은 통과하고, **대상 사용자는 토큰의 sub 에서** 나온다", async () => {
    const result = await verify(await sign());
    assert.equal(result.ok, true);
    assert.equal(result.ok && result.subject, SUBJECT);
  });

  test("🔴 토큰이 없으면 거절한다", async () => {
    assert.deepEqual(await verify(null), { ok: false, reason: "missing_token" });
    assert.deepEqual(await verify(""), { ok: false, reason: "missing_token" });
  });

  test("🔴 서명이 틀린 토큰을 거절한다", async () => {
    // 모양은 완전히 같고 서명한 열쇠만 다르다.
    const result = await verify(await sign({ key: otherPrivateKey }));
    assert.deepEqual(result, { ok: false, reason: "invalid_token" });
  });

  test("🔴 만료된 토큰을 거절한다", async () => {
    const now = Math.floor(Date.now() / 1000);
    const result = await verify(await sign({ iat: now - 1000, exp: now - 900 }));
    assert.deepEqual(result, { ok: false, reason: "invalid_token" });
  });

  test("🔴 만료 시각이 아예 없는 토큰을 거절한다 — 영원히 사는 토큰은 만들지 못한다", async () => {
    const token = await new SignJWT({ purpose: PURPOSE })
      .setProtectedHeader({ alg: "RS256" })
      .setIssuer(ISSUER)
      .setAudience(AUDIENCE)
      .setSubject(SUBJECT)
      .setIssuedAt()
      .sign(privateKey);
    assert.deepEqual(await verify(token), { ok: false, reason: "invalid_token" });
  });

  test("수명이 너무 긴 토큰을 거절한다", async () => {
    const now = Math.floor(Date.now() / 1000);
    const result = await verify(
      await sign({ iat: now, exp: now + PORTAL_TOKEN_MAX_LIFETIME_SECONDS + 60 })
    );
    assert.deepEqual(result, { ok: false, reason: "lifetime_too_long" });
  });

  test("다른 시스템에 발급된 토큰(aud 가 다름)을 거절한다", async () => {
    assert.deepEqual(await verify(await sign({ audience: "other-system" })), {
      ok: false,
      reason: "invalid_token",
    });
  });

  test("모르는 발급자의 토큰을 거절한다", async () => {
    assert.deepEqual(await verify(await sign({ issuer: "http://evil.test" })), {
      ok: false,
      reason: "invalid_token",
    });
  });

  test("🔴 ID 토큰을 들이밀 수 없다 — nonce 가 있으면 거절한다", async () => {
    assert.deepEqual(await verify(await sign({ nonce: "n-1" })), { ok: false, reason: "id_token" });
  });

  test("🔴 용도가 다른 토큰을 거절한다 — 알림 읽기 토큰으로 설정을 고칠 수 없다", async () => {
    const token = await sign({ purpose: PORTAL_TOKEN_PURPOSES.notificationSettingsWrite });
    assert.deepEqual(await verify(token), { ok: false, reason: "wrong_purpose" });
  });

  test("용도 클레임이 아예 없는 토큰을 거절한다", async () => {
    assert.deepEqual(await verify(await sign({ purpose: null })), {
      ok: false,
      reason: "wrong_purpose",
    });
  });

  test("sub 가 없는 토큰을 거절한다 — 누구의 알림인지 알 수 없다", async () => {
    assert.deepEqual(await verify(await sign({ subject: null })), {
      ok: false,
      reason: "invalid_token",
    });
  });

  test("알고리즘을 none 으로 바꾼 토큰은 통과하지 못한다", async () => {
    const [header, payload] = (await sign()).split(".");
    const noneHeader = Buffer.from(JSON.stringify({ alg: "none" })).toString("base64url");
    assert.deepEqual(await verify(`${noneHeader}.${payload}.`), {
      ok: false,
      reason: "invalid_token",
    });
    // 남의 눈에는 같은 payload 였다는 것까지 확인한다.
    assert.ok(header.length > 0);
  });
});

describe("readBearerToken", () => {
  test("Bearer 머리말에서 토큰만 꺼낸다(대소문자 무시)", () => {
    assert.equal(readBearerToken("Bearer abc.def.ghi"), "abc.def.ghi");
    assert.equal(readBearerToken("bearer abc.def.ghi"), "abc.def.ghi");
    assert.equal(readBearerToken("Bearer   abc.def.ghi  "), "abc.def.ghi");
  });

  test("머리말이 없거나 모양이 다르면 null", () => {
    assert.equal(readBearerToken(null), null);
    assert.equal(readBearerToken(""), null);
    assert.equal(readBearerToken("abc.def.ghi"), null);
    assert.equal(readBearerToken("Basic abc"), null);
    assert.equal(readBearerToken("Bearer"), null);
    assert.equal(readBearerToken("Bearer "), null);
  });
});
