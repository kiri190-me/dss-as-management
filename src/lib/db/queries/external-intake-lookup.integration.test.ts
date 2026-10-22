import "../../../../scripts/load-env";

import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { and, eq, like } from "drizzle-orm";

import { db, pgClient } from "../connection";
import {
  customers,
  endUsers,
  products,
  repairCaseIntakeSequences,
  repairCases,
  users,
} from "../schema";
import { createRepairCase } from "../mutations/repair-cases";
import { findIntakeForExternalLookup } from "./external-intake-lookup";
import type { ValidatedCreateRepairCaseInput } from "@/lib/validation/repair-case-input";

/**
 * ============================================================================
 * 인수번호 조회(재고 관리가 부르는 `findIntakeForExternalLookup`) — 🔴 2026-10-22,
 * 이 질의를 **실제로 돌려 재는 첫 시험.**
 * ============================================================================
 * 이 질의는 `GET /api/v1/intakes/{번호}` 하나만 부른다(라우트 자체는
 * `src/app/api/v1/route-source.test.ts` 가 소스로 못 박는다 — DB 연결 없이는
 * import 조차 안 되는 라우트라서다). 질의 본문 — 조인이 맞는가 · 휴지통을
 * 거르는가 · receivedAt 이 손상 없이 오는가 — 는 그 소스 못박기로는 잴 수 없어
 * 여기서 DB 를 직접 두드려 잰다.
 *
 * 지키는 것 넷:
 *  1. 살아 있는 건은 일곱 칸(고객사 · End-User · 모델 · S/N · L/N · receivedAt ·
 *     intakeNumber)이 전부 온다.
 *  2. 🔴 **휴지통(`is_deleted = true`)에 든 건은 null 이다** — 이 통로가 기존
 *     가져오기용 질의를 쓰지 않고 새 질의를 둔 까닭(파일 머리 주석) 그 자체.
 *  3. 없는 인수번호는 null 이다.
 *  4. 🔴 **`receivedAt` 은 조인 칸들과 다르다.** End-User 가 안 이어진 건도
 *     `receivedAt` 은 null 이 아니다 — `repair_cases` 자신의 NOT NULL 칸이라서다.
 *     그리고 넣은 날짜 글자와 받은 글자가 **한 글자도 다르지 않아야** 한다(시간대
 *     변환이 끼어들면 하루가 밀리거나 당겨진다).
 *
 * 격리 규약: 접수 월 "9112", 고객사·모델 접두사 "AS-TEST-EXT-LOOKUP-".
 * ============================================================================
 */

const TEST_CUSTOMER_NAME_PREFIX = "AS-TEST-EXT-LOOKUP-";
const TEST_MODEL_PREFIX = "EXT-LOOKUP-TEST-";
const TEST_YEAR_MONTH = "9112";
const TEST_RECEIVED_AT = "2091-12-05";

let engineerId: string;
let customerId: string;
let endUserId: string;

function baseCreateRepairCaseInput(
  overrides: Partial<ValidatedCreateRepairCaseInput> = {}
): ValidatedCreateRepairCaseInput {
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
    reportedSymptom: "외부 질의 시험용 더미 증상",
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

async function intakeNumberOf(repairCaseId: string): Promise<string> {
  const [row] = await db
    .select({ intakeNumber: repairCases.intakeNumber })
    .from(repairCases)
    .where(eq(repairCases.id, repairCaseId));
  return row.intakeNumber;
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

  const [endUser] = await db
    .insert(endUsers)
    .values({ customerId, name: `${TEST_CUSTOMER_NAME_PREFIX}END-${randomUUID().slice(0, 8)}` })
    .returning({ id: endUsers.id });
  endUserId = endUser.id;
});

after(async () => {
  await db.delete(repairCases).where(like(repairCases.intakeNumber, `D${TEST_YEAR_MONTH}%`));
  await db.delete(products).where(like(products.modelName, `${TEST_MODEL_PREFIX}%`));
  await db
    .delete(repairCaseIntakeSequences)
    .where(eq(repairCaseIntakeSequences.yearMonth, TEST_YEAR_MONTH));
  await db.delete(endUsers).where(like(endUsers.name, `${TEST_CUSTOMER_NAME_PREFIX}%`));
  await db.delete(customers).where(like(customers.name, `${TEST_CUSTOMER_NAME_PREFIX}%`));
  await pgClient.end({ timeout: 5 });
});

describe("findIntakeForExternalLookup", () => {
  test("살아 있는 건은 일곱 칸이 전부 온다 — receivedAt 포함", async () => {
    const created = await createRepairCase(baseCreateRepairCaseInput({ endUserId }));
    assert.equal(created.ok, true, `setup repair case failed: ${JSON.stringify(created)}`);
    if (!created.ok) throw new Error("unreachable");
    const intakeNumber = await intakeNumberOf(created.id);

    const found = await findIntakeForExternalLookup(intakeNumber);
    assert.ok(found, "찾지 못했다");
    assert.equal(found.intakeNumber, intakeNumber);
    assert.ok(found.customerName?.startsWith(TEST_CUSTOMER_NAME_PREFIX));
    assert.ok(found.endUser?.startsWith(TEST_CUSTOMER_NAME_PREFIX));
    assert.ok(found.productModel?.startsWith(TEST_MODEL_PREFIX));
    assert.ok(found.productSerial?.startsWith("SN-"));
    assert.ok(found.productLot?.startsWith("LOT-"));
    // 🔴 넣은 날짜 글자와 받은 글자가 한 글자도 다르지 않다 — 시간대 변환이
    // 끼어들었다면 "2091-12-04" 나 "2091-12-06" 처럼 하루가 밀리거나 당겨진다.
    assert.equal(found.receivedAt, TEST_RECEIVED_AT);
  });

  test("🔴 휴지통(is_deleted = true)에 든 건은 null 이다", async () => {
    const created = await createRepairCase(baseCreateRepairCaseInput({ endUserId }));
    assert.equal(created.ok, true, `setup repair case failed: ${JSON.stringify(created)}`);
    if (!created.ok) throw new Error("unreachable");
    const intakeNumber = await intakeNumberOf(created.id);

    await db.update(repairCases).set({ isDeleted: true }).where(eq(repairCases.id, created.id));

    assert.equal(await findIntakeForExternalLookup(intakeNumber), null);
  });

  test("없는 인수번호는 null 이다", async () => {
    assert.equal(await findIntakeForExternalLookup("D999999"), null);
  });

  test("🔴 End-User 가 안 이어진 건도 receivedAt 은 null 이 아니다 — 조인 칸과 자신의 칸은 다르다", async () => {
    const created = await createRepairCase(baseCreateRepairCaseInput({ endUserId: null }));
    assert.equal(created.ok, true, `setup repair case failed: ${JSON.stringify(created)}`);
    if (!created.ok) throw new Error("unreachable");
    const intakeNumber = await intakeNumberOf(created.id);

    const found = await findIntakeForExternalLookup(intakeNumber);
    assert.ok(found);
    assert.equal(found.endUser, null, "End-User 를 안 이었는데 값이 있다");
    assert.equal(found.receivedAt, TEST_RECEIVED_AT, "receivedAt 은 조인과 무관하게 항상 있어야 한다");
  });
});
