import "../../../../scripts/load-env";

import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { eq, and, like } from "drizzle-orm";
import { db, pgClient } from "../connection";
import { customers, endUsers, users, repairCases, products, repairCaseIntakeSequences } from "../schema";
import { createRepairCase } from "./repair-cases";
import { toKstDateOnly } from "@/lib/domain/date-only";
import { reportNumberYearDigit } from "@/lib/domain/repair-case-report-number";
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
const TEST_CUSTOMER_NAME_PREFIX = "AS-TEST-CUSTOMER-";

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
  // end_users before customers — end_users.customer_id is FK-restrict.
  await db.delete(endUsers).where(like(endUsers.name, `${TEST_CUSTOMER_NAME_PREFIX}%`));
  await db.delete(customers).where(like(customers.name, `${TEST_CUSTOMER_NAME_PREFIX}%`));

  // Drain the pool properly before exiting — an earlier version of this
  // test called process.exit(0) immediately, which raced the pool's
  // in-flight COMMIT acknowledgement and intermittently made the second
  // concurrent transaction's row appear to vanish on a later, separate
  // connection (a test-harness bug, not a createRepairCase bug).
  await pgClient.end({ timeout: 5 });
});

function baseInput(overrides: Partial<ValidatedCreateRepairCaseInput>): ValidatedCreateRepairCaseInput {
  return {
    workflowType: "PAID_MATCHER",
    billingType: "PAID",
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

describe("createRepairCase manual intakeNumber override", () => {
  test("a manual override is used as-is instead of the allocator", async () => {
    const uniqueSuffix = Date.now().toString(36);
    const input = baseInput({
      modelName: `TG-CONC-OVR-${uniqueSuffix}`,
      lotNumber: `LOT-CONC-OVR-${uniqueSuffix}`,
      serialNumber: `SN-CONC-OVR-${uniqueSuffix}`,
      intakeNumber: "D990251",
    });

    const result = await createRepairCase(input);
    assert.equal(result.ok, true, `submission failed: ${JSON.stringify(result)}`);
    if (!result.ok) return;
    assert.equal(result.intakeNumber, "D990251");
  });

  test("a second submission that reuses the same manual intakeNumber fails cleanly with INTAKE_NUMBER_DUPLICATE, without aborting the transaction for the caller", async () => {
    const uniqueSuffix = Date.now().toString(36);
    const first = baseInput({
      modelName: `TG-CONC-DUP1-${uniqueSuffix}`,
      lotNumber: `LOT-CONC-DUP1-${uniqueSuffix}`,
      serialNumber: `SN-CONC-DUP1-${uniqueSuffix}`,
      intakeNumber: "D990252",
    });
    const firstResult = await createRepairCase(first);
    assert.equal(firstResult.ok, true, `first submission failed: ${JSON.stringify(firstResult)}`);

    const second = baseInput({
      modelName: `TG-CONC-DUP2-${uniqueSuffix}`,
      lotNumber: `LOT-CONC-DUP2-${uniqueSuffix}`,
      serialNumber: `SN-CONC-DUP2-${uniqueSuffix}`,
      intakeNumber: "D990252",
    });
    const secondResult = await createRepairCase(second);
    assert.equal(secondResult.ok, false, "duplicate intake number must not be silently re-generated");
    if (secondResult.ok) return;
    assert.equal(secondResult.code, "INTAKE_NUMBER_DUPLICATE");
    assert.ok(secondResult.fieldErrors?.intakeNumber);

    // The rejected submission's repair_cases row itself must never have
    // been persisted (only its own SAVEPOINT was rolled back, but that's
    // exactly the row this asserts against).
    const [orphanCase] = await db
      .select({ id: repairCases.id })
      .from(repairCases)
      .where(eq(repairCases.intakeNumber, "D990252"));
    assert.equal(orphanCase?.id, firstResult.ok ? firstResult.id : undefined);
  });
});

describe("createRepairCase optional assignedEngineerId", () => {
  test("a null assignedEngineerId is accepted and persisted as null, skipping engineer lookup entirely", async () => {
    const uniqueSuffix = Date.now().toString(36);
    const input = baseInput({
      modelName: `TG-CONC-NOENG-${uniqueSuffix}`,
      lotNumber: `LOT-CONC-NOENG-${uniqueSuffix}`,
      serialNumber: `SN-CONC-NOENG-${uniqueSuffix}`,
      assignedEngineerId: null,
    });

    const result = await createRepairCase(input);
    assert.equal(result.ok, true, `submission failed: ${JSON.stringify(result)}`);
    if (!result.ok) return;

    const [row] = await db
      .select({ assignedEngineerId: repairCases.assignedEngineerId })
      .from(repairCases)
      .where(eq(repairCases.id, result.id));
    assert.equal(row?.assignedEngineerId, null);
  });
});

describe("createRepairCase customer/End-User free-entry lookup-or-create", () => {
  test("a brand-new customer name creates a minimal customer record (name only, contact fields null)", async () => {
    const uniqueSuffix = Date.now().toString(36);
    const customerName = `${TEST_CUSTOMER_NAME_PREFIX}${uniqueSuffix}`;
    const input = baseInput({
      modelName: `TG-CONC-NEWCUST-${uniqueSuffix}`,
      lotNumber: `LOT-CONC-NEWCUST-${uniqueSuffix}`,
      serialNumber: `SN-CONC-NEWCUST-${uniqueSuffix}`,
      customerId: null,
      newCustomerName: customerName,
    });

    const result = await createRepairCase(input);
    assert.equal(result.ok, true, `submission failed: ${JSON.stringify(result)}`);
    if (!result.ok) return;

    const [row] = await db
      .select({ customerId: repairCases.customerId })
      .from(repairCases)
      .where(eq(repairCases.id, result.id));
    assert.ok(row?.customerId);

    const [newCustomer] = await db
      .select({ name: customers.name, contactName: customers.contactName, contactEmail: customers.contactEmail, contactPhone: customers.contactPhone })
      .from(customers)
      .where(eq(customers.id, row!.customerId));
    assert.equal(newCustomer?.name, customerName);
    assert.equal(newCustomer?.contactName, null);
    assert.equal(newCustomer?.contactEmail, null);
    assert.equal(newCustomer?.contactPhone, null);
  });

  test("submitting the same new customer name twice (two separate repair cases) reuses the same customer row, never creates a duplicate", async () => {
    const uniqueSuffix = Date.now().toString(36);
    const customerName = `${TEST_CUSTOMER_NAME_PREFIX}REUSE-${uniqueSuffix}`;

    const first = await createRepairCase(
      baseInput({
        modelName: `TG-CONC-REUSE1-${uniqueSuffix}`,
        lotNumber: `LOT-CONC-REUSE1-${uniqueSuffix}`,
        serialNumber: `SN-CONC-REUSE1-${uniqueSuffix}`,
        customerId: null,
        newCustomerName: customerName,
      })
    );
    assert.equal(first.ok, true, `first submission failed: ${JSON.stringify(first)}`);

    // Slightly different casing/whitespace — must still normalize-match.
    const second = await createRepairCase(
      baseInput({
        modelName: `TG-CONC-REUSE2-${uniqueSuffix}`,
        lotNumber: `LOT-CONC-REUSE2-${uniqueSuffix}`,
        serialNumber: `SN-CONC-REUSE2-${uniqueSuffix}`,
        customerId: null,
        newCustomerName: `  ${customerName.toLowerCase()}  `,
      })
    );
    assert.equal(second.ok, true, `second submission failed: ${JSON.stringify(second)}`);
    if (!first.ok || !second.ok) return;

    const [row1] = await db
      .select({ customerId: repairCases.customerId })
      .from(repairCases)
      .where(eq(repairCases.id, first.id));
    const [row2] = await db
      .select({ customerId: repairCases.customerId })
      .from(repairCases)
      .where(eq(repairCases.id, second.id));
    assert.equal(row1?.customerId, row2?.customerId, "both must resolve to the same customer row");

    const matchingCustomers = await db
      .select({ id: customers.id })
      .from(customers)
      .where(eq(customers.name, customerName));
    assert.equal(matchingCustomers.length, 1, "must not have created a duplicate customer row");
  });

  test("two concurrent submissions with the same brand-new customer name both succeed and share one customer row (unique-violation race handled)", async () => {
    const uniqueSuffix = Date.now().toString(36);
    const customerName = `${TEST_CUSTOMER_NAME_PREFIX}RACE-${uniqueSuffix}`;
    const inputA = baseInput({
      modelName: `TG-CONC-RACEA-${uniqueSuffix}`,
      lotNumber: `LOT-CONC-RACEA-${uniqueSuffix}`,
      serialNumber: `SN-CONC-RACEA-${uniqueSuffix}`,
      customerId: null,
      newCustomerName: customerName,
    });
    const inputB = baseInput({
      modelName: `TG-CONC-RACEB-${uniqueSuffix}`,
      lotNumber: `LOT-CONC-RACEB-${uniqueSuffix}`,
      serialNumber: `SN-CONC-RACEB-${uniqueSuffix}`,
      customerId: null,
      newCustomerName: customerName,
    });

    const [a, b] = await Promise.all([createRepairCase(inputA), createRepairCase(inputB)]);
    assert.equal(a.ok, true, `first concurrent submission failed: ${JSON.stringify(a)}`);
    assert.equal(b.ok, true, `second concurrent submission failed: ${JSON.stringify(b)}`);
    if (!a.ok || !b.ok) return;

    const [rowA] = await db.select({ customerId: repairCases.customerId }).from(repairCases).where(eq(repairCases.id, a.id));
    const [rowB] = await db.select({ customerId: repairCases.customerId }).from(repairCases).where(eq(repairCases.id, b.id));
    assert.equal(rowA?.customerId, rowB?.customerId, "a concurrent race must still converge on a single customer row");

    const matchingCustomers = await db.select({ id: customers.id }).from(customers).where(eq(customers.name, customerName));
    assert.equal(matchingCustomers.length, 1, "the unique index must prevent a duplicate customer row under a race");
  });

  test("a brand-new End-User name creates a minimal record scoped to the resolved customer", async () => {
    const uniqueSuffix = Date.now().toString(36);
    const customerName = `${TEST_CUSTOMER_NAME_PREFIX}ENDUSER-${uniqueSuffix}`;
    const endUserName = `${TEST_CUSTOMER_NAME_PREFIX}ENDUSER-SITE-${uniqueSuffix}`;
    const input = baseInput({
      modelName: `TG-CONC-EU-${uniqueSuffix}`,
      lotNumber: `LOT-CONC-EU-${uniqueSuffix}`,
      serialNumber: `SN-CONC-EU-${uniqueSuffix}`,
      customerId: null,
      newCustomerName: customerName,
      endUserId: null,
      newEndUserName: endUserName,
    });

    const result = await createRepairCase(input);
    assert.equal(result.ok, true, `submission failed: ${JSON.stringify(result)}`);
    if (!result.ok) return;

    const [row] = await db
      .select({ customerId: repairCases.customerId, endUserId: repairCases.endUserId })
      .from(repairCases)
      .where(eq(repairCases.id, result.id));
    assert.ok(row?.endUserId);

    const [newEndUser] = await db
      .select({ name: endUsers.name, customerId: endUsers.customerId })
      .from(endUsers)
      .where(eq(endUsers.id, row!.endUserId as string));
    assert.equal(newEndUser?.name, endUserName);
    assert.equal(newEndUser?.customerId, row!.customerId);
  });
});

describe("createRepairCase billingType independence from workflowType", () => {
  test("Matcher workflowType persists billingType WARRANTY as-is — never inferred/overwritten", async () => {
    const uniqueSuffix = Date.now().toString(36);
    const input = baseInput({
      modelName: `TG-CONC-BILL-${uniqueSuffix}`,
      lotNumber: `LOT-CONC-BILL-${uniqueSuffix}`,
      serialNumber: `SN-CONC-BILL-${uniqueSuffix}`,
      workflowType: "PAID_MATCHER",
      billingType: "WARRANTY",
    });

    const result = await createRepairCase(input);
    assert.equal(result.ok, true, `submission failed: ${JSON.stringify(result)}`);
    if (!result.ok) return;

    const [row] = await db
      .select({ billingType: repairCases.billingType })
      .from(repairCases)
      .where(eq(repairCases.id, result.id));
    assert.equal(row?.billingType, "WARRANTY");
  });
});

describe("createRepairCase without the 3 legacy summary fields (record_kind derived-summary checkpoint)", () => {
  test("succeeds and leaves intake_inspection_result/current_diagnosis_summary/next_planned_action NULL when the input omits them entirely", async () => {
    const uniqueSuffix = Date.now().toString(36);
    const { intakeInspectionResult, currentDiagnosisSummary, nextPlannedAction, ...inputWithoutLegacyFields } = baseInput({
      modelName: `TG-CONC-NOSUM-${uniqueSuffix}`,
      lotNumber: `LOT-CONC-NOSUM-${uniqueSuffix}`,
      serialNumber: `SN-CONC-NOSUM-${uniqueSuffix}`,
    });
    void intakeInspectionResult;
    void currentDiagnosisSummary;
    void nextPlannedAction;

    const result = await createRepairCase(inputWithoutLegacyFields as ValidatedCreateRepairCaseInput);
    assert.equal(result.ok, true, `submission failed: ${JSON.stringify(result)}`);
    if (!result.ok) return;

    const [row] = await db
      .select({
        intakeInspectionResult: repairCases.intakeInspectionResult,
        currentDiagnosisSummary: repairCases.currentDiagnosisSummary,
        nextPlannedAction: repairCases.nextPlannedAction,
      })
      .from(repairCases)
      .where(eq(repairCases.id, result.id));
    assert.equal(row?.intakeInspectionResult, null);
    assert.equal(row?.currentDiagnosisSummary, null);
    assert.equal(row?.nextPlannedAction, null);
  });
});

describe("createRepairCase persists internalTargetInspectionCompletionDate (A/S intake 일정 checkpoint)", () => {
  test("a submitted date is persisted as-is", async () => {
    const uniqueSuffix = Date.now().toString(36);
    const input = baseInput({
      modelName: `TG-CONC-TGTINSP-${uniqueSuffix}`,
      lotNumber: `LOT-CONC-TGTINSP-${uniqueSuffix}`,
      serialNumber: `SN-CONC-TGTINSP-${uniqueSuffix}`,
      receivedAt: TEST_RECEIVED_AT,
      internalTargetInspectionCompletionDate: "2099-02-24",
    });

    const result = await createRepairCase(input);
    assert.equal(result.ok, true, `submission failed: ${JSON.stringify(result)}`);
    if (!result.ok) return;

    const [row] = await db
      .select({ internalTargetInspectionCompletionDate: repairCases.internalTargetInspectionCompletionDate })
      .from(repairCases)
      .where(eq(repairCases.id, result.id));
    assert.equal(row?.internalTargetInspectionCompletionDate, "2099-02-24");
  });

  test("omitted from the input leaves the column NULL (never guessed at this layer)", async () => {
    const uniqueSuffix = Date.now().toString(36);
    const { internalTargetInspectionCompletionDate, ...inputWithoutDate } = baseInput({
      modelName: `TG-CONC-TGTINSP2-${uniqueSuffix}`,
      lotNumber: `LOT-CONC-TGTINSP2-${uniqueSuffix}`,
      serialNumber: `SN-CONC-TGTINSP2-${uniqueSuffix}`,
    });
    void internalTargetInspectionCompletionDate;

    const result = await createRepairCase(inputWithoutDate as ValidatedCreateRepairCaseInput);
    assert.equal(result.ok, true, `submission failed: ${JSON.stringify(result)}`);
    if (!result.ok) return;

    const [row] = await db
      .select({ internalTargetInspectionCompletionDate: repairCases.internalTargetInspectionCompletionDate })
      .from(repairCases)
      .where(eq(repairCases.id, result.id));
    assert.equal(row?.internalTargetInspectionCompletionDate, null);
  });
});

/**
 * 보고서번호 — 2026-10-18 부터 **접수할 때 자동으로 매긴다**(그 전에는 수기
 * 전용이었다). 규칙 자체는 DB 없이 domain/repair-case-report-number.test.ts 가
 * 못 박고, 여기서는 **DB 를 거쳐도 그대로인가**만 본다: 실제로 칸에 들어가는가 ·
 * 연달아 접수하면 1씩 느는가 · 사람이 적어 보낸 값을 자동이 덮지 않는가.
 */
async function readReportNumber(id: string): Promise<string | null> {
  const [row] = await db
    .select({ legacyReportNumber: repairCases.legacyReportNumber })
    .from(repairCases)
    .where(eq(repairCases.id, id));
  assert.ok(row, `expected repair_cases row ${id} to exist`);
  return row!.legacyReportNumber;
}

/**
 * 오늘 기준 앞자리. null 이면 번호를 매기지 않는 해(2030년 이후)이고, 그때는
 * **비어 있는 것이 맞다** — 그 해가 와도 이 시험이 거짓으로 통과하거나 엉뚱하게
 * 깨지지 않도록 두 길을 모두 적어 둔다.
 */
const TODAY = toKstDateOnly(new Date());
const TODAY_YEAR_DIGIT = reportNumberYearDigit(TODAY);

describe("createRepairCase 보고서번호 자동 채번", () => {
  test("접수를 만들면 보고서번호가 실제로 칸에 들어간다", async () => {
    const uniqueSuffix = Date.now().toString(36);
    const result = await createRepairCase(
      baseInput({
        modelName: `TG-CONC-REPNO2-${uniqueSuffix}`,
        lotNumber: `LOT-CONC-REPNO2-${uniqueSuffix}`,
        serialNumber: `SN-CONC-REPNO2-${uniqueSuffix}`,
      })
    );
    assert.equal(result.ok, true, `submission failed: ${JSON.stringify(result)}`);
    if (!result.ok) return;

    const assigned = await readReportNumber(result.id);
    if (TODAY_YEAR_DIGIT === null) {
      assert.equal(assigned, null, "번호를 매기지 않는 해에는 비어 있어야 한다(지어내지 않는다)");
      return;
    }
    assert.match(assigned ?? "", /^[1-9][0-9]{3}$/, "네 자리 숫자여야 한다");
    assert.equal(assigned?.[0], TODAY_YEAR_DIGIT, "앞자리는 올해(연도 − 2020)여야 한다");
  });

  test("🔴 연달아 두 건을 접수하면 보고서번호가 1씩 는다 — 같은 번호가 나오지 않는다", async () => {
    const uniqueSuffix = Date.now().toString(36);
    const first = await createRepairCase(
      baseInput({
        modelName: `TG-CONC-REPSEQ1-${uniqueSuffix}`,
        lotNumber: `LOT-CONC-REPSEQ1-${uniqueSuffix}`,
        serialNumber: `SN-CONC-REPSEQ1-${uniqueSuffix}`,
      })
    );
    const second = await createRepairCase(
      baseInput({
        modelName: `TG-CONC-REPSEQ2-${uniqueSuffix}`,
        lotNumber: `LOT-CONC-REPSEQ2-${uniqueSuffix}`,
        serialNumber: `SN-CONC-REPSEQ2-${uniqueSuffix}`,
      })
    );
    assert.equal(first.ok, true, `first submission failed: ${JSON.stringify(first)}`);
    assert.equal(second.ok, true, `second submission failed: ${JSON.stringify(second)}`);
    if (!first.ok || !second.ok) return;

    const firstNumber = await readReportNumber(first.id);
    const secondNumber = await readReportNumber(second.id);
    if (TODAY_YEAR_DIGIT === null) {
      assert.equal(firstNumber, null);
      assert.equal(secondNumber, null);
      return;
    }

    assert.notEqual(firstNumber, secondNumber, "연달아 접수한 두 건이 같은 번호를 받으면 안 된다");
    assert.equal(
      Number(secondNumber) - Number(firstNumber),
      1,
      `연달아 접수하면 1씩 늘어야 한다 (${firstNumber} → ${secondNumber})`
    );
  });

  test("입력으로 적어 보낸 보고서번호는 그대로 들어간다 — 자동 채번이 덮지 않는다", async () => {
    const uniqueSuffix = Date.now().toString(36);
    // 숫자가 아닌 값이라 다음 건의 셈에도 들어가지 않는다(옛 엑셀 A열 모양).
    const typed = `R-TEST-${uniqueSuffix}`;
    const result = await createRepairCase(
      baseInput({
        modelName: `TG-CONC-REPNO-${uniqueSuffix}`,
        lotNumber: `LOT-CONC-REPNO-${uniqueSuffix}`,
        serialNumber: `SN-CONC-REPNO-${uniqueSuffix}`,
        legacyReportNumber: typed,
      })
    );
    assert.equal(result.ok, true, `submission failed: ${JSON.stringify(result)}`);
    if (!result.ok) return;

    assert.equal(await readReportNumber(result.id), typed);
  });
});
