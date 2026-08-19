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
  repairCaseFlowchartEditHistory,
  auditLogs,
} from "../schema";
import { createRepairCase } from "./repair-cases";
import { createRepairCaseFlowchart, softDeleteRepairCaseFlowchart, restoreRepairCaseFlowchart, permanentlyDeleteRepairCaseFlowchart } from "./repair-case-flowcharts";
import { purgeExpiredRepairCaseFlowchart, listPurgeEligibleFlowchartIds, runFlowchartPurgeSweep } from "./repair-case-flowchart-purge";
import { FLOWCHART_TRASH_RETENTION_DAYS } from "@/lib/domain/repair-case-flowchart-retention";
import type { ValidatedCreateRepairCaseInput } from "@/lib/validation/repair-case-input";

/**
 * Automatic 15-day flowchart-purge sweep — integration tests. Self-cleaning
 * convention identical to repair-case-flowcharts.integration.test.ts's own
 * suite (own isolated TEST_YEAR_MONTH, never reused across test files).
 * `deleted_at` is directly backdated via a raw UPDATE (no real 15-day wait)
 * — this is test-owned rows only, never touching genuine data.
 *
 * TEST_YEAR_MONTH was previously "9914", which never actually matched the
 * intake numbers RECEIVED_AT ("2098-01-10") really produces (D9801xx) — a
 * latent bug from an earlier checkpoint (the intake number's year-month is
 * always derived from receivedAt, never from this constant directly). Its
 * own repair_cases/sequence cleanup below was silent dead code that only
 * ever appeared to work because it happened to share the real "9801" month
 * with repair-case-flowcharts.integration.test.ts, which cleaned up after
 * it when both ran in the same test:db invocation — running this file in
 * isolation exposed the gap (products cleanup added by the End-User
 * multi-contact TEST-data-orphan checkpoint failed with a live FK
 * violation, since the real D9801xx rows were still present). Fixed here by
 * giving this file its own genuinely unique month ("9807") instead of
 * continuing to piggyback on "9801".
 */

const TEST_YEAR_MONTH = "9807";
const RECEIVED_AT = "2098-07-10";
const SHIPMENT_DATE = "2098-07-20";
const MS_PER_DAY = 24 * 60 * 60 * 1000;
const TEST_MODEL_PREFIX = "FLOWCHART-PURGE-TEST-";

let superAdminId: string;
let engineerId: string;
let customerId: string;

// Flowcharts NOT expected to be hard-deleted by any test (still-active or
// deliberately-not-eligible rows) — cleaned up the normal way in after().
const createdFlowchartIds: string[] = [];
// Flowcharts that end up hard-deleted during a test (whether via
// purgeExpiredRepairCaseFlowchart or the manual permanentlyDeleteRepairCaseFlowchart
// used as race-condition setup) — their history rows survive with
// flowchart_id nulled, so after() can't find them via that column anymore.
// Every id pushed here gets its orphaned history rows located by content
// (before_state/after_state's embedded flowchart id — only the
// CREATE_FLOWCHART/SOFT_DELETE_FLOWCHART/PURGE_FLOWCHART rows this suite
// ever produces, none of which are node/edge-scoped) and removed.
const purgedFlowchartIds: string[] = [];

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
  return result.id;
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
  return result;
}

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

/** Directly rewrites deleted_at to simulate a flowchart that's been sitting in 휴지통 for `daysAgo` days — no real waiting, test-owned rows only. */
async function backdateDeletedAt(flowchartId: string, daysAgo: number) {
  await db.update(repairCaseFlowcharts).set({ deletedAt: new Date(Date.now() - daysAgo * MS_PER_DAY) }).where(eq(repairCaseFlowcharts.id, flowchartId));
}

/** Sets up a flowchart soft-deleted exactly at (or past) the retention threshold — eligible for purge right now. */
async function createEligibleFlowchart(repairCaseId: string, title: string, extraDaysPastThreshold = 1) {
  const created = await mustCreate({ repairCaseId, actorUserId: superAdminId, title });
  const deleted = await mustSoftDelete({ repairCaseId, flowchartId: created.id, actorUserId: superAdminId, expectedUpdatedAt: created.updatedAt });
  await backdateDeletedAt(created.id, FLOWCHART_TRASH_RETENTION_DAYS + extraDaysPastThreshold);
  return { id: created.id, repairCaseId, deletedAt: deleted.deletedAt };
}

before(async () => {
  const [superAdmin] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.role, "SUPER_ADMIN"))
    .limit(1);
  assert.ok(superAdmin, "expected an approved SUPER_ADMIN in the dev DB");
  superAdminId = superAdmin.id;

  const [engineer] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.role, "AS_ENGINEER"))
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
    await db.delete(repairCaseFlowcharts).where(inArray(repairCaseFlowcharts.id, createdFlowchartIds));
  }
  for (const flowchartId of purgedFlowchartIds) {
    await db
      .delete(repairCaseFlowchartEditHistory)
      .where(sql`${repairCaseFlowchartEditHistory.beforeState}->>'id' = ${flowchartId} OR ${repairCaseFlowchartEditHistory.afterState}->>'id' = ${flowchartId}`);
    await db.delete(auditLogs).where(and(
      eq(auditLogs.targetEntity, "repair_case_flowcharts"),
      eq(auditLogs.targetRecordId, flowchartId)
    ));
  }
  await db.delete(repairCases).where(like(repairCases.intakeNumber, `D${TEST_YEAR_MONTH}%`));
  await db.delete(products).where(like(products.modelName, `${TEST_MODEL_PREFIX}%`));
  await db.delete(repairCaseIntakeSequences).where(eq(repairCaseIntakeSequences.yearMonth, TEST_YEAR_MONTH));
  await pgClient.end({ timeout: 5 });
});

describe("purgeExpiredRepairCaseFlowchart", () => {
  test("purges an eligible flowchart: deletes edges/nodes/flowchart, preserves prior history via SET NULL, writes one audit_logs row with actor_user_id = NULL", async () => {
    const repairCaseId = await createTestRepairCase();
    const eligible = await createEligibleFlowchart(repairCaseId, "만료된 Flowchart");

    const historyBeforeIds = (
      await db.select({ id: repairCaseFlowchartEditHistory.id }).from(repairCaseFlowchartEditHistory).where(eq(repairCaseFlowchartEditHistory.flowchartId, eligible.id))
    ).map((r) => r.id);
    assert.equal(historyBeforeIds.length, 2, "CREATE_FLOWCHART + SOFT_DELETE_FLOWCHART");

    const outcome = await purgeExpiredRepairCaseFlowchart(eligible.id);
    assert.equal(outcome, "PURGED");
    purgedFlowchartIds.push(eligible.id);

    const [row] = await db.select().from(repairCaseFlowcharts).where(eq(repairCaseFlowcharts.id, eligible.id));
    assert.equal(row, undefined, "the flowchart row itself must be hard-deleted");

    const survivingHistory = await db.select().from(repairCaseFlowchartEditHistory).where(inArray(repairCaseFlowchartEditHistory.id, historyBeforeIds));
    assert.equal(survivingHistory.length, 2, "prior history rows survive with flowchart_id nulled");
    for (const row of survivingHistory) assert.equal(row.flowchartId, null);

    const auditRows = await db.select().from(auditLogs).where(eq(auditLogs.targetRecordId, eligible.id));
    assert.equal(auditRows.length, 1, "exactly one audit_logs row");
    const [auditRow] = auditRows;
    assert.equal(auditRow.actorUserId, null);
    assert.equal(auditRow.actionType, "PURGE");
    assert.equal(auditRow.targetEntity, "repair_case_flowcharts");
    assert.equal(auditRow.targetRecordId, eligible.id);
    assert.equal((auditRow.previousValue as { title: string }).title, "만료된 Flowchart");
    assert.equal(auditRow.newValue, null);
  });

  test("restore wins: a flowchart restored before the sweep runs is left fully intact (SKIPPED_RESTORED)", async () => {
    const repairCaseId = await createTestRepairCase();
    const eligible = await createEligibleFlowchart(repairCaseId, "복원 우선 확인");

    const [deletedRow] = await db.select().from(repairCaseFlowcharts).where(eq(repairCaseFlowcharts.id, eligible.id));
    const restoreResult = await restoreRepairCaseFlowchart({
      repairCaseId,
      flowchartId: eligible.id,
      actorUserId: superAdminId,
      expectedUpdatedAt: deletedRow.updatedAt.toISOString(),
    });
    assert.equal(restoreResult.ok, true, JSON.stringify(restoreResult));
    createdFlowchartIds.push(eligible.id);

    const outcome = await purgeExpiredRepairCaseFlowchart(eligible.id);
    assert.equal(outcome, "SKIPPED_RESTORED");

    const [row] = await db.select().from(repairCaseFlowcharts).where(eq(repairCaseFlowcharts.id, eligible.id));
    assert.ok(row, "the flowchart must still exist");
    assert.equal(row.isDeleted, false);
  });

  test("already-purged (e.g. by manual permanent delete) is skipped benignly (SKIPPED_ALREADY_GONE)", async () => {
    const repairCaseId = await createTestRepairCase();
    const eligible = await createEligibleFlowchart(repairCaseId, "수동 삭제 후 자동 삭제 시도");

    const [row] = await db.select().from(repairCaseFlowcharts).where(eq(repairCaseFlowcharts.id, eligible.id));
    const manualResult = await permanentlyDeleteRepairCaseFlowchart({
      repairCaseId,
      flowchartId: eligible.id,
      actorUserId: superAdminId,
      deleteReason: "테스트: 수동 완전 삭제 선행",
      expectedUpdatedAt: row.updatedAt.toISOString(),
    });
    assert.equal(manualResult.ok, true, JSON.stringify(manualResult));
    purgedFlowchartIds.push(eligible.id);

    const outcome = await purgeExpiredRepairCaseFlowchart(eligible.id);
    assert.equal(outcome, "SKIPPED_ALREADY_GONE");

    // Manual purge already wrote its own PURGE_FLOWCHART history row —
    // confirm the automatic path never wrote an audit_logs row for an id
    // that's already gone (manual purge doesn't use audit_logs at all).
    const auditRows = await db.select().from(auditLogs).where(eq(auditLogs.targetRecordId, eligible.id));
    assert.equal(auditRows.length, 0, "no audit_logs row for a no-op skip");
  });

  test("concurrent purge race: two simultaneous attempts on the same eligible flowchart — exactly one purges, the other sees SKIPPED_ALREADY_GONE", async () => {
    const repairCaseId = await createTestRepairCase();
    const eligible = await createEligibleFlowchart(repairCaseId, "동시 삭제 경합 확인");
    purgedFlowchartIds.push(eligible.id);

    const [first, second] = await Promise.all([
      purgeExpiredRepairCaseFlowchart(eligible.id),
      purgeExpiredRepairCaseFlowchart(eligible.id),
    ]);
    const outcomes = [first, second].sort();
    assert.deepEqual(outcomes, ["PURGED", "SKIPPED_ALREADY_GONE"]);

    const [row] = await db.select().from(repairCaseFlowcharts).where(eq(repairCaseFlowcharts.id, eligible.id));
    assert.equal(row, undefined);

    const auditRows = await db.select().from(auditLogs).where(eq(auditLogs.targetRecordId, eligible.id));
    assert.equal(auditRows.length, 1, "exactly one audit_logs row despite two concurrent attempts");
  });

  test("a flowchart soft-deleted fewer than 15 days ago is not eligible (SKIPPED_NOT_ELIGIBLE), even when purged directly by id", async () => {
    const repairCaseId = await createTestRepairCase();
    const created = await mustCreate({ repairCaseId, actorUserId: superAdminId, title: "아직 만료 전" });
    await mustSoftDelete({ repairCaseId, flowchartId: created.id, actorUserId: superAdminId, expectedUpdatedAt: created.updatedAt });
    await backdateDeletedAt(created.id, FLOWCHART_TRASH_RETENTION_DAYS - 5);
    createdFlowchartIds.push(created.id);

    const outcome = await purgeExpiredRepairCaseFlowchart(created.id);
    assert.equal(outcome, "SKIPPED_NOT_ELIGIBLE");

    const [row] = await db.select().from(repairCaseFlowcharts).where(eq(repairCaseFlowcharts.id, created.id));
    assert.ok(row, "must remain intact");
    assert.equal(row.isDeleted, true);
  });

  test("purgeExpiredRepairCaseFlowchart throws for a malformed id (proves the sweep's per-row try/catch has something real to catch)", async () => {
    await assert.rejects(() => purgeExpiredRepairCaseFlowchart("not-a-real-uuid"));
  });
});

describe("listPurgeEligibleFlowchartIds", () => {
  test("returns only soft-deleted flowcharts at or past the threshold — never active or not-yet-eligible ones", async () => {
    const repairCaseId = await createTestRepairCase();
    const eligible = await createEligibleFlowchart(repairCaseId, "포함 대상");
    purgedFlowchartIds.push(eligible.id);

    const stillActive = await mustCreate({ repairCaseId, actorUserId: superAdminId, title: "활성 상태" });
    createdFlowchartIds.push(stillActive.id);

    const notYetEligible = await mustCreate({ repairCaseId, actorUserId: superAdminId, title: "최근 삭제" });
    await mustSoftDelete({ repairCaseId, flowchartId: notYetEligible.id, actorUserId: superAdminId, expectedUpdatedAt: notYetEligible.updatedAt });
    createdFlowchartIds.push(notYetEligible.id);

    const threshold = new Date(Date.now() - FLOWCHART_TRASH_RETENTION_DAYS * MS_PER_DAY);
    const ids = await listPurgeEligibleFlowchartIds(threshold);

    assert.ok(ids.includes(eligible.id));
    assert.ok(!ids.includes(stillActive.id));
    assert.ok(!ids.includes(notYetEligible.id));

    const outcome = await purgeExpiredRepairCaseFlowchart(eligible.id);
    assert.equal(outcome, "PURGED");
  });
});

describe("runFlowchartPurgeSweep", () => {
  // Restore-wins and already-gone races are already proven directly against
  // purgeExpiredRepairCaseFlowchart above (including a genuine concurrent
  // race via Promise.all) — a row resolved (restored/manually purged)
  // BEFORE the sweep's own selection query runs is never even selected as a
  // candidate in the first place (listPurgeEligibleFlowchartIds only
  // matches is_deleted = true rows past the threshold), so this test
  // focuses on what only the sweep's own orchestration can prove: multiple
  // independent eligible flowcharts all get purged in one run, correctly
  // aggregated, with the batch never aborting partway through.
  test("purges multiple independent eligible flowcharts in one run and aggregates correct counts", async () => {
    const repairCaseId = await createTestRepairCase();

    const first = await createEligibleFlowchart(repairCaseId, "일괄 삭제 대상 1");
    purgedFlowchartIds.push(first.id);
    const second = await createEligibleFlowchart(repairCaseId, "일괄 삭제 대상 2");
    purgedFlowchartIds.push(second.id);

    const now = new Date();
    const summary = await runFlowchartPurgeSweep(now);

    assert.ok(summary.eligible >= 2, "at least the 2 rows this test set up");
    assert.ok(summary.purged >= 2, "both first and second must be counted as purged");
    assert.equal(summary.errored, 0);

    const [firstRow] = await db.select().from(repairCaseFlowcharts).where(eq(repairCaseFlowcharts.id, first.id));
    assert.equal(firstRow, undefined);
    const [secondRow] = await db.select().from(repairCaseFlowcharts).where(eq(repairCaseFlowcharts.id, second.id));
    assert.equal(secondRow, undefined);

    const auditCount = await db.select({ id: auditLogs.id }).from(auditLogs).where(inArray(auditLogs.targetRecordId, [first.id, second.id]));
    assert.equal(auditCount.length, 2, "one audit_logs row per purged flowchart");
  });
});
