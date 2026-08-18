import { test } from "node:test";
import assert from "node:assert/strict";
import {
  getOrCreateIntakeIdempotencyKey,
  resetIntakeIdempotencyKey,
} from "./intake-idempotency-key";

/**
 * node:test has no DOM/localStorage — this file's isBrowser()-gated module
 * reads/writes window.localStorage only inside function bodies (never at
 * module scope), so a minimal fake `window` installed before each test call
 * is enough; no jsdom dependency needed.
 */
function installFakeLocalStorage(): Storage {
  const store = new Map<string, string>();
  const fakeStorage = {
    getItem: (key: string) => (store.has(key) ? store.get(key)! : null),
    setItem: (key: string, value: string) => {
      store.set(key, value);
    },
    removeItem: (key: string) => {
      store.delete(key);
    },
  } as Storage;
  (globalThis as unknown as { window: { localStorage: Storage } }).window = {
    localStorage: fakeStorage,
  };
  return fakeStorage;
}

function uninstallFakeWindow(): void {
  delete (globalThis as unknown as { window?: unknown }).window;
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Version nibble must be "4" and the variant nibble must be one of 8/9/a/b — checks the getRandomValues() fallback's own bit-manipulation, since UUID_PATTERN alone doesn't enforce RFC 4122 v4 shape. */
const UUID_V4_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** Hides crypto.randomUUID (simulating an insecure-context browser, e.g. a LAN HTTP address, where the Web Crypto API spec disallows it) while keeping crypto.getRandomValues intact, exercising getOrCreateIntakeIdempotencyKey's fallback tier. Node's global `crypto` is configurable, so this can be overridden and restored like the fake `window` above. */
function withoutRandomUUID<T>(run: () => T): T {
  const originalCrypto = globalThis.crypto;
  Object.defineProperty(globalThis, "crypto", {
    value: { getRandomValues: originalCrypto.getRandomValues.bind(originalCrypto) },
    configurable: true,
  });
  try {
    return run();
  } finally {
    Object.defineProperty(globalThis, "crypto", { value: originalCrypto, configurable: true });
  }
}

test("generates a UUID-shaped key on first read", () => {
  installFakeLocalStorage();
  try {
    const key = getOrCreateIntakeIdempotencyKey();
    assert.match(key, UUID_PATTERN);
  } finally {
    uninstallFakeWindow();
  }
});

test("reuses the same key across repeated reads (survives page refresh)", () => {
  installFakeLocalStorage();
  try {
    const first = getOrCreateIntakeIdempotencyKey();
    const second = getOrCreateIntakeIdempotencyKey();
    assert.equal(first, second);
  } finally {
    uninstallFakeWindow();
  }
});

test("reset generates a new, different key on the next read", () => {
  installFakeLocalStorage();
  try {
    const first = getOrCreateIntakeIdempotencyKey();
    resetIntakeIdempotencyKey();
    const second = getOrCreateIntakeIdempotencyKey();
    assert.notEqual(first, second);
    assert.match(second, UUID_PATTERN);
  } finally {
    uninstallFakeWindow();
  }
});

test("without a browser window, still returns a UUID-shaped key without throwing", () => {
  uninstallFakeWindow();
  const key = getOrCreateIntakeIdempotencyKey();
  assert.match(key, UUID_PATTERN);
});

// ==================== crypto.randomUUID fallback (insecure-context LAN fix) ====================

test("falls back to a getRandomValues()-based UUID when crypto.randomUUID is unavailable, without throwing", () => {
  installFakeLocalStorage();
  try {
    const key = withoutRandomUUID(() => getOrCreateIntakeIdempotencyKey());
    assert.match(key, UUID_V4_PATTERN);
  } finally {
    uninstallFakeWindow();
  }
});

test("fallback-generated key is still reused across repeated reads (same idempotency semantics as the primary path)", () => {
  installFakeLocalStorage();
  try {
    const [first, second] = withoutRandomUUID(() => [getOrCreateIntakeIdempotencyKey(), getOrCreateIntakeIdempotencyKey()]);
    assert.equal(first, second);
  } finally {
    uninstallFakeWindow();
  }
});

test("fallback-generated keys are distinct across resets (no reuse across separate drafts)", () => {
  installFakeLocalStorage();
  try {
    const first = withoutRandomUUID(() => getOrCreateIntakeIdempotencyKey());
    resetIntakeIdempotencyKey();
    const second = withoutRandomUUID(() => getOrCreateIntakeIdempotencyKey());
    assert.notEqual(first, second);
    assert.match(second, UUID_V4_PATTERN);
  } finally {
    uninstallFakeWindow();
  }
});
