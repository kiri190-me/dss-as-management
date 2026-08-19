import "../../../../scripts/load-env";

import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { and, eq, inArray, like, sql } from "drizzle-orm";
import { db, pgClient } from "../connection";
import {
  customers,
  users,
  repairCases,
  products,
  repairCaseIdempotencyKeys,
  repairCaseIntakeSequences,
} from "../schema";
import { createRepairCase } from "./repair-cases";
import {
  claimIdempotencyKey,
  markIdempotencyKeyFailed,
  markIdempotencyKeySucceeded,
} from "./idempotency-keys";
import type { ValidatedCreateRepairCaseInput } from "@/lib/validation/repair-case-input";

/**
 * Real-DB integration test against dss-as-postgres-dev, exercising the
 * claim/replay/retry idempotency flow from
 * src/lib/server/actions/create-repair-case.ts directly against Postgres
 * (createRepairCase + claimIdempotencyKey/markIdempotencyKey* composed the
 * same way the Server Action composes them, without the cookies/session
 * layer).
 *
 * Deliberately self-cleaning, and deliberately isolated to a test-only
 * intake month ("9901" / 2099-01) and a "IDEMP-TEST-" product-name prefix —
 * this file must never touch the real D2608 bucket. (2026-08-05's cleanup
 * task removed ~2 hours of accumulated concurrency-test rows from that
 * bucket precisely because an earlier test file, repair-cases.integration.
 * test.ts, didn't self-clean; both files now isolate + clean up.)
 */

const TEST_MODEL_PREFIX = "IDEMP-TEST-";
const TEST_RECEIVED_AT = "2099-01-10";
const TEST_SHIPMENT_DATE = "2099-01-20";
const TEST_YEAR_MONTH = "9901";

let customerId: string;
let engineerId: string;
let userAId: string;
let userBId: string;

const createdIdempotencyKeys: string[] = [];

before(async () => {
  const [customer] = await db
    .select({ id: customers.id })
    .from(customers)
    .where(eq(customers.isDeleted, false))
    .limit(1);
  assert.ok(customer, "expected at least one non-deleted customer in the dev DB");
  customerId = customer.id;

  const [engineer] = await db
    .select({ id: users.id })
    .from(users)
    .where(
      and(eq(users.role, "AS_ENGINEER"), eq(users.approvalStatus, "APPROVED"), eq(users.isDeleted, false))
    )
    .limit(1);
  assert.ok(engineer, "expected at least one approved AS_ENGINEER in the dev DB");
  engineerId = engineer.id;
  userAId = engineer.id;

  const [otherUser] = await db
    .select({ id: users.id })
    .from(users)
    .where(and(eq(users.isDeleted, false), sql`${users.id} <> ${engineer.id}`))
    .limit(1);
  assert.ok(otherUser, "expected at least two distinct non-deleted users in the dev DB");
  userBId = otherUser.id;
});

after(async () => {
  // Deletion order matters: repair_case_idempotency_keys.repair_case_id
  // references repair_cases with ON DELETE RESTRICT.
  if (createdIdempotencyKeys.length > 0) {
    await db
      .delete(repairCaseIdempotencyKeys)
      .where(inArray(repairCaseIdempotencyKeys.idempotencyKey, createdIdempotencyKeys));
  }
  await db.delete(repairCases).where(like(repairCases.intakeNumber, "D9901%"));
  await db.delete(products).where(like(products.modelName, `${TEST_MODEL_PREFIX}%`));
  await db
    .delete(repairCaseIntakeSequences)
    .where(eq(repairCaseIntakeSequences.yearMonth, TEST_YEAR_MONTH));

  await pgClient.end({ timeout: 5 });
});

function baseInput(overrides: Partial<ValidatedCreateRepairCaseInput> = {}): ValidatedCreateRepairCaseInput {
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
    ...overrides,
  };
}

async function countRepairCasesForModel(modelName: string): Promise<number> {
  const rows = await db.execute<{ count: number }>(
    sql`select count(*)::int as count
        from repair_cases rc
        join products p on p.id = rc.product_id
        where p.model_name = ${modelName}`
  );
  return rows[0]?.count ?? 0;
}

/** Mirrors createRepairCaseAction's claim → create → resolve composition. */
async function attemptClaimAndCreate(key: string, requesterUserId: string, input: ValidatedCreateRepairCaseInput) {
  const claim = await claimIdempotencyKey(key, requesterUserId);
  if (claim.state !== "CLAIMED") {
    return { created: false as const, claim };
  }
  const result = await createRepairCase(input);
  if (result.ok) {
    await markIdempotencyKeySucceeded(key, result.id, result.intakeNumber);
  } else {
    await markIdempotencyKeyFailed(key);
  }
  return { created: true as const, result };
}

describe("repair-case idempotency", () => {
  test("first submission succeeds", async () => {
    const key = randomUUID();
    createdIdempotencyKeys.push(key);
    const input = baseInput();

    const claim = await claimIdempotencyKey(key, userAId);
    assert.equal(claim.state, "CLAIMED");

    const result = await createRepairCase(input);
    assert.equal(result.ok, true, `create failed: ${JSON.stringify(result)}`);
    if (!result.ok) return;

    await markIdempotencyKeySucceeded(key, result.id, result.intakeNumber);

    const [row] = await db
      .select()
      .from(repairCaseIdempotencyKeys)
      .where(eq(repairCaseIdempotencyKeys.idempotencyKey, key));
    assert.equal(row?.status, "SUCCEEDED");
    assert.equal(row?.repairCaseId, result.id);
    assert.deepEqual(row?.responseSnapshot, {
      repairCaseId: result.id,
      intakeNumber: result.intakeNumber,
    });
  });

  test("two concurrent requests with the same key create exactly one repair case", async () => {
    const key = randomUUID();
    createdIdempotencyKeys.push(key);
    const input = baseInput();

    const [a, b] = await Promise.all([
      attemptClaimAndCreate(key, userAId, input),
      attemptClaimAndCreate(key, userAId, input),
    ]);

    const winners = [a, b].filter((x) => x.created);
    const losers = [a, b].filter((x) => !x.created);
    assert.equal(winners.length, 1, "exactly one of the two concurrent claims should have proceeded to create");
    assert.equal(losers.length, 1);
    if (!losers[0].created) {
      assert.equal(losers[0].claim.state, "IN_PROGRESS");
    }

    assert.equal(await countRepairCasesForModel(input.modelName), 1);
  });

  test("replaying a succeeded key returns the same result and creates nothing new", async () => {
    const key = randomUUID();
    createdIdempotencyKeys.push(key);
    const input = baseInput();

    const firstClaim = await claimIdempotencyKey(key, userAId);
    assert.equal(firstClaim.state, "CLAIMED");
    const firstResult = await createRepairCase(input);
    assert.equal(firstResult.ok, true);
    if (!firstResult.ok) return;
    await markIdempotencyKeySucceeded(key, firstResult.id, firstResult.intakeNumber);

    const replay = await claimIdempotencyKey(key, userAId);
    assert.equal(replay.state, "SUCCEEDED");
    if (replay.state === "SUCCEEDED") {
      assert.equal(replay.repairCaseId, firstResult.id);
      assert.equal(replay.intakeNumber, firstResult.intakeNumber);
    }

    assert.equal(await countRepairCasesForModel(input.modelName), 1);
  });

  test("a key still PROCESSING returns IN_PROGRESS on a second claim", async () => {
    const key = randomUUID();
    createdIdempotencyKeys.push(key);

    const first = await claimIdempotencyKey(key, userAId);
    assert.equal(first.state, "CLAIMED"); // left PROCESSING deliberately — no create/resolve call

    const second = await claimIdempotencyKey(key, userAId);
    assert.equal(second.state, "IN_PROGRESS");
  });

  test("a FAILED key can be safely retried and can still succeed", async () => {
    const key = randomUUID();
    createdIdempotencyKeys.push(key);

    const first = await claimIdempotencyKey(key, userAId);
    assert.equal(first.state, "CLAIMED");
    await markIdempotencyKeyFailed(key);

    const retryClaim = await claimIdempotencyKey(key, userAId);
    assert.equal(retryClaim.state, "CLAIMED");

    const input = baseInput();
    const result = await createRepairCase(input);
    assert.equal(result.ok, true, `retry create failed: ${JSON.stringify(result)}`);
    if (!result.ok) return;
    await markIdempotencyKeySucceeded(key, result.id, result.intakeNumber);

    const [row] = await db
      .select()
      .from(repairCaseIdempotencyKeys)
      .where(eq(repairCaseIdempotencyKeys.idempotencyKey, key));
    assert.equal(row?.status, "SUCCEEDED");
  });

  test("a different user cannot reuse another user's idempotency key", async () => {
    const key = randomUUID();
    createdIdempotencyKeys.push(key);

    const first = await claimIdempotencyKey(key, userAId);
    assert.equal(first.state, "CLAIMED"); // left PROCESSING, owned by userA

    const second = await claimIdempotencyKey(key, userBId);
    assert.equal(second.state, "USER_MISMATCH");
  });
});
