import { test } from "node:test";
import assert from "node:assert/strict";

import {
  findDestructiveOperations,
  describeOperation,
  findRiskyOperations,
  describeRiskyOperation,
} from "./migration-safety";

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

/**
 * 0029(2026)가 실제로 이 모양이었다. 위쪽에서 새 표를 만들고 손보는 문장이
 * 이어지다가, 맨 아래에서 **다른 표의** 칸 둘을 지운다.
 *
 * 점검은 위쪽 표의 이름을 아래쪽 열 삭제에 붙여 보고했다. 부르는 쪽은 받은
 * 이름으로 행을 세므로, 엉뚱한 표를 세고 정작 사라지는 표는 한 번도 세지 않는다.
 * 잘못 붙은 표가 비어 있었다면 "비어 있음"이라는 거짓 안심까지 나온다.
 *
 * 파일을 읽지 않고 글자로 박아 둔다. 시험이 drizzle 폴더의 파일 존재에 매이면
 * 나중에 그 파일이 정리되는 순간 회귀 가드가 조용히 사라진다.
 */
const MIGRATION_0029 = `
CREATE TABLE "end_user_contacts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"end_user_id" uuid NOT NULL,
	"contact_name" text NOT NULL,
	"contact_email" text
);
--> statement-breakpoint
ALTER TABLE "end_user_contacts" ADD CONSTRAINT "end_user_contacts_end_user_id_end_users_id_fk" FOREIGN KEY ("end_user_id") REFERENCES "public"."end_users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "end_user_contacts_end_user_id_idx" ON "end_user_contacts" USING btree ("end_user_id");--> statement-breakpoint

INSERT INTO "end_user_contacts" ("end_user_id", "contact_name", "contact_email")
SELECT "id", "contact_name", "contact_email"
FROM "end_users"
WHERE "contact_name" IS NOT NULL OR "contact_email" IS NOT NULL;--> statement-breakpoint

ALTER TABLE "end_users" DROP COLUMN "contact_name";--> statement-breakpoint
ALTER TABLE "end_users" DROP COLUMN "contact_email";
`;

test("0029의 열 삭제는 둘 다 end_users로 보고된다 — 앞 문장의 표 이름이 붙지 않는다", () => {
  assert.deepEqual(findDestructiveOperations(MIGRATION_0029), [
    { kind: "DROP_COLUMN", table: "end_users", column: "contact_name" },
    { kind: "DROP_COLUMN", table: "end_users", column: "contact_email" },
  ]);
});

test("0029에서 새로 만드는 표는 지우는 문장으로 세지 않는다", () => {
  // 외래키 구절의 ON DELETE restrict도, 새 표를 만들고 손보는 문장도 이쪽
  // 갈래에서는 아무것도 아니다. 둘째 갈래와도 겹치지 않는다.
  assert.deepEqual(findRiskyOperations(MIGRATION_0029), []);
});

test("한 문장이 칸을 여럿 지워도 전부 같은 표로 잡는다", () => {
  // 지금 drizzle 폴더에는 이 모양이 없다. 나중에 생겼을 때 표 이름이 어긋나지
  // 않도록 미리 못 박아 둔다.
  const sql = `ALTER TABLE "t" DROP COLUMN "a", DROP COLUMN "b";`;
  assert.deepEqual(findDestructiveOperations(sql), [
    { kind: "DROP_COLUMN", table: "t", column: "a" },
    { kind: "DROP_COLUMN", table: "t", column: "b" },
  ]);
});

test("열 삭제에 붙는 IF EXISTS·따옴표·스키마 접두사는 지금처럼 다룬다", () => {
  const sql = `ALTER TABLE IF EXISTS "public"."repair_cases" DROP COLUMN IF EXISTS "legacy_report_number";`;
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

// ── 둘째 갈래 — 자료는 그대로지만 살펴봐야 하는 문장 ─────────────────────

/**
 * 0089(2026-09-10)가 실제로 이 모양이었다. 이 마이그레이션은 유니크 인덱스를
 * 하나 없애고 하나 만드는데, 점검은 "더하기만 합니다"라고 답했다 — 그래서 이
 * 갈래가 생겼다.
 *
 * 파일을 읽지 않고 글자로 박아 둔다. 시험이 drizzle 폴더의 파일 존재에 매이면
 * 나중에 그 파일이 정리되는 순간 회귀 가드가 조용히 사라진다.
 */
const MIGRATION_0089 = `
CREATE TYPE "public"."shipment_approval_route_scope" AS ENUM('FINAL_SHIPMENT', 'PART_ISSUE');--> statement-breakpoint
DROP INDEX "shipment_approval_routes_version_unique";--> statement-breakpoint
-- 손으로 고친 곳 (2026-09-10). drizzle-kit 이 낸 원본은 아래 한 줄이었다:
--   ALTER TABLE "shipment_approval_routes" ADD COLUMN "scope" ... NOT NULL;
-- 이 표에는 이미 판 3개가 들어 있어서 그대로 두면 NOT NULL 위반으로 적용이
-- 실패한다. 그래서 두 걸음으로 나눈다.
ALTER TABLE "shipment_approval_routes" ADD COLUMN "scope" "shipment_approval_route_scope" DEFAULT 'FINAL_SHIPMENT' NOT NULL;--> statement-breakpoint
ALTER TABLE "shipment_approval_routes" ALTER COLUMN "scope" DROP DEFAULT;--> statement-breakpoint
CREATE UNIQUE INDEX "shipment_approval_routes_scope_version_unique" ON "shipment_approval_routes" USING btree ("scope","version");
`;

test("0089는 더 이상 '더하기만'으로 읽히지 않는다 — 유니크 인덱스가 갈린다", () => {
  assert.deepEqual(findRiskyOperations(MIGRATION_0089), [
    { kind: "DROP_INDEX", index: "shipment_approval_routes_version_unique" },
  ]);
});

test("0089의 설명 주석에 적힌 예시 문장은 세지 않는다", () => {
  // 주석에는 손으로 고치기 전의 원본 한 줄이 글자 그대로 남아 있다. 그것을
  // 진짜 문장으로 세면 매번 헛경고가 뜨고, 헛경고는 곧 무시된다.
  const kinds = findRiskyOperations(MIGRATION_0089).map((op) => op.kind);
  assert.deepEqual(kinds, ["DROP_INDEX"]);
});

test("0089는 자료를 지우지는 않는다 — 두 갈래가 서로 겹치지 않는다", () => {
  assert.deepEqual(findDestructiveOperations(MIGRATION_0089), []);
});

test("진짜 더하기만 하는 마이그레이션은 새 갈래에서도 조용하다", () => {
  // 0086·0087·0088이 이 모양이었다. 경고가 잡음이 되면 아무도 보지 않는다.
  const sql = `
    CREATE TABLE "shipment_approval_routes" (
      "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
      "version" integer NOT NULL,
      CONSTRAINT "shipment_approval_route_steps_step_order_positive" CHECK (step_order >= 1)
    );
    --> statement-breakpoint
    ALTER TABLE "repair_case_approvals" ADD COLUMN "route_id" uuid;--> statement-breakpoint
    ALTER TABLE "repair_case_approvals" ADD CONSTRAINT "repair_case_approvals_route_columns_together" CHECK ((route_id IS NULL AND route_step_order IS NULL) OR (route_id IS NOT NULL AND route_step_order IS NOT NULL));--> statement-breakpoint
    CREATE UNIQUE INDEX "shipment_approval_routes_version_unique" ON "shipment_approval_routes" USING btree ("version");
  `;
  assert.deepEqual(findRiskyOperations(sql), []);
  assert.deepEqual(findDestructiveOperations(sql), []);
});

test("외래키 구절의 ON DELETE는 삭제로 읽지 않는다", () => {
  // 0086·0087·0009에 이 세 가지가 전부 실제로 들어 있다.
  const sql = `
    ALTER TABLE "shipment_approval_route_steps" ADD CONSTRAINT "fk_a" FOREIGN KEY ("route_id") REFERENCES "public"."shipment_approval_routes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
    ALTER TABLE "shipment_approval_route_steps" ADD CONSTRAINT "fk_b" FOREIGN KEY ("approver_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
    ALTER TABLE "procedure_validation_resolution_history" ADD CONSTRAINT "fk_c" FOREIGN KEY ("affected_edge_id") REFERENCES "public"."procedure_template_edges"("id") ON DELETE set null ON UPDATE no action;
  `;
  assert.deepEqual(findRiskyOperations(sql), []);
  assert.deepEqual(findDestructiveOperations(sql), []);
});

test("제약을 떼는 문장을 표 이름과 함께 잡는다", () => {
  // 0074가 실제로 이 모양이었다.
  const sql = `ALTER TABLE "oh_part_templates" DROP CONSTRAINT "oh_part_templates_overhaul_labor_cost_not_negative";`;
  assert.deepEqual(findRiskyOperations(sql), [
    {
      kind: "DROP_CONSTRAINT",
      table: "oh_part_templates",
      constraint: "oh_part_templates_overhaul_labor_cost_not_negative",
    },
  ]);
});

test("기본값이나 빈 값 허용을 떼는 것은 제약 삭제가 아니다", () => {
  const sql = `
    ALTER TABLE "a" ALTER COLUMN "x" DROP DEFAULT;
    ALTER TABLE "a" ALTER COLUMN "y" DROP NOT NULL;
  `;
  assert.deepEqual(findRiskyOperations(sql), []);
});

test("빈 값을 막는 전환을 잡는다 — 기존 행이 있으면 적용이 통째로 실패한다", () => {
  // 0016·0018이 실제로 이 모양이었다.
  const sql = `
    ALTER TABLE "procedure_templates" ALTER COLUMN "category" SET NOT NULL;--> statement-breakpoint
    ALTER TABLE "procedure_case_executions" ALTER COLUMN "template_category" SET NOT NULL;
  `;
  assert.deepEqual(findRiskyOperations(sql), [
    { kind: "SET_NOT_NULL", table: "procedure_templates", column: "category" },
    { kind: "SET_NOT_NULL", table: "procedure_case_executions", column: "template_category" },
  ]);
});

test("표와 칸의 이름 변경을 가려서 잡는다", () => {
  const sql = `
    ALTER TABLE "old_cases" RENAME TO "repair_cases";--> statement-breakpoint
    ALTER TABLE "repair_cases" RENAME COLUMN "legacy_no" TO "report_number";
  `;
  assert.deepEqual(findRiskyOperations(sql), [
    { kind: "RENAME_TABLE", table: "old_cases", to: "repair_cases" },
    {
      kind: "RENAME_COLUMN",
      table: "repair_cases",
      column: "legacy_no",
      to: "report_number",
    },
  ]);
});

test("자료형 변경을 잡는다 — 두 가지 문법 모두", () => {
  const sql = `
    ALTER TABLE "quotes" ALTER COLUMN "note" TYPE varchar(64);--> statement-breakpoint
    ALTER TABLE "quotes" ALTER COLUMN "amount" SET DATA TYPE numeric;
  `;
  assert.deepEqual(findRiskyOperations(sql), [
    { kind: "CHANGE_COLUMN_TYPE", table: "quotes", column: "note", to: "varchar(64)" },
    { kind: "CHANGE_COLUMN_TYPE", table: "quotes", column: "amount", to: "numeric" },
  ]);
});

test("타입 삭제도 살펴볼 것으로 잡는다 — 쓰는 칸이 남아 있으면 적용이 실패한다", () => {
  // 0044가 실제로 이 모양이었다. 위 갈래는 여기서 표 삭제만 보고하고, 타입은
  // 이쪽에서 따로 보인다.
  const sql = `
    DROP TABLE "excel_import_rows" CASCADE;--> statement-breakpoint
    DROP TYPE "public"."excel_import_row_status";
  `;
  assert.deepEqual(findRiskyOperations(sql), [
    { kind: "DROP_TYPE", type: "excel_import_row_status" },
  ]);
  assert.deepEqual(findDestructiveOperations(sql), [
    { kind: "DROP_TABLE", table: "excel_import_rows" },
  ]);
});

test("enum 값 추가는 새 갈래에서도 걸리지 않는다", () => {
  const sql = `ALTER TYPE "public"."inventory_part_request_status" ADD VALUE 'ON_HOLD';`;
  assert.deepEqual(findRiskyOperations(sql), []);
});

test("주석 속 문장은 새 갈래에서도 세지 않는다", () => {
  const sql = `
    -- 예전에는 DROP INDEX "old_idx" 였다
    /* ALTER TABLE "t" DROP CONSTRAINT "old_check"; */
    CREATE UNIQUE INDEX "new_idx" ON "t" USING btree ("a");
  `;
  assert.deepEqual(findRiskyOperations(sql), []);
});

test("앞 문장의 표 이름이 뒷 문장의 동작에 붙지 않는다", () => {
  const sql = `
    ALTER TABLE "repair_cases" ADD COLUMN "note" text;--> statement-breakpoint
    ALTER TABLE "status_change_histories" DROP CONSTRAINT "status_change_histories_repair_case_id_repair_cases_id_fk";
  `;
  assert.deepEqual(findRiskyOperations(sql), [
    {
      kind: "DROP_CONSTRAINT",
      table: "status_change_histories",
      constraint: "status_change_histories_repair_case_id_repair_cases_id_fk",
    },
  ]);
});

test("한 문장에 동작이 여럿이면 전부 잡는다", () => {
  const sql = `ALTER TABLE "t" ALTER COLUMN "a" SET NOT NULL, ALTER COLUMN "b" SET NOT NULL;`;
  assert.deepEqual(findRiskyOperations(sql), [
    { kind: "SET_NOT_NULL", table: "t", column: "a" },
    { kind: "SET_NOT_NULL", table: "t", column: "b" },
  ]);
});

test("같은 문장이 여러 번 나와도 한 번만 보고한다 — 새 갈래도", () => {
  const sql = `DROP INDEX "idx_a";--> statement-breakpoint
DROP INDEX "idx_a";`;
  assert.equal(findRiskyOperations(sql).length, 1);
});

test("살펴볼 것의 설명도 대상 이름까지 담은 한 줄이다", () => {
  assert.equal(
    describeRiskyOperation({ kind: "DROP_INDEX", index: "foo_unique" }),
    "인덱스 삭제: foo_unique"
  );
  assert.equal(
    describeRiskyOperation({ kind: "DROP_CONSTRAINT", table: "foo", constraint: "bar_check" }),
    "제약 삭제: foo.bar_check"
  );
  assert.equal(
    describeRiskyOperation({ kind: "SET_NOT_NULL", table: "foo", column: "bar" }),
    "필수값 전환: foo.bar"
  );
  assert.equal(
    describeRiskyOperation({ kind: "RENAME_TABLE", table: "foo", to: "baz" }),
    "표 이름 변경: foo → baz"
  );
  assert.equal(
    describeRiskyOperation({ kind: "RENAME_COLUMN", table: "foo", column: "bar", to: "baz" }),
    "열 이름 변경: foo.bar → baz"
  );
  assert.equal(
    describeRiskyOperation({ kind: "CHANGE_COLUMN_TYPE", table: "foo", column: "bar", to: "text" }),
    "열 자료형 변경: foo.bar → text"
  );
  assert.equal(
    describeRiskyOperation({ kind: "DROP_TYPE", type: "foo_status" }),
    "타입 삭제: foo_status"
  );
});
