import "../../../../scripts/load-env";

import { after, afterEach, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { asc, eq, inArray, like } from "drizzle-orm";
import { db, pgClient } from "../connection";
import { auditLogs, shipmentApprovalRouteSteps, shipmentApprovalRoutes, users } from "../schema";
import { saveShipmentApprovalRoute } from "./shipment-approval-routes";
import {
  getCurrentShipmentApprovalRoute,
  isOnCurrentShipmentApprovalRoute,
} from "../queries/shipment-approval-routes";
import {
  EDITABLE_SHIPMENT_APPROVAL_ROUTE_SCOPES,
  SHIPMENT_APPROVAL_ROUTE_SCOPES,
  type ShipmentApprovalRouteScope,
} from "@/lib/domain/shipment-approval-route";

/**
 * ============================================================================
 * saveShipmentApprovalRoute() — 실제 DB (시험 DB)
 * ============================================================================
 * ui-theme-tokens.integration.test.ts · shipment-representatives.integration.test.ts
 * 와 같은 격리 규약이다: 이 파일이 만든 "shiproutesave-test-" 계정만 쓰고, 그
 * 계정이 남긴 판·단계·감사 기록까지 걷는다(사람 참조가 restrict 라 순서가 있다).
 *
 * 여기서 지키려는 것은 여섯이다:
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
 *  6. 🔴 **용도(scope)가 판을 가른다** — 판 번호 매기기·「그대로인가」 판정·「현재
 *     절차」 셋이 전부 용도 안에서 이뤄지고, 감사 기록에 용도가 남는다. 부품 불출
 *     판을 얹어도 출하 쪽이 흔들리지 않아야 한다.
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
    .select({
      id: shipmentApprovalRoutes.id,
      scope: shipmentApprovalRoutes.scope,
      version: shipmentApprovalRoutes.version,
    })
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
    const result = await saveShipmentApprovalRoute([approverAId, approverBId], superAdminId, "FINAL_SHIPMENT");

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
      const result = await saveShipmentApprovalRoute([approverAId], actorId, "FINAL_SHIPMENT");

      assert.equal(result.ok, false, `${label}가 통과했다`);
      if (!result.ok) assert.equal(result.code, "FORBIDDEN", label);
      assert.equal(await routeRowCount(), 0, `${label}: 거절됐는데 판이 생겼다`);
      assert.equal(await routeAuditCount(), 0, `${label}: 거절됐는데 감사 기록이 남았다`);
    }
  });

  test("1c. 없는 계정·지워진 계정은 거절된다 — 트랜잭션 안에서 살아 있는 행을 다시 읽는다", async () => {
    const missing = await saveShipmentApprovalRoute([approverAId], randomUUID(), "FINAL_SHIPMENT");
    assert.equal(missing.ok, false);
    if (!missing.ok) assert.equal(missing.code, "FORBIDDEN");

    const deleted = await saveShipmentApprovalRoute([approverAId], deletedUserId, "FINAL_SHIPMENT");
    assert.equal(deleted.ok, false);
    if (!deleted.ok) assert.equal(deleted.code, "FORBIDDEN");

    assert.equal(await routeRowCount(), 0);
  });

  test("1d. 승인되지 않은 계정은 거절된다", async () => {
    const pendingSuperAdminId = await createTestUser("shiproutesave pending admin", {
      role: "SUPER_ADMIN",
      approvalStatus: "PENDING",
    });

    const result = await saveShipmentApprovalRoute([approverAId], pendingSuperAdminId, "FINAL_SHIPMENT");

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
      const result = await saveShipmentApprovalRoute([approverAId, userId], superAdminId, "FINAL_SHIPMENT");

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
    const result = await saveShipmentApprovalRoute([randomUUID()], superAdminId, "FINAL_SHIPMENT");

    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.code, "INVALID_INPUT");
    assert.equal(await routeRowCount(), 0);
  });

  test("2c. 입력 형식이 틀리면 거절된다 — 화면을 거치지 않고 부를 수 있다", async () => {
    for (const bad of [["not-a-uuid"], [approverAId, approverAId], [""]]) {
      const result = await saveShipmentApprovalRoute(bad, superAdminId, "FINAL_SHIPMENT");
      assert.equal(result.ok, false, `${JSON.stringify(bad)} 가 통과했다`);
      if (!result.ok) assert.equal(result.code, "INVALID_INPUT");
      assert.equal(await routeRowCount(), 0);
    }
  });

  test("🔴 2d. 자격 없는 사람이 이미 결재선에 올라 있어도, 저장할 때는 다시 막힌다", async () => {
    // 결재선에 올라간 뒤 계정이 잠기는 일은 실제로 일어난다. 그 사람을 그대로
    // 둔 채 다른 자리만 고쳐 저장하려 하면 여기서 걸리고, 화면은 그 줄에 왜
    // 안 되는지를 이미 보여 주고 있다.
    const first = await saveShipmentApprovalRoute([approverAId, approverBId], superAdminId, "FINAL_SHIPMENT");
    assert.equal(first.ok, true);

    await db.update(users).set({ isActive: false }).where(eq(users.id, approverBId));
    try {
      const result = await saveShipmentApprovalRoute(
        [approverAId, approverBId, approverCId],
        superAdminId, "FINAL_SHIPMENT"
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
      superAdminId, "FINAL_SHIPMENT"
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
    const first = await saveShipmentApprovalRoute([approverAId, approverBId], superAdminId, "FINAL_SHIPMENT");
    assert.equal(first.ok, true);
    const auditAfterFirst = await routeAuditCount();

    const again = await saveShipmentApprovalRoute([approverAId, approverBId], superAdminId, "FINAL_SHIPMENT");

    assert.equal(again.ok, true, `거절됐다: ${JSON.stringify(again)}`);
    if (again.ok) {
      assert.equal(again.changed, false, "바뀐 게 없는데 새 판을 만들었다");
      assert.equal(again.version, 1, "지금 판의 번호를 그대로 돌려줘야 한다");
    }
    assert.equal(await routeRowCount(), 1, "판이 둘 쌓였다");
    assert.equal(await routeAuditCount(), auditAfterFirst, "바뀐 게 없는데 감사 기록이 늘었다");
  });

  test("4b. 다른 사람이 저장해도 목록이 같으면 판이 늘지 않는다", async () => {
    await saveShipmentApprovalRoute([approverAId], superAdminId, "FINAL_SHIPMENT");
    const again = await saveShipmentApprovalRoute([approverAId], otherSuperAdminId, "FINAL_SHIPMENT");

    assert.equal(again.ok, true);
    if (again.ok) assert.equal(again.changed, false);
    assert.equal(await routeRowCount(), 1);
  });

  test("🔴 5. 순서만 바꿔 저장하면 새 판이 생긴다 — 같은 사람들이라도 순서가 다르면 다른 절차다", async () => {
    const first = await saveShipmentApprovalRoute([approverAId, approverBId], superAdminId, "FINAL_SHIPMENT");
    assert.equal(first.ok, true);

    const flipped = await saveShipmentApprovalRoute([approverBId, approverAId], superAdminId, "FINAL_SHIPMENT");

    assert.equal(flipped.ok, true, `거절됐다: ${JSON.stringify(flipped)}`);
    if (flipped.ok) {
      assert.equal(flipped.changed, true);
      assert.equal(flipped.version, 2);
    }
    assert.equal(await routeRowCount(), 2, "새 판이 쌓이지 않았다");

    // 「현재 절차」는 나중에 넣은 판이 아니라 version 이 가장 큰 판이다.
    const current = await getCurrentShipmentApprovalRoute("FINAL_SHIPMENT");
    assert.ok(current);
    assert.equal(current.version, 2);
    assert.deepEqual(
      current.steps.map((step) => step.approverUserId),
      [approverBId, approverAId]
    );
  });

  test("🔴 6. 단계 0개로 저장하면 판은 생기고 단계는 0개다 — 「절차를 쓰지 않겠다」는 뜻이다", async () => {
    const first = await saveShipmentApprovalRoute([approverAId, approverBId], superAdminId, "FINAL_SHIPMENT");
    assert.equal(first.ok, true);

    const emptied = await saveShipmentApprovalRoute([], superAdminId, "FINAL_SHIPMENT");

    assert.equal(emptied.ok, true, `거절됐다: ${JSON.stringify(emptied)}`);
    if (emptied.ok) {
      assert.equal(emptied.changed, true);
      assert.equal(emptied.version, 2);
    }

    const routes = await routeRows();
    assert.equal(routes.length, 2, "빈 판도 판이다 — 되돌린 사실이 남아야 한다");
    assert.deepEqual(await stepRows(routes[1].id), []);

    // 빈 판을 다시 비워도 늘지 않는다.
    const againEmpty = await saveShipmentApprovalRoute([], superAdminId, "FINAL_SHIPMENT");
    assert.equal(againEmpty.ok, true);
    if (againEmpty.ok) assert.equal(againEmpty.changed, false);
    assert.equal(await routeRowCount(), 2);
  });

  test("6b. 판이 하나도 없을 때 0개로 저장하면 첫 판이 생긴다 — 「쓰지 않기로 했다」도 기록이다", async () => {
    assert.equal(await routeRowCount(), 0, "이 시험은 표가 빈 상태를 전제로 한다");

    const result = await saveShipmentApprovalRoute([], superAdminId, "FINAL_SHIPMENT");

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
    const first = await saveShipmentApprovalRoute([approverAId], superAdminId, "FINAL_SHIPMENT");
    assert.equal(first.ok, true);

    const created = await routeAuditRows();
    assert.equal(created.length, 1);
    assert.equal(created[0].actorUserId, superAdminId);
    // 🔴 CREATE 가 아니다 — 로그를 읽는 사람이 찾는 것은 「결재선이 이렇게
    // 바뀌었다」이고, 그것을 보여 주는 것은 previousValue/newValue 한 쌍이다.
    assert.equal(created[0].actionType, "UPDATE");
    assert.equal(created[0].targetEntity, "shipment_approval_routes");
    assert.equal(created[0].previousValue, null, "첫 판의 이전 값은 없다");
    // 🔴 용도가 함께 남는다 — 대상 표 이름은 이제 어느 절차인지 말해 주지 못한다.
    assert.deepEqual(created[0].newValue, {
      scope: "FINAL_SHIPMENT",
      version: 1,
      steps: [
        { stepOrder: 1, approverUserId: approverAId, approverName: "shiproutesave approver A" },
      ],
    });

    const routes = await routeRows();
    assert.equal(created[0].targetRecordId, routes[0].id, "새 판 하나를 정확히 가리켜야 한다");

    // 두 번째 판 — 이전 값에 옛 판이 통째로 들어 있어야 한다.
    const second = await saveShipmentApprovalRoute([approverBId, approverAId], superAdminId, "FINAL_SHIPMENT");
    assert.equal(second.ok, true);

    const rows = await routeAuditRows();
    assert.equal(rows.length, 2);
    const updated = rows.find((row) => row.id !== created[0].id);
    assert.ok(updated, "두 번째 기록을 찾지 못했다");
    assert.equal(updated.actionType, "UPDATE");
    assert.deepEqual(updated.previousValue, {
      scope: "FINAL_SHIPMENT",
      version: 1,
      steps: [
        { stepOrder: 1, approverUserId: approverAId, approverName: "shiproutesave approver A" },
      ],
    });
    assert.deepEqual(updated.newValue, {
      scope: "FINAL_SHIPMENT",
      version: 2,
      steps: [
        { stepOrder: 1, approverUserId: approverBId, approverName: "shiproutesave approver B" },
        { stepOrder: 2, approverUserId: approverAId, approverName: "shiproutesave approver A" },
      ],
    });
  });

  test("🔴 7b. 이름이 함께 남는다 — 그 사용자가 나중에 지워져도 로그가 스스로를 설명해야 한다", async () => {
    const saved = await saveShipmentApprovalRoute([approverCId], superAdminId, "FINAL_SHIPMENT");
    assert.equal(saved.ok, true);

    const [row] = await routeAuditRows();
    const newValue = row.newValue as { steps: { approverName: string }[] };
    assert.equal(newValue.steps[0].approverName, "shiproutesave approver C");
  });

  test("🔴 8. 거절된 저장은 감사 기록도 남기지 않는다 — 트랜잭션이 통째로 되돌아간다", async () => {
    // 콜백에서 그냥 반환하면 커밋된다. 자격 확인은 판을 넣기 **전**에 하지만,
    // 되돌아가는 것 자체를 확인하려면 남을 수 있는 것 둘(판·감사 기록)을 모두
    // 봐야 한다.
    const first = await saveShipmentApprovalRoute([approverAId], superAdminId, "FINAL_SHIPMENT");
    assert.equal(first.ok, true);
    const routesBefore = await routeRowCount();
    const auditBefore = await routeAuditCount();

    const rejected = await saveShipmentApprovalRoute([approverBId, lockedUserId], superAdminId, "FINAL_SHIPMENT");
    assert.equal(rejected.ok, false);

    assert.equal(await routeRowCount(), routesBefore, "거절됐는데 판이 늘었다");
    assert.equal(await routeAuditCount(), auditBefore, "거절됐는데 감사 기록이 남았다");

    // 그리고 「현재 절차」는 거절 전의 그것 그대로다.
    const current = await getCurrentShipmentApprovalRoute("FINAL_SHIPMENT");
    assert.ok(current);
    assert.deepEqual(
      current.steps.map((step) => step.approverUserId),
      [approverAId]
    );
  });
});

describe("🔴 saveShipmentApprovalRoute — 용도(scope)가 판을 가른다", () => {
  test("9. 판 번호를 그 용도 안에서 센다 — 출하 3판 다음 불출이 4판이 되지 않는다", async () => {
    // 전체에서 max + 1 을 하면 새 유니크와 어긋나지는 않지만, 사람이 읽는
    // 번호(「이 절차의 몇 번째 판인가」)가 망가진다.
    for (const ids of [[approverAId], [approverBId], [approverCId]]) {
      const saved = await saveShipmentApprovalRoute(ids, superAdminId, "FINAL_SHIPMENT");
      assert.equal(saved.ok, true, `출하 판 저장이 막혔다: ${JSON.stringify(saved)}`);
    }

    const partIssue = await saveShipmentApprovalRoute([approverAId], superAdminId, "PART_ISSUE");

    assert.equal(partIssue.ok, true, `거절됐다: ${JSON.stringify(partIssue)}`);
    if (partIssue.ok) {
      assert.equal(partIssue.changed, true);
      assert.equal(partIssue.version, 1, "다른 용도의 판 번호를 이어받았다");
    }
  });

  test("🔴 10. 부품 불출 판을 얹어도 출하 쪽 「현재 절차」가 흔들리지 않는다", async () => {
    const shipment = await saveShipmentApprovalRoute(
      [approverAId, approverBId],
      superAdminId,
      "FINAL_SHIPMENT"
    );
    assert.equal(shipment.ok, true);

    const partIssue = await saveShipmentApprovalRoute([approverCId], superAdminId, "PART_ISSUE");
    assert.equal(partIssue.ok, true);

    const current = await getCurrentShipmentApprovalRoute("FINAL_SHIPMENT");
    assert.ok(current, "출하 판이 사라졌다");
    assert.equal(current.scope, "FINAL_SHIPMENT");
    assert.equal(current.version, 1);
    assert.deepEqual(
      current.steps.map((step) => step.approverUserId),
      [approverAId, approverBId],
      "출하 절차에 불출 단계가 섞였다"
    );

    // 반대쪽도 자기 판만 본다.
    const partIssueRoute = await getCurrentShipmentApprovalRoute("PART_ISSUE");
    assert.ok(partIssueRoute);
    assert.deepEqual(
      partIssueRoute.steps.map((step) => step.approverUserId),
      [approverCId]
    );

    // 두 용도의 1판이 함께 남는다 — (scope, version) 유니크가 그것을 허락한다.
    const rows = await routeRows();
    assert.equal(rows.length, 2);
    assert.deepEqual(
      rows.map((row) => [row.scope, row.version]).sort(),
      [
        ["FINAL_SHIPMENT", 1],
        ["PART_ISSUE", 1],
      ].sort()
    );
  });

  test("🔴 11. 「바뀐 게 없다」를 용도 안에서 판정한다 — 다른 용도에 같은 사람들이 있어도 새 판이 생긴다", async () => {
    // 용도를 빼고 견주면, 같은 사람들을 두 절차에 세우려는 저장이 조용히
    // 삼켜진다 — 사람에게는 「저장했는데 아무 일도 안 일어났다」로 보인다.
    const shipment = await saveShipmentApprovalRoute(
      [approverAId, approverBId],
      superAdminId,
      "FINAL_SHIPMENT"
    );
    assert.equal(shipment.ok, true);

    const partIssue = await saveShipmentApprovalRoute(
      [approverAId, approverBId],
      superAdminId,
      "PART_ISSUE"
    );

    assert.equal(partIssue.ok, true, `거절됐다: ${JSON.stringify(partIssue)}`);
    if (partIssue.ok) {
      assert.equal(partIssue.changed, true, "다른 용도인데 「그대로다」로 삼켜졌다");
      assert.equal(partIssue.version, 1);
    }
    assert.equal(await routeRowCount(), 2, "새 판이 쌓이지 않았다");

    // 그리고 같은 용도 안에서는 여전히 「그대로다」가 돈다.
    const again = await saveShipmentApprovalRoute(
      [approverAId, approverBId],
      superAdminId,
      "PART_ISSUE"
    );
    assert.equal(again.ok, true);
    if (again.ok) assert.equal(again.changed, false);
    assert.equal(await routeRowCount(), 2);
  });

  test("🔴 12. 감사 기록에 용도가 남는다 — 로그만 읽고도 어느 절차가 바뀌었는지 알아야 한다", async () => {
    const saved = await saveShipmentApprovalRoute([approverAId], superAdminId, "PART_ISSUE");
    assert.equal(saved.ok, true);

    const [row] = await routeAuditRows();
    assert.ok(row, "감사 기록이 남지 않았다");
    assert.deepEqual(row.newValue, {
      scope: "PART_ISSUE",
      version: 1,
      steps: [
        { stepOrder: 1, approverUserId: approverAId, approverName: "shiproutesave approver A" },
      ],
    });
  });

  test("13. 목록에 없는 용도는 거절된다 — 화면을 거치지 않고 부를 수 있다", async () => {
    // 표의 enum 이 결국 막긴 하지만, 거기까지 가면 사람에게는 「알 수 없는
    // 오류」로 보인다. 형식 검증이 그 앞에서 잡아 이유를 말해 준다.
    const result = await saveShipmentApprovalRoute(
      [approverAId],
      superAdminId,
      "SOMETHING_ELSE" as unknown as ShipmentApprovalRouteScope
    );

    assert.equal(result.ok, false, "모르는 용도가 통과했다");
    if (!result.ok) assert.equal(result.code, "INVALID_INPUT");
    assert.equal(await routeRowCount(), 0, "거절됐는데 판이 생겼다");
    assert.equal(await routeAuditCount(), 0, "거절됐는데 감사 기록이 남았다");
  });
});

/**
 * ============================================================================
 * isOnCurrentShipmentApprovalRoute — 「지금 결재선에 올라 있는가」
 * ============================================================================
 * 2026-10-26 눈 확인에서 잡힌 결함을 고치며 생긴 판정이다. [사용자 관리]의
 * 「결재권 위임」 탭은 「누구나 자기 결재권은 맡길 수 있다」로 만들었는데, 운영·개발
 * DB 에 엔지니어·영업·재고담당의 `users.view` 가 NONE 으로 저장돼 있어
 * (2026-08-19) 정작 결재선에 박힌 사람이 그 화면에 못 들어갔다. 이 판정이 그
 * 사람들에게만 문을 연다(auth/users-area-access.ts).
 *
 * 🔴 여기서 재는 것은 셋이다:
 *  · **현재 판**에 있으면 참 — 어느 용도(scope)든.
 *  · 🔴 **옛 판에만** 있으면 거짓. 결재선이 바뀌어 빠진 사람은 지금 결재권이
 *    없고, 없는 권한을 맡길 화면을 열어 줄 까닭도 없다. 표 전체를 보면 **한
 *    번이라도 올랐던 사람 전부**가 영원히 열리는데, 그 차이는 조용하다.
 *  · 🔴 「현재 판」의 정의가 **옆 조회와 같은 답**을 준다. 그 정의는 이 저장소에서
 *    한 곳(queries/shipment-approval-routes.ts)에만 있어야 하는데, 이 판정은
 *    모든 화면에서 도는 자리라 한 질의로 적을 수밖에 없었다 — 두 적음이 갈리지
 *    않는지를 여기서 실제 DB 로 맞대어 본다.
 * ============================================================================
 */
describe("isOnCurrentShipmentApprovalRoute — 지금 결재선에 올라 있는가", () => {
  test("현재 판에 있으면 참, 결재선에 없으면 거짓", async () => {
    // 🔵 먼저 **아무 판도 없을 때 거짓**인지 본다 — 표본이 비어서 아래가 공짜로
    //    통과하지 않게 한다(판이 없으면 아무도 열리면 안 된다).
    assert.equal(await isOnCurrentShipmentApprovalRoute(approverAId), false, "판이 없는데 열렸다");

    const saved = await saveShipmentApprovalRoute([approverAId, approverBId], superAdminId, "FINAL_SHIPMENT");
    assert.equal(saved.ok, true);

    assert.equal(await isOnCurrentShipmentApprovalRoute(approverAId), true, "1단계가 안 열렸다");
    assert.equal(await isOnCurrentShipmentApprovalRoute(approverBId), true, "2단계가 안 열렸다");
    // 결재선에 없는 사람은 그대로 닫혀 있다 — 이 문이 **모두에게** 열리면 안 된다.
    assert.equal(await isOnCurrentShipmentApprovalRoute(approverCId), false, "결재선에 없는 사람이 열렸다");
    assert.equal(await isOnCurrentShipmentApprovalRoute(engineerId), false, "엔지니어가 그냥 열렸다");
  });

  test("🔴 옛 판에만 이름이 있던 사람은 **안 열린다**", async () => {
    const first = await saveShipmentApprovalRoute([approverAId], superAdminId, "FINAL_SHIPMENT");
    assert.equal(first.ok, true);
    assert.equal(await isOnCurrentShipmentApprovalRoute(approverAId), true, "첫 판에서 안 열렸다");

    // 결재선을 갈아 끼운다. 판은 지우지 않으므로(append-only) A 의 단계는 **표에
    // 그대로 남는다** — 표 전체를 보는 판정이었다면 여기서 계속 참이 된다.
    const second = await saveShipmentApprovalRoute([approverBId], superAdminId, "FINAL_SHIPMENT");
    assert.equal(second.ok, true);
    if (second.ok) assert.equal(second.version, 2, "새 판이 안 쌓였다");

    // 🔵 옛 줄이 실제로 남아 있는지 먼저 확인한다 — 지워졌다면 아래 단언은
    //    「현재 판만 본다」가 아니라 「줄이 없다」를 재는 것이 되어 뜻이 없다.
    const [oldRoute] = (await routeRows()).filter((row) => row.version === 1);
    assert.ok(oldRoute, "옛 판이 사라졌다");
    assert.deepEqual(
      (await stepRows(oldRoute.id)).map((row) => row.approverUserId),
      [approverAId],
      "옛 판의 단계가 사라졌다 — 이 시험이 재려는 상황이 아니다"
    );

    assert.equal(
      await isOnCurrentShipmentApprovalRoute(approverAId),
      false,
      "옛 판에만 있는 사람이 아직 열려 있다 — 지금 결재권이 없는데 문이 열린다"
    );
    assert.equal(await isOnCurrentShipmentApprovalRoute(approverBId), true, "새 판의 사람이 안 열렸다");
  });

  test("🔴 부품 불출 결재선에**만** 있으면 안 열린다 (2026-10-26 사용자 결정)", async () => {
    // 2026-10-26 눈 확인: 사용자가 [승인 절차] 탭에서 자기 이름을 다 뺐는데도
    // [사용자 관리]가 계속 보였다. 그 탭이 그리는 용도는 출하·견적서 둘뿐이라
    // **부품 불출 판에 남은 이름은 그 화면에서 뺄 방법이 아예 없었다** — 닫는 길이
    // 없는 문이 생긴 것이다. 그래서 세는 용도를 고칠 수 있는 둘로 좁혔다.
    const saved = await saveShipmentApprovalRoute([approverCId], superAdminId, "PART_ISSUE");
    assert.equal(saved.ok, true);

    // 🔵 판이 **실제로 생겼는지** 먼저 확인한다 — 저장이 조용히 실패했다면 아래
    //    단언은 「안 열린다」가 아니라 「판이 없다」를 재는 것이 되어 공짜로 통과한다.
    const partIssueRoute = await getCurrentShipmentApprovalRoute("PART_ISSUE");
    assert.deepEqual(
      partIssueRoute?.steps.map((step) => step.approverUserId),
      [approverCId],
      "부품 불출 현재 판이 그 사람으로 서 있지 않다 — 이 시험이 재려는 상황이 아니다"
    );

    assert.equal(
      await isOnCurrentShipmentApprovalRoute(approverCId),
      false,
      "부품 불출 결재선만으로 문이 열렸다 — 쓰는 사람이 그 이름을 뺄 화면이 없다"
    );
  });

  test("고칠 수 있는 용도 둘(출하·견적서)은 각각 문을 연다", async () => {
    assert.equal((await saveShipmentApprovalRoute([approverAId], superAdminId, "FINAL_SHIPMENT")).ok, true);
    assert.equal((await saveShipmentApprovalRoute([approverBId], superAdminId, "QUOTE")).ok, true);

    assert.equal(await isOnCurrentShipmentApprovalRoute(approverAId), true, "출하 결재선이 안 열렸다");
    assert.equal(await isOnCurrentShipmentApprovalRoute(approverBId), true, "견적서 결재선이 안 열렸다");
  });

  test("🔴 세는 용도가 [승인 절차] 탭이 그리는 목록과 **같다** — 글자로 두 벌 적히지 않았다", async () => {
    // 🔴 상수를 글자로 베껴 적으면 한쪽만 바뀌는 날이 오고, 그때 증상이 바로 위
    //    시험이 막는 그것이다(화면에서 뺄 수 없는 이름이 문을 연다). 그래서 기대값을
    //    여기 적지 않고 **상수에서 끌어와** 용도마다 돌며 잰다.
    const openedBy: Record<string, boolean> = {};
    for (const scope of SHIPMENT_APPROVAL_ROUTE_SCOPES) {
      const approverId = await createTestUser(`shiproutesave ${scope} 승인자`);
      const saved = await saveShipmentApprovalRoute([approverId], superAdminId, scope);
      assert.equal(saved.ok, true, `${scope}: 판을 못 만들었다`);
      openedBy[scope] = await isOnCurrentShipmentApprovalRoute(approverId);
    }

    // 표본이 비어서 공짜로 통과하지 않게 — 용도 셋을 전부 돌았는가.
    assert.equal(Object.keys(openedBy).length, SHIPMENT_APPROVAL_ROUTE_SCOPES.length);
    assert.equal(
      SHIPMENT_APPROVAL_ROUTE_SCOPES.length > EDITABLE_SHIPMENT_APPROVAL_ROUTE_SCOPES.length,
      true,
      "안 세는 용도가 하나도 없다 — 이 시험이 가를 것이 없다"
    );

    for (const scope of SHIPMENT_APPROVAL_ROUTE_SCOPES) {
      assert.equal(
        openedBy[scope],
        (EDITABLE_SHIPMENT_APPROVAL_ROUTE_SCOPES as readonly string[]).includes(scope),
        `${scope}: 문이 열리는 용도와 [승인 절차] 탭이 그리는 용도가 갈렸다`
      );
    }
  });

  test("🔴 용도마다 현재 판을 따로 고른다 — 판 번호가 큰 쪽에 휩쓸리지 않는다", async () => {
    // 판 번호는 **용도 안에서** 센다. 그래서 다른 용도의 번호가 더 클 수 있고,
    // 「현재 판」을 용도 없이 고르면 그때 엉뚱한 사람이 열린다.
    assert.equal((await saveShipmentApprovalRoute([approverAId], superAdminId, "FINAL_SHIPMENT")).ok, true);
    assert.equal((await saveShipmentApprovalRoute([approverBId], superAdminId, "FINAL_SHIPMENT")).ok, true);
    assert.equal((await saveShipmentApprovalRoute([approverCId], superAdminId, "QUOTE")).ok, true);

    // 출하는 2판(B), 견적서는 1판(C). A 는 출하 1판에만 남았다.
    assert.equal(await isOnCurrentShipmentApprovalRoute(approverBId), true, "출하 현재 판이 안 열렸다");
    assert.equal(await isOnCurrentShipmentApprovalRoute(approverCId), true, "견적서 현재 판이 안 열렸다");
    assert.equal(await isOnCurrentShipmentApprovalRoute(approverAId), false, "출하 옛 판이 아직 열려 있다");
  });

  test("🔴 「현재 판」의 정의가 옆 조회와 **같은 답**을 준다", async () => {
    // 이 판정은 한 질의로 적혀 있고(DISTINCT ON), 화면용 조회는 용도마다
    // ORDER BY version DESC LIMIT 1 로 적혀 있다. 두 적음이 갈리면 「메뉴는
    // 열리는데 결재선에는 없다」(또는 그 반대)가 된다.
    assert.equal((await saveShipmentApprovalRoute([approverAId], superAdminId, "FINAL_SHIPMENT")).ok, true);
    assert.equal((await saveShipmentApprovalRoute([approverBId], superAdminId, "FINAL_SHIPMENT")).ok, true);
    assert.equal((await saveShipmentApprovalRoute([approverCId], superAdminId, "QUOTE")).ok, true);

    // 🔴 맞대는 용도는 **문이 세는 용도와 같은 목록**이다(2026-10-26 에 둘로 좁혔다).
    //    여기에 부품 불출을 넣으면 「현재 판의 정의가 갈렸다」가 아니라 「세는 용도가
    //    다르다」를 재게 되고, 그것은 바로 위 시험의 일이다.
    const fromViewQuery = new Set<string>();
    for (const scope of EDITABLE_SHIPMENT_APPROVAL_ROUTE_SCOPES) {
      const route = await getCurrentShipmentApprovalRoute(scope);
      for (const step of route?.steps ?? []) fromViewQuery.add(step.approverUserId);
    }
    assert.ok(fromViewQuery.size > 0, "맞댈 표본이 비었다");

    for (const userId of [approverAId, approverBId, approverCId, engineerId, superAdminId]) {
      assert.equal(
        await isOnCurrentShipmentApprovalRoute(userId),
        fromViewQuery.has(userId),
        `${userId}: 두 조회의 「현재 판」이 갈렸다`
      );
    }
  });
});
