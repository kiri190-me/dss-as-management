import "../../../../scripts/load-env";

import { after, afterEach, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { eq, inArray, like } from "drizzle-orm";
import { db, pgClient } from "../connection";
import { shipmentApprovalRouteSteps, shipmentApprovalRoutes, users } from "../schema";
import {
  getCurrentShipmentApprovalRoute,
  listSelectableApproverCandidates,
} from "./shipment-approval-routes";
import type { ShipmentApprovalRouteScope } from "@/lib/domain/shipment-approval-route";

/**
 * ============================================================================
 * 승인 절차 읽기 — 실제 DB (시험 DB)
 * ============================================================================
 * 판(version)을 손으로 직접 넣고 읽어 본다 — mutation 을 거치지 않고 표에 바로
 * 넣는다(저장 경로는 mutations/shipment-approval-routes.integration.test.ts 가 본다).
 *
 * 이 파일이 못 박는 것 다섯:
 *  1. **「현재 절차」는 그 용도 안에서 version 이 가장 큰 판이다** — 나중에 넣은
 *     판이 아니다. 그래서 일부러 version 이 큰 판을 **먼저** 넣고 작은 판을
 *     나중에 넣는다. created_at 순으로 고르는 코드였다면 여기서 걸린다.
 *  2. 🔴 **소프트삭제된 사용자의 단계도 빼지 않고 그대로 돌려준다.** 조용히
 *     빼면 절차가 짧아진 것처럼 보이고, 결재가 왜 멈췄는지 아무도 모른다.
 *  3. 🔴 **유니크가 실제로 돈다** — 한 판에 같은 사람, 한 판에 같은 순서, 그리고
 *     한 용도 안에서 겹치는 판 번호. 셋 다 23505 와 **제약 이름까지** 확인한다.
 *     아무 오류나 잡아 통과하는 시험이 되지 않도록.
 *  4. 후보 목록의 자격이 「출하 대표」 지정 조건과 같다 — 비활성·미승인·잠김·
 *     삭제된 계정은 빠진다.
 *  5. 🔴 **용도가 다른 판은 서로를 흔들지 않는다** — 부품 불출 판을 얹어도 출하
 *     쪽 「현재 절차」가 그대로다. 걸러내기를 빠뜨린 조회는 번호가 더 큰 다른
 *     용도의 판을 현재로 잡는다.
 *
 * 격리 규약은 ui-theme-tokens.integration.test.ts 와 같다 — 이 파일이 만든
 * "shiproute-test-" 계정만 쓰고, 그 계정이 남긴 판·단계까지 함께 걷는다
 * (사람 참조가 restrict 라 순서가 있다: 단계 → 판 → 사람).
 * ============================================================================
 */

const TEST_EMAIL_PREFIX = "shiproute-test-";

let creatorId: string;
let approverAId: string;
let approverBId: string;
let approverCId: string;
let deletedApproverId: string;
let inactiveUserId: string;
let pendingUserId: string;
let lockedUserId: string;

const createdRouteIds: string[] = [];

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
  return row.id;
}

/**
 * 판 하나와 그 단계들을 표에 바로 넣는다. steps 는 [순서, 승인자] 짝이다.
 *
 * 🔴 용도를 **첫 인자로 받고 기본값을 두지 않는다.** 이 파일에는 용도가 갈리는
 * 시험이 섞여 있어서, 기본값에 숨겨 두면 어느 시험이 어느 절차를 보는지 읽어
 * 낼 수 없다.
 */
async function insertRoute(
  scope: ShipmentApprovalRouteScope,
  version: number,
  steps: readonly (readonly [number, string])[],
  createdByUserId: string = creatorId
): Promise<string> {
  const [route] = await db
    .insert(shipmentApprovalRoutes)
    .values({ scope, version, createdByUserId })
    .returning({ id: shipmentApprovalRoutes.id });
  createdRouteIds.push(route.id);

  if (steps.length > 0) {
    await db.insert(shipmentApprovalRouteSteps).values(
      steps.map(([stepOrder, approverUserId]) => ({
        routeId: route.id,
        stepOrder,
        approverUserId,
      }))
    );
  }
  return route.id;
}

/**
 * Postgres 오류를 오류 사슬에서 찾아낸다. drizzle 이 던지는 바깥 오류에는 실패한
 * SQL 문만 들어 있고 원래 PostgresError 는 `.cause` 에 달려 있다 —
 * mutations/customers.ts 의 isUniqueViolation 이 둘 다 보는 것과 같은 이유다.
 */
function findPgError(err: unknown): { code: string; constraint: string } | null {
  let current: unknown = err;
  for (let depth = 0; depth < 5 && typeof current === "object" && current !== null; depth += 1) {
    const candidate = current as { code?: unknown; constraint_name?: unknown; cause?: unknown };
    if (typeof candidate.code === "string") {
      return {
        code: candidate.code,
        constraint: typeof candidate.constraint_name === "string" ? candidate.constraint_name : "",
      };
    }
    current = candidate.cause;
  }
  return null;
}

/**
 * 이 insert 가 **그 제약 때문에** 막히는지 본다. 제약 이름까지 맞춰 보는 이유는,
 * 오류가 나기만 하면 통과하는 시험은 표의 제약을 지워도 초록색으로 남기 때문이다
 * (예: 잘못된 uuid, 없는 열 이름도 오류는 난다).
 */
async function assertUniqueViolation(run: () => Promise<unknown>, constraint: string): Promise<void> {
  await assert.rejects(
    async () => {
      await run();
    },
    (err: unknown) => {
      const pgError = findPgError(err);
      assert.ok(pgError, `PostgresError 를 찾지 못했다: ${String(err)}`);
      assert.equal(pgError.code, "23505", `유니크 위반(23505)이 아니라 ${pgError.code} 다`);
      assert.equal(pgError.constraint, constraint, "기대한 제약이 아닌 다른 제약에 걸렸다");
      return true;
    }
  );
}

async function routeRowCount(): Promise<number> {
  const rows = await db.select({ id: shipmentApprovalRoutes.id }).from(shipmentApprovalRoutes);
  return rows.length;
}

async function stepRowCount(routeId: string): Promise<number> {
  const rows = await db
    .select({ id: shipmentApprovalRouteSteps.id })
    .from(shipmentApprovalRouteSteps)
    .where(eq(shipmentApprovalRouteSteps.routeId, routeId));
  return rows.length;
}

/**
 * 이 파일의 계정과 그 계정이 남긴 판·단계를 지운다. 접두사로 고르므로 이전
 * 실행이 중간에 끊겨 남은 것까지 함께 걷는다 — 남으면 「판이 없으면 null」과
 * 「가장 큰 version」 두 단언의 전제가 통째로 깨진다.
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
  await db.delete(shipmentApprovalRoutes).where(inArray(shipmentApprovalRoutes.createdByUserId, ids));
  await db.delete(users).where(inArray(users.id, ids));
}

before(async () => {
  await removeTestUsersByPrefix();

  assert.equal(
    await routeRowCount(),
    0,
    "이 시험은 shipment_approval_routes 가 비어 있는 상태를 전제로 합니다"
  );

  // 이름은 순수 ASCII 로, 정렬 확인이 DB 콜레이션에 흔들리지 않게 한다.
  creatorId = await createTestUser("shiproute admin", { role: "SUPER_ADMIN" });
  approverAId = await createTestUser("shiproute approver A");
  approverBId = await createTestUser("shiproute approver B");
  approverCId = await createTestUser("shiproute approver C");
  deletedApproverId = await createTestUser("shiproute deleted", {
    isDeleted: true,
    deletedAt: new Date(),
  });
  inactiveUserId = await createTestUser("shiproute inactive", { isActive: false });
  pendingUserId = await createTestUser("shiproute pending", { approvalStatus: "PENDING" });
  lockedUserId = await createTestUser("shiproute locked", { lockedAt: new Date() });
});

afterEach(async () => {
  if (createdRouteIds.length === 0) return;
  // 판을 지우면 단계는 cascade 로 함께 사라진다.
  await db.delete(shipmentApprovalRoutes).where(inArray(shipmentApprovalRoutes.id, createdRouteIds));
  createdRouteIds.length = 0;
});

after(async () => {
  await removeTestUsersByPrefix();
  await pgClient.end({ timeout: 5 });
});

describe("getCurrentShipmentApprovalRoute", () => {
  test("판이 하나도 없으면 null 이다 — 이 기능을 넣기 전과 같은 상태다", async () => {
    assert.equal(await routeRowCount(), 0, "이 시험은 표가 빈 상태를 전제로 한다");
    assert.equal(await getCurrentShipmentApprovalRoute("FINAL_SHIPMENT"), null);
  });

  test("단계 0개인 판도 정상으로 읽힌다 — 「절차를 쓰지 않겠다」는 뜻이다", async () => {
    await insertRoute("FINAL_SHIPMENT", 1, []);

    const route = await getCurrentShipmentApprovalRoute("FINAL_SHIPMENT");
    assert.ok(route, "판이 있는데 null 이 나왔다");
    assert.equal(route.version, 1);
    assert.deepEqual(route.steps, [], "단계가 없는 판은 빈 배열이어야 한다");
    assert.equal(route.createdByName, "shiproute admin", "만든 사람 이름이 함께 나와야 한다");
    assert.ok(route.createdAt instanceof Date);
  });

  test("🔴 판이 둘이면 version 이 큰 쪽이 나온다 — 나중에 넣은 판이 아니다", async () => {
    // 큰 번호를 **먼저** 넣는다. created_at 이나 insert 순서로 고르는 코드라면
    // 여기서 작은 쪽이 나온다.
    await insertRoute("FINAL_SHIPMENT", 7, [[1, approverAId]]);
    await insertRoute("FINAL_SHIPMENT", 3, [[1, approverBId]]);

    const route = await getCurrentShipmentApprovalRoute("FINAL_SHIPMENT");
    assert.ok(route);
    assert.equal(route.version, 7, "가장 큰 판이 아니라 다른 판이 나왔다");
    assert.deepEqual(
      route.steps.map((step) => step.approverUserId),
      [approverAId],
      "다른 판의 단계가 섞여 나왔다"
    );
  });

  test("🔴 단계가 step_order 순서대로 나온다 — 넣은 순서가 아니다", async () => {
    // 일부러 뒤섞어 넣는다. ORDER BY 가 없으면 Postgres 는 순서를 보장하지 않는다.
    await insertRoute("FINAL_SHIPMENT", 1, [
      [3, approverCId],
      [1, approverAId],
      [2, approverBId],
    ]);

    const route = await getCurrentShipmentApprovalRoute("FINAL_SHIPMENT");
    assert.ok(route);
    assert.deepEqual(
      route.steps.map((step) => [step.stepOrder, step.approverUserId]),
      [
        [1, approverAId],
        [2, approverBId],
        [3, approverCId],
      ]
    );
  });

  test("승인자의 지금 상태가 함께 나온다 — 화면이 이유를 말해 줄 수 있어야 한다", async () => {
    await insertRoute("FINAL_SHIPMENT", 1, [[1, approverAId]]);

    const route = await getCurrentShipmentApprovalRoute("FINAL_SHIPMENT");
    assert.ok(route);
    const [step] = route.steps;
    assert.equal(step.approverName, "shiproute approver A");
    assert.equal(step.approverRole, "AS_ENGINEER");
    assert.equal(step.approverIsActive, true);
    assert.equal(step.approverApprovalStatus, "APPROVED");
    assert.equal(step.approverLockedAt, null);
    assert.equal(step.approverIsDeleted, false);
  });

  test("🔴 소프트삭제된 사용자의 단계도 그대로 나오고 approverIsDeleted 가 참이다", async () => {
    // 조용히 빼면 절차가 짧아진 것처럼 보이고, 결재가 왜 그 자리에서 멈췄는지
    // 화면에서 알 방법이 없어진다.
    await insertRoute("FINAL_SHIPMENT", 1, [
      [1, approverAId],
      [2, deletedApproverId],
      [3, approverBId],
    ]);

    const route = await getCurrentShipmentApprovalRoute("FINAL_SHIPMENT");
    assert.ok(route);
    assert.equal(route.steps.length, 3, "삭제된 사용자의 단계가 조용히 빠졌다");
    assert.deepEqual(
      route.steps.map((step) => step.approverUserId),
      [approverAId, deletedApproverId, approverBId]
    );
    assert.equal(route.steps[1].approverIsDeleted, true);
    assert.equal(route.steps[0].approverIsDeleted, false);
    assert.equal(route.steps[2].approverIsDeleted, false);
  });

  test("비활성·미승인·잠긴 계정의 단계도 상태를 실은 채 그대로 나온다", async () => {
    await insertRoute("FINAL_SHIPMENT", 1, [
      [1, inactiveUserId],
      [2, pendingUserId],
      [3, lockedUserId],
    ]);

    const route = await getCurrentShipmentApprovalRoute("FINAL_SHIPMENT");
    assert.ok(route);
    assert.equal(route.steps.length, 3);
    assert.equal(route.steps[0].approverIsActive, false);
    assert.equal(route.steps[1].approverApprovalStatus, "PENDING");
    assert.ok(route.steps[2].approverLockedAt instanceof Date, "잠긴 시각이 나와야 한다");
  });
});

describe("표의 제약이 실제로 도는가", () => {
  test("🔴 같은 판에 같은 사람을 두 번 넣으면 DB 가 거절한다", async () => {
    const routeId = await insertRoute("FINAL_SHIPMENT", 1, [[1, approverAId]]);

    await assertUniqueViolation(
      () =>
        db.insert(shipmentApprovalRouteSteps).values({
          routeId,
          stepOrder: 2,
          approverUserId: approverAId,
        }),
      "shipment_approval_route_steps_approver_unique"
    );

    assert.equal(await stepRowCount(routeId), 1, "거절됐는데 줄이 늘었다");
  });

  test("🔴 같은 판에 같은 순서를 두 번 넣으면 DB 가 거절한다", async () => {
    const routeId = await insertRoute("FINAL_SHIPMENT", 1, [[1, approverAId]]);

    await assertUniqueViolation(
      () =>
        db.insert(shipmentApprovalRouteSteps).values({
          routeId,
          stepOrder: 1,
          approverUserId: approverBId,
        }),
      "shipment_approval_route_steps_order_unique"
    );

    assert.equal(await stepRowCount(routeId), 1, "거절됐는데 줄이 늘었다");
  });

  test("다른 판이면 같은 사람도 같은 순서도 괜찮다 — 유니크는 판 안에서만이다", async () => {
    await insertRoute("FINAL_SHIPMENT", 1, [[1, approverAId]]);
    await insertRoute("FINAL_SHIPMENT", 2, [[1, approverAId]]);

    const route = await getCurrentShipmentApprovalRoute("FINAL_SHIPMENT");
    assert.ok(route);
    assert.equal(route.version, 2);
    assert.equal(route.steps.length, 1);
  });

  test("🔴 같은 용도 안에서 판 번호가 겹치면 DB 가 거절한다 — 「현재 절차」의 정의가 여기 걸려 있다", async () => {
    await insertRoute("FINAL_SHIPMENT", 4, []);

    await assertUniqueViolation(
      () =>
        db
          .insert(shipmentApprovalRoutes)
          .values({ scope: "FINAL_SHIPMENT", version: 4, createdByUserId: creatorId }),
      "shipment_approval_routes_scope_version_unique"
    );

    assert.equal(await routeRowCount(), 1, "거절됐는데 판이 늘었다");
  });

  test("🔴 용도가 다르면 같은 판 번호를 써도 된다 — 유니크는 (용도, 번호) 다", async () => {
    // 판 번호는 「이 절차의 몇 번째 판인가」다. 출하 1판과 불출 1판이 함께 있는
    // 것이 정상이고, 여기서 막히면 두 번째 용도는 1판을 영영 가질 수 없다.
    await insertRoute("FINAL_SHIPMENT", 1, [[1, approverAId]]);
    await insertRoute("PART_ISSUE", 1, [[1, approverAId]]);

    assert.equal(await routeRowCount(), 2, "다른 용도의 같은 번호가 거절됐다");
  });
});

describe("🔴 용도가 다른 판은 서로를 흔들지 않는다", () => {
  test("부품 불출 판을 얹어도 출하 쪽 「현재 절차」가 그대로다", async () => {
    // 이 조각의 핵심이다. 판 번호는 용도 안에서 세므로, 걸러내기를 빠뜨린 조회는
    // 번호가 더 큰 불출 판을 출하의 현재로 잡는다.
    await insertRoute("FINAL_SHIPMENT", 1, [[1, approverAId]]);
    await insertRoute("PART_ISSUE", 9, [[1, approverBId]]);

    const shipment = await getCurrentShipmentApprovalRoute("FINAL_SHIPMENT");
    assert.ok(shipment, "출하 판이 사라졌다");
    assert.equal(shipment.scope, "FINAL_SHIPMENT");
    assert.equal(shipment.version, 1, "다른 용도의 판을 출하의 현재로 잡았다");
    assert.deepEqual(
      shipment.steps.map((step) => step.approverUserId),
      [approverAId],
      "다른 용도의 단계가 섞여 나왔다"
    );
  });

  test("한쪽 용도의 판만 있으면 다른 쪽은 null 이다 — 「판 없음」이 용도별로 판정된다", async () => {
    await insertRoute("FINAL_SHIPMENT", 1, [[1, approverAId]]);

    assert.equal(
      await getCurrentShipmentApprovalRoute("PART_ISSUE"),
      null,
      "출하 판을 불출의 현재로 내줬다"
    );
  });

  test("용도 안에서는 여전히 번호가 가장 큰 판이 현재다", async () => {
    await insertRoute("PART_ISSUE", 1, [[1, approverAId]]);
    // 큰 번호를 나중에, 그리고 그 사이에 출하 판을 끼워 넣는다.
    await insertRoute("FINAL_SHIPMENT", 5, [[1, approverCId]]);
    await insertRoute("PART_ISSUE", 2, [[1, approverBId]]);

    const partIssue = await getCurrentShipmentApprovalRoute("PART_ISSUE");
    assert.ok(partIssue);
    assert.equal(partIssue.version, 2);
    assert.deepEqual(
      partIssue.steps.map((step) => step.approverUserId),
      [approverBId]
    );

    const shipment = await getCurrentShipmentApprovalRoute("FINAL_SHIPMENT");
    assert.ok(shipment);
    assert.equal(shipment.version, 5);
  });
});

describe("listSelectableApproverCandidates", () => {
  test("🔴 승인·활성·안 잠김·안 지워짐 넷을 모두 만족하는 계정만 나온다", async () => {
    // 자격 규칙은 setShipmentRepresentative(mutations/shipment-representatives.ts)와
    // 글자 그대로 같아야 한다 — 절차가 「출하 대표」를 대신하기 때문이다.
    const candidateIds = new Set((await listSelectableApproverCandidates()).map((row) => row.id));

    assert.ok(candidateIds.has(approverAId), "정상 계정이 후보에서 빠졌다");
    assert.ok(candidateIds.has(approverBId));
    assert.ok(candidateIds.has(approverCId));
    // 역할 제한은 없다 — 대표 지정도 역할을 보지 않는다.
    assert.ok(candidateIds.has(creatorId), "최고관리자가 후보에서 빠졌다");

    assert.equal(candidateIds.has(deletedApproverId), false, "삭제된 계정이 후보에 있다");
    assert.equal(candidateIds.has(inactiveUserId), false, "비활성 계정이 후보에 있다");
    assert.equal(candidateIds.has(pendingUserId), false, "승인 대기 계정이 후보에 있다");
    assert.equal(candidateIds.has(lockedUserId), false, "잠긴 계정이 후보에 있다");
  });

  test("이름 순으로 나온다", async () => {
    const rows = await listSelectableApproverCandidates();
    const mine = rows
      .filter((row) => [approverAId, approverBId, approverCId].includes(row.id))
      .map((row) => row.id);
    assert.deepEqual(mine, [approverAId, approverBId, approverCId]);
  });

  test("화면이 사람을 구별할 만큼은 실어 보낸다 — 이름·이메일·역할", async () => {
    const rows = await listSelectableApproverCandidates();
    const row = rows.find((candidate) => candidate.id === approverAId);
    assert.ok(row, "만든 계정이 후보에 없다");
    assert.equal(row.name, "shiproute approver A");
    assert.equal(row.role, "AS_ENGINEER");
    assert.ok(row.email.startsWith(TEST_EMAIL_PREFIX));
  });
});
