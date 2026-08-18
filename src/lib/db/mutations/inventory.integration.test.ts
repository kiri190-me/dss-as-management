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
  procedureTemplates,
  procedureTemplateNodes,
  procedureTemplateEdges,
  procedureTemplateEditHistory,
  procedureCaseExecutions,
  procedureCaseExecutionNodes,
  procedureCaseExecutionHistory,
} from "../schema";
import { createRepairCase } from "./repair-cases";
import { createDraftProcedureTemplateFromImport, publishProcedureTemplate } from "./procedure-templates";
import { startProcedureExecution } from "./procedure-case-execution";
import { createPart, receiveStock, consumeStock, returnStock } from "./inventory";
import { getPartList, getPartDetail, getPartTransactionHistory, getReturnableUseTransactions, getPartOwnerAvailability } from "../queries/inventory";
import type { ExtractedTemplate } from "../../../../scripts/lib/xlsx/types";
import type { ValidatedCreateRepairCaseInput } from "@/lib/validation/repair-case-input";

/**
 * Phase 5B-2 integration tests for the core inventory ledger, against the
 * real dev DB. Self-cleaning convention (same as
 * procedure-case-execution.integration.test.ts): every part uses a
 * part_name prefixed with TEST_PART_PREFIX, every repair case uses intake
 * month TEST_YEAR_MONTH ("9906", distinct from every other isolated month
 * already in use), every synthetic template uses a code prefixed with
 * TEST_TEMPLATE_PREFIX. after() deletes every row this suite created and
 * never touches real parts/repair-cases/templates.
 */

const TEST_PART_PREFIX = "test-inventory-";
const TEST_TEMPLATE_PREFIX = "test-inventory-exec-";
const TEST_MODEL_PREFIX = "INVENTORY-TEST-";
const TEST_YEAR_MONTH = "9906";
const TEST_RECEIVED_AT = "2099-06-10";
const TEST_SHIPMENT_DATE = "2099-06-20";
const TEST_LOCATION = "TEST-SHELF-A";

let realDataBaseline: {
  repairCaseCount: number;
  procedureTemplateCount: number;
  procedureCaseExecutionCount: number;
  partsCount: number;
};

let superAdminId: string;
let adminId: string;
let inventoryManagerId: string;
let engineerId: string;
let engineer2Id: string;
let salesId: string;
let customerId: string;

const createdPartIds: string[] = [];
const createdTemplateIds: string[] = [];

function uniquePartName(suffix: string): string {
  return `${TEST_PART_PREFIX}${suffix}-${randomUUID().slice(0, 8)}`;
}

function uniqueTemplateCode(suffix: string): string {
  return `${TEST_TEMPLATE_PREFIX}${suffix}-${randomUUID().slice(0, 8)}`;
}

async function createTestPart(overrides: Partial<{ partSpec: string; category: string }> = {}) {
  const result = await createPart({
    partName: uniquePartName("part"),
    partSpec: overrides.partSpec ?? "테스트 스펙",
    category: overrides.category ?? "TEST",
    actorUserId: superAdminId,
  });
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

/** Minimal single-node published template + started execution, purely to obtain a real procedure_case_execution_nodes.id for the procedureExecutionNodeId authorization tests. */
async function createExecutionNodeFixture(assignedEngineerIdForCase: string) {
  const code = uniqueTemplateCode("fixture");
  const sheet = "(TEST) 재고 검증 시트";
  const template: ExtractedTemplate = {
    code,
    name: `재고 검증용 ${code}`,
    equipmentType: "RFG",
    description: "Phase 5B-2 inventory integration test fixture",
    sourceWorksheets: [sheet],
    category: "FULL_SERVICE",
    isReferenceOnly: false,
    referenceItems: [],
    nodes: [
      { nodeCode: "n1", nodeType: "START", title: "시작", positionX: 0, positionY: 0, sortOrder: 0, sourceWorksheet: sheet, sourceShapeId: "1" },
      { nodeCode: "n2", nodeType: "TASK", title: "작업", positionX: 100, positionY: 0, sortOrder: 1, sourceWorksheet: sheet, sourceShapeId: "2" },
      { nodeCode: "n3", nodeType: "END", title: "종료", positionX: 200, positionY: 0, sortOrder: 2, sourceWorksheet: sheet, sourceShapeId: "3" },
    ],
    edges: [
      { fromNodeCode: "n1", toNodeCode: "n2", branchType: "DEFAULT", branchLabel: null, sortOrder: 0, sourceConnectorId: "c1" },
      { fromNodeCode: "n2", toNodeCode: "n3", branchType: "DEFAULT", branchLabel: null, sortOrder: 1, sourceConnectorId: "c2" },
    ],
    checklistSections: [],
    troubleshootingEntries: [],
    issues: [],
  };

  const draft = await createDraftProcedureTemplateFromImport(template, superAdminId, {
    sourceFileName: "inventory-fixture.xlsx",
    sourceFileHash: `hash-${code}`,
  });
  assert.equal(draft.ok, true, `fixture template import failed: ${JSON.stringify(draft)}`);
  if (!draft.ok) throw new Error("unreachable");
  createdTemplateIds.push(draft.id);

  const published = await publishProcedureTemplate(draft.id, superAdminId);
  assert.equal(published.ok, true, `fixture publish failed: ${JSON.stringify(published)}`);

  const created = await createTestCase({ assignedEngineerId: assignedEngineerIdForCase });
  const started = await startProcedureExecution(created.id, draft.id, superAdminId);
  assert.equal(started.ok, true, `fixture execution start failed: ${JSON.stringify(started)}`);
  if (!started.ok) throw new Error("unreachable");

  const templateNodes = await db.select().from(procedureTemplateNodes).where(eq(procedureTemplateNodes.procedureTemplateId, draft.id));
  const n2 = templateNodes.find((n) => n.nodeCode === "n2")!;
  const [executionNode] = await db
    .select()
    .from(procedureCaseExecutionNodes)
    .where(and(eq(procedureCaseExecutionNodes.executionId, started.executionId), eq(procedureCaseExecutionNodes.procedureTemplateNodeId, n2.id)));

  return { repairCaseId: created.id, executionNodeId: executionNode.id };
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

  const [repairCaseCount] = await db.select({ count: sql<number>`count(*)::int` }).from(repairCases).where(sql`intake_number not like 'D9906%'`);
  const [procedureTemplateCount] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(procedureTemplates)
    .where(sql`code not like ${TEST_TEMPLATE_PREFIX + "%"}`);
  const [procedureCaseExecutionCount] = await db.select({ count: sql<number>`count(*)::int` }).from(procedureCaseExecutions);
  // Real parts may already legitimately exist in a shared dev DB (this
  // suite is not the only writer to `parts`, and inventory is no longer
  // greenfield) — baselined here for the same "unchanged, not zero"
  // treatment as the other three counts above.
  const [partsCount] = await db.select({ count: sql<number>`count(*)::int` }).from(parts).where(sql`part_name not like ${TEST_PART_PREFIX + "%"}`);
  realDataBaseline = {
    repairCaseCount: repairCaseCount?.count ?? 0,
    procedureTemplateCount: procedureTemplateCount?.count ?? 0,
    procedureCaseExecutionCount: procedureCaseExecutionCount?.count ?? 0,
    partsCount: partsCount?.count ?? 0,
  };
});

after(async () => {
  const testParts = await db.select({ id: parts.id }).from(parts).where(like(parts.partName, `${TEST_PART_PREFIX}%`));
  const allPartIds = [...new Set([...createdPartIds, ...testParts.map((p) => p.id)])];

  if (allPartIds.length > 0) {
    const balances = await db.select({ id: partStockBalances.id }).from(partStockBalances).where(inArray(partStockBalances.partId, allPartIds));
    const balanceIds = balances.map((b) => b.id);
    if (balanceIds.length > 0) {
      await db.delete(stockTransactions).where(inArray(stockTransactions.partStockBalanceId, balanceIds));
      await db.delete(partStockBalances).where(inArray(partStockBalances.id, balanceIds));
    }
    await db.delete(parts).where(inArray(parts.id, allPartIds));
  }

  const testCases = await db.select({ id: repairCases.id }).from(repairCases).where(like(repairCases.intakeNumber, "D9906%"));
  const testCaseIds = testCases.map((c) => c.id);
  if (testCaseIds.length > 0) {
    // Any stock_transactions referencing these cases (from the destination-less
    // path this suite never uses, but defensive) — none expected, since all
    // per-case stock rows were already removed via the part-scoped delete
    // above. repair_cases itself is only referenced by stock_transactions,
    // never restricted by execution rows created for the same case.
    const executions = await db.select({ id: procedureCaseExecutions.id }).from(procedureCaseExecutions).where(inArray(procedureCaseExecutions.repairCaseId, testCaseIds));
    const executionIds = executions.map((e) => e.id);
    if (executionIds.length > 0) {
      await db.delete(procedureCaseExecutionHistory).where(inArray(procedureCaseExecutionHistory.executionId, executionIds));
      await db.delete(procedureCaseExecutionNodes).where(inArray(procedureCaseExecutionNodes.executionId, executionIds));
      await db.delete(procedureCaseExecutions).where(inArray(procedureCaseExecutions.id, executionIds));
    }
  }
  await db.delete(repairCases).where(like(repairCases.intakeNumber, "D9906%"));
  await db.delete(products).where(like(products.modelName, `${TEST_MODEL_PREFIX}%`));
  await db.delete(repairCaseIntakeSequences).where(eq(repairCaseIntakeSequences.yearMonth, TEST_YEAR_MONTH));

  const allTestTemplates = await db.select({ id: procedureTemplates.id }).from(procedureTemplates).where(like(procedureTemplates.code, `${TEST_TEMPLATE_PREFIX}%`));
  const allTemplateIds = [...new Set([...createdTemplateIds, ...allTestTemplates.map((t) => t.id)])];
  if (allTemplateIds.length > 0) {
    await db.delete(procedureTemplateEditHistory).where(inArray(procedureTemplateEditHistory.procedureTemplateId, allTemplateIds));
    await db.delete(procedureTemplateEdges).where(inArray(procedureTemplateEdges.procedureTemplateId, allTemplateIds));
    await db.delete(procedureTemplateNodes).where(inArray(procedureTemplateNodes.procedureTemplateId, allTemplateIds));
    await db.delete(procedureTemplates).where(inArray(procedureTemplates.id, allTemplateIds));
  }

  await pgClient.end({ timeout: 5 });
});

describe("inventory: RECEIPT find-or-create balance", () => {
  test("1. receiving into a new (part, owner, location) creates the balance and the first transaction", async () => {
    const partId = await createTestPart();
    const result = await receiveStock({ partId, owner: "DSS", location: TEST_LOCATION, quantity: 10, actorUserId: inventoryManagerId });
    assert.equal(result.ok, true, JSON.stringify(result));
    if (!result.ok) return;
    assert.equal(result.resultingQuantity, 10);

    const [balance] = await db.select().from(partStockBalances).where(eq(partStockBalances.id, result.partStockBalanceId));
    assert.equal(balance.currentQuantity, 10);
    assert.equal(balance.owner, "DSS");
    assert.equal(balance.location, TEST_LOCATION);

    const txs = await db.select().from(stockTransactions).where(eq(stockTransactions.partStockBalanceId, result.partStockBalanceId));
    assert.equal(txs.length, 1);
    assert.equal(txs[0].transactionType, "RECEIPT");
    assert.equal(txs[0].quantityDelta, 10);
  });

  test("2. receiving again into the same (part, owner, location) finds the existing bucket instead of creating a duplicate", async () => {
    const partId = await createTestPart();
    const first = await receiveStock({ partId, owner: "KYOSAN", location: TEST_LOCATION, quantity: 5, actorUserId: inventoryManagerId });
    assert.equal(first.ok, true);
    if (!first.ok) return;
    const second = await receiveStock({ partId, owner: "KYOSAN", location: TEST_LOCATION, quantity: 3, actorUserId: inventoryManagerId });
    assert.equal(second.ok, true);
    if (!second.ok) return;

    assert.equal(second.partStockBalanceId, first.partStockBalanceId, "must reuse the same bucket, not create a second one");
    assert.equal(second.resultingQuantity, 8);

    const balances = await db.select().from(partStockBalances).where(eq(partStockBalances.partId, partId));
    assert.equal(balances.length, 1, "exactly one bucket for this (part, owner, location) combination");
  });

  test("3. INVENTORY_MANAGER, SUPER_ADMIN, and ADMIN can receive; AS_ENGINEER and SALES cannot", async () => {
    const partId = await createTestPart();
    for (const actorUserId of [inventoryManagerId, superAdminId, adminId]) {
      const result = await receiveStock({ partId, owner: "DSS", location: TEST_LOCATION, quantity: 1, actorUserId });
      assert.equal(result.ok, true, JSON.stringify(result));
    }
    for (const actorUserId of [engineerId, salesId]) {
      const result = await receiveStock({ partId, owner: "DSS", location: TEST_LOCATION, quantity: 1, actorUserId });
      assert.equal(result.ok, false);
      if (!result.ok) assert.equal(result.code, "FORBIDDEN");
    }
  });
});

describe("inventory: USE — no negative stock, ever", () => {
  test("4. USE rejects INSUFFICIENT_STOCK when requested quantity exceeds current stock, even for SUPER_ADMIN", async () => {
    const partId = await createTestPart();
    const received = await receiveStock({ partId, owner: "DSS", location: TEST_LOCATION, quantity: 5, actorUserId: inventoryManagerId });
    assert.equal(received.ok, true);
    if (!received.ok) return;

    const result = await consumeStock({
      partStockBalanceId: received.partStockBalanceId,
      quantity: 6,
      destinationNote: "테스트 사용처",
      actorUserId: superAdminId,
      expectedVersion: received.version,
    });
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.code, "INSUFFICIENT_STOCK");

    const [balance] = await db.select().from(partStockBalances).where(eq(partStockBalances.id, received.partStockBalanceId));
    assert.equal(balance.currentQuantity, 5, "a rejected USE must never touch the balance");
  });

  test("5. USE requires either repairCaseId or destinationNote", async () => {
    const partId = await createTestPart();
    const received = await receiveStock({ partId, owner: "DSS", location: TEST_LOCATION, quantity: 5, actorUserId: inventoryManagerId });
    assert.equal(received.ok, true);
    if (!received.ok) return;

    const result = await consumeStock({
      partStockBalanceId: received.partStockBalanceId,
      quantity: 1,
      actorUserId: superAdminId,
      expectedVersion: received.version,
    });
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.code, "INVALID_INPUT");
  });

  test("6. a successful USE decrements the balance and records the transaction", async () => {
    const partId = await createTestPart();
    const received = await receiveStock({ partId, owner: "DSS", location: TEST_LOCATION, quantity: 10, actorUserId: inventoryManagerId });
    assert.equal(received.ok, true);
    if (!received.ok) return;

    const used = await consumeStock({
      partStockBalanceId: received.partStockBalanceId,
      quantity: 4,
      destinationNote: "상해수리소",
      actorUserId: inventoryManagerId,
      expectedVersion: received.version,
      reason: "테스트 사용",
    });
    assert.equal(used.ok, true, JSON.stringify(used));
    if (!used.ok) return;
    assert.equal(used.resultingQuantity, 6);

    const txs = await db
      .select()
      .from(stockTransactions)
      .where(and(eq(stockTransactions.partStockBalanceId, received.partStockBalanceId), eq(stockTransactions.transactionType, "USE")));
    assert.equal(txs.length, 1);
    assert.equal(txs[0].quantityDelta, -4);
    assert.equal(txs[0].destinationNote, "상해수리소");
  });
});

describe("inventory: USE authorization matrix (plan §9)", () => {
  test("7. SUPER_ADMIN/ADMIN/INVENTORY_MANAGER can USE against any unlocked repair case", async () => {
    const partId = await createTestPart();
    const created = await createTestCase({ assignedEngineerId: engineer2Id });
    for (const actorUserId of [superAdminId, adminId, inventoryManagerId]) {
      const received = await receiveStock({ partId, owner: "DSS", location: TEST_LOCATION, quantity: 5, actorUserId: inventoryManagerId });
      assert.equal(received.ok, true);
      if (!received.ok) return;
      const result = await consumeStock({
        partStockBalanceId: received.partStockBalanceId,
        quantity: 1,
        repairCaseId: created.id,
        actorUserId,
        expectedVersion: received.version,
      });
      assert.equal(result.ok, true, `${actorUserId} failed: ${JSON.stringify(result)}`);
    }
  });

  test("8. SUPER_ADMIN/ADMIN/INVENTORY_MANAGER can USE with only a destination note (no repair case)", async () => {
    const partId = await createTestPart();
    for (const actorUserId of [superAdminId, adminId, inventoryManagerId]) {
      const received = await receiveStock({ partId, owner: "DSS", location: TEST_LOCATION, quantity: 5, actorUserId: inventoryManagerId });
      assert.equal(received.ok, true);
      if (!received.ok) return;
      const result = await consumeStock({
        partStockBalanceId: received.partStockBalanceId,
        quantity: 1,
        destinationNote: "테스트용",
        actorUserId,
        expectedVersion: received.version,
      });
      assert.equal(result.ok, true, `${actorUserId} failed: ${JSON.stringify(result)}`);
    }
  });

  test("9. Phase 5B-3: AS_ENGINEER is FORBIDDEN from direct USE even against a repair case they are directly assigned to — their only path to consuming stock is the parts-request/issue workflow", async () => {
    const partId = await createTestPart();
    const created = await createTestCase({ assignedEngineerId: engineerId });
    const received = await receiveStock({ partId, owner: "DSS", location: TEST_LOCATION, quantity: 5, actorUserId: inventoryManagerId });
    assert.equal(received.ok, true);
    if (!received.ok) return;

    const result = await consumeStock({
      partStockBalanceId: received.partStockBalanceId,
      quantity: 1,
      repairCaseId: created.id,
      actorUserId: engineerId,
      expectedVersion: received.version,
    });
    assert.equal(result.ok, false, JSON.stringify(result));
    if (!result.ok) assert.equal(result.code, "FORBIDDEN");
  });

  test("10. AS_ENGINEER cannot USE against a repair case they are not assigned to, and cannot use a destination-only USE at all", async () => {
    const partId = await createTestPart();
    const created = await createTestCase({ assignedEngineerId: engineer2Id });
    const received = await receiveStock({ partId, owner: "DSS", location: TEST_LOCATION, quantity: 5, actorUserId: inventoryManagerId });
    assert.equal(received.ok, true);
    if (!received.ok) return;

    const unassignedResult = await consumeStock({
      partStockBalanceId: received.partStockBalanceId,
      quantity: 1,
      repairCaseId: created.id,
      actorUserId: engineerId,
      expectedVersion: received.version,
    });
    assert.equal(unassignedResult.ok, false);
    if (!unassignedResult.ok) assert.equal(unassignedResult.code, "FORBIDDEN");

    const destinationOnlyResult = await consumeStock({
      partStockBalanceId: received.partStockBalanceId,
      quantity: 1,
      destinationNote: "테스트용",
      actorUserId: engineerId,
      expectedVersion: received.version,
    });
    assert.equal(destinationOnlyResult.ok, false);
    if (!destinationOnlyResult.ok) assert.equal(destinationOnlyResult.code, "FORBIDDEN", "a destination-only USE is valid input — AS_ENGINEER is simply never authorized to make one");
  });

  test("11. Phase 5B-3: a supplied procedureExecutionNodeId no longer grants AS_ENGINEER a direct-USE path, even when they are its effective assignee — canUseStock has no AS_ENGINEER branch left at all", async () => {
    const partId = await createTestPart();
    // Case is assigned to engineer2, but engineer1 self-claimed the specific execution node.
    const fixture = await createExecutionNodeFixture(engineer2Id);
    const [claimResult] = await db
      .update(procedureCaseExecutionNodes)
      .set({ assignedEngineerId: engineerId })
      .where(eq(procedureCaseExecutionNodes.id, fixture.executionNodeId))
      .returning({ id: procedureCaseExecutionNodes.id });
    assert.ok(claimResult);

    const received = await receiveStock({ partId, owner: "DSS", location: TEST_LOCATION, quantity: 5, actorUserId: inventoryManagerId });
    assert.equal(received.ok, true);
    if (!received.ok) return;

    const result = await consumeStock({
      partStockBalanceId: received.partStockBalanceId,
      quantity: 1,
      repairCaseId: fixture.repairCaseId,
      procedureExecutionNodeId: fixture.executionNodeId,
      actorUserId: engineerId,
      expectedVersion: received.version,
    });
    assert.equal(result.ok, false, JSON.stringify(result));
    if (!result.ok) assert.equal(result.code, "FORBIDDEN");
  });

  test("12. AS_ENGINEER supplying a procedureExecutionNodeId that belongs to a different repair case than the one submitted is rejected with INVALID_INPUT (anti-bypass)", async () => {
    const partId = await createTestPart();
    const fixture = await createExecutionNodeFixture(engineerId);
    const otherCase = await createTestCase({ assignedEngineerId: engineer2Id });

    const received = await receiveStock({ partId, owner: "DSS", location: TEST_LOCATION, quantity: 5, actorUserId: inventoryManagerId });
    assert.equal(received.ok, true);
    if (!received.ok) return;

    const result = await consumeStock({
      partStockBalanceId: received.partStockBalanceId,
      quantity: 1,
      repairCaseId: otherCase.id, // engineerId is NOT assigned to this case
      procedureExecutionNodeId: fixture.executionNodeId, // ...and this node belongs to a *different* case entirely
      actorUserId: engineerId,
      expectedVersion: received.version,
    });
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.code, "INVALID_INPUT");
  });

  test("13. SALES cannot USE stock under any circumstance", async () => {
    const partId = await createTestPart();
    const created = await createTestCase({ assignedEngineerId: engineerId });
    const received = await receiveStock({ partId, owner: "DSS", location: TEST_LOCATION, quantity: 5, actorUserId: inventoryManagerId });
    assert.equal(received.ok, true);
    if (!received.ok) return;

    const withCase = await consumeStock({
      partStockBalanceId: received.partStockBalanceId,
      quantity: 1,
      repairCaseId: created.id,
      actorUserId: salesId,
      expectedVersion: received.version,
    });
    assert.equal(withCase.ok, false);
    if (!withCase.ok) assert.equal(withCase.code, "FORBIDDEN");

    const withDestination = await consumeStock({
      partStockBalanceId: received.partStockBalanceId,
      quantity: 1,
      destinationNote: "테스트",
      actorUserId: salesId,
      expectedVersion: received.version,
    });
    assert.equal(withDestination.ok, false);
    if (!withDestination.ok) assert.equal(withDestination.code, "FORBIDDEN");
  });

  test("14. shipment-lock removal policy: USE on a locked (shipped) repair case no longer blocks the privileged roles; AS_ENGINEER remains denied by role, not lock", async () => {
    const partId = await createTestPart();
    const created = await createTestCase({ assignedEngineerId: engineerId });
    await lockCase(created.id);

    const received = await receiveStock({ partId, owner: "DSS", location: TEST_LOCATION, quantity: 5, actorUserId: inventoryManagerId });
    assert.equal(received.ok, true);
    if (!received.ok) return;

    const engineerAttempt = await consumeStock({
      partStockBalanceId: received.partStockBalanceId,
      quantity: 1,
      repairCaseId: created.id,
      actorUserId: engineerId,
      expectedVersion: received.version,
    });
    assert.equal(engineerAttempt.ok, false);
    if (!engineerAttempt.ok) assert.equal(engineerAttempt.code, "FORBIDDEN");

    // Each successful consume bumps the balance's version, so chain
    // expectedVersion through the loop rather than reusing the stale
    // original value.
    let currentVersion = received.version;
    for (const actorUserId of [superAdminId, adminId, inventoryManagerId]) {
      const result = await consumeStock({
        partStockBalanceId: received.partStockBalanceId,
        quantity: 1,
        repairCaseId: created.id,
        actorUserId,
        expectedVersion: currentVersion,
      });
      assert.equal(result.ok, true, `${actorUserId} should succeed: ${JSON.stringify(result)}`);
      if (result.ok) currentVersion = result.version;
    }
  });
});

describe("inventory: RETURN always reverses a specific prior USE", () => {
  test("15. RETURN against a non-USE transaction id is rejected with INVALID_RETURN_TARGET", async () => {
    const partId = await createTestPart();
    const received = await receiveStock({ partId, owner: "DSS", location: TEST_LOCATION, quantity: 5, actorUserId: inventoryManagerId });
    assert.equal(received.ok, true);
    if (!received.ok) return;

    const [receiptTx] = await db.select().from(stockTransactions).where(eq(stockTransactions.partStockBalanceId, received.partStockBalanceId));
    const result = await returnStock({
      reversalOfId: receiptTx.id,
      quantity: 1,
      actorUserId: inventoryManagerId,
      expectedVersion: received.version,
    });
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.code, "INVALID_RETURN_TARGET");
  });

  test("16. over-returning beyond the original USE quantity is rejected with OVER_RETURN", async () => {
    const partId = await createTestPart();
    const received = await receiveStock({ partId, owner: "DSS", location: TEST_LOCATION, quantity: 10, actorUserId: inventoryManagerId });
    assert.equal(received.ok, true);
    if (!received.ok) return;
    const used = await consumeStock({
      partStockBalanceId: received.partStockBalanceId,
      quantity: 5,
      destinationNote: "테스트",
      actorUserId: inventoryManagerId,
      expectedVersion: received.version,
    });
    assert.equal(used.ok, true);
    if (!used.ok) return;

    const [useTx] = await db
      .select()
      .from(stockTransactions)
      .where(and(eq(stockTransactions.partStockBalanceId, received.partStockBalanceId), eq(stockTransactions.transactionType, "USE")));

    const overReturn = await returnStock({ reversalOfId: useTx.id, quantity: 6, actorUserId: inventoryManagerId, expectedVersion: used.version });
    assert.equal(overReturn.ok, false);
    if (!overReturn.ok) assert.equal(overReturn.code, "OVER_RETURN");
  });

  test("17. partial multi-step returns sum correctly and the balance reflects every step", async () => {
    const partId = await createTestPart();
    const received = await receiveStock({ partId, owner: "DSS", location: TEST_LOCATION, quantity: 10, actorUserId: inventoryManagerId });
    assert.equal(received.ok, true);
    if (!received.ok) return;
    const used = await consumeStock({
      partStockBalanceId: received.partStockBalanceId,
      quantity: 10,
      destinationNote: "테스트",
      actorUserId: inventoryManagerId,
      expectedVersion: received.version,
    });
    assert.equal(used.ok, true);
    if (!used.ok) return;

    const [useTx] = await db
      .select()
      .from(stockTransactions)
      .where(and(eq(stockTransactions.partStockBalanceId, received.partStockBalanceId), eq(stockTransactions.transactionType, "USE")));

    const firstReturn = await returnStock({ reversalOfId: useTx.id, quantity: 3, actorUserId: inventoryManagerId, expectedVersion: used.version });
    assert.equal(firstReturn.ok, true, JSON.stringify(firstReturn));
    if (!firstReturn.ok) return;
    assert.equal(firstReturn.resultingQuantity, 3); // 10 - 10 + 3

    const secondReturn = await returnStock({ reversalOfId: useTx.id, quantity: 2, actorUserId: inventoryManagerId, expectedVersion: firstReturn.version });
    assert.equal(secondReturn.ok, true, JSON.stringify(secondReturn));
    if (!secondReturn.ok) return;
    assert.equal(secondReturn.resultingQuantity, 5); // + 2 more

    // Exactly 5 remained returnable (10 used - 3 - 2) — a return of 6 now must fail.
    const overReturn = await returnStock({ reversalOfId: useTx.id, quantity: 6, actorUserId: inventoryManagerId, expectedVersion: secondReturn.version });
    assert.equal(overReturn.ok, false);
    if (!overReturn.ok) assert.equal(overReturn.code, "OVER_RETURN");

    // But a return of exactly the remaining 5 succeeds.
    const finalReturn = await returnStock({ reversalOfId: useTx.id, quantity: 5, actorUserId: inventoryManagerId, expectedVersion: secondReturn.version });
    assert.equal(finalReturn.ok, true, JSON.stringify(finalReturn));
    if (!finalReturn.ok) return;
    assert.equal(finalReturn.resultingQuantity, 10, "fully returned back to the original received quantity");
  });

  test("18. RETURN respects the general permission matrix (INVENTORY_MANAGER/ADMIN/SUPER_ADMIN only)", async () => {
    const partId = await createTestPart();
    const received = await receiveStock({ partId, owner: "DSS", location: TEST_LOCATION, quantity: 5, actorUserId: inventoryManagerId });
    assert.equal(received.ok, true);
    if (!received.ok) return;
    const used = await consumeStock({
      partStockBalanceId: received.partStockBalanceId,
      quantity: 2,
      destinationNote: "테스트",
      actorUserId: inventoryManagerId,
      expectedVersion: received.version,
    });
    assert.equal(used.ok, true);
    if (!used.ok) return;
    const [useTx] = await db
      .select()
      .from(stockTransactions)
      .where(and(eq(stockTransactions.partStockBalanceId, received.partStockBalanceId), eq(stockTransactions.transactionType, "USE")));

    const result = await returnStock({ reversalOfId: useTx.id, quantity: 1, actorUserId: engineerId, expectedVersion: used.version });
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.code, "FORBIDDEN");
  });
});

describe("inventory: concurrency", () => {
  test("19. two concurrent USEs on the same balance with the same expected version: exactly one succeeds, the other gets CONFLICT", async () => {
    const partId = await createTestPart();
    const received = await receiveStock({ partId, owner: "DSS", location: TEST_LOCATION, quantity: 10, actorUserId: inventoryManagerId });
    assert.equal(received.ok, true);
    if (!received.ok) return;

    const [a, b] = await Promise.all([
      consumeStock({ partStockBalanceId: received.partStockBalanceId, quantity: 3, destinationNote: "테스트A", actorUserId: inventoryManagerId, expectedVersion: received.version }),
      consumeStock({ partStockBalanceId: received.partStockBalanceId, quantity: 3, destinationNote: "테스트B", actorUserId: adminId, expectedVersion: received.version }),
    ]);
    const results = [a, b];
    const succeeded = results.filter((r) => r.ok);
    const conflicted = results.filter((r) => !r.ok);
    assert.equal(succeeded.length, 1, `expected exactly one success, got ${JSON.stringify(results)}`);
    assert.equal(conflicted.length, 1);
    if (!conflicted[0].ok) assert.equal(conflicted[0].code, "CONFLICT");
  });

  test("20. concurrent USEs on two different balances never conflict", async () => {
    const partA = await createTestPart();
    const partB = await createTestPart();
    const receivedA = await receiveStock({ partId: partA, owner: "DSS", location: TEST_LOCATION, quantity: 5, actorUserId: inventoryManagerId });
    const receivedB = await receiveStock({ partId: partB, owner: "DSS", location: TEST_LOCATION, quantity: 5, actorUserId: inventoryManagerId });
    assert.equal(receivedA.ok, true);
    assert.equal(receivedB.ok, true);
    if (!receivedA.ok || !receivedB.ok) return;

    const [resultA, resultB] = await Promise.all([
      consumeStock({ partStockBalanceId: receivedA.partStockBalanceId, quantity: 1, destinationNote: "테스트", actorUserId: inventoryManagerId, expectedVersion: receivedA.version }),
      consumeStock({ partStockBalanceId: receivedB.partStockBalanceId, quantity: 1, destinationNote: "테스트", actorUserId: adminId, expectedVersion: receivedB.version }),
    ]);
    assert.equal(resultA.ok, true, JSON.stringify(resultA));
    assert.equal(resultB.ok, true, JSON.stringify(resultB));
  });
});

describe("inventory: read queries", () => {
  test("22. getPartList finds a part by partial partSpec/drawingNo match and reports its aggregated totalQuantity across buckets", async () => {
    const partId = await createTestPart({ partSpec: `고유스펙-${randomUUID().slice(0, 6)}` });
    const [part] = await db.select({ partSpec: parts.partSpec, partName: parts.partName }).from(parts).where(eq(parts.id, partId));

    const receivedA = await receiveStock({ partId, owner: "DSS", location: TEST_LOCATION, quantity: 4, actorUserId: inventoryManagerId });
    const receivedB = await receiveStock({ partId, owner: "KYOSAN", location: TEST_LOCATION, quantity: 3, actorUserId: inventoryManagerId });
    assert.equal(receivedA.ok, true);
    assert.equal(receivedB.ok, true);

    const results = await getPartList({ search: part.partSpec! });
    assert.equal(results.length, 1);
    assert.equal(results[0].id, partId);
    assert.equal(results[0].totalQuantity, 7, "totalQuantity sums every bucket for this part");
  });

  test("22b. getPartOwnerAvailability: a part with stock across multiple owners reports each owner's quantity separately, not an all-owner total", async () => {
    const partId = await createTestPart();
    await receiveStock({ partId, owner: "DSS", location: TEST_LOCATION, quantity: 5, actorUserId: inventoryManagerId });
    await receiveStock({ partId, owner: "KYOSAN", location: TEST_LOCATION, quantity: 3, actorUserId: inventoryManagerId });
    await receiveStock({ partId, owner: "SERVICE_SPARE", location: TEST_LOCATION, quantity: 2, actorUserId: inventoryManagerId });

    const rows = await getPartOwnerAvailability();
    const forThisPart = rows.filter((r) => r.partId === partId);
    const byOwner = new Map(forThisPart.map((r) => [r.owner, r.quantity]));
    assert.equal(byOwner.get("DSS"), 5);
    assert.equal(byOwner.get("KYOSAN"), 3);
    assert.equal(byOwner.get("SERVICE_SPARE"), 2);
    assert.equal(byOwner.get("TEST"), undefined, "an owner with zero balance rows must simply be absent, not present with 0");
  });

  test("22c. getPartOwnerAvailability: multiple locations for the same part+owner sum into one row, using the same aggregate as totalQuantity", async () => {
    const partId = await createTestPart();
    await receiveStock({ partId, owner: "DSS", location: TEST_LOCATION, quantity: 4, actorUserId: inventoryManagerId });
    await receiveStock({ partId, owner: "DSS", location: "TEST-SHELF-B", quantity: 6, actorUserId: inventoryManagerId });

    const rows = await getPartOwnerAvailability();
    const forThisPartAndOwner = rows.filter((r) => r.partId === partId && r.owner === "DSS");
    assert.equal(forThisPartAndOwner.length, 1, "one row per (partId, owner) regardless of how many location buckets exist");
    assert.equal(forThisPartAndOwner[0].quantity, 10, "must sum across every location bucket for that owner, same as getPartList's totalQuantity would for the whole part");
  });

  test("23. getPartDetail returns the balance grid across all owner/location buckets", async () => {
    const partId = await createTestPart();
    await receiveStock({ partId, owner: "DSS", location: TEST_LOCATION, quantity: 2, actorUserId: inventoryManagerId });
    await receiveStock({ partId, owner: "TEST", location: "TEST-SHELF-B", quantity: 1, actorUserId: inventoryManagerId });

    const detail = await getPartDetail(partId);
    assert.ok(detail);
    assert.equal(detail!.balances.length, 2);
    assert.ok(detail!.balances.some((b) => b.owner === "DSS" && b.currentQuantity === 2));
    assert.ok(detail!.balances.some((b) => b.owner === "TEST" && b.currentQuantity === 1));
  });

  test("24. getPartTransactionHistory returns newest-first rows across every bucket for a part, with the repair case's intake number resolved live", async () => {
    const partId = await createTestPart();
    const created = await createTestCase({ assignedEngineerId: engineerId });
    const received = await receiveStock({ partId, owner: "DSS", location: TEST_LOCATION, quantity: 5, actorUserId: inventoryManagerId });
    assert.equal(received.ok, true);
    if (!received.ok) return;
    const used = await consumeStock({
      partStockBalanceId: received.partStockBalanceId,
      quantity: 2,
      repairCaseId: created.id,
      actorUserId: inventoryManagerId,
      expectedVersion: received.version,
    });
    assert.equal(used.ok, true);

    const history = await getPartTransactionHistory(partId);
    assert.ok(history.length >= 2);
    assert.equal(history[0].transactionType, "USE", "most recent transaction comes first");
    assert.equal(history[0].repairCaseIntakeNumber, created.intakeNumber);
  });

  test("25. getReturnableUseTransactions excludes fully-returned USEs and reflects partial returns", async () => {
    const partId = await createTestPart();
    const received = await receiveStock({ partId, owner: "DSS", location: TEST_LOCATION, quantity: 10, actorUserId: inventoryManagerId });
    assert.equal(received.ok, true);
    if (!received.ok) return;
    const used = await consumeStock({
      partStockBalanceId: received.partStockBalanceId,
      quantity: 6,
      destinationNote: "테스트",
      actorUserId: inventoryManagerId,
      expectedVersion: received.version,
    });
    assert.equal(used.ok, true);
    if (!used.ok) return;

    const beforeReturn = await getReturnableUseTransactions(received.partStockBalanceId);
    assert.equal(beforeReturn.length, 1);
    assert.equal(beforeReturn[0].returnableQuantity, 6);

    const [useTx] = await db
      .select()
      .from(stockTransactions)
      .where(and(eq(stockTransactions.partStockBalanceId, received.partStockBalanceId), eq(stockTransactions.transactionType, "USE")));
    const returned = await returnStock({ reversalOfId: useTx.id, quantity: 6, actorUserId: inventoryManagerId, expectedVersion: used.version });
    assert.equal(returned.ok, true);

    const afterFullReturn = await getReturnableUseTransactions(received.partStockBalanceId);
    assert.equal(afterFullReturn.length, 0, "a fully-returned USE must no longer be offered as a return target");
  });
});

describe("inventory: real-data safety", () => {
  test("21. real repair cases, procedure templates, and procedure-case executions are unchanged after the full suite", async () => {
    const [realCaseCount] = await db.select({ count: sql<number>`count(*)::int` }).from(repairCases).where(sql`intake_number not like 'D9906%'`);
    const [realTemplateCount] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(procedureTemplates)
      .where(sql`code not like ${TEST_TEMPLATE_PREFIX + "%"}`);
    // Scoped by join, excluding this suite's own not-yet-cleaned-up test
    // executions (they belong to test-prefixed templates) — this test runs
    // before the file's after() cleanup, so test-created rows still exist
    // at this point and must be explicitly excluded, not just ignored.
    const [realExecutionCount] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(procedureCaseExecutions)
      .innerJoin(procedureTemplates, eq(procedureCaseExecutions.procedureTemplateId, procedureTemplates.id))
      .where(sql`${procedureTemplates.code} not like ${TEST_TEMPLATE_PREFIX + "%"}`);
    const [realPartsCount] = await db.select({ count: sql<number>`count(*)::int` }).from(parts).where(sql`part_name not like ${TEST_PART_PREFIX + "%"}`);

    assert.equal(realCaseCount?.count ?? 0, realDataBaseline.repairCaseCount, "no real repair case was created, modified, or removed by this suite");
    assert.equal(realTemplateCount?.count ?? 0, realDataBaseline.procedureTemplateCount, "no real procedure template was touched by this suite");
    assert.equal(realExecutionCount?.count ?? 0, realDataBaseline.procedureCaseExecutionCount, "no real procedure-case execution was touched by this suite");
    assert.equal(
      realPartsCount?.count ?? 0,
      realDataBaseline.partsCount,
      "the non-test-prefixed part count must be unchanged from this suite's own before() baseline — this suite never asserts it's zero, since real parts may legitimately already exist in a shared dev DB"
    );
  });
});
