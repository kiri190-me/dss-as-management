import "../../../../scripts/load-env";

import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { and, eq, inArray, like } from "drizzle-orm";

import { db, pgClient } from "../connection";
import {
  customers,
  inventoryPartRequestItems,
  inventoryPartRequests,
  parts,
  products,
  repairCaseIntakeSequences,
  repairCases,
  users,
} from "../schema";
import { createRepairCase } from "../mutations/repair-cases";
import { createPart } from "../mutations/inventory";
import { savePartOwnerSettings } from "../mutations/part-minimum-quantities";
import { lookupIntakeForQuote } from "./quotes";
import type { ValidatedCreateRepairCaseInput } from "@/lib/validation/repair-case-input";

/**
 * ============================================================================
 * 인수번호로 견적서 채우기 — 사용한 부품과 그 단가
 * ============================================================================
 * 확인하는 것은 다섯 가지다.
 *
 *  1. **출고된 것만 센다.** 요청만 하고 안 나간 부품을 견적에 올리면 쓰지도
 *     않은 값을 청구하게 된다.
 *  2. **(부품, 소유구분) 짝으로 묶는다.** 단가가 소유구분마다 다르므로, DSS
 *     것과 교산 것을 한 줄로 합치면 어느 쪽 단가로 청구할지 답할 수 없다.
 *  3. **그 소유구분의 단가가 따라온다.** 다른 소유구분의 값이 오면 안 된다.
 *  4. **🔴 단가를 정하지 않은 부품은 null 이다.** 0 이 아니다 — 0 으로 오면
 *     견적서가 정하지 않은 것을 0원으로 청구하게 된다.
 *  5. **소유구분이 없는 옛 요청은 단가가 붙지 않는다.** 어느 소유구분의 값인지
 *     알 수 없는데 아무거나 가져오면 다른 소유구분의 값으로 청구하게 된다.
 *
 * 격리 규약: 접수 월 "9603", 고객사 접두사 "AS-TEST-QUOTE-LOOKUP-",
 * 부품명 접두사 "test-quote-lookup-".
 * ============================================================================
 */

const TEST_CUSTOMER_NAME_PREFIX = "AS-TEST-QUOTE-LOOKUP-";
const TEST_PART_PREFIX = "test-quote-lookup-";
const TEST_MODEL_PREFIX = "QUOTE-LOOKUP-TEST-";
const TEST_YEAR_MONTH = "9603";
const TEST_RECEIVED_AT = "2096-03-05";

let actorUserId: string;
let engineerId: string;
let customerId: string;
let repairCaseId: string;
let intakeNumber: string;
const createdPartIds: string[] = [];
const createdRequestIds: string[] = [];

async function createTestPart(label: string): Promise<string> {
  const result = await createPart({
    partName: `${TEST_PART_PREFIX}${label}-${randomUUID().slice(0, 6)}`,
    partSpec: null,
    category: "TEST",
    actorUserId,
  });
  assert.equal(result.ok, true, `part create failed: ${JSON.stringify(result)}`);
  if (!result.ok) throw new Error("unreachable");
  createdPartIds.push(result.partId);
  return result.partId;
}

/**
 * 부품 요청 한 건과 그 줄들을 **직접 넣는다.** 요청 → 승인 → 출고 흐름을 다
   타지 않는 이유는, 이 시험이 보는 것이 그 흐름이 아니라 **조회가 issued_quantity
 * 와 owner 를 어떻게 읽는가**이기 때문이다. 그 흐름 자체는 재고 쪽 통합 시험이
 * 따로 본다.
 */
async function insertIssuedRequest(
  items: { partId: string; owner: string | null; issued: number; requested?: number }[]
) {
  const [request] = await db
    .insert(inventoryPartRequests)
    .values({ repairCaseId, requestedByUserId: engineerId, status: "FULLY_ISSUED" })
    .returning({ id: inventoryPartRequests.id });
  createdRequestIds.push(request.id);

  await db.insert(inventoryPartRequestItems).values(
    items.map((item) => ({
      requestId: request.id,
      partId: item.partId,
      owner: item.owner as never,
      requestedQuantity: item.requested ?? Math.max(item.issued, 1),
      issuedQuantity: item.issued,
    }))
  );
  return request.id;
}

function baseCreateRepairCaseInput(): ValidatedCreateRepairCaseInput {
  const suffix = randomUUID().slice(0, 8);
  return {
    workflowType: "PAID_MATCHER",
    billingType: "PAID",
    customerId,
    endUserId: null,
    assignedEngineerId: engineerId,
    receivedAt: TEST_RECEIVED_AT,
    customerRequestedDueDate: null,
    internalTargetShipmentDate: null,
    modelName: `${TEST_MODEL_PREFIX}${suffix}`,
    lotNumber: `LOT-${suffix}`,
    serialNumber: `SN-${suffix}`,
    partNumber: null,
    accessoryList: null,
    externalConditionSummary: null,
    reasonForRemoval: null,
    reportedSymptom: "Bias Fwd Drop 발생",
    intakeInspectionResult: null,
    currentDiagnosisSummary: null,
    nextPlannedAction: null,
    notes: null,
    contactName: null,
    contactPhone: null,
    contactEmail: null,
  };
}

before(async () => {
  const [admin] = await db
    .select({ id: users.id })
    .from(users)
    .where(and(eq(users.role, "SUPER_ADMIN"), eq(users.approvalStatus, "APPROVED"), eq(users.isDeleted, false)))
    .limit(1);
  assert.ok(admin, "expected an approved SUPER_ADMIN in the test DB");
  actorUserId = admin.id;

  const [engineer] = await db
    .select({ id: users.id })
    .from(users)
    .where(and(eq(users.role, "AS_ENGINEER"), eq(users.approvalStatus, "APPROVED"), eq(users.isDeleted, false)))
    .limit(1);
  assert.ok(engineer, "expected an approved AS_ENGINEER in the test DB");
  engineerId = engineer.id;

  const [customer] = await db
    .insert(customers)
    .values({ name: `${TEST_CUSTOMER_NAME_PREFIX}${randomUUID().slice(0, 8)}` })
    .returning({ id: customers.id });
  customerId = customer.id;

  const created = await createRepairCase(baseCreateRepairCaseInput());
  assert.equal(created.ok, true, `setup repair case failed: ${JSON.stringify(created)}`);
  if (!created.ok) throw new Error("unreachable");
  repairCaseId = created.id;

  const [row] = await db
    .select({ intakeNumber: repairCases.intakeNumber })
    .from(repairCases)
    .where(eq(repairCases.id, repairCaseId));
  intakeNumber = row.intakeNumber;
});

after(async () => {
  if (createdRequestIds.length > 0) {
    await db
      .delete(inventoryPartRequestItems)
      .where(inArray(inventoryPartRequestItems.requestId, createdRequestIds));
    await db.delete(inventoryPartRequests).where(inArray(inventoryPartRequests.id, createdRequestIds));
  }
  if (createdPartIds.length > 0) {
    // 단가는 ON DELETE CASCADE 라 함께 사라진다.
    await db.delete(parts).where(inArray(parts.id, createdPartIds));
  }
  await db.delete(repairCases).where(like(repairCases.intakeNumber, `D${TEST_YEAR_MONTH}%`));
  await db.delete(products).where(like(products.modelName, `${TEST_MODEL_PREFIX}%`));
  await db
    .delete(repairCaseIntakeSequences)
    .where(eq(repairCaseIntakeSequences.yearMonth, TEST_YEAR_MONTH));
  await db.delete(customers).where(like(customers.name, `${TEST_CUSTOMER_NAME_PREFIX}%`));
  await pgClient.end({ timeout: 5 });
});

describe("lookupIntakeForQuote", () => {
  test("인수번호로 고객사·모델명·L/N·S/N·신고증상이 따라온다", async () => {
    const found = await lookupIntakeForQuote(intakeNumber);
    assert.ok(found, "찾지 못했다");
    assert.equal(found.repairCaseId, repairCaseId);
    assert.equal(found.customerId, customerId);
    assert.ok(found.modelName?.startsWith(TEST_MODEL_PREFIX));
    assert.ok(found.lotNumber?.startsWith("LOT-"));
    assert.ok(found.serialNumber?.startsWith("SN-"));
    assert.equal(found.faultDescription, "Bias Fwd Drop 발생");
  });

  test("없는 인수번호는 오류가 아니라 null — 접수 전에 견적을 내는 일이 있다", async () => {
    assert.equal(await lookupIntakeForQuote("D999999"), null);
  });

  test("그 소유구분에 정해 둔 단가가 따라온다", async () => {
    const partId = await createTestPart("priced");
    await savePartOwnerSettings({
      partId,
      entries: [],
      unitPriceEntries: [
        { owner: "DSS", unitPrice: "125000" },
        { owner: "KYOSAN", unitPrice: "999999" },
      ],
      actorUserId,
    });
    await insertIssuedRequest([{ partId, owner: "DSS", issued: 2 }]);

    const found = await lookupIntakeForQuote(intakeNumber);
    assert.ok(found);
    const used = found.usedParts.find((p) => p.partId === partId);
    assert.ok(used, "출고한 부품이 목록에 없다");
    assert.equal(used.owner, "DSS");
    assert.equal(used.quantity, 2);
    // 교산 단가(999999)가 오면 **다른 소유구분의 값으로 청구**하게 된다.
    assert.equal(Number(used.unitPrice), 125000);
  });

  test("🔴 단가를 정하지 않은 부품은 null 이다 — 0 이 아니다", async () => {
    const partId = await createTestPart("unpriced");
    await insertIssuedRequest([{ partId, owner: "DSS", issued: 1 }]);

    const found = await lookupIntakeForQuote(intakeNumber);
    assert.ok(found);
    const used = found.usedParts.find((p) => p.partId === partId);
    assert.ok(used);
    assert.equal(used.unitPrice, null, "정하지 않은 단가는 null 이어야 한다");
  });

  test("0원(무상)으로 정해 둔 단가는 그대로 온다 — 정하지 않음과 다르다", async () => {
    const partId = await createTestPart("free");
    await savePartOwnerSettings({
      partId,
      entries: [],
      unitPriceEntries: [{ owner: "DSS", unitPrice: "0" }],
      actorUserId,
    });
    await insertIssuedRequest([{ partId, owner: "DSS", issued: 1 }]);

    const found = await lookupIntakeForQuote(intakeNumber);
    assert.ok(found);
    const used = found.usedParts.find((p) => p.partId === partId);
    assert.ok(used);
    assert.notEqual(used.unitPrice, null, "0 은 null 이 아니다");
    assert.equal(Number(used.unitPrice), 0);
  });

  test("같은 부품이 두 소유구분으로 나가면 두 줄이다 — 단가가 다르기 때문", async () => {
    const partId = await createTestPart("two-owners");
    await savePartOwnerSettings({
      partId,
      entries: [],
      unitPriceEntries: [
        { owner: "DSS", unitPrice: "100" },
        { owner: "KYOSAN", unitPrice: "200" },
      ],
      actorUserId,
    });
    // ⚠️ 요청 **하나**에는 같은 부품이 한 번만 들어간다
    // (inventory_part_request_items_request_part_unique). 소유구분이 다르면
    // 요청 자체가 갈린다 — 실제로도 DSS 것을 받고 나서 교산 것을 따로 청구한다.
    await insertIssuedRequest([{ partId, owner: "DSS", issued: 1 }]);
    await insertIssuedRequest([{ partId, owner: "KYOSAN", issued: 3 }]);

    const found = await lookupIntakeForQuote(intakeNumber);
    assert.ok(found);
    const rows = found.usedParts
      .filter((p) => p.partId === partId)
      .map((p) => [p.owner, p.quantity, Number(p.unitPrice)]);
    assert.equal(rows.length, 2, "두 줄이어야 한다");
    assert.deepEqual(rows.sort(), [
      ["DSS", 1, 100],
      ["KYOSAN", 3, 200],
    ]);
  });

  test("소유구분이 없는 옛 요청은 단가가 붙지 않는다", async () => {
    const partId = await createTestPart("no-owner");
    await savePartOwnerSettings({
      partId,
      entries: [],
      unitPriceEntries: [{ owner: "DSS", unitPrice: "555" }],
      actorUserId,
    });
    await insertIssuedRequest([{ partId, owner: null, issued: 1 }]);

    const found = await lookupIntakeForQuote(intakeNumber);
    assert.ok(found);
    const used = found.usedParts.find((p) => p.partId === partId);
    assert.ok(used);
    assert.equal(used.owner, null);
    // DSS 단가(555)를 끌어오면 알 수 없는 소유구분에 남의 값을 붙이는 것이다.
    assert.equal(used.unitPrice, null);
  });

  test("출고되지 않은 요청은 세지 않는다 — 쓰지도 않은 값을 청구하면 안 된다", async () => {
    const partId = await createTestPart("not-issued");
    await insertIssuedRequest([{ partId, owner: "DSS", issued: 0, requested: 5 }]);

    const found = await lookupIntakeForQuote(intakeNumber);
    assert.ok(found);
    assert.equal(
      found.usedParts.some((p) => p.partId === partId),
      false,
      "출고량 0 인 줄이 목록에 있다"
    );
  });
});
