import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { customers } from "@/lib/db/schema";
import { CUSTOMER_PORTAL_FORMS } from "@/lib/domain/customer-portal-forms";
import { normalizeEntityName } from "@/lib/domain/entity-name-match";

import { findDestructiveOperations, findRiskyOperations } from "../migration-safety";

/**
 * ============================================================================
 * 0116 — 고객사에 「어느 양식인가」 칸을 더하고, 아는 이름으로 채운다
 * ============================================================================
 * 0037·0039·0077·0105 가 세운 선례를 따른다: 스키마 쪽 결정 가운데 **틀려도 그
 * 자리에서는 아무 오류가 나지 않는 것**만 골라 파일 내용으로 못 박는다.
 *
 * 🔴 이 마이그레이션에서 조용히 틀릴 수 있는 것은 **채우는 이름 목록**이다.
 * 코드(customer-portal-forms.ts 의 customerNames)와 SQL 이 어긋나면, 어긋난
 * 쪽의 고객사만 칸이 비게 되고 그 사실은 **배포한 뒤에야, 그것도 표가 통째로
 * 비는 모양으로** 드러난다(2026-10-17 운영 장애가 바로 그 모양이었다). 열한 개
 * 가운데 하나만 빠져도 그렇다. 그래서 둘이 같은지를 시험이 직접 잰다.
 *
 * 여기서 지키는 것 다섯:
 *  1. 0116 은 **칸 하나를 더하고 채우기만 한다** — 지우거나 바꾸는 문장이 없다.
 *  2. 🔴 **customers 말고 다른 표를 건드리지 않는다.**
 *  3. 🔴 **채우는 이름이 코드의 세 customerNames 와 글자 그대로 같다**(정규화
 *     기준). 양식별로 따로 잰다 — 이름이 남의 양식으로 가도 오류가 안 난다.
 *  4. 🔴 **맞춰 보는 자가 0022 의 유일 색인과 같은 식이다.** 다르면 코드가
 *     가리는 이름과 SQL 이 채우는 이름이 서로 달라진다.
 *  5. 🔴 **칸이 널 허용이고 기본값이 없다.** PO 사이트가 같은 표를 읽고, 지금
 *     고객사 대부분은 양식이 없다.
 * ============================================================================
 */

const MIGRATION_PATH = "drizzle/0116_customer_portal_form_id.sql";
const migration = readFileSync(MIGRATION_PATH, "utf8").trim();

/**
 * 문장만 남긴다. 🔴 가르는 것이 먼저다 — `--> statement-breakpoint` 자체가
 * `--` 로 시작하는 주석 모양이라, 주석을 먼저 걷으면 구분자가 함께 사라져 파일
 * 전체가 한 문장이 된다.
 */
const statements = migration
  .split("--> statement-breakpoint")
  .map((chunk) => chunk.replace(/--[^\n]*/g, "").trim())
  .filter((chunk) => chunk !== "");

/** 설명 주석을 뺀 SQL 만. 주석에 적은 낱말을 진짜 문장으로 세지 않기 위해서다. */
const sqlOnly = statements.join("\n");

/**
 * 코드와 SQL 이 같은 자로 가리는가 — 0022 가
 * customers_normalized_name_unique 에 쓴 식 그대로다(entity-name-match.ts 의
 * normalizeEntityName 이 TypeScript 로 적은 것이 이것이다).
 */
const NORMALIZE_EXPRESSION = String.raw`lower(regexp_replace(btrim("name"), '\s+', ' ', 'g'))`;

// ── 0116 이 무엇을 하는가 ────────────────────────────────────────────────

test("0116 은 지우거나 되돌릴 수 없는 문장을 하나도 담지 않는다", () => {
  assert.deepEqual(findDestructiveOperations(migration), []);
  assert.deepEqual(findRiskyOperations(migration), []);
});

test("0116 의 문장은 칸 추가 하나와 채우기 셋뿐이다", () => {
  // 🔴 RENAME 이 섞이면 칸을 더하는 것이 아니라 **다른 칸을 이것으로 둔갑**
  //    시킨 것이고, 그때는 그 칸의 자료가 통째로 옮겨 간다.
  assert.doesNotMatch(sqlOnly, /\bRENAME\b/i);
  // 🔴 drizzle 의 sql 템플릿에 상수를 넣으면 바인딩 자리($1)로 구워져 돌릴 수
  //    없는 마이그레이션이 된다. 생성 때는 오류가 없고 적용할 때 깨진다.
  assert.doesNotMatch(sqlOnly, /\$\d/);

  assert.equal(statements.length, 4);
  assert.equal(statements[0], 'ALTER TABLE "customers" ADD COLUMN "portal_form_id" text;');
  for (const statement of statements.slice(1)) {
    assert.match(statement, /^UPDATE "customers"\n/);
  }
});

test("🔴 0116 은 customers 말고 다른 표를 건드리지 않는다", () => {
  const touched = [...sqlOnly.matchAll(/(?:ALTER TABLE|UPDATE|CREATE TABLE) "([^"]+)"/g)].map(
    (match) => match[1]
  );
  assert.deepEqual(new Set(touched), new Set(["customers"]));
});

// ── 🔴 채우는 이름이 코드와 같은가 ───────────────────────────────────────

/** UPDATE 문장 하나에서 「어느 양식에, 어떤 이름들을」을 읽어 낸다. */
function readBackfill(statement: string): { formId: string; names: string[] } {
  const formId = statement.match(/SET "portal_form_id" = '([^']+)'/)?.[1];
  assert.ok(formId, `양식 id 를 읽지 못했다: ${statement.slice(0, 60)}`);

  // 🔴 `IN \(([\s\S]*?)\)` 로 잘라 내지 않는다 — `'(주)아이씨디'` 처럼 이름
  //    안에 괄호가 있어서 거기서 잘린다. 목록이 문장의 맨 끝이므로 `IN (`
  //    뒤쪽을 통째로 읽는다.
  const start = statement.indexOf("IN (");
  assert.notEqual(start, -1, `IN 목록이 없다: ${statement.slice(0, 60)}`);
  const names = [...statement.slice(start).matchAll(/'([^']*)'/g)].map((match) => match[1]);

  return { formId, names };
}

test("🔴 0116 이 채우는 이름은 코드의 customerNames 와 양식별로 똑같다", () => {
  const backfilled = new Map<string, string[]>();
  for (const statement of statements.slice(1)) {
    const { formId, names } = readBackfill(statement);
    assert.equal(backfilled.has(formId), false, `${formId} 를 채우는 문장이 둘이다`);
    backfilled.set(formId, names);
  }

  // 양식 하나가 빠지면 그 회사의 표만 조용히 사라진다 — 개수부터 못 박는다.
  assert.deepEqual(
    [...backfilled.keys()],
    CUSTOMER_PORTAL_FORMS.map((form) => form.id)
  );

  for (const form of CUSTOMER_PORTAL_FORMS) {
    assert.deepEqual(
      backfilled.get(form.id),
      form.customerNames.map(normalizeEntityName),
      `${form.id} 의 이름 목록이 코드와 어긋난다`
    );
  }

  // 열한 개다(실측 2026-10-17). 개발 DB 와 운영 DB 의 이름이 달라 옛 이름과
  // 지금 이름을 모두 적어야 양쪽에서 채워진다 — 옛 이름을 지우면 개발 DB 와
  // 과거 데이터가 안 채워진다.
  assert.equal([...backfilled.values()].flat().length, 11);
});

test("🔴 맞춰 보는 자가 0022 의 유일 색인과 같은 식이다", () => {
  const zero022 = readFileSync("drizzle/0022_customer_end_user_free_entry_foundation.sql", "utf8");
  assert.ok(
    zero022.includes(NORMALIZE_EXPRESSION),
    "0022 의 정규화 식이 바뀌었다 — 둘을 함께 고쳐야 한다"
  );
  for (const statement of statements.slice(1)) {
    assert.ok(
      statement.includes(NORMALIZE_EXPRESSION),
      `채우기 문장이 다른 자로 가린다: ${statement.slice(0, 60)}`
    );
  }
});

test("🔴 이미 값이 있는 줄은 덮어쓰지 않고, 지워진 고객사도 함께 채운다", () => {
  for (const statement of statements.slice(1)) {
    // 사람이 화면에서 고른 값(C-3)을 되돌려 놓지 않는다.
    assert.match(statement, /WHERE "portal_form_id" IS NULL/);
    // 지워진 고객사의 과거 접수 건도 표에 뜬다 — is_deleted 로 거르면 안 된다.
    assert.doesNotMatch(statement, /is_deleted/);
  }
});

// ── 칸 자체 ──────────────────────────────────────────────────────────────

test("🔴 portal_form_id 는 널 허용이고 기본값이 없다", () => {
  // 지금 고객사 대부분은 양식이 없고(그것이 정상이다), 새로 등록하는 고객사도
  // 양식 없이 시작한다. 그리고 이 표는 PO 사이트와 함께 쓰는 표라 그쪽은 이
  // 칸에 넣을 값이 없다.
  assert.equal(customers.portalFormId.name, "portal_form_id");
  assert.equal(customers.portalFormId.notNull, false);
  assert.equal(customers.portalFormId.hasDefault, false);
  assert.equal(customers.portalFormId.dataType, "string");
});

test("🔴 값의 범위를 DB 가 지키지 않는다 — 등록부는 코드다", () => {
  // 어느 양식 id 가 뜻이 있는지는 CUSTOMER_PORTAL_FORMS 가 정한다. CHECK 나
  // enum 으로 옮겨 적으면 목록이 두 벌이 되고, 양식이 늘 때마다 마이그레이션이
  // 하나 는다(ui_theme_tokens.token_key · ui_text_overrides.group_key 와 같은
  // 판단 — 그 칸들의 주석에). 등록부에 없는 값은 findPortalFormById 가 null 을
  // 돌려주는 길로 조용히 떨어진다.
  assert.doesNotMatch(sqlOnly, /CHECK/i);
  assert.doesNotMatch(sqlOnly, /CREATE TYPE/i);
  // 39행짜리 표라 훑는 편이 싸다(row_color 와 같은 까닭).
  assert.doesNotMatch(sqlOnly, /CREATE\s+(?:UNIQUE\s+)?INDEX/i);
});
