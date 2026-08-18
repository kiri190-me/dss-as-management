import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { statusChangeActionTypeEnum } from "./status-change-histories";

/**
 * 0037(legacy-import-state-set.test.ts)이 세운 선례를 그대로 따른다 — enum
 * 값 추가 마이그레이션은 "그 한 줄 외에 아무것도 하지 않는다"를 파일 내용으로
 * 고정해 둔다. 이 종류의 마이그레이션에 DROP/UPDATE 같은 구문이 섞여 들어오면
 * 되돌릴 수 없는 피해가 되므로, 리뷰가 아니라 테스트로 막는다.
 */
const migration = readFileSync(
  join(process.cwd(), "drizzle", "0039_manual_step_set.sql"),
  "utf8"
).trim();

test("0039 adds only the manual step-set action", () => {
  assert.equal(
    migration,
    'ALTER TYPE "public"."status_change_action_type" ADD VALUE \'STEP_SET_MANUALLY\';'
  );
  assert.doesNotMatch(migration, /\b(?:DROP|DELETE|UPDATE|RENAME|TRUNCATE|INSERT)\b/i);
});

test("the drizzle enum lists STEP_SET_MANUALLY exactly once, after the existing values", () => {
  // 순서가 중요하다: ADD VALUE는 기존 값 뒤에 붙으므로, 스키마 배열의 순서가
  // 실제 DB enum 순서와 어긋나면 drizzle-kit이 다음 generate에서 불필요한
  // 차이를 감지한다.
  assert.deepEqual(statusChangeActionTypeEnum.enumValues, [
    "STEP_ADVANCED",
    "STEP_RETURNED",
    "HOLD_STARTED",
    "HOLD_RELEASED",
    "SHIPMENT_COMPLETED",
    "LEGACY_IMPORT_STATE_SET",
    "STEP_SET_MANUALLY",
  ]);
});
