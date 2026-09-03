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
import {
  getServiceReportForEdit,
  listDeletedServiceReportsForRepairCase,
  listServiceReportsForRepairCase,
} from "./service-reports";
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
 * 휴지통 조회(`listDeletedServiceReportsForRepairCase`)도 같은 넷을 지켜야 한다.
 * 다른 것은 정렬 기준 하나뿐이다 — 그쪽은 **지운 시각 내림차순**이다.
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

/**
 * 휴지통. 되살릴 장을 고르는 화면이 읽는 자리다.
 *
 * 「어떤 장이 지워졌나」는 위 describe 가 이미 반대쪽에서 못 박았다. 여기서
 * 보는 것은 **되살리려면 알아야 하는 것들**이다 — 어느 건의 것인지, 언제 누가
 * 왜 지웠는지, 그리고 방금 지운 것이 맨 위에 오는지.
 */
describe("listDeletedServiceReportsForRepairCase", () => {
  async function softDelete(
    report: { id: string; version: number },
    reason: string | null = null
  ): Promise<void> {
    const result = await softDeleteServiceReport({
      serviceReportId: report.id,
      expectedVersion: report.version,
      actorUserId,
      reason,
    });
    assert.equal(result.ok, true, JSON.stringify(result));
  }

  /**
   * 지운 시각을 못 박는다. 실제 삭제는 `new Date()` 를 쓰므로 잇달아 두 장을
   * 지우면 같은 밀리초에 들어갈 수 있고, 그러면 **정렬을 보는 시험이 순서를
   * 우연에 맡기게 된다.** 여기서 보려는 것은 「ORDER BY 가 지운 시각 내림차순인가」
   * 하나이므로 그 값을 시험이 정한다.
   */
  async function pinDeletedAt(id: string, at: string): Promise<void> {
    await db.update(serviceReports).set({ deletedAt: new Date(at) }).where(eq(serviceReports.id, id));
  }

  test("아무것도 안 지운 접수 건은 빈 휴지통이다", async () => {
    const repairCaseId = await newRepairCase();
    await create(repairCaseId);
    assert.deepEqual(await listDeletedServiceReportsForRepairCase(repairCaseId), []);
  });

  test("🔴 지운 것만 나온다 — 살아 있는 장은 휴지통에 없다", async () => {
    const repairCaseId = await newRepairCase();
    const doomed = await create(repairCaseId, { reportNumberTail: "지울 것" });
    const kept = await create(repairCaseId, { reportNumberTail: "남길 것" });
    await softDelete(doomed);

    assert.deepEqual(
      (await listDeletedServiceReportsForRepairCase(repairCaseId)).map((row) => row.id),
      [doomed.id]
    );
    // 반대쪽도 그대로다 — 목록과 휴지통이 한 장을 두 번 보여 주면 안 된다.
    assert.deepEqual(
      (await listServiceReportsForRepairCase(repairCaseId)).map((row) => row.id),
      [kept.id]
    );
  });

  test("다른 접수 건의 휴지통이 섞이지 않는다", async () => {
    const mine = await newRepairCase();
    const theirs = await newRepairCase();
    const doomedMine = await create(mine);
    const doomedTheirs = await create(theirs);
    await softDelete(doomedMine);
    await softDelete(doomedTheirs);

    assert.deepEqual(
      (await listDeletedServiceReportsForRepairCase(mine)).map((row) => row.id),
      [doomedMine.id]
    );
  });

  test("🔴 지운 시각 내림차순 — 방금 지운 것이 맨 위다", async () => {
    const repairCaseId = await newRepairCase();
    const first = await create(repairCaseId, { reportNumberTail: "001" });
    const second = await create(repairCaseId, { reportNumberTail: "002" });
    const third = await create(repairCaseId, { reportNumberTail: "003" });

    await softDelete(first);
    await softDelete(second);
    await softDelete(third);

    // 발행일·문서번호는 모두 같은데 지운 시각만 다르게 둔다 — 다른 기준이 끼어들
    // 여지를 없앤다.
    await pinDeletedAt(first.id, "2096-12-20T01:00:00.000Z");
    await pinDeletedAt(second.id, "2096-12-20T03:00:00.000Z");
    await pinDeletedAt(third.id, "2096-12-20T02:00:00.000Z");

    const rows = await listDeletedServiceReportsForRepairCase(repairCaseId);
    assert.deepEqual(
      rows.map((row) => row.reportNumber),
      ["DSS-Z494-002", "DSS-Z494-003", "DSS-Z494-001"]
    );
    assert.equal(rows[0].deletedAt, "2096-12-20T03:00:00.000Z");
  });

  test("사유와 지운 사람이 함께 온다 — 되살릴지 판단하는 단서다", async () => {
    const repairCaseId = await newRepairCase();
    const doomed = await create(repairCaseId);
    await softDelete(doomed, "번호를 잘못 매겼다");

    const [row] = await listDeletedServiceReportsForRepairCase(repairCaseId);
    assert.equal(row.deleteReason, "번호를 잘못 매겼다");
    assert.equal(row.deletedByName, actorUserName);
    assert.ok(row.deletedAt, "지운 때가 있어야 한다");
    // 되살리기가 대조할 토큰. 지우면서 한 번 올라갔다.
    assert.equal(row.version, doomed.version + 1);
  });

  test("사유 없이 지우면 사유가 null 이다 — 빈 글자로 뭉개지 않는다", async () => {
    const repairCaseId = await newRepairCase();
    await softDelete(await create(repairCaseId));

    const [row] = await listDeletedServiceReportsForRepairCase(repairCaseId);
    assert.equal(row.deleteReason, null);
  });

  test("🔴 휴지통에도 본문도 고객사명도 담기지 않는다", async () => {
    const repairCaseId = await newRepairCase();
    const doomed = await create(repairCaseId, { findings: "휴지통에 새면 안 되는 확인내용" });
    await softDelete(doomed);

    const [row] = await listDeletedServiceReportsForRepairCase(repairCaseId);
    assert.deepEqual(
      Object.keys(row).sort(),
      [
        "deleteReason",
        "deletedAt",
        "deletedByName",
        "id",
        "issuedOn",
        "kind",
        "reportNumber",
        "version",
      ]
    );
    const serialized = JSON.stringify(row);
    assert.ok(!serialized.includes("휴지통에 새면 안 되는"), "본문이 휴지통에 새어 나갔다");
    assert.ok(!serialized.includes("ICD Co.,Ltd"), "고객사명이 휴지통에 새어 나갔다");
  });
});
