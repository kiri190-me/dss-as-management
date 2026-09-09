import "../../../../scripts/load-env";

import { after, afterEach, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { asc, eq, inArray, like } from "drizzle-orm";
import { db, pgClient } from "../connection";
import { auditLogs, shipmentApprovalRouteSteps, shipmentApprovalRoutes, users } from "../schema";
import { saveShipmentApprovalRoute } from "./shipment-approval-routes";
import { getCurrentShipmentApprovalRoute } from "../queries/shipment-approval-routes";

/**
 * ============================================================================
 * saveShipmentApprovalRoute() — 실제 DB (시험 DB)
 * ============================================================================
 * ui-theme-tokens.integration.test.ts · shipment-representatives.integration.test.ts
 * 와 같은 격리 규약이다: 이 파일이 만든 "shiproutesave-test-" 계정만 쓰고, 그
 * 계정이 남긴 판·단계·감사 기록까지 걷는다(사람 참조가 restrict 라 순서가 있다).
 *
 * 여기서 지키려는 것은 다섯이다:
 *  1. **인가는 「출하 대표」 지정과 같은 열쇠·같은 수준이다** — 새 권한을 만들지
 *     않았으므로 기본 정책상 최고관리자만 통과한다. 막히면 **판이 생기지 않는다.**
 *  2. 🔴 **화면이 보낸 승인자를 그대로 믿지 않는다** — 비활성·잠김·미승인·삭제된
 *     계정은 트랜잭션 안에서 다시 확인해 거절하고, 누가 왜 안 되는지 이름과 함께
 *     말한다.
 *  3. 🔴 **바뀐 게 없으면 새 판을 만들지 않는다.** 판은 지우지 않으므로
 *     (append-only) 같은 판이 둘 쌓이면 「누가 언제 바꿨나」가 잡음에 묻힌다.
 *     순서만 달라도 다른 절차라 그때는 새 판이 생겨야 한다.
 *  4. **단계 0개인 판도 정상이다** — 「절차를 쓰지 않겠다」는 뜻이다.
 *  5. 🔴 **거절은 트랜잭션째 되돌아간다.** 콜백에서 그냥 반환하면 커밋되므로,
 *     막힌 저장이 판도 감사 기록도 남기지 않았는지 실제로 확인한다.
 * ============================================================================
 */

const TEST_EMAIL_PREFIX = "shiproutesave-test-";

let superAdminId: string;
let otherSuperAdminId: string;
let adminId: string;
let engineerId: string;
let approverAId: string;
let approverBId: string;
let approverCId: string;
let inactiveUserId: string;
let pendingUserId: string;
let lockedUserId: string;
let deletedUserId: string;

const createdTestUserIds: string[] = [];

async function createTestUser(
  name: string,
  overrides: Partial<typeof users.$inferInsert> = {}
): Promise<string> {
  const [row] = await db
    .insert(users)
    .values({
      email: `${TEST_EMAIL_PREFIX}${randomUUID().slice(0, 8)}@example.test`,
      name,
      role: "AS_ENGINEER",
      approvalStatus: "APPROVED",
      isActive: true,
      ...overrides,
    })
    .returning({ id: users.id });
  createdTestUserIds.push(row.id);
  return row.id;
}

async function routeRows() {
  return db
    .select({ id: shipmentApprovalRoutes.id, version: shipmentApprovalRoutes.version })
    .from(shipmentApprovalRoutes)
    .orderBy(asc(shipmentApprovalRoutes.version));
}

async function routeRowCount(): Promise<number> {
  return (await routeRows()).length;
}

async function stepRows(routeId: string) {
  return db
    .select({
      stepOrder: shipmentApprovalRouteSteps.stepOrder,
      approverUserId: shipmentApprovalRouteSteps.approverUserId,
    })
    .from(shipmentApprovalRouteSteps)
    .where(eq(shipmentApprovalRouteSteps.routeId, routeId))
    .orderBy(asc(shipmentApprovalRouteSteps.stepOrder));
}

/** 결재선에 남은 감사 기록 — 이 표에 남는 것만 고른다. */
async function routeAuditRows() {
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
    .where(eq(auditLogs.targetEntity, "shipment_approval_routes"));
}

async function routeAuditCount(): Promise<number> {
  return (await routeAuditRows()).length;
}

/**
 * 이 파일의 계정과 그 계정이 남긴 판·단계·감사 기록을 지운다. 접두사로 고르므로
 * 이전 실행이 중간에 끊겨 남은 것까지 함께 걷는다 — 남으면 「판 번호는 max + 1」과
 * 「판이 없으면 첫 판이다」 두 전제가 통째로 깨진다.
 */
async function removeTestUsersByPrefix(): Promise<void> {
  const leftovers = await db
    .select({ id: users.id })
    .from(users)
    .where(like(users.email, `${TEST_EMAIL_PREFIX}%`));
  const ids = leftovers.map((row) => row.id);
  if (ids.length === 0) return;

  // 사람 참조는 둘 다 restrict 다 — 단계(승인자) 먼저, 판(만든 사람) 다음,
  // 사람이 마지막이다. 판을 지우면 남은 단계는 cascade 로 함께 사라진다.
  await db
    .delete(shipmentApprovalRouteSteps)
    .where(inArray(shipmentApprovalRouteSteps.approverUserId, ids));
  await db
    .delete(shipmentApprovalRoutes)
    .where(inArray(shipmentApprovalRoutes.createdByUserId, ids));
  // audit_logs.actor_user_id → users (restrict): 행위자로만 고른다 —
  // target_record_id 로 고르는 모양은 test-cleanup-static-safety.test.ts 가 금지한다.
  await db.delete(auditLogs).where(inArray(auditLogs.actorUserId, ids));
  await db.delete(users).where(inArray(users.id, ids));
}

before(async () => {
  await removeTestUsersByPrefix();

  assert.equal(
    await routeRowCount(),
    0,
    "이 시험은 shipment_approval_routes 가 비어 있는 상태를 전제로 합니다"
  );

  superAdminId = await createTestUser("shiproutesave admin", { role: "SUPER_ADMIN" });
  otherSuperAdminId = await createTestUser("shiproutesave admin 2", { role: "SUPER_ADMIN" });
  adminId = await createTestUser("shiproutesave manager", { role: "ADMIN" });
  engineerId = await createTestUser("shiproutesave engineer");
  approverAId = await createTestUser("shiproutesave approver A");
  approverBId = await createTestUser("shiproutesave approver B");
  approverCId = await createTestUser("shiproutesave approver C");
  inactiveUserId = await createTestUser("shiproutesave inactive", { isActive: false });
  pendingUserId = await createTestUser("shiproutesave pending", { approvalStatus: "PENDING" });
  lockedUserId = await createTestUser("shiproutesave locked", { lockedAt: new Date() });
  deletedUserId = await createTestUser("shiproutesave deleted", {
    isDeleted: true,
    deletedAt: new Date(),
  });
});

afterEach(async () => {
  // 판을 지우면 단계는 cascade 로 함께 사라진다. 판 번호가 매번 1부터 다시
  // 시작해야 각 시험이 「첫 판인가」를 스스로 정할 수 있다.
  await db
    .delete(shipmentApprovalRoutes)
    .where(inArray(shipmentApprovalRoutes.createdByUserId, createdTestUserIds));
  await db.delete(auditLogs).where(inArray(auditLogs.actorUserId, createdTestUserIds));
});

after(async () => {
  await removeTestUsersByPrefix();
  await pgClient.end({ timeout: 5 });
});

describe("saveShipmentApprovalRoute — 인가", () => {
  test("1. 최고관리자는 저장할 수 있다", async () => {
    const result = await saveShipmentApprovalRoute([approverAId, approverBId], superAdminId);

    assert.equal(result.ok, true, `거절됐다: ${JSON.stringify(result)}`);
    if (result.ok) {
      assert.equal(result.changed, true);
      assert.equal(result.version, 1, "첫 판은 1번이다");
    }
    assert.equal(await routeRowCount(), 1);
  });

  test("🔴 1b. 권한 없는 계정은 거절되고 판이 만들어지지 않는다", async () => {
    // 기본 정책상 users.shipmentRepresentatives 의 MANAGE 는 최고관리자뿐이다
    // — 새 권한 영역을 만들지 않았으므로 대표 지정과 정확히 같은 관문이다.
    for (const [label, actorId] of [
      ["관리자", adminId],
      ["A/S 엔지니어", engineerId],
    ] as const) {
      const result = await saveShipmentApprovalRoute([approverAId], actorId);

      assert.equal(result.ok, false, `${label}가 통과했다`);
      if (!result.ok) assert.equal(result.code, "FORBIDDEN", label);
      assert.equal(await routeRowCount(), 0, `${label}: 거절됐는데 판이 생겼다`);
      assert.equal(await routeAuditCount(), 0, `${label}: 거절됐는데 감사 기록이 남았다`);
    }
  });

  test("1c. 없는 계정·지워진 계정은 거절된다 — 트랜잭션 안에서 살아 있는 행을 다시 읽는다", async () => {
    const missing = await saveShipmentApprovalRoute([approverAId], randomUUID());
    assert.equal(missing.ok, false);
    if (!missing.ok) assert.equal(missing.code, "FORBIDDEN");

    const deleted = await saveShipmentApprovalRoute([approverAId], deletedUserId);
    assert.equal(deleted.ok, false);
    if (!deleted.ok) assert.equal(deleted.code, "FORBIDDEN");

    assert.equal(await routeRowCount(), 0);
  });

  test("1d. 승인되지 않은 계정은 거절된다", async () => {
    const pendingSuperAdminId = await createTestUser("shiproutesave pending admin", {
      role: "SUPER_ADMIN",
      approvalStatus: "PENDING",
    });

    const result = await saveShipmentApprovalRoute([approverAId], pendingSuperAdminId);

    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.code, "FORBIDDEN");
    assert.equal(await routeRowCount(), 0);
  });
});

describe("saveShipmentApprovalRoute — 승인자 자격", () => {
  test("🔴 2. 자격 없는 사람을 넣으면 거절되고 판이 만들어지지 않는다", async () => {
    // 화면이 받아 간 후보 목록은 낡을 수 있다 — 고르는 사이에 계정이 잠기거나
    // 비활성이 될 수 있으므로 저장 시점에 다시 본다.
    const cases: { label: string; userId: string; reason: RegExp }[] = [
      { label: "비활성", userId: inactiveUserId, reason: /비활성화된 계정/ },
      { label: "미승인", userId: pendingUserId, reason: /승인되지 않은 계정/ },
      { label: "잠김", userId: lockedUserId, reason: /잠긴 계정/ },
      { label: "삭제됨", userId: deletedUserId, reason: /삭제된 계정/ },
    ];

    for (const { label, userId, reason } of cases) {
      const result = await saveShipmentApprovalRoute([approverAId, userId], superAdminId);

      assert.equal(result.ok, false, `${label}: 통과했다`);
      if (!result.ok) {
        assert.equal(result.code, "INVALID_INPUT", label);
        assert.match(result.message, reason, `${label}: 왜 안 되는지 말해 주지 않았다`);
        // 🔴 이름이 들어 있어야 한다 — 10명 중 누구를 빼야 하는지 알 수 있어야 한다.
        assert.match(result.message, /shiproutesave/, `${label}: 누구인지 말해 주지 않았다`);
        assert.match(result.message, /2번째/, `${label}: 몇 번째 단계인지 말해 주지 않았다`);
      }
      assert.equal(await routeRowCount(), 0, `${label}: 거절됐는데 판이 생겼다`);
      assert.equal(await routeAuditCount(), 0, `${label}: 거절됐는데 감사 기록이 남았다`);
    }
  });

  test("2b. 없는 사용자 id 는 거절된다", async () => {
    const result = await saveShipmentApprovalRoute([randomUUID()], superAdminId);

    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.code, "INVALID_INPUT");
    assert.equal(await routeRowCount(), 0);
  });

  test("2c. 입력 형식이 틀리면 거절된다 — 화면을 거치지 않고 부를 수 있다", async () => {
    for (const bad of [["not-a-uuid"], [approverAId, approverAId], [""]]) {
      const result = await saveShipmentApprovalRoute(bad, superAdminId);
      assert.equal(result.ok, false, `${JSON.stringify(bad)} 가 통과했다`);
      if (!result.ok) assert.equal(result.code, "INVALID_INPUT");
      assert.equal(await routeRowCount(), 0);
    }
  });

  test("🔴 2d. 자격 없는 사람이 이미 결재선에 올라 있어도, 저장할 때는 다시 막힌다", async () => {
    // 결재선에 올라간 뒤 계정이 잠기는 일은 실제로 일어난다. 그 사람을 그대로
    // 둔 채 다른 자리만 고쳐 저장하려 하면 여기서 걸리고, 화면은 그 줄에 왜
    // 안 되는지를 이미 보여 주고 있다.
    const first = await saveShipmentApprovalRoute([approverAId, approverBId], superAdminId);
    assert.equal(first.ok, true);

    await db.update(users).set({ isActive: false }).where(eq(users.id, approverBId));
    try {
      const result = await saveShipmentApprovalRoute(
        [approverAId, approverBId, approverCId],
        superAdminId
      );
      assert.equal(result.ok, false);
      if (!result.ok) assert.match(result.message, /비활성화된 계정/);
      assert.equal(await routeRowCount(), 1, "거절됐는데 판이 늘었다");
    } finally {
      await db.update(users).set({ isActive: true }).where(eq(users.id, approverBId));
    }
  });
});

describe("saveShipmentApprovalRoute — 판 쌓기", () => {
  test("🔴 3. 정상 저장이면 판이 하나 생기고 step_order 가 1..N 으로 매겨진다", async () => {
    const result = await saveShipmentApprovalRoute(
      [approverCId, approverAId, approverBId],
      superAdminId
    );

    assert.equal(result.ok, true, `거절됐다: ${JSON.stringify(result)}`);
    const routes = await routeRows();
    assert.equal(routes.length, 1);
    assert.equal(routes[0].version, 1);

    // 🔴 순서 번호는 입력이 아니라 배열의 자리에서 나온다.
    assert.deepEqual(await stepRows(routes[0].id), [
      { stepOrder: 1, approverUserId: approverCId },
      { stepOrder: 2, approverUserId: approverAId },
      { stepOrder: 3, approverUserId: approverBId },
    ]);
  });

  test("🔴 4. 같은 목록을 다시 저장하면 판이 늘지 않는다", async () => {
    // 판은 지우지 않으므로, 저장 단추를 두 번 누르면 똑같은 판이 둘 쌓여
    // 이력이 지저분해진다.
    const first = await saveShipmentApprovalRoute([approverAId, approverBId], superAdminId);
    assert.equal(first.ok, true);
    const auditAfterFirst = await routeAuditCount();

    const again = await saveShipmentApprovalRoute([approverAId, approverBId], superAdminId);

    assert.equal(again.ok, true, `거절됐다: ${JSON.stringify(again)}`);
    if (again.ok) {
      assert.equal(again.changed, false, "바뀐 게 없는데 새 판을 만들었다");
      assert.equal(again.version, 1, "지금 판의 번호를 그대로 돌려줘야 한다");
    }
    assert.equal(await routeRowCount(), 1, "판이 둘 쌓였다");
    assert.equal(await routeAuditCount(), auditAfterFirst, "바뀐 게 없는데 감사 기록이 늘었다");
  });

  test("4b. 다른 사람이 저장해도 목록이 같으면 판이 늘지 않는다", async () => {
    await saveShipmentApprovalRoute([approverAId], superAdminId);
    const again = await saveShipmentApprovalRoute([approverAId], otherSuperAdminId);

    assert.equal(again.ok, true);
    if (again.ok) assert.equal(again.changed, false);
    assert.equal(await routeRowCount(), 1);
  });

  test("🔴 5. 순서만 바꿔 저장하면 새 판이 생긴다 — 같은 사람들이라도 순서가 다르면 다른 절차다", async () => {
    const first = await saveShipmentApprovalRoute([approverAId, approverBId], superAdminId);
    assert.equal(first.ok, true);

    const flipped = await saveShipmentApprovalRoute([approverBId, approverAId], superAdminId);

    assert.equal(flipped.ok, true, `거절됐다: ${JSON.stringify(flipped)}`);
    if (flipped.ok) {
      assert.equal(flipped.changed, true);
      assert.equal(flipped.version, 2);
    }
    assert.equal(await routeRowCount(), 2, "새 판이 쌓이지 않았다");

    // 「현재 절차」는 나중에 넣은 판이 아니라 version 이 가장 큰 판이다.
    const current = await getCurrentShipmentApprovalRoute();
    assert.ok(current);
    assert.equal(current.version, 2);
    assert.deepEqual(
      current.steps.map((step) => step.approverUserId),
      [approverBId, approverAId]
    );
  });

  test("🔴 6. 단계 0개로 저장하면 판은 생기고 단계는 0개다 — 「절차를 쓰지 않겠다」는 뜻이다", async () => {
    const first = await saveShipmentApprovalRoute([approverAId, approverBId], superAdminId);
    assert.equal(first.ok, true);

    const emptied = await saveShipmentApprovalRoute([], superAdminId);

    assert.equal(emptied.ok, true, `거절됐다: ${JSON.stringify(emptied)}`);
    if (emptied.ok) {
      assert.equal(emptied.changed, true);
      assert.equal(emptied.version, 2);
    }

    const routes = await routeRows();
    assert.equal(routes.length, 2, "빈 판도 판이다 — 되돌린 사실이 남아야 한다");
    assert.deepEqual(await stepRows(routes[1].id), []);

    // 빈 판을 다시 비워도 늘지 않는다.
    const againEmpty = await saveShipmentApprovalRoute([], superAdminId);
    assert.equal(againEmpty.ok, true);
    if (againEmpty.ok) assert.equal(againEmpty.changed, false);
    assert.equal(await routeRowCount(), 2);
  });

  test("6b. 판이 하나도 없을 때 0개로 저장하면 첫 판이 생긴다 — 「쓰지 않기로 했다」도 기록이다", async () => {
    assert.equal(await routeRowCount(), 0, "이 시험은 표가 빈 상태를 전제로 한다");

    const result = await saveShipmentApprovalRoute([], superAdminId);

    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.changed, true);
      assert.equal(result.version, 1);
    }
    assert.equal(await routeRowCount(), 1);
    assert.equal(await routeAuditCount(), 1, "결정이 감사 기록에 남아야 한다");
  });
});

describe("saveShipmentApprovalRoute — 감사 기록", () => {
  test("🔴 7. 옛 판과 새 판이 previousValue/newValue 에 이름까지 담겨 남는다", async () => {
    const first = await saveShipmentApprovalRoute([approverAId], superAdminId);
    assert.equal(first.ok, true);

    const created = await routeAuditRows();
    assert.equal(created.length, 1);
    assert.equal(created[0].actorUserId, superAdminId);
    // 🔴 CREATE 가 아니다 — 로그를 읽는 사람이 찾는 것은 「결재선이 이렇게
    // 바뀌었다」이고, 그것을 보여 주는 것은 previousValue/newValue 한 쌍이다.
    assert.equal(created[0].actionType, "UPDATE");
    assert.equal(created[0].targetEntity, "shipment_approval_routes");
    assert.equal(created[0].previousValue, null, "첫 판의 이전 값은 없다");
    assert.deepEqual(created[0].newValue, {
      version: 1,
      steps: [
        { stepOrder: 1, approverUserId: approverAId, approverName: "shiproutesave approver A" },
      ],
    });

    const routes = await routeRows();
    assert.equal(created[0].targetRecordId, routes[0].id, "새 판 하나를 정확히 가리켜야 한다");

    // 두 번째 판 — 이전 값에 옛 판이 통째로 들어 있어야 한다.
    const second = await saveShipmentApprovalRoute([approverBId, approverAId], superAdminId);
    assert.equal(second.ok, true);

    const rows = await routeAuditRows();
    assert.equal(rows.length, 2);
    const updated = rows.find((row) => row.id !== created[0].id);
    assert.ok(updated, "두 번째 기록을 찾지 못했다");
    assert.equal(updated.actionType, "UPDATE");
    assert.deepEqual(updated.previousValue, {
      version: 1,
      steps: [
        { stepOrder: 1, approverUserId: approverAId, approverName: "shiproutesave approver A" },
      ],
    });
    assert.deepEqual(updated.newValue, {
      version: 2,
      steps: [
        { stepOrder: 1, approverUserId: approverBId, approverName: "shiproutesave approver B" },
        { stepOrder: 2, approverUserId: approverAId, approverName: "shiproutesave approver A" },
      ],
    });
  });

  test("🔴 7b. 이름이 함께 남는다 — 그 사용자가 나중에 지워져도 로그가 스스로를 설명해야 한다", async () => {
    const saved = await saveShipmentApprovalRoute([approverCId], superAdminId);
    assert.equal(saved.ok, true);

    const [row] = await routeAuditRows();
    const newValue = row.newValue as { steps: { approverName: string }[] };
    assert.equal(newValue.steps[0].approverName, "shiproutesave approver C");
  });

  test("🔴 8. 거절된 저장은 감사 기록도 남기지 않는다 — 트랜잭션이 통째로 되돌아간다", async () => {
    // 콜백에서 그냥 반환하면 커밋된다. 자격 확인은 판을 넣기 **전**에 하지만,
    // 되돌아가는 것 자체를 확인하려면 남을 수 있는 것 둘(판·감사 기록)을 모두
    // 봐야 한다.
    const first = await saveShipmentApprovalRoute([approverAId], superAdminId);
    assert.equal(first.ok, true);
    const routesBefore = await routeRowCount();
    const auditBefore = await routeAuditCount();

    const rejected = await saveShipmentApprovalRoute([approverBId, lockedUserId], superAdminId);
    assert.equal(rejected.ok, false);

    assert.equal(await routeRowCount(), routesBefore, "거절됐는데 판이 늘었다");
    assert.equal(await routeAuditCount(), auditBefore, "거절됐는데 감사 기록이 남았다");

    // 그리고 「현재 절차」는 거절 전의 그것 그대로다.
    const current = await getCurrentShipmentApprovalRoute();
    assert.ok(current);
    assert.deepEqual(
      current.steps.map((step) => step.approverUserId),
      [approverAId]
    );
  });
});
