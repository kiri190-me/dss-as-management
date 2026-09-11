import "../../../../scripts/load-env";

import { after, afterEach, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { and, eq, inArray, like } from "drizzle-orm";
import { db, pgClient } from "../connection";
import { auditLogs, domesticOrderSheetSettings, users } from "../schema";
import {
  DOMESTIC_ORDER_SHEET_SETTINGS_AUDIT_ENTITY,
  saveDomesticOrderSheetHeading,
} from "./domestic-order-sheet-settings";
import {
  getDomesticOrderSheetHeading,
  loadStoredDomesticOrderSheetHeading,
} from "../queries/domestic-order-sheet-settings";
import { hasPermission } from "@/lib/auth/permission-resolver";
import {
  DEFAULT_DOMESTIC_ORDER_SHEET_GREETING,
  DEFAULT_DOMESTIC_ORDER_SHEET_HEADING,
  DEFAULT_DOMESTIC_ORDER_SHEET_MEMO,
  DOMESTIC_ORDER_SHEET_GREETING_MAX_CHARS,
  DOMESTIC_ORDER_SHEET_MEMO_MAX_CHARS,
} from "@/lib/domain/domestic-order-sheet-heading";

/**
 * ============================================================================
 * 내자 정리 머리말 저장 — 실제 DB (시험 DB) · 마이그레이션 0092
 * ============================================================================
 * ui-text-overrides.integration.test.ts 와 같은 방식이다: 이 파일이 만든
 * "sheethead-test-" 계정만 쓰고, after() 에서 그 계정이 남긴 설정 행과 감사 기록까지
 * 지운다(domestic_order_sheet_settings.updated_by → users 가 restrict 라 순서가 있다).
 * 씨앗 계정은 읽지 않는다 — 행위자를 전부 여기서 만든다.
 *
 * 🔴 이 표는 **행이 하나뿐인 설정**이다. 그래서 before() 가 표가 비어 있는지 먼저
 * 보고, 비어 있지 않으면 **돌지 않는다** — 누가 시험 DB 에서 화면으로 저장해 둔
 * 머리말을 시험이 덮어쓰거나 지우면 안 된다.
 *
 * 여기서 지키려는 것:
 *  1. 행이 없으면 코드의 기본 문구다(조회).
 *  2. 첫 저장은 INSERT, 다시 저장은 UPDATE — **행은 언제나 하나.** 동시에 눌러도 하나.
 *  3. 기본 문구로 저장하면 행이 지워진다(행이 없다 = 기본 문구).
 *  4. 고칠 수 없는 사람은 거절된다 — 트랜잭션 안에서 살아 있는 행위자를 다시 읽는다.
 *  5. 감사 로그에 전후 문구가 남는다(CREATE · UPDATE · 기본으로 = UPDATE).
 *  6. DB 가 스스로 막는다 — 길이 CHECK · 두 줄 금지.
 * ============================================================================
 */

const TEST_EMAIL_PREFIX = "sheethead-test-";

let salesId: string;
let engineerId: string;
let pendingSalesId: string;
let deletedSalesId: string;
const createdTestUserIds: string[] = [];

async function createTestUser(overrides: Partial<typeof users.$inferInsert> = {}): Promise<string> {
  const [row] = await db
    .insert(users)
    .values({
      email: `${TEST_EMAIL_PREFIX}${randomUUID().slice(0, 8)}@example.test`,
      name: "SheetHeading Test User",
      role: "SALES",
      approvalStatus: "APPROVED",
      isActive: true,
      ...overrides,
    })
    .returning({ id: users.id });
  createdTestUserIds.push(row.id);
  return row.id;
}

async function storedRows() {
  return db
    .select({
      id: domesticOrderSheetSettings.id,
      singleton: domesticOrderSheetSettings.singleton,
      greetingText: domesticOrderSheetSettings.greetingText,
      internalMemo: domesticOrderSheetSettings.internalMemo,
      updatedBy: domesticOrderSheetSettings.updatedBy,
      updatedAt: domesticOrderSheetSettings.updatedAt,
    })
    .from(domesticOrderSheetSettings);
}

/** 이 표의 감사 기록만 고른다. */
async function sheetAuditRows() {
  return db
    .select({
      id: auditLogs.id,
      actorUserId: auditLogs.actorUserId,
      actionType: auditLogs.actionType,
      targetEntity: auditLogs.targetEntity,
      targetRecordId: auditLogs.targetRecordId,
      previousValue: auditLogs.previousValue,
      newValue: auditLogs.newValue,
    })
    .from(auditLogs)
    .where(eq(auditLogs.targetEntity, DOMESTIC_ORDER_SHEET_SETTINGS_AUDIT_ENTITY));
}

async function sheetAuditCount(): Promise<number> {
  return (await sheetAuditRows()).length;
}

/**
 * 이 파일의 계정과 그 계정이 남긴 설정 행·감사 기록을 지운다. 접두사로 고르므로 이전
 * 실행이 중간에 끊겨 남은 것까지 함께 걷는다.
 */
async function removeTestUsersByPrefix(): Promise<void> {
  const leftovers = await db
    .select({ id: users.id })
    .from(users)
    .where(like(users.email, `${TEST_EMAIL_PREFIX}%`));
  const ids = leftovers.map((row) => row.id);
  if (ids.length === 0) return;
  // domestic_order_sheet_settings.updated_by → users (restrict): 설정 행이 먼저다.
  await db.delete(domesticOrderSheetSettings).where(inArray(domesticOrderSheetSettings.updatedBy, ids));
  // audit_logs.actor_user_id → users (restrict): 행위자로만 고른다 —
  // target_record_id 로 고르는 모양은 test-cleanup-static-safety.test.ts 가 금지한다.
  await db.delete(auditLogs).where(inArray(auditLogs.actorUserId, ids));
  await db.delete(users).where(inArray(users.id, ids));
}

/** 이 파일의 계정이 저장한 설정 행만 지운다(시험마다 빈 표에서 시작하게). */
async function clearOwnRows(): Promise<void> {
  if (createdTestUserIds.length === 0) return;
  await db
    .delete(domesticOrderSheetSettings)
    .where(inArray(domesticOrderSheetSettings.updatedBy, createdTestUserIds));
}

/** Drizzle 이 감싼 Postgres 오류에서 코드와 제약 이름을 확인한다. */
function expectPgError(code: string, constraint: string) {
  return (error: unknown) => {
    const cause = (error as { cause?: unknown }).cause;
    assert.ok(cause instanceof Error, "PostgresError 가 cause 로 실려 있어야 한다");
    assert.equal((cause as { code?: string }).code, code, `${code} 가 아니라 다른 이유로 거부됐다: ${cause.message}`);
    assert.match(cause.message, new RegExp(constraint), `${constraint} 가 아니라 다른 제약에 걸렸다`);
    return true;
  };
}

const CUSTOM_GREETING = "1. 새 인사문입니다.\n2. {기준일}자 현황입니다.\n  2) 연락은 영업팀으로 주세요.";
const CUSTOM_MEMO = "회신 전 완성일 확인";

before(async () => {
  await removeTestUsersByPrefix();

  assert.equal(
    (await storedRows()).length,
    0,
    "이 시험은 domestic_order_sheet_settings 가 비어 있는 상태를 전제로 합니다 — 시험 DB 에 저장된 머리말이 있어 돌지 않습니다"
  );

  salesId = await createTestUser({ role: "SALES", name: "SheetHeading 영업" });
  engineerId = await createTestUser({ role: "AS_ENGINEER", name: "SheetHeading 엔지니어" });
  pendingSalesId = await createTestUser({ approvalStatus: "PENDING", name: "SheetHeading 승인 대기 영업" });
  deletedSalesId = await createTestUser({
    isDeleted: true,
    deletedAt: new Date(),
    name: "SheetHeading 삭제된 영업",
  });

  // 전제: 시험 DB 의 권한 설정이 기본 정책과 같다(영업 = 내자 정리 쓰기, 엔지니어 = 없음).
  // 여기서 어긋나면 아래 인가 시험이 엉뚱한 이유로 실패하므로 먼저 알린다.
  assert.equal(
    await hasPermission({ role: "SALES", isDeveloper: false }, "domesticOrders", "WRITE"),
    true,
    "전제가 깨졌다: 시험 DB 에서 영업이 내자 정리를 고칠 수 없다"
  );
  assert.equal(
    await hasPermission({ role: "AS_ENGINEER", isDeveloper: false }, "domesticOrders", "WRITE"),
    false,
    "전제가 깨졌다: 시험 DB 에서 A/S 엔지니어가 내자 정리를 고칠 수 있다"
  );
});

afterEach(async () => {
  await clearOwnRows();
});

after(async () => {
  await removeTestUsersByPrefix();
  await pgClient.end({ timeout: 5 });
});

describe("saveDomesticOrderSheetHeading", () => {
  // ───────────────────────────────────────── 행이 없다 = 코드의 기본 문구

  test("1. 행이 없으면 조회가 코드의 기본 문구를 돌려준다", async () => {
    assert.equal(await loadStoredDomesticOrderSheetHeading(), null);
    const view = await getDomesticOrderSheetHeading();
    assert.deepEqual(view, { ...DEFAULT_DOMESTIC_ORDER_SHEET_HEADING, isCustomized: false });
  });

  // ─────────────────────────────────────────── 첫 저장 INSERT · 다시 UPDATE

  test("2. 첫 저장은 INSERT — 행 하나가 생기고 조회가 그 글을 돌려준다", async () => {
    const result = await saveDomesticOrderSheetHeading({
      greetingText: CUSTOM_GREETING,
      internalMemo: CUSTOM_MEMO,
      actorUserId: salesId,
    });
    assert.deepEqual(result, { ok: true, changed: true, revertedToDefault: false });

    const rows = await storedRows();
    assert.equal(rows.length, 1);
    assert.equal(rows[0].singleton, true);
    assert.equal(rows[0].greetingText, CUSTOM_GREETING);
    assert.equal(rows[0].internalMemo, CUSTOM_MEMO);
    assert.equal(rows[0].updatedBy, salesId);

    const view = await getDomesticOrderSheetHeading();
    assert.deepEqual(view, { greetingText: CUSTOM_GREETING, internalMemo: CUSTOM_MEMO, isCustomized: true });
  });

  test("2b. 저장되는 값은 정규화를 지난 것이다 — \\r\\n · 줄 끝 공백 · 앞뒤 빈 줄", async () => {
    await saveDomesticOrderSheetHeading({
      greetingText: "\r\n  가  \r\n나\r\n\r\n",
      internalMemo: "  메모  \n",
      actorUserId: salesId,
    });
    const [row] = await storedRows();
    assert.equal(row.greetingText, "  가\n나", "줄 앞 공백(들여쓰기)은 남고 나머지는 걷혀야 한다");
    assert.equal(row.internalMemo, "  메모");
  });

  test("3. 다시 저장하면 UPDATE — 행은 하나 그대로이고 id 도 같다", async () => {
    await saveDomesticOrderSheetHeading({
      greetingText: CUSTOM_GREETING,
      internalMemo: CUSTOM_MEMO,
      actorUserId: salesId,
    });
    const [first] = await storedRows();

    const result = await saveDomesticOrderSheetHeading({
      greetingText: "고친 인사문",
      internalMemo: "",
      actorUserId: salesId,
    });
    assert.deepEqual(result, { ok: true, changed: true, revertedToDefault: false });

    const rows = await storedRows();
    assert.equal(rows.length, 1, "다시 저장했는데 행이 늘었다");
    assert.equal(rows[0].id, first.id, "UPDATE 가 아니라 새 행을 만들었다");
    assert.equal(rows[0].greetingText, "고친 인사문");
    assert.equal(rows[0].internalMemo, "", "빈 메모는 빈 문자열로 저장된다(메모 상자 없음)");
    assert.ok(rows[0].updatedAt.getTime() >= first.updatedAt.getTime());
  });

  test("3b. 같은 글을 다시 저장하면 바뀐 것이 없다 — 감사 기록도 늘지 않는다", async () => {
    await saveDomesticOrderSheetHeading({
      greetingText: CUSTOM_GREETING,
      internalMemo: CUSTOM_MEMO,
      actorUserId: salesId,
    });
    const auditBefore = await sheetAuditCount();

    const again = await saveDomesticOrderSheetHeading({
      greetingText: `${CUSTOM_GREETING}   \n\n`, // 정규화하면 같은 글
      internalMemo: CUSTOM_MEMO,
      actorUserId: salesId,
    });
    assert.deepEqual(again, { ok: true, changed: false, revertedToDefault: false });
    assert.equal(await sheetAuditCount(), auditBefore, "같은 글을 다시 저장했는데 기록이 늘었다");
    assert.equal((await storedRows()).length, 1);
  });

  test("🔴 3c. 두 사람이 처음 저장을 동시에 눌러도 행은 하나다 — 뒤엣것이 이긴다", async () => {
    const results = await Promise.all([
      saveDomesticOrderSheetHeading({ greetingText: "갑의 인사문", internalMemo: "갑", actorUserId: salesId }),
      saveDomesticOrderSheetHeading({ greetingText: "을의 인사문", internalMemo: "을", actorUserId: salesId }),
    ]);
    for (const result of results) assert.equal(result.ok, true, `동시 저장 한쪽이 실패했다: ${JSON.stringify(result)}`);

    const rows = await storedRows();
    assert.equal(rows.length, 1, "동시 저장으로 행이 둘이 됐다");
    assert.ok(["갑의 인사문", "을의 인사문"].includes(rows[0].greetingText));
    // 인사문과 메모가 한 사람의 것끼리 짝이다 — 섞이지 않았다.
    assert.equal(rows[0].internalMemo, rows[0].greetingText === "갑의 인사문" ? "갑" : "을");
  });

  // ──────────────────────────────────────────────────────── 기본 문구로

  test("4. 기본 문구로 저장하면 행이 지워지고 조회는 기본 문구로 돌아간다", async () => {
    await saveDomesticOrderSheetHeading({
      greetingText: CUSTOM_GREETING,
      internalMemo: CUSTOM_MEMO,
      actorUserId: salesId,
    });
    assert.equal((await storedRows()).length, 1);

    const result = await saveDomesticOrderSheetHeading({
      // 줄 끝 공백 · 끝의 빈 줄이 섞여도 기본 문구로 본다.
      greetingText: `${DEFAULT_DOMESTIC_ORDER_SHEET_GREETING}  \r\n\r\n`,
      internalMemo: DEFAULT_DOMESTIC_ORDER_SHEET_MEMO,
      actorUserId: salesId,
    });
    assert.deepEqual(result, { ok: true, changed: true, revertedToDefault: true });
    assert.equal((await storedRows()).length, 0, "기본 문구로 저장했는데 행이 남았다");
    assert.deepEqual(await getDomesticOrderSheetHeading(), {
      ...DEFAULT_DOMESTIC_ORDER_SHEET_HEADING,
      isCustomized: false,
    });
  });

  test("4b. 행이 없는데 기본 문구로 저장하면 아무 일도 없다 — 행도 기록도 생기지 않는다", async () => {
    const auditBefore = await sheetAuditCount();
    const result = await saveDomesticOrderSheetHeading({
      ...DEFAULT_DOMESTIC_ORDER_SHEET_HEADING,
      actorUserId: salesId,
    });
    assert.deepEqual(result, { ok: true, changed: false, revertedToDefault: true });
    assert.equal((await storedRows()).length, 0);
    assert.equal(await sheetAuditCount(), auditBefore);
  });

  test("4c. 인사문만 기본이고 메모가 다르면 행이 남는다 — 둘 다 기본일 때만 지운다", async () => {
    const result = await saveDomesticOrderSheetHeading({
      greetingText: DEFAULT_DOMESTIC_ORDER_SHEET_GREETING,
      internalMemo: "",
      actorUserId: salesId,
    });
    assert.deepEqual(result, { ok: true, changed: true, revertedToDefault: false });
    const rows = await storedRows();
    assert.equal(rows.length, 1);
    assert.equal(rows[0].greetingText, DEFAULT_DOMESTIC_ORDER_SHEET_GREETING);
    assert.equal(rows[0].internalMemo, "");
  });

  // ──────────────────────────────────────────────────────────── 인가

  test("5. 내자 정리를 고칠 수 없는 사람(A/S 엔지니어)은 거절된다 — 행도 기록도 없다", async () => {
    const auditBefore = await sheetAuditCount();
    const result = await saveDomesticOrderSheetHeading({
      greetingText: CUSTOM_GREETING,
      internalMemo: CUSTOM_MEMO,
      actorUserId: engineerId,
    });
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.code, "FORBIDDEN");
    assert.equal((await storedRows()).length, 0);
    assert.equal(await sheetAuditCount(), auditBefore, "거절됐는데 감사 기록이 남았다");
  });

  test("5b. 승인 대기 · 지워진 계정 · 없는 계정도 거절된다 — 트랜잭션 안에서 다시 읽는다", async () => {
    for (const [label, actorUserId] of [
      ["승인 대기", pendingSalesId],
      ["지워진 계정", deletedSalesId],
      ["없는 계정", randomUUID()],
    ] as const) {
      const result = await saveDomesticOrderSheetHeading({
        greetingText: CUSTOM_GREETING,
        internalMemo: CUSTOM_MEMO,
        actorUserId,
      });
      assert.equal(result.ok, false, `${label}: 통과했다`);
      if (!result.ok) assert.equal(result.code, "FORBIDDEN", label);
    }
    assert.equal((await storedRows()).length, 0);
  });

  test("5c. 기본 문구로 되돌리기도 같은 관문이다 — 엔지니어는 남의 문구를 지울 수 없다", async () => {
    await saveDomesticOrderSheetHeading({
      greetingText: CUSTOM_GREETING,
      internalMemo: CUSTOM_MEMO,
      actorUserId: salesId,
    });
    const result = await saveDomesticOrderSheetHeading({
      ...DEFAULT_DOMESTIC_ORDER_SHEET_HEADING,
      actorUserId: engineerId,
    });
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.code, "FORBIDDEN");
    const rows = await storedRows();
    assert.equal(rows.length, 1, "권한 없는 되돌리기가 행을 지웠다");
    assert.equal(rows[0].greetingText, CUSTOM_GREETING);
  });

  // ──────────────────────────────────────────────────────────── 감사 기록

  test("6. 감사 기록 — 첫 저장 CREATE(이전 = 기본 문구) · 다시 UPDATE · 기본으로 UPDATE", async () => {
    const seen = new Set((await sheetAuditRows()).map((row) => row.id));
    async function newlyAdded() {
      const rows = (await sheetAuditRows()).filter((row) => !seen.has(row.id));
      for (const row of rows) seen.add(row.id);
      return rows;
    }

    await saveDomesticOrderSheetHeading({
      greetingText: CUSTOM_GREETING,
      internalMemo: CUSTOM_MEMO,
      actorUserId: salesId,
    });
    const [row] = await storedRows();

    const created = await newlyAdded();
    assert.equal(created.length, 1);
    assert.equal(created[0].actorUserId, salesId);
    assert.equal(created[0].actionType, "CREATE");
    assert.equal(created[0].targetRecordId, row.id);
    // 행이 없던 때 실제로 화면에 나가던 글은 코드의 기본 문구다.
    assert.deepEqual(created[0].previousValue, DEFAULT_DOMESTIC_ORDER_SHEET_HEADING);
    assert.deepEqual(created[0].newValue, { greetingText: CUSTOM_GREETING, internalMemo: CUSTOM_MEMO });

    await saveDomesticOrderSheetHeading({
      greetingText: "고친 인사문",
      internalMemo: "",
      actorUserId: salesId,
    });
    const updated = await newlyAdded();
    assert.equal(updated.length, 1);
    assert.equal(updated[0].actionType, "UPDATE");
    assert.equal(updated[0].targetRecordId, row.id);
    assert.deepEqual(updated[0].previousValue, { greetingText: CUSTOM_GREETING, internalMemo: CUSTOM_MEMO });
    assert.deepEqual(updated[0].newValue, { greetingText: "고친 인사문", internalMemo: "" });

    // 🔴 기본 문구로 = 행을 지우지만 UPDATE 다. 문구가 없어진 것이 아니라 기본으로
    // 돌아간 것이라, SOFT_DELETE/PURGE 로 남기면 로그를 읽는 사람을 속인다.
    await saveDomesticOrderSheetHeading({
      ...DEFAULT_DOMESTIC_ORDER_SHEET_HEADING,
      actorUserId: salesId,
    });
    const reverted = await newlyAdded();
    assert.equal(reverted.length, 1);
    assert.equal(reverted[0].actionType, "UPDATE");
    assert.equal(reverted[0].targetRecordId, row.id);
    assert.deepEqual(reverted[0].previousValue, { greetingText: "고친 인사문", internalMemo: "" });
    assert.deepEqual(reverted[0].newValue, { ...DEFAULT_DOMESTIC_ORDER_SHEET_HEADING, revertedToDefault: true });
  });

  // ───────────────────────────────────────────── 검증 · DB 가 스스로 막는 것

  test("7. 상한을 넘는 글 · 빈 인사문은 mutation 이 거절한다 — DB 오류가 아니라 입력 오류", async () => {
    const cases = [
      { label: "인사문 2001자", greetingText: "가".repeat(DOMESTIC_ORDER_SHEET_GREETING_MAX_CHARS + 1), internalMemo: "" },
      { label: "메모 501자", greetingText: "인사", internalMemo: "나".repeat(DOMESTIC_ORDER_SHEET_MEMO_MAX_CHARS + 1) },
      { label: "빈 인사문", greetingText: "  \n ", internalMemo: "메모" },
    ];
    for (const { label, greetingText, internalMemo } of cases) {
      const result = await saveDomesticOrderSheetHeading({ greetingText, internalMemo, actorUserId: salesId });
      assert.equal(result.ok, false, `${label}: 통과했다`);
      if (!result.ok) {
        assert.equal(result.code, "INVALID_INPUT", label);
        assert.ok(result.fieldErrors, label);
      }
    }
    assert.equal((await storedRows()).length, 0);
  });

  test("7b. 상한 딱 맞는 글(2000 · 500자)은 저장된다 — 검증과 CHECK 가 같은 수", async () => {
    const result = await saveDomesticOrderSheetHeading({
      greetingText: "가".repeat(DOMESTIC_ORDER_SHEET_GREETING_MAX_CHARS),
      internalMemo: "나".repeat(DOMESTIC_ORDER_SHEET_MEMO_MAX_CHARS),
      actorUserId: salesId,
    });
    assert.equal(result.ok, true, `상한 딱 맞는 글이 막혔다: ${JSON.stringify(result)}`);
  });

  test("🔴 8. 길이 CHECK — mutation 을 거치지 않고 넣어도 DB 가 막는다", async () => {
    await assert.rejects(
      () =>
        db.insert(domesticOrderSheetSettings).values({
          greetingText: "가".repeat(DOMESTIC_ORDER_SHEET_GREETING_MAX_CHARS + 1),
          internalMemo: "",
          updatedBy: salesId,
        }),
      expectPgError("23514", "domestic_order_sheet_settings_greeting_text_length")
    );
    await assert.rejects(
      () =>
        db.insert(domesticOrderSheetSettings).values({
          greetingText: "인사",
          internalMemo: "나".repeat(DOMESTIC_ORDER_SHEET_MEMO_MAX_CHARS + 1),
          updatedBy: salesId,
        }),
      expectPgError("23514", "domestic_order_sheet_settings_internal_memo_length")
    );
    // 코드 포인트로 센다 — 이모지 2000개(UTF-16 으로 4000단위)는 들어간다.
    await db.insert(domesticOrderSheetSettings).values({
      greetingText: "😀".repeat(DOMESTIC_ORDER_SHEET_GREETING_MAX_CHARS),
      internalMemo: "",
      updatedBy: salesId,
    });
    assert.equal((await storedRows()).length, 1);
  });

  test("🔴 8b. 두 줄은 DB 가 막는다 — 유니크(singleton) · singleton = false 도 CHECK 로", async () => {
    await db.insert(domesticOrderSheetSettings).values({
      greetingText: "첫 줄",
      internalMemo: "",
      updatedBy: salesId,
    });
    await assert.rejects(
      () =>
        db.insert(domesticOrderSheetSettings).values({
          greetingText: "둘째 줄",
          internalMemo: "",
          updatedBy: salesId,
        }),
      expectPgError("23505", "domestic_order_sheet_settings_singleton_unique")
    );
    // 불리언 칸의 유니크 인덱스는 true 한 줄과 false 한 줄을 함께 허락한다 — 그 틈을
    // CHECK 가 막는다.
    await assert.rejects(
      () =>
        db.insert(domesticOrderSheetSettings).values({
          singleton: false,
          greetingText: "거짓 줄",
          internalMemo: "",
          updatedBy: salesId,
        }),
      expectPgError("23514", "domestic_order_sheet_settings_singleton_true")
    );
    assert.equal((await storedRows()).length, 1);
  });

  test("9. 저장한 계정이 있는 동안 그 계정은 지울 수 없다 — updated_by 는 RESTRICT", async () => {
    // 감사 기록이 없는 새 계정으로 행을 직접 넣는다 — mutation 으로 저장하면
    // audit_logs.actor_user_id(역시 RESTRICT)가 먼저 걸려 이 표의 외래키를 볼 수 없다.
    const writerId = await createTestUser({ name: "SheetHeading 외래키 확인" });
    await db.insert(domesticOrderSheetSettings).values({
      greetingText: CUSTOM_GREETING,
      internalMemo: CUSTOM_MEMO,
      updatedBy: writerId,
    });
    await assert.rejects(
      () => db.delete(users).where(and(eq(users.id, writerId), like(users.email, `${TEST_EMAIL_PREFIX}%`))),
      expectPgError("23503", "domestic_order_sheet_settings_updated_by_users_id_fk")
    );
  });
});
