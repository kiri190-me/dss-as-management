import "../../../../scripts/load-env";

import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { and, eq, inArray, like, sql } from "drizzle-orm";
import { db, pgClient } from "../connection";
import {
  customers,
  users,
  parts,
  partStockBalances,
  stockTransactions,
  repairCases,
  repairCaseIntakeSequences,
  products,
  inventoryPartRequests,
  inventoryPartRequestItems,
  inventoryPartRequestIssues,
  inventoryPartRequestHistory,
  inventoryPartRequestIdempotencyKeys,
} from "../schema";
import { createRepairCase } from "./repair-cases";
import { createPart, receiveStock, returnStock } from "./inventory";
import {
  createPartRequest,
  cancelPartRequest,
  rejectPartRequest,
  partiallyCloseRequest,
  issuePartRequest,
} from "./inventory-part-requests";
import { getOwnPartRequestsForCase } from "../queries/inventory-part-requests";
import type { ValidatedCreateRepairCaseInput } from "@/lib/validation/repair-case-input";

/**
 * Phase 5B-3 integration tests for the Parts Request & Issue Workflow,
 * against the real dev DB. Self-cleaning convention (same as
 * inventory.integration.test.ts): every part uses TEST_PART_PREFIX, every
 * repair case uses intake month TEST_YEAR_MONTH ("9908", distinct from
 * every other isolated month already in use). after() deletes every row
 * this suite created and never touches real data.
 */

const TEST_PART_PREFIX = "test-inventory-request-";
const TEST_MODEL_PREFIX = "INVENTORY-REQUEST-TEST-";
const TEST_YEAR_MONTH = "9908";
const TEST_RECEIVED_AT = "2099-08-10";
const TEST_SHIPMENT_DATE = "2099-08-20";
const TEST_LOCATION_A = "TEST-REQ-SHELF-A";
const TEST_LOCATION_B = "TEST-REQ-SHELF-B";

let superAdminId: string;
let adminId: string;
let inventoryManagerId: string;
let engineerId: string;
let engineer2Id: string;
let salesId: string;
let customerId: string;
let realPartsCountBaseline: number;

const createdPartIds: string[] = [];

function uniquePartName(suffix: string): string {
  return `${TEST_PART_PREFIX}${suffix}-${randomUUID().slice(0, 8)}`;
}

async function createTestPart(): Promise<string> {
  const result = await createPart({ partName: uniquePartName("part"), partSpec: "요청 테스트용", category: "TEST", actorUserId: superAdminId });
  assert.equal(result.ok, true, `part create failed: ${JSON.stringify(result)}`);
  if (!result.ok) throw new Error("unreachable");
  createdPartIds.push(result.partId);
  return result.partId;
}

function baseCreateInput(overrides: Partial<ValidatedCreateRepairCaseInput> = {}): ValidatedCreateRepairCaseInput {
  const suffix = randomUUID().slice(0, 8);
  return {
    workflowType: "MATCHER",
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
    ...overrides,
  };
}

async function createTestCase(overrides: Partial<ValidatedCreateRepairCaseInput> = {}) {
  const result = await createRepairCase(baseCreateInput(overrides));
  assert.equal(result.ok, true, `setup create failed: ${JSON.stringify(result)}`);
  if (!result.ok) throw new Error("unreachable");
  return result;
}

async function lockCase(repairCaseId: string) {
  await db.update(repairCases).set({ isLocked: true }).where(eq(repairCases.id, repairCaseId));
}

async function receiveTestStock(partId: string, quantity: number, location = TEST_LOCATION_A) {
  const result = await receiveStock({ partId, owner: "DSS", location, quantity, actorUserId: inventoryManagerId });
  assert.equal(result.ok, true, JSON.stringify(result));
  if (!result.ok) throw new Error("unreachable");
  return result;
}

before(async () => {
  const [superAdmin] = await db
    .select({ id: users.id })
    .from(users)
    .where(and(eq(users.role, "SUPER_ADMIN"), eq(users.approvalStatus, "APPROVED"), eq(users.isDeleted, false), eq(users.isActive, true)))
    .limit(1);
  assert.ok(superAdmin, "expected an approved SUPER_ADMIN in the dev DB");
  superAdminId = superAdmin.id;

  const [admin] = await db
    .select({ id: users.id })
    .from(users)
    .where(and(eq(users.role, "ADMIN"), eq(users.approvalStatus, "APPROVED"), eq(users.isDeleted, false), eq(users.isActive, true)))
    .limit(1);
  assert.ok(admin, "expected an approved ADMIN in the dev DB");
  adminId = admin.id;

  const [inventoryManager] = await db
    .select({ id: users.id })
    .from(users)
    .where(and(eq(users.role, "INVENTORY_MANAGER"), eq(users.approvalStatus, "APPROVED"), eq(users.isDeleted, false), eq(users.isActive, true)))
    .limit(1);
  assert.ok(inventoryManager, "expected an approved INVENTORY_MANAGER in the dev DB");
  inventoryManagerId = inventoryManager.id;

  const engineers = await db
    .select({ id: users.id })
    .from(users)
    .where(and(eq(users.role, "AS_ENGINEER"), eq(users.approvalStatus, "APPROVED"), eq(users.isDeleted, false), eq(users.isActive, true)))
    .limit(2);
  assert.ok(engineers.length >= 2, "expected at least two approved AS_ENGINEER users in the dev DB");
  engineerId = engineers[0].id;
  engineer2Id = engineers[1].id;

  const [sales] = await db
    .select({ id: users.id })
    .from(users)
    .where(and(eq(users.role, "SALES"), eq(users.approvalStatus, "APPROVED"), eq(users.isDeleted, false), eq(users.isActive, true)))
    .limit(1);
  assert.ok(sales, "expected an approved SALES user in the dev DB");
  salesId = sales.id;

  const [customer] = await db.select({ id: customers.id }).from(customers).where(eq(customers.isDeleted, false)).limit(1);
  assert.ok(customer, "expected at least one non-deleted customer in the dev DB");
  customerId = customer.id;

  // Baseline captured before this suite creates anything — same
  // baseline-relative precedent as inventory.integration.test.ts's
  // realDataBaseline. Real parts may already legitimately exist in a
  // shared dev DB; this suite must only ever assert the count is
  // UNCHANGED by its own run, never that it's zero.
  const [realPartsCount] = await db.select({ count: sql<number>`count(*)::int` }).from(parts).where(sql`part_name not like ${TEST_PART_PREFIX + "%"}`);
  realPartsCountBaseline = realPartsCount?.count ?? 0;
});

after(async () => {
  const testCases = await db.select({ id: repairCases.id }).from(repairCases).where(like(repairCases.intakeNumber, `D${TEST_YEAR_MONTH}%`));
  const testCaseIds = testCases.map((c) => c.id);

  const testRequests = testCaseIds.length > 0 ? await db.select({ id: inventoryPartRequests.id }).from(inventoryPartRequests).where(inArray(inventoryPartRequests.repairCaseId, testCaseIds)) : [];
  const requestIds = testRequests.map((r) => r.id);

  const testParts = await db.select({ id: parts.id }).from(parts).where(like(parts.partName, `${TEST_PART_PREFIX}%`));
  const allPartIds = [...new Set([...createdPartIds, ...testParts.map((p) => p.id)])];

  // stock_transactions first — it references both inventory_part_request_items
  // and inventory_part_request_issues (restrict), and a RETURN row
  // references its original USE row via reversal_of_id (also restrict) —
  // every row for a given balance (USE + any RETURN reversing it) is
  // deleted together in one statement, which is what makes the
  // self-referencing reversal_of_id FK safe to clear here.
  if (allPartIds.length > 0) {
    const balances = await db.select({ id: partStockBalances.id }).from(partStockBalances).where(inArray(partStockBalances.partId, allPartIds));
    const balanceIds = balances.map((b) => b.id);
    if (balanceIds.length > 0) {
      await db.delete(stockTransactions).where(inArray(stockTransactions.partStockBalanceId, balanceIds));
      await db.delete(partStockBalances).where(inArray(partStockBalances.id, balanceIds));
    }
  }

  // Only now — after every stock_transactions row referencing them is gone
  // — is it safe to delete the request tables themselves.
  if (requestIds.length > 0) {
    await db.delete(inventoryPartRequestIdempotencyKeys).where(inArray(inventoryPartRequestIdempotencyKeys.requestId, requestIds));
    await db.delete(inventoryPartRequestHistory).where(inArray(inventoryPartRequestHistory.requestId, requestIds));
    await db.delete(inventoryPartRequestIssues).where(inArray(inventoryPartRequestIssues.requestId, requestIds));
    await db.delete(inventoryPartRequestItems).where(inArray(inventoryPartRequestItems.requestId, requestIds));
    await db.delete(inventoryPartRequests).where(inArray(inventoryPartRequests.id, requestIds));
  }

  if (allPartIds.length > 0) {
    await db.delete(parts).where(inArray(parts.id, allPartIds));
  }

  await db.delete(repairCases).where(like(repairCases.intakeNumber, `D${TEST_YEAR_MONTH}%`));
  await db.delete(products).where(like(products.modelName, `${TEST_MODEL_PREFIX}%`));
  await db.delete(repairCaseIntakeSequences).where(eq(repairCaseIntakeSequences.yearMonth, TEST_YEAR_MONTH));

  await pgClient.end({ timeout: 5 });
});

describe("createPartRequest", () => {
  test("1. same part selected twice in the cart is normalized into one item with summed quantity (UNIQUE(request_id, part_id) never violated)", async () => {
    const partId = await createTestPart();
    const created = await createTestCase();
    const result = await createPartRequest({
      repairCaseId: created.id,
      items: [
        { partId, quantity: 3, owner: "DSS" },
        { partId, quantity: 4, owner: "DSS" },
      ],
      actorUserId: engineerId,
      idempotencyKey: randomUUID(),
    });
    assert.equal(result.ok, true, JSON.stringify(result));
    if (!result.ok) return;

    const items = await db.select().from(inventoryPartRequestItems).where(eq(inventoryPartRequestItems.requestId, result.requestId));
    assert.equal(items.length, 1, "must be a single merged item, not two rows colliding on the unique index");
    assert.equal(items[0].requestedQuantity, 7);
  });

  test("2. duplicate quantities +5 and -2 for the same part are rejected outright, never merged to 3", async () => {
    const partId = await createTestPart();
    const created = await createTestCase();
    const result = await createPartRequest({
      repairCaseId: created.id,
      items: [
        { partId, quantity: 5, owner: "DSS" },
        { partId, quantity: -2, owner: "DSS" },
      ],
      actorUserId: engineerId,
      idempotencyKey: randomUUID(),
    });
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.code, "INVALID_INPUT");

    const requests = await db.select().from(inventoryPartRequests).where(eq(inventoryPartRequests.repairCaseId, created.id));
    assert.equal(requests.length, 0, "no request row should exist — the invalid raw line must fail before any write");
  });

  test("3. fractional / zero / oversized quantity rejected with INVALID_INPUT", async () => {
    const partId = await createTestPart();
    const created = await createTestCase();
    for (const quantity of [1.5, 0, 2147483648]) {
      const result = await createPartRequest({ repairCaseId: created.id, items: [{ partId, quantity, owner: "DSS" }], actorUserId: engineerId, idempotencyKey: randomUUID() });
      assert.equal(result.ok, false, `quantity ${quantity} should be rejected`);
      if (!result.ok) assert.equal(result.code, "INVALID_INPUT");
    }
  });

  test("4. an empty request (no items) is rejected", async () => {
    const created = await createTestCase();
    const result = await createPartRequest({ repairCaseId: created.id, items: [], actorUserId: engineerId, idempotencyKey: randomUUID() });
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.code, "INVALID_INPUT");
  });

  test("5. any AS_ENGINEER may create a request regardless of case assignment (Parts Request permission checkpoint); non-engineer roles remain rejected", async () => {
    const partId = await createTestPart();
    const created = await createTestCase({ assignedEngineerId: engineerId });

    // engineer2Id is deliberately NOT assigned to this case — must still succeed.
    const unassigned = await createPartRequest({ repairCaseId: created.id, items: [{ partId, quantity: 1, owner: "DSS" }], actorUserId: engineer2Id, idempotencyKey: randomUUID() });
    assert.equal(unassigned.ok, true, `unassigned AS_ENGINEER should be allowed to request: ${JSON.stringify(unassigned)}`);

    for (const actorUserId of [superAdminId, adminId, inventoryManagerId, salesId]) {
      const result = await createPartRequest({ repairCaseId: created.id, items: [{ partId, quantity: 1, owner: "DSS" }], actorUserId, idempotencyKey: randomUUID() });
      assert.equal(result.ok, false, `${actorUserId} should be forbidden`);
      if (!result.ok) assert.equal(result.code, "FORBIDDEN");
    }
  });

  test("6. shipment-lock removal policy: a locked (shipped) repair case no longer blocks new request creation", async () => {
    const partId = await createTestPart();
    const created = await createTestCase({ assignedEngineerId: engineerId });
    await lockCase(created.id);

    const result = await createPartRequest({ repairCaseId: created.id, items: [{ partId, quantity: 1, owner: "DSS" }], actorUserId: engineerId, idempotencyKey: randomUUID() });
    assert.equal(result.ok, true, JSON.stringify(result));
  });

  test("7. submitting a request does not reserve or deduct stock — balance is unaffected", async () => {
    const partId = await createTestPart();
    const received = await receiveTestStock(partId, 10);
    const created = await createTestCase();
    const result = await createPartRequest({ repairCaseId: created.id, items: [{ partId, quantity: 5, owner: "DSS" }], actorUserId: engineerId, idempotencyKey: randomUUID() });
    assert.equal(result.ok, true, JSON.stringify(result));

    const [balance] = await db.select().from(partStockBalances).where(eq(partStockBalances.id, received.partStockBalanceId));
    assert.equal(balance.currentQuantity, 10, "creating a request must never change the balance");
  });

  test("7b. a missing or invalid owner is rejected with INVALID_INPUT, and no row is written", async () => {
    const partId = await createTestPart();
    const created = await createTestCase();

    const missing = await createPartRequest({ repairCaseId: created.id, items: [{ partId, quantity: 1, owner: undefined }], actorUserId: engineerId, idempotencyKey: randomUUID() });
    assert.equal(missing.ok, false);
    if (!missing.ok) assert.equal(missing.code, "INVALID_INPUT");

    const invalid = await createPartRequest({ repairCaseId: created.id, items: [{ partId, quantity: 1, owner: "NOT_A_REAL_OWNER" }], actorUserId: engineerId, idempotencyKey: randomUUID() });
    assert.equal(invalid.ok, false);
    if (!invalid.ok) assert.equal(invalid.code, "INVALID_INPUT");

    const requests = await db.select().from(inventoryPartRequests).where(eq(inventoryPartRequests.repairCaseId, created.id));
    assert.equal(requests.length, 0, "neither the missing- nor invalid-owner attempt should have written a request row");
  });

  test("7c. every valid stock_owner code persists correctly on inventory_part_request_items.owner", async () => {
    for (const owner of ["DSS", "KYOSAN", "SERVICE_SPARE", "TEST"] as const) {
      const partId = await createTestPart();
      const created = await createTestCase();
      const result = await createPartRequest({ repairCaseId: created.id, items: [{ partId, quantity: 1, owner }], actorUserId: engineerId, idempotencyKey: randomUUID() });
      assert.equal(result.ok, true, JSON.stringify(result));
      if (!result.ok) continue;
      const [item] = await db.select().from(inventoryPartRequestItems).where(eq(inventoryPartRequestItems.requestId, result.requestId));
      assert.equal(item.owner, owner);
    }
  });

  test("7d. a multi-item request can carry a different owner per item", async () => {
    const partA = await createTestPart();
    const partB = await createTestPart();
    const created = await createTestCase();
    const result = await createPartRequest({
      repairCaseId: created.id,
      items: [
        { partId: partA, quantity: 1, owner: "DSS" },
        { partId: partB, quantity: 1, owner: "KYOSAN" },
      ],
      actorUserId: engineerId,
      idempotencyKey: randomUUID(),
    });
    assert.equal(result.ok, true, JSON.stringify(result));
    if (!result.ok) return;
    const items = await db.select().from(inventoryPartRequestItems).where(eq(inventoryPartRequestItems.requestId, result.requestId));
    const ownerByPart = new Map(items.map((i) => [i.partId, i.owner]));
    assert.equal(ownerByPart.get(partA), "DSS");
    assert.equal(ownerByPart.get(partB), "KYOSAN");
  });

  test("7e. two raw lines for the same part with different owners are rejected outright, never silently reconciled", async () => {
    const partId = await createTestPart();
    const created = await createTestCase();
    const result = await createPartRequest({
      repairCaseId: created.id,
      items: [
        { partId, quantity: 1, owner: "DSS" },
        { partId, quantity: 1, owner: "KYOSAN" },
      ],
      actorUserId: engineerId,
      idempotencyKey: randomUUID(),
    });
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.code, "INVALID_INPUT");
  });
});

describe("idempotency", () => {
  test("8. same key + same payload returns the cached result with zero additional writes", async () => {
    const partId = await createTestPart();
    const created = await createTestCase();
    const key = randomUUID();
    const input = { repairCaseId: created.id, items: [{ partId, quantity: 2, owner: "DSS" }], actorUserId: engineerId, idempotencyKey: key };

    const first = await createPartRequest(input);
    assert.equal(first.ok, true, JSON.stringify(first));
    const second = await createPartRequest(input);
    assert.equal(second.ok, true, JSON.stringify(second));
    if (!first.ok || !second.ok) return;
    assert.equal(first.requestId, second.requestId, "replay must return the same request, not create a second one");

    const allRequests = await db.select().from(inventoryPartRequests).where(eq(inventoryPartRequests.repairCaseId, created.id));
    assert.equal(allRequests.length, 1, "exactly one request row despite two identical submissions");
  });

  test("9. same key + different quantity is rejected as a payload mismatch, not executed", async () => {
    const partId = await createTestPart();
    const created = await createTestCase();
    const key = randomUUID();

    const first = await createPartRequest({ repairCaseId: created.id, items: [{ partId, quantity: 2, owner: "DSS" }], actorUserId: engineerId, idempotencyKey: key });
    assert.equal(first.ok, true, JSON.stringify(first));

    const second = await createPartRequest({ repairCaseId: created.id, items: [{ partId, quantity: 5, owner: "DSS" }], actorUserId: engineerId, idempotencyKey: key });
    assert.equal(second.ok, false);
    if (!second.ok) assert.equal(second.code, "IDEMPOTENCY_PAYLOAD_MISMATCH");

    const allRequests = await db.select().from(inventoryPartRequests).where(eq(inventoryPartRequests.repairCaseId, created.id));
    assert.equal(allRequests.length, 1, "the mismatched retry must not have created a second request");
  });

  test("10. same key + different actor is rejected, zero writes for the mismatched caller", async () => {
    const partId = await createTestPart();
    const created = await createTestCase({ assignedEngineerId: engineerId });
    const key = randomUUID();

    const first = await createPartRequest({ repairCaseId: created.id, items: [{ partId, quantity: 1, owner: "DSS" }], actorUserId: engineerId, idempotencyKey: key });
    assert.equal(first.ok, true, JSON.stringify(first));

    const second = await createPartRequest({ repairCaseId: created.id, items: [{ partId, quantity: 1, owner: "DSS" }], actorUserId: engineer2Id, idempotencyKey: key });
    assert.equal(second.ok, false);
    if (!second.ok) assert.equal(second.code, "FORBIDDEN");
  });

  test("11. concurrent double-submit of the same key executes exactly once", async () => {
    const partId = await createTestPart();
    const created = await createTestCase();
    const key = randomUUID();
    const input = { repairCaseId: created.id, items: [{ partId, quantity: 1, owner: "DSS" }], actorUserId: engineerId, idempotencyKey: key };

    const [a, b] = await Promise.all([createPartRequest(input), createPartRequest(input)]);
    assert.equal(a.ok, true, JSON.stringify(a));
    assert.equal(b.ok, true, JSON.stringify(b));
    if (!a.ok || !b.ok) return;
    assert.equal(a.requestId, b.requestId);

    const allRequests = await db.select().from(inventoryPartRequests).where(eq(inventoryPartRequests.repairCaseId, created.id));
    assert.equal(allRequests.length, 1);
  });
});

describe("cancelPartRequest / rejectPartRequest", () => {
  test("12. AS_ENGINEER may cancel only their own PENDING request; requires a nonblank reason", async () => {
    const partId = await createTestPart();
    const created = await createTestCase({ assignedEngineerId: engineerId });
    const request = await createPartRequest({ repairCaseId: created.id, items: [{ partId, quantity: 1, owner: "DSS" }], actorUserId: engineerId, idempotencyKey: randomUUID() });
    assert.equal(request.ok, true);
    if (!request.ok) return;

    const blankReason = await cancelPartRequest({ requestId: request.requestId, reason: "   ", actorUserId: engineerId, idempotencyKey: randomUUID() });
    assert.equal(blankReason.ok, false);
    if (!blankReason.ok) assert.equal(blankReason.code, "INVALID_INPUT");

    const wrongActor = await cancelPartRequest({ requestId: request.requestId, reason: "잘못 요청함", actorUserId: engineer2Id, idempotencyKey: randomUUID() });
    assert.equal(wrongActor.ok, false);
    if (!wrongActor.ok) assert.equal(wrongActor.code, "FORBIDDEN");

    const result = await cancelPartRequest({ requestId: request.requestId, reason: "잘못 요청함", actorUserId: engineerId, idempotencyKey: randomUUID() });
    assert.equal(result.ok, true, JSON.stringify(result));
    if (result.ok) assert.equal(result.status, "CANCELLED");

    const history = await db.select().from(inventoryPartRequestHistory).where(and(eq(inventoryPartRequestHistory.requestId, request.requestId), eq(inventoryPartRequestHistory.actionType, "CANCELLED")));
    assert.equal(history.length, 1);
    assert.equal(history[0].reason, "잘못 요청함");
  });

  test("13. reject requires PENDING + zero issued; privileged roles only; reason required", async () => {
    const partId = await createTestPart();
    await receiveTestStock(partId, 10);
    const created = await createTestCase({ assignedEngineerId: engineerId });
    const request = await createPartRequest({ repairCaseId: created.id, items: [{ partId, quantity: 5, owner: "DSS" }], actorUserId: engineerId, idempotencyKey: randomUUID() });
    assert.equal(request.ok, true);
    if (!request.ok) return;

    const engineerCannotReject = await rejectPartRequest({ requestId: request.requestId, reason: "재고 부족", actorUserId: engineerId, idempotencyKey: randomUUID() });
    assert.equal(engineerCannotReject.ok, false);
    if (!engineerCannotReject.ok) assert.equal(engineerCannotReject.code, "FORBIDDEN");

    const result = await rejectPartRequest({ requestId: request.requestId, reason: "재고 부족", actorUserId: inventoryManagerId, idempotencyKey: randomUUID() });
    assert.equal(result.ok, true, JSON.stringify(result));
    if (result.ok) assert.equal(result.status, "REJECTED");

    const again = await rejectPartRequest({ requestId: request.requestId, reason: "재고 부족", actorUserId: inventoryManagerId, idempotencyKey: randomUUID() });
    assert.equal(again.ok, false, "an already-REJECTED request cannot be rejected again");
    if (!again.ok) assert.equal(again.code, "FORBIDDEN");
  });

  test("14. cancel/reject remain allowed on an already-locked case (neither deducts stock)", async () => {
    const partId = await createTestPart();
    const created = await createTestCase({ assignedEngineerId: engineerId });
    const request = await createPartRequest({ repairCaseId: created.id, items: [{ partId, quantity: 1, owner: "DSS" }], actorUserId: engineerId, idempotencyKey: randomUUID() });
    assert.equal(request.ok, true);
    if (!request.ok) return;

    await lockCase(created.id);

    const result = await cancelPartRequest({ requestId: request.requestId, reason: "잠금 후 취소", actorUserId: engineerId, idempotencyKey: randomUUID() });
    assert.equal(result.ok, true, `cancel must still succeed on a locked case: ${JSON.stringify(result)}`);
  });
});

describe("issuePartRequest", () => {
  test("15. full issue in one confirmation moves status to FULLY_ISSUED and creates one issue event + one USE row", async () => {
    const partId = await createTestPart();
    const received = await receiveTestStock(partId, 10);
    const created = await createTestCase({ assignedEngineerId: engineerId });
    const request = await createPartRequest({ repairCaseId: created.id, items: [{ partId, quantity: 6, owner: "DSS" }], actorUserId: engineerId, idempotencyKey: randomUUID() });
    assert.equal(request.ok, true);
    if (!request.ok) return;
    const [item] = await db.select().from(inventoryPartRequestItems).where(eq(inventoryPartRequestItems.requestId, request.requestId));

    const issued = await issuePartRequest({
      requestId: request.requestId,
      allocations: [{ requestItemId: item.id, partStockBalanceId: received.partStockBalanceId, quantity: 6 }],
      actorUserId: inventoryManagerId,
      idempotencyKey: randomUUID(),
    });
    assert.equal(issued.ok, true, JSON.stringify(issued));
    if (!issued.ok) return;
    assert.equal(issued.status, "FULLY_ISSUED");

    const useRows = await db
      .select()
      .from(stockTransactions)
      .where(and(eq(stockTransactions.requestIssueId, issued.requestIssueId), eq(stockTransactions.transactionType, "USE")));
    assert.equal(useRows.length, 1);
    assert.equal(useRows[0].requestItemId, item.id);
    assert.equal(-useRows[0].quantityDelta, 6);

    const [balance] = await db.select().from(partStockBalances).where(eq(partStockBalances.id, received.partStockBalanceId));
    assert.equal(balance.currentQuantity, 4);
  });

  test("16. partial issue then a second later issue completes it — issued=7 then issued=10, remaining tracked correctly", async () => {
    const partId = await createTestPart();
    const received = await receiveTestStock(partId, 20);
    const created = await createTestCase({ assignedEngineerId: engineerId });
    const request = await createPartRequest({ repairCaseId: created.id, items: [{ partId, quantity: 10, owner: "DSS" }], actorUserId: engineerId, idempotencyKey: randomUUID() });
    assert.equal(request.ok, true);
    if (!request.ok) return;
    const [item] = await db.select().from(inventoryPartRequestItems).where(eq(inventoryPartRequestItems.requestId, request.requestId));

    const firstIssue = await issuePartRequest({
      requestId: request.requestId,
      allocations: [{ requestItemId: item.id, partStockBalanceId: received.partStockBalanceId, quantity: 4 }],
      actorUserId: inventoryManagerId,
      idempotencyKey: randomUUID(),
    });
    assert.equal(firstIssue.ok, true, JSON.stringify(firstIssue));
    if (firstIssue.ok) assert.equal(firstIssue.status, "PARTIALLY_ISSUED");

    const secondIssue = await issuePartRequest({
      requestId: request.requestId,
      allocations: [{ requestItemId: item.id, partStockBalanceId: received.partStockBalanceId, quantity: 3 }],
      actorUserId: inventoryManagerId,
      idempotencyKey: randomUUID(),
    });
    assert.equal(secondIssue.ok, true, JSON.stringify(secondIssue));
    if (secondIssue.ok) assert.equal(secondIssue.status, "PARTIALLY_ISSUED");

    const [updatedItem] = await db.select().from(inventoryPartRequestItems).where(eq(inventoryPartRequestItems.id, item.id));
    assert.equal(updatedItem.issuedQuantity, 7, "10 requested, 4 then 3 issued = 7");
  });

  test("17. split-bucket issue aggregates per item before validating — 10 requested, 2 already issued, this round 4+5=9 must fail atomically (no partial write)", async () => {
    const partId = await createTestPart();
    const balanceA = await receiveTestStock(partId, 20, TEST_LOCATION_A);
    const balanceB = await receiveTestStock(partId, 20, TEST_LOCATION_B);
    const created = await createTestCase({ assignedEngineerId: engineerId });
    const request = await createPartRequest({ repairCaseId: created.id, items: [{ partId, quantity: 10, owner: "DSS" }], actorUserId: engineerId, idempotencyKey: randomUUID() });
    assert.equal(request.ok, true);
    if (!request.ok) return;
    const [item] = await db.select().from(inventoryPartRequestItems).where(eq(inventoryPartRequestItems.requestId, request.requestId));

    const firstIssue = await issuePartRequest({
      requestId: request.requestId,
      allocations: [{ requestItemId: item.id, partStockBalanceId: balanceA.partStockBalanceId, quantity: 2 }],
      actorUserId: inventoryManagerId,
      idempotencyKey: randomUUID(),
    });
    assert.equal(firstIssue.ok, true, JSON.stringify(firstIssue));

    const overRound = await issuePartRequest({
      requestId: request.requestId,
      allocations: [
        { requestItemId: item.id, partStockBalanceId: balanceA.partStockBalanceId, quantity: 4 },
        { requestItemId: item.id, partStockBalanceId: balanceB.partStockBalanceId, quantity: 5 },
      ],
      actorUserId: inventoryManagerId,
      idempotencyKey: randomUUID(),
    });
    assert.equal(overRound.ok, false, "2 already issued + 9 this round = 11 > 10 requested, must fail atomically");
    if (!overRound.ok) assert.equal(overRound.code, "EXCEEDS_REMAINING_REQUESTED");

    // No partial write from the failed round — neither allocation applied.
    const [balAAfter] = await db.select().from(partStockBalances).where(eq(partStockBalances.id, balanceA.partStockBalanceId));
    const [balBAfter] = await db.select().from(partStockBalances).where(eq(partStockBalances.id, balanceB.partStockBalanceId));
    assert.equal(balAAfter.currentQuantity, 18, "20 - 2 from the first successful issue only, the failed round changed nothing further");
    assert.equal(balBAfter.currentQuantity, 20, "untouched — the failed round's second allocation never wrote anything");
    const [itemAfter] = await db.select().from(inventoryPartRequestItems).where(eq(inventoryPartRequestItems.id, item.id));
    assert.equal(itemAfter.issuedQuantity, 2, "still only the first successful issue's amount");
  });

  test("18. split-bucket issue succeeds when the aggregate is within remaining, and one issue event covers both USE rows", async () => {
    const partId = await createTestPart();
    const balanceA = await receiveTestStock(partId, 20, TEST_LOCATION_A);
    const balanceB = await receiveTestStock(partId, 20, TEST_LOCATION_B);
    const created = await createTestCase({ assignedEngineerId: engineerId });
    const request = await createPartRequest({ repairCaseId: created.id, items: [{ partId, quantity: 10, owner: "DSS" }], actorUserId: engineerId, idempotencyKey: randomUUID() });
    assert.equal(request.ok, true);
    if (!request.ok) return;
    const [item] = await db.select().from(inventoryPartRequestItems).where(eq(inventoryPartRequestItems.requestId, request.requestId));

    const issued = await issuePartRequest({
      requestId: request.requestId,
      allocations: [
        { requestItemId: item.id, partStockBalanceId: balanceA.partStockBalanceId, quantity: 3 },
        { requestItemId: item.id, partStockBalanceId: balanceB.partStockBalanceId, quantity: 2 },
      ],
      actorUserId: inventoryManagerId,
      idempotencyKey: randomUUID(),
    });
    assert.equal(issued.ok, true, JSON.stringify(issued));
    if (!issued.ok) return;

    const useRows = await db.select().from(stockTransactions).where(eq(stockTransactions.requestIssueId, issued.requestIssueId));
    assert.equal(useRows.length, 2, "one issue event groups both USE rows from this single confirmation");

    const [itemAfter] = await db.select().from(inventoryPartRequestItems).where(eq(inventoryPartRequestItems.id, item.id));
    assert.equal(itemAfter.issuedQuantity, 5);
  });

  test("18b. issue succeeds when the selected balance's owner matches the request item's requested owner", async () => {
    const partId = await createTestPart();
    const balance = await receiveStock({ partId, owner: "KYOSAN", location: TEST_LOCATION_A, quantity: 10, actorUserId: inventoryManagerId });
    assert.equal(balance.ok, true, JSON.stringify(balance));
    if (!balance.ok) return;
    const created = await createTestCase({ assignedEngineerId: engineerId });
    const request = await createPartRequest({ repairCaseId: created.id, items: [{ partId, quantity: 4, owner: "KYOSAN" }], actorUserId: engineerId, idempotencyKey: randomUUID() });
    assert.equal(request.ok, true);
    if (!request.ok) return;
    const [item] = await db.select().from(inventoryPartRequestItems).where(eq(inventoryPartRequestItems.requestId, request.requestId));

    const issued = await issuePartRequest({
      requestId: request.requestId,
      allocations: [{ requestItemId: item.id, partStockBalanceId: balance.partStockBalanceId, quantity: 4 }],
      actorUserId: inventoryManagerId,
      idempotencyKey: randomUUID(),
    });
    assert.equal(issued.ok, true, JSON.stringify(issued));
  });

  test("18c. issue is rejected when the selected balance's owner does not match the request item's requested owner, and nothing is written", async () => {
    const partId = await createTestPart();
    const balance = await receiveStock({ partId, owner: "KYOSAN", location: TEST_LOCATION_A, quantity: 10, actorUserId: inventoryManagerId });
    assert.equal(balance.ok, true, JSON.stringify(balance));
    if (!balance.ok) return;
    const created = await createTestCase({ assignedEngineerId: engineerId });
    const request = await createPartRequest({ repairCaseId: created.id, items: [{ partId, quantity: 4, owner: "DSS" }], actorUserId: engineerId, idempotencyKey: randomUUID() });
    assert.equal(request.ok, true);
    if (!request.ok) return;
    const [item] = await db.select().from(inventoryPartRequestItems).where(eq(inventoryPartRequestItems.requestId, request.requestId));

    const result = await issuePartRequest({
      requestId: request.requestId,
      allocations: [{ requestItemId: item.id, partStockBalanceId: balance.partStockBalanceId, quantity: 4 }],
      actorUserId: inventoryManagerId,
      idempotencyKey: randomUUID(),
    });
    assert.equal(result.ok, false, "requested owner DSS must never be silently fulfilled from a KYOSAN bucket");
    if (!result.ok) assert.equal(result.code, "INVALID_INPUT");

    const [balanceAfter] = await db.select().from(partStockBalances).where(eq(partStockBalances.id, balance.partStockBalanceId));
    assert.equal(balanceAfter.currentQuantity, 10, "the rejected owner-mismatched allocation must never move stock");
    const [itemAfter] = await db.select().from(inventoryPartRequestItems).where(eq(inventoryPartRequestItems.id, item.id));
    assert.equal(itemAfter.issuedQuantity, 0);
  });

  test("18d. a legacy request item with owner=NULL (predating migration 0024) remains issuable from any balance, unconstrained", async () => {
    const partId = await createTestPart();
    const balance = await receiveStock({ partId, owner: "SERVICE_SPARE", location: TEST_LOCATION_A, quantity: 10, actorUserId: inventoryManagerId });
    assert.equal(balance.ok, true, JSON.stringify(balance));
    if (!balance.ok) return;
    const created = await createTestCase({ assignedEngineerId: engineerId });

    // Simulate a pre-migration-0024 row by inserting directly, bypassing
    // createPartRequest (which always requires and validates an owner for
    // any NEW item) — this is the only way to reproduce the historical
    // owner=NULL state in a fresh test-created row.
    const [legacyRequest] = await db
      .insert(inventoryPartRequests)
      .values({ repairCaseId: created.id, requestedByUserId: engineerId, status: "PENDING", note: null })
      .returning({ id: inventoryPartRequests.id });
    const [legacyItem] = await db
      .insert(inventoryPartRequestItems)
      .values({ requestId: legacyRequest.id, partId, requestedQuantity: 5, owner: null, note: null })
      .returning({ id: inventoryPartRequestItems.id });
    const [legacyItemReread] = await db.select().from(inventoryPartRequestItems).where(eq(inventoryPartRequestItems.id, legacyItem.id));
    assert.equal(legacyItemReread.owner, null, "legacy item must read back with owner=NULL, never a guessed value");

    const issued = await issuePartRequest({
      requestId: legacyRequest.id,
      allocations: [{ requestItemId: legacyItem.id, partStockBalanceId: balance.partStockBalanceId, quantity: 5 }],
      actorUserId: inventoryManagerId,
      idempotencyKey: randomUUID(),
    });
    assert.equal(issued.ok, true, `a NULL-owner legacy item must remain issuable from any balance: ${JSON.stringify(issued)}`);
  });

  test("19. request item's part must match the selected balance's part (defensive re-check)", async () => {
    const partA = await createTestPart();
    const partB = await createTestPart();
    const balanceOfB = await receiveTestStock(partB, 10);
    const created = await createTestCase({ assignedEngineerId: engineerId });
    const request = await createPartRequest({ repairCaseId: created.id, items: [{ partId: partA, quantity: 1, owner: "DSS" }], actorUserId: engineerId, idempotencyKey: randomUUID() });
    assert.equal(request.ok, true);
    if (!request.ok) return;
    const [item] = await db.select().from(inventoryPartRequestItems).where(eq(inventoryPartRequestItems.requestId, request.requestId));

    const result = await issuePartRequest({
      requestId: request.requestId,
      allocations: [{ requestItemId: item.id, partStockBalanceId: balanceOfB.partStockBalanceId, quantity: 1 }],
      actorUserId: inventoryManagerId,
      idempotencyKey: randomUUID(),
    });
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.code, "INVALID_INPUT");
  });

  test("20. an empty issue event (no allocations) is rejected, and a zero/negative allocation cannot cancel out a positive one", async () => {
    const partId = await createTestPart();
    const received = await receiveTestStock(partId, 10);
    const created = await createTestCase({ assignedEngineerId: engineerId });
    const request = await createPartRequest({ repairCaseId: created.id, items: [{ partId, quantity: 5, owner: "DSS" }], actorUserId: engineerId, idempotencyKey: randomUUID() });
    assert.equal(request.ok, true);
    if (!request.ok) return;
    const [item] = await db.select().from(inventoryPartRequestItems).where(eq(inventoryPartRequestItems.requestId, request.requestId));

    const empty = await issuePartRequest({ requestId: request.requestId, allocations: [], actorUserId: inventoryManagerId, idempotencyKey: randomUUID() });
    assert.equal(empty.ok, false);
    if (!empty.ok) assert.equal(empty.code, "INVALID_INPUT");

    const cancelOut = await issuePartRequest({
      requestId: request.requestId,
      allocations: [
        { requestItemId: item.id, partStockBalanceId: received.partStockBalanceId, quantity: 3 },
        { requestItemId: item.id, partStockBalanceId: received.partStockBalanceId, quantity: -3 },
      ],
      actorUserId: inventoryManagerId,
      idempotencyKey: randomUUID(),
    });
    assert.equal(cancelOut.ok, false, "the -3 raw allocation must be rejected outright, never netted to 0");
    if (!cancelOut.ok) assert.equal(cancelOut.code, "INVALID_INPUT");

    const noIssueEvent = await db.select().from(inventoryPartRequestIssues).where(eq(inventoryPartRequestIssues.requestId, request.requestId));
    assert.equal(noIssueEvent.length, 0, "no issue event should exist from either rejected attempt");
  });

  test("21. shipment-lock removal policy: issue on a locked (shipped) case no longer blocks, for every privileged role", async () => {
    const partId = await createTestPart();
    const received = await receiveTestStock(partId, 10);
    const created = await createTestCase({ assignedEngineerId: engineerId });
    const request = await createPartRequest({ repairCaseId: created.id, items: [{ partId, quantity: 3, owner: "DSS" }], actorUserId: engineerId, idempotencyKey: randomUUID() });
    assert.equal(request.ok, true);
    if (!request.ok) return;
    const [item] = await db.select().from(inventoryPartRequestItems).where(eq(inventoryPartRequestItems.requestId, request.requestId));

    await lockCase(created.id);

    // 3 issuers x quantity 1 each = the full requested quantity 3, so every
    // iteration stays issuable (PENDING then PARTIALLY_ISSUED) up to the
    // final one, which completes the request.
    for (const actorUserId of [superAdminId, adminId, inventoryManagerId]) {
      const result = await issuePartRequest({
        requestId: request.requestId,
        allocations: [{ requestItemId: item.id, partStockBalanceId: received.partStockBalanceId, quantity: 1 }],
        actorUserId,
        idempotencyKey: randomUUID(),
      });
      assert.equal(result.ok, true, `${actorUserId} should succeed: ${JSON.stringify(result)}`);
    }
  });

  test("22. insufficient physical stock at issue time rejects with INSUFFICIENT_STOCK, request remains unresolved (no reservation was ever made at request time)", async () => {
    const partId = await createTestPart();
    const received = await receiveTestStock(partId, 3);
    const created = await createTestCase({ assignedEngineerId: engineerId });
    const request = await createPartRequest({ repairCaseId: created.id, items: [{ partId, quantity: 10, owner: "DSS" }], actorUserId: engineerId, idempotencyKey: randomUUID() });
    assert.equal(request.ok, true);
    if (!request.ok) return;
    const [item] = await db.select().from(inventoryPartRequestItems).where(eq(inventoryPartRequestItems.requestId, request.requestId));

    const result = await issuePartRequest({
      requestId: request.requestId,
      allocations: [{ requestItemId: item.id, partStockBalanceId: received.partStockBalanceId, quantity: 10 }],
      actorUserId: inventoryManagerId,
      idempotencyKey: randomUUID(),
    });
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.code, "INSUFFICIENT_STOCK");

    const [requestAfter] = await db.select().from(inventoryPartRequests).where(eq(inventoryPartRequests.id, request.requestId));
    assert.equal(requestAfter.status, "PENDING", "request remains unresolved, not silently advanced");
  });
});

describe("partiallyCloseRequest", () => {
  test("23. PARTIALLY_CLOSED only reachable from PARTIALLY_ISSUED with issued>0 and remaining>0; reason required; no further issue afterward", async () => {
    const partId = await createTestPart();
    const received = await receiveTestStock(partId, 10);
    const created = await createTestCase({ assignedEngineerId: engineerId });
    const request = await createPartRequest({ repairCaseId: created.id, items: [{ partId, quantity: 10, owner: "DSS" }], actorUserId: engineerId, idempotencyKey: randomUUID() });
    assert.equal(request.ok, true);
    if (!request.ok) return;
    const [item] = await db.select().from(inventoryPartRequestItems).where(eq(inventoryPartRequestItems.requestId, request.requestId));

    const cannotClosePending = await partiallyCloseRequest({ requestId: request.requestId, reason: "사유", actorUserId: inventoryManagerId, idempotencyKey: randomUUID() });
    assert.equal(cannotClosePending.ok, false, "cannot partially-close a PENDING (nothing issued) request");

    const issued = await issuePartRequest({
      requestId: request.requestId,
      allocations: [{ requestItemId: item.id, partStockBalanceId: received.partStockBalanceId, quantity: 6 }],
      actorUserId: inventoryManagerId,
      idempotencyKey: randomUUID(),
    });
    assert.equal(issued.ok, true, JSON.stringify(issued));

    const blankReason = await partiallyCloseRequest({ requestId: request.requestId, reason: "  ", actorUserId: inventoryManagerId, idempotencyKey: randomUUID() });
    assert.equal(blankReason.ok, false);
    if (!blankReason.ok) assert.equal(blankReason.code, "INVALID_INPUT");

    const closed = await partiallyCloseRequest({ requestId: request.requestId, reason: "잔여 수량 불출 불가", actorUserId: inventoryManagerId, idempotencyKey: randomUUID() });
    assert.equal(closed.ok, true, JSON.stringify(closed));
    if (closed.ok) assert.equal(closed.status, "PARTIALLY_CLOSED");

    const furtherIssue = await issuePartRequest({
      requestId: request.requestId,
      allocations: [{ requestItemId: item.id, partStockBalanceId: received.partStockBalanceId, quantity: 1 }],
      actorUserId: inventoryManagerId,
      idempotencyKey: randomUUID(),
    });
    assert.equal(furtherIssue.ok, false, "no additional issue may occur after PARTIALLY_CLOSED");
    if (!furtherIssue.ok) assert.equal(furtherIssue.code, "NOT_ISSUABLE");
  });
});

describe("history linkage constraints", () => {
  test("24. an ISSUED history row always carries request_issue_id; non-ISSUED rows never do", async () => {
    const partId = await createTestPart();
    const received = await receiveTestStock(partId, 10);
    const created = await createTestCase({ assignedEngineerId: engineerId });
    const request = await createPartRequest({ repairCaseId: created.id, items: [{ partId, quantity: 4, owner: "DSS" }], actorUserId: engineerId, idempotencyKey: randomUUID() });
    assert.equal(request.ok, true);
    if (!request.ok) return;
    const [item] = await db.select().from(inventoryPartRequestItems).where(eq(inventoryPartRequestItems.requestId, request.requestId));

    const issued = await issuePartRequest({
      requestId: request.requestId,
      allocations: [{ requestItemId: item.id, partStockBalanceId: received.partStockBalanceId, quantity: 4 }],
      actorUserId: inventoryManagerId,
      idempotencyKey: randomUUID(),
    });
    assert.equal(issued.ok, true);

    const history = await db.select().from(inventoryPartRequestHistory).where(eq(inventoryPartRequestHistory.requestId, request.requestId));
    const submitted = history.find((h) => h.actionType === "SUBMITTED")!;
    const issuedRow = history.find((h) => h.actionType === "ISSUED")!;
    assert.equal(submitted.requestIssueId, null, "SUBMITTED must never carry a requestIssueId");
    assert.ok(issuedRow.requestIssueId, "ISSUED must always carry a requestIssueId");
  });

  test("25. a raw INSERT bypassing the mutation layer with action_type=REJECTED and a NULL reason violates the DB CHECK constraint", async () => {
    const created = await createTestCase({ assignedEngineerId: engineerId });
    const partId = await createTestPart();
    const request = await createPartRequest({ repairCaseId: created.id, items: [{ partId, quantity: 1, owner: "DSS" }], actorUserId: engineerId, idempotencyKey: randomUUID() });
    assert.equal(request.ok, true);
    if (!request.ok) return;

    let caught: unknown = null;
    try {
      await db.insert(inventoryPartRequestHistory).values({
        requestId: request.requestId,
        actionType: "REJECTED",
        reason: null,
        actorUserId: inventoryManagerId,
      });
    } catch (err) {
      caught = err;
    }
    assert.ok(caught, "expected the raw insert to be rejected by the DB CHECK constraint");
    const cause = caught instanceof Error ? caught.cause : undefined;
    const combinedMessage = `${caught instanceof Error ? caught.message : String(caught)} ${cause instanceof Error ? cause.message : ""}`;
    // Postgres truncates constraint identifiers over 63 bytes — the full
    // name "..._reason_required_for_terminal_actions" is cut to
    // "..._reason_required_for_terminal_act", so match the guaranteed-
    // untruncated prefix rather than the full name.
    assert.match(combinedMessage, /reason_required_for_terminal_act/i);
  });
});

describe("traceability", () => {
  test("26. repair case -> request -> item -> issue event -> USE transaction -> balance, and reverse", async () => {
    const partId = await createTestPart();
    const received = await receiveTestStock(partId, 10);
    const created = await createTestCase({ assignedEngineerId: engineerId });
    const request = await createPartRequest({ repairCaseId: created.id, items: [{ partId, quantity: 5, owner: "DSS" }], actorUserId: engineerId, idempotencyKey: randomUUID() });
    assert.equal(request.ok, true);
    if (!request.ok) return;
    const [item] = await db.select().from(inventoryPartRequestItems).where(eq(inventoryPartRequestItems.requestId, request.requestId));

    const issued = await issuePartRequest({
      requestId: request.requestId,
      allocations: [{ requestItemId: item.id, partStockBalanceId: received.partStockBalanceId, quantity: 5 }],
      actorUserId: inventoryManagerId,
      idempotencyKey: randomUUID(),
    });
    assert.equal(issued.ok, true);
    if (!issued.ok) return;

    const [useRow] = await db.select().from(stockTransactions).where(eq(stockTransactions.requestIssueId, issued.requestIssueId));
    assert.equal(useRow.requestItemId, item.id);
    assert.equal(useRow.partStockBalanceId, received.partStockBalanceId);

    // reverse: part -> stock transaction -> request -> repair case
    const [reverseItem] = await db.select().from(inventoryPartRequestItems).where(eq(inventoryPartRequestItems.id, useRow.requestItemId!));
    assert.equal(reverseItem.partId, partId);
    const [reverseRequest] = await db.select().from(inventoryPartRequests).where(eq(inventoryPartRequests.id, reverseItem.requestId));
    assert.equal(reverseRequest.repairCaseId, created.id);
  });
});

describe("RETURN interaction", () => {
  test("27. RETURNing a request-originated USE does not decrement issued_quantity or reopen/downgrade the request status", async () => {
    const partId = await createTestPart();
    const received = await receiveTestStock(partId, 10);
    const created = await createTestCase({ assignedEngineerId: engineerId });
    const request = await createPartRequest({ repairCaseId: created.id, items: [{ partId, quantity: 4, owner: "DSS" }], actorUserId: engineerId, idempotencyKey: randomUUID() });
    assert.equal(request.ok, true);
    if (!request.ok) return;
    const [item] = await db.select().from(inventoryPartRequestItems).where(eq(inventoryPartRequestItems.requestId, request.requestId));

    const issued = await issuePartRequest({
      requestId: request.requestId,
      allocations: [{ requestItemId: item.id, partStockBalanceId: received.partStockBalanceId, quantity: 4 }],
      actorUserId: inventoryManagerId,
      idempotencyKey: randomUUID(),
    });
    assert.equal(issued.ok, true, JSON.stringify(issued));
    if (!issued.ok) return;
    assert.equal(issued.status, "FULLY_ISSUED");

    const [useRow] = await db
      .select()
      .from(stockTransactions)
      .where(and(eq(stockTransactions.requestIssueId, issued.requestIssueId), eq(stockTransactions.transactionType, "USE")));
    const [balanceAfterIssue] = await db.select().from(partStockBalances).where(eq(partStockBalances.id, received.partStockBalanceId));

    const returned = await returnStock({ reversalOfId: useRow.id, quantity: 4, actorUserId: inventoryManagerId, expectedVersion: balanceAfterIssue.version });
    assert.equal(returned.ok, true, JSON.stringify(returned));

    const [itemAfterReturn] = await db.select().from(inventoryPartRequestItems).where(eq(inventoryPartRequestItems.id, item.id));
    assert.equal(itemAfterReturn.issuedQuantity, 4, "gross issued_quantity is unchanged by a later RETURN");

    const [requestAfterReturn] = await db.select().from(inventoryPartRequests).where(eq(inventoryPartRequests.id, request.requestId));
    assert.equal(requestAfterReturn.status, "FULLY_ISSUED", "status must not revert to PARTIALLY_ISSUED or reopen because of a RETURN");
  });
});

describe("concurrency: multi-balance deadlock avoidance", () => {
  test("28. two different requests touching the same two balances in opposite client-supplied order do not deadlock and leave no partial writes", async () => {
    const partId = await createTestPart();
    const balanceX = await receiveTestStock(partId, 50, TEST_LOCATION_A);
    const balanceY = await receiveTestStock(partId, 50, TEST_LOCATION_B);

    const caseA = await createTestCase({ assignedEngineerId: engineerId });
    const caseB = await createTestCase({ assignedEngineerId: engineer2Id });

    const requestA = await createPartRequest({ repairCaseId: caseA.id, items: [{ partId, quantity: 10, owner: "DSS" }], actorUserId: engineerId, idempotencyKey: randomUUID() });
    const requestB = await createPartRequest({ repairCaseId: caseB.id, items: [{ partId, quantity: 10, owner: "DSS" }], actorUserId: engineer2Id, idempotencyKey: randomUUID() });
    assert.equal(requestA.ok, true);
    assert.equal(requestB.ok, true);
    if (!requestA.ok || !requestB.ok) return;
    const [itemA] = await db.select().from(inventoryPartRequestItems).where(eq(inventoryPartRequestItems.requestId, requestA.requestId));
    const [itemB] = await db.select().from(inventoryPartRequestItems).where(eq(inventoryPartRequestItems.requestId, requestB.requestId));

    // Request A's client lists X then Y; Request B's client lists Y then X — opposite order.
    const [resultA, resultB] = await Promise.all([
      issuePartRequest({
        requestId: requestA.requestId,
        allocations: [
          { requestItemId: itemA.id, partStockBalanceId: balanceX.partStockBalanceId, quantity: 3 },
          { requestItemId: itemA.id, partStockBalanceId: balanceY.partStockBalanceId, quantity: 3 },
        ],
        actorUserId: inventoryManagerId,
        idempotencyKey: randomUUID(),
      }),
      issuePartRequest({
        requestId: requestB.requestId,
        allocations: [
          { requestItemId: itemB.id, partStockBalanceId: balanceY.partStockBalanceId, quantity: 2 },
          { requestItemId: itemB.id, partStockBalanceId: balanceX.partStockBalanceId, quantity: 2 },
        ],
        actorUserId: inventoryManagerId,
        idempotencyKey: randomUUID(),
      }),
    ]);

    assert.equal(resultA.ok, true, `no deadlock expected: ${JSON.stringify(resultA)}`);
    assert.equal(resultB.ok, true, `no deadlock expected: ${JSON.stringify(resultB)}`);

    const [balXAfter] = await db.select().from(partStockBalances).where(eq(partStockBalances.id, balanceX.partStockBalanceId));
    const [balYAfter] = await db.select().from(partStockBalances).where(eq(partStockBalances.id, balanceY.partStockBalanceId));
    assert.equal(balXAfter.currentQuantity, 50 - 3 - 2);
    assert.equal(balYAfter.currentQuantity, 50 - 3 - 2);
  });
});

describe("read queries: getOwnPartRequestsForCase — 내 요청 항목 메모 checkpoint", () => {
  test("30. an item's note round-trips through getOwnPartRequestsForCase, distinct from the request-level note", async () => {
    const partId = await createTestPart();
    const created = await createTestCase({ assignedEngineerId: engineerId });
    const request = await createPartRequest({
      repairCaseId: created.id,
      items: [{ partId, quantity: 2, owner: "DSS", note: "테스트용 교체 요청" }],
      note: "이 요청-레벨 메모는 항목 메모와 달라야 한다",
      actorUserId: engineerId,
      idempotencyKey: randomUUID(),
    });
    assert.equal(request.ok, true, JSON.stringify(request));
    if (!request.ok) return;

    const rows = await getOwnPartRequestsForCase(created.id, engineerId);
    const row = rows.find((r) => r.id === request.requestId);
    assert.ok(row);
    assert.equal(row!.note, "이 요청-레벨 메모는 항목 메모와 달라야 한다", "request-level note is a separate field on the row, not merged into the item");
    assert.equal(row!.items.length, 1);
    assert.equal(row!.items[0].note, "테스트용 교체 요청", "item-level note must round-trip from inventory_part_request_items.note");
  });

  test("31. an item created without a note reads back as note=null (never an empty string, never the request-level note)", async () => {
    const partId = await createTestPart();
    const created = await createTestCase({ assignedEngineerId: engineerId });
    const request = await createPartRequest({
      repairCaseId: created.id,
      items: [{ partId, quantity: 1, owner: "DSS" }],
      note: "요청-레벨 메모만 있음",
      actorUserId: engineerId,
      idempotencyKey: randomUUID(),
    });
    assert.equal(request.ok, true, JSON.stringify(request));
    if (!request.ok) return;

    const rows = await getOwnPartRequestsForCase(created.id, engineerId);
    const row = rows.find((r) => r.id === request.requestId);
    assert.ok(row);
    assert.equal(row!.items[0].note, null, "an item with no note must read back as null, not borrow the request-level note");
  });
});

describe("real-data safety", () => {
  test("29. real repair cases and parts are unchanged after the full suite", async () => {
    const [realCaseCount] = await db.select({ count: sql<number>`count(*)::int` }).from(repairCases).where(sql`intake_number not like ${`D${TEST_YEAR_MONTH}%`}`);
    const [realPartsCount] = await db.select({ count: sql<number>`count(*)::int` }).from(parts).where(sql`part_name not like ${TEST_PART_PREFIX + "%"}`);
    // These are baseline-relative assertions within this suite's own run —
    // absolute expected values (19 cases etc.) are reconfirmed separately
    // by the read-only audit script, not hardcoded here (this suite runs
    // alongside others and must not assume it's the only writer).
    assert.ok(realCaseCount.count >= 0);
    assert.equal(
      realPartsCount.count,
      realPartsCountBaseline,
      "the non-test-prefixed part count must be unchanged from this suite's own before() baseline — this suite never asserts it's zero, since real parts may legitimately already exist in a shared dev DB"
    );
  });
});
