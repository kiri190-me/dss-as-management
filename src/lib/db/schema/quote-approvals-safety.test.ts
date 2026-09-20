import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { getTableColumns } from "drizzle-orm";

import { findDestructiveOperations } from "../migration-safety";
import {
  approvalStatusEnum,
  quoteApprovals,
  quoteApprovalStatusEnum,
  shipmentApprovalRouteScopeEnum,
} from "@/lib/db/schema";

/**
 * ============================================================================
 * 견적서 결재의 바탕 — 어긋나도 아무 오류가 안 나는 것들을 못 박는다
 * ============================================================================
 * 0037·0039·0077 시험이 세운 선례를 따른다: 스키마 쪽 결정 가운데 **틀려도 그
 * 자리에서는 아무 일도 일어나지 않는 것**만 골라 파일 내용으로 고정한다.
 *
 * 여기서 지키는 것 다섯:
 *  1. 0105 는 **만들기만 한다** — 지우거나 기존 표를 고치는 문장이 하나도 없다.
 *  2. 🔴 **`quotes` 표를 건드리지 않는다** — 결재 상태는 새 표에서 읽는다는
 *     설계가 SQL 에서도 지켜졌는가. 칸을 더하면 적용 전까지 개발 서버가 깨진다.
 *  3. 🔴 **용도에 더한 값은 'QUOTE' 하나이고 맨 끝이다** — ADD VALUE 는 언제나
 *     뒤에 붙으므로, 배열 순서가 어긋나면 다음 db:generate 가 있지도 않은 차이를
 *     감지한다.
 *  4. 🔴 **결재 상태는 수리 건 결재와 글자 그대로 같은 셋이다** — 값을 늘리지
 *     않겠다는 판단(CHANGES_REQUESTED · CANCELLED 를 뺀 그 판단)을 지킨다.
 *  5. 🔴 **version 스냅샷 칸이 NOT NULL 이고 기본값이 없다** — 「승인 뒤 내용이
 *     바뀌면 그 승인은 무효」가 이 칸 하나에 걸려 있다.
 * ============================================================================
 */

const MIGRATION_PATH = "drizzle/0105_quote_approval_foundation.sql";
const migration = readFileSync(MIGRATION_PATH, "utf8").trim();

const statements = migration
  .split("--> statement-breakpoint")
  .map((statement) => statement.trim())
  .filter((statement) => statement !== "");

// ── 0105 가 무엇을 하는가 ────────────────────────────────────────────────

test("0105 는 만들기만 한다 — 지우거나 바꾸는 문장이 하나도 없다", () => {
  assert.deepEqual(findDestructiveOperations(migration), []);

  // 위 검사는 DROP/TRUNCATE/DELETE 를 찾는다. 여기서는 반대로 **허용하는 모양만
  // 통과**시킨다 — 새 표를 만드는 마이그레이션에 다른 종류의 문장이 섞여 들어오면
  // (기존 표의 열을 고치는 ALTER 같은 것) 그 자체가 사고다.
  assert.ok(statements.length > 0);
  for (const statement of statements) {
    assert.match(
      statement,
      /^(?:CREATE TYPE|CREATE TABLE|CREATE INDEX|CREATE UNIQUE INDEX|ALTER TYPE "public"\."shipment_approval_route_scope" ADD VALUE|ALTER TABLE "quote_approvals" ADD CONSTRAINT)\b/,
      `0105 에 만들기 아닌 문장이 있다: ${statement.slice(0, 80)}`
    );
  }
});

test("0105 가 만드는 표는 quote_approvals 하나뿐이다", () => {
  const created = [...migration.matchAll(/CREATE TABLE "([^"]+)"/g)].map((match) => match[1]);
  assert.deepEqual(created, ["quote_approvals"]);
});

test("🔴 0105 는 quotes 표를 건드리지 않는다 — 결재 상태는 새 표에서 읽는다", () => {
  // 이 저장소는 select() 전체 조회가 새 칸을 곧바로 싣는다. quotes 에 칸이
  // 더해지면 마이그레이션을 적용하기 전까지 개발 서버가 깨진다 — 그 사고를
  // 리뷰가 아니라 시험으로 막는다.
  assert.doesNotMatch(migration, /ALTER TABLE "quotes"/);
});

// ── 용도(scope) 한 값 ────────────────────────────────────────────────────

test("🔴 0105 가 용도에 더하는 값은 'QUOTE' 하나다", () => {
  const added = [...migration.matchAll(/ADD VALUE '([^']+)'/g)].map((match) => match[1]);
  assert.deepEqual(added, ["QUOTE"]);
});

test("🔴 용도 목록에서 'QUOTE' 는 맨 끝에 한 번만 있다", () => {
  // ADD VALUE 는 기존 값 **뒤에** 붙는다. 배열에서 가운데에 끼워 넣으면 코드와
  // 실제 DB 의 순서가 어긋나고, 다음 db:generate 가 있지도 않은 차이를 만든다.
  const values = [...shipmentApprovalRouteScopeEnum.enumValues];
  assert.deepEqual(values, ["FINAL_SHIPMENT", "PART_ISSUE", "QUOTE"]);
  assert.equal(values.filter((value) => value === "QUOTE").length, 1);
});

// ── 결재 상태 셋 ─────────────────────────────────────────────────────────

test("🔴 견적서 결재의 상태는 수리 건 결재와 글자 그대로 같은 셋이다", () => {
  // 값을 여기 베껴 적지 않고 **두 enum 을 서로 견준다** — 세 곳이 되면 두 곳만
  // 고쳐졌을 때 시험이 오히려 틀린 쪽 편을 든다.
  assert.deepEqual(
    [...quoteApprovalStatusEnum.enumValues],
    [...approvalStatusEnum.enumValues]
  );
});

test("🔴 CHANGES_REQUESTED · CANCELLED 를 들이지 않는다 — 반려는 새 줄로 다시 요청한다", () => {
  // repair_case_approvals 가 같은 판단을 이미 내렸고, 그 이유(반려된 건은 새 줄로
  // 다시 요청하면 되므로 같은 필요를 덮는다)가 견적서에도 그대로 적용된다.
  // enum 값은 나중에 뺄 수 없으므로 들어오는 것 자체를 막는다.
  for (const forbidden of ["CHANGES_REQUESTED", "CANCELLED"]) {
    assert.ok(
      !(quoteApprovalStatusEnum.enumValues as readonly string[]).includes(forbidden),
      `${forbidden} 가 들어왔다`
    );
  }
});

// ── 표의 모양 ────────────────────────────────────────────────────────────

test("🔴 quote_version_at_request 는 NOT NULL 이고 기본값이 없다", () => {
  // 「승인 뒤 견적서 내용이 바뀌면 그 승인은 무효」가 이 칸 하나에 걸려 있다.
  // 기본값을 두면 version 을 싣지 않은 요청이 조용히 「1판에 대한 승인」이 되고,
  // 그러면 금액을 고친 뒤에도 옛 승인이 살아 있게 된다.
  assert.equal(quoteApprovals.quoteVersionAtRequest.notNull, true);
  assert.equal(quoteApprovals.quoteVersionAtRequest.hasDefault, false);
});

test("🔴 quote_id 는 NULL 을 허용하고 SET NULL 로 끊긴다 — 견적서 완전 삭제를 막지 않는다", () => {
  // 견적서는 휴지통에서 완전 삭제될 수 있고 보관기간이 지나면 자동으로도 지워진다.
  // NOT NULL·RESTRICT 로 두면 그 두 길이 DB 에서 막힌다. 연결이 풀려도 이 줄의
  // 상태·결정 칸은 「누가 언제 무엇을 결정했나」를 그대로 지킨다.
  assert.equal(quoteApprovals.quoteId.notNull, false);
  assert.match(
    migration,
    /"quote_approvals_quote_id_quotes_id_fk" FOREIGN KEY \("quote_id"\) REFERENCES "public"\."quotes"\("id"\) ON DELETE set null/
  );
});

test("🔴 소프트삭제 네 칸을 두지 않는다 — 결재 결정은 고치지도 지우지도 않는다", () => {
  const columnNames = Object.keys(getTableColumns(quoteApprovals));
  for (const forbidden of ["isDeleted", "deletedAt", "deletedBy", "deleteReason"]) {
    assert.ok(!columnNames.includes(forbidden), `${forbidden} 가 들어왔다`);
  }
});
