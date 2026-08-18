import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

const migration = readFileSync(
  join(process.cwd(), "drizzle", "0037_legacy_import_state_set.sql"),
  "utf8"
).trim();

test("0037 adds only the approved legacy import status action", () => {
  assert.equal(
    migration,
    'ALTER TYPE "public"."status_change_action_type" ADD VALUE \'LEGACY_IMPORT_STATE_SET\';'
  );
  assert.doesNotMatch(migration, /\b(?:DROP|DELETE|UPDATE|RENAME|TRUNCATE|INSERT)\b/i);
});
