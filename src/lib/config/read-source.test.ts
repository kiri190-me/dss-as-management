import { test } from "node:test";
import assert from "node:assert/strict";
import { getRepairCaseReadSource } from "./read-source";

function withEnv(value: string | undefined, run: () => void) {
  const original = process.env.REPAIR_CASE_READ_SOURCE;
  if (value === undefined) delete process.env.REPAIR_CASE_READ_SOURCE;
  else process.env.REPAIR_CASE_READ_SOURCE = value;

  try {
    run();
  } finally {
    if (original === undefined) delete process.env.REPAIR_CASE_READ_SOURCE;
    else process.env.REPAIR_CASE_READ_SOURCE = original;
  }
}

// An environment that forgets the line entirely (a fresh .env on the NAS) must
// read the real database — the old default silently served demo rows that look
// exactly like production data.
test("defaults to database when unset", () => {
  withEnv(undefined, () => {
    assert.equal(getRepairCaseReadSource(), "database");
  });
});

test("defaults to database when empty string", () => {
  withEnv("", () => {
    assert.equal(getRepairCaseReadSource(), "database");
  });
});

// The mock demo read path is gone. "mock" must be rejected the same way any
// other invalid value is — never accepted-but-ignored, which would leave a
// misconfigured environment silently reading the database while the setting
// claims otherwise.
test('rejects "mock" — the removed demo read path', () => {
  withEnv("mock", () => {
    assert.throws(() => getRepairCaseReadSource(), /REPAIR_CASE_READ_SOURCE must be one of/);
    assert.throws(() => getRepairCaseReadSource(), /got: "mock"/);
  });
});

test('accepts "database"', () => {
  withEnv("database", () => {
    assert.equal(getRepairCaseReadSource(), "database");
  });
});

test("throws clearly on an invalid value", () => {
  withEnv("bogus", () => {
    assert.throws(() => getRepairCaseReadSource(), /REPAIR_CASE_READ_SOURCE must be one of/);
  });
});
