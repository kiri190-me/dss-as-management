import "../../../../scripts/load-env";

import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { and, eq, inArray, like, sql } from "drizzle-orm";
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
} from "../schema";
import { createRepairCase } from "./repair-cases";
import {
  createRepairCaseFlowchart,
  updateRepairCaseFlowchartMetadata,
  softDeleteRepairCaseFlowchart,
  restoreRepairCaseFlowchart,
  permanentlyDeleteRepairCaseFlowchart,
} from "./repair-case-flowcharts";
import { createRepairCaseFlowchartNode, createRepairCaseFlowchartEdge } from "./repair-case-flowchart-graph";
import { listRepairCaseFlowcharts, getRepairCaseFlowchart, listDeletedRepairCaseFlowchartsForManagement } from "../queries/repair-case-flowcharts";
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
const TEST_MODEL_PREFIX = "FLOWCHART-6B-TEST-";

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
  await db.delete(products).where(like(products.modelName, `${TEST_MODEL_PREFIX}%`));
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

  test("AS_ENGINEER may create even when not assigned to the case (Checkpoint 3A — assignment scoping removed)", async () => {
    const repairCaseId = await createTestRepairCase({ assignedEngineerId: engineerId });
    await mustCreate({ repairCaseId, actorUserId: engineer2Id, title: "초기 진단" });
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

  test("shipment-lock removal policy: a locked (shipped) case no longer blocks create", async () => {
    const repairCaseId = await createTestRepairCase();
    await lockCase(repairCaseId);
    const result = await createRepairCaseFlowchart({ repairCaseId, actorUserId: superAdminId, title: "초기 진단", description: null });
    assert.equal(result.ok, true, JSON.stringify(result));
    if (result.ok) createdFlowchartIds.push(result.id);
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

  test("AS_ENGINEER may update even when not assigned to the case (Checkpoint 3A — assignment scoping removed)", async () => {
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
    assert.equal(result.ok, true, JSON.stringify(result));
    if (!result.ok) throw new Error("unreachable");
    assert.equal(result.changed, true);
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

  test("AS_ENGINEER may soft-delete even when not assigned to the case (Checkpoint 3A — assignment scoping removed)", async () => {
    const repairCaseId = await createTestRepairCase({ assignedEngineerId: engineerId });
    const created = await mustCreate({ repairCaseId, actorUserId: superAdminId, title: "삭제 대상" });

    const result = await softDeleteRepairCaseFlowchart({
      repairCaseId,
      flowchartId: created.id,
      actorUserId: engineer2Id,
      deleteReason: null,
      expectedUpdatedAt: created.updatedAt,
    });
    assert.equal(result.ok, true, JSON.stringify(result));

    const [row] = await db.select().from(repairCaseFlowcharts).where(eq(repairCaseFlowcharts.id, created.id));
    assert.equal(row.isDeleted, true);
    assert.equal(row.deletedBy, engineer2Id);
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

// ---------------------------------------------------------------- restore

describe("restoreRepairCaseFlowchart", () => {
  async function mustSoftDelete(params: { repairCaseId: string; flowchartId: string; actorUserId: string; expectedUpdatedAt: string }) {
    const result = await softDeleteRepairCaseFlowchart({
      repairCaseId: params.repairCaseId,
      flowchartId: params.flowchartId,
      actorUserId: params.actorUserId,
      deleteReason: null,
      expectedUpdatedAt: params.expectedUpdatedAt,
    });
    assert.equal(result.ok, true, `setup soft-delete failed: ${JSON.stringify(result)}`);
    if (!result.ok) throw new Error("unreachable");
    return result;
  }

  test("clears all four soft-delete fields and preserves title/description; appears back in the active list", async () => {
    const repairCaseId = await createTestRepairCase();
    const created = await mustCreate({ repairCaseId, actorUserId: superAdminId, title: "복원 대상", description: "설명 유지 확인" });
    await mustSoftDelete({ repairCaseId, flowchartId: created.id, actorUserId: superAdminId, expectedUpdatedAt: created.updatedAt });

    const beforeRestore = await listRepairCaseFlowcharts(repairCaseId);
    assert.equal(beforeRestore.length, 0);

    const [deletedRow] = await db.select().from(repairCaseFlowcharts).where(eq(repairCaseFlowcharts.id, created.id));

    const result = await restoreRepairCaseFlowchart({
      repairCaseId,
      flowchartId: created.id,
      actorUserId: adminId,
      expectedUpdatedAt: deletedRow.updatedAt.toISOString(),
    });
    assert.equal(result.ok, true, JSON.stringify(result));

    const [row] = await db.select().from(repairCaseFlowcharts).where(eq(repairCaseFlowcharts.id, created.id));
    assert.equal(row.isDeleted, false);
    assert.equal(row.deletedAt, null);
    assert.equal(row.deletedBy, null);
    assert.equal(row.deleteReason, null);
    assert.equal(row.title, "복원 대상");
    assert.equal(row.description, "설명 유지 확인");
    assert.equal(row.updatedBy, adminId);

    const afterRestore = await listRepairCaseFlowcharts(repairCaseId);
    assert.equal(afterRestore.length, 1);
    assert.equal(afterRestore[0].id, created.id);
  });

  test("nodes/edges/history are never touched by restore — only history GROWS by exactly one RESTORE_FLOWCHART row", async () => {
    const repairCaseId = await createTestRepairCase();
    const created = await mustCreate({ repairCaseId, actorUserId: superAdminId, title: "이력 보존 확인" });
    const deleted = await mustSoftDelete({ repairCaseId, flowchartId: created.id, actorUserId: superAdminId, expectedUpdatedAt: created.updatedAt });

    const historyBefore = await db
      .select()
      .from(repairCaseFlowchartEditHistory)
      .where(eq(repairCaseFlowchartEditHistory.flowchartId, created.id));
    assert.equal(historyBefore.length, 2, "CREATE_FLOWCHART + SOFT_DELETE_FLOWCHART");

    const result = await restoreRepairCaseFlowchart({
      repairCaseId,
      flowchartId: created.id,
      actorUserId: superAdminId,
      expectedUpdatedAt: deleted.deletedAt,
    });
    assert.equal(result.ok, true, JSON.stringify(result));

    const historyAfter = await db
      .select()
      .from(repairCaseFlowchartEditHistory)
      .where(eq(repairCaseFlowchartEditHistory.flowchartId, created.id))
      .orderBy(repairCaseFlowchartEditHistory.sequenceNumber);
    assert.equal(historyAfter.length, 3);
    assert.deepEqual(
      historyAfter.map((r) => r.actionType),
      ["CREATE_FLOWCHART", "SOFT_DELETE_FLOWCHART", "RESTORE_FLOWCHART"]
    );
    const restoreRow = historyAfter[2];
    assert.equal(restoreRow.origin, "USER_EDIT");
    assert.equal(restoreRow.sourceGroupId, null);
    assert.equal(restoreRow.restoreTargetGroupId, null);
    assert.notEqual(restoreRow.changeGroupId, historyAfter[1].changeGroupId, "restore must be its own change group, not reuse the delete's");
  });

  test("shipment-lock removal policy: a locked (shipped) case no longer blocks restore", async () => {
    const repairCaseId = await createTestRepairCase();
    const created = await mustCreate({ repairCaseId, actorUserId: superAdminId, title: "잠금 확인" });
    const deleted = await mustSoftDelete({ repairCaseId, flowchartId: created.id, actorUserId: superAdminId, expectedUpdatedAt: created.updatedAt });
    await lockCase(repairCaseId);

    const result = await restoreRepairCaseFlowchart({
      repairCaseId,
      flowchartId: created.id,
      actorUserId: superAdminId,
      expectedUpdatedAt: deleted.deletedAt,
    });
    assert.equal(result.ok, true, JSON.stringify(result));

    const [row] = await db.select().from(repairCaseFlowcharts).where(eq(repairCaseFlowcharts.id, created.id));
    assert.equal(row.isDeleted, false);
  });

  test("authorization is rechecked — SALES cannot restore", async () => {
    const repairCaseId = await createTestRepairCase();
    const created = await mustCreate({ repairCaseId, actorUserId: superAdminId, title: "권한 확인" });
    const deleted = await mustSoftDelete({ repairCaseId, flowchartId: created.id, actorUserId: superAdminId, expectedUpdatedAt: created.updatedAt });

    const result = await restoreRepairCaseFlowchart({
      repairCaseId,
      flowchartId: created.id,
      actorUserId: salesId,
      expectedUpdatedAt: deleted.deletedAt,
    });
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.code, "FORBIDDEN");
  });

  test("authorization is rechecked — INVENTORY_MANAGER cannot restore", async () => {
    const repairCaseId = await createTestRepairCase();
    const created = await mustCreate({ repairCaseId, actorUserId: superAdminId, title: "권한 확인2" });
    const deleted = await mustSoftDelete({ repairCaseId, flowchartId: created.id, actorUserId: superAdminId, expectedUpdatedAt: created.updatedAt });

    const result = await restoreRepairCaseFlowchart({
      repairCaseId,
      flowchartId: created.id,
      actorUserId: inventoryManagerId,
      expectedUpdatedAt: deleted.deletedAt,
    });
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.code, "FORBIDDEN");
  });

  test("a stale expectedUpdatedAt is rejected atomically — flowchart and history stay unchanged", async () => {
    const repairCaseId = await createTestRepairCase();
    const created = await mustCreate({ repairCaseId, actorUserId: superAdminId, title: "동시성 확인" });
    const deleted = await mustSoftDelete({ repairCaseId, flowchartId: created.id, actorUserId: superAdminId, expectedUpdatedAt: created.updatedAt });

    const historyCountBefore = await db
      .select({ id: repairCaseFlowchartEditHistory.id })
      .from(repairCaseFlowchartEditHistory)
      .where(eq(repairCaseFlowchartEditHistory.flowchartId, created.id));

    const staleUpdatedAt = new Date(new Date(deleted.deletedAt).getTime() - 1000).toISOString();
    const result = await restoreRepairCaseFlowchart({
      repairCaseId,
      flowchartId: created.id,
      actorUserId: superAdminId,
      expectedUpdatedAt: staleUpdatedAt,
    });
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.code, "STALE_REVISION");

    const [row] = await db.select().from(repairCaseFlowcharts).where(eq(repairCaseFlowcharts.id, created.id));
    assert.equal(row.isDeleted, true);

    const historyCountAfter = await db
      .select({ id: repairCaseFlowchartEditHistory.id })
      .from(repairCaseFlowchartEditHistory)
      .where(eq(repairCaseFlowchartEditHistory.flowchartId, created.id));
    assert.equal(historyCountAfter.length, historyCountBefore.length);
  });

  test("restoring an already-active (never-deleted) flowchart is rejected NOT_FOUND", async () => {
    const repairCaseId = await createTestRepairCase();
    const created = await mustCreate({ repairCaseId, actorUserId: superAdminId, title: "이미 활성 상태" });

    const result = await restoreRepairCaseFlowchart({
      repairCaseId,
      flowchartId: created.id,
      actorUserId: superAdminId,
      expectedUpdatedAt: created.updatedAt,
    });
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.code, "NOT_FOUND");
  });

  test("cross-case IDOR: restoring case B's flowchart via case A's id is rejected NOT_FOUND", async () => {
    const caseA = await createTestRepairCase();
    const caseB = await createTestRepairCase();
    const flowchartInB = await mustCreate({ repairCaseId: caseB, actorUserId: superAdminId, title: "Case B의 Flowchart" });
    const deleted = await mustSoftDelete({ repairCaseId: caseB, flowchartId: flowchartInB.id, actorUserId: superAdminId, expectedUpdatedAt: flowchartInB.updatedAt });

    const result = await restoreRepairCaseFlowchart({
      repairCaseId: caseA,
      flowchartId: flowchartInB.id,
      actorUserId: superAdminId,
      expectedUpdatedAt: deleted.deletedAt,
    });
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.code, "NOT_FOUND");

    const [row] = await db.select().from(repairCaseFlowcharts).where(eq(repairCaseFlowcharts.id, flowchartInB.id));
    assert.equal(row.isDeleted, true, "case B's flowchart must remain untouched by the mismatched-case attempt");
  });

  test("listDeletedRepairCaseFlowchartsForManagement no longer includes a restored flowchart", async () => {
    const repairCaseId = await createTestRepairCase();
    const created = await mustCreate({ repairCaseId, actorUserId: superAdminId, title: "관리 목록 확인" });
    const deleted = await mustSoftDelete({ repairCaseId, flowchartId: created.id, actorUserId: superAdminId, expectedUpdatedAt: created.updatedAt });

    const trashBefore = await listDeletedRepairCaseFlowchartsForManagement();
    assert.ok(trashBefore.some((r) => r.id === created.id));

    const result = await restoreRepairCaseFlowchart({
      repairCaseId,
      flowchartId: created.id,
      actorUserId: superAdminId,
      expectedUpdatedAt: deleted.deletedAt,
    });
    assert.equal(result.ok, true, JSON.stringify(result));

    const trashAfter = await listDeletedRepairCaseFlowchartsForManagement();
    assert.ok(!trashAfter.some((r) => r.id === created.id));
  });
});

// --------------------------------------------------------- permanent delete

describe("permanentlyDeleteRepairCaseFlowchart", () => {
  async function mustSoftDelete(params: { repairCaseId: string; flowchartId: string; actorUserId: string; expectedUpdatedAt: string }) {
    const result = await softDeleteRepairCaseFlowchart({
      repairCaseId: params.repairCaseId,
      flowchartId: params.flowchartId,
      actorUserId: params.actorUserId,
      deleteReason: null,
      expectedUpdatedAt: params.expectedUpdatedAt,
    });
    assert.equal(result.ok, true, `setup soft-delete failed: ${JSON.stringify(result)}`);
    if (!result.ok) throw new Error("unreachable");
    return result;
  }

  // A permanently-deleted flowchart's history rows never get cleaned up by
  // the shared after() hook (their flowchart_id is NULL post-purge, so
  // `inArray(flowchartId, createdFlowchartIds)` can never match them again)
  // — capture and remove them here instead, immediately after each
  // successful purge, so this suite stays fully self-cleaning. Node/edge-
  // scoped rows (CREATE_NODE/CREATE_EDGE) embed the NODE's/EDGE's own id in
  // their JSON, never the flowchart's, so "match by flowchart id in the
  // JSON" only ever finds the flowchart-level rows (CREATE_FLOWCHART/
  // SOFT_DELETE_FLOWCHART/PURGE_FLOWCHART) — the caller must capture every
  // pre-purge row's own id first and pass it in here, then this only needs
  // to additionally locate the one new PURGE_FLOWCHART row by content.
  async function cleanupPurgedHistory(flowchartId: string, priorHistoryIds: string[]) {
    const purgeRows = await db
      .select({ id: repairCaseFlowchartEditHistory.id })
      .from(repairCaseFlowchartEditHistory)
      .where(sql`${repairCaseFlowchartEditHistory.actionType} = 'PURGE_FLOWCHART' AND ${repairCaseFlowchartEditHistory.beforeState}->>'id' = ${flowchartId}`);
    const allIds = [...priorHistoryIds, ...purgeRows.map((r) => r.id)];
    if (allIds.length > 0) {
      await db.delete(repairCaseFlowchartEditHistory).where(inArray(repairCaseFlowchartEditHistory.id, allIds));
    }
  }

  test("clears the flowchart row, cascades edges then nodes, and preserves history via flowchart_id SET NULL", async () => {
    const repairCaseId = await createTestRepairCase();
    const created = await mustCreate({ repairCaseId, actorUserId: superAdminId, title: "완전 삭제 대상" });

    const node1 = await createRepairCaseFlowchartNode({
      repairCaseId,
      flowchartId: created.id,
      actorUserId: superAdminId,
      nodeType: "START",
      title: "시작",
      description: null,
      expectedFlowchartUpdatedAt: created.updatedAt,
    });
    assert.equal(node1.ok, true, JSON.stringify(node1));
    if (!node1.ok) return;

    const node2 = await createRepairCaseFlowchartNode({
      repairCaseId,
      flowchartId: created.id,
      actorUserId: superAdminId,
      nodeType: "TASK",
      title: "작업",
      description: null,
      expectedFlowchartUpdatedAt: node1.updatedAt,
    });
    assert.equal(node2.ok, true, JSON.stringify(node2));
    if (!node2.ok) return;

    const edge = await createRepairCaseFlowchartEdge({
      repairCaseId,
      flowchartId: created.id,
      actorUserId: superAdminId,
      fromNodeId: node1.nodeId,
      toNodeId: node2.nodeId,
      branchType: "DEFAULT",
      branchLabel: null,
      expectedFlowchartUpdatedAt: node2.updatedAt,
    });
    assert.equal(edge.ok, true, JSON.stringify(edge));
    if (!edge.ok) return;

    const deleted = await mustSoftDelete({ repairCaseId, flowchartId: created.id, actorUserId: superAdminId, expectedUpdatedAt: edge.updatedAt });

    const historyBefore = await db.select().from(repairCaseFlowchartEditHistory).where(eq(repairCaseFlowchartEditHistory.flowchartId, created.id));
    assert.equal(historyBefore.length, 5, "CREATE_FLOWCHART + CREATE_NODE x2 + CREATE_EDGE + SOFT_DELETE_FLOWCHART");

    const result = await permanentlyDeleteRepairCaseFlowchart({
      repairCaseId,
      flowchartId: created.id,
      actorUserId: adminId,
      deleteReason: "테스트: 완전 삭제 검증",
      expectedUpdatedAt: deleted.deletedAt,
    });
    assert.equal(result.ok, true, JSON.stringify(result));

    const [flowchartRow] = await db.select().from(repairCaseFlowcharts).where(eq(repairCaseFlowcharts.id, created.id));
    assert.equal(flowchartRow, undefined, "the flowchart row itself must be hard-deleted");

    const remainingNodes = await db.select().from(repairCaseFlowchartNodes).where(eq(repairCaseFlowchartNodes.flowchartId, created.id));
    assert.equal(remainingNodes.length, 0, "nodes must be hard-deleted");

    const remainingEdges = await db.select().from(repairCaseFlowchartEdges).where(eq(repairCaseFlowchartEdges.flowchartId, created.id));
    assert.equal(remainingEdges.length, 0, "edges must be hard-deleted");

    // History survives: every one of the 5 pre-purge rows (captured by
    // their own id before the purge, since post-purge their flowchart_id —
    // and for the node/edge-scoped rows, their node_id/edge_id too — are
    // all NULL) is still present, plus exactly one new PURGE_FLOWCHART row.
    const historyIdsBefore = historyBefore.map((r) => r.id);
    const survivingPriorRows = await db
      .select()
      .from(repairCaseFlowchartEditHistory)
      .where(inArray(repairCaseFlowchartEditHistory.id, historyIdsBefore));
    assert.equal(survivingPriorRows.length, 5, "all 5 prior rows must survive the hard delete");
    for (const row of survivingPriorRows) {
      assert.equal(row.flowchartId, null, `${row.actionType} row's flowchart_id must be NULL after the hard delete`);
    }

    const [purgeRow] = await db
      .select()
      .from(repairCaseFlowchartEditHistory)
      .where(sql`${repairCaseFlowchartEditHistory.actionType} = 'PURGE_FLOWCHART' AND ${repairCaseFlowchartEditHistory.beforeState}->>'id' = ${created.id}`);
    assert.ok(purgeRow, "a PURGE_FLOWCHART row must exist");
    assert.equal(purgeRow.flowchartId, null);
    assert.equal(purgeRow.reason, "테스트: 완전 삭제 검증");
    assert.equal(purgeRow.actorUserId, adminId);
    assert.equal((purgeRow.beforeState as { title: string }).title, "완전 삭제 대상");
    assert.equal(purgeRow.afterState, null);

    await cleanupPurgedHistory(created.id, historyIdsBefore);
  });

  test("shipment-lock removal policy / no case-lock restriction: works even when the case is locked", async () => {
    const repairCaseId = await createTestRepairCase();
    const created = await mustCreate({ repairCaseId, actorUserId: superAdminId, title: "잠금 무관 확인" });
    const deleted = await mustSoftDelete({ repairCaseId, flowchartId: created.id, actorUserId: superAdminId, expectedUpdatedAt: created.updatedAt });
    await lockCase(repairCaseId);

    const historyIdsBefore = (
      await db.select({ id: repairCaseFlowchartEditHistory.id }).from(repairCaseFlowchartEditHistory).where(eq(repairCaseFlowchartEditHistory.flowchartId, created.id))
    ).map((r) => r.id);

    const result = await permanentlyDeleteRepairCaseFlowchart({
      repairCaseId,
      flowchartId: created.id,
      actorUserId: superAdminId,
      deleteReason: "잠금 무관 삭제 확인",
      expectedUpdatedAt: deleted.deletedAt,
    });
    assert.equal(result.ok, true, JSON.stringify(result));

    await cleanupPurgedHistory(created.id, historyIdsBefore);
  });

  test("authorization is rechecked — AS_ENGINEER cannot permanently delete (can soft-delete/restore, never purge)", async () => {
    const repairCaseId = await createTestRepairCase();
    const created = await mustCreate({ repairCaseId, actorUserId: superAdminId, title: "AS_ENGINEER 권한 확인" });
    const deleted = await mustSoftDelete({ repairCaseId, flowchartId: created.id, actorUserId: engineerId, expectedUpdatedAt: created.updatedAt });

    const result = await permanentlyDeleteRepairCaseFlowchart({
      repairCaseId,
      flowchartId: created.id,
      actorUserId: engineerId,
      deleteReason: "권한 없는 시도",
      expectedUpdatedAt: deleted.deletedAt,
    });
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.code, "FORBIDDEN");

    const [row] = await db.select().from(repairCaseFlowcharts).where(eq(repairCaseFlowcharts.id, created.id));
    assert.equal(row.isDeleted, true, "must remain intact — only rejected, never partially deleted");
  });

  test("authorization is rechecked — SALES cannot permanently delete", async () => {
    const repairCaseId = await createTestRepairCase();
    const created = await mustCreate({ repairCaseId, actorUserId: superAdminId, title: "SALES 권한 확인" });
    const deleted = await mustSoftDelete({ repairCaseId, flowchartId: created.id, actorUserId: superAdminId, expectedUpdatedAt: created.updatedAt });

    const result = await permanentlyDeleteRepairCaseFlowchart({
      repairCaseId,
      flowchartId: created.id,
      actorUserId: salesId,
      deleteReason: "권한 없는 시도",
      expectedUpdatedAt: deleted.deletedAt,
    });
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.code, "FORBIDDEN");
  });

  test("permanently deleting an active (never soft-deleted) flowchart is rejected NOT_FOUND", async () => {
    const repairCaseId = await createTestRepairCase();
    const created = await mustCreate({ repairCaseId, actorUserId: superAdminId, title: "아직 활성 상태" });

    const result = await permanentlyDeleteRepairCaseFlowchart({
      repairCaseId,
      flowchartId: created.id,
      actorUserId: superAdminId,
      deleteReason: "시도",
      expectedUpdatedAt: created.updatedAt,
    });
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.code, "NOT_FOUND");
  });

  test("cross-case IDOR: permanently deleting case B's flowchart via case A's id is rejected NOT_FOUND", async () => {
    const caseA = await createTestRepairCase();
    const caseB = await createTestRepairCase();
    const flowchartInB = await mustCreate({ repairCaseId: caseB, actorUserId: superAdminId, title: "Case B의 Flowchart" });
    const deleted = await mustSoftDelete({ repairCaseId: caseB, flowchartId: flowchartInB.id, actorUserId: superAdminId, expectedUpdatedAt: flowchartInB.updatedAt });

    const result = await permanentlyDeleteRepairCaseFlowchart({
      repairCaseId: caseA,
      flowchartId: flowchartInB.id,
      actorUserId: superAdminId,
      deleteReason: "가로채기 시도",
      expectedUpdatedAt: deleted.deletedAt,
    });
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.code, "NOT_FOUND");

    const [row] = await db.select().from(repairCaseFlowcharts).where(eq(repairCaseFlowcharts.id, flowchartInB.id));
    assert.equal(row.isDeleted, true, "case B's flowchart must remain untouched by the mismatched-case attempt");
  });

  test("a stale expectedUpdatedAt is rejected atomically — flowchart and history stay unchanged", async () => {
    const repairCaseId = await createTestRepairCase();
    const created = await mustCreate({ repairCaseId, actorUserId: superAdminId, title: "동시성 확인" });
    const deleted = await mustSoftDelete({ repairCaseId, flowchartId: created.id, actorUserId: superAdminId, expectedUpdatedAt: created.updatedAt });

    const historyCountBefore = await db
      .select({ id: repairCaseFlowchartEditHistory.id })
      .from(repairCaseFlowchartEditHistory)
      .where(eq(repairCaseFlowchartEditHistory.flowchartId, created.id));

    const staleUpdatedAt = new Date(new Date(deleted.deletedAt).getTime() - 1000).toISOString();
    const result = await permanentlyDeleteRepairCaseFlowchart({
      repairCaseId,
      flowchartId: created.id,
      actorUserId: superAdminId,
      deleteReason: "오래된 버전으로 시도",
      expectedUpdatedAt: staleUpdatedAt,
    });
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.code, "STALE_REVISION");

    const [row] = await db.select().from(repairCaseFlowcharts).where(eq(repairCaseFlowcharts.id, created.id));
    assert.ok(row, "the flowchart row must still exist");
    assert.equal(row.isDeleted, true);

    const historyCountAfter = await db
      .select({ id: repairCaseFlowchartEditHistory.id })
      .from(repairCaseFlowchartEditHistory)
      .where(eq(repairCaseFlowchartEditHistory.flowchartId, created.id));
    assert.equal(historyCountAfter.length, historyCountBefore.length);
  });

  test("restore vs. permanent delete race: once purged, a subsequent restore attempt correctly sees NOT_FOUND", async () => {
    const repairCaseId = await createTestRepairCase();
    const created = await mustCreate({ repairCaseId, actorUserId: superAdminId, title: "경합 확인" });
    const deleted = await mustSoftDelete({ repairCaseId, flowchartId: created.id, actorUserId: superAdminId, expectedUpdatedAt: created.updatedAt });

    const historyIdsBefore = (
      await db.select({ id: repairCaseFlowchartEditHistory.id }).from(repairCaseFlowchartEditHistory).where(eq(repairCaseFlowchartEditHistory.flowchartId, created.id))
    ).map((r) => r.id);

    const purgeResult = await permanentlyDeleteRepairCaseFlowchart({
      repairCaseId,
      flowchartId: created.id,
      actorUserId: superAdminId,
      deleteReason: "경합 시나리오 사전 삭제",
      expectedUpdatedAt: deleted.deletedAt,
    });
    assert.equal(purgeResult.ok, true, JSON.stringify(purgeResult));

    const restoreResult = await restoreRepairCaseFlowchart({
      repairCaseId,
      flowchartId: created.id,
      actorUserId: superAdminId,
      expectedUpdatedAt: deleted.deletedAt,
    });
    assert.equal(restoreResult.ok, false);
    if (!restoreResult.ok) assert.equal(restoreResult.code, "NOT_FOUND");

    await cleanupPurgedHistory(created.id, historyIdsBefore);
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
