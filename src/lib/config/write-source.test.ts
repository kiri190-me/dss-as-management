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

test("defaults to local when unset", () => {
  withEnv(undefined, () => {
    assert.equal(getRepairCaseWriteSource(), "local");
  });
});

test("defaults to local when empty string", () => {
  withEnv("", () => {
    assert.equal(getRepairCaseWriteSource(), "local");
  });
});

test('accepts "local"', () => {
  withEnv("local", () => {
    assert.equal(getRepairCaseWriteSource(), "local");
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
