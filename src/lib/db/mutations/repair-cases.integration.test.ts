import "../../../../scripts/load-env";

import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { eq, and, like } from "drizzle-orm";
import { db, pgClient } from "../connection";
import { customers, users, repairCases, products, repairCaseIntakeSequences } from "../schema";
import { createRepairCase } from "./repair-cases";
import type { ValidatedCreateRepairCaseInput } from "@/lib/validation/repair-case-input";

/**
 * Real-DB integration test against dss-as-postgres-dev (REQUIRES the dev
 * Postgres container to be running and DATABASE_URL set in .env.local — same
 * precondition as scripts/check-dev-db.ts). Exercises the concurrency-safe
 * intake-number allocator and the resolveProduct() unique-violation backstop
 * under real concurrent transactions, which node:test's other repair-case
 * suites (pure-function tests, no DB) cannot cover.
 *
 * Self-cleaning as of the idempotency-key task (see idempotency-keys.
 * integration.test.ts's header comment): this test used to insert real rows
 * into repair_cases/products under receivedAt "2026-08-05" (the real D2608
 * intake-number bucket) and never remove them — that accumulated ~70 rows
 * that had to be found and manually deleted with explicit approval. It now
 * uses an isolated test-only month ("9902" / 2099-02, distinct from
 * idempotency-keys.integration.test.ts's "9901" so the two files never race
 * on the same sequence row) and removes everything it creates in after().
 */

const TEST_RECEIVED_AT = "2099-02-10";
const TEST_SHIPMENT_DATE = "2099-02-25";
const TEST_MODEL_PREFIX = "TG-CONC-";

let customerId: string;
let engineerId: string;

before(async () => {
  const [customer] = await db
    .select({ id: customers.id })
    .from(customers)
    .where(eq(customers.isDeleted, false))
    .limit(1);
  const [engineer] = await db
    .select({ id: users.id })
    .from(users)
    .where(and(eq(users.role, "AS_ENGINEER"), eq(users.approvalStatus, "APPROVED"), eq(users.isDeleted, false)))
    .limit(1);
  assert.ok(customer, "expected at least one non-deleted customer in the dev DB");
  assert.ok(engineer, "expected at least one approved AS_ENGINEER in the dev DB");
  customerId = customer.id;
  engineerId = engineer.id;
});

after(async () => {
  await db.delete(repairCases).where(like(repairCases.intakeNumber, "D9902%"));
  await db.delete(products).where(like(products.modelName, `${TEST_MODEL_PREFIX}%`));
  await db.delete(repairCaseIntakeSequences).where(eq(repairCaseIntakeSequences.yearMonth, "9902"));

  // Drain the pool properly before exiting — an earlier version of this
  // test called process.exit(0) immediately, which raced the pool's
  // in-flight COMMIT acknowledgement and intermittently made the second
  // concurrent transaction's row appear to vanish on a later, separate
  // connection (a test-harness bug, not a createRepairCase bug).
  await pgClient.end({ timeout: 5 });
});

function baseInput(overrides: Partial<ValidatedCreateRepairCaseInput>): ValidatedCreateRepairCaseInput {
  return {
    workflowType: "MATCHER",
    customerId,
    endUserId: null,
    assignedEngineerId: engineerId,
    receivedAt: TEST_RECEIVED_AT,
    customerRequestedDueDate: null,
    internalTargetShipmentDate: TEST_SHIPMENT_DATE,
    modelName: "TG-CONC-TEST",
    lotNumber: "LOT-CONC-TEST",
    serialNumber: "SN-CONC-TEST",
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

describe("createRepairCase concurrency", () => {
  test("two concurrent submissions with an identical, brand-new product triple both succeed, get distinct sequential intake numbers, and share one product row", async () => {
    const uniqueSuffix = Date.now().toString(36);
    const input = baseInput({
      modelName: `TG-CONC-${uniqueSuffix}`,
      lotNumber: `LOT-CONC-${uniqueSuffix}`,
      serialNumber: `SN-CONC-${uniqueSuffix}`,
    });

    const [first, second] = await Promise.all([createRepairCase(input), createRepairCase(input)]);

    assert.equal(first.ok, true, `first submission failed: ${JSON.stringify(first)}`);
    assert.equal(second.ok, true, `second submission failed: ${JSON.stringify(second)}`);
    if (!first.ok || !second.ok) return;

    // This is the concrete "rapid/duplicate submission" risk this project's
    // idempotency-key feature now addresses at the Server Action layer
    // (create-repair-case.ts) — createRepairCase() itself still has no
    // opinion about duplicate submissions; it allocates a new, distinct
    // intake number and creates a second repair_cases row every time it's
    // called. That's intentional: idempotency protection belongs one layer
    // up (see idempotency-keys.integration.test.ts), not inside this
    // transaction.
    assert.notEqual(first.id, second.id, "expected two distinct repair_cases rows");
    assert.notEqual(
      first.intakeNumber,
      second.intakeNumber,
      "allocator must not hand out the same intake number twice under concurrency"
    );

    const [row1] = await db
      .select({ productId: repairCases.productId })
      .from(repairCases)
      .where(eq(repairCases.id, first.id));
    const [row2] = await db
      .select({ productId: repairCases.productId })
      .from(repairCases)
      .where(eq(repairCases.id, second.id));

    assert.ok(row1 && row2, "expected both inserted rows to be readable back");
    assert.equal(
      row1.productId,
      row2.productId,
      "concurrent creation of the same (model, lot, serial) triple must resolve to a single product row, not two"
    );
  });
});
