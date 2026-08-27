import "../../../../scripts/load-env";

import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { and, eq, inArray, like } from "drizzle-orm";
import { db, pgClient } from "../connection";
import {
  customers,
  inventoryPartRequestHistory,
  inventoryPartRequestIdempotencyKeys,
  inventoryPartRequestItems,
  inventoryPartRequests,
  parts,
  products,
  repairCaseIntakeSequences,
  repairCases,
  users,
} from "../schema";
import { createPart } from "../mutations/inventory";
import { createPartRequest } from "../mutations/inventory-part-requests";
import { createRepairCase } from "../mutations/repair-cases";
import { getPendingPartRequestsForNotification } from "./inventory-part-requests";
import type { InventoryPartRequestStatus } from "@/lib/domain/inventory-types";
import type { ValidatedCreateRepairCaseInput } from "@/lib/validation/repair-case-input";

/**
 * getPendingPartRequestsForNotification — 종 알림 1단계.
 *
 * 확인하는 것은 셋이다: (1) PENDING만 나오는가, (2) 나머지 여섯 상태는
 * 하나도 나오지 않는가, (3) 접수 건 연결이 끊긴 요청(repair_case_id NULL)에서
 * 터지지 않고 인수번호 자리를 null로 돌려주는가.
 *
 * 이 조회는 **DB 전체의 처리 대기 요청**을 돌려준다(사용자별로 달라지지
 * 않는다). 그래서 모든 단정은 "내가 만든 요청 id"로 걸러서 한다 — 개수를
 * 절대값으로 못 박으면 시드 데이터나 다른 스위트가 남긴 행 하나에 곧바로
 * 깨지고, 그 뒤로는 아무것도 지키지 못하는 테스트가 된다.
 *
 * 격리 규약은 이 디렉터리의 다른 통합 테스트와 같다 — 접수 월 "9608"(다른
 * 어떤 스위트도 쓰지 않는 달), 제품 모델 접두사 "PARTREQ-NOTIF-TEST-",
 * 부품명 접두사 "test-part-request-notification-". after()가 이 스위트가 만든
 * 행만 FK 순서대로 지운다.
 */

const TEST_PART_PREFIX = "test-part-request-notification-";
const TEST_MODEL_PREFIX = "PARTREQ-NOTIF-TEST-";
const TEST_YEAR_MONTH = "9608";
const TEST_RECEIVED_AT = "2096-08-10";
const TEST_SHIPMENT_DATE = "2096-08-20";

let superAdminId: string;
let engineerId: string;
let customerId: string;

const createdPartIds: string[] = [];
const createdRequestIds: string[] = [];

async function findUserId(role: "SUPER_ADMIN" | "AS_ENGINEER"): Promise<string> {
  const [row] = await db
    .select({ id: users.id })
    .from(users)
    .where(and(eq(users.role, role), eq(users.approvalStatus, "APPROVED"), eq(users.isDeleted, false), eq(users.isActive, true)))
    .limit(1);
  assert.ok(row, `expected an approved ${role} in the test DB`);
  return row.id;
}

async function createTestPart(): Promise<string> {
  const result = await createPart({
    partName: `${TEST_PART_PREFIX}${randomUUID().slice(0, 8)}`,
    partSpec: "알림 테스트용",
    category: "TEST",
    actorUserId: superAdminId,
  });
  assert.equal(result.ok, true, `part create failed: ${JSON.stringify(result)}`);
  if (!result.ok) throw new Error("unreachable");
  createdPartIds.push(result.partId);
  return result.partId;
}

function baseCreateInput(): ValidatedCreateRepairCaseInput {
  const suffix = randomUUID().slice(0, 8);
  return {
    workflowType: "PAID_MATCHER",
    billingType: "PAID",
    customerId,
    endUserId: null,
    assignedEngineerId: engineerId,
    receivedAt: TEST_RECEIVED_AT,
    customerRequestedDueDate: null,
    internalTargetShipmentDate: TEST_SHIPMENT_DATE,
    modelName: `${TEST_MODEL_PREFIX}${suffix}`,
    lotNumber: `LOT-${suffix}`,
    serialNumber: `SN-${suffix}`,
    partNumber: null,
    accessoryList: null,
    externalConditionSummary: null,
    reasonForRemoval: null,
    reportedSymptom: null,
    intakeInspectionResult: null,
    currentDiagnosisSummary: null,
    nextPlannedAction: null,
    notes: null,
    contactName: null,
    contactPhone: null,
    contactEmail: null,
  };
}

/** 접수 건 하나 + 그 건에 걸린 부품 요청 하나. 요청은 언제나 PENDING으로 생긴다. */
async function createPendingRequest(): Promise<{ requestId: string; repairCaseId: string; intakeNumber: string }> {
  const createdCase = await createRepairCase(baseCreateInput());
  assert.equal(createdCase.ok, true, `case create failed: ${JSON.stringify(createdCase)}`);
  if (!createdCase.ok) throw new Error("unreachable");

  const partId = await createTestPart();
  const created = await createPartRequest({
    repairCaseId: createdCase.id,
    items: [{ partId, quantity: 2, owner: "DSS" }],
    actorUserId: engineerId,
    idempotencyKey: randomUUID(),
  });
  assert.equal(created.ok, true, `request create failed: ${JSON.stringify(created)}`);
  if (!created.ok) throw new Error("unreachable");
  createdRequestIds.push(created.requestId);

  return { requestId: created.requestId, repairCaseId: createdCase.id, intakeNumber: createdCase.intakeNumber };
}

/**
 * 상태만 직접 바꾼다.
 *
 * 실제 전이 mutation(불출·거절·보류…)을 태우지 않는 이유는 이 조회가 보는
 * 것이 status 컬럼 하나뿐이기 때문이다. 재고를 입고하고 불출까지 태우면
 * 테스트가 검사하려는 것(상태로 거른다)과 상관없는 실패 지점만 늘어난다.
 * 전이 자체는 mutations/inventory-part-requests.integration.test.ts가 본다.
 */
async function forceStatus(requestId: string, status: InventoryPartRequestStatus) {
  await db.update(inventoryPartRequests).set({ status }).where(eq(inventoryPartRequests.id, requestId));
}

async function loadNotificationRowsForCreated() {
  const rows = await getPendingPartRequestsForNotification();
  return rows.filter((row) => createdRequestIds.includes(row.id));
}

before(async () => {
  superAdminId = await findUserId("SUPER_ADMIN");
  engineerId = await findUserId("AS_ENGINEER");

  const [customer] = await db.select({ id: customers.id }).from(customers).where(eq(customers.isDeleted, false)).limit(1);
  assert.ok(customer, "expected at least one non-deleted customer in the test DB");
  customerId = customer.id;
});

after(async () => {
  if (createdRequestIds.length > 0) {
    await db.delete(inventoryPartRequestIdempotencyKeys).where(inArray(inventoryPartRequestIdempotencyKeys.requestId, createdRequestIds));
    await db.delete(inventoryPartRequestHistory).where(inArray(inventoryPartRequestHistory.requestId, createdRequestIds));
    await db.delete(inventoryPartRequestItems).where(inArray(inventoryPartRequestItems.requestId, createdRequestIds));
    await db.delete(inventoryPartRequests).where(inArray(inventoryPartRequests.id, createdRequestIds));
  }

  const leftoverParts = await db.select({ id: parts.id }).from(parts).where(like(parts.partName, `${TEST_PART_PREFIX}%`));
  const allPartIds = [...new Set([...createdPartIds, ...leftoverParts.map((p) => p.id)])];
  if (allPartIds.length > 0) {
    await db.delete(parts).where(inArray(parts.id, allPartIds));
  }

  await db.delete(repairCases).where(like(repairCases.intakeNumber, `D${TEST_YEAR_MONTH}%`));
  await db.delete(products).where(like(products.modelName, `${TEST_MODEL_PREFIX}%`));
  await db.delete(repairCaseIntakeSequences).where(eq(repairCaseIntakeSequences.yearMonth, TEST_YEAR_MONTH));

  await pgClient.end({ timeout: 5 });
});

test("처리 대기 중인 요청이 인수번호·요청자·만든 시각과 함께 나온다", async () => {
  const { requestId, intakeNumber } = await createPendingRequest();

  const rows = await getPendingPartRequestsForNotification();
  const found = rows.find((row) => row.id === requestId);
  assert.ok(found, "방금 만든 PENDING 요청이 알림 조회에 없다");
  assert.equal(found.intakeNumber, intakeNumber, "접수 건이 살아 있으면 인수번호가 그대로 나와야 한다");

  const [engineer] = await db.select({ name: users.name }).from(users).where(eq(users.id, engineerId));
  assert.equal(found.requestedByName, engineer.name, "요청한 사람 이름이 함께 나와야 한다");

  assert.ok(!Number.isNaN(Date.parse(found.createdAt)), `createdAt이 ISO 문자열이어야 한다: ${found.createdAt}`);
});

test("읽기 전용이다 — 조회를 돌려도 요청 행이 바뀌지 않는다", async () => {
  const { requestId } = await createPendingRequest();

  const [before] = await db
    .select({ status: inventoryPartRequests.status, version: inventoryPartRequests.version, updatedAt: inventoryPartRequests.updatedAt })
    .from(inventoryPartRequests)
    .where(eq(inventoryPartRequests.id, requestId));

  await getPendingPartRequestsForNotification();
  await getPendingPartRequestsForNotification();

  const [afterRead] = await db
    .select({ status: inventoryPartRequests.status, version: inventoryPartRequests.version, updatedAt: inventoryPartRequests.updatedAt })
    .from(inventoryPartRequests)
    .where(eq(inventoryPartRequests.id, requestId));

  assert.equal(afterRead.status, before.status);
  assert.equal(afterRead.version, before.version);
  assert.equal(afterRead.updatedAt.toISOString(), before.updatedAt.toISOString());
});

test("PENDING이 아닌 여섯 상태는 하나도 나오지 않는다", async () => {
  // 대조군 — 이 건이 계속 나오는 것이 "조회가 통째로 비어 있어서 통과한
  // 것이 아니다"의 증거다. 이 단정이 없으면 where 절을 잘못 짜서 아무것도
  // 안 나오게 만들어도 초록색이 된다.
  const control = await createPendingRequest();

  const otherStatuses: InventoryPartRequestStatus[] = [
    "PARTIALLY_ISSUED",
    "FULLY_ISSUED",
    "PARTIALLY_CLOSED",
    "REJECTED",
    "CANCELLED",
    "ON_HOLD",
  ];

  const excludedIds: string[] = [];
  for (const status of otherStatuses) {
    const { requestId } = await createPendingRequest();
    await forceStatus(requestId, status);
    excludedIds.push(requestId);
  }

  const rows = await getPendingPartRequestsForNotification();
  const returnedIds = new Set(rows.map((row) => row.id));

  assert.ok(returnedIds.has(control.requestId), "대조가 성립하지 않는다 — PENDING 건조차 나오지 않았다");
  for (const [index, requestId] of excludedIds.entries()) {
    assert.equal(returnedIds.has(requestId), false, `${otherStatuses[index]} 요청이 알림에 나왔다`);
  }
});

test("접수 건이 영구 삭제된 요청도 빠지지 않고, 인수번호 자리는 null로 나온다", async () => {
  const { requestId } = await createPendingRequest();

  // 접수 건 영구 삭제가 남기는 상태와 같다(repair_case_id ON DELETE SET NULL).
  // innerJoin이면 이 행이 알림에서 통째로 사라진다.
  await db.update(inventoryPartRequests).set({ repairCaseId: null }).where(eq(inventoryPartRequests.id, requestId));

  const rows = await getPendingPartRequestsForNotification();
  const found = rows.find((row) => row.id === requestId);
  assert.ok(found, "접수 건이 없는 요청이 알림에서 사라졌다 — leftJoin이어야 한다");
  assert.equal(found.intakeNumber, null);
  // 요청자는 접수 건과 무관하게 계속 나와야 한다(users는 innerJoin, NOT NULL).
  assert.ok(found.requestedByName.length > 0);
});

test("차례는 최신순이다 — 종 패널 안에서 결재 알림과 방향이 같아야 한다", async () => {
  const older = await createPendingRequest();
  const newer = await createPendingRequest();

  // 만든 순서만 믿지 않고 시각을 못 박는다 — 같은 초에 두 건이 생기면 순서가
  // 뒤집혀도 조용히 통과할 수 있다.
  await db.update(inventoryPartRequests).set({ createdAt: new Date("2096-08-11T01:00:00.000Z") }).where(eq(inventoryPartRequests.id, older.requestId));
  await db.update(inventoryPartRequests).set({ createdAt: new Date("2096-08-11T02:00:00.000Z") }).where(eq(inventoryPartRequests.id, newer.requestId));

  const rows = await loadNotificationRowsForCreated();
  const olderIndex = rows.findIndex((row) => row.id === older.requestId);
  const newerIndex = rows.findIndex((row) => row.id === newer.requestId);

  assert.ok(olderIndex >= 0 && newerIndex >= 0, "두 건 모두 나와야 한다");
  assert.ok(newerIndex < olderIndex, "최신 요청이 먼저 와야 한다");
});
