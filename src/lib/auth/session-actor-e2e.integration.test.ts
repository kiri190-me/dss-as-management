import "../../../scripts/load-env";

import { after, afterEach, before, beforeEach, describe, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { and, eq, isNull, like } from "drizzle-orm";
import { db, pgClient } from "@/lib/db/connection";
import { customers, products, repairCaseIntakeSequences, repairCases, statusChangeHistories, users } from "@/lib/db/schema";
import { resolveDbLogin } from "./db-login";
import { createSessionToken, parseSessionToken } from "./session";
import { resolveActingUserForSession } from "./acting-user";
import { createRepairCase } from "@/lib/db/mutations/repair-cases";
import { transitionWorkflow } from "@/lib/db/mutations/workflow-transitions";
import type { ValidatedCreateRepairCaseInput } from "@/lib/validation/repair-case-input";

/**
 * Protected-action end-to-end test for the session/DB-user mismatch fix.
 * Drives the exact real path a request takes: DB login (resolveDbLogin) →
 * signed session cookie (createSessionToken/parseSessionToken) →
 * centralized session→user resolution (resolveActingUserForSession, in
 * AUTH_SOURCE=database mode) → a protected DB mutation that stamps the
 * actor (transitionWorkflow). Before this fix, the only login path
 * (DEMO_LOGIN_ENABLED/mock) produced session.userId values like "u-001"
 * that never match a real `users.id` UUID, so this same chain would have
 * failed at transitionWorkflow's FORBIDDEN check for every user, every
 * time — see workflow-transitions.integration.test.ts's module comment and
 * the final report.
 *
 * transitionWorkflow itself is not modified or reimplemented here — only
 * exercised through its public signature, same as
 * workflow-transitions.integration.test.ts.
 *
 * Self-cleaning and isolated to test month "9905" / product prefix
 * "AUTHFIX-TEST-", distinct from every other isolated-month suite in this
 * directory (9901/9902/9903/9904).
 */

const TEST_RECEIVED_AT = "2099-05-10";
const TEST_SHIPMENT_DATE = "2099-05-20";
const TEST_MODEL_PREFIX = "AUTHFIX-TEST-";
const TEST_YEAR_MONTH = "9905";

let originalAuthSource: string | undefined;
let customerId: string;
let engineerEmail: string;
let engineerId: string;

before(async () => {
  const [customer] = await db
    .select({ id: customers.id })
    .from(customers)
    .where(eq(customers.isDeleted, false))
    .limit(1);
  assert.ok(customer, "expected at least one non-deleted customer in the dev DB");
  customerId = customer.id;

  const [engineer] = await db
    .select({ id: users.id, email: users.email })
    .from(users)
    .where(
      and(
        eq(users.role, "AS_ENGINEER"),
        eq(users.approvalStatus, "APPROVED"),
        eq(users.isDeleted, false),
        eq(users.isActive, true),
        isNull(users.lockedAt)
      )
    )
    .limit(1);
  assert.ok(engineer, "expected at least one approved, active, unlocked AS_ENGINEER in the dev DB");
  engineerId = engineer.id;
  engineerEmail = engineer.email;
});

after(async () => {
  const testCaseIds = await db
    .select({ id: repairCases.id })
    .from(repairCases)
    .where(like(repairCases.intakeNumber, "D9905%"));
  for (const { id } of testCaseIds) {
    await db.delete(statusChangeHistories).where(eq(statusChangeHistories.repairCaseId, id));
  }
  await db.delete(repairCases).where(like(repairCases.intakeNumber, "D9905%"));
  await db.delete(products).where(like(products.modelName, `${TEST_MODEL_PREFIX}%`));
  await db.delete(repairCaseIntakeSequences).where(eq(repairCaseIntakeSequences.yearMonth, TEST_YEAR_MONTH));
  await pgClient.end({ timeout: 5 });
});

beforeEach(() => {
  originalAuthSource = process.env.AUTH_SOURCE;
  process.env.AUTH_SOURCE = "database";
});

afterEach(() => {
  if (originalAuthSource === undefined) delete process.env.AUTH_SOURCE;
  else process.env.AUTH_SOURCE = originalAuthSource;
});

function baseCreateInput(): ValidatedCreateRepairCaseInput {
  const suffix = randomUUID().slice(0, 8);
  return {
    workflowType: "MATCHER",
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

describe("session -> DB actor end-to-end (AUTH_SOURCE=database)", () => {
  test("DB login produces a session whose userId, once resolved, successfully drives a protected mutation", async () => {
    // 1. Login: email -> real DB user (never a mock id).
    const loginResult = await resolveDbLogin(engineerEmail);
    assert.equal(loginResult.outcome, "SESSION");
    if (loginResult.outcome !== "SESSION") return;
    assert.equal(loginResult.user.id, engineerId);

    // 2. Session cookie round-trip: sign, then verify+parse exactly like readSession() would.
    const token = createSessionToken(loginResult.user);
    const session = parseSessionToken(token);
    assert.ok(session, "signed session token must parse back successfully");
    if (!session) return;
    assert.equal(session.userId, engineerId);

    // 3. Centralized resolver: session -> ActingUser, reading the real DB row.
    const actingUser = await resolveActingUserForSession(session);
    assert.ok(actingUser, "resolveActingUserForSession must resolve a real DB-backed session");
    if (!actingUser) return;
    assert.equal(actingUser.id, engineerId);
    assert.equal(actingUser.role, "AS_ENGINEER");

    // 4. Protected mutation: the resolved actingUser.id must be accepted as
    //    a legitimate actor (this is exactly where the pre-fix mock id
    //    would have been rejected with FORBIDDEN).
    const created = await createRepairCase(baseCreateInput());
    assert.equal(created.ok, true, `setup create failed: ${JSON.stringify(created)}`);
    if (!created.ok) return;

    const result = await transitionWorkflow(created.id, 1, "STEP_ADVANCED", actingUser.id, null);
    assert.equal(result.ok, true, `transition failed: ${JSON.stringify(result)}`);
    if (!result.ok) return;

    const historyRows = await db
      .select({ actorUserId: statusChangeHistories.actorUserId })
      .from(statusChangeHistories)
      .where(eq(statusChangeHistories.repairCaseId, created.id));
    assert.equal(historyRows.length, 1);
    assert.equal(historyRows[0].actorUserId, engineerId, "history must record the real, session-resolved actor");
  });
});
