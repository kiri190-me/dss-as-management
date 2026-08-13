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
  repairCaseFlowchartEditHistory,
} from "../schema";
import { createRepairCase } from "./repair-cases";
import {
  createRepairCaseFlowchart,
  updateRepairCaseFlowchartMetadata,
  softDeleteRepairCaseFlowchart,
} from "./repair-case-flowcharts";
import { listRepairCaseFlowcharts, getRepairCaseFlowchart } from "../queries/repair-case-flowcharts";
import type { ValidatedCreateRepairCaseInput } from "@/lib/validation/repair-case-input";

/**
 * Phase 5C-6B integration tests for repair-case flowchart OBJECT management
 * (create/rename/soft-delete) — node/edge graph CRUD does not exist yet
 * (5C-6C+). Self-cleaning convention, same as repair-case-work-records.
 * integration.test.ts: every repair case created here uses intake month
 * TEST_YEAR_MONTH ("9913", distinct from every other isolated month already
 * in use). after() deletes every row this suite created and never touches
 * the 19 real repair cases, the four real procedure templates, or the
 * genuine 고객/고객연락 TECHNICAL_TASK draft (this suite never touches
 * procedure_templates at all).
 */

const TEST_YEAR_MONTH = "9801";
const RECEIVED_AT = "2098-01-10";
const SHIPMENT_DATE = "2098-01-20";

let superAdminId: string;
let adminId: string;
let engineerId: string;
let engineer2Id: string;
let salesId: string;
let inventoryManagerId: string;
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
    receivedAt: RECEIVED_AT,
    customerRequestedDueDate: null,
    internalTargetShipmentDate: SHIPMENT_DATE,
    modelName: `FLOWCHART-6B-TEST-${suffix}`,
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

async function mustCreate(params: { repairCaseId: string; actorUserId: string; title: string; description?: string | null }) {
  const result = await createRepairCaseFlowchart({
    repairCaseId: params.repairCaseId,
    actorUserId: params.actorUserId,
    title: params.title,
    description: params.description ?? null,
  });
  assert.equal(result.ok, true, `setup flowchart create failed: ${JSON.stringify(result)}`);
  if (!result.ok) throw new Error("unreachable");
  createdFlowchartIds.push(result.id);
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
    await db.delete(repairCaseFlowchartEditHistory).where(inArray(repairCaseFlowchartEditHistory.flowchartId, createdFlowchartIds));
    await db.delete(repairCaseFlowcharts).where(inArray(repairCaseFlowcharts.id, createdFlowchartIds));
  }
  await db.delete(repairCases).where(like(repairCases.intakeNumber, `D${TEST_YEAR_MONTH}%`));
  await db.delete(repairCaseIntakeSequences).where(eq(repairCaseIntakeSequences.yearMonth, TEST_YEAR_MONTH));
  await pgClient.end({ timeout: 5 });
});

// ---------------------------------------------------------------- creation

describe("createRepairCaseFlowchart: authorization", () => {
  test("SUPER_ADMIN may create on any case", async () => {
    const repairCaseId = await createTestRepairCase();
    await mustCreate({ repairCaseId, actorUserId: superAdminId, title: "초기 진단" });
  });

  test("ADMIN may create on any case", async () => {
    const repairCaseId = await createTestRepairCase();
    await mustCreate({ repairCaseId, actorUserId: adminId, title: "초기 진단" });
  });

  test("assigned AS_ENGINEER may create", async () => {
    const repairCaseId = await createTestRepairCase({ assignedEngineerId: engineerId });
    await mustCreate({ repairCaseId, actorUserId: engineerId, title: "초기 진단" });
  });

  test("non-assigned AS_ENGINEER is denied", async () => {
    const repairCaseId = await createTestRepairCase({ assignedEngineerId: engineerId });
    const result = await createRepairCaseFlowchart({ repairCaseId, actorUserId: engineer2Id, title: "초기 진단", description: null });
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.code, "FORBIDDEN");
  });

  test("SALES is denied", async () => {
    const repairCaseId = await createTestRepairCase();
    const result = await createRepairCaseFlowchart({ repairCaseId, actorUserId: salesId, title: "초기 진단", description: null });
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.code, "FORBIDDEN");
  });

  test("INVENTORY_MANAGER is denied", async () => {
    const repairCaseId = await createTestRepairCase();
    const result = await createRepairCaseFlowchart({ repairCaseId, actorUserId: inventoryManagerId, title: "초기 진단", description: null });
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.code, "FORBIDDEN");
  });

  test("a locked case is denied, even for SUPER_ADMIN", async () => {
    const repairCaseId = await createTestRepairCase();
    await lockCase(repairCaseId);
    const result = await createRepairCaseFlowchart({ repairCaseId, actorUserId: superAdminId, title: "초기 진단", description: null });
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.code, "CASE_LOCKED");
  });

  test("a blank title is rejected", async () => {
    const repairCaseId = await createTestRepairCase();
    const result = await createRepairCaseFlowchart({ repairCaseId, actorUserId: superAdminId, title: "   ", description: null });
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.code, "INVALID_INPUT");
  });
});

// ------------------------------------------------------------------ listing

describe("listRepairCaseFlowcharts / getRepairCaseFlowchart", () => {
  test("a repair case may own multiple flowcharts, all listed", async () => {
    const repairCaseId = await createTestRepairCase();
    await mustCreate({ repairCaseId, actorUserId: superAdminId, title: "초기 진단" });
    await mustCreate({ repairCaseId, actorUserId: superAdminId, title: "RF 출력 없음 진단" });
    await mustCreate({ repairCaseId, actorUserId: superAdminId, title: "최종 원인 분석" });

    const rows = await listRepairCaseFlowcharts(repairCaseId);
    assert.equal(rows.length, 3);
    assert.deepEqual(new Set(rows.map((r) => r.title)), new Set(["초기 진단", "RF 출력 없음 진단", "최종 원인 분석"]));
  });

  test("a soft-deleted flowchart is excluded from the default list", async () => {
    const repairCaseId = await createTestRepairCase();
    const created = await mustCreate({ repairCaseId, actorUserId: superAdminId, title: "삭제될 Flowchart" });

    const beforeDelete = await listRepairCaseFlowcharts(repairCaseId);
    assert.equal(beforeDelete.length, 1);

    const deleteResult = await softDeleteRepairCaseFlowchart({
      repairCaseId,
      flowchartId: created.id,
      actorUserId: superAdminId,
      deleteReason: null,
      expectedUpdatedAt: created.updatedAt,
    });
    assert.equal(deleteResult.ok, true, JSON.stringify(deleteResult));

    const afterDelete = await listRepairCaseFlowcharts(repairCaseId);
    assert.equal(afterDelete.length, 0);
  });

  test("case A's list never returns case B's flowcharts", async () => {
    const caseA = await createTestRepairCase();
    const caseB = await createTestRepairCase();
    await mustCreate({ repairCaseId: caseA, actorUserId: superAdminId, title: "Case A Flowchart" });
    await mustCreate({ repairCaseId: caseB, actorUserId: superAdminId, title: "Case B Flowchart" });

    const rowsA = await listRepairCaseFlowcharts(caseA);
    const rowsB = await listRepairCaseFlowcharts(caseB);
    assert.equal(rowsA.length, 1);
    assert.equal(rowsB.length, 1);
    assert.equal(rowsA[0].title, "Case A Flowchart");
    assert.equal(rowsB[0].title, "Case B Flowchart");
  });
});

// ------------------------------------------------------------------ update

describe("updateRepairCaseFlowchartMetadata", () => {
  test("title/description persist, updatedBy/updatedAt change", async () => {
    const repairCaseId = await createTestRepairCase();
    const created = await mustCreate({ repairCaseId, actorUserId: superAdminId, title: "원래 제목", description: null });

    const result = await updateRepairCaseFlowchartMetadata({
      repairCaseId,
      flowchartId: created.id,
      actorUserId: adminId,
      title: "새 제목",
      description: "새 설명",
      expectedUpdatedAt: created.updatedAt,
    });
    assert.equal(result.ok, true, JSON.stringify(result));
    if (!result.ok) throw new Error("unreachable");
    assert.equal(result.changed, true);

    const [row] = await db.select().from(repairCaseFlowcharts).where(eq(repairCaseFlowcharts.id, created.id));
    assert.equal(row.title, "새 제목");
    assert.equal(row.description, "새 설명");
    assert.equal(row.updatedBy, adminId);
    assert.notEqual(row.updatedAt.toISOString(), created.updatedAt);
  });

  test("a stale expectedUpdatedAt is rejected atomically — flowchart and history stay unchanged", async () => {
    const repairCaseId = await createTestRepairCase();
    const created = await mustCreate({ repairCaseId, actorUserId: superAdminId, title: "원래 제목" });

    const historyCountBefore = await db
      .select({ id: repairCaseFlowchartEditHistory.id })
      .from(repairCaseFlowchartEditHistory)
      .where(eq(repairCaseFlowchartEditHistory.flowchartId, created.id));

    const staleUpdatedAt = new Date(new Date(created.updatedAt).getTime() - 1000).toISOString();
    const result = await updateRepairCaseFlowchartMetadata({
      repairCaseId,
      flowchartId: created.id,
      actorUserId: superAdminId,
      title: "다른 제목",
      description: null,
      expectedUpdatedAt: staleUpdatedAt,
    });
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.code, "STALE_REVISION");

    const [row] = await db.select().from(repairCaseFlowcharts).where(eq(repairCaseFlowcharts.id, created.id));
    assert.equal(row.title, "원래 제목");

    const historyCountAfter = await db
      .select({ id: repairCaseFlowchartEditHistory.id })
      .from(repairCaseFlowchartEditHistory)
      .where(eq(repairCaseFlowchartEditHistory.flowchartId, created.id));
    assert.equal(historyCountAfter.length, historyCountBefore.length);
  });

  test("a no-op update (identical title/description) writes no history row and returns changed:false", async () => {
    const repairCaseId = await createTestRepairCase();
    const created = await mustCreate({ repairCaseId, actorUserId: superAdminId, title: "동일 제목", description: "동일 설명" });

    const historyCountBefore = await db
      .select({ id: repairCaseFlowchartEditHistory.id })
      .from(repairCaseFlowchartEditHistory)
      .where(eq(repairCaseFlowchartEditHistory.flowchartId, created.id));

    const result = await updateRepairCaseFlowchartMetadata({
      repairCaseId,
      flowchartId: created.id,
      actorUserId: superAdminId,
      title: "동일 제목",
      description: "동일 설명",
      expectedUpdatedAt: created.updatedAt,
    });
    assert.equal(result.ok, true, JSON.stringify(result));
    if (!result.ok) throw new Error("unreachable");
    assert.equal(result.changed, false);
    assert.equal(result.updatedAt, created.updatedAt);

    const historyCountAfter = await db
      .select({ id: repairCaseFlowchartEditHistory.id })
      .from(repairCaseFlowchartEditHistory)
      .where(eq(repairCaseFlowchartEditHistory.flowchartId, created.id));
    assert.equal(historyCountAfter.length, historyCountBefore.length);
  });

  test("a non-assigned AS_ENGINEER cannot update", async () => {
    const repairCaseId = await createTestRepairCase({ assignedEngineerId: engineerId });
    const created = await mustCreate({ repairCaseId, actorUserId: superAdminId, title: "제목" });

    const result = await updateRepairCaseFlowchartMetadata({
      repairCaseId,
      flowchartId: created.id,
      actorUserId: engineer2Id,
      title: "변경 시도",
      description: null,
      expectedUpdatedAt: created.updatedAt,
    });
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.code, "FORBIDDEN");
  });
});

// ------------------------------------------------------------ soft delete

describe("softDeleteRepairCaseFlowchart", () => {
  test("sets all four soft-delete fields correctly, leaves history untouched", async () => {
    const repairCaseId = await createTestRepairCase();
    const created = await mustCreate({ repairCaseId, actorUserId: superAdminId, title: "삭제 대상" });

    const result = await softDeleteRepairCaseFlowchart({
      repairCaseId,
      flowchartId: created.id,
      actorUserId: adminId,
      deleteReason: "테스트 삭제 사유",
      expectedUpdatedAt: created.updatedAt,
    });
    assert.equal(result.ok, true, JSON.stringify(result));

    const [row] = await db.select().from(repairCaseFlowcharts).where(eq(repairCaseFlowcharts.id, created.id));
    assert.equal(row.isDeleted, true);
    assert.ok(row.deletedAt);
    assert.equal(row.deletedBy, adminId);
    assert.equal(row.deleteReason, "테스트 삭제 사유");

    const history = await db
      .select()
      .from(repairCaseFlowchartEditHistory)
      .where(eq(repairCaseFlowchartEditHistory.flowchartId, created.id));
    assert.ok(history.length >= 2, "CREATE_FLOWCHART and SOFT_DELETE_FLOWCHART rows must both survive");
  });

  test("a stale expectedUpdatedAt is rejected", async () => {
    const repairCaseId = await createTestRepairCase();
    const created = await mustCreate({ repairCaseId, actorUserId: superAdminId, title: "삭제 대상" });
    const staleUpdatedAt = new Date(new Date(created.updatedAt).getTime() - 1000).toISOString();

    const result = await softDeleteRepairCaseFlowchart({
      repairCaseId,
      flowchartId: created.id,
      actorUserId: superAdminId,
      deleteReason: null,
      expectedUpdatedAt: staleUpdatedAt,
    });
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.code, "STALE_REVISION");

    const [row] = await db.select().from(repairCaseFlowcharts).where(eq(repairCaseFlowcharts.id, created.id));
    assert.equal(row.isDeleted, false);
  });

  test("authorization is rechecked — SALES cannot soft-delete", async () => {
    const repairCaseId = await createTestRepairCase();
    const created = await mustCreate({ repairCaseId, actorUserId: superAdminId, title: "삭제 대상" });

    const result = await softDeleteRepairCaseFlowchart({
      repairCaseId,
      flowchartId: created.id,
      actorUserId: salesId,
      deleteReason: null,
      expectedUpdatedAt: created.updatedAt,
    });
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.code, "FORBIDDEN");
  });
});

// ------------------------------------------------------------------ history

describe("repair_case_flowchart_edit_history writes", () => {
  test("CREATE_FLOWCHART / UPDATE_FLOWCHART_METADATA / SOFT_DELETE_FLOWCHART each write exactly one USER_EDIT group", async () => {
    const repairCaseId = await createTestRepairCase();
    const created = await mustCreate({ repairCaseId, actorUserId: superAdminId, title: "이력 테스트" });

    const updateResult = await updateRepairCaseFlowchartMetadata({
      repairCaseId,
      flowchartId: created.id,
      actorUserId: superAdminId,
      title: "이력 테스트 변경",
      description: null,
      expectedUpdatedAt: created.updatedAt,
    });
    assert.equal(updateResult.ok, true);
    if (!updateResult.ok) throw new Error("unreachable");

    const deleteResult = await softDeleteRepairCaseFlowchart({
      repairCaseId,
      flowchartId: created.id,
      actorUserId: superAdminId,
      deleteReason: null,
      expectedUpdatedAt: updateResult.updatedAt,
    });
    assert.equal(deleteResult.ok, true);

    const rows = await db
      .select()
      .from(repairCaseFlowchartEditHistory)
      .where(eq(repairCaseFlowchartEditHistory.flowchartId, created.id))
      .orderBy(repairCaseFlowchartEditHistory.sequenceNumber);

    assert.equal(rows.length, 3);
    assert.deepEqual(
      rows.map((r) => r.actionType),
      ["CREATE_FLOWCHART", "UPDATE_FLOWCHART_METADATA", "SOFT_DELETE_FLOWCHART"]
    );

    const changeGroupIds = new Set(rows.map((r) => r.changeGroupId));
    assert.equal(changeGroupIds.size, 3, "each logical action must have its own change_group_id");

    for (const row of rows) {
      assert.equal(row.origin, "USER_EDIT");
      assert.equal(row.sourceGroupId, null);
      assert.equal(row.restoreTargetGroupId, null);
    }

    const sequenceNumbers = rows.map((r) => r.sequenceNumber);
    assert.deepEqual(sequenceNumbers, [...sequenceNumbers].sort((a, b) => a - b), "sequence_number must be strictly orderable");
    assert.equal(new Set(sequenceNumbers).size, 3, "sequence_number must be unique");
  });
});

// ---------------------------------------------------------------- ownership

describe("cross-case ownership (IDOR) defense", () => {
  test("getRepairCaseFlowchart rejects a mismatched repairCaseId/flowchartId pair", async () => {
    const caseA = await createTestRepairCase();
    const caseB = await createTestRepairCase();
    const flowchartInA = await mustCreate({ repairCaseId: caseA, actorUserId: superAdminId, title: "Case A의 Flowchart" });

    const mismatched = await getRepairCaseFlowchart(caseB, flowchartInA.id);
    assert.equal(mismatched, null);

    const correct = await getRepairCaseFlowchart(caseA, flowchartInA.id);
    assert.ok(correct);
  });

  test("updateRepairCaseFlowchartMetadata rejects a mismatched repairCaseId/flowchartId pair", async () => {
    const caseA = await createTestRepairCase();
    const caseB = await createTestRepairCase();
    const flowchartInA = await mustCreate({ repairCaseId: caseA, actorUserId: superAdminId, title: "Case A의 Flowchart" });

    const result = await updateRepairCaseFlowchartMetadata({
      repairCaseId: caseB,
      flowchartId: flowchartInA.id,
      actorUserId: superAdminId,
      title: "가로채기 시도",
      description: null,
      expectedUpdatedAt: flowchartInA.updatedAt,
    });
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.code, "NOT_FOUND");

    const [row] = await db.select().from(repairCaseFlowcharts).where(eq(repairCaseFlowcharts.id, flowchartInA.id));
    assert.equal(row.title, "Case A의 Flowchart");
  });

  test("softDeleteRepairCaseFlowchart rejects a mismatched repairCaseId/flowchartId pair", async () => {
    const caseA = await createTestRepairCase();
    const caseB = await createTestRepairCase();
    const flowchartInA = await mustCreate({ repairCaseId: caseA, actorUserId: superAdminId, title: "Case A의 Flowchart" });

    const result = await softDeleteRepairCaseFlowchart({
      repairCaseId: caseB,
      flowchartId: flowchartInA.id,
      actorUserId: superAdminId,
      deleteReason: null,
      expectedUpdatedAt: flowchartInA.updatedAt,
    });
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.code, "NOT_FOUND");

    const [row] = await db.select().from(repairCaseFlowcharts).where(eq(repairCaseFlowcharts.id, flowchartInA.id));
    assert.equal(row.isDeleted, false);
  });
});
