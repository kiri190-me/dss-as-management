import assert from "node:assert/strict";
import { test } from "node:test";
import { requireActiveTestDatabase, requireSafeTestDatabaseUrl } from "./test-database-safety";

const developmentUrl = "postgresql://user:secret@127.0.0.1:5432/dss_as_dev";
const testUrl = "postgresql://user:secret@127.0.0.1:5432/dss_as_test";

test("accepts a separate database whose name ends in _test", () => {
  assert.equal(
    requireSafeTestDatabaseUrl({ developmentDatabaseUrl: developmentUrl, testDatabaseUrl: testUrl }),
    testUrl
  );
  assert.doesNotThrow(() => requireActiveTestDatabase(testUrl));
});

test("rejects the development URL before a database client can be created", () => {
  assert.throws(
    () => requireSafeTestDatabaseUrl({ developmentDatabaseUrl: developmentUrl, testDatabaseUrl: developmentUrl }),
    /different from the development database/
  );
});

test("rejects a database without the approved _test suffix", () => {
  assert.throws(
    () => requireSafeTestDatabaseUrl({
      developmentDatabaseUrl: developmentUrl,
      testDatabaseUrl: "postgresql://user:secret@127.0.0.1:5432/dss_as_sandbox",
    }),
    /ending in _test/
  );
  assert.throws(() => requireActiveTestDatabase(developmentUrl), /must end in _test/);
});

test("errors never disclose a URL or password", () => {
  let message = "";
  try {
    requireSafeTestDatabaseUrl({ developmentDatabaseUrl: developmentUrl, testDatabaseUrl: developmentUrl });
  } catch (error) {
    message = error instanceof Error ? error.message : String(error);
  }
  assert.equal(message.includes("secret"), false);
  assert.equal(message.includes("postgresql://"), false);
});
