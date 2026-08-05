import { test } from "node:test";
import assert from "node:assert/strict";
import { getAuthSource } from "./auth-source";

function withEnv(value: string | undefined, run: () => void) {
  const original = process.env.AUTH_SOURCE;
  if (value === undefined) delete process.env.AUTH_SOURCE;
  else process.env.AUTH_SOURCE = value;

  try {
    run();
  } finally {
    if (original === undefined) delete process.env.AUTH_SOURCE;
    else process.env.AUTH_SOURCE = original;
  }
}

test("defaults to mock when unset", () => {
  withEnv(undefined, () => {
    assert.equal(getAuthSource(), "mock");
  });
});

test("defaults to mock when empty string", () => {
  withEnv("", () => {
    assert.equal(getAuthSource(), "mock");
  });
});

test('accepts "mock"', () => {
  withEnv("mock", () => {
    assert.equal(getAuthSource(), "mock");
  });
});

test('accepts "database"', () => {
  withEnv("database", () => {
    assert.equal(getAuthSource(), "database");
  });
});

test("throws clearly on an invalid value", () => {
  withEnv("bogus", () => {
    assert.throws(() => getAuthSource(), /AUTH_SOURCE must be one of/);
  });
});
