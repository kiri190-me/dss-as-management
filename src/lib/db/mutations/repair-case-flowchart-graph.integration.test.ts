import "../../../../scripts/load-env";

import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { and, eq, inArray, like } from "drizzle-orm";
import { db, pgClient } from "../connection";
import {
  users,
  customers,
  products,
  repairCases,
  repairCaseIntakeSequences,
  repairCaseFlowcharts,
  repairCaseFlowchartNodes,
  repairCaseFlowchartEdges,
  repairCaseFlowchartEditHistory,
  repairCaseWorkRecords,
} from "../schema";
import { createRepairCase } from "./repair-cases";
import { createRepairCaseFlowchart } from "./repair-case-flowcharts";
import { createWorkRecord } from "./repair-case-work-records";
import { getWorkRecordHistoryForCase } from "../queries/repair-case-work-records";
import {
  buildWorkRecordFlowchart,
  listWorkRecordIdsInFlowchart,
  WORK_RECORD_FLOWCHART_MAX_RECORDS,
  type WorkRecordFlowchartInput,
} from "@/lib/domain/work-record-flowchart";
import {
  createRepairCaseFlowchartWithGraph,
  createRepairCaseFlowchartNode,
  updateRepairCaseFlowchartNode,
  changeRepairCaseFlowchartNodeType,
  saveRepairCaseFlowchartLayout,
  deleteRepairCaseFlowchartNode,
  createRepairCaseFlowchartEdge,
  updateRepairCaseFlowchartEdge,
  retargetRepairCaseFlowchartEdge,
  deleteRepairCaseFlowchartEdge,
  saveRepairCaseFlowchartEdgeRoute,
  insertRepairCaseFlowchartNodeOnEdge,
} from "./repair-case-flowchart-graph";
import type { ValidatedCreateRepairCaseInput } from "@/lib/validation/repair-case-input";

/**
 * Phase 5C-6C integration tests for repair-case flowchart GRAPH CRUD
 * (node/edge create/update/delete, layout save) — UI adapter, routing/
 * waypoint editing, and Undo/Redo do not exist yet (6D/6E). Self-cleaning
 * convention, same as repair-case-flowcharts.integration.test.ts (5C-6B):
 * every repair case created here uses intake month TEST_YEAR_MONTH
 * ("9802", distinct from every other isolated month already in use).
 * after() deletes every row this suite created and never touches the 19
 * real repair cases, the four real procedure templates, or the genuine
 * 고객/고객연락 TECHNICAL_TASK draft.
 */

const TEST_YEAR_MONTH = "9802";
const RECEIVED_AT = "2098-02-10";
const SHIPMENT_DATE = "2098-02-20";
const TEST_MODEL_PREFIX = "FLOWCHART-GRAPH-6C-TEST-";

let superAdminId: string;
let adminId: string;
let engineerId: string;
let engineer2Id: string;
let salesId: string;
let inventoryManagerId: string;
let customerId: string;

const createdRepairCaseIds: string[] = [];
const createdFlowchartIds: string[] = [];
const createdWorkRecordIds: string[] = [];

function baseCreateInput(overrides: Partial<ValidatedCreateRepairCaseInput> = {}): ValidatedCreateRepairCaseInput {
  const suffix = randomUUID().slice(0, 8);
  return {
    workflowType: "PAID_MATCHER",
    billingType: "PAID",
    customerId,
    endUserId: null,
    assignedEngineerId: engineerId,
    receivedAt: RECEIVED_AT,
    customerRequestedDueDate: null,
    internalTargetShipmentDate: SHIPMENT_DATE,
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

async function createTestRepairCase(overrides: Partial<ValidatedCreateRepairCaseInput> = {}): Promise<string> {
  const result = await createRepairCase(baseCreateInput(overrides));
  assert.equal(result.ok, true, `setup repair case create failed: ${JSON.stringify(result)}`);
  if (!result.ok) throw new Error("unreachable");
  createdRepairCaseIds.push(result.id);
  return result.id;
}

async function lockCase(repairCaseId: string) {
  await db.update(repairCases).set({ isLocked: true }).where(eq(repairCases.id, repairCaseId));
}

/** 유·무상 미확정으로 되돌린다. lockCase 와 같은 결의 시험용 손질이다 — 이 시험이 만든 건에만 쓴다. */
async function setPendingBilling(repairCaseId: string) {
  await db.update(repairCases).set({ billingType: "PENDING_DECISION" }).where(eq(repairCases.id, repairCaseId));
}

async function createTestFlowchart(repairCaseId: string, actorUserId = superAdminId) {
  const result = await createRepairCaseFlowchart({ repairCaseId, actorUserId, title: "그래프 테스트 Flowchart", description: null });
  assert.equal(result.ok, true, `setup flowchart create failed: ${JSON.stringify(result)}`);
  if (!result.ok) throw new Error("unreachable");
  createdFlowchartIds.push(result.id);
  return result;
}

async function mustCreateNode(params: { repairCaseId: string; flowchartId: string; actorUserId: string; title?: string; expectedFlowchartUpdatedAt: string }) {
  const result = await createRepairCaseFlowchartNode({
    repairCaseId: params.repairCaseId,
    flowchartId: params.flowchartId,
    actorUserId: params.actorUserId,
    nodeType: "TASK",
    title: params.title ?? "노드",
    description: null,
    expectedFlowchartUpdatedAt: params.expectedFlowchartUpdatedAt,
  });
  assert.equal(result.ok, true, `setup node create failed: ${JSON.stringify(result)}`);
  if (!result.ok) throw new Error("unreachable");
  return result;
}

async function mustCreateEdge(params: {
  repairCaseId: string;
  flowchartId: string;
  actorUserId: string;
  fromNodeId: string;
  toNodeId: string;
  expectedFlowchartUpdatedAt: string;
}) {
  const result = await createRepairCaseFlowchartEdge({
    repairCaseId: params.repairCaseId,
    flowchartId: params.flowchartId,
    actorUserId: params.actorUserId,
    fromNodeId: params.fromNodeId,
    toNodeId: params.toNodeId,
    branchType: "DEFAULT",
    branchLabel: null,
    expectedFlowchartUpdatedAt: params.expectedFlowchartUpdatedAt,
  });
  assert.equal(result.ok, true, `setup edge create failed: ${JSON.stringify(result)}`);
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

  const [inventoryManager] = await db
    .select({ id: users.id })
    .from(users)
    .where(and(eq(users.role, "INVENTORY_MANAGER"), eq(users.approvalStatus, "APPROVED"), eq(users.isDeleted, false), eq(users.isActive, true)))
    .limit(1);
  assert.ok(inventoryManager, "expected an approved INVENTORY_MANAGER in the dev DB");
  inventoryManagerId = inventoryManager.id;

  const [customer] = await db.select({ id: customers.id }).from(customers).where(eq(customers.isDeleted, false)).limit(1);
  assert.ok(customer, "expected at least one non-deleted customer in the dev DB");
  customerId = customer.id;
});

after(async () => {
  if (createdFlowchartIds.length > 0) {
    // repair_case_flowchart_edit_history.flowchart_id is RESTRICT — must go
    // first. Nodes/edges cascade automatically from the flowchart delete
    // (0019's ON DELETE CASCADE, empirically verified in 5C-6A), so no
    // explicit node/edge delete is needed here.
    await db.delete(repairCaseFlowchartEditHistory).where(inArray(repairCaseFlowchartEditHistory.flowchartId, createdFlowchartIds));
    await db.delete(repairCaseFlowcharts).where(inArray(repairCaseFlowcharts.id, createdFlowchartIds));
  }
  // 작업 기록은 접수 건보다 먼저 지운다 — repair_case_id 가 ON DELETE SET NULL
  // 이라 접수 건을 먼저 지우면 주인 없는 기록이 시험 DB 에 남는다.
  if (createdWorkRecordIds.length > 0) {
    await db.delete(repairCaseWorkRecords).where(inArray(repairCaseWorkRecords.id, createdWorkRecordIds));
  }
  await db.delete(repairCases).where(like(repairCases.intakeNumber, `D${TEST_YEAR_MONTH}%`));
  await db.delete(products).where(like(products.modelName, `${TEST_MODEL_PREFIX}%`));
  await db.delete(repairCaseIntakeSequences).where(eq(repairCaseIntakeSequences.yearMonth, TEST_YEAR_MONTH));
  await pgClient.end({ timeout: 5 });
});

// =====================================================================
// NODE
// =====================================================================

describe("createRepairCaseFlowchartNode", () => {
  test("creates a node with default deterministic position", async () => {
    const repairCaseId = await createTestRepairCase();
    const flowchart = await createTestFlowchart(repairCaseId);
    const first = await mustCreateNode({ repairCaseId, flowchartId: flowchart.id, actorUserId: superAdminId, title: "첫 노드", expectedFlowchartUpdatedAt: flowchart.updatedAt });
    const [row1] = await db.select().from(repairCaseFlowchartNodes).where(eq(repairCaseFlowchartNodes.id, first.nodeId));
    assert.equal(row1.positionX, 0);
    assert.equal(row1.positionY, 0);

    const second = await mustCreateNode({ repairCaseId, flowchartId: flowchart.id, actorUserId: superAdminId, title: "둘째 노드", expectedFlowchartUpdatedAt: first.updatedAt });
    const [row2] = await db.select().from(repairCaseFlowchartNodes).where(eq(repairCaseFlowchartNodes.id, second.nodeId));
    assert.equal(row2.positionX, 0);
    assert.equal(row2.positionY, 150);
  });

  test("a blank title is rejected", async () => {
    const repairCaseId = await createTestRepairCase();
    const flowchart = await createTestFlowchart(repairCaseId);
    const result = await createRepairCaseFlowchartNode({
      repairCaseId,
      flowchartId: flowchart.id,
      actorUserId: superAdminId,
      nodeType: "TASK",
      title: "   ",
      description: null,
      expectedFlowchartUpdatedAt: flowchart.updatedAt,
    });
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.code, "INVALID_INPUT");
  });

  test("an invalid nodeType is rejected", async () => {
    const repairCaseId = await createTestRepairCase();
    const flowchart = await createTestFlowchart(repairCaseId);
    const result = await createRepairCaseFlowchartNode({
      repairCaseId,
      flowchartId: flowchart.id,
      actorUserId: superAdminId,
      nodeType: "NOT_A_REAL_TYPE",
      title: "노드",
      description: null,
      expectedFlowchartUpdatedAt: flowchart.updatedAt,
    });
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.code, "INVALID_INPUT");
  });

  test("AS_ENGINEER may create a node even when not assigned to the case (Checkpoint 3A — assignment scoping removed)", async () => {
    const repairCaseId = await createTestRepairCase({ assignedEngineerId: engineerId });
    const flowchart = await createTestFlowchart(repairCaseId);
    const result = await createRepairCaseFlowchartNode({
      repairCaseId,
      flowchartId: flowchart.id,
      actorUserId: engineer2Id,
      nodeType: "TASK",
      title: "노드",
      description: null,
      expectedFlowchartUpdatedAt: flowchart.updatedAt,
    });
    assert.equal(result.ok, true, JSON.stringify(result));
  });

  test("SALES and INVENTORY_MANAGER are denied", async () => {
    const repairCaseId = await createTestRepairCase();
    const flowchart = await createTestFlowchart(repairCaseId);
    for (const actorUserId of [salesId, inventoryManagerId]) {
      const result = await createRepairCaseFlowchartNode({
        repairCaseId,
        flowchartId: flowchart.id,
        actorUserId,
        nodeType: "TASK",
        title: "노드",
        description: null,
        expectedFlowchartUpdatedAt: flowchart.updatedAt,
      });
      assert.equal(result.ok, false);
      if (!result.ok) assert.equal(result.code, "FORBIDDEN");
    }
  });

  test("shipment-lock removal policy: a locked (shipped) case no longer blocks node creation", async () => {
    const repairCaseId = await createTestRepairCase();
    const flowchart = await createTestFlowchart(repairCaseId);
    await lockCase(repairCaseId);
    const result = await createRepairCaseFlowchartNode({
      repairCaseId,
      flowchartId: flowchart.id,
      actorUserId: superAdminId,
      nodeType: "TASK",
      title: "노드",
      description: null,
      expectedFlowchartUpdatedAt: flowchart.updatedAt,
    });
    assert.equal(result.ok, true, JSON.stringify(result));
  });

  test("a stale expectedFlowchartUpdatedAt is rejected atomically", async () => {
    const repairCaseId = await createTestRepairCase();
    const flowchart = await createTestFlowchart(repairCaseId);
    const stale = new Date(new Date(flowchart.updatedAt).getTime() - 1000).toISOString();
    const result = await createRepairCaseFlowchartNode({
      repairCaseId,
      flowchartId: flowchart.id,
      actorUserId: superAdminId,
      nodeType: "TASK",
      title: "노드",
      description: null,
      expectedFlowchartUpdatedAt: stale,
    });
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.code, "STALE_REVISION");

    const nodes = await db.select().from(repairCaseFlowchartNodes).where(eq(repairCaseFlowchartNodes.flowchartId, flowchart.id));
    assert.equal(nodes.length, 0);
    const history = await db.select().from(repairCaseFlowchartEditHistory).where(eq(repairCaseFlowchartEditHistory.flowchartId, flowchart.id));
    // 1, not 0: createTestFlowchart's own CREATE_FLOWCHART row (6B) already
    // exists under this flowchartId — the rejected node-create attempt must
    // add nothing on top of it.
    assert.equal(history.length, 1, "a rejected mutation must write no additional history");
  });
});

describe("updateRepairCaseFlowchartNode", () => {
  test("persists title/description/instructions and reports changed:true", async () => {
    const repairCaseId = await createTestRepairCase();
    const flowchart = await createTestFlowchart(repairCaseId);
    const node = await mustCreateNode({ repairCaseId, flowchartId: flowchart.id, actorUserId: superAdminId, title: "원래 제목", expectedFlowchartUpdatedAt: flowchart.updatedAt });

    const result = await updateRepairCaseFlowchartNode({
      repairCaseId,
      flowchartId: flowchart.id,
      nodeId: node.nodeId,
      actorUserId: superAdminId,
      title: "새 제목",
      description: "새 설명",
      instructions: "새 작업 지시 요약",
      expectedFlowchartUpdatedAt: node.updatedAt,
    });
    assert.equal(result.ok, true, JSON.stringify(result));
    if (!result.ok) throw new Error("unreachable");
    assert.equal(result.changed, true);

    const [row] = await db.select().from(repairCaseFlowchartNodes).where(eq(repairCaseFlowchartNodes.id, node.nodeId));
    assert.equal(row.title, "새 제목");
    assert.equal(row.description, "새 설명");
    assert.equal(row.instructions, "새 작업 지시 요약");
  });

  test("instructions-only change (title/description unchanged) still persists and reports changed:true", async () => {
    const repairCaseId = await createTestRepairCase();
    const flowchart = await createTestFlowchart(repairCaseId);
    const node = await mustCreateNode({ repairCaseId, flowchartId: flowchart.id, actorUserId: superAdminId, title: "제목", expectedFlowchartUpdatedAt: flowchart.updatedAt });

    const result = await updateRepairCaseFlowchartNode({
      repairCaseId,
      flowchartId: flowchart.id,
      nodeId: node.nodeId,
      actorUserId: superAdminId,
      title: "제목",
      description: null,
      instructions: "지시 요약만 변경",
      expectedFlowchartUpdatedAt: node.updatedAt,
    });
    assert.equal(result.ok, true, JSON.stringify(result));
    if (!result.ok) throw new Error("unreachable");
    assert.equal(result.changed, true);

    const [row] = await db.select().from(repairCaseFlowchartNodes).where(eq(repairCaseFlowchartNodes.id, node.nodeId));
    assert.equal(row.instructions, "지시 요약만 변경");
  });

  test("a no-op update (including instructions) writes no history and returns changed:false", async () => {
    const repairCaseId = await createTestRepairCase();
    const flowchart = await createTestFlowchart(repairCaseId);
    const node = await mustCreateNode({ repairCaseId, flowchartId: flowchart.id, actorUserId: superAdminId, title: "동일 제목", expectedFlowchartUpdatedAt: flowchart.updatedAt });

    const historyBefore = await db.select({ id: repairCaseFlowchartEditHistory.id }).from(repairCaseFlowchartEditHistory).where(eq(repairCaseFlowchartEditHistory.nodeId, node.nodeId));

    const result = await updateRepairCaseFlowchartNode({
      repairCaseId,
      flowchartId: flowchart.id,
      nodeId: node.nodeId,
      actorUserId: superAdminId,
      title: "동일 제목",
      description: null,
      instructions: null,
      expectedFlowchartUpdatedAt: node.updatedAt,
    });
    assert.equal(result.ok, true);
    if (!result.ok) throw new Error("unreachable");
    assert.equal(result.changed, false);

    const historyAfter = await db.select({ id: repairCaseFlowchartEditHistory.id }).from(repairCaseFlowchartEditHistory).where(eq(repairCaseFlowchartEditHistory.nodeId, node.nodeId));
    assert.equal(historyAfter.length, historyBefore.length);
  });
});

describe("changeRepairCaseFlowchartNodeType", () => {
  test("changes the node type and reports changed:true", async () => {
    const repairCaseId = await createTestRepairCase();
    const flowchart = await createTestFlowchart(repairCaseId);
    const node = await mustCreateNode({ repairCaseId, flowchartId: flowchart.id, actorUserId: superAdminId, expectedFlowchartUpdatedAt: flowchart.updatedAt });

    const result = await changeRepairCaseFlowchartNodeType({
      repairCaseId,
      flowchartId: flowchart.id,
      nodeId: node.nodeId,
      actorUserId: superAdminId,
      nodeType: "DECISION",
      expectedFlowchartUpdatedAt: node.updatedAt,
    });
    assert.equal(result.ok, true, JSON.stringify(result));
    if (!result.ok) throw new Error("unreachable");
    assert.equal(result.changed, true);

    const [row] = await db.select().from(repairCaseFlowchartNodes).where(eq(repairCaseFlowchartNodes.id, node.nodeId));
    assert.equal(row.nodeType, "DECISION");
  });

  test("a no-op type change (same type) writes no history", async () => {
    const repairCaseId = await createTestRepairCase();
    const flowchart = await createTestFlowchart(repairCaseId);
    const node = await mustCreateNode({ repairCaseId, flowchartId: flowchart.id, actorUserId: superAdminId, expectedFlowchartUpdatedAt: flowchart.updatedAt });

    const historyBefore = await db.select({ id: repairCaseFlowchartEditHistory.id }).from(repairCaseFlowchartEditHistory).where(eq(repairCaseFlowchartEditHistory.nodeId, node.nodeId));

    const result = await changeRepairCaseFlowchartNodeType({
      repairCaseId,
      flowchartId: flowchart.id,
      nodeId: node.nodeId,
      actorUserId: superAdminId,
      nodeType: "TASK",
      expectedFlowchartUpdatedAt: node.updatedAt,
    });
    assert.equal(result.ok, true);
    if (!result.ok) throw new Error("unreachable");
    assert.equal(result.changed, false);

    const historyAfter = await db.select({ id: repairCaseFlowchartEditHistory.id }).from(repairCaseFlowchartEditHistory).where(eq(repairCaseFlowchartEditHistory.nodeId, node.nodeId));
    assert.equal(historyAfter.length, historyBefore.length);
  });
});

describe("saveRepairCaseFlowchartLayout", () => {
  test("persists only changed positions under one SAVE_LAYOUT group", async () => {
    const repairCaseId = await createTestRepairCase();
    const flowchart = await createTestFlowchart(repairCaseId);
    const nodeA = await mustCreateNode({ repairCaseId, flowchartId: flowchart.id, actorUserId: superAdminId, title: "A", expectedFlowchartUpdatedAt: flowchart.updatedAt });
    const nodeB = await mustCreateNode({ repairCaseId, flowchartId: flowchart.id, actorUserId: superAdminId, title: "B", expectedFlowchartUpdatedAt: nodeA.updatedAt });

    const result = await saveRepairCaseFlowchartLayout({
      repairCaseId,
      flowchartId: flowchart.id,
      actorUserId: superAdminId,
      positions: [
        { id: nodeA.nodeId, positionX: 500, positionY: 500 },
        { id: nodeB.nodeId, positionX: 0, positionY: 150 }, // unchanged from creation default
      ],
      expectedFlowchartUpdatedAt: nodeB.updatedAt,
    });
    assert.equal(result.ok, true, JSON.stringify(result));
    if (!result.ok) throw new Error("unreachable");
    assert.equal(result.changed, true);

    const [rowA] = await db.select().from(repairCaseFlowchartNodes).where(eq(repairCaseFlowchartNodes.id, nodeA.nodeId));
    assert.equal(rowA.positionX, 500);
    assert.equal(rowA.positionY, 500);

    const historyRows = await db
      .select()
      .from(repairCaseFlowchartEditHistory)
      .where(and(eq(repairCaseFlowchartEditHistory.flowchartId, flowchart.id), eq(repairCaseFlowchartEditHistory.actionType, "SAVE_LAYOUT")));
    assert.equal(historyRows.length, 1, "one SAVE_LAYOUT row per call, regardless of how many positions changed");
    const afterState = historyRows[0].afterState as { id: string }[];
    assert.equal(afterState.length, 1, "only the actually-changed node appears in the payload");
    assert.equal(afterState[0].id, nodeA.nodeId);
  });

  test("no position changes -> no-op, no history", async () => {
    const repairCaseId = await createTestRepairCase();
    const flowchart = await createTestFlowchart(repairCaseId);
    const node = await mustCreateNode({ repairCaseId, flowchartId: flowchart.id, actorUserId: superAdminId, expectedFlowchartUpdatedAt: flowchart.updatedAt });

    const result = await saveRepairCaseFlowchartLayout({
      repairCaseId,
      flowchartId: flowchart.id,
      actorUserId: superAdminId,
      positions: [{ id: node.nodeId, positionX: 0, positionY: 0 }],
      expectedFlowchartUpdatedAt: node.updatedAt,
    });
    assert.equal(result.ok, true);
    if (!result.ok) throw new Error("unreachable");
    assert.equal(result.changed, false);

    const historyRows = await db
      .select()
      .from(repairCaseFlowchartEditHistory)
      .where(and(eq(repairCaseFlowchartEditHistory.flowchartId, flowchart.id), eq(repairCaseFlowchartEditHistory.actionType, "SAVE_LAYOUT")));
    assert.equal(historyRows.length, 0);
  });
});

describe("deleteRepairCaseFlowchartNode", () => {
  test("deletes an unconnected node", async () => {
    const repairCaseId = await createTestRepairCase();
    const flowchart = await createTestFlowchart(repairCaseId);
    const node = await mustCreateNode({ repairCaseId, flowchartId: flowchart.id, actorUserId: superAdminId, expectedFlowchartUpdatedAt: flowchart.updatedAt });

    const result = await deleteRepairCaseFlowchartNode({
      repairCaseId,
      flowchartId: flowchart.id,
      nodeId: node.nodeId,
      actorUserId: superAdminId,
      expectedFlowchartUpdatedAt: node.updatedAt,
    });
    assert.equal(result.ok, true, JSON.stringify(result));

    const remaining = await db.select().from(repairCaseFlowchartNodes).where(eq(repairCaseFlowchartNodes.id, node.nodeId));
    assert.equal(remaining.length, 0);
  });

  test("a connected node's delete fails with structured NODE_HAS_CONNECTED_EDGES, leaving node/edges unchanged", async () => {
    const repairCaseId = await createTestRepairCase();
    const flowchart = await createTestFlowchart(repairCaseId);
    const nodeA = await mustCreateNode({ repairCaseId, flowchartId: flowchart.id, actorUserId: superAdminId, title: "A", expectedFlowchartUpdatedAt: flowchart.updatedAt });
    const nodeB = await mustCreateNode({ repairCaseId, flowchartId: flowchart.id, actorUserId: superAdminId, title: "B", expectedFlowchartUpdatedAt: nodeA.updatedAt });
    const edge = await mustCreateEdge({ repairCaseId, flowchartId: flowchart.id, actorUserId: superAdminId, fromNodeId: nodeA.nodeId, toNodeId: nodeB.nodeId, expectedFlowchartUpdatedAt: nodeB.updatedAt });

    const result = await deleteRepairCaseFlowchartNode({
      repairCaseId,
      flowchartId: flowchart.id,
      nodeId: nodeA.nodeId,
      actorUserId: superAdminId,
      expectedFlowchartUpdatedAt: edge.updatedAt,
    });
    assert.equal(result.ok, false);
    if (!result.ok && result.code === "NODE_HAS_CONNECTED_EDGES") {
      assert.equal(result.blockingEdgeCount, 1);
      assert.deepEqual(result.blockingEdgeIds, [edge.edgeId]);
    } else {
      assert.fail(`expected NODE_HAS_CONNECTED_EDGES, got ${JSON.stringify(result)}`);
    }

    const remainingNode = await db.select().from(repairCaseFlowchartNodes).where(eq(repairCaseFlowchartNodes.id, nodeA.nodeId));
    assert.equal(remainingNode.length, 1);
    const remainingEdge = await db.select().from(repairCaseFlowchartEdges).where(eq(repairCaseFlowchartEdges.id, edge.edgeId));
    assert.equal(remainingEdge.length, 1);
  });
});

// =====================================================================
// EDGE
// =====================================================================

describe("createRepairCaseFlowchartEdge", () => {
  test("creates an edge between two nodes in the same flowchart", async () => {
    const repairCaseId = await createTestRepairCase();
    const flowchart = await createTestFlowchart(repairCaseId);
    const nodeA = await mustCreateNode({ repairCaseId, flowchartId: flowchart.id, actorUserId: superAdminId, title: "A", expectedFlowchartUpdatedAt: flowchart.updatedAt });
    const nodeB = await mustCreateNode({ repairCaseId, flowchartId: flowchart.id, actorUserId: superAdminId, title: "B", expectedFlowchartUpdatedAt: nodeA.updatedAt });

    const result = await createRepairCaseFlowchartEdge({
      repairCaseId,
      flowchartId: flowchart.id,
      actorUserId: superAdminId,
      fromNodeId: nodeA.nodeId,
      toNodeId: nodeB.nodeId,
      branchType: "DEFAULT",
      branchLabel: null,
      expectedFlowchartUpdatedAt: nodeB.updatedAt,
    });
    assert.equal(result.ok, true, JSON.stringify(result));
  });

  test("a self-edge is rejected", async () => {
    const repairCaseId = await createTestRepairCase();
    const flowchart = await createTestFlowchart(repairCaseId);
    const node = await mustCreateNode({ repairCaseId, flowchartId: flowchart.id, actorUserId: superAdminId, expectedFlowchartUpdatedAt: flowchart.updatedAt });

    const result = await createRepairCaseFlowchartEdge({
      repairCaseId,
      flowchartId: flowchart.id,
      actorUserId: superAdminId,
      fromNodeId: node.nodeId,
      toNodeId: node.nodeId,
      branchType: "DEFAULT",
      branchLabel: null,
      expectedFlowchartUpdatedAt: node.updatedAt,
    });
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.code, "SELF_EDGE");
  });

  test("a duplicate (from, to, branchType) edge is rejected", async () => {
    const repairCaseId = await createTestRepairCase();
    const flowchart = await createTestFlowchart(repairCaseId);
    const nodeA = await mustCreateNode({ repairCaseId, flowchartId: flowchart.id, actorUserId: superAdminId, title: "A", expectedFlowchartUpdatedAt: flowchart.updatedAt });
    const nodeB = await mustCreateNode({ repairCaseId, flowchartId: flowchart.id, actorUserId: superAdminId, title: "B", expectedFlowchartUpdatedAt: nodeA.updatedAt });
    const edge = await mustCreateEdge({ repairCaseId, flowchartId: flowchart.id, actorUserId: superAdminId, fromNodeId: nodeA.nodeId, toNodeId: nodeB.nodeId, expectedFlowchartUpdatedAt: nodeB.updatedAt });

    const result = await createRepairCaseFlowchartEdge({
      repairCaseId,
      flowchartId: flowchart.id,
      actorUserId: superAdminId,
      fromNodeId: nodeA.nodeId,
      toNodeId: nodeB.nodeId,
      branchType: "DEFAULT",
      branchLabel: null,
      expectedFlowchartUpdatedAt: edge.updatedAt,
    });
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.code, "DUPLICATE_EDGE");
  });

  test("CUSTOM branch type requires a non-blank branchLabel", async () => {
    const repairCaseId = await createTestRepairCase();
    const flowchart = await createTestFlowchart(repairCaseId);
    const nodeA = await mustCreateNode({ repairCaseId, flowchartId: flowchart.id, actorUserId: superAdminId, title: "A", expectedFlowchartUpdatedAt: flowchart.updatedAt });
    const nodeB = await mustCreateNode({ repairCaseId, flowchartId: flowchart.id, actorUserId: superAdminId, title: "B", expectedFlowchartUpdatedAt: nodeA.updatedAt });

    const result = await createRepairCaseFlowchartEdge({
      repairCaseId,
      flowchartId: flowchart.id,
      actorUserId: superAdminId,
      fromNodeId: nodeA.nodeId,
      toNodeId: nodeB.nodeId,
      branchType: "CUSTOM",
      branchLabel: null,
      expectedFlowchartUpdatedAt: nodeB.updatedAt,
    });
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.code, "INVALID_INPUT");
  });
});

describe("updateRepairCaseFlowchartEdge", () => {
  test("persists branchType/branchLabel and reports changed:true (ADMIN)", async () => {
    const repairCaseId = await createTestRepairCase();
    const flowchart = await createTestFlowchart(repairCaseId);
    const nodeA = await mustCreateNode({ repairCaseId, flowchartId: flowchart.id, actorUserId: superAdminId, title: "A", expectedFlowchartUpdatedAt: flowchart.updatedAt });
    const nodeB = await mustCreateNode({ repairCaseId, flowchartId: flowchart.id, actorUserId: superAdminId, title: "B", expectedFlowchartUpdatedAt: nodeA.updatedAt });
    const edge = await mustCreateEdge({ repairCaseId, flowchartId: flowchart.id, actorUserId: superAdminId, fromNodeId: nodeA.nodeId, toNodeId: nodeB.nodeId, expectedFlowchartUpdatedAt: nodeB.updatedAt });

    const result = await updateRepairCaseFlowchartEdge({
      repairCaseId,
      flowchartId: flowchart.id,
      edgeId: edge.edgeId,
      actorUserId: adminId,
      branchType: "YES",
      branchLabel: "예",
      expectedFlowchartUpdatedAt: edge.updatedAt,
    });
    assert.equal(result.ok, true, JSON.stringify(result));
    if (!result.ok) throw new Error("unreachable");
    assert.equal(result.changed, true);

    const [row] = await db.select().from(repairCaseFlowchartEdges).where(eq(repairCaseFlowchartEdges.id, edge.edgeId));
    assert.equal(row.branchType, "YES");
    assert.equal(row.branchLabel, "예");
  });

  test("a no-op update writes no history", async () => {
    const repairCaseId = await createTestRepairCase();
    const flowchart = await createTestFlowchart(repairCaseId);
    const nodeA = await mustCreateNode({ repairCaseId, flowchartId: flowchart.id, actorUserId: superAdminId, title: "A", expectedFlowchartUpdatedAt: flowchart.updatedAt });
    const nodeB = await mustCreateNode({ repairCaseId, flowchartId: flowchart.id, actorUserId: superAdminId, title: "B", expectedFlowchartUpdatedAt: nodeA.updatedAt });
    const edge = await mustCreateEdge({ repairCaseId, flowchartId: flowchart.id, actorUserId: superAdminId, fromNodeId: nodeA.nodeId, toNodeId: nodeB.nodeId, expectedFlowchartUpdatedAt: nodeB.updatedAt });

    const historyBefore = await db.select({ id: repairCaseFlowchartEditHistory.id }).from(repairCaseFlowchartEditHistory).where(eq(repairCaseFlowchartEditHistory.edgeId, edge.edgeId));

    const result = await updateRepairCaseFlowchartEdge({
      repairCaseId,
      flowchartId: flowchart.id,
      edgeId: edge.edgeId,
      actorUserId: superAdminId,
      branchType: "DEFAULT",
      branchLabel: null,
      expectedFlowchartUpdatedAt: edge.updatedAt,
    });
    assert.equal(result.ok, true);
    if (!result.ok) throw new Error("unreachable");
    assert.equal(result.changed, false);

    const historyAfter = await db.select({ id: repairCaseFlowchartEditHistory.id }).from(repairCaseFlowchartEditHistory).where(eq(repairCaseFlowchartEditHistory.edgeId, edge.edgeId));
    assert.equal(historyAfter.length, historyBefore.length);
  });
});

describe("retargetRepairCaseFlowchartEdge", () => {
  test("changes fromNodeId/toNodeId, preserving branchType/branchLabel", async () => {
    const repairCaseId = await createTestRepairCase();
    const flowchart = await createTestFlowchart(repairCaseId);
    const nodeA = await mustCreateNode({ repairCaseId, flowchartId: flowchart.id, actorUserId: superAdminId, title: "A", expectedFlowchartUpdatedAt: flowchart.updatedAt });
    const nodeB = await mustCreateNode({ repairCaseId, flowchartId: flowchart.id, actorUserId: superAdminId, title: "B", expectedFlowchartUpdatedAt: nodeA.updatedAt });
    const nodeC = await mustCreateNode({ repairCaseId, flowchartId: flowchart.id, actorUserId: superAdminId, title: "C", expectedFlowchartUpdatedAt: nodeB.updatedAt });
    const edge = await mustCreateEdge({ repairCaseId, flowchartId: flowchart.id, actorUserId: superAdminId, fromNodeId: nodeA.nodeId, toNodeId: nodeB.nodeId, expectedFlowchartUpdatedAt: nodeC.updatedAt });

    const result = await retargetRepairCaseFlowchartEdge({
      repairCaseId,
      flowchartId: flowchart.id,
      edgeId: edge.edgeId,
      actorUserId: superAdminId,
      newFromNodeId: nodeA.nodeId,
      newToNodeId: nodeC.nodeId,
      expectedFlowchartUpdatedAt: edge.updatedAt,
    });
    assert.equal(result.ok, true, JSON.stringify(result));

    const [row] = await db.select().from(repairCaseFlowchartEdges).where(eq(repairCaseFlowchartEdges.id, edge.edgeId));
    assert.equal(row.toNodeId, nodeC.nodeId);
    assert.equal(row.branchType, "DEFAULT");
  });
});

describe("deleteRepairCaseFlowchartEdge", () => {
  test("deletes the edge", async () => {
    const repairCaseId = await createTestRepairCase();
    const flowchart = await createTestFlowchart(repairCaseId);
    const nodeA = await mustCreateNode({ repairCaseId, flowchartId: flowchart.id, actorUserId: superAdminId, title: "A", expectedFlowchartUpdatedAt: flowchart.updatedAt });
    const nodeB = await mustCreateNode({ repairCaseId, flowchartId: flowchart.id, actorUserId: superAdminId, title: "B", expectedFlowchartUpdatedAt: nodeA.updatedAt });
    const edge = await mustCreateEdge({ repairCaseId, flowchartId: flowchart.id, actorUserId: superAdminId, fromNodeId: nodeA.nodeId, toNodeId: nodeB.nodeId, expectedFlowchartUpdatedAt: nodeB.updatedAt });

    const result = await deleteRepairCaseFlowchartEdge({
      repairCaseId,
      flowchartId: flowchart.id,
      edgeId: edge.edgeId,
      actorUserId: superAdminId,
      expectedFlowchartUpdatedAt: edge.updatedAt,
    });
    assert.equal(result.ok, true, JSON.stringify(result));

    const remaining = await db.select().from(repairCaseFlowchartEdges).where(eq(repairCaseFlowchartEdges.id, edge.edgeId));
    assert.equal(remaining.length, 0);
  });

  test("unauthorized actor (SALES) is denied", async () => {
    const repairCaseId = await createTestRepairCase();
    const flowchart = await createTestFlowchart(repairCaseId);
    const nodeA = await mustCreateNode({ repairCaseId, flowchartId: flowchart.id, actorUserId: superAdminId, title: "A", expectedFlowchartUpdatedAt: flowchart.updatedAt });
    const nodeB = await mustCreateNode({ repairCaseId, flowchartId: flowchart.id, actorUserId: superAdminId, title: "B", expectedFlowchartUpdatedAt: nodeA.updatedAt });
    const edge = await mustCreateEdge({ repairCaseId, flowchartId: flowchart.id, actorUserId: superAdminId, fromNodeId: nodeA.nodeId, toNodeId: nodeB.nodeId, expectedFlowchartUpdatedAt: nodeB.updatedAt });

    const result = await deleteRepairCaseFlowchartEdge({
      repairCaseId,
      flowchartId: flowchart.id,
      edgeId: edge.edgeId,
      actorUserId: salesId,
      expectedFlowchartUpdatedAt: edge.updatedAt,
    });
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.code, "FORBIDDEN");
  });
});

// =====================================================================
// HISTORY
// =====================================================================

describe("repair_case_flowchart_edit_history writes for graph mutations", () => {
  test("every graph action type writes exactly one USER_EDIT group with a DB-generated, orderable sequenceNumber", async () => {
    const repairCaseId = await createTestRepairCase();
    const flowchart = await createTestFlowchart(repairCaseId);

    const nodeA = await mustCreateNode({ repairCaseId, flowchartId: flowchart.id, actorUserId: superAdminId, title: "A", expectedFlowchartUpdatedAt: flowchart.updatedAt });
    const nodeB = await mustCreateNode({ repairCaseId, flowchartId: flowchart.id, actorUserId: superAdminId, title: "B", expectedFlowchartUpdatedAt: nodeA.updatedAt });

    const updateResult = await updateRepairCaseFlowchartNode({ repairCaseId, flowchartId: flowchart.id, nodeId: nodeA.nodeId, actorUserId: superAdminId, title: "A 변경", description: null, instructions: "작업 지시 요약", expectedFlowchartUpdatedAt: nodeB.updatedAt });
    assert.equal(updateResult.ok, true);
    if (!updateResult.ok) throw new Error("unreachable");

    const typeResult = await changeRepairCaseFlowchartNodeType({ repairCaseId, flowchartId: flowchart.id, nodeId: nodeA.nodeId, actorUserId: superAdminId, nodeType: "DECISION", expectedFlowchartUpdatedAt: updateResult.updatedAt });
    assert.equal(typeResult.ok, true);
    if (!typeResult.ok) throw new Error("unreachable");

    const edgeResult = await mustCreateEdge({ repairCaseId, flowchartId: flowchart.id, actorUserId: superAdminId, fromNodeId: nodeA.nodeId, toNodeId: nodeB.nodeId, expectedFlowchartUpdatedAt: typeResult.updatedAt });

    const edgeUpdateResult = await updateRepairCaseFlowchartEdge({ repairCaseId, flowchartId: flowchart.id, edgeId: edgeResult.edgeId, actorUserId: superAdminId, branchType: "YES", branchLabel: "예", expectedFlowchartUpdatedAt: edgeResult.updatedAt });
    assert.equal(edgeUpdateResult.ok, true);
    if (!edgeUpdateResult.ok) throw new Error("unreachable");

    const deleteEdgeResult = await deleteRepairCaseFlowchartEdge({ repairCaseId, flowchartId: flowchart.id, edgeId: edgeResult.edgeId, actorUserId: superAdminId, expectedFlowchartUpdatedAt: edgeUpdateResult.updatedAt });
    assert.equal(deleteEdgeResult.ok, true);
    if (!deleteEdgeResult.ok) throw new Error("unreachable");

    const deleteNodeResult = await deleteRepairCaseFlowchartNode({ repairCaseId, flowchartId: flowchart.id, nodeId: nodeA.nodeId, actorUserId: superAdminId, expectedFlowchartUpdatedAt: deleteEdgeResult.updatedAt });
    assert.equal(deleteNodeResult.ok, true);

    const rows = await db
      .select()
      .from(repairCaseFlowchartEditHistory)
      .where(eq(repairCaseFlowchartEditHistory.flowchartId, flowchart.id))
      .orderBy(repairCaseFlowchartEditHistory.sequenceNumber);

    const actionTypes = rows.map((r) => r.actionType);
    assert.deepEqual(actionTypes, [
      "CREATE_FLOWCHART", // written by createTestFlowchart itself (6B)
      "CREATE_NODE",
      "CREATE_NODE",
      "UPDATE_NODE",
      "CHANGE_NODE_TYPE",
      "CREATE_EDGE",
      "UPDATE_EDGE",
      "DELETE_EDGE",
      "DELETE_NODE",
    ]);

    for (const row of rows) {
      assert.equal(row.origin, "USER_EDIT");
      assert.equal(row.sourceGroupId, null);
      assert.equal(row.restoreTargetGroupId, null);
    }

    const changeGroupIds = new Set(rows.map((r) => r.changeGroupId));
    assert.equal(changeGroupIds.size, rows.length, "each logical action must have its own change_group_id");

    const sequenceNumbers = rows.map((r) => r.sequenceNumber);
    assert.deepEqual(sequenceNumbers, [...sequenceNumbers].sort((a, b) => a - b));
    assert.equal(new Set(sequenceNumbers).size, sequenceNumbers.length);

    // 6E replay must be able to recover instructions from a flat before/afterState snapshot — UPDATE_NODE included.
    const [updateNodeRow] = rows.filter((r) => r.actionType === "UPDATE_NODE");
    assert.equal((updateNodeRow.beforeState as { instructions: string | null }).instructions, null);
    assert.equal((updateNodeRow.afterState as { instructions: string | null }).instructions, "작업 지시 요약");

    // DELETE_NODE's beforeState is the full node snapshot (serializeNodeSnapshot) — instructions must be present, reflecting the UPDATE_NODE that ran just before it.
    const [deleteNodeRow] = rows.filter((r) => r.actionType === "DELETE_NODE");
    assert.equal((deleteNodeRow.beforeState as { instructions: string | null }).instructions, "작업 지시 요약");
  });

  test("DELETE_NODE history survives with node_id NULL, DELETE_EDGE history survives with edge_id NULL", async () => {
    const repairCaseId = await createTestRepairCase();
    const flowchart = await createTestFlowchart(repairCaseId);
    const nodeA = await mustCreateNode({ repairCaseId, flowchartId: flowchart.id, actorUserId: superAdminId, title: "A", expectedFlowchartUpdatedAt: flowchart.updatedAt });
    const nodeB = await mustCreateNode({ repairCaseId, flowchartId: flowchart.id, actorUserId: superAdminId, title: "B", expectedFlowchartUpdatedAt: nodeA.updatedAt });
    const edge = await mustCreateEdge({ repairCaseId, flowchartId: flowchart.id, actorUserId: superAdminId, fromNodeId: nodeA.nodeId, toNodeId: nodeB.nodeId, expectedFlowchartUpdatedAt: nodeB.updatedAt });

    const deleteEdgeResult = await deleteRepairCaseFlowchartEdge({ repairCaseId, flowchartId: flowchart.id, edgeId: edge.edgeId, actorUserId: superAdminId, expectedFlowchartUpdatedAt: edge.updatedAt });
    assert.equal(deleteEdgeResult.ok, true);
    if (!deleteEdgeResult.ok) throw new Error("unreachable");

    const deleteNodeResult = await deleteRepairCaseFlowchartNode({ repairCaseId, flowchartId: flowchart.id, nodeId: nodeA.nodeId, actorUserId: superAdminId, expectedFlowchartUpdatedAt: deleteEdgeResult.updatedAt });
    assert.equal(deleteNodeResult.ok, true);

    const [edgeHistory] = await db.select().from(repairCaseFlowchartEditHistory).where(and(eq(repairCaseFlowchartEditHistory.actionType, "DELETE_EDGE"), eq(repairCaseFlowchartEditHistory.flowchartId, flowchart.id)));
    assert.ok(edgeHistory);
    assert.equal(edgeHistory.edgeId, null);
    assert.equal((edgeHistory.beforeState as { id: string }).id, edge.edgeId);

    const [nodeHistory] = await db.select().from(repairCaseFlowchartEditHistory).where(and(eq(repairCaseFlowchartEditHistory.actionType, "DELETE_NODE"), eq(repairCaseFlowchartEditHistory.flowchartId, flowchart.id)));
    assert.ok(nodeHistory);
    assert.equal(nodeHistory.nodeId, null);
    assert.equal((nodeHistory.beforeState as { id: string }).id, nodeA.nodeId);
  });
});

// =====================================================================
// CROSS-FLOWCHART / IDOR DEFENSE (5C-6C §15)
// =====================================================================

describe("cross-flowchart (IDOR) defense", () => {
  test("update/delete/create-edge/retarget/save-layout targeting a sibling flowchart's node all fail without modifying data or history", async () => {
    const repairCaseId = await createTestRepairCase();
    const flowchartA = await createTestFlowchart(repairCaseId, superAdminId);
    const flowchartB = await createTestFlowchart(repairCaseId, superAdminId);

    const a1 = await mustCreateNode({ repairCaseId, flowchartId: flowchartA.id, actorUserId: superAdminId, title: "A1", expectedFlowchartUpdatedAt: flowchartA.updatedAt });
    const a2 = await mustCreateNode({ repairCaseId, flowchartId: flowchartA.id, actorUserId: superAdminId, title: "A2", expectedFlowchartUpdatedAt: a1.updatedAt });
    const edgeA = await mustCreateEdge({ repairCaseId, flowchartId: flowchartA.id, actorUserId: superAdminId, fromNodeId: a1.nodeId, toNodeId: a2.nodeId, expectedFlowchartUpdatedAt: a2.updatedAt });
    const b1 = await mustCreateNode({ repairCaseId, flowchartId: flowchartB.id, actorUserId: superAdminId, title: "B1", expectedFlowchartUpdatedAt: flowchartB.updatedAt });

    const [flowchartARow] = await db.select().from(repairCaseFlowcharts).where(eq(repairCaseFlowcharts.id, flowchartA.id));
    const currentAUpdatedAt = flowchartARow.updatedAt.toISOString();

    const historyBefore = await db.select({ id: repairCaseFlowchartEditHistory.id }).from(repairCaseFlowchartEditHistory).where(eq(repairCaseFlowchartEditHistory.flowchartId, flowchartA.id));

    // 1. update B1 through Flowchart A
    const updateResult = await updateRepairCaseFlowchartNode({ repairCaseId, flowchartId: flowchartA.id, nodeId: b1.nodeId, actorUserId: superAdminId, title: "가로채기", description: null, instructions: null, expectedFlowchartUpdatedAt: currentAUpdatedAt });
    assert.equal(updateResult.ok, false);
    if (!updateResult.ok) assert.equal(updateResult.code, "CROSS_FLOWCHART");

    // 2. delete B1 through Flowchart A
    const deleteResult = await deleteRepairCaseFlowchartNode({ repairCaseId, flowchartId: flowchartA.id, nodeId: b1.nodeId, actorUserId: superAdminId, expectedFlowchartUpdatedAt: currentAUpdatedAt });
    assert.equal(deleteResult.ok, false);
    if (!deleteResult.ok) assert.equal(deleteResult.code, "CROSS_FLOWCHART");

    // 3. create an A edge targeting B1
    const createEdgeResult = await createRepairCaseFlowchartEdge({
      repairCaseId,
      flowchartId: flowchartA.id,
      actorUserId: superAdminId,
      fromNodeId: a1.nodeId,
      toNodeId: b1.nodeId,
      branchType: "DEFAULT",
      branchLabel: null,
      expectedFlowchartUpdatedAt: currentAUpdatedAt,
    });
    assert.equal(createEdgeResult.ok, false);
    if (!createEdgeResult.ok) assert.equal(createEdgeResult.code, "CROSS_FLOWCHART");

    // 4. retarget an A edge to B1
    const retargetResult = await retargetRepairCaseFlowchartEdge({
      repairCaseId,
      flowchartId: flowchartA.id,
      edgeId: edgeA.edgeId,
      actorUserId: superAdminId,
      newFromNodeId: a1.nodeId,
      newToNodeId: b1.nodeId,
      expectedFlowchartUpdatedAt: currentAUpdatedAt,
    });
    assert.equal(retargetResult.ok, false);
    if (!retargetResult.ok) assert.equal(retargetResult.code, "CROSS_FLOWCHART");

    // 5. save layout with B1 inside A's payload
    const layoutResult = await saveRepairCaseFlowchartLayout({
      repairCaseId,
      flowchartId: flowchartA.id,
      actorUserId: superAdminId,
      positions: [{ id: b1.nodeId, positionX: 999, positionY: 999 }],
      expectedFlowchartUpdatedAt: currentAUpdatedAt,
    });
    assert.equal(layoutResult.ok, false);
    if (!layoutResult.ok) assert.equal(layoutResult.code, "NOT_FOUND");

    // Nothing changed: A's node/edge rows, B1's row, and A's history are all untouched.
    const [b1Row] = await db.select().from(repairCaseFlowchartNodes).where(eq(repairCaseFlowchartNodes.id, b1.nodeId));
    assert.equal(b1Row.title, "B1");
    assert.equal(b1Row.positionX, 0);
    const [edgeARow] = await db.select().from(repairCaseFlowchartEdges).where(eq(repairCaseFlowchartEdges.id, edgeA.edgeId));
    assert.equal(edgeARow.toNodeId, a2.nodeId);

    const historyAfter = await db.select({ id: repairCaseFlowchartEditHistory.id }).from(repairCaseFlowchartEditHistory).where(eq(repairCaseFlowchartEditHistory.flowchartId, flowchartA.id));
    assert.equal(historyAfter.length, historyBefore.length, "no rejected cross-flowchart attempt may write history");
  });
});

// =====================================================================
// EDGE ROUTING (5C-6D)
// =====================================================================

describe("saveRepairCaseFlowchartEdgeRoute", () => {
  test("persists an explicit waypoint chain and writes one SAVE_EDGE_ROUTE row", async () => {
    const repairCaseId = await createTestRepairCase();
    const flowchart = await createTestFlowchart(repairCaseId);
    const nodeA = await mustCreateNode({ repairCaseId, flowchartId: flowchart.id, actorUserId: superAdminId, title: "A", expectedFlowchartUpdatedAt: flowchart.updatedAt });
    const nodeB = await mustCreateNode({ repairCaseId, flowchartId: flowchart.id, actorUserId: superAdminId, title: "B", expectedFlowchartUpdatedAt: nodeA.updatedAt });
    const edge = await mustCreateEdge({ repairCaseId, flowchartId: flowchart.id, actorUserId: superAdminId, fromNodeId: nodeA.nodeId, toNodeId: nodeB.nodeId, expectedFlowchartUpdatedAt: nodeB.updatedAt });

    const result = await saveRepairCaseFlowchartEdgeRoute({
      repairCaseId,
      flowchartId: flowchart.id,
      edgeId: edge.edgeId,
      actorUserId: superAdminId,
      routePoints: [{ x: 100, y: 200 }, { x: 150, y: 250 }],
      expectedFlowchartUpdatedAt: edge.updatedAt,
    });
    assert.equal(result.ok, true, JSON.stringify(result));
    if (!result.ok) throw new Error("unreachable");
    assert.equal(result.changed, true);

    const [row] = await db.select().from(repairCaseFlowchartEdges).where(eq(repairCaseFlowchartEdges.id, edge.edgeId));
    assert.deepEqual(row.routePoints, [{ x: 100, y: 200 }, { x: 150, y: 250 }]);

    const historyRows = await db
      .select()
      .from(repairCaseFlowchartEditHistory)
      .where(and(eq(repairCaseFlowchartEditHistory.edgeId, edge.edgeId), eq(repairCaseFlowchartEditHistory.actionType, "SAVE_EDGE_ROUTE")));
    assert.equal(historyRows.length, 1);
  });

  test("null clears the route back to automatic routing", async () => {
    const repairCaseId = await createTestRepairCase();
    const flowchart = await createTestFlowchart(repairCaseId);
    const nodeA = await mustCreateNode({ repairCaseId, flowchartId: flowchart.id, actorUserId: superAdminId, title: "A", expectedFlowchartUpdatedAt: flowchart.updatedAt });
    const nodeB = await mustCreateNode({ repairCaseId, flowchartId: flowchart.id, actorUserId: superAdminId, title: "B", expectedFlowchartUpdatedAt: nodeA.updatedAt });
    const edge = await mustCreateEdge({ repairCaseId, flowchartId: flowchart.id, actorUserId: superAdminId, fromNodeId: nodeA.nodeId, toNodeId: nodeB.nodeId, expectedFlowchartUpdatedAt: nodeB.updatedAt });

    const setResult = await saveRepairCaseFlowchartEdgeRoute({
      repairCaseId,
      flowchartId: flowchart.id,
      edgeId: edge.edgeId,
      actorUserId: superAdminId,
      routePoints: [{ x: 10, y: 20 }],
      expectedFlowchartUpdatedAt: edge.updatedAt,
    });
    assert.equal(setResult.ok, true);
    if (!setResult.ok) throw new Error("unreachable");

    const clearResult = await saveRepairCaseFlowchartEdgeRoute({
      repairCaseId,
      flowchartId: flowchart.id,
      edgeId: edge.edgeId,
      actorUserId: superAdminId,
      routePoints: null,
      expectedFlowchartUpdatedAt: setResult.updatedAt,
    });
    assert.equal(clearResult.ok, true);

    const [row] = await db.select().from(repairCaseFlowchartEdges).where(eq(repairCaseFlowchartEdges.id, edge.edgeId));
    assert.equal(row.routePoints, null);
  });

  test("an unchanged route (same points) writes no history", async () => {
    const repairCaseId = await createTestRepairCase();
    const flowchart = await createTestFlowchart(repairCaseId);
    const nodeA = await mustCreateNode({ repairCaseId, flowchartId: flowchart.id, actorUserId: superAdminId, title: "A", expectedFlowchartUpdatedAt: flowchart.updatedAt });
    const nodeB = await mustCreateNode({ repairCaseId, flowchartId: flowchart.id, actorUserId: superAdminId, title: "B", expectedFlowchartUpdatedAt: nodeA.updatedAt });
    const edge = await mustCreateEdge({ repairCaseId, flowchartId: flowchart.id, actorUserId: superAdminId, fromNodeId: nodeA.nodeId, toNodeId: nodeB.nodeId, expectedFlowchartUpdatedAt: nodeB.updatedAt });

    const result = await saveRepairCaseFlowchartEdgeRoute({
      repairCaseId,
      flowchartId: flowchart.id,
      edgeId: edge.edgeId,
      actorUserId: superAdminId,
      routePoints: null,
      expectedFlowchartUpdatedAt: edge.updatedAt,
    });
    assert.equal(result.ok, true);
    if (!result.ok) throw new Error("unreachable");
    assert.equal(result.changed, false, "null -> null (no existing route) must be a no-op");

    const historyRows = await db
      .select()
      .from(repairCaseFlowchartEditHistory)
      .where(and(eq(repairCaseFlowchartEditHistory.edgeId, edge.edgeId), eq(repairCaseFlowchartEditHistory.actionType, "SAVE_EDGE_ROUTE")));
    assert.equal(historyRows.length, 0);
  });

  test("a mismatched flowchart is rejected with CROSS_FLOWCHART", async () => {
    const repairCaseId = await createTestRepairCase();
    const flowchartA = await createTestFlowchart(repairCaseId);
    const flowchartB = await createTestFlowchart(repairCaseId);
    const a1 = await mustCreateNode({ repairCaseId, flowchartId: flowchartA.id, actorUserId: superAdminId, title: "A1", expectedFlowchartUpdatedAt: flowchartA.updatedAt });
    const a2 = await mustCreateNode({ repairCaseId, flowchartId: flowchartA.id, actorUserId: superAdminId, title: "A2", expectedFlowchartUpdatedAt: a1.updatedAt });
    const edgeA = await mustCreateEdge({ repairCaseId, flowchartId: flowchartA.id, actorUserId: superAdminId, fromNodeId: a1.nodeId, toNodeId: a2.nodeId, expectedFlowchartUpdatedAt: a2.updatedAt });

    const result = await saveRepairCaseFlowchartEdgeRoute({
      repairCaseId,
      flowchartId: flowchartB.id,
      edgeId: edgeA.edgeId,
      actorUserId: superAdminId,
      routePoints: [{ x: 1, y: 1 }],
      expectedFlowchartUpdatedAt: flowchartB.updatedAt,
    });
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.code, "CROSS_FLOWCHART");
  });
});

// =====================================================================
// NODE-ON-EDGE INSERTION (5C-6D)
// =====================================================================

describe("insertRepairCaseFlowchartNodeOnEdge", () => {
  test("A -> B becomes A -> NEW -> B with correct coordinate, one transaction, one changeGroupId", async () => {
    const repairCaseId = await createTestRepairCase();
    const flowchart = await createTestFlowchart(repairCaseId);
    const nodeA = await mustCreateNode({ repairCaseId, flowchartId: flowchart.id, actorUserId: superAdminId, title: "A", expectedFlowchartUpdatedAt: flowchart.updatedAt });
    const nodeB = await mustCreateNode({ repairCaseId, flowchartId: flowchart.id, actorUserId: superAdminId, title: "B", expectedFlowchartUpdatedAt: nodeA.updatedAt });
    const edge = await mustCreateEdge({ repairCaseId, flowchartId: flowchart.id, actorUserId: superAdminId, fromNodeId: nodeA.nodeId, toNodeId: nodeB.nodeId, expectedFlowchartUpdatedAt: nodeB.updatedAt });

    const result = await insertRepairCaseFlowchartNodeOnEdge({
      repairCaseId,
      flowchartId: flowchart.id,
      edgeId: edge.edgeId,
      actorUserId: superAdminId,
      nodeType: "TASK",
      title: "NEW",
      position: { x: 42, y: 84 },
      expectedFlowchartUpdatedAt: edge.updatedAt,
    });
    assert.equal(result.ok, true, JSON.stringify(result));
    if (!result.ok) throw new Error("unreachable");

    // Correct coordinate.
    const [newNode] = await db.select().from(repairCaseFlowchartNodes).where(eq(repairCaseFlowchartNodes.id, result.nodeId));
    assert.equal(newNode.title, "NEW");
    assert.equal(newNode.positionX, 42);
    assert.equal(newNode.positionY, 84);

    // Original edge retargeted: A -> NEW.
    const [firstEdge] = await db.select().from(repairCaseFlowchartEdges).where(eq(repairCaseFlowchartEdges.id, result.firstEdgeId));
    assert.equal(firstEdge.fromNodeId, nodeA.nodeId);
    assert.equal(firstEdge.toNodeId, result.nodeId);

    // Continuation edge created: NEW -> B, plain DEFAULT.
    const [secondEdge] = await db.select().from(repairCaseFlowchartEdges).where(eq(repairCaseFlowchartEdges.id, result.secondEdgeId));
    assert.equal(secondEdge.fromNodeId, result.nodeId);
    assert.equal(secondEdge.toNodeId, nodeB.nodeId);
    assert.equal(secondEdge.branchType, "DEFAULT");

    // Topology confirmed: exactly 3 nodes, 2 edges, forming A -> NEW -> B.
    const allNodes = await db.select().from(repairCaseFlowchartNodes).where(eq(repairCaseFlowchartNodes.flowchartId, flowchart.id));
    const allEdges = await db.select().from(repairCaseFlowchartEdges).where(eq(repairCaseFlowchartEdges.flowchartId, flowchart.id));
    assert.equal(allNodes.length, 3);
    assert.equal(allEdges.length, 2);

    // One changeGroupId, correct history action sequence.
    const historyRows = await db
      .select()
      .from(repairCaseFlowchartEditHistory)
      .where(eq(repairCaseFlowchartEditHistory.flowchartId, flowchart.id))
      .orderBy(repairCaseFlowchartEditHistory.sequenceNumber);
    // CREATE_FLOWCHART (setup) + CREATE_NODE x2 (setup) + CREATE_EDGE (setup) + this insertion's own 3 rows.
    const insertionRows = historyRows.filter(
      (r) =>
        (r.actionType === "CREATE_NODE" && r.nodeId === result.nodeId) ||
        (r.actionType === "RETARGET_EDGE" && r.edgeId === result.firstEdgeId) ||
        (r.actionType === "CREATE_EDGE" && r.edgeId === result.secondEdgeId)
    );
    assert.equal(insertionRows.length, 3);
    assert.deepEqual(insertionRows.map((r) => r.actionType), ["CREATE_NODE", "RETARGET_EDGE", "CREATE_EDGE"]);
    const changeGroupIds = new Set(insertionRows.map((r) => r.changeGroupId));
    assert.equal(changeGroupIds.size, 1, "all three rows must share one changeGroupId");
    for (const row of insertionRows) {
      assert.equal(row.origin, "USER_EDIT");
    }
  });

  test("a mismatched flowchart is rejected atomically, leaving the graph unchanged", async () => {
    const repairCaseId = await createTestRepairCase();
    const flowchartA = await createTestFlowchart(repairCaseId);
    const flowchartB = await createTestFlowchart(repairCaseId);
    const a1 = await mustCreateNode({ repairCaseId, flowchartId: flowchartA.id, actorUserId: superAdminId, title: "A1", expectedFlowchartUpdatedAt: flowchartA.updatedAt });
    const a2 = await mustCreateNode({ repairCaseId, flowchartId: flowchartA.id, actorUserId: superAdminId, title: "A2", expectedFlowchartUpdatedAt: a1.updatedAt });
    const edgeA = await mustCreateEdge({ repairCaseId, flowchartId: flowchartA.id, actorUserId: superAdminId, fromNodeId: a1.nodeId, toNodeId: a2.nodeId, expectedFlowchartUpdatedAt: a2.updatedAt });

    const result = await insertRepairCaseFlowchartNodeOnEdge({
      repairCaseId,
      flowchartId: flowchartB.id,
      edgeId: edgeA.edgeId,
      actorUserId: superAdminId,
      nodeType: "TASK",
      title: "NEW",
      position: { x: 0, y: 0 },
      expectedFlowchartUpdatedAt: flowchartB.updatedAt,
    });
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.code, "CROSS_FLOWCHART");

    const allNodesA = await db.select().from(repairCaseFlowchartNodes).where(eq(repairCaseFlowchartNodes.flowchartId, flowchartA.id));
    assert.equal(allNodesA.length, 2, "no node must be inserted when the target edge belongs to a different flowchart");
  });

  test("a blank title is rejected", async () => {
    const repairCaseId = await createTestRepairCase();
    const flowchart = await createTestFlowchart(repairCaseId);
    const nodeA = await mustCreateNode({ repairCaseId, flowchartId: flowchart.id, actorUserId: superAdminId, title: "A", expectedFlowchartUpdatedAt: flowchart.updatedAt });
    const nodeB = await mustCreateNode({ repairCaseId, flowchartId: flowchart.id, actorUserId: superAdminId, title: "B", expectedFlowchartUpdatedAt: nodeA.updatedAt });
    const edge = await mustCreateEdge({ repairCaseId, flowchartId: flowchart.id, actorUserId: superAdminId, fromNodeId: nodeA.nodeId, toNodeId: nodeB.nodeId, expectedFlowchartUpdatedAt: nodeB.updatedAt });

    const result = await insertRepairCaseFlowchartNodeOnEdge({
      repairCaseId,
      flowchartId: flowchart.id,
      edgeId: edge.edgeId,
      actorUserId: superAdminId,
      nodeType: "TASK",
      title: "   ",
      position: { x: 0, y: 0 },
      expectedFlowchartUpdatedAt: edge.updatedAt,
    });
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.code, "INVALID_INPUT");
  });
});

// =====================================================================
// 흐름도 한 장 통째로 (createRepairCaseFlowchartWithGraph)
// =====================================================================

/** 순수 함수가 그린 「작업 기록 흐름도」를 통째로-만들기 mutation 의 입력 모양으로 옮긴다 — 서버 액션이 하는 그 매핑 그대로. */
function toWholeFlowchartInput(records: readonly WorkRecordFlowchartInput[]) {
  const { nodes, edges } = buildWorkRecordFlowchart(records);
  return {
    nodes: nodes.map((node) => ({
      key: node.id,
      nodeType: node.nodeType,
      title: node.title,
      description: node.description,
      instructions: node.instructions,
      positionX: node.positionX,
      positionY: node.positionY,
    })),
    edges: edges.map((edge) => ({
      fromKey: edge.fromNodeId,
      toKey: edge.toNodeId,
      branchType: edge.branchType,
      branchLabel: edge.branchLabel,
    })),
  };
}

function fakeWorkRecords(count: number): WorkRecordFlowchartInput[] {
  return Array.from({ length: count }, (_unused, index) => ({
    id: randomUUID(),
    memo: `${index + 1}번째 작업 기록`,
    recordKind: "GENERAL" as const,
    createdAt: `2098-02-1${index}T00:00:00.000Z`,
    isInvalidated: false,
  }));
}

/** 이 접수 건에 흐름도가 하나도 만들어지지 않았음을 확인한다 — 칸·연결선·이력은 흐름도 없이는 존재할 수 없다(둘 다 flowchart_id NOT NULL). */
async function assertNothingCreated(repairCaseId: string) {
  const flowcharts = await db.select().from(repairCaseFlowcharts).where(eq(repairCaseFlowcharts.repairCaseId, repairCaseId));
  assert.equal(flowcharts.length, 0, "a rejected whole-flowchart create must leave no flowchart row");
}

async function createTestWorkRecord(repairCaseId: string, memo: string) {
  const result = await createWorkRecord({
    repairCaseId,
    actorUserId: superAdminId,
    memo,
    recordKind: "GENERAL",
    relatedProcedureExecutionNodeId: null,
    clientRequestId: randomUUID(),
  });
  assert.equal(result.ok, true, `setup work record create failed: ${JSON.stringify(result)}`);
  if (!result.ok) throw new Error("unreachable");
  createdWorkRecordIds.push(result.id);
  return result;
}

describe("createRepairCaseFlowchartWithGraph", () => {
  test("흐름도 한 장 + 칸 전부 + 연결선 전부가 한 번에 만들어진다", async () => {
    const repairCaseId = await createTestRepairCase();
    const input = toWholeFlowchartInput(fakeWorkRecords(3));
    // 시작 + 기록 셋 + 현재까지 = 칸 5, 연결선 4.
    assert.equal(input.nodes.length, 5);
    assert.equal(input.edges.length, 4);

    const result = await createRepairCaseFlowchartWithGraph({
      repairCaseId,
      actorUserId: superAdminId,
      title: "작업 기록 흐름도 (2098-02-13 09:00)",
      description: "작업 기록 3건을 그대로 옮겨 만든 흐름도입니다.",
      ...input,
    });
    assert.equal(result.ok, true, JSON.stringify(result));
    if (!result.ok) throw new Error("unreachable");
    createdFlowchartIds.push(result.flowchartId);
    assert.equal(result.nodeCount, 5);
    assert.equal(result.edgeCount, 4);

    const [flowchartRow] = await db.select().from(repairCaseFlowcharts).where(eq(repairCaseFlowcharts.id, result.flowchartId));
    assert.ok(flowchartRow);
    assert.equal(flowchartRow.repairCaseId, repairCaseId);
    assert.equal(flowchartRow.isDeleted, false);

    const nodeRows = await db.select().from(repairCaseFlowchartNodes).where(eq(repairCaseFlowchartNodes.flowchartId, result.flowchartId));
    const edgeRows = await db.select().from(repairCaseFlowchartEdges).where(eq(repairCaseFlowchartEdges.flowchartId, result.flowchartId));
    assert.equal(nodeRows.length, 5);
    assert.equal(edgeRows.length, 4);

    // 임시 key 가 진짜 uuid 로 갈렸다: 어떤 칸 id 도 순수 함수가 지은 가짜 id 가 아니다.
    for (const node of nodeRows) {
      assert.ok(!node.id.startsWith("work-record-flowchart:"), "a saved node id must be a real DB uuid, never the pure function's fake id");
    }

    // 사슬이 그대로 이어졌다 — 시작 → 기록1 → 기록2 → 기록3 → 현재까지.
    const titleById = new Map(nodeRows.map((node) => [node.id, node.title]));
    const chain = edgeRows.map((edge) => [titleById.get(edge.fromNodeId), titleById.get(edge.toNodeId)]);
    chain.sort((a, b) => String(a[0]).localeCompare(String(b[0])));
    assert.deepEqual(chain, [
      ["1번째 작업 기록", "2번째 작업 기록"],
      ["2번째 작업 기록", "3번째 작업 기록"],
      ["3번째 작업 기록", "현재까지"],
      ["시작", "1번째 작업 기록"],
    ]);
    for (const edge of edgeRows) {
      assert.equal(edge.branchType, "DEFAULT");
      assert.equal(edge.branchLabel, null);
    }
  });

  test("편집 이력이 하나의 changeGroupId 로 묶인다 — 사람이 한 번 누른 한 번의 행동", async () => {
    const repairCaseId = await createTestRepairCase();
    const result = await createRepairCaseFlowchartWithGraph({
      repairCaseId,
      actorUserId: superAdminId,
      title: "이력 묶음 시험",
      description: null,
      ...toWholeFlowchartInput(fakeWorkRecords(3)),
    });
    assert.equal(result.ok, true, JSON.stringify(result));
    if (!result.ok) throw new Error("unreachable");
    createdFlowchartIds.push(result.flowchartId);

    const history = await db.select().from(repairCaseFlowchartEditHistory).where(eq(repairCaseFlowchartEditHistory.flowchartId, result.flowchartId));
    // CREATE_FLOWCHART 1 + CREATE_NODE 5 + CREATE_EDGE 4.
    assert.equal(history.length, 10);
    assert.equal(new Set(history.map((row) => row.changeGroupId)).size, 1, "one user action must be one change group, never one group per row");
    assert.equal(history.filter((row) => row.actionType === "CREATE_FLOWCHART").length, 1);
    assert.equal(history.filter((row) => row.actionType === "CREATE_NODE").length, 5);
    assert.equal(history.filter((row) => row.actionType === "CREATE_EDGE").length, 4);
    for (const row of history) {
      assert.equal(row.origin, "USER_EDIT");
      assert.equal(row.actorUserId, superAdminId);
      assert.equal(row.beforeState, null);
      assert.ok(row.afterState !== null, "every create row must carry an after-state snapshot");
    }
  });

  test("권한 없는 사람은 FORBIDDEN — 흐름도도 칸도 하나 만들어지지 않는다", async () => {
    for (const actorUserId of [salesId, inventoryManagerId]) {
      const repairCaseId = await createTestRepairCase();
      const result = await createRepairCaseFlowchartWithGraph({
        repairCaseId,
        actorUserId,
        title: "권한 시험",
        description: null,
        ...toWholeFlowchartInput(fakeWorkRecords(3)),
      });
      assert.equal(result.ok, false);
      if (!result.ok) assert.equal(result.code, "FORBIDDEN");
      await assertNothingCreated(repairCaseId);
    }
  });

  test("유·무상 미확정 건에서는 막히고 아무것도 만들어지지 않는다", async () => {
    const repairCaseId = await createTestRepairCase();
    await setPendingBilling(repairCaseId);
    const result = await createRepairCaseFlowchartWithGraph({
      repairCaseId,
      actorUserId: superAdminId,
      title: "유·무상 시험",
      description: null,
      ...toWholeFlowchartInput(fakeWorkRecords(3)),
    });
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.code, "BILLING_DECISION_REQUIRED");
    await assertNothingCreated(repairCaseId);
  });

  test("없는 접수 건이면 NOT_FOUND — 아무것도 만들어지지 않는다", async () => {
    const result = await createRepairCaseFlowchartWithGraph({
      repairCaseId: randomUUID(),
      actorUserId: superAdminId,
      title: "없는 건 시험",
      description: null,
      ...toWholeFlowchartInput(fakeWorkRecords(3)),
    });
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.code, "NOT_FOUND");
  });

  test("shipment-lock 제거 정책: 잠긴(출하된) 건도 막지 않는다 — 손으로 만드는 길과 같은 규칙", async () => {
    // createRepairCaseFlowchart 가 is_locked 를 보지 않는 것과 같다. 이 길만
    // 더 엄하게 막으면 같은 일을 하는 두 길의 규칙이 서로 달라진다.
    const repairCaseId = await createTestRepairCase();
    await lockCase(repairCaseId);
    const result = await createRepairCaseFlowchartWithGraph({
      repairCaseId,
      actorUserId: superAdminId,
      title: "잠긴 건 시험",
      description: null,
      ...toWholeFlowchartInput(fakeWorkRecords(2)),
    });
    assert.equal(result.ok, true, JSON.stringify(result));
    if (result.ok) createdFlowchartIds.push(result.flowchartId);
  });

  test("연결선이 목록에 없는 칸을 가리키면 아무것도 만들어지지 않는다", async () => {
    const repairCaseId = await createTestRepairCase();
    const input = toWholeFlowchartInput(fakeWorkRecords(3));
    const result = await createRepairCaseFlowchartWithGraph({
      repairCaseId,
      actorUserId: superAdminId,
      title: "끊긴 연결선 시험",
      description: null,
      nodes: input.nodes,
      edges: [...input.edges, { fromKey: input.nodes[0].key, toKey: "존재하지 않는 칸", branchType: "DEFAULT", branchLabel: null }],
    });
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.code, "NOT_FOUND");
    await assertNothingCreated(repairCaseId);
  });

  test("저장한 뒤 작업 기록을 하나 더 넣어도 저장된 흐름도는 그대로다", async () => {
    // 저장되고 나면 평범한 흐름도다 — 다시 그려 주지도, 따라 바뀌지도 않는다.
    const repairCaseId = await createTestRepairCase();
    await createTestWorkRecord(repairCaseId, "첫 번째 실제 기록");
    await createTestWorkRecord(repairCaseId, "두 번째 실제 기록");

    const before = await getWorkRecordHistoryForCase(repairCaseId, { limit: WORK_RECORD_FLOWCHART_MAX_RECORDS, offset: 0 });
    assert.equal(listWorkRecordIdsInFlowchart(buildWorkRecordFlowchart(before.rows).nodes).length, 2);

    const result = await createRepairCaseFlowchartWithGraph({
      repairCaseId,
      actorUserId: superAdminId,
      title: "그때 모습",
      description: "작업 기록 2건",
      ...toWholeFlowchartInput(before.rows),
    });
    assert.equal(result.ok, true, JSON.stringify(result));
    if (!result.ok) throw new Error("unreachable");
    createdFlowchartIds.push(result.flowchartId);

    const savedTitles = (await db.select().from(repairCaseFlowchartNodes).where(eq(repairCaseFlowchartNodes.flowchartId, result.flowchartId)))
      .map((node) => node.title)
      .sort();

    await createTestWorkRecord(repairCaseId, "세 번째 실제 기록");

    const after = await getWorkRecordHistoryForCase(repairCaseId, { limit: WORK_RECORD_FLOWCHART_MAX_RECORDS, offset: 0 });
    // 자동으로 그리는 쪽은 세 건으로 늘었지만…
    assert.equal(listWorkRecordIdsInFlowchart(buildWorkRecordFlowchart(after.rows).nodes).length, 3);
    // …저장된 흐름도는 두 건짜리 그대로다.
    const stillSavedTitles = (await db.select().from(repairCaseFlowchartNodes).where(eq(repairCaseFlowchartNodes.flowchartId, result.flowchartId)))
      .map((node) => node.title)
      .sort();
    assert.equal(stillSavedTitles.length, 4);
    assert.deepEqual(stillSavedTitles, savedTitles);
    assert.ok(!stillSavedTitles.includes("세 번째 실제 기록"));

    const edgeRows = await db.select().from(repairCaseFlowchartEdges).where(eq(repairCaseFlowchartEdges.flowchartId, result.flowchartId));
    assert.equal(edgeRows.length, 3);
  });
});
