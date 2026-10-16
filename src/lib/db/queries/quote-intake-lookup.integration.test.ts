import "../../../../scripts/load-env";

import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { and, eq, like } from "drizzle-orm";

import { db, pgClient } from "../connection";
import {
  customers,
  products,
  repairCaseIntakeSequences,
  repairCases,
  users,
} from "../schema";
import { createRepairCase } from "../mutations/repair-cases";
import { lookupIntakeForQuote } from "./quotes";
import type { ValidatedCreateRepairCaseInput } from "@/lib/validation/repair-case-input";

/**
 * ============================================================================
 * 인수번호로 견적서 채우기 — 🔴 **A/S DB 가 아는 것이 여기까지다** (2026-10-16)
 * ============================================================================
 * 이 조회가 돌려주던 **출고된 부품**과 **O/H 템플릿 부품**은 2026-10 조각 10~12 에서
 * **재고 관리로 옮겨갔다.** 그 표를 세워 재던 여섯 가지(출고된 것만 센다 · 묶는 축 ·
 * 견적가가 따라온다 · 정하지 않은 값은 null · 0원은 그대로 · O/H 견적가를 때우지 않는다)는
 * **뜻을 그대로 들고** `src/lib/domain/quote-intake-parts.test.ts` 로 옮겼다 — 이제 그 자료가
 * 저쪽에서 오므로 A/S 표를 세워서는 잴 수 없고, 저쪽에서 받아 온 것을 **어떻게 읽는가**가
 * 그 규칙들이 사는 자리다.
 *
 * 여기 남는 것은 **이 조회가 지금도 하는 일** 셋이다 —
 *  1. 인수번호 하나로 고객사 · 모델명 · L/N · S/N · 신고증상이 따라온다.
 *  2. 없는 인수번호는 **오류가 아니라 null** 이다(접수 전에 견적을 내는 일이 있다).
 *  3. 🔴 **제품 개체 id 가 함께 온다** — 재고 관리에 O/H 템플릿을 물을 열쇠(제품 **모델**
 *     id)를 그 값으로 얻는다. 빠지면 O/H 템플릿이 영영 안 뜬다.
 *
 * 격리 규약: 접수 월 "9603", 고객사 접두사 "AS-TEST-QUOTE-LOOKUP-".
 * ============================================================================
 */

const TEST_CUSTOMER_NAME_PREFIX = "AS-TEST-QUOTE-LOOKUP-";
const TEST_MODEL_PREFIX = "QUOTE-LOOKUP-TEST-";
const TEST_YEAR_MONTH = "9603";
const TEST_RECEIVED_AT = "2096-03-05";

let engineerId: string;
let customerId: string;
let repairCaseId: string;
let intakeNumber: string;

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

  test("🔴 제품 개체 id 가 함께 온다 — 재고 관리에 O/H 템플릿을 물을 열쇠가 여기서 나온다", async () => {
    const found = await lookupIntakeForQuote(intakeNumber);
    assert.ok(found);
    // 🔴 이 값이 빠지면 서버 모듈이 제품 **모델** id 를 얻지 못해 저쪽을 부르지도 못하고,
    //    화면은 영영 「이 모델에 템플릿이 이어져 있지 않습니다」만 띄운다.
    assert.ok(found.productId, "제품 개체 id 가 없다");
    const [product] = await db
      .select({ modelName: products.modelName })
      .from(products)
      .where(eq(products.id, found.productId));
    assert.ok(product?.modelName?.startsWith(TEST_MODEL_PREFIX), "다른 개체를 가리킨다");
  });
});
