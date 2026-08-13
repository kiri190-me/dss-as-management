import "../../../../scripts/load-env";

import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { and, eq, inArray, like } from "drizzle-orm";
import { db, pgClient } from "../connection";
import {
  users,
  customers,
  repairCases,
  repairCaseIntakeSequences,
  repairCaseFlowcharts,
  repairCaseFlowchartNodes,
  repairCaseFlowchartEdges,
  repairCaseFlowchartEditHistory,
} from "../schema";
import { createRepairCase } from "./repair-cases";
import type { ValidatedCreateRepairCaseInput } from "@/lib/validation/repair-case-input";

/**
 * Phase 5C-6A — schema/migration-focused integration tests for the
 * repair_case_flowcharts/nodes/edges/edit_history foundation added by
 * migration 0019. No mutation module exists yet (deliberately out of scope
 * for 6A — see HANDOFF.md); every test here talks to the Drizzle schema
 * objects directly, verifying DATABASE-level invariants that the
 * application-level mutation layer (6B/6C) will additionally enforce, never
 * a stand-in for that layer.
 *
 * Self-cleaning convention, same as repair-case-work-records.integration.
 * test.ts: every repair case created here uses intake month
 * TEST_YEAR_MONTH ("9902", distinct from every other isolated month already
 * in use by the rest of the suite). after() deletes every row this suite
 * created, in FK-dependency order, and never touches the 19 real repair
 * cases, the four real procedure templates, or the genuine
 * 고객/고객연락 TECHNICAL_TASK draft (this suite never touches
 * procedure_templates at all).
 */

const TEST_YEAR_MONTH = "9902";
const TEST_RECEIVED_AT = "2099-02-10";
const TEST_SHIPMENT_DATE = "2099-02-20";

let superAdminId: string;
let engineerId: string;
let customerId: string;

const createdRepairCaseIds: string[] = [];
const createdFlowchartIds: string[] = [];

function baseCreateInput(overrides: Partial<ValidatedCreateRepairCaseInput> = {}): ValidatedCreateRepairCaseInput {
  const suffix = randomUUID().slice(0, 8);
  return {
    workflowType: "MATCHER",
    customerId,
    endUserId: null,
    assignedEngineerId: engineerId,
    receivedAt: TEST_RECEIVED_AT,
    customerRequestedDueDate: null,
    internalTargetShipmentDate: TEST_SHIPMENT_DATE,
    modelName: `FLOWCHART-SCHEMA-TEST-${suffix}`,
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

async function createTestRepairCase(): Promise<string> {
  const result = await createRepairCase(baseCreateInput());
  assert.equal(result.ok, true, `setup repair case create failed: ${JSON.stringify(result)}`);
  if (!result.ok) throw new Error("unreachable");
  createdRepairCaseIds.push(result.id);
  return result.id;
}

async function createTestFlowchart(repairCaseId: string, title = "테스트 진단 Flowchart") {
  const [flowchart] = await db
    .insert(repairCaseFlowcharts)
    .values({
      repairCaseId,
      title,
      createdBy: superAdminId,
      updatedBy: superAdminId,
    })
    .returning();
  createdFlowchartIds.push(flowchart.id);
  return flowchart;
}

/**
 * postgres.js wraps the real PostgresError in `.cause` — drizzle's own
 * thrown Error's own `.message` is just "Failed query: ...", never the
 * constraint text, so assert.rejects' plain-regex form (which only checks
 * the outer message) can never match a real FK violation. Validate the
 * nested cause instead.
 */
function isForeignKeyViolation(err: unknown): boolean {
  const cause = err instanceof Error ? err.cause : undefined;
  const causeMessage = cause instanceof Error ? cause.message : String(cause);
  assert.match(causeMessage, /foreign key|violates/i);
  return true;
}

async function createTestNode(flowchartId: string, title: string) {
  const [node] = await db
    .insert(repairCaseFlowchartNodes)
    .values({ flowchartId, nodeType: "TASK", title })
    .returning();
  return node;
}

before(async () => {
  const [superAdmin] = await db
    .select({ id: users.id })
    .from(users)
    .where(and(eq(users.role, "SUPER_ADMIN"), eq(users.approvalStatus, "APPROVED"), eq(users.isDeleted, false), eq(users.isActive, true)))
    .limit(1);
  assert.ok(superAdmin, "expected an approved SUPER_ADMIN in the dev DB");
  superAdminId = superAdmin.id;

  const [engineer] = await db
    .select({ id: users.id })
    .from(users)
    .where(and(eq(users.role, "AS_ENGINEER"), eq(users.approvalStatus, "APPROVED"), eq(users.isDeleted, false), eq(users.isActive, true)))
    .limit(1);
  assert.ok(engineer, "expected an approved AS_ENGINEER in the dev DB");
  engineerId = engineer.id;

  const [customer] = await db.select({ id: customers.id }).from(customers).where(eq(customers.isDeleted, false)).limit(1);
  assert.ok(customer, "expected at least one non-deleted customer in the dev DB");
  customerId = customer.id;
});

after(async () => {
  if (createdFlowchartIds.length > 0) {
    await db.delete(repairCaseFlowchartEditHistory).where(inArray(repairCaseFlowchartEditHistory.flowchartId, createdFlowchartIds));
    await db.delete(repairCaseFlowchartEdges).where(inArray(repairCaseFlowchartEdges.flowchartId, createdFlowchartIds));
    await db.delete(repairCaseFlowchartNodes).where(inArray(repairCaseFlowchartNodes.flowchartId, createdFlowchartIds));
    await db.delete(repairCaseFlowcharts).where(inArray(repairCaseFlowcharts.id, createdFlowchartIds));
  }
  await db.delete(repairCases).where(like(repairCases.intakeNumber, `D${TEST_YEAR_MONTH}%`));
  await db.delete(repairCaseIntakeSequences).where(eq(repairCaseIntakeSequences.yearMonth, TEST_YEAR_MONTH));
  await pgClient.end({ timeout: 5 });
});

describe("repair_case_flowcharts foundation (migration 0019)", () => {
  test("a repair case may own multiple flowcharts", async () => {
    const repairCaseId = await createTestRepairCase();
    const first = await createTestFlowchart(repairCaseId, "초기 진단");
    const second = await createTestFlowchart(repairCaseId, "RF 출력 없음 진단");
    assert.notEqual(first.id, second.id);
    const rows = await db.select().from(repairCaseFlowcharts).where(eq(repairCaseFlowcharts.repairCaseId, repairCaseId));
    assert.equal(rows.length, 2);
  });

  test("an edge whose from_node/to_node belongs to a DIFFERENT flowchart is rejected by the database", async () => {
    const repairCaseId = await createTestRepairCase();
    const flowchartA = await createTestFlowchart(repairCaseId, "Flowchart A");
    const flowchartB = await createTestFlowchart(repairCaseId, "Flowchart B");
    const nodeInA = await createTestNode(flowchartA.id, "A의 노드");
    const nodeInB = await createTestNode(flowchartB.id, "B의 노드");

    await assert.rejects(
      () =>
        db.insert(repairCaseFlowchartEdges).values({
          flowchartId: flowchartA.id,
          fromNodeId: nodeInA.id,
          // Cross-flowchart reference: toNodeId belongs to flowchartB, but
          // this edge row's own flowchartId is flowchartA — the composite
          // FK (flowchart_id, to_node_id) -> nodes(flowchart_id, id) has no
          // matching row and must reject the insert.
          toNodeId: nodeInB.id,
          branchType: "DEFAULT",
        }),
      isForeignKeyViolation
    );
  });

  test("deleting a node with a connected edge is rejected; deleting the edge first then the node succeeds", async () => {
    const repairCaseId = await createTestRepairCase();
    const flowchart = await createTestFlowchart(repairCaseId);
    const nodeA = await createTestNode(flowchart.id, "A");
    const nodeB = await createTestNode(flowchart.id, "B");
    const [edge] = await db
      .insert(repairCaseFlowchartEdges)
      .values({ flowchartId: flowchart.id, fromNodeId: nodeA.id, toNodeId: nodeB.id, branchType: "DEFAULT" })
      .returning();

    await assert.rejects(
      () => db.delete(repairCaseFlowchartNodes).where(eq(repairCaseFlowchartNodes.id, nodeA.id)),
      isForeignKeyViolation
    );

    await db.delete(repairCaseFlowchartEdges).where(eq(repairCaseFlowchartEdges.id, edge.id));
    await db.delete(repairCaseFlowchartNodes).where(eq(repairCaseFlowchartNodes.id, nodeA.id));

    const remaining = await db.select().from(repairCaseFlowchartNodes).where(eq(repairCaseFlowchartNodes.id, nodeA.id));
    assert.equal(remaining.length, 0);
  });

  test("a history row survives its referenced node's hard delete — node_id becomes NULL, before/after JSON keeps identity", async () => {
    const repairCaseId = await createTestRepairCase();
    const flowchart = await createTestFlowchart(repairCaseId);
    const node = await createTestNode(flowchart.id, "곧 삭제될 노드");

    const [historyRow] = await db
      .insert(repairCaseFlowchartEditHistory)
      .values({
        flowchartId: flowchart.id,
        actionType: "CREATE_NODE",
        nodeId: node.id,
        afterState: { id: node.id, title: node.title },
        actorUserId: superAdminId,
        changeGroupId: randomUUID(),
      })
      .returning();

    await db.delete(repairCaseFlowchartNodes).where(eq(repairCaseFlowchartNodes.id, node.id));

    const [afterDelete] = await db.select().from(repairCaseFlowchartEditHistory).where(eq(repairCaseFlowchartEditHistory.id, historyRow.id));
    assert.ok(afterDelete, "history row must survive the node's hard delete");
    assert.equal(afterDelete.nodeId, null, "node_id must be SET NULL, not left dangling or the row deleted");
    assert.deepEqual(afterDelete.afterState, { id: node.id, title: node.title }, "identity/state must remain recoverable from JSON");
  });

  test("a history row survives its referenced edge's hard delete — edge_id becomes NULL, before/after JSON keeps identity", async () => {
    const repairCaseId = await createTestRepairCase();
    const flowchart = await createTestFlowchart(repairCaseId);
    const nodeA = await createTestNode(flowchart.id, "A");
    const nodeB = await createTestNode(flowchart.id, "B");
    const [edge] = await db
      .insert(repairCaseFlowchartEdges)
      .values({ flowchartId: flowchart.id, fromNodeId: nodeA.id, toNodeId: nodeB.id, branchType: "DEFAULT" })
      .returning();

    const [historyRow] = await db
      .insert(repairCaseFlowchartEditHistory)
      .values({
        flowchartId: flowchart.id,
        actionType: "CREATE_EDGE",
        edgeId: edge.id,
        afterState: { id: edge.id, fromNodeId: nodeA.id, toNodeId: nodeB.id, branchType: "DEFAULT" },
        actorUserId: superAdminId,
        changeGroupId: randomUUID(),
      })
      .returning();

    await db.delete(repairCaseFlowchartEdges).where(eq(repairCaseFlowchartEdges.id, edge.id));

    const [afterDelete] = await db.select().from(repairCaseFlowchartEditHistory).where(eq(repairCaseFlowchartEditHistory.id, historyRow.id));
    assert.ok(afterDelete, "history row must survive the edge's hard delete");
    assert.equal(afterDelete.edgeId, null, "edge_id must be SET NULL, not left dangling or the row deleted");
    assert.deepEqual(afterDelete.afterState, { id: edge.id, fromNodeId: nodeA.id, toNodeId: nodeB.id, branchType: "DEFAULT" }, "identity/state must remain recoverable from JSON");
  });

  test("soft-deleting a flowchart never touches its nodes/edges/history rows", async () => {
    const repairCaseId = await createTestRepairCase();
    const flowchart = await createTestFlowchart(repairCaseId);
    const node = await createTestNode(flowchart.id, "살아남아야 하는 노드");

    await db
      .update(repairCaseFlowcharts)
      .set({ isDeleted: true, deletedAt: new Date(), deletedBy: superAdminId, deleteReason: "schema test" })
      .where(eq(repairCaseFlowcharts.id, flowchart.id));

    const [stillThere] = await db.select().from(repairCaseFlowchartNodes).where(eq(repairCaseFlowchartNodes.id, node.id));
    assert.ok(stillThere, "soft-deleting the parent flowchart must not remove its nodes");
  });

  test("hard-deleting a flowchart cascades atomically to its nodes and edges despite the edge->node RESTRICT ownership FK", async () => {
    const repairCaseId = await createTestRepairCase();
    const flowchart = await createTestFlowchart(repairCaseId, "직접 하드 삭제 테스트");
    const nodeA = await createTestNode(flowchart.id, "A");
    const nodeB = await createTestNode(flowchart.id, "B");
    await db.insert(repairCaseFlowchartEdges).values({ flowchartId: flowchart.id, fromNodeId: nodeA.id, toNodeId: nodeB.id, branchType: "DEFAULT" });

    // Direct DB-level hard delete — never an application code path (the app
    // only ever soft-deletes a flowchart). This verifies the schema-level
    // edge case flagged in the 5C-6A design review: two sibling CASCADE
    // paths (nodes, edges both cascading from flowcharts) coexist with a
    // RESTRICT composite FK from edges to nodes. If Postgres processes the
    // nodes cascade before the edges cascade, this DELETE would fail with a
    // foreign_key_violation even though the whole flowchart is being
    // removed atomically — that would mean the schema needs redesigning,
    // not that this test's expectation should be loosened.
    await db.delete(repairCaseFlowcharts).where(eq(repairCaseFlowcharts.id, flowchart.id));

    const remainingNodes = await db.select().from(repairCaseFlowchartNodes).where(eq(repairCaseFlowchartNodes.flowchartId, flowchart.id));
    const remainingEdges = await db.select().from(repairCaseFlowchartEdges).where(eq(repairCaseFlowchartEdges.flowchartId, flowchart.id));
    assert.equal(remainingNodes.length, 0, "cascade must remove all nodes");
    assert.equal(remainingEdges.length, 0, "cascade must remove all edges");

    // Already gone — do not let after()'s cleanup try to delete it again.
    createdFlowchartIds.splice(createdFlowchartIds.indexOf(flowchart.id), 1);
  });
});
