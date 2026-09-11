import "../../../../scripts/load-env";

import { after, afterEach, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { and, eq, inArray, like } from "drizzle-orm";
import { db, pgClient } from "../connection";
import { auditLogs, uiThemeTokens, users } from "../schema";
import { saveUiThemeTokens } from "./ui-theme-tokens";
import { loadStoredUiThemeTokens } from "../queries/ui-theme-tokens";
import {
  resolveUiTheme,
  serializeUiThemeCss,
  UI_THEME_TOKENS,
  type UiThemeToken,
} from "@/lib/domain/ui-theme-tokens";

/**
 * ============================================================================
 * saveUiThemeTokens() — 실제 DB (시험 DB)
 * ============================================================================
 * developer-flag.integration.test.ts 와 같은 방식이다: 이 파일이 만든
 * "uitheme-test-" 계정만 쓰고, after() 에서 그 계정이 남긴 오버라이드 행과 감사
 * 기록까지 지운다(ui_theme_tokens.updated_by → users 가 restrict 라 순서가 있다).
 * 씨앗 계정은 읽지 않는다 — 행위자를 전부 여기서 만든다.
 *
 * 여기서 지키려는 것은 넷이다:
 *  1. **인가는 개발자 모드 관문과 같은 넓이다.** 개발자 표시가 켜진 엔지니어가
 *     통과해야 한다 — 좁히면 "들어와서 편집기는 보이는데 누르면 거절"이 된다.
 *  2. **기본값과 같은 값은 행으로 남지 않고, 되돌리면 행이 지워진다.**
 *  3. 🔴 **값 하나가 막히면 같이 보낸 전부가 막힌다.** 트랜잭션 콜백에서 그냥
 *     반환하면 커밋되므로, 앞줄이 이미 저장된 뒤 뒷줄이 막히는 경우를 실제로
 *     만들어 앞줄까지 사라졌는지 본다.
 *  4. **대비 하한은 합쳐진 결과로 잰다** — 한쪽만 바꿔도 막힌다.
 * ============================================================================
 */

const TEST_EMAIL_PREFIX = "uitheme-test-";

/** 이 파일이 건드리는 토큰. 뒷정리를 이 목록으로 좁힌다. */
const TOUCHED_TOKEN_KEYS = [
  "zinc-50",
  "zinc-800",
  "zinc-900",
  "background",
  "foreground",
  "radius-md",
  "text-sm",
  // 주간보고 전용(시험 10 · 10b). 거절되는 쪽도 적어 둔다 — 거절이 뚫려 행이
  // 남았을 때 다음 시험의 「표가 비어 있다」 전제를 깨지 않게.
  "text-wr-body",
  "text-wr-title",
  "spacing-wr-table-min",
  "spacing-wr-cell-x",
  "spacing-wr-block",
];

let superAdminId: string;
let developerEngineerId: string;
let adminId: string;
let pendingDeveloperId: string;
let deletedSuperAdminId: string;
const createdTestUserIds: string[] = [];

function tokenOf(key: string): UiThemeToken {
  const token = UI_THEME_TOKENS.find((candidate) => candidate.key === key);
  assert.ok(token, `등록부에 ${key} 가 없다 — 이 시험의 전제가 사라졌다`);
  return token;
}

const zinc900 = tokenOf("zinc-900");
const background = tokenOf("background");
const foreground = tokenOf("foreground");
const radiusMd = tokenOf("radius-md");
const weeklyBody = tokenOf("text-wr-body");
const weeklyTableMin = tokenOf("spacing-wr-table-min");

async function createTestUser(overrides: Partial<typeof users.$inferInsert> = {}): Promise<string> {
  const [row] = await db
    .insert(users)
    .values({
      email: `${TEST_EMAIL_PREFIX}${randomUUID().slice(0, 8)}@example.test`,
      name: "UiTheme Test User",
      role: "AS_ENGINEER",
      approvalStatus: "APPROVED",
      isActive: true,
      ...overrides,
    })
    .returning({ id: users.id });
  createdTestUserIds.push(row.id);
  return row.id;
}

async function storedValue(tokenKey: string, scope: string): Promise<string | null> {
  const [row] = await db
    .select({ value: uiThemeTokens.value })
    .from(uiThemeTokens)
    .where(and(eq(uiThemeTokens.tokenKey, tokenKey), eq(uiThemeTokens.scope, scope)));
  return row?.value ?? null;
}

async function storedRowCount(): Promise<number> {
  const rows = await db.select({ id: uiThemeTokens.id }).from(uiThemeTokens);
  return rows.length;
}

/** 화면 토큰에 남은 감사 기록 — 이 표에 남는 것만 고른다. */
async function themeAuditRows() {
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
    .where(eq(auditLogs.targetEntity, "ui_theme_tokens"));
}

async function themeAuditCount(): Promise<number> {
  return (await themeAuditRows()).length;
}

/**
 * 이 파일의 계정과 그 계정이 남긴 오버라이드·감사 기록을 지운다. 접두사로 고르므로
 * 이전 실행이 중간에 끊겨 남은 것까지 함께 걷는다 — 개발자 표시가 켜진 계정이 남으면
 * developer-permissions.integration.test.ts 의 「개발자는 하나뿐」 단언이 깨진다.
 */
async function removeTestUsersByPrefix(): Promise<void> {
  const leftovers = await db
    .select({ id: users.id })
    .from(users)
    .where(like(users.email, `${TEST_EMAIL_PREFIX}%`));
  const ids = leftovers.map((row) => row.id);
  if (ids.length === 0) return;
  // ui_theme_tokens.updated_by → users (restrict): 오버라이드 행이 먼저다.
  await db.delete(uiThemeTokens).where(inArray(uiThemeTokens.updatedBy, ids));
  // audit_logs.actor_user_id → users (restrict): 행위자로만 고른다 —
  // target_record_id 로 고르는 모양은 test-cleanup-static-safety.test.ts 가 금지한다.
  await db.delete(auditLogs).where(inArray(auditLogs.actorUserId, ids));
  await db.delete(users).where(inArray(users.id, ids));
}

before(async () => {
  await removeTestUsersByPrefix();

  assert.equal(
    await storedRowCount(),
    0,
    "이 시험은 ui_theme_tokens 가 비어 있는 상태를 전제로 합니다"
  );

  superAdminId = await createTestUser({ role: "SUPER_ADMIN", name: "UiTheme 최고관리자" });
  // 🔴 개발자 표시가 켜진 A/S 엔지니어 — 이 사람이 통과하는 것이 1번 요구다.
  developerEngineerId = await createTestUser({ isDeveloper: true, name: "UiTheme 개발자 엔지니어" });
  adminId = await createTestUser({ role: "ADMIN", name: "UiTheme 관리자" });
  pendingDeveloperId = await createTestUser({
    isDeveloper: true,
    approvalStatus: "PENDING",
    name: "UiTheme 승인 대기 개발자",
  });
  deletedSuperAdminId = await createTestUser({
    role: "SUPER_ADMIN",
    isDeleted: true,
    deletedAt: new Date(),
    name: "UiTheme 삭제된 최고관리자",
  });
});

afterEach(async () => {
  await db.delete(uiThemeTokens).where(inArray(uiThemeTokens.tokenKey, TOUCHED_TOKEN_KEYS));
});

after(async () => {
  await removeTestUsersByPrefix();
  await pgClient.end({ timeout: 5 });
});

describe("saveUiThemeTokens", () => {
  // ───────────────────────────────────────────────────────────── 인가

  test("1. 최고관리자는 저장할 수 있다", async () => {
    const result = await saveUiThemeTokens({
      changes: [{ tokenKey: "zinc-900", scope: "light", value: "#112233" }],
      actorUserId: superAdminId,
    });

    assert.equal(result.ok, true, `거절됐다: ${JSON.stringify(result)}`);
    if (result.ok) assert.equal(result.changedCount, 1);
    assert.equal(await storedValue("zinc-900", "light"), "#112233");
  });

  test("🔴 1b. 개발자 표시가 켜진 A/S 엔지니어도 저장할 수 있다 — 개발자 모드 관문과 같은 넓이", async () => {
    // 좁히면 편집기는 보이는데 누르면 거절되는 화면이 된다. 화면 토큰은 권한을
    // 하나도 움직이지 않으므로 개발자 표시를 켜는 칸과 달리 좁힐 이유가 없다.
    const result = await saveUiThemeTokens({
      changes: [{ tokenKey: "radius-md", scope: "both", value: "0.5rem" }],
      actorUserId: developerEngineerId,
    });

    assert.equal(result.ok, true, `개발자 엔지니어가 거절됐다: ${JSON.stringify(result)}`);
    assert.equal(await storedValue("radius-md", "both"), "0.5rem");
  });

  test("1c. 개발자 표시가 꺼진 관리자는 거절된다", async () => {
    const auditBefore = await themeAuditCount();
    const result = await saveUiThemeTokens({
      changes: [{ tokenKey: "zinc-900", scope: "light", value: "#112233" }],
      actorUserId: adminId,
    });

    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.code, "FORBIDDEN");
    assert.equal(await storedRowCount(), 0);
    assert.equal(await themeAuditCount(), auditBefore, "거절됐는데 감사 기록이 남았다");
  });

  test("1d. 승인되지 않은 개발자는 거절된다 — 승인은 승격 대상이 아니다", async () => {
    const result = await saveUiThemeTokens({
      changes: [{ tokenKey: "zinc-900", scope: "light", value: "#112233" }],
      actorUserId: pendingDeveloperId,
    });

    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.code, "FORBIDDEN");
    assert.equal(await storedRowCount(), 0);
  });

  test("1e. 없는 계정·지워진 계정은 거절된다 — 트랜잭션 안에서 살아 있는 행을 다시 읽는다", async () => {
    const missing = await saveUiThemeTokens({
      changes: [{ tokenKey: "zinc-900", scope: "light", value: "#112233" }],
      actorUserId: randomUUID(),
    });
    assert.equal(missing.ok, false);
    if (!missing.ok) assert.equal(missing.code, "FORBIDDEN");

    const deleted = await saveUiThemeTokens({
      changes: [{ tokenKey: "zinc-900", scope: "light", value: "#112233" }],
      actorUserId: deletedSuperAdminId,
    });
    assert.equal(deleted.ok, false);
    if (!deleted.ok) assert.equal(deleted.code, "FORBIDDEN");

    assert.equal(await storedRowCount(), 0);
  });

  // ──────────────────────────────────── 「행이 없다 = 코드의 기본값」

  test("2. 기본값과 같은 값을 보내면 행이 생기지 않는다", async () => {
    // 굳이 저장해 두면, 나중에 기본 팔레트를 손볼 때 옛 값이 오버라이드로 굳어
    // 아무 화면도 따라 바뀌지 않는다.
    const result = await saveUiThemeTokens({
      changes: [
        { tokenKey: "zinc-900", scope: "light", value: zinc900.defaultLight },
        { tokenKey: "zinc-900", scope: "dark", value: zinc900.defaultDark },
        // 표기만 다른 같은 값도 마찬가지다 — 정규화가 먼저 눕힌다.
        { tokenKey: "background", scope: "light", value: background.defaultLight.toUpperCase() },
        { tokenKey: "radius-md", scope: "both", value: ".375rem" },
      ],
      actorUserId: superAdminId,
    });

    assert.equal(result.ok, true, `거절됐다: ${JSON.stringify(result)}`);
    if (result.ok) assert.equal(result.changedCount, 0);
    assert.equal(await storedRowCount(), 0);
  });

  test("3. 기본값으로 되돌리면 행이 지워진다 — null 로도, 기본값 문자열로도", async () => {
    await saveUiThemeTokens({
      changes: [
        { tokenKey: "zinc-900", scope: "light", value: "#112233" },
        { tokenKey: "radius-md", scope: "both", value: "0.5rem" },
      ],
      actorUserId: superAdminId,
    });
    assert.equal(await storedRowCount(), 2);

    const byNull = await saveUiThemeTokens({
      changes: [{ tokenKey: "zinc-900", scope: "light", value: null }],
      actorUserId: superAdminId,
    });
    assert.equal(byNull.ok, true);
    if (byNull.ok) assert.equal(byNull.changedCount, 1, "지운 것도 바뀐 것으로 센다");
    assert.equal(await storedValue("zinc-900", "light"), null);

    const byDefaultString = await saveUiThemeTokens({
      changes: [{ tokenKey: "radius-md", scope: "both", value: radiusMd.defaultLight }],
      actorUserId: superAdminId,
    });
    assert.equal(byDefaultString.ok, true);
    if (byDefaultString.ok) assert.equal(byDefaultString.changedCount, 1);
    assert.equal(await storedValue("radius-md", "both"), null);

    assert.equal(await storedRowCount(), 0);
  });

  test("3b. 행이 없는데 되돌리면 아무 일도 일어나지 않는다", async () => {
    const result = await saveUiThemeTokens({
      changes: [{ tokenKey: "zinc-900", scope: "dark", value: null }],
      actorUserId: superAdminId,
    });

    assert.equal(result.ok, true);
    if (result.ok) assert.equal(result.changedCount, 0);
    assert.equal(await storedRowCount(), 0);
  });

  test("4. 라이트만 바꾸면 다크 행은 생기지 않는다", async () => {
    // 행 둘 + scope 로 나눈 이유가 이것이다 — 한쪽만 되돌릴 수 있어야 한다.
    const result = await saveUiThemeTokens({
      changes: [{ tokenKey: "zinc-900", scope: "light", value: "#112233" }],
      actorUserId: superAdminId,
    });

    assert.equal(result.ok, true);
    assert.equal(await storedValue("zinc-900", "light"), "#112233");
    assert.equal(await storedValue("zinc-900", "dark"), null, "건드리지 않은 다크에 행이 생겼다");
    assert.equal(await storedRowCount(), 1);
  });

  // ───────────────────────────────────────────────────────── 감사 기록

  test("5. 감사 기록의 모양 — 처음 저장은 CREATE 이고 이전 값이 코드 기본값이다", async () => {
    // 행 순서를 믿지 않는다(ORDER BY 없는 SELECT 는 순서를 보장하지 않는다) —
    // 저장 한 번마다 "못 보던 id" 를 골라 그 줄만 본다.
    const seen = new Set((await themeAuditRows()).map((row) => row.id));
    async function newlyAdded() {
      const rows = (await themeAuditRows()).filter((row) => !seen.has(row.id));
      for (const row of rows) seen.add(row.id);
      return rows;
    }

    await saveUiThemeTokens({
      changes: [{ tokenKey: "zinc-900", scope: "light", value: "#112233" }],
      actorUserId: superAdminId,
    });

    const [savedRow] = await db
      .select({ id: uiThemeTokens.id })
      .from(uiThemeTokens)
      .where(and(eq(uiThemeTokens.tokenKey, "zinc-900"), eq(uiThemeTokens.scope, "light")));
    assert.ok(savedRow, "저장된 행이 없다");

    const created = await newlyAdded();
    assert.equal(created.length, 1);
    assert.equal(created[0].actorUserId, superAdminId);
    assert.equal(created[0].actionType, "CREATE");
    assert.equal(created[0].targetEntity, "ui_theme_tokens");
    assert.equal(created[0].targetRecordId, savedRow.id, "행 하나를 정확히 가리켜야 한다");
    assert.deepEqual(created[0].previousValue, {
      tokenKey: "zinc-900",
      scope: "light",
      // 행이 없던 자리의 "이전 값"은 그때 실제로 통하던 값, 즉 코드의 기본값이다.
      value: zinc900.defaultLight,
    });
    assert.deepEqual(created[0].newValue, {
      tokenKey: "zinc-900",
      scope: "light",
      value: "#112233",
    });

    // 값 변경은 UPDATE.
    await saveUiThemeTokens({
      changes: [{ tokenKey: "zinc-900", scope: "light", value: "#223344" }],
      actorUserId: superAdminId,
    });
    const updated = await newlyAdded();
    assert.equal(updated.length, 1);
    assert.equal(updated[0].actionType, "UPDATE");
    assert.equal(updated[0].targetRecordId, savedRow.id, "같은 행을 가리켜야 한다");
    assert.deepEqual(updated[0].previousValue, {
      tokenKey: "zinc-900",
      scope: "light",
      value: "#112233",
    });

    // 🔴 기본값 복귀도 UPDATE 다 — 자료가 없어진 것이 아니라 기본값으로 돌아간
    // 것이라, SOFT_DELETE/PURGE 로 남기면 로그를 읽는 사람에게 오해를 만든다.
    await saveUiThemeTokens({
      changes: [{ tokenKey: "zinc-900", scope: "light", value: null }],
      actorUserId: superAdminId,
    });
    const reverted = await newlyAdded();
    assert.equal(reverted.length, 1);
    assert.equal(reverted[0].actionType, "UPDATE");
    assert.deepEqual(reverted[0].newValue, {
      tokenKey: "zinc-900",
      scope: "light",
      value: zinc900.defaultLight,
      revertedToDefault: true,
    });
  });

  test("5b. 바뀐 것이 없으면 감사 기록도 남지 않는다", async () => {
    await saveUiThemeTokens({
      changes: [{ tokenKey: "zinc-900", scope: "light", value: "#112233" }],
      actorUserId: superAdminId,
    });
    const before = await themeAuditCount();

    const again = await saveUiThemeTokens({
      changes: [{ tokenKey: "zinc-900", scope: "light", value: "#112233" }],
      actorUserId: superAdminId,
    });

    assert.equal(again.ok, true);
    if (again.ok) assert.equal(again.changedCount, 0);
    assert.equal(await themeAuditCount(), before, "같은 값을 다시 저장했는데 기록이 늘었다");
  });

  // ─────────────────────────────────── 값 하나가 막으면 전부가 막힌다

  test("🔴 6. 뒤엣값이 막히면 앞엣값도 저장되지 않는다 — return 이었다면 앞줄이 남는다", async () => {
    // 액션 층의 사전 검증을 거치지 않도록 mutation 을 직접 부른다. 앞줄은 그
    // 자체로 정상이라 이미 저장된 뒤에 뒷줄이 막힌다 — 그때 트랜잭션째 되돌아가는지가
    // 이 시험의 전부다.
    const auditBefore = await themeAuditCount();

    const result = await saveUiThemeTokens({
      changes: [
        { tokenKey: "zinc-900", scope: "light", value: "#112233" }, // 그 자체로는 정상
        { tokenKey: "zinc-800", scope: "light", value: "oklch(0.5 0.1 200)" }, // 여기서 막힌다
      ],
      actorUserId: superAdminId,
    });

    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.code, "INVALID_INPUT");
    assert.equal(
      await storedValue("zinc-900", "light"),
      null,
      "뒷줄이 막혔는데 앞줄이 남았다 — 거절이 throw 가 아니라 return 이다"
    );
    assert.equal(await storedRowCount(), 0);
    assert.equal(await themeAuditCount(), auditBefore, "되돌아갔는데 감사 기록이 남았다");
  });

  test("6b. 등록부에 없는 키·안 맞는 스코프·중복도 거절이다 — 조용히 버리지 않는다", async () => {
    const cases: { label: string; changes: { tokenKey: string; scope: string; value: string | null }[] }[] = [
      {
        label: "등록부에 없는 키",
        changes: [{ tokenKey: "zinc-1000", scope: "light", value: "#112233" }],
      },
      {
        label: "색인데 both",
        changes: [{ tokenKey: "zinc-900", scope: "both", value: "#112233" }],
      },
      {
        label: "모서리인데 light",
        changes: [{ tokenKey: "radius-md", scope: "light", value: "0.5rem" }],
      },
      {
        label: "셋 중 하나가 아닌 스코프",
        changes: [{ tokenKey: "zinc-900", scope: "print", value: "#112233" }],
      },
      {
        label: "같은 (토큰, 스코프)가 두 번",
        changes: [
          { tokenKey: "zinc-900", scope: "light", value: "#112233" },
          { tokenKey: "zinc-900", scope: "light", value: "#223344" },
        ],
      },
    ];

    for (const { label, changes } of cases) {
      const result = await saveUiThemeTokens({ changes, actorUserId: superAdminId });
      assert.equal(result.ok, false, `${label}: 통과했다`);
      if (!result.ok) assert.equal(result.code, "INVALID_INPUT", label);
      assert.equal(await storedRowCount(), 0, `${label}: 거절됐는데 행이 남았다`);
    }
  });

  // ─────────────────────────────────────────────────────── 대비 하한

  test("🔴 7. 대비 하한(3:1)을 깨면 거절되고 표는 그대로다 — 한쪽만 바꿔도 합쳐서 잰다", async () => {
    const auditBefore = await themeAuditCount();

    // 바꾸는 것은 바탕 하나뿐인데, 재는 것은 (본문 글자, 바탕) 짝이다. 들어온
    // 값만 재면 이 조합이 그대로 통과한다.
    const result = await saveUiThemeTokens({
      changes: [{ tokenKey: "background", scope: "light", value: foreground.defaultLight }],
      actorUserId: superAdminId,
    });

    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.code, "INVALID_INPUT");
      assert.match(result.message, /대비/);
    }
    assert.equal(await storedRowCount(), 0, "거절됐는데 행이 남았다");
    assert.equal(await themeAuditCount(), auditBefore);
  });

  test("7b. 짝을 함께 옮기면 통과한다 — 경고선(4.5)이 아니라 하한(3)만 막는다", async () => {
    // 라이트를 어둡게 뒤집는다. 셋을 함께 보내야 통과한다는 것이 「합쳐진 결과로
    // 잰다」의 다른 쪽 얼굴이다.
    const result = await saveUiThemeTokens({
      changes: [
        { tokenKey: "background", scope: "light", value: "#111111" },
        { tokenKey: "foreground", scope: "light", value: "#ffffff" },
        { tokenKey: "zinc-900", scope: "light", value: "#fafafa" },
      ],
      actorUserId: developerEngineerId,
    });

    assert.equal(result.ok, true, `거절됐다: ${JSON.stringify(result)}`);
    if (result.ok) assert.equal(result.changedCount, 3);
    assert.equal(await storedValue("background", "light"), "#111111");
  });

  // ───────────────────────────────────────────────── 끝에서 끝까지

  test("🔴 8. 저장 → 읽기 → 병합 → 직렬화가 기대한 CSS 를 낸다", async () => {
    const result = await saveUiThemeTokens({
      changes: [
        { tokenKey: "zinc-900", scope: "light", value: "#111111" },
        { tokenKey: "zinc-900", scope: "dark", value: "#000000" },
        { tokenKey: "radius-md", scope: "both", value: "0.5rem" },
        { tokenKey: "text-sm", scope: "both", value: "0.9375rem" },
      ],
      actorUserId: superAdminId,
    });
    assert.equal(result.ok, true, `거절됐다: ${JSON.stringify(result)}`);

    const stored = await loadStoredUiThemeTokens();
    assert.equal(stored.length, 4);

    const resolved = resolveUiTheme(stored);
    assert.equal(resolved.light["zinc-900"], "#111111");
    assert.equal(resolved.dark["zinc-900"], "#000000");
    assert.equal(resolved.light["radius-md"], "0.5rem");
    assert.equal(resolved.dark["radius-md"], "0.5rem", "공용 토큰이 다크에도 얹혀야 한다");
    assert.equal(resolved.light["background"], background.defaultLight, "안 건드린 값은 기본값이다");

    const css = serializeUiThemeCss(stored);
    // 🔴 라이트 블록의 `:not(.dark)` — 빠지면 다크 모드에서 배경이 흰색이 되고,
    // 라이트로만 보는 사람에게는 영영 안 보이는 고장이다.
    assert.ok(css.includes(":root:root:not(.dark){"), `라이트 블록 선택자가 다르다: ${css}`);
    assert.equal(
      css,
      ":root:root:not(.dark){--color-zinc-900:#111111}\n" +
        ":root:root.dark{--color-zinc-900:#000000}\n" +
        ":root:root{--radius-md:0.5rem;--text-sm:0.9375rem}"
    );
  });

  // ───────────────────────────────────────────── 주간보고 전용 토큰

  test("🔴 10. 주간보고 크기 — 저장하면 CSS 에 실리고, 되돌리면 행이 지워지고, 감사가 남는다", async () => {
    const seen = new Set((await themeAuditRows()).map((row) => row.id));
    async function newlyAdded() {
      const rows = (await themeAuditRows()).filter((row) => !seen.has(row.id));
      for (const row of rows) seen.add(row.id);
      return rows;
    }

    // 개발자 표시가 켜진 엔지니어로 저장한다 — 주간보고 편집 화면도 개발자 모드 안에
    // 들어갈 자리라 인가 넓이가 같아야 한다.
    const saved = await saveUiThemeTokens({
      changes: [
        { tokenKey: "text-wr-body", scope: "both", value: ".875rem" },
        { tokenKey: "spacing-wr-table-min", scope: "both", value: "12rem" },
      ],
      actorUserId: developerEngineerId,
    });
    assert.equal(saved.ok, true, `거절됐다: ${JSON.stringify(saved)}`);
    if (saved.ok) assert.equal(saved.changedCount, 2);
    assert.equal(await storedValue("text-wr-body", "both"), "0.875rem", "정규화된 값으로 저장돼야 한다");
    assert.equal(await storedValue("spacing-wr-table-min", "both"), "12rem");

    // 읽기 → 병합 → 직렬화. 공용 블록 하나에만 실리고, 앱 전체 글자 크기는 안 나온다.
    const stored = await loadStoredUiThemeTokens();
    assert.equal(stored.length, 2);
    const resolved = resolveUiTheme(stored);
    assert.equal(resolved.light["text-wr-body"], "0.875rem");
    assert.equal(resolved.dark["text-wr-body"], "0.875rem", "공용 토큰이 다크에도 얹혀야 한다");
    assert.equal(resolved.light["text-xs"], tokenOf("text-xs").defaultLight, "앱 전체 글자 크기는 그대로다");
    assert.equal(
      serializeUiThemeCss(stored),
      ":root:root{--text-wr-body:0.875rem;--spacing-wr-table-min:12rem}"
    );

    // 감사 — 처음 저장은 CREATE, 이전 값은 코드 기본값(= globals.css 값).
    const created = await newlyAdded();
    assert.equal(created.length, 2);
    for (const row of created) {
      assert.equal(row.actionType, "CREATE");
      assert.equal(row.actorUserId, developerEngineerId);
      assert.equal(row.targetEntity, "ui_theme_tokens");
    }
    const createdBody = created.find(
      (row) => (row.newValue as { tokenKey?: string } | null)?.tokenKey === "text-wr-body"
    );
    assert.ok(createdBody, "text-wr-body 의 감사 기록이 없다");
    assert.deepEqual(createdBody.previousValue, {
      tokenKey: "text-wr-body",
      scope: "both",
      value: weeklyBody.defaultLight,
    });
    assert.deepEqual(createdBody.newValue, { tokenKey: "text-wr-body", scope: "both", value: "0.875rem" });

    // 되돌리기 — null 로도, 기본값 문자열(표기만 다른 것)로도 행이 지워진다.
    const reverted = await saveUiThemeTokens({
      changes: [
        { tokenKey: "text-wr-body", scope: "both", value: null },
        { tokenKey: "spacing-wr-table-min", scope: "both", value: "8.0rem" },
      ],
      actorUserId: developerEngineerId,
    });
    assert.equal(reverted.ok, true, `거절됐다: ${JSON.stringify(reverted)}`);
    if (reverted.ok) assert.equal(reverted.changedCount, 2);
    assert.equal(await storedRowCount(), 0, "되돌렸는데 행이 남았다");
    assert.equal(serializeUiThemeCss(await loadStoredUiThemeTokens()), "", "되돌렸는데 CSS 가 남았다");

    // 🔴 기본값 복귀도 UPDATE 다(시험 5와 같은 판단).
    const revertAudit = await newlyAdded();
    assert.equal(revertAudit.length, 2);
    for (const row of revertAudit) assert.equal(row.actionType, "UPDATE");
    const revertedTableMin = revertAudit.find(
      (row) => (row.newValue as { tokenKey?: string } | null)?.tokenKey === "spacing-wr-table-min"
    );
    assert.ok(revertedTableMin, "spacing-wr-table-min 의 되돌리기 감사 기록이 없다");
    assert.deepEqual(revertedTableMin.previousValue, {
      tokenKey: "spacing-wr-table-min",
      scope: "both",
      value: "12rem",
    });
    assert.deepEqual(revertedTableMin.newValue, {
      tokenKey: "spacing-wr-table-min",
      scope: "both",
      value: weeklyTableMin.defaultLight,
      revertedToDefault: true,
    });
  });

  test("10b. 주간보고 크기의 범위 밖 · 단위 틀린 값 · 안 맞는 스코프는 거절되고 표는 그대로다", async () => {
    const auditBefore = await themeAuditCount();
    const cases: { label: string; change: { tokenKey: string; scope: string; value: string } }[] = [
      {
        label: "상세표 최소 높이 상한(20rem) 밖",
        change: { tokenKey: "spacing-wr-table-min", scope: "both", value: "21rem" },
      },
      {
        label: "표 칸 여백 상한(1rem) 밖",
        change: { tokenKey: "spacing-wr-cell-x", scope: "both", value: "1.5rem" },
      },
      { label: "상자 크기에 px", change: { tokenKey: "spacing-wr-block", scope: "both", value: "8px" } },
      {
        label: "상자 크기에 규칙 탈출",
        change: { tokenKey: "spacing-wr-block", scope: "both", value: "0.5rem;}body{display:none}" },
      },
      {
        label: "글자 크기 상한(1.5rem) 밖",
        change: { tokenKey: "text-wr-title", scope: "both", value: "1.75rem" },
      },
      { label: "글자 크기에 px", change: { tokenKey: "text-wr-title", scope: "both", value: "20px" } },
      {
        label: "공용 토큰인데 light",
        change: { tokenKey: "text-wr-body", scope: "light", value: "0.875rem" },
      },
    ];

    for (const { label, change } of cases) {
      const result = await saveUiThemeTokens({ changes: [change], actorUserId: superAdminId });
      assert.equal(result.ok, false, `${label}: 통과했다`);
      if (!result.ok) assert.equal(result.code, "INVALID_INPUT", label);
      assert.equal(await storedRowCount(), 0, `${label}: 거절됐는데 행이 남았다`);
    }
    assert.equal(await themeAuditCount(), auditBefore, "거절됐는데 감사 기록이 남았다");
  });

  test("9. 개발자로 표시된 계정은 이 파일이 만든 것뿐이다 — 시험이 다른 계정을 승격하지 않았다", async () => {
    const flagged = await db.select({ id: users.id }).from(users).where(eq(users.isDeveloper, true));
    for (const row of flagged) {
      assert.ok(
        createdTestUserIds.includes(row.id),
        `이 파일이 만들지 않은 계정에 개발자 표시가 켜져 있다: ${row.id}`
      );
    }
  });
});
