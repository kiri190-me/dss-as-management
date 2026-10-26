import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { getTableColumns } from "drizzle-orm";

import { findDestructiveOperations } from "../migration-safety";
import { approvalRouteDelegations } from "@/lib/db/schema";

/**
 * ============================================================================
 * 결재선 단계 위임의 바탕 — 어긋나도 아무 오류가 안 나는 것들을 못 박는다
 * ============================================================================
 * 0105(견적서 결재)·0037·0039·0077 이 세운 선례를 따른다: 스키마 쪽 결정 가운데
 * **틀려도 그 자리에서는 아무 일도 일어나지 않는 것**만 골라 파일 내용으로 고정한다.
 *
 * 여기서 지키는 것 일곱:
 *  1. 0119 는 **만들기만 한다** — 지우거나 기존 표를 고치는 문장이 하나도 없다.
 *  2. 🔴 **옛 `shipment_approval_delegations` 를 한 글자도 안 건드린다.** 이름이
 *     닮아서 다음 사람이 「정리」하려 들 가장 큰 후보가 그 표다. 둘은 쓰이는 조건이
 *     갈려 있어(표 머리말) 한쪽을 지우면 다른 쪽 기능이 사라진다.
 *  3. 🔴 **SQL 에 바인딩 자리표(`$1`)가 없다.** drizzle 의 `sql` 템플릿에 상수를 넣으면
 *     `CHECK ("id" = $1)` 같은 **돌릴 수 없는** 문장이 구워지는데, 생성은 조용히
 *     성공한다 — 적용하는 날에야 터진다. 이 저장소에서 실제로 겪었다.
 *  4. 🔴 **겹침을 막는 제약이 없다.** 같은 사람에게 기간이 겹치는 위임이 여럿 있는
 *     것은 **정상**이고(두 사람이 동시에 자리를 비울 수 있다), 중복 거르기는 판정
 *     함수가 한다. 유니크·EXCLUDE 가 슬그머니 들어오면 그때부터 정상 입력이 거절된다.
 *  5. 🔴 **사람 참조 넷이 전부 `ON DELETE restrict`** — 이 저장소의 사람 참조 관례다.
 *     cascade 로 바뀌면 사용자 하드 삭제 한 번에 위임 이력이 통째로 사라진다.
 *  6. 🔴 **판정 함수가 보는 칸 이름이 표에 실제로 있다.** 도메인 층은 db 층을 가져오지
 *     않아 모양이 두 벌로 적혀 있고(domain/approval-route-delegation.ts), 갈라져도
 *     `tsc` 는 아무 말도 하지 않는다.
 *  7. 🔴 **되돌림 두 칸이 짝으로 묶여 있다**(2026-10-26 사용자 승인). 판정 함수가
 *     `revoked_at` 한 칸만 보므로, 짝 CHECK 가 사라지면 「되돌렸는데 계속 살아 있는
 *     위임」이 조용히 만들어진다 — 맡긴 사람은 되돌렸다고 믿고, 대리인은 계속 누른다.
 * ============================================================================
 */

const MIGRATION_PATH = "drizzle/0119_approval_route_delegations.sql";
const migration = readFileSync(MIGRATION_PATH, "utf8").trim();

const statements = migration
  .split("--> statement-breakpoint")
  .map((statement) => statement.trim())
  .filter((statement) => statement !== "");

// ── 0119 가 무엇을 하는가 ────────────────────────────────────────────────

test("0119 는 만들기만 한다 — 지우거나 바꾸는 문장이 하나도 없다", () => {
  assert.deepEqual(findDestructiveOperations(migration), []);

  // 위 검사는 DROP/TRUNCATE/DELETE 를 찾는다. 여기서는 반대로 **허용하는 모양만**
  // 통과시킨다 — 새 표를 만드는 마이그레이션에 다른 종류의 문장이 섞여 들어오면
  // (기존 표의 칸을 고치는 ALTER 같은 것) 그 자체가 사고다.
  assert.ok(statements.length > 0);
  for (const statement of statements) {
    assert.match(
      statement,
      /^(?:CREATE TABLE "approval_route_delegations" \(|CREATE INDEX "approval_route_delegations_|ALTER TABLE "approval_route_delegations" ADD CONSTRAINT )/,
      `0119 에 만들기 아닌 문장이 있다: ${statement.slice(0, 80)}`
    );
  }
});

test("0119 가 만드는 표는 approval_route_delegations 하나뿐이다", () => {
  const created = [...migration.matchAll(/CREATE TABLE "([^"]+)"/g)].map((match) => match[1]);
  assert.deepEqual(created, ["approval_route_delegations"]);
});

test("🔴 0119 는 기존 표를 하나도 건드리지 않는다 — 특히 이름이 닮은 옛 위임 표", () => {
  // `users` 는 FK 가 가리키기만 한다(REFERENCES). ALTER 를 받는 쪽은 새 표뿐이다.
  const altered = [...migration.matchAll(/ALTER TABLE "([^"]+)"/g)].map((match) => match[1]);
  assert.deepEqual([...new Set(altered)], ["approval_route_delegations"]);

  for (const table of [
    "shipment_approval_delegations",
    "shipment_approval_routes",
    "shipment_approval_route_steps",
    "repair_case_approvals",
  ]) {
    assert.ok(!migration.includes(table), `0119 가 ${table} 를 언급한다`);
  }
});

test("🔴 SQL 에 바인딩 자리표가 남아 있지 않다 — 상수를 넣으면 $1 로 구워진다", () => {
  // 이 시험이 공짜로 통과하지 않게, 「자리표가 생길 수 있는 자리」가 실제로 있는지
  // 먼저 본다. 상수를 쓰는 곳은 CHECK 와 DEFAULT 다.
  assert.ok(migration.includes("CHECK ("), "CHECK 가 하나도 없다 — 표본이 틀렸다");
  assert.ok(migration.includes("DEFAULT ''"), "빈 글자 기본값이 사라졌다");
  assert.doesNotMatch(migration, /\$\d+/, "SQL 에 $1 같은 바인딩 자리표가 있다 — 적용할 수 없다");
});

// ── 제약과 색인 ──────────────────────────────────────────────────────────

test("🔴 CHECK 는 셋이고 이름이 옛 위임 표와 말을 맞춘다", () => {
  // 본문까지 한 정규식으로 잡지 않는다 — 되돌림 짝 CHECK 는 괄호가 겹쳐 있어
  // `[^)]*` 류가 가운데서 끊긴다. 이름은 여기서, 본문은 아래 시험들이 따로 본다.
  const names = [...migration.matchAll(/CONSTRAINT "([^"]+)" CHECK/g)].map((match) => match[1]);
  assert.deepEqual(names, [
    "approval_route_delegations_valid_range",
    "approval_route_delegations_different_users",
    "approval_route_delegations_revocation_metadata",
  ]);
  // 🔴 꼬리말(`_valid_range` · `_different_users` · `_revocation_metadata`)이 옛
  // `shipment_approval_delegations` 의 같은 제약들과 글자 그대로 같다. 하는 일이 같으면
  // 이름도 같아야 다음 사람이 둘을 한눈에 짝짓는다.
});

test("🔴 기간 CHECK 는 `>` 다 — `>=` 면 한순간도 살아 있지 않은 위임이 만들어진다", () => {
  assert.ok(
    migration.includes(
      `CONSTRAINT "approval_route_delegations_valid_range" CHECK (ends_at > starts_at)`
    ),
    "기간 CHECK 가 바뀌었다"
  );
  // 끝을 포함하지 않으므로 `ends_at = starts_at` 인 줄은 **단 한순간도 살아 있지 않은**
  // 위임이 되고, 만든 사람은 맡겨 뒀다고 믿는다.
  assert.doesNotMatch(migration, /ends_at >= starts_at/);
});

test("🔴 자기 자신을 대신할 수 없다", () => {
  assert.ok(
    migration.includes(
      `CONSTRAINT "approval_route_delegations_different_users" CHECK (delegate_user_id <> delegator_user_id)`
    ),
    "같은 사람 금지 CHECK 가 바뀌었다"
  );
});

test("🔴 되돌림 두 칸은 짝이다 — 한쪽만 적힌 줄을 DB 가 아예 못 만든다", () => {
  // 판정 함수는 `revoked_at` **한 칸만** 본다. 그래서 `revoked_by_user_id` 만 적힌 줄이
  // 들어오면 「되돌렸는데 계속 살아 있는 위임」이 된다 — 오류도 경고도 나지 않는다.
  // 코드를 두 칸 다 보게 고치는 대신 DB 가 그런 줄을 못 만들게 막은 것이 이 CHECK 다
  // (2026-10-26 사용자 승인). 그 판단이 통째로 사라지지 않게 본문을 못 박는다.
  const body = migration
    .slice(migration.indexOf(`"approval_route_delegations_revocation_metadata" CHECK`))
    .slice(0, 400)
    .replace(/\s+/g, " ");
  assert.ok(
    body.startsWith(
      `"approval_route_delegations_revocation_metadata" CHECK ( ` +
        `(revoked_at IS NULL AND revoked_by_user_id IS NULL) OR ` +
        `(revoked_at IS NOT NULL AND revoked_by_user_id IS NOT NULL) )`
    ),
    `되돌림 짝 CHECK 의 본문이 다르다: ${body.slice(0, 200)}`
  );
});

test("🔴 겹치는 기간을 막는 제약이 없다 — 겹침은 정상이고, 중복은 판정 함수가 거른다", () => {
  assert.doesNotMatch(migration, /CREATE UNIQUE INDEX/);
  assert.doesNotMatch(migration, /\bEXCLUDE\b/);
});

test("🔴 사람 참조 넷이 전부 ON DELETE restrict 다", () => {
  const fks = [...migration.matchAll(/FOREIGN KEY \("([^"]+)"\)[^;]*?ON DELETE (\w+)/g)].map(
    (match) => [match[1], match[2]] as const
  );
  assert.deepEqual(fks, [
    ["delegator_user_id", "restrict"],
    ["delegate_user_id", "restrict"],
    ["created_by_user_id", "restrict"],
    ["revoked_by_user_id", "restrict"],
  ]);
});

test("색인은 「내가 지금 누구를 대신하나」 하나뿐이고 칸 순서가 그 물음 순서다", () => {
  const indexes = [...migration.matchAll(/CREATE INDEX "([^"]+)"[^;]*?\(([^)]*)\)/g)].map(
    (match) => [match[1], match[2]] as const
  );
  assert.deepEqual(indexes, [
    [
      "approval_route_delegations_delegate_active_idx",
      `"delegate_user_id","revoked_at","ends_at"`,
    ],
  ]);
});

// ── 표 모양 ──────────────────────────────────────────────────────────────

test("🔴 판정 함수가 보는 칸 다섯이 표에 그 이름으로 있다", () => {
  // domain/approval-route-delegation.ts 의 ApprovalRouteDelegationPeriod 가 보는 것들.
  // 두 벌로 적혀 있고 갈라져도 tsc 는 침묵한다 — 여기가 그 둘을 맞대는 자리다.
  const columns = getTableColumns(approvalRouteDelegations);
  const dbNames = Object.fromEntries(
    Object.entries(columns).map(([key, column]) => [key, column.name])
  );
  assert.equal(dbNames.delegatorUserId, "delegator_user_id");
  assert.equal(dbNames.delegateUserId, "delegate_user_id");
  assert.equal(dbNames.startsAt, "starts_at");
  assert.equal(dbNames.endsAt, "ends_at");
  assert.equal(dbNames.revokedAt, "revoked_at");
});

test("🔴 널을 허락하는 칸은 되돌림 둘뿐이다 — 사유는 널 대신 빈 글자다", () => {
  const columns = getTableColumns(approvalRouteDelegations);
  const nullable = Object.entries(columns)
    .filter(([, column]) => !column.notNull)
    .map(([key]) => key)
    .sort();
  assert.deepEqual(nullable, ["revokedAt", "revokedByUserId"]);
});

test("소프트삭제 네 칸을 두지 않는다 — 되돌림이 그 자리를 대신한다", () => {
  const columnNames = Object.keys(getTableColumns(approvalRouteDelegations));
  for (const forbidden of ["isDeleted", "deletedAt", "deletedBy", "deleteReason"]) {
    assert.ok(!columnNames.includes(forbidden), `${forbidden} 가 들어왔다`);
  }
  // 「만료」도 저장하지 않는다 — 시간이 지나면 저절로 되는 것이라 칸에 적으면 낡는다.
  assert.ok(!columnNames.includes("status"), "status 칸이 들어왔다 — 만료는 읽을 때 계산한다");
});
