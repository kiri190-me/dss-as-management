import "../../../../scripts/load-env";

import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { and, eq, inArray } from "drizzle-orm";
import { db, pgClient } from "../connection";
import { customers, products, repairCaseIntakeSequences, repairCases, users } from "../schema";
import { createRepairCase } from "../mutations/repair-cases";
import { listRepairCases } from "./repair-cases";
import type { ValidatedCreateRepairCaseInput } from "@/lib/validation/repair-case-input";

/**
 * ============================================================================
 * 전체 A/S 현황(/repair-cases)이 받는 줄이 **신고증상·L/N 을 싣고 오는가**
 * ============================================================================
 * 표(RepairCaseTable)와 카드(RepairCaseCardList)가 2026-10-17 부터 신고증상을
 * 그리고, 카드도 L/N 을 그린다. 화면은 listRepairCases() 가 보낸 줄 말고는
 * 아무 데서도 그 값을 얻지 못한다 — 그러니 **조회가 그 칸을 실제로 싣고
 * 오는지**를 DB 를 거쳐 한 번 재 둔다.
 *
 * 🔴 왜 화면 시험만으로는 모자란가 — 화면 시험은 손으로 만든 줄을 넘겨 그린다.
 * 조회가 그 칸을 빠뜨려도 화면 시험은 전부 통과하고, 사람 눈에는 **늘 빈 칸**만
 * 보인다(그리고 그건 "값이 없는 건"과 구별되지 않아 아무도 신고하지 않는다).
 *
 * 🔵 차례(인수번호 내림차순)는 이웃 파일 repair-cases-list-order.integration.test.ts
 * 가 본다. 이 파일은 **무엇이 실려 오는가** 하나만 본다.
 *
 * 자기 뒤처리 규약은 이웃과 같다: 이 묶음만 쓰는 인수 월 "9411"(다른 어느 시험
 * 파일도 쓰지 않는다)과 모델 이름 앞가지로 가둬 두고, after() 가 만든 줄만
 * 지운다. legacyImportState 없이 부르므로 createRepairCase 가 남기는 것은
 * products · repair_cases · 월 순번 한 줄뿐이다.
 *
 * 🔴 값은 전부 가짜다 — 실제 고객사 이름·L/N·S/N·신고증상 문장은 한 글자도
 * 쓰지 않는다(공개 저장소다. 신고증상에는 고객사 사정이 섞인다).
 * ============================================================================
 */

const TEST_CUSTOMER_NAME_PREFIX = "AS-TEST-CUSTOMER-COLUMNS-";
const TEST_MODEL_PREFIX = "COLUMNS-TEST-MODEL-";
const TEST_YEAR_MONTH = "9411";
const RECEIVED_AT = "2094-11-05";
/** 가짜 신고증상 한 문장. 실제 접수 건의 문장이 아니다. */
const FAKE_SYMPTOM = "시험용 가짜 증상입니다. 전원이 들어오지 않는다고 적혀 있습니다.";

let customerId: string;
let engineerId: string;
const createdCaseIds = new Set<string>();
const createdProductIds = new Set<string>();

before(async () => {
  const [customer] = await db
    .insert(customers)
    .values({ name: `${TEST_CUSTOMER_NAME_PREFIX}${randomUUID().slice(0, 8)}` })
    .returning({ id: customers.id });
  customerId = customer.id;

  const [engineer] = await db
    .select({ id: users.id })
    .from(users)
    .where(and(eq(users.role, "AS_ENGINEER"), eq(users.approvalStatus, "APPROVED"), eq(users.isDeleted, false)))
    .limit(1);
  assert.ok(engineer, "expected at least one approved AS_ENGINEER in the test DB");
  engineerId = engineer.id;
});

after(async () => {
  const caseIds = [...createdCaseIds];
  if (caseIds.length > 0) {
    await db.delete(repairCases).where(inArray(repairCases.id, caseIds));
  }
  const productIds = [...createdProductIds];
  if (productIds.length > 0) {
    await db.delete(products).where(inArray(products.id, productIds));
  }
  await db.delete(repairCaseIntakeSequences).where(eq(repairCaseIntakeSequences.yearMonth, TEST_YEAR_MONTH));
  if (customerId) {
    await db.delete(customers).where(eq(customers.id, customerId));
  }
  await pgClient.end({ timeout: 5 });
});

function baseCreateInput(reportedSymptom: string | null): {
  input: ValidatedCreateRepairCaseInput;
  lotNumber: string;
  serialNumber: string;
} {
  const suffix = randomUUID().slice(0, 8);
  const lotNumber = `COLUMNS-LOT-${suffix}`;
  const serialNumber = `COLUMNS-SN-${suffix}`;
  return {
    lotNumber,
    serialNumber,
    input: {
      workflowType: "PAID_MATCHER",
      billingType: "PAID",
      customerId,
      endUserId: null,
      assignedEngineerId: engineerId,
      receivedAt: RECEIVED_AT,
      customerRequestedDueDate: null,
      internalTargetShipmentDate: null,
      modelName: `${TEST_MODEL_PREFIX}${suffix}`,
      lotNumber,
      serialNumber,
      partNumber: null,
      accessoryList: null,
      externalConditionSummary: null,
      reasonForRemoval: null,
      reportedSymptom,
      intakeInspectionResult: null,
      currentDiagnosisSummary: null,
      nextPlannedAction: null,
      notes: null,
      contactName: null,
      contactPhone: null,
      contactEmail: null,
    },
  };
}

async function createTestCase(
  reportedSymptom: string | null
): Promise<{ id: string; lotNumber: string; serialNumber: string }> {
  const { input, lotNumber, serialNumber } = baseCreateInput(reportedSymptom);
  const created = await createRepairCase(input);
  assert.equal(created.ok, true, `setup failed: ${JSON.stringify(created)}`);
  if (!created.ok) throw new Error("setup failed");
  createdCaseIds.add(created.id);
  const [row] = await db
    .select({ productId: repairCases.productId })
    .from(repairCases)
    .where(eq(repairCases.id, created.id));
  assert.ok(row);
  createdProductIds.add(row.productId);
  return { id: created.id, lotNumber, serialNumber };
}

describe("listRepairCases — 화면이 그리는 칸을 실제로 싣고 온다", () => {
  test("🔴 신고증상이 적힌 대로 실려 온다 (그리고 L/N·S/N 도 함께)", async () => {
    const created = await createTestCase(FAKE_SYMPTOM);

    const rows = await listRepairCases();
    const row = rows.find((r) => r.id === created.id);
    assert.ok(row, "만든 건이 목록에 없다");

    assert.equal(
      row.reportedSymptom,
      FAKE_SYMPTOM,
      "신고증상이 실려 오지 않았다 — 조회의 select 에서 빠지면 화면은 늘 빈 칸만 그린다"
    );
    assert.equal(row.lotNumber, created.lotNumber, "L/N 이 실려 오지 않았다");
    assert.equal(row.serialNumber, created.serialNumber, "S/N 이 실려 오지 않았다");
  });

  test("신고증상이 비어 있는 건은 null 그대로 온다 — 빈 글자로 둔갑하지 않는다", async () => {
    const created = await createTestCase(null);

    const rows = await listRepairCases();
    const row = rows.find((r) => r.id === created.id);
    assert.ok(row, "만든 건이 목록에 없다");
    assert.equal(row.reportedSymptom, null, "적지 않은 신고증상이 null 이 아니다");
  });
});
