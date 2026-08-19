import { test } from "node:test";
import assert from "node:assert/strict";

import { findDestructiveOperations, describeOperation } from "./migration-safety";

test("표를 더하기만 하는 마이그레이션은 아무것도 걸리지 않는다", () => {
  const sql = `
    CREATE TABLE "role_permissions" (
      "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
      "role" "role_code" NOT NULL
    );--> statement-breakpoint
    ALTER TABLE "role_permissions" ADD CONSTRAINT "fk" FOREIGN KEY ("updated_by") REFERENCES "users"("id");
  `;
  assert.deepEqual(findDestructiveOperations(sql), []);
});

test("enum 값 추가도 걸리지 않는다", () => {
  const sql = `ALTER TYPE "public"."inventory_part_request_status" ADD VALUE 'ON_HOLD';`;
  assert.deepEqual(findDestructiveOperations(sql), []);
});

test("표를 지우는 문장을 잡는다 — 스키마 접두사와 CASCADE가 붙어 있어도", () => {
  // 2026-08-19의 0044(Excel 이관 제거)가 실제로 이런 모양이었다.
  const sql = `
    DROP TABLE "excel_import_batches" CASCADE;--> statement-breakpoint
    DROP TABLE "public"."excel_import_rows" CASCADE;--> statement-breakpoint
    DROP TYPE "public"."excel_import_row_status";
  `;
  const ops = findDestructiveOperations(sql);
  assert.deepEqual(ops, [
    { kind: "DROP_TABLE", table: "excel_import_batches" },
    { kind: "DROP_TABLE", table: "excel_import_rows" },
  ]);
  // DROP TYPE은 일부러 뺀다 — 자료가 사라지는 지점은 표 쪽이고, 함께 알리면
  // 진짜 위험한 줄이 묻힌다.
});

test("열 삭제도 잡는다", () => {
  const sql = `ALTER TABLE "repair_cases" DROP COLUMN "legacy_report_number";`;
  assert.deepEqual(findDestructiveOperations(sql), [
    { kind: "DROP_COLUMN", table: "repair_cases", column: "legacy_report_number" },
  ]);
});

test("TRUNCATE와 DELETE도 잡는다", () => {
  const sql = `
    TRUNCATE TABLE "audit_logs";
    DELETE FROM "excel_import_rows" WHERE batch_id IS NULL;
  `;
  const kinds = findDestructiveOperations(sql).map((op) => op.kind).sort();
  assert.deepEqual(kinds, ["DELETE", "TRUNCATE"]);
});

test("주석 속 SQL은 진짜로 세지 않는다", () => {
  // 이 저장소의 마이그레이션에는 설명 주석이 붙는 일이 있다. 주석에 적힌
  // 예시를 실제 삭제로 읽으면 매번 헛경고가 뜨고, 헛경고는 곧 무시된다.
  const sql = `
    -- 예전에는 DROP TABLE "old_thing" 이었다
    /* DROP TABLE "another_thing" CASCADE; */
    CREATE TABLE "new_thing" ("id" uuid PRIMARY KEY);
  `;
  assert.deepEqual(findDestructiveOperations(sql), []);
});

test("같은 문장이 여러 번 나와도 한 번만 보고한다", () => {
  const sql = `DROP TABLE "a" CASCADE; DROP TABLE "a" CASCADE;`;
  assert.equal(findDestructiveOperations(sql).length, 1);
});

test("설명은 사람이 읽을 수 있는 한 줄이다", () => {
  assert.equal(describeOperation({ kind: "DROP_TABLE", table: "foo" }), "표 삭제: foo");
  assert.equal(
    describeOperation({ kind: "DROP_COLUMN", table: "foo", column: "bar" }),
    "열 삭제: foo.bar"
  );
});
