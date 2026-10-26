import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { getTableColumns } from "drizzle-orm";

import { findDestructiveOperations } from "../migration-safety";
import { quoteApprovals, repairCaseApprovals } from "@/lib/db/schema";

/**
 * ============================================================================
 * 견적서 결재의 「누구 자리였나」 칸 — 어긋나도 아무 오류가 안 나는 것들
 * ============================================================================
 * 0105(견적서 결재)·0119(결재선 단계 위임)가 세운 선례를 따른다: 스키마 쪽 결정
 * 가운데 **틀려도 그 자리에서는 아무 일도 일어나지 않는 것**만 골라 못 박는다.
 *
 * 0120 은 **칸 하나를 더하는 마이그레이션**이다. 이 저장소에서 그것이 특히 조용히
 * 위험한 까닭이 있다 — `select()` 전체 조회가 새 칸을 곧바로 싣기 때문에, 엉뚱한
 * 표에 칸이 더해지면 **적용 전까지 개발 서버가 깨진다**(0105 시험의 같은 자리).
 *
 * 여기서 지키는 것 넷:
 *  1. 0120 은 **두 문장뿐**이다 — 칸 하나와 그 FK. 지우거나 바꾸는 문장이 없다.
 *  2. 🔴 **`quote_approvals` 말고 어떤 표도 건드리지 않는다.** 특히 `users` 는
 *     가리키기만(REFERENCES) 한다.
 *  3. 🔴 칸이 **nullable** 이고 FK 가 **ON DELETE restrict** 다. NULL 이 정상값이고
 *     뜻이 있다(「직접 눌렀다」) — NOT NULL 이면 이 칸이 생기기 전에 쌓인 결재
 *     기록을 아예 못 읽고, cascade 면 맡긴 사람이 지워지면서 「누구 자리였는지 알
 *     수 없는 줄」이 남는다.
 *  4. 🔴 **옆 표(`repair_case_approvals`)의 같은 칸과 모양이 어긋나지 않는다.**
 *     값을 베껴 적지 않고 **두 스키마 객체를 맞대어** 본다 — 베껴 적으면 세 곳이
 *     되고, 두 곳만 고쳐졌을 때 시험이 오히려 틀린 쪽 편을 든다(0105 시험이 결재
 *     상태 enum 둘을 맞대는 것과 같은 수법).
 *
 * 🔵 같은 사실을 두 결재가 다른 모양으로 적기 시작하면 화면·조회·알림이 결재
 * 종류마다 갈라진다. 실제로 이 칸을 읽는 코드는 한 벌이 아니다 — 출하 승인은
 * queries/repair-case-approvals.ts 가, 견적서는 결재 mutation 이 쓴다.
 * ============================================================================
 */

const MIGRATION_PATH = "drizzle/0120_quote_approval_delegated_from.sql";
const migration = readFileSync(MIGRATION_PATH, "utf8").trim();

const statements = migration
  .split("--> statement-breakpoint")
  .map((statement) => statement.trim())
  .filter((statement) => statement !== "");

/** 두 표에서 같은 뜻의 칸 — 이름을 글자로 적는 자리는 여기 한 곳뿐이다. */
const COLUMN_NAME = "delegated_from_user_id";

// ── 0120 이 무엇을 하는가 ────────────────────────────────────────────────

test("0120 은 칸 하나와 그 FK, **두 문장뿐**이다", () => {
  assert.deepEqual(findDestructiveOperations(migration), []);

  // 위 검사는 DROP/TRUNCATE/DELETE 를 찾는다. 여기서는 반대로 **허용하는 모양만**
  // 통과시킨다 — 칸을 더하는 마이그레이션에 다른 종류의 문장이 섞여 들어오면
  // (기존 칸을 고치는 ALTER … ALTER COLUMN 같은 것) 그 자체가 사고다.
  assert.equal(statements.length, 2, `0120 의 문장 수가 둘이 아니다: ${statements.length}`);
  assert.match(statements[0], /^ALTER TABLE "quote_approvals" ADD COLUMN "delegated_from_user_id" uuid;?$/);
  assert.match(
    statements[1],
    /^ALTER TABLE "quote_approvals" ADD CONSTRAINT "quote_approvals_delegated_from_user_id_users_id_fk" FOREIGN KEY/
  );
});

test("🔴 0120 은 quote_approvals 말고 어떤 표도 건드리지 않는다", () => {
  // `users` 는 FK 가 가리키기만 한다(REFERENCES). ALTER 를 받는 쪽은 하나뿐이다.
  const altered = [...migration.matchAll(/ALTER TABLE "([^"]+)"/g)].map((match) => match[1]);
  assert.deepEqual([...new Set(altered)], ["quote_approvals"]);

  // 표를 만들지도 지우지도 않는다 — 0120 은 칸만 더한다.
  assert.doesNotMatch(migration, /CREATE TABLE/);

  // 이름이 닮아 「정리」의 후보가 되는 표들. 0120 에 한 글자도 나오면 안 된다.
  for (const table of [
    "repair_case_approvals",
    "inventory_part_issue_approvals",
    "approval_route_delegations",
    "shipment_approval_delegations",
    "quotes",
  ]) {
    assert.ok(!migration.includes(table), `0120 이 ${table} 를 언급한다`);
  }
});

test("🔴 칸은 nullable 이고 FK 는 ON DELETE restrict 다", () => {
  // SQL 쪽 — `uuid` 뒤에 NOT NULL 도 DEFAULT 도 붙지 않는다.
  assert.doesNotMatch(migration, /"delegated_from_user_id" uuid[^;]*NOT NULL/);
  assert.doesNotMatch(migration, /"delegated_from_user_id" uuid[^;]*DEFAULT/);
  const fks = [...migration.matchAll(/FOREIGN KEY \("([^"]+)"\)[^;]*?ON DELETE (\w+)/g)].map(
    (match) => [match[1], match[2]] as const
  );
  assert.deepEqual(fks, [[COLUMN_NAME, "restrict"]]);

  // 스키마 객체 쪽 — 둘이 어긋나면 다음 db:generate 가 있지도 않은 차이를 만든다.
  assert.equal(quoteApprovals.delegatedFromUserId.name, COLUMN_NAME);
  assert.equal(quoteApprovals.delegatedFromUserId.notNull, false);
  assert.equal(quoteApprovals.delegatedFromUserId.hasDefault, false);
});

// ── 옆 표와 맞대기 ───────────────────────────────────────────────────────

test("🔴 옆 표(repair_case_approvals)의 같은 칸과 모양이 어긋나지 않는다", () => {
  // 🔵 이 시험이 **표본이 비어서 공짜로 통과하지 않게** 먼저 둘이 실재하는지 본다.
  // 칸 이름이 바뀌면 아래 비교가 `undefined === undefined` 로 조용히 통과한다.
  const quoteColumns = getTableColumns(quoteApprovals);
  const repairColumns = getTableColumns(repairCaseApprovals);
  assert.ok(quoteColumns.delegatedFromUserId, "견적서 결재에 그 칸이 없다 — 시험의 전제가 사라졌다");
  assert.ok(repairColumns.delegatedFromUserId, "접수 건 결재에 그 칸이 없다 — 시험의 전제가 사라졌다");

  // 값을 베껴 적지 않고 **둘을 서로 견준다**. 어느 한쪽만 바뀌면 여기서 걸린다.
  //
  // 🔵 인자 타입을 한쪽 표의 칸으로 적을 수 없다 — drizzle 의 칸 타입에는 표 이름이
  // 들어 있어 다른 표의 칸이 통째로 거절된다(그것이 곧 이 시험이 필요한 까닭이기도
  // 하다). 그래서 **견줄 다섯 값의 모양만** 받는다.
  const shapeOf = (column: {
    name: string;
    dataType: string;
    columnType: string;
    notNull: boolean;
    hasDefault: boolean;
    primary: boolean;
  }) => ({
    name: column.name,
    dataType: column.dataType,
    columnType: column.columnType,
    notNull: column.notNull,
    hasDefault: column.hasDefault,
    primary: column.primary,
  });
  assert.deepEqual(
    shapeOf(quoteColumns.delegatedFromUserId),
    shapeOf(repairColumns.delegatedFromUserId),
    "두 결재의 「누구 자리였나」 칸이 서로 다른 모양이 됐다"
  );
});

test("🔴 「누가 눌렀나」 칸도 둘이 같은 모양이다 — 한 쌍으로 읽히는 두 칸이다", () => {
  // `delegated_from_user_id` 는 혼자서는 뜻이 없다. 「B 가 A 를 대신해 승인했다」는
  // `decided_by_user_id` 와 **함께** 읽어야만 복원된다(2026-10-20 사용자 결정).
  // 한쪽 칸만 모양을 맞춰 두면 그 짝이 표마다 달라질 수 있다.
  const quoteColumns = getTableColumns(quoteApprovals);
  const repairColumns = getTableColumns(repairCaseApprovals);
  assert.equal(quoteColumns.decidedByUserId.name, repairColumns.decidedByUserId.name);
  assert.equal(quoteColumns.decidedByUserId.notNull, repairColumns.decidedByUserId.notNull);
  // 🔴 둘 다 nullable 이어야 한다 — 아직 결정되지 않은 행이 정상이다.
  assert.equal(quoteColumns.decidedByUserId.notNull, false);
});
