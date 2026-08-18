import assert from "node:assert/strict";
import { test } from "node:test";

import { generateClientUuid } from "./client-uuid";

// 전역 crypto를 바꿔치기하기 전에 진짜 구현을 붙잡아 둔다 — 스텁 안에서
// globalThis.crypto.getRandomValues를 부르면 스텁 자신을 다시 부르게 되어
// 무한 재귀가 된다.
const realGetRandomValues = globalThis.crypto.getRandomValues.bind(globalThis.crypto);

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * 이 테스트의 존재 이유는 폴백 경로다. 평문 HTTP LAN 주소(폰 실기 테스트
 * 환경)에서는 crypto.randomUUID가 아예 없고, 그때 만들어지는 값이 Postgres
 * uuid 컬럼에 그대로 들어간다 — 형식이 조금이라도 어긋나면 INSERT 시점에야
 * 터진다. Node 테스트 환경에는 randomUUID가 항상 있으므로, 없는 브라우저를
 * 흉내 내려면 아래처럼 전역을 갈아끼워야 한다.
 */
function withCrypto<T>(replacement: unknown, fn: () => T): T {
  const original = Object.getOwnPropertyDescriptor(globalThis, "crypto");
  Object.defineProperty(globalThis, "crypto", { value: replacement, configurable: true });
  try {
    return fn();
  } finally {
    if (original) Object.defineProperty(globalThis, "crypto", original);
    else delete (globalThis as { crypto?: unknown }).crypto;
  }
}

test("randomUUID가 있으면 그대로 쓴다", () => {
  const value = generateClientUuid();
  assert.match(value, UUID_V4);
});

test("randomUUID가 없어도(비보안 컨텍스트) getRandomValues로 유효한 v4 UUID를 만든다", () => {
  const value = withCrypto(
    { getRandomValues: (arr: Uint8Array) => realGetRandomValues(arr) },
    () => generateClientUuid()
  );
  assert.match(value, UUID_V4, "Postgres uuid 컬럼에 들어가므로 v4 형식이 정확해야 한다");
});

test("폴백 경로도 매번 다른 값을 만든다", () => {
  const values = withCrypto(
    { getRandomValues: (arr: Uint8Array) => realGetRandomValues(arr) },
    () => Array.from({ length: 200 }, () => generateClientUuid())
  );
  assert.equal(new Set(values).size, 200);
});

test("두 소스가 모두 없으면 조용히 잘못된 값을 만들지 않고 던진다", () => {
  assert.throws(() => withCrypto({}, () => generateClientUuid()), /No secure random UUID source/);
});
