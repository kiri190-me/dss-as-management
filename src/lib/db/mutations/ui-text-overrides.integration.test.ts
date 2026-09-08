import "../../../../scripts/load-env";

import { after, afterEach, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { and, eq, inArray, like } from "drizzle-orm";
import { db, pgClient } from "../connection";
import { auditLogs, uiTextOverrides, users } from "../schema";
import { saveUiTextOverrides } from "./ui-text-overrides";
import { loadStoredUiTextOverrides } from "../queries/ui-text-overrides";
import { resolveUiText, UI_TEXT_GROUPS, UI_TEXT_MAX_LENGTH } from "@/lib/domain/ui-text-overrides";
import { repairStatusLabels, roleLabels } from "@/lib/domain/types";

/**
 * ============================================================================
 * saveUiTextOverrides() — 실제 DB (시험 DB)
 * ============================================================================
 * ui-theme-tokens.integration.test.ts 와 같은 방식이다: 이 파일이 만든
 * "uitext-test-" 계정만 쓰고, after() 에서 그 계정이 남긴 오버라이드 행과 감사
 * 기록까지 지운다(ui_text_overrides.updated_by → users 가 restrict 라 순서가 있다).
 * 씨앗 계정은 읽지 않는다 — 행위자를 전부 여기서 만든다.
 *
 * 여기서 지키려는 것은 넷이다:
 *  1. **인가는 개발자 모드 관문과 같은 넓이다.** 개발자 표시가 켜진 엔지니어가
 *     통과해야 한다 — 좁히면 "들어와서 편집기는 보이는데 누르면 거절"이 된다.
 *  2. **기본 문구와 같은 값은 행으로 남지 않고, 되돌리면 행이 지워진다.**
 *  3. 🔴 **문구 하나가 막히면 같이 보낸 전부가 막힌다.** 트랜잭션 콜백에서 그냥
 *     반환하면 커밋되므로, 앞줄이 이미 저장된 뒤 뒷줄이 막히는 경우를 실제로
 *     만들어 앞줄까지 사라졌는지 본다.
 *  4. **끝에서 끝까지** — 저장한 값이 조회와 병합을 지나 기대한 문구로 나온다.
 * ============================================================================
 */

const TEST_EMAIL_PREFIX = "uitext-test-";

/** 이 파일이 건드리는 묶음. 뒷정리를 이 목록으로 좁힌다. */
const TOUCHED_GROUP_KEYS = ["role", "repairStatus", "priority", "billingType"];

let superAdminId: string;
let developerEngineerId: string;
let adminId: string;
let pendingDeveloperId: string;
let deletedSuperAdminId: string;
const createdTestUserIds: string[] = [];

async function createTestUser(overrides: Partial<typeof users.$inferInsert> = {}): Promise<string> {
  const [row] = await db
    .insert(users)
    .values({
      email: `${TEST_EMAIL_PREFIX}${randomUUID().slice(0, 8)}@example.test`,
      name: "UiText Test User",
      role: "AS_ENGINEER",
      approvalStatus: "APPROVED",
      isActive: true,
      ...overrides,
    })
    .returning({ id: users.id });
  createdTestUserIds.push(row.id);
  return row.id;
}

async function storedValue(groupKey: string, itemKey: string): Promise<string | null> {
  const [row] = await db
    .select({ value: uiTextOverrides.value })
    .from(uiTextOverrides)
    .where(and(eq(uiTextOverrides.groupKey, groupKey), eq(uiTextOverrides.itemKey, itemKey)));
  return row?.value ?? null;
}

async function storedRowCount(): Promise<number> {
  const rows = await db.select({ id: uiTextOverrides.id }).from(uiTextOverrides);
  return rows.length;
}

/** 화면 문구에 남은 감사 기록 — 이 표에 남는 것만 고른다. */
async function textAuditRows() {
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
    .where(eq(auditLogs.targetEntity, "ui_text_overrides"));
}

async function textAuditCount(): Promise<number> {
  return (await textAuditRows()).length;
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
  // ui_text_overrides.updated_by → users (restrict): 오버라이드 행이 먼저다.
  await db.delete(uiTextOverrides).where(inArray(uiTextOverrides.updatedBy, ids));
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
    "이 시험은 ui_text_overrides 가 비어 있는 상태를 전제로 합니다"
  );

  superAdminId = await createTestUser({ role: "SUPER_ADMIN", name: "UiText 최고관리자" });
  // 🔴 개발자 표시가 켜진 A/S 엔지니어 — 이 사람이 통과하는 것이 1번 요구다.
  developerEngineerId = await createTestUser({ isDeveloper: true, name: "UiText 개발자 엔지니어" });
  adminId = await createTestUser({ role: "ADMIN", name: "UiText 관리자" });
  pendingDeveloperId = await createTestUser({
    isDeveloper: true,
    approvalStatus: "PENDING",
    name: "UiText 승인 대기 개발자",
  });
  deletedSuperAdminId = await createTestUser({
    role: "SUPER_ADMIN",
    isDeleted: true,
    deletedAt: new Date(),
    name: "UiText 삭제된 최고관리자",
  });
});

afterEach(async () => {
  await db.delete(uiTextOverrides).where(inArray(uiTextOverrides.groupKey, TOUCHED_GROUP_KEYS));
});

after(async () => {
  await removeTestUsersByPrefix();
  await pgClient.end({ timeout: 5 });
});

describe("saveUiTextOverrides", () => {
  // ───────────────────────────────────────────────────────────── 인가

  test("1. 최고관리자는 저장할 수 있다", async () => {
    const result = await saveUiTextOverrides({
      changes: [{ groupKey: "role", itemKey: "SUPER_ADMIN", value: "시스템 관리자" }],
      actorUserId: superAdminId,
    });

    assert.equal(result.ok, true, `거절됐다: ${JSON.stringify(result)}`);
    if (result.ok) assert.equal(result.changedCount, 1);
    assert.equal(await storedValue("role", "SUPER_ADMIN"), "시스템 관리자");
  });

  test("🔴 1b. 개발자 표시가 켜진 A/S 엔지니어도 저장할 수 있다 — 개발자 모드 관문과 같은 넓이", async () => {
    // 좁히면 편집기는 보이는데 누르면 거절되는 화면이 된다. 화면 문구는 권한을
    // 하나도 움직이지 않으므로 개발자 표시를 켜는 칸과 달리 좁힐 이유가 없다.
    const result = await saveUiTextOverrides({
      changes: [{ groupKey: "priority", itemKey: "URGENT", value: "아주 급함" }],
      actorUserId: developerEngineerId,
    });

    assert.equal(result.ok, true, `개발자 엔지니어가 거절됐다: ${JSON.stringify(result)}`);
    assert.equal(await storedValue("priority", "URGENT"), "아주 급함");
  });

  test("1c. 개발자 표시가 꺼진 관리자는 거절된다", async () => {
    const auditBefore = await textAuditCount();
    const result = await saveUiTextOverrides({
      changes: [{ groupKey: "role", itemKey: "SUPER_ADMIN", value: "시스템 관리자" }],
      actorUserId: adminId,
    });

    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.code, "FORBIDDEN");
    assert.equal(await storedRowCount(), 0);
    assert.equal(await textAuditCount(), auditBefore, "거절됐는데 감사 기록이 남았다");
  });

  test("1d. 승인되지 않은 개발자는 거절된다 — 승인은 승격 대상이 아니다", async () => {
    const result = await saveUiTextOverrides({
      changes: [{ groupKey: "role", itemKey: "SUPER_ADMIN", value: "시스템 관리자" }],
      actorUserId: pendingDeveloperId,
    });

    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.code, "FORBIDDEN");
    assert.equal(await storedRowCount(), 0);
  });

  test("1e. 없는 계정·지워진 계정은 거절된다 — 트랜잭션 안에서 살아 있는 행을 다시 읽는다", async () => {
    const missing = await saveUiTextOverrides({
      changes: [{ groupKey: "role", itemKey: "SUPER_ADMIN", value: "시스템 관리자" }],
      actorUserId: randomUUID(),
    });
    assert.equal(missing.ok, false);
    if (!missing.ok) assert.equal(missing.code, "FORBIDDEN");

    const deleted = await saveUiTextOverrides({
      changes: [{ groupKey: "role", itemKey: "SUPER_ADMIN", value: "시스템 관리자" }],
      actorUserId: deletedSuperAdminId,
    });
    assert.equal(deleted.ok, false);
    if (!deleted.ok) assert.equal(deleted.code, "FORBIDDEN");

    assert.equal(await storedRowCount(), 0);
  });

  // ─────────────────────────────────── 「행이 없다 = 코드의 기본 문구」

  test("2. 기본 문구와 같은 값을 보내면 행이 생기지 않는다", async () => {
    // 굳이 저장해 두면, 나중에 types.ts 의 기본 문구를 손볼 때 옛 문구가
    // 오버라이드로 굳어 아무 화면도 따라 바뀌지 않는다.
    const result = await saveUiTextOverrides({
      changes: [
        { groupKey: "role", itemKey: "ADMIN", value: roleLabels.ADMIN },
        { groupKey: "repairStatus", itemKey: "IN_REPAIR", value: repairStatusLabels.IN_REPAIR },
        // 표기만 다른 같은 문구도 마찬가지다 — 정규화가 먼저 눕힌다.
        { groupKey: "role", itemKey: "SALES", value: `  ${roleLabels.SALES.replace(" ", "   ")}  ` },
      ],
      actorUserId: superAdminId,
    });

    assert.equal(result.ok, true, `거절됐다: ${JSON.stringify(result)}`);
    if (result.ok) assert.equal(result.changedCount, 0);
    assert.equal(await storedRowCount(), 0);
  });

  test("3. 기본 문구로 되돌리면 행이 지워진다 — null 로도, 기본 문구 문자열로도", async () => {
    await saveUiTextOverrides({
      changes: [
        { groupKey: "role", itemKey: "ADMIN", value: "매니저" },
        { groupKey: "repairStatus", itemKey: "IN_REPAIR", value: "수리 진행 중" },
      ],
      actorUserId: superAdminId,
    });
    assert.equal(await storedRowCount(), 2);

    const byNull = await saveUiTextOverrides({
      changes: [{ groupKey: "role", itemKey: "ADMIN", value: null }],
      actorUserId: superAdminId,
    });
    assert.equal(byNull.ok, true);
    if (byNull.ok) assert.equal(byNull.changedCount, 1, "지운 것도 바뀐 것으로 센다");
    assert.equal(await storedValue("role", "ADMIN"), null);

    const byDefaultString = await saveUiTextOverrides({
      changes: [
        { groupKey: "repairStatus", itemKey: "IN_REPAIR", value: repairStatusLabels.IN_REPAIR },
      ],
      actorUserId: superAdminId,
    });
    assert.equal(byDefaultString.ok, true);
    if (byDefaultString.ok) assert.equal(byDefaultString.changedCount, 1);
    assert.equal(await storedValue("repairStatus", "IN_REPAIR"), null);

    assert.equal(await storedRowCount(), 0);
  });

  test("3b. 행이 없는데 되돌리면 아무 일도 일어나지 않는다", async () => {
    const result = await saveUiTextOverrides({
      changes: [{ groupKey: "role", itemKey: "SALES", value: null }],
      actorUserId: superAdminId,
    });

    assert.equal(result.ok, true);
    if (result.ok) assert.equal(result.changedCount, 0);
    assert.equal(await storedRowCount(), 0);
  });

  test("4. 한 항목을 바꿔도 같은 묶음의 다른 항목에는 행이 생기지 않는다", async () => {
    const result = await saveUiTextOverrides({
      changes: [{ groupKey: "role", itemKey: "ADMIN", value: "매니저" }],
      actorUserId: superAdminId,
    });

    assert.equal(result.ok, true);
    assert.equal(await storedValue("role", "ADMIN"), "매니저");
    assert.equal(await storedValue("role", "SUPER_ADMIN"), null, "건드리지 않은 항목에 행이 생겼다");
    assert.equal(await storedRowCount(), 1);
  });

  // ────────────────────────────────────────────────────────── 감사 기록

  test("5. 감사 기록의 모양 — 처음 저장은 CREATE 이고 이전 값이 코드 기본 문구다", async () => {
    // 행 순서를 믿지 않는다(ORDER BY 없는 SELECT 는 순서를 보장하지 않는다) —
    // 저장 한 번마다 "못 보던 id" 를 골라 그 줄만 본다.
    const seen = new Set((await textAuditRows()).map((row) => row.id));
    async function newlyAdded() {
      const rows = (await textAuditRows()).filter((row) => !seen.has(row.id));
      for (const row of rows) seen.add(row.id);
      return rows;
    }

    await saveUiTextOverrides({
      changes: [{ groupKey: "role", itemKey: "ADMIN", value: "매니저" }],
      actorUserId: superAdminId,
    });

    const [savedRow] = await db
      .select({ id: uiTextOverrides.id })
      .from(uiTextOverrides)
      .where(and(eq(uiTextOverrides.groupKey, "role"), eq(uiTextOverrides.itemKey, "ADMIN")));
    assert.ok(savedRow, "저장된 행이 없다");

    const created = await newlyAdded();
    assert.equal(created.length, 1);
    assert.equal(created[0].actorUserId, superAdminId);
    assert.equal(created[0].actionType, "CREATE");
    assert.equal(created[0].targetEntity, "ui_text_overrides");
    assert.equal(created[0].targetRecordId, savedRow.id, "행 하나를 정확히 가리켜야 한다");
    assert.deepEqual(created[0].previousValue, {
      groupKey: "role",
      itemKey: "ADMIN",
      // 행이 없던 자리의 "이전 값"은 그때 실제로 통하던 말, 즉 코드의 기본 문구다.
      value: roleLabels.ADMIN,
    });
    assert.deepEqual(created[0].newValue, {
      groupKey: "role",
      itemKey: "ADMIN",
      value: "매니저",
    });

    // 값 변경은 UPDATE.
    await saveUiTextOverrides({
      changes: [{ groupKey: "role", itemKey: "ADMIN", value: "책임 관리자" }],
      actorUserId: superAdminId,
    });
    const updated = await newlyAdded();
    assert.equal(updated.length, 1);
    assert.equal(updated[0].actionType, "UPDATE");
    assert.equal(updated[0].targetRecordId, savedRow.id, "같은 행을 가리켜야 한다");
    assert.deepEqual(updated[0].previousValue, {
      groupKey: "role",
      itemKey: "ADMIN",
      value: "매니저",
    });

    // 🔴 기본값 복귀도 UPDATE 다 — 자료가 없어진 것이 아니라 기본 문구로 돌아간
    // 것이라, SOFT_DELETE/PURGE 로 남기면 로그를 읽는 사람에게 오해를 만든다.
    await saveUiTextOverrides({
      changes: [{ groupKey: "role", itemKey: "ADMIN", value: null }],
      actorUserId: superAdminId,
    });
    const reverted = await newlyAdded();
    assert.equal(reverted.length, 1);
    assert.equal(reverted[0].actionType, "UPDATE");
    assert.deepEqual(reverted[0].newValue, {
      groupKey: "role",
      itemKey: "ADMIN",
      value: roleLabels.ADMIN,
      revertedToDefault: true,
    });
  });

  test("5b. 바뀐 것이 없으면 감사 기록도 남지 않는다", async () => {
    await saveUiTextOverrides({
      changes: [{ groupKey: "role", itemKey: "ADMIN", value: "매니저" }],
      actorUserId: superAdminId,
    });
    const before = await textAuditCount();

    const again = await saveUiTextOverrides({
      changes: [{ groupKey: "role", itemKey: "ADMIN", value: "매니저" }],
      actorUserId: superAdminId,
    });

    assert.equal(again.ok, true);
    if (again.ok) assert.equal(again.changedCount, 0);
    assert.equal(await textAuditCount(), before, "같은 문구를 다시 저장했는데 기록이 늘었다");
  });

  // ────────────────────────────────── 문구 하나가 막으면 전부가 막힌다

  test("🔴 6. 뒤엣값이 막히면 앞엣값도 저장되지 않는다 — return 이었다면 앞줄이 남는다", async () => {
    // 액션 층의 사전 검증을 거치지 않도록 mutation 을 직접 부른다. 앞줄은 그
    // 자체로 정상이라 이미 저장된 뒤에 뒷줄이 막힌다 — 그때 트랜잭션째 되돌아가는지가
    // 이 시험의 전부다.
    const auditBefore = await textAuditCount();

    const result = await saveUiTextOverrides({
      changes: [
        { groupKey: "role", itemKey: "ADMIN", value: "매니저" }, // 그 자체로는 정상
        // 줄바꿈이 섞인 문구 — 표 머리·배지가 두 줄이 되는 값이라 여기서 막힌다.
        {
          groupKey: "repairStatus",
          itemKey: "IN_REPAIR",
          value: `수리${String.fromCharCode(10)}진행 중`,
        },
      ],
      actorUserId: superAdminId,
    });

    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.code, "INVALID_INPUT");
    assert.equal(
      await storedValue("role", "ADMIN"),
      null,
      "뒷줄이 막혔는데 앞줄이 남았다 — 거절이 throw 가 아니라 return 이다"
    );
    assert.equal(await storedRowCount(), 0);
    assert.equal(await textAuditCount(), auditBefore, "되돌아갔는데 감사 기록이 남았다");
  });

  test("6b. 모르는 키·빈 문구·너무 긴 문구·중복도 거절이다 — 조용히 버리지 않는다", async () => {
    const cases: {
      label: string;
      changes: { groupKey: string; itemKey: string; value: string | null }[];
    }[] = [
      {
        label: "등록부에 없는 묶음",
        changes: [{ groupKey: "nope", itemKey: "ADMIN", value: "매니저" }],
      },
      {
        label: "묶음 안에 없는 항목",
        changes: [{ groupKey: "role", itemKey: "IN_REPAIR", value: "매니저" }],
      },
      {
        label: "일부러 뺀 표(제품 구분)",
        changes: [{ groupKey: "productCategory", itemKey: "PAID_MATCHER", value: "매처" }],
      },
      {
        label: "일부러 뺀 표(예외 상태)",
        changes: [{ groupKey: "exceptionStatus", itemKey: "ON_HOLD", value: "멈춤" }],
      },
      {
        label: "빈 문구",
        changes: [{ groupKey: "role", itemKey: "ADMIN", value: "   " }],
      },
      {
        label: "상한을 넘는 문구",
        changes: [
          { groupKey: "role", itemKey: "ADMIN", value: "가".repeat(UI_TEXT_MAX_LENGTH + 1) },
        ],
      },
      {
        label: "같은 (묶음, 항목)이 두 번",
        changes: [
          { groupKey: "role", itemKey: "ADMIN", value: "매니저" },
          { groupKey: "role", itemKey: "ADMIN", value: "책임자" },
        ],
      },
    ];

    for (const { label, changes } of cases) {
      const result = await saveUiTextOverrides({ changes, actorUserId: superAdminId });
      assert.equal(result.ok, false, `${label}: 통과했다`);
      if (!result.ok) assert.equal(result.code, "INVALID_INPUT", label);
      assert.equal(await storedRowCount(), 0, `${label}: 거절됐는데 행이 남았다`);
    }
  });

  // ─────────────────────────────────────────────────── 끝에서 끝까지

  test("🔴 7. 저장 → 읽기 → 병합이 기대한 문구를 낸다", async () => {
    const result = await saveUiTextOverrides({
      changes: [
        { groupKey: "role", itemKey: "ADMIN", value: "매니저" },
        { groupKey: "repairStatus", itemKey: "IN_REPAIR", value: "수리 진행 중" },
        // 정규화가 저장 전에 눕힌다 — 읽어 오는 값은 이미 다듬어진 것이어야 한다.
        { groupKey: "billingType", itemKey: "PAID", value: "  유상   수리  " },
      ],
      actorUserId: developerEngineerId,
    });
    assert.equal(result.ok, true, `거절됐다: ${JSON.stringify(result)}`);
    if (result.ok) assert.equal(result.changedCount, 3);

    const stored = await loadStoredUiTextOverrides();
    assert.equal(stored.length, 3);
    assert.ok(
      stored.some((row) => row.groupKey === "billingType" && row.value === "유상 수리"),
      `저장된 값이 정규화를 지나지 않았다: ${JSON.stringify(stored)}`
    );

    const resolved = resolveUiText(stored);
    assert.equal(resolved.role.ADMIN, "매니저");
    assert.equal(resolved.repairStatus.IN_REPAIR, "수리 진행 중");
    assert.equal(resolved.billingType.PAID, "유상 수리");
    // 안 건드린 문구는 코드의 기본값 그대로다.
    assert.equal(resolved.role.SUPER_ADMIN, roleLabels.SUPER_ADMIN);
    assert.equal(
      resolved.repairStatus.WAITING_REPAIR,
      repairStatusLabels.WAITING_REPAIR
    );
    // 묶음 8개가 모두 병합 결과에 있다 — 하나라도 빠지면 그 화면만 문구를 못 읽는다.
    assert.deepEqual(Object.keys(resolved).sort(), UI_TEXT_GROUPS.map((g) => g.key).sort());
  });

  test("8. 개발자로 표시된 계정은 이 파일이 만든 것뿐이다 — 시험이 다른 계정을 승격하지 않았다", async () => {
    const flagged = await db.select({ id: users.id }).from(users).where(eq(users.isDeveloper, true));
    for (const row of flagged) {
      assert.ok(
        createdTestUserIds.includes(row.id),
        `이 파일이 만들지 않은 계정에 개발자 표시가 켜져 있다: ${row.id}`
      );
    }
  });
});
