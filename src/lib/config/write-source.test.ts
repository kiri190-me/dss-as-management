import { test } from "node:test";
import assert from "node:assert/strict";
import { getRepairCaseWriteSource } from "./write-source";

function withEnv(value: string | undefined, run: () => void) {
  const original = process.env.REPAIR_CASE_WRITE_SOURCE;
  if (value === undefined) delete process.env.REPAIR_CASE_WRITE_SOURCE;
  else process.env.REPAIR_CASE_WRITE_SOURCE = value;

  try {
    run();
  } finally {
    if (original === undefined) delete process.env.REPAIR_CASE_WRITE_SOURCE;
    else process.env.REPAIR_CASE_WRITE_SOURCE = original;
  }
}

test("defaults to database when unset", () => {
  withEnv(undefined, () => {
    assert.equal(getRepairCaseWriteSource(), "database");
  });
});

test("defaults to database when empty string", () => {
  withEnv("", () => {
    assert.equal(getRepairCaseWriteSource(), "database");
  });
});

// The localStorage demo write path is gone. "local" must be rejected the same
// way any other invalid value is — never accepted-but-ignored, which would
// leave a misconfigured environment silently writing to the database while the
// setting claims otherwise.
test('rejects "local" — the removed demo write path', () => {
  withEnv("local", () => {
    assert.throws(() => getRepairCaseWriteSource(), /REPAIR_CASE_WRITE_SOURCE must be one of/);
    assert.throws(() => getRepairCaseWriteSource(), /got: "local"/);
  });
});

test('accepts "database"', () => {
  withEnv("database", () => {
    assert.equal(getRepairCaseWriteSource(), "database");
  });
});

test("throws clearly on an invalid value", () => {
  withEnv("bogus", () => {
    assert.throws(() => getRepairCaseWriteSource(), /REPAIR_CASE_WRITE_SOURCE must be one of/);
  });
});
