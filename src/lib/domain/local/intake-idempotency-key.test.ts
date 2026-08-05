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
