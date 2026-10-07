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
 * 전체 A/S 현황(/repair-cases)의 기본 차례 — 인수번호 내림차순 (2026-10-07 요구)
 * ============================================================================
 * 이 파일이 지키는 것은 **listRepairCases() 가 돌려주는 차례** 하나다.
 *
 * 🔴 왜 "접수일과 어긋나는 자료"가 반드시 있어야 하는가 — 인수번호는 접수일의
 * 연·월에서 뽑으므로(createRepairCase 의 yearMonthFromDate), 달이 다른 건들만
 * 늘어놓으면 접수일 내림차순과 인수번호 내림차순이 **우연히 같아진다.** 그러면
 * 정렬 기준을 되돌려 놓아도 시험이 조용히 통과한다. 그래서 아래 fixture 는 **같은
 * 달 안에서** 접수일과 번호 발급 차례를 일부러 어긋나게 만든다(월 순번은 접수일이
 * 아니라 **만든 차례**로 올라간다).
 *
 * 인수번호는 `D + YY + MM + 2자리`로 길이 7 고정이라 글자 정렬이 곧 시간 정렬이고,
 * unique 라 동점이 없어 보조 정렬이 없다 — 까닭은 queries/repair-cases.ts 의
 * listRepairCases 머리말에 적어 두었다.
 *
 * 자기 뒤처리 규약은 이웃(repair-cases-mine.integration.test.ts)과 같다: 이 묶음만
 * 쓰는 인수 월 "9410"(다른 어느 시험 파일도 쓰지 않는다)과 모델 이름 앞가지로
 * 가둬 두고, after() 가 만든 줄만 지운다. legacyImportState 없이 부르므로
 * createRepairCase 가 남기는 것은 products · repair_cases · 월 순번 한 줄뿐이다
 * (감사 로그·상태 이력은 생기지 않는다).
 * ============================================================================
 */

const TEST_CUSTOMER_NAME_PREFIX = "AS-TEST-CUSTOMER-ORDER-";
const TEST_MODEL_PREFIX = "ORDER-TEST-MODEL-";
const TEST_YEAR_MONTH = "9410";
/** 셋 다 같은 달이다 — 달이 갈리면 두 차례가 저절로 같아진다(머리말). */
const RECEIVED_AT_LATE = "2094-10-25";
const RECEIVED_AT_EARLY = "2094-10-05";
const RECEIVED_AT_MIDDLE = "2094-10-15";

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

function baseCreateInput(receivedAt: string): ValidatedCreateRepairCaseInput {
  const suffix = randomUUID().slice(0, 8);
  return {
    workflowType: "PAID_MATCHER",
    billingType: "PAID",
    customerId,
    endUserId: null,
    assignedEngineerId: engineerId,
    receivedAt,
    customerRequestedDueDate: null,
    internalTargetShipmentDate: null,
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

async function createTestCase(receivedAt: string): Promise<{ id: string; intakeNumber: string }> {
  const created = await createRepairCase(baseCreateInput(receivedAt));
  assert.equal(created.ok, true, `setup failed: ${JSON.stringify(created)}`);
  if (!created.ok) throw new Error("setup failed");
  createdCaseIds.add(created.id);
  const [row] = await db
    .select({ productId: repairCases.productId })
    .from(repairCases)
    .where(eq(repairCases.id, created.id));
  assert.ok(row);
  createdProductIds.add(row.productId);
  return { id: created.id, intakeNumber: created.intakeNumber };
}

describe("listRepairCases — 전체 A/S 현황의 기본 차례", () => {
  test("인수번호가 큰 건이 먼저 나오고, 접수일 차례와 어긋나면 인수번호가 이긴다", async () => {
    // 만든 차례대로 월 순번이 올라간다. 접수일은 일부러 거꾸로·뒤섞어 준다.
    const first = await createTestCase(RECEIVED_AT_LATE); // 번호 가장 작음 · 접수일 가장 늦음
    const second = await createTestCase(RECEIVED_AT_EARLY); // 번호 가운데 · 접수일 가장 이름
    const third = await createTestCase(RECEIVED_AT_MIDDLE); // 번호 가장 큼 · 접수일 가운데

    // fixture 자체가 의도대로 섰는지부터 본다 — 번호는 만든 차례로 커진다.
    assert.ok(
      first.intakeNumber < second.intakeNumber && second.intakeNumber < third.intakeNumber,
      `인수번호가 만든 차례로 커지지 않았다: ${first.intakeNumber}, ${second.intakeNumber}, ${third.intakeNumber}`
    );

    const rows = await listRepairCases();
    const indexOf = (id: string) => rows.findIndex((row) => row.id === id);
    const [firstAt, secondAt, thirdAt] = [indexOf(first.id), indexOf(second.id), indexOf(third.id)];
    assert.ok(firstAt >= 0 && secondAt >= 0 && thirdAt >= 0, "만든 세 건이 목록에 모두 있어야 한다");

    // 인수번호 내림차순이면 third → second → first 다.
    assert.ok(
      thirdAt < secondAt && secondAt < firstAt,
      `인수번호 내림차순이 아니다: ${JSON.stringify([
        [rows[thirdAt]?.intakeNumber, thirdAt],
        [rows[secondAt]?.intakeNumber, secondAt],
        [rows[firstAt]?.intakeNumber, firstAt],
      ])}`
    );

    // 🔴 접수일 내림차순이었다면 first → third → second 다. 그 차례가 아님을
    // 못 박아 둔다 — 기준을 received_at 으로 되돌리면 여기서 깨진다.
    assert.ok(
      !(firstAt < thirdAt && thirdAt < secondAt),
      "접수일 내림차순 차례로 나왔다 — 정렬 기준이 인수번호가 아니다"
    );
  });

  test("목록 전체가 인수번호 내림차순이다", async () => {
    const rows = await listRepairCases();
    assert.ok(rows.length >= 3, "앞 시험이 만든 건이 있어야 한다");

    for (let i = 1; i < rows.length; i += 1) {
      const previous = rows[i - 1].intakeNumber;
      const current = rows[i].intakeNumber;
      // 인수번호는 unique 라 동점이 없다 — 그래서 '>' 다('>=' 가 아니다).
      assert.ok(
        previous > current,
        `${i - 1}번째(${previous})가 ${i}번째(${current})보다 커야 한다 — 인수번호 내림차순이 깨졌다`
      );
    }
  });
});
