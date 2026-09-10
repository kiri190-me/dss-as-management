import "../../../../scripts/load-env";

import { after, afterEach, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { eq, inArray, like } from "drizzle-orm";
import { db, pgClient } from "../connection";
import {
  inventoryPartIssueApprovals,
  inventoryPartIssueRequestItems,
  inventoryPartIssueRequests,
  inventoryPartRequestItems,
  inventoryPartRequests,
  partStockBalances,
  parts,
  shipmentApprovalRouteSteps,
  shipmentApprovalRoutes,
  users,
} from "../schema";
import {
  getPartIssueRequestDetail,
  listExecutablePartIssueRequests,
  listPartIssueRequestsForPartRequest,
  listPartIssueRequestsPendingMyApproval,
} from "./inventory-part-issue-requests";

/**
 * ============================================================================
 * 부품 불출 승인 표 셋 — 실제 DB (시험 DB)
 * ============================================================================
 * 표를 손으로 직접 채우고 읽어 본다. **이 조각에는 저장 경로(mutation)가 아직
 * 없다** — 문을 다는 것은 다음 조각이므로, 여기서 보는 것은 「표가 무엇을 막고
 * 무엇을 허락하는가」와 「읽는 길이 제대로 묶어 오는가」다.
 *
 * 이 파일이 못 박는 것 여섯:
 *  1. 🔴 **표 셋이 비어 있는 것이 정상 초기 상태다** — 「부품 불출」 결재선 판을
 *     만들기 전까지 이 기능은 없는 것과 같이 동작한다(schema 머리말의 안전장치).
 *  2. 🔴 **한 신청에 결재 대기(REQUESTED) 행은 둘이 될 수 없다** — 부분 유니크가
 *     실제로 막는지, 제약 이름까지 확인한다. 「한 번에 한 단계」가 여기 걸려 있다.
 *  3. 결재선 두 칸은 **하나만 채워질 수 없다**(CHECK).
 *  4. 결정 정보의 짝이 어긋난 행은 들어가지 않는다(CHECK) — 사유 없는 반려,
 *     결정자 없는 승인, 대기 중인데 결정 칸이 채워진 행.
 *  5. 수량은 1 이상이어야 한다(CHECK). 그리고 한 신청 안에서 같은 잔량 행이 두 줄로
 *     나뉘지 않는다.
 *  6. 읽는 길이 신청 + 항목 + 승인 이력을 제대로 묶어 오고, 「내가 결재할 불출
 *     신청」은 **지정된 사람과 최고관리자에게만** 보인다.
 *
 * 격리·청소 규약은 mutations/repair-case-approvals-route.integration.test.ts 를
 * 본떴다. 이 파일이 만든 "partissue-test-" 계정·부품만 쓰고,
 * ⚠️ **만든 행은 afterEach 로 반드시 걷는다.** 사람 참조가 RESTRICT 라 삭제에는
 * 순서가 있다: 승인 행 → 신청 항목 → 신청 → 부품 요청 항목 → 부품 요청 →
 * 결재선 단계 → 결재선 판 → 잔량 → 부품 → 사람.
 *
 * 🔴 부품 이름 접두사를 "test-inventory-" 로 하지 **않는다.** 그 접두사는
 * mutations/inventory.integration.test.ts 가 자기 after() 에서 통째로 지우는
 * 것이라, 이 파일이 중간에 끊겨 남긴 행이 있으면 그쪽 청소가 이 표의 RESTRICT 에
 * 걸려 **남의 시험이 깨진다.**
 * ============================================================================
 */

const TEST_EMAIL_PREFIX = "partissue-test-";
const TEST_PART_PREFIX = "partissue-test-";
const TEST_LOCATION = "PARTISSUE-TEST-SHELF";

let requesterId: string;
let approverAId: string;
let approverBId: string;
let superAdminId: string;
let outsiderId: string;
let inactiveApproverId: string;
let partId: string;
let balanceAId: string;
let balanceBId: string;

const createdIssueRequestIds: string[] = [];
const createdPartRequestIds: string[] = [];
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
      isDeveloper: false,
      ...overrides,
    })
    .returning({ id: users.id });
  return row.id;
}

/**
 * Postgres 오류를 오류 사슬에서 찾아낸다 — drizzle 이 던지는 바깥 오류에는 실패한
 * SQL 문만 들어 있고 원래 PostgresError 는 `.cause` 에 달려 있다
 * (queries/shipment-approval-routes.integration.test.ts 와 같은 도우미다).
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
 * 오류가 나기만 하면 통과하는 시험은 표의 제약을 지워도 초록색으로 남기 때문이다.
 */
async function assertConstraintViolation(
  run: () => Promise<unknown>,
  code: string,
  constraint: string
): Promise<void> {
  await assert.rejects(
    async () => {
      await run();
    },
    (err: unknown) => {
      const pgError = findPgError(err);
      assert.ok(pgError, `PostgresError 를 찾지 못했다: ${String(err)}`);
      assert.equal(pgError.code, code, `기대한 오류코드가 아니라 ${pgError.code} 다`);
      assert.equal(pgError.constraint, constraint, "기대한 제약이 아닌 다른 제약에 걸렸다");
      return true;
    }
  );
}

/** 결재선 판 하나. 부품 불출 용도로만 만든다. */
async function insertPartIssueRoute(
  version: number,
  approverUserIds: readonly string[]
): Promise<string> {
  const [route] = await db
    .insert(shipmentApprovalRoutes)
    .values({ scope: "PART_ISSUE", version, createdByUserId: superAdminId })
    .returning({ id: shipmentApprovalRoutes.id });
  createdRouteIds.push(route.id);

  if (approverUserIds.length > 0) {
    await db.insert(shipmentApprovalRouteSteps).values(
      approverUserIds.map((approverUserId, index) => ({
        routeId: route.id,
        stepOrder: index + 1,
        approverUserId,
      }))
    );
  }
  return route.id;
}

/** 직접 사용(부품 요청 없이 바로 빼는) 신청 하나. */
async function insertDirectIssueRequest(
  overrides: Partial<typeof inventoryPartIssueRequests.$inferInsert> = {}
): Promise<string> {
  const [row] = await db
    .insert(inventoryPartIssueRequests)
    .values({
      requestedByUserId: requesterId,
      destinationNote: "상해수리소",
      ...overrides,
    })
    .returning({ id: inventoryPartIssueRequests.id });
  createdIssueRequestIds.push(row.id);
  return row.id;
}

/** 부품 요청 하나와 그 줄 하나 — 요청 기반 불출을 만들 때 쓴다. */
async function insertPartRequestWithItem(): Promise<{ requestId: string; itemId: string }> {
  const [request] = await db
    .insert(inventoryPartRequests)
    .values({ requestedByUserId: requesterId, note: "partissue-test" })
    .returning({ id: inventoryPartRequests.id });
  createdPartRequestIds.push(request.id);

  const [item] = await db
    .insert(inventoryPartRequestItems)
    .values({ requestId: request.id, partId, requestedQuantity: 5 })
    .returning({ id: inventoryPartRequestItems.id });

  return { requestId: request.id, itemId: item.id };
}

/** 대기 중인 승인 행 하나. */
async function insertPendingApproval(
  issueRequestId: string,
  values: Partial<typeof inventoryPartIssueApprovals.$inferInsert> = {}
): Promise<string> {
  const [row] = await db
    .insert(inventoryPartIssueApprovals)
    .values({
      issueRequestId,
      requestedByUserId: requesterId,
      ...values,
    })
    .returning({ id: inventoryPartIssueApprovals.id });
  return row.id;
}

/** 이 파일이 만든 신청·승인·부품 요청을 걷는다. 사람·부품은 after() 가 지운다. */
async function removeIssueFixtures(): Promise<void> {
  if (createdIssueRequestIds.length > 0) {
    // 승인 행은 신청을 RESTRICT 로 참조한다 — 승인 행이 먼저다. 항목은 CASCADE 지만
    // 순서를 눈에 보이게 두려고 명시적으로 지운다.
    await db
      .delete(inventoryPartIssueApprovals)
      .where(inArray(inventoryPartIssueApprovals.issueRequestId, createdIssueRequestIds));
    await db
      .delete(inventoryPartIssueRequestItems)
      .where(inArray(inventoryPartIssueRequestItems.issueRequestId, createdIssueRequestIds));
    await db
      .delete(inventoryPartIssueRequests)
      .where(inArray(inventoryPartIssueRequests.id, createdIssueRequestIds));
    createdIssueRequestIds.length = 0;
  }

  if (createdPartRequestIds.length > 0) {
    await db
      .delete(inventoryPartRequestItems)
      .where(inArray(inventoryPartRequestItems.requestId, createdPartRequestIds));
    await db
      .delete(inventoryPartRequests)
      .where(inArray(inventoryPartRequests.id, createdPartRequestIds));
    createdPartRequestIds.length = 0;
  }

  if (createdRouteIds.length > 0) {
    // 판을 지우면 단계는 cascade 로 함께 사라진다.
    await db.delete(shipmentApprovalRoutes).where(inArray(shipmentApprovalRoutes.id, createdRouteIds));
    createdRouteIds.length = 0;
  }
}

/** 이전 실행이 중간에 끊겨 남은 이 파일의 흔적까지 걷는다. */
async function removeTestFixturesByPrefix(): Promise<void> {
  const leftoverParts = await db
    .select({ id: parts.id })
    .from(parts)
    .where(like(parts.partName, `${TEST_PART_PREFIX}%`));
  const partIds = leftoverParts.map((row) => row.id);

  const leftoverUsers = await db
    .select({ id: users.id })
    .from(users)
    .where(like(users.email, `${TEST_EMAIL_PREFIX}%`));
  const userIds = leftoverUsers.map((row) => row.id);

  if (userIds.length > 0) {
    const issueRequests = await db
      .select({ id: inventoryPartIssueRequests.id })
      .from(inventoryPartIssueRequests)
      .where(inArray(inventoryPartIssueRequests.requestedByUserId, userIds));
    const issueRequestIds = issueRequests.map((row) => row.id);
    if (issueRequestIds.length > 0) {
      await db
        .delete(inventoryPartIssueApprovals)
        .where(inArray(inventoryPartIssueApprovals.issueRequestId, issueRequestIds));
      await db
        .delete(inventoryPartIssueRequestItems)
        .where(inArray(inventoryPartIssueRequestItems.issueRequestId, issueRequestIds));
      await db
        .delete(inventoryPartIssueRequests)
        .where(inArray(inventoryPartIssueRequests.id, issueRequestIds));
    }

    const partRequests = await db
      .select({ id: inventoryPartRequests.id })
      .from(inventoryPartRequests)
      .where(inArray(inventoryPartRequests.requestedByUserId, userIds));
    const partRequestIds = partRequests.map((row) => row.id);
    if (partRequestIds.length > 0) {
      await db
        .delete(inventoryPartRequestItems)
        .where(inArray(inventoryPartRequestItems.requestId, partRequestIds));
      await db
        .delete(inventoryPartRequests)
        .where(inArray(inventoryPartRequests.id, partRequestIds));
    }

    await db
      .delete(shipmentApprovalRouteSteps)
      .where(inArray(shipmentApprovalRouteSteps.approverUserId, userIds));
    await db
      .delete(shipmentApprovalRoutes)
      .where(inArray(shipmentApprovalRoutes.createdByUserId, userIds));
  }

  if (partIds.length > 0) {
    await db.delete(partStockBalances).where(inArray(partStockBalances.partId, partIds));
    await db.delete(parts).where(inArray(parts.id, partIds));
  }

  if (userIds.length > 0) {
    await db.delete(users).where(inArray(users.id, userIds));
  }
}

before(async () => {
  await removeTestFixturesByPrefix();

  const [leftoverIssueRequest] = await db
    .select({ id: inventoryPartIssueRequests.id })
    .from(inventoryPartIssueRequests)
    .limit(1);
  assert.equal(
    leftoverIssueRequest,
    undefined,
    "이 시험은 inventory_part_issue_requests 가 비어 있는 상태를 전제로 합니다"
  );

  const [leftoverRoute] = await db
    .select({ id: shipmentApprovalRoutes.id })
    .from(shipmentApprovalRoutes)
    .limit(1);
  assert.equal(
    leftoverRoute,
    undefined,
    "이 시험은 shipment_approval_routes 가 비어 있는 상태를 전제로 합니다"
  );

  requesterId = await createTestUser("partissue requester");
  approverAId = await createTestUser("partissue approver A");
  approverBId = await createTestUser("partissue approver B");
  superAdminId = await createTestUser("partissue super admin", { role: "SUPER_ADMIN" });
  outsiderId = await createTestUser("partissue outsider");
  inactiveApproverId = await createTestUser("partissue inactive", { isActive: false });

  const [part] = await db
    .insert(parts)
    .values({ partName: `${TEST_PART_PREFIX}${randomUUID().slice(0, 8)}` })
    .returning({ id: parts.id });
  partId = part.id;

  const [balanceA] = await db
    .insert(partStockBalances)
    .values({ partId, owner: "DSS", location: `${TEST_LOCATION}-A`, currentQuantity: 10 })
    .returning({ id: partStockBalances.id });
  balanceAId = balanceA.id;

  const [balanceB] = await db
    .insert(partStockBalances)
    .values({ partId, owner: "KYOSAN", location: `${TEST_LOCATION}-B`, currentQuantity: 4 })
    .returning({ id: partStockBalances.id });
  balanceBId = balanceB.id;
});

afterEach(async () => {
  await removeIssueFixtures();
});

after(async () => {
  await removeTestFixturesByPrefix();
  await pgClient.end({ timeout: 5 });
});

describe("표 셋의 초기 상태", () => {
  test("🔴 세 표 모두 0행이다 — 결재선 판을 만들기 전까지 이 기능은 없는 것과 같다", async () => {
    const requestRows = await db.select({ id: inventoryPartIssueRequests.id }).from(inventoryPartIssueRequests);
    const itemRows = await db.select({ id: inventoryPartIssueRequestItems.id }).from(inventoryPartIssueRequestItems);
    const approvalRows = await db.select({ id: inventoryPartIssueApprovals.id }).from(inventoryPartIssueApprovals);
    assert.equal(requestRows.length, 0);
    assert.equal(itemRows.length, 0);
    assert.equal(approvalRows.length, 0);
  });

  test("판이 없으면 읽는 길도 아무것도 내놓지 않는다", async () => {
    assert.deepEqual(await listExecutablePartIssueRequests(), []);
    assert.deepEqual(await listPartIssueRequestsPendingMyApproval(approverAId), []);
    assert.equal(await getPartIssueRequestDetail(randomUUID()), null);
  });
});

describe("단계별 승인 — 한 번에 한 단계", () => {
  test("🔴 한 신청에 REQUESTED 인 행은 둘이 될 수 없다", async () => {
    const issueRequestId = await insertDirectIssueRequest();
    const routeId = await insertPartIssueRoute(1, [approverAId, approverBId]);

    await insertPendingApproval(issueRequestId, {
      routeId,
      routeStepOrder: 1,
      assignedApproverUserId: approverAId,
    });

    await assertConstraintViolation(
      () =>
        insertPendingApproval(issueRequestId, {
          routeId,
          routeStepOrder: 2,
          assignedApproverUserId: approverBId,
        }),
      "23505",
      "inventory_part_issue_approvals_one_active_request"
    );
  });

  test("앞 단계를 닫으면 다음 단계 행이 들어간다 — 사슬은 이렇게 나아간다", async () => {
    const issueRequestId = await insertDirectIssueRequest();
    const routeId = await insertPartIssueRoute(1, [approverAId, approverBId]);

    const firstId = await insertPendingApproval(issueRequestId, {
      routeId,
      routeStepOrder: 1,
      assignedApproverUserId: approverAId,
    });

    await db
      .update(inventoryPartIssueApprovals)
      .set({ status: "APPROVED", decidedByUserId: approverAId, decidedAt: new Date() })
      .where(eq(inventoryPartIssueApprovals.id, firstId));

    await insertPendingApproval(issueRequestId, {
      routeId,
      routeStepOrder: 2,
      assignedApproverUserId: approverBId,
    });

    const rows = await db
      .select({ id: inventoryPartIssueApprovals.id })
      .from(inventoryPartIssueApprovals)
      .where(eq(inventoryPartIssueApprovals.issueRequestId, issueRequestId));
    assert.equal(rows.length, 2);
  });

  test("다른 신청이라면 동시에 대기해도 된다", async () => {
    const firstRequestId = await insertDirectIssueRequest();
    const secondRequestId = await insertDirectIssueRequest();
    const routeId = await insertPartIssueRoute(1, [approverAId]);

    await insertPendingApproval(firstRequestId, {
      routeId,
      routeStepOrder: 1,
      assignedApproverUserId: approverAId,
    });
    await insertPendingApproval(secondRequestId, {
      routeId,
      routeStepOrder: 1,
      assignedApproverUserId: approverAId,
    });

    const rows = await db
      .select({ id: inventoryPartIssueApprovals.id })
      .from(inventoryPartIssueApprovals);
    assert.equal(rows.length, 2);
  });
});

describe("단계별 승인 — CHECK", () => {
  test("🔴 결재선 두 칸은 하나만 채워질 수 없다", async () => {
    const issueRequestId = await insertDirectIssueRequest();
    const routeId = await insertPartIssueRoute(1, [approverAId]);

    await assertConstraintViolation(
      () => insertPendingApproval(issueRequestId, { routeId, assignedApproverUserId: approverAId }),
      "23514",
      "inventory_part_issue_approvals_route_columns_together"
    );

    await assertConstraintViolation(
      () => insertPendingApproval(issueRequestId, { routeStepOrder: 1, assignedApproverUserId: approverAId }),
      "23514",
      "inventory_part_issue_approvals_route_columns_together"
    );
  });

  test("단계 번호는 1부터다", async () => {
    const issueRequestId = await insertDirectIssueRequest();
    const routeId = await insertPartIssueRoute(1, [approverAId]);

    await assertConstraintViolation(
      () =>
        insertPendingApproval(issueRequestId, {
          routeId,
          routeStepOrder: 0,
          assignedApproverUserId: approverAId,
        }),
      "23514",
      "inventory_part_issue_approvals_route_step_order_positive"
    );
  });

  test("대기 중인데 결정 칸이 채워진 행은 들어가지 않는다", async () => {
    const issueRequestId = await insertDirectIssueRequest();

    await assertConstraintViolation(
      () =>
        insertPendingApproval(issueRequestId, {
          decidedByUserId: approverAId,
          decidedAt: new Date(),
        }),
      "23514",
      "inventory_part_issue_approvals_decision_metadata"
    );
  });

  test("결정자 없는 승인은 들어가지 않는다", async () => {
    const issueRequestId = await insertDirectIssueRequest();

    await assertConstraintViolation(
      () => insertPendingApproval(issueRequestId, { status: "APPROVED" }),
      "23514",
      "inventory_part_issue_approvals_decision_metadata"
    );
  });

  test("🔴 사유 없는 반려는 들어가지 않는다 — 요청자가 무엇을 고쳐야 할지 알 수 없다", async () => {
    const issueRequestId = await insertDirectIssueRequest();

    await assertConstraintViolation(
      () =>
        insertPendingApproval(issueRequestId, {
          status: "REJECTED",
          decidedByUserId: approverAId,
          decidedAt: new Date(),
        }),
      "23514",
      "inventory_part_issue_approvals_decision_metadata"
    );

    // 사유가 있으면 들어간다 — 위 시험이 「반려 자체가 막힌다」로 통과하지 않도록.
    await insertPendingApproval(issueRequestId, {
      status: "REJECTED",
      decidedByUserId: approverAId,
      decidedAt: new Date(),
      decisionReason: "재고가 곧 다른 건에 쓰인다",
    });
  });
});

describe("신청 헤더 — CHECK", () => {
  test("직접 사용은 접수 건이나 사용처 중 하나를 말해야 한다", async () => {
    await assertConstraintViolation(
      () =>
        db.insert(inventoryPartIssueRequests).values({
          requestedByUserId: requesterId,
        }),
      "23514",
      "inventory_part_issue_requests_direct_use_has_destination"
    );
  });

  test("요청 기반 불출은 사용처를 여기 다시 적지 않는다", async () => {
    const { requestId } = await insertPartRequestWithItem();

    await assertConstraintViolation(
      () =>
        db.insert(inventoryPartIssueRequests).values({
          requestedByUserId: requesterId,
          partRequestId: requestId,
          destinationNote: "여기 적으면 안 된다",
        }),
      "23514",
      // ⚠️ 스키마 파일에 적힌 이름은 64자라 Postgres 가 63바이트로 잘라 넣었다 —
      // 여기서 보는 것은 **표에 실제로 들어간 이름**이다(스키마 쪽 주석 참조).
      // 이 시험이 잘린 이름을 못 박아 두는 이유: 다음 조각이 오류를 제약 이름으로
      // 가려내려 할 때 어느 쪽을 봐야 하는지가 여기 남는다.
      "inventory_part_issue_requests_direct_use_columns_only_when_dire"
    );
  });

  test("🔴 실행 기록과 상태는 같은 말이다", async () => {
    // 실행됨인데 실행한 사람이 없다.
    await assertConstraintViolation(
      () =>
        db.insert(inventoryPartIssueRequests).values({
          requestedByUserId: requesterId,
          destinationNote: "상해수리소",
          status: "EXECUTED",
        }),
      "23514",
      "inventory_part_issue_requests_execution_metadata"
    );

    // 실행 기록은 있는데 상태는 승인됨.
    await assertConstraintViolation(
      () =>
        db.insert(inventoryPartIssueRequests).values({
          requestedByUserId: requesterId,
          destinationNote: "상해수리소",
          status: "APPROVED",
          executedByUserId: requesterId,
          executedAt: new Date(),
        }),
      "23514",
      "inventory_part_issue_requests_execution_metadata"
    );

    // 둘이 맞으면 들어간다.
    await insertDirectIssueRequest({
      status: "EXECUTED",
      executedByUserId: requesterId,
      executedAt: new Date(),
    });
  });
});

describe("신청 항목 — CHECK·유니크", () => {
  test("🔴 수량 0이나 음수는 들어가지 않는다", async () => {
    const issueRequestId = await insertDirectIssueRequest();

    for (const quantity of [0, -1]) {
      await assertConstraintViolation(
        () =>
          db.insert(inventoryPartIssueRequestItems).values({
            issueRequestId,
            partStockBalanceId: balanceAId,
            quantity,
          }),
        "23514",
        "inventory_part_issue_request_items_quantity_positive"
      );
    }
  });

  test("한 신청 안에서 같은 잔량 행이 두 줄로 나뉘지 않는다", async () => {
    const issueRequestId = await insertDirectIssueRequest();
    await db
      .insert(inventoryPartIssueRequestItems)
      .values({ issueRequestId, partStockBalanceId: balanceAId, quantity: 2 });

    await assertConstraintViolation(
      () =>
        db
          .insert(inventoryPartIssueRequestItems)
          .values({ issueRequestId, partStockBalanceId: balanceAId, quantity: 3 }),
      "23505",
      "inventory_part_issue_request_items_balance_unique"
    );

    // 다른 잔량 행은 같은 신청에 함께 들어간다.
    await db
      .insert(inventoryPartIssueRequestItems)
      .values({ issueRequestId, partStockBalanceId: balanceBId, quantity: 1 });
  });

  test("신청을 지우면 항목이 함께 사라진다(CASCADE)", async () => {
    const issueRequestId = await insertDirectIssueRequest();
    await db
      .insert(inventoryPartIssueRequestItems)
      .values({ issueRequestId, partStockBalanceId: balanceAId, quantity: 2 });

    await db.delete(inventoryPartIssueRequests).where(eq(inventoryPartIssueRequests.id, issueRequestId));
    createdIssueRequestIds.splice(createdIssueRequestIds.indexOf(issueRequestId), 1);

    const rows = await db
      .select({ id: inventoryPartIssueRequestItems.id })
      .from(inventoryPartIssueRequestItems)
      .where(eq(inventoryPartIssueRequestItems.issueRequestId, issueRequestId));
    assert.equal(rows.length, 0);
  });
});

describe("getPartIssueRequestDetail", () => {
  test("직접 사용 — 신청 + 항목 + 승인 이력을 묶어 온다", async () => {
    const issueRequestId = await insertDirectIssueRequest({ requestReason: "긴급 교체" });
    const routeId = await insertPartIssueRoute(1, [approverAId, approverBId]);

    await db.insert(inventoryPartIssueRequestItems).values([
      { issueRequestId, partStockBalanceId: balanceAId, quantity: 2 },
      { issueRequestId, partStockBalanceId: balanceBId, quantity: 1 },
    ]);

    const firstId = await insertPendingApproval(issueRequestId, {
      routeId,
      routeStepOrder: 1,
      assignedApproverUserId: approverAId,
      requestReason: "긴급 교체",
    });
    await db
      .update(inventoryPartIssueApprovals)
      .set({ status: "APPROVED", decidedByUserId: approverAId, decidedAt: new Date() })
      .where(eq(inventoryPartIssueApprovals.id, firstId));
    await insertPendingApproval(issueRequestId, {
      routeId,
      routeStepOrder: 2,
      assignedApproverUserId: approverBId,
      requestReason: "긴급 교체",
    });

    const detail = await getPartIssueRequestDetail(issueRequestId);
    assert.ok(detail, "신청을 찾지 못했다");
    assert.equal(detail.status, "PENDING_APPROVAL");
    assert.equal(detail.partRequestId, null);
    assert.equal(detail.repairCaseId, null);
    assert.equal(detail.intakeNumber, null);
    assert.equal(detail.destinationNote, "상해수리소");
    assert.equal(detail.requestedByName, "partissue requester");
    assert.equal(detail.executedByUserId, null);
    assert.equal(detail.executedAt, null);

    assert.equal(detail.items.length, 2);
    const byBalance = new Map(detail.items.map((item) => [item.partStockBalanceId, item]));
    const itemA = byBalance.get(balanceAId);
    assert.ok(itemA, "잔량 A 항목이 없다");
    assert.equal(itemA.quantity, 2);
    assert.equal(itemA.owner, "DSS");
    assert.equal(itemA.location, `${TEST_LOCATION}-A`);
    assert.equal(itemA.currentQuantity, 10);
    assert.equal(itemA.partId, partId);
    assert.equal(itemA.requestItemId, null);

    assert.equal(detail.approvals.length, 2);
    assert.deepEqual(
      detail.approvals.map((row) => row.routeStepOrder),
      [1, 2]
    );
    assert.equal(detail.approvals[0].status, "APPROVED");
    assert.equal(detail.approvals[0].decidedByName, "partissue approver A");
    assert.ok(detail.approvals[0].decidedAt, "결정 시각이 없다");
    assert.equal(detail.approvals[1].status, "REQUESTED");
    assert.equal(detail.approvals[1].assignedApproverName, "partissue approver B");
    assert.equal(detail.approvals[1].decidedByName, null);
    assert.equal(detail.approvals[1].decidedAt, null);
    // 🔴 요청 시점의 판을 그대로 들고 있다 — 「현재 판」이 아니다.
    assert.equal(detail.approvals[1].routeId, routeId);
  });

  test("요청 기반 불출 — 부품 요청 줄을 그대로 가리킨다", async () => {
    const { requestId, itemId } = await insertPartRequestWithItem();
    const issueRequestId = await insertDirectIssueRequest({
      partRequestId: requestId,
      destinationNote: null,
    });
    await db.insert(inventoryPartIssueRequestItems).values({
      issueRequestId,
      requestItemId: itemId,
      partStockBalanceId: balanceAId,
      quantity: 3,
    });

    const detail = await getPartIssueRequestDetail(issueRequestId);
    assert.ok(detail);
    assert.equal(detail.partRequestId, requestId);
    assert.equal(detail.destinationNote, null);
    assert.equal(detail.items.length, 1);
    assert.equal(detail.items[0].requestItemId, itemId);
    assert.equal(detail.items[0].quantity, 3);
  });

  test("없는 신청은 null 이다", async () => {
    assert.equal(await getPartIssueRequestDetail(randomUUID()), null);
  });
});

describe("listPartIssueRequestsPendingMyApproval", () => {
  async function arrangeAssignedToApproverA(): Promise<string> {
    const issueRequestId = await insertDirectIssueRequest({ requestReason: "긴급 교체" });
    const routeId = await insertPartIssueRoute(1, [approverAId, approverBId]);
    await insertPendingApproval(issueRequestId, {
      routeId,
      routeStepOrder: 1,
      assignedApproverUserId: approverAId,
      requestReason: "긴급 교체",
    });
    return issueRequestId;
  }

  test("🔴 지정된 사람에게 보인다", async () => {
    const issueRequestId = await arrangeAssignedToApproverA();

    const rows = await listPartIssueRequestsPendingMyApproval(approverAId);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].issueRequestId, issueRequestId);
    assert.equal(rows[0].routeStepOrder, 1);
    assert.equal(rows[0].requestedByName, "partissue requester");
    assert.equal(rows[0].requestReason, "긴급 교체");
    assert.equal(rows[0].partRequestId, null);
  });

  test("🔴 지정되지 않은 사람에게는 보이지 않는다 — 다음 단계 승인자에게도", async () => {
    await arrangeAssignedToApproverA();

    assert.deepEqual(await listPartIssueRequestsPendingMyApproval(approverBId), []);
    assert.deepEqual(await listPartIssueRequestsPendingMyApproval(outsiderId), []);
    assert.deepEqual(await listPartIssueRequestsPendingMyApproval(requesterId), []);
  });

  test("🔴 최고관리자에게는 보인다 — 지정된 사람이 자리를 비워도 막히지 않는 비상구", async () => {
    const issueRequestId = await arrangeAssignedToApproverA();

    const rows = await listPartIssueRequestsPendingMyApproval(superAdminId);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].issueRequestId, issueRequestId);
  });

  test("비활성 계정에게는 아무것도 보이지 않는다", async () => {
    const issueRequestId = await insertDirectIssueRequest();
    const routeId = await insertPartIssueRoute(1, [inactiveApproverId]);
    await insertPendingApproval(issueRequestId, {
      routeId,
      routeStepOrder: 1,
      assignedApproverUserId: inactiveApproverId,
    });

    assert.deepEqual(await listPartIssueRequestsPendingMyApproval(inactiveApproverId), []);
  });

  test("이미 결정된 행은 목록에서 빠진다", async () => {
    const issueRequestId = await insertDirectIssueRequest();
    const routeId = await insertPartIssueRoute(1, [approverAId]);
    const approvalId = await insertPendingApproval(issueRequestId, {
      routeId,
      routeStepOrder: 1,
      assignedApproverUserId: approverAId,
    });

    await db
      .update(inventoryPartIssueApprovals)
      .set({ status: "APPROVED", decidedByUserId: approverAId, decidedAt: new Date() })
      .where(eq(inventoryPartIssueApprovals.id, approvalId));
    await db
      .update(inventoryPartIssueRequests)
      .set({ status: "APPROVED" })
      .where(eq(inventoryPartIssueRequests.id, issueRequestId));

    assert.deepEqual(await listPartIssueRequestsPendingMyApproval(approverAId), []);
  });

  test("신청이 취소되면 열린 행이 남아 있어도 목록에서 빠진다", async () => {
    const issueRequestId = await arrangeAssignedToApproverA();
    await db
      .update(inventoryPartIssueRequests)
      .set({ status: "CANCELLED" })
      .where(eq(inventoryPartIssueRequests.id, issueRequestId));

    assert.deepEqual(await listPartIssueRequestsPendingMyApproval(approverAId), []);
  });
});

describe("listExecutablePartIssueRequests · listPartIssueRequestsForPartRequest", () => {
  test("🔴 승인은 났는데 아직 안 나간 것만 실행 대상이다", async () => {
    const approvedId = await insertDirectIssueRequest({ status: "APPROVED" });
    await insertDirectIssueRequest();
    await insertDirectIssueRequest({
      status: "EXECUTED",
      executedByUserId: requesterId,
      executedAt: new Date(),
    });
    await insertDirectIssueRequest({ status: "CANCELLED" });

    const rows = await listExecutablePartIssueRequests();
    assert.deepEqual(
      rows.map((row) => row.issueRequestId),
      [approvedId]
    );
  });

  test("한 부품 요청에 딸린 신청들을 모아 온다", async () => {
    const { requestId } = await insertPartRequestWithItem();
    const first = await insertDirectIssueRequest({ partRequestId: requestId, destinationNote: null });
    const second = await insertDirectIssueRequest({ partRequestId: requestId, destinationNote: null });
    await insertDirectIssueRequest();

    const rows = await listPartIssueRequestsForPartRequest(requestId);
    assert.equal(rows.length, 2);
    assert.deepEqual(
      [...rows.map((row) => row.issueRequestId)].sort(),
      [first, second].sort()
    );
    for (const row of rows) {
      assert.equal(row.status, "PENDING_APPROVAL");
    }
  });
});
