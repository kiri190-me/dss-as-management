import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { getTableColumns } from "drizzle-orm";

import { findDestructiveOperations } from "../migration-safety";
import { portalApprovalDelegations } from "@/lib/db/schema";

/**
 * ============================================================================
 * 포털이 써 주는 위임의 바탕 — 어긋나도 아무 오류가 안 나는 것들을 못 박는다
 * ============================================================================
 * 0119(결재선 단계 위임)가 세운 선례를 그대로 따른다: 스키마 쪽 결정 가운데
 * **틀려도 그 자리에서는 아무 일도 일어나지 않는 것**만 골라 파일 내용으로 고정한다.
 *
 * 여기서 지키는 것 일곱:
 *  1. 0129 는 **만들기만 한다** — 지우거나 기존 표를 고치는 문장이 하나도 없다.
 *  2. 🔴 **옆의 `approval_route_delegations` 를 한 글자도 안 건드린다.** 하는 일이
 *     닮아서 다음 사람이 「하나로 합치자」고 들 가장 큰 후보가 그 표다. 설계 B-4 가
 *     **둘 다 살려 두기로** 못 박았고, 둘은 만드는 사람도 되돌리는 자리도 다르다.
 *  3. 🔴 **`id` 에 기본값이 없다.** 번호의 주인은 포털이다(설계 B-12 의 5번). 여기서
 *     `defaultRandom()` 이 슬그머니 들어오면 **재시도마다 줄이 하나씩 늘고**(멱등이
 *     깨진다) 포털이 보낸 `revoke` 가 아무 줄도 못 찾는다 — 둘 다 **오류 없이** 그렇게
 *     된다.
 *  4. 🔴 **SQL 에 바인딩 자리표(`$1`)가 없다.** drizzle 의 `sql` 템플릿에 상수를 넣으면
 *     `CHECK ("id" = $1)` 같은 **돌릴 수 없는** 문장이 구워지는데, 생성은 조용히
 *     성공한다 — 적용하는 날에야 터진다. 이 저장소에서 실제로 겪었다.
 *  5. 🔴 **겹침을 막는 제약이 없다.** 겹치는 기간은 정상이고(옆 표와 같은 판단),
 *     게다가 여기서 거절하면 **전파가 실패해 지정 자체가 거절된다**(설계 B-13).
 *  6. 🔴 **사람 참조 둘이 전부 `ON DELETE restrict`** — 이 저장소의 사람 참조 관례다.
 *  7. 🔴 **「누가 세웠나·누가 거뒀나」 칸이 없다.** 그 사람은 A/S 계정이 아예 없을 수
 *     있고(승인함은 일곱 사이트의 사람을 본다), 빈 칸을 두면 「비어 있다」가 「본인이
 *     했다」로 읽히는 날이 온다. 칸이 생기면 그 판단이 조용히 뒤집힌 것이다.
 * ============================================================================
 */

const MIGRATION_PATH = "drizzle/0129_portal_approval_delegations.sql";
const migration = readFileSync(MIGRATION_PATH, "utf8").trim();

const statements = migration
  .split("--> statement-breakpoint")
  .map((statement) => statement.trim())
  .filter((statement) => statement !== "");

// ── 0129 가 무엇을 하는가 ────────────────────────────────────────────────

test("0129 는 만들기만 한다 — 지우거나 바꾸는 문장이 하나도 없다", () => {
  assert.deepEqual(findDestructiveOperations(migration), []);

  assert.ok(statements.length > 0);
  for (const statement of statements) {
    assert.match(
      statement,
      /^(?:CREATE TABLE "portal_approval_delegations" \(|CREATE INDEX "portal_approval_delegations_|ALTER TABLE "portal_approval_delegations" ADD CONSTRAINT )/,
      `0129 에 만들기 아닌 문장이 있다: ${statement.slice(0, 80)}`
    );
  }
});

test("0129 가 만드는 표는 portal_approval_delegations 하나뿐이다", () => {
  const created = [...migration.matchAll(/CREATE TABLE "([^"]+)"/g)].map((match) => match[1]);
  assert.deepEqual(created, ["portal_approval_delegations"]);
});

test("🔴 0129 는 기존 표를 하나도 건드리지 않는다 — 특히 하는 일이 닮은 옆 위임 표", () => {
  // `users` 는 FK 가 가리키기만 한다(REFERENCES). ALTER 를 받는 쪽은 새 표뿐이다.
  const altered = [...migration.matchAll(/ALTER TABLE "([^"]+)"/g)].map((match) => match[1]);
  assert.deepEqual([...new Set(altered)], ["portal_approval_delegations"]);

  for (const table of [
    "approval_route_delegations",
    "shipment_approval_delegations",
    "shipment_approval_routes",
    "shipment_approval_route_steps",
  ]) {
    assert.ok(!migration.includes(table), `0129 가 ${table} 를 언급한다`);
  }
});

test("🔴 SQL 에 바인딩 자리표가 남아 있지 않다 — 상수를 넣으면 $1 로 구워진다", () => {
  // 이 시험이 공짜로 통과하지 않게, 「자리표가 생길 수 있는 자리」가 실제로 있는지
  // 먼저 본다. 상수를 쓰는 곳은 CHECK 와 DEFAULT 다.
  assert.ok(migration.includes("CHECK ("), "CHECK 가 하나도 없다 — 표본이 틀렸다");
  assert.ok(migration.includes("DEFAULT ''"), "빈 글자 기본값이 사라졌다");
  assert.doesNotMatch(migration, /\$\d+/, "SQL 에 $1 같은 바인딩 자리표가 있다 — 적용할 수 없다");
});

// ── 번호의 주인 ──────────────────────────────────────────────────────────

test("🔴 id 에 기본값이 없다 — 번호는 포털이 정해 보낸다", () => {
  // SQL 쪽. 옆 표(0119)는 `"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL`
  // 이다 — 베껴 오면 여기 그 글자가 생긴다.
  assert.ok(
    migration.includes(`"id" uuid PRIMARY KEY NOT NULL`),
    "id 줄의 모양이 바뀌었다 — 기본값이 붙었는지 확인하라"
  );
  assert.doesNotMatch(migration, /gen_random_uuid\(\)/, "🔴 id 에 기본값이 생겼다");

  // 표 정의 쪽. SQL 은 이미 구워진 파일이라 스키마만 고치고 다시 안 구우면 둘이
  // 갈린다 — 그때 갈라지는 쪽이 여기다.
  const columns = getTableColumns(portalApprovalDelegations);
  assert.equal(columns.id.hasDefault, false, "🔴 스키마의 id 에 기본값이 생겼다");
  assert.equal(columns.id.primary, true, "id 가 기본키가 아니면 멱등이 깨진다");
});

// ── 제약과 색인 ──────────────────────────────────────────────────────────

test("🔴 CHECK 는 둘이고 이름이 옆 위임 표와 말을 맞춘다", () => {
  const names = [...migration.matchAll(/CONSTRAINT "([^"]+)" CHECK/g)].map((match) => match[1]);
  assert.deepEqual(names, [
    "portal_approval_delegations_valid_range",
    "portal_approval_delegations_different_users",
  ]);
  // 🔵 꼬리말(`_valid_range` · `_different_users`)이 `approval_route_delegations` 의
  // 같은 제약들과 글자 그대로 같다. 하는 일이 같으면 이름도 같아야 다음 사람이 둘을
  // 한눈에 짝짓는다. 🔴 되돌림 짝 CHECK(`_revocation_metadata`)는 **여기 없다** —
  // 거둔 사람을 적는 칸이 없기 때문이다(아래 「칸 모양」 시험).
});

test("🔴 기간 CHECK 는 `>` 다 — `>=` 면 한순간도 살아 있지 않은 위임이 만들어진다", () => {
  assert.ok(
    migration.includes(
      `CONSTRAINT "portal_approval_delegations_valid_range" CHECK (ends_at > starts_at)`
    ),
    "기간 CHECK 가 바뀌었다"
  );
  assert.doesNotMatch(migration, /ends_at >= starts_at/);
});

test("🔴 자기 자신을 대신할 수 없다", () => {
  assert.ok(
    migration.includes(
      `CONSTRAINT "portal_approval_delegations_different_users" CHECK (delegate_user_id <> delegator_user_id)`
    ),
    "같은 사람 금지 CHECK 가 바뀌었다"
  );
});

test("🔴 겹치는 기간을 막는 제약이 없다 — 거절하면 포털의 지정 자체가 거절된다", () => {
  assert.doesNotMatch(migration, /CREATE UNIQUE INDEX/);
  assert.doesNotMatch(migration, /\bEXCLUDE\b/);
});

test("🔴 사람 참조 둘이 전부 ON DELETE restrict 다", () => {
  const fks = [...migration.matchAll(/FOREIGN KEY \("([^"]+)"\)[^;]*?ON DELETE (\w+)/g)].map(
    (match) => [match[1], match[2]] as const
  );
  assert.deepEqual(fks, [
    ["delegator_user_id", "restrict"],
    ["delegate_user_id", "restrict"],
  ]);
});

test("색인은 「내가 지금 누구를 대신하나」 하나뿐이고 칸 순서가 그 물음 순서다", () => {
  const indexes = [...migration.matchAll(/CREATE INDEX "([^"]+)"[^;]*?\(([^)]*)\)/g)].map(
    (match) => [match[1], match[2]] as const
  );
  assert.deepEqual(indexes, [
    [
      "portal_approval_delegations_delegate_active_idx",
      `"delegate_user_id","revoked_at","ends_at"`,
    ],
  ]);
});

// ── 칸 모양 ──────────────────────────────────────────────────────────────

test("🔴 칸은 여덟이고 이름이 포털 규약과 짝이 맞는다", () => {
  const columns = getTableColumns(portalApprovalDelegations);
  const dbNames = Object.fromEntries(
    Object.entries(columns).map(([key, column]) => [key, column.name])
  );
  assert.deepEqual(Object.keys(dbNames).sort(), [
    "delegateUserId",
    "delegatorUserId",
    "endsAt",
    "id",
    "reason",
    "revokedAt",
    "startsAt",
    "syncedAt",
  ]);
  assert.equal(dbNames.delegatorUserId, "delegator_user_id");
  assert.equal(dbNames.delegateUserId, "delegate_user_id");
  assert.equal(dbNames.startsAt, "starts_at");
  assert.equal(dbNames.endsAt, "ends_at");
  assert.equal(dbNames.revokedAt, "revoked_at");
  assert.equal(dbNames.syncedAt, "synced_at");
});

test("🔴 「누가 세웠나·누가 거뒀나」 칸이 없다 — 그 사람은 A/S 계정이 없을 수 있다", () => {
  const columnNames = Object.keys(getTableColumns(portalApprovalDelegations));
  for (const forbidden of ["createdByUserId", "revokedByUserId"]) {
    assert.ok(!columnNames.includes(forbidden), `${forbidden} 가 들어왔다`);
  }
  // 소프트삭제 네 칸도 두지 않는다 — 되돌림이 그 자리를 대신한다(옆 표와 같다).
  for (const forbidden of ["isDeleted", "deletedAt", "deletedBy", "deleteReason"]) {
    assert.ok(!columnNames.includes(forbidden), `${forbidden} 가 들어왔다`);
  }
  // 「만료」도 저장하지 않는다 — 시간이 지나면 저절로 되는 것이라 칸에 적으면 낡는다.
  assert.ok(!columnNames.includes("status"), "status 칸이 들어왔다 — 만료는 읽을 때 계산한다");
  // 🔴 `scope` 도 없다(설계 B-8 — 위임은 그 시스템의 결재 전부에 적용된다).
  assert.ok(!columnNames.includes("scope"), "scope 칸이 들어왔다 — B-8 이 뒤집힌 것이다");
});

test("🔴 널을 허락하는 칸은 되돌림 하나뿐이다 — 사유는 널 대신 빈 글자다", () => {
  const columns = getTableColumns(portalApprovalDelegations);
  const nullable = Object.entries(columns)
    .filter(([, column]) => !column.notNull)
    .map(([key]) => key)
    .sort();
  assert.deepEqual(nullable, ["revokedAt"]);
});

test("🔴 synced_at 은 기본값이 있다 — 「언제 받았나」가 비는 줄이 없어야 어긋남 점검이 돈다", () => {
  const columns = getTableColumns(portalApprovalDelegations);
  assert.equal(columns.syncedAt.hasDefault, true);
  assert.ok(
    migration.includes(`"synced_at" timestamp with time zone DEFAULT now() NOT NULL`),
    "synced_at 의 모양이 바뀌었다"
  );
});
