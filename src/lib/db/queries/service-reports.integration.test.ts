import "../../../../scripts/load-env";

import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { and, eq, inArray, like } from "drizzle-orm";

import { db, pgClient } from "../connection";
import {
  customers,
  products,
  repairCaseIntakeSequences,
  repairCases,
  serviceReports,
  users,
} from "../schema";
import { createRepairCase } from "../mutations/repair-cases";
import { createServiceReport, softDeleteServiceReport } from "../mutations/service-reports";
import { getServiceReportForEdit, listServiceReportsForRepairCase } from "./service-reports";
import type { ServiceReportSaveValues } from "@/lib/validation/service-report-save-input";
import type { ValidatedCreateRepairCaseInput } from "@/lib/validation/repair-case-input";

/**
 * ============================================================================
 * 보고서 목록 — 접수 건 하나가 어떤 문서를 냈는가
 * ============================================================================
 * 값이 그대로 저장되고 돌아오는지는 `mutations/service-reports.integration.test.ts`
 * 가 본다. 여기서 못 박는 것은 **읽는 쪽의 경계** 넷이다.
 *
 *  1. 목록은 **그 접수 건의 것만** 보여 준다 — 남의 건 보고서가 섞이면 안 된다.
 *  2. 🔴 **지운 장은 목록에도 없고 id 로도 안 나온다.** 주소만으로 휴지통 것을
 *     계속 뽑을 수 있으면 휴지통이 뜻을 잃는다.
 *  3. 한 건에 **여러 장**이 붙고, 최근에 낸 것이 먼저 온다.
 *  4. 🔴 목록에 **본문도 고객사명도 담기지 않는다** — 목록을 그리는 데 필요하지
 *     않고, 담으면 로그와 오류 보고에 딸려 나갈 자리가 늘어난다.
 *
 * ── 격리 규약 ────────────────────────────────────────────────────────────
 * 접수 월 "9612", 고객사 접두사 "AS-TEST-SVCRPTQ-", 제품 모델 접두사
 * "SVCRPTQ-TEST-". 인수번호의 연월은 receivedAt 에서 나오므로 둘은 언제나 같은
 * 달을 가리켜야 한다.
 * ============================================================================
 */

const TEST_CUSTOMER_NAME_PREFIX = "AS-TEST-SVCRPTQ-";
const TEST_MODEL_PREFIX = "SVCRPTQ-TEST-";
const TEST_YEAR_MONTH = "9612";
const TEST_RECEIVED_AT = "2096-12-05";

let actorUserId: string;
let actorUserName: string;
let engineerId: string;
let customerId: string;
const createdReportIds: string[] = [];

function values(overrides: Partial<ServiceReportSaveValues> = {}): ServiceReportSaveValues {
  return {
    kind: "REPAIR",

    customerName: "ICD Co.,Ltd",
    issuedOn: "2096-12-20",
    reportNumberPrefix: "DSS",
    reportNumberMiddle: "Z494",
    reportNumberTail: "001",
    customer: "",
    receivedOn: TEST_RECEIVED_AT,
    occurrencePlace: "",
    occurrencePlaceDetail: "",
    occurredOnMode: "DATE",
    occurredOnDate: "",
    occurredOnText: "",
    productName: "",
    productCategory: "",
    modelName: "",
    manufacturedYear: "",
    manufacturedMonth: "",
    lotNumber: "",
    serialNumber: "",
    usedYears: "",
    usedMonths: "",
    situationRequest: "",
    situationDetail: "",

    onSiteRepair: false,
    replacementDelivery: false,
    goodsReceiptChecked: false,
    goodsReceiptOn: "",
    goodsReceiptNumber: "",
    completionChecked: false,
    completionOn: "",
    repairNumber: "",
    causes: [],

    findingsIntro: "",
    findings: "확인내용 한 줄",
    actions: "",
    summary: "",

    remark: "",
    ...overrides,
  };
}

async function create(repairCaseId: string, overrides: Partial<ServiceReportSaveValues> = {}) {
  const result = await createServiceReport({ repairCaseId, values: values(overrides), actorUserId });
  assert.equal(result.ok, true, JSON.stringify(result));
  if (!result.ok) throw new Error("unreachable");
  createdReportIds.push(result.id);
  return result;
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

async function newRepairCase(): Promise<string> {
  const created = await createRepairCase(baseCreateRepairCaseInput());
  assert.equal(created.ok, true, `setup repair case failed: ${JSON.stringify(created)}`);
  if (!created.ok) throw new Error("unreachable");
  return created.id;
}

before(async () => {
  const [engineer] = await db
    .select({ id: users.id, name: users.name })
    .from(users)
    .where(
      and(eq(users.role, "AS_ENGINEER"), eq(users.approvalStatus, "APPROVED"), eq(users.isDeleted, false))
    )
    .limit(1);
  assert.ok(engineer, "expected at least one approved AS_ENGINEER in the test DB");
  engineerId = engineer.id;
  actorUserId = engineer.id;
  actorUserName = engineer.name;

  const [customer] = await db
    .insert(customers)
    .values({ name: `${TEST_CUSTOMER_NAME_PREFIX}${randomUUID().slice(0, 8)}` })
    .returning({ id: customers.id });
  customerId = customer.id;
});

after(async () => {
  if (createdReportIds.length > 0) {
    await db.delete(serviceReports).where(inArray(serviceReports.id, createdReportIds));
  }
  await db.delete(repairCases).where(like(repairCases.intakeNumber, `D${TEST_YEAR_MONTH}%`));
  await db.delete(products).where(like(products.modelName, `${TEST_MODEL_PREFIX}%`));
  await db
    .delete(repairCaseIntakeSequences)
    .where(eq(repairCaseIntakeSequences.yearMonth, TEST_YEAR_MONTH));
  await db.delete(customers).where(like(customers.name, `${TEST_CUSTOMER_NAME_PREFIX}%`));
  await pgClient.end({ timeout: 5 });
});

describe("listServiceReportsForRepairCase", () => {
  test("보고서가 없는 접수 건은 빈 목록이다", async () => {
    assert.deepEqual(await listServiceReportsForRepairCase(await newRepairCase()), []);
  });

  test("🔴 한 건에 검사 한 장과 수리 한 장이 함께 붙고, 최근에 낸 것이 먼저 온다", async () => {
    const repairCaseId = await newRepairCase();
    await create(repairCaseId, { kind: "INSPECTION", issuedOn: "2096-12-10", reportNumberTail: "010" });
    await create(repairCaseId, { kind: "REPAIR", issuedOn: "2096-12-24", reportNumberTail: "024" });

    const rows = await listServiceReportsForRepairCase(repairCaseId);
    assert.deepEqual(
      rows.map((row) => [row.kind, row.issuedOn]),
      [
        ["REPAIR", "2096-12-24"],
        ["INSPECTION", "2096-12-10"],
      ]
    );
  });

  test("문서번호 세 조각이 한 줄로 이어진다 — 빈 조각은 빠진다", async () => {
    const repairCaseId = await newRepairCase();
    await create(repairCaseId, { reportNumberPrefix: "DSS", reportNumberMiddle: "Z494", reportNumberTail: "001" });
    const withPrefix = await listServiceReportsForRepairCase(repairCaseId);
    assert.equal(withPrefix[0].reportNumber, "DSS-Z494-001");

    const otherCaseId = await newRepairCase();
    await create(otherCaseId, { reportNumberPrefix: "", reportNumberMiddle: "Z494", reportNumberTail: "002" });
    const withoutPrefix = await listServiceReportsForRepairCase(otherCaseId);
    assert.equal(withoutPrefix[0].reportNumber, "Z494-002");
  });

  test("만든 사람과 낙관적 잠금 토큰이 함께 온다 — 목록에서 열어 고치는 화면이 쓴다", async () => {
    const repairCaseId = await newRepairCase();
    await create(repairCaseId);

    const [row] = await listServiceReportsForRepairCase(repairCaseId);
    assert.equal(row.createdByName, actorUserName);
    assert.equal(row.version, 1);
    assert.ok(row.updatedAt, "고친 때가 있어야 한다");
  });

  test("🔴 목록에 본문도 고객사명도 담기지 않는다", async () => {
    const repairCaseId = await newRepairCase();
    await create(repairCaseId, { findings: "목록에 새면 안 되는 확인내용" });

    const [row] = await listServiceReportsForRepairCase(repairCaseId);
    assert.deepEqual(
      Object.keys(row).sort(),
      ["createdByName", "id", "issuedOn", "kind", "reportNumber", "updatedAt", "version"]
    );
    const serialized = JSON.stringify(row);
    assert.ok(!serialized.includes("목록에 새면 안 되는"), "본문이 목록에 새어 나갔다");
    assert.ok(!serialized.includes("ICD Co.,Ltd"), "고객사명이 목록에 새어 나갔다");
  });

  test("다른 접수 건의 보고서가 섞이지 않는다", async () => {
    const mine = await newRepairCase();
    const theirs = await newRepairCase();
    const created = await create(mine);
    await create(theirs);

    const rows = await listServiceReportsForRepairCase(mine);
    assert.deepEqual(
      rows.map((row) => row.id),
      [created.id]
    );
  });
});

describe("🔴 지운 장은 어느 길로도 안 나온다", () => {
  test("목록에서 사라지고, 남은 장은 그대로 있다", async () => {
    const repairCaseId = await newRepairCase();
    const doomed = await create(repairCaseId, { reportNumberTail: "지울 것" });
    const kept = await create(repairCaseId, { reportNumberTail: "남길 것" });

    const before = await listServiceReportsForRepairCase(repairCaseId);
    assert.equal(before.length, 2);

    const deleted = await softDeleteServiceReport({
      serviceReportId: doomed.id,
      expectedVersion: doomed.version,
      actorUserId,
      reason: null,
    });
    assert.equal(deleted.ok, true, JSON.stringify(deleted));

    assert.deepEqual(
      (await listServiceReportsForRepairCase(repairCaseId)).map((row) => row.id),
      [kept.id]
    );
  });

  test("id 로도 안 나온다 — 휴지통이 뜻을 잃지 않게", async () => {
    const repairCaseId = await newRepairCase();
    const doomed = await create(repairCaseId);
    await softDeleteServiceReport({
      serviceReportId: doomed.id,
      expectedVersion: doomed.version,
      actorUserId,
      reason: null,
    });

    assert.equal(await getServiceReportForEdit(doomed.id), null);
  });

  test("없는 id 도 null 이다", async () => {
    assert.equal(await getServiceReportForEdit(randomUUID()), null);
  });
});
