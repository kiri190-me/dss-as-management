import "../../../../scripts/load-env";

import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { and, asc, desc, eq, inArray, like } from "drizzle-orm";

import { db, pgClient } from "../connection";
import {
  auditLogs,
  customers,
  products,
  repairCaseIntakeSequences,
  repairCases,
  serviceReportCauses,
  serviceReportLines,
  serviceReports,
  users,
} from "../schema";
import { createRepairCase } from "./repair-cases";
import {
  createServiceReport,
  restoreServiceReport,
  softDeleteServiceReport,
  updateServiceReport,
} from "./service-reports";
import { getServiceReportForEdit } from "../queries/service-reports";
import { buildServiceReportRequestBody } from "@/lib/domain/service-report-form";
import { serviceReportFormValues, type ServiceReportSaveValues } from "@/lib/validation/service-report-save-input";
import { validateServiceReportFields } from "@/lib/validation/service-report-input";
import { SERVICE_REPORT_FINDINGS_INTRO } from "@/lib/xlsx/service-report-template";
import type { ValidatedCreateRepairCaseInput } from "@/lib/validation/repair-case-input";

/**
 * ============================================================================
 * 검사·수리 보고서 — 적어 둔 그대로 저장되고, 동시 수정이 막히는가
 * ============================================================================
 * 견적서 통합 시험(`quotes.integration.test.ts`)과 같은 자리, 같은 규율이다.
 * 확인하는 것은 여덟 가지다.
 *
 *  1. **왕복** — 만들고 다시 읽으면 폼 값이 글자 하나 안 틀리고 그대로다.
 *     저장이 값을 조금 바꾸면 오류가 아니라 **다른 문서**가 나가고, 그것은
 *     고객사가 먼저 안다.
 *  2. 🔴 **본문 가운데 빈 줄이 살아남는다** — 사람이 Enter 를 두 번 친 것은
 *     문서에서 한 줄 띄우라는 뜻이다. 걸러 내면 문단 나누기가 통째로 사라진다.
 *  3. 🔴 **`findingsIntro` 의 빈 글자가 NULL 이 되지 않는다** — 두 값을 같게
 *     다루면 사람이 지운 문장이 다시 열었을 때 되살아난다.
 *  4. 🔴 **저장한 것이 문서 생산을 깨뜨리지 않는다** — 불러온 값으로
 *     `buildServiceReportRequestBody()` → `validateServiceReportFields()` 가
 *     통과해야 한다. 이것이 그 사실의 유일한 자동 증거다.
 *  5. **낙관적 잠금** — 낡은 version 으로 온 저장은 CONFLICT 이고, 그때 **본문
 *     한 줄도 바뀌지 않는다.**
 *  6. **줄과 원인은 통째로 갈아 끼워진다** — 폼에서 지운 줄이 남으면 안 된다.
 *  7. **휴지통** — 지운 장은 목록에도 없고 id 로도 안 나온다. 되살리면 본문도
 *     함께 돌아온다.
 *  8. 🔴 **감사에는 본문이 없다** — 확인내용도 고객사명도 담기지 않는다.
 *
 * 인가는 여기서 시험하지 않는다. 세션·역할 판정은 부르는 쪽의 몫이고
 * (`mutations/service-reports.ts` 머리말의 계층 구분), 수준 정책은
 * `auth/service-report-authorization.test.ts` 가 따로 본다.
 *
 * ── 격리 규약 ────────────────────────────────────────────────────────────
 * 이 스위트만 쓰는 접수 월 "9611", 고객사 접두사 "AS-TEST-SVCRPT-",
 * 제품 모델 접두사 "SVCRPT-TEST-". 인수번호의 연월은 receivedAt 에서 나오므로
 * TEST_YEAR_MONTH 와 TEST_RECEIVED_AT 은 언제나 같은 달을 가리켜야 한다.
 *
 * after() 는 FK 순서대로 지운다 — service_reports 를 먼저 지운다(줄·원인은
 * CASCADE 로 함께 사라진다). 그 표가 users 를 RESTRICT 로 가리키고 있어서, 남겨
 * 두면 다른 정리까지 통째로 실패할 수 있다.
 *
 * 🔴 audit_logs 는 지우지 않는다 — `test-cleanup-static-safety.test.ts` 가
 * targetRecordId 로 지우는 정리를 금지한다(한 번 크게 데인 자리다).
 * ============================================================================
 */

const TEST_CUSTOMER_NAME_PREFIX = "AS-TEST-SVCRPT-";
const TEST_MODEL_PREFIX = "SVCRPT-TEST-";
const TEST_YEAR_MONTH = "9611";
const TEST_RECEIVED_AT = "2096-11-05";

let actorUserId: string;
let engineerId: string;
let customerId: string;
let repairCaseId: string;
const createdReportIds: string[] = [];

/**
 * 모든 칸이 채워진 한 장. 왕복 시험이 여기서 시작한다 — 빈 값만 넣어 두면
 * "옮기는 것을 잊은 칸"이 통과해 버린다.
 *
 * 🔴 `causes` 는 **양식의 배치 순서**로 적는다. 조회가 `cause` 로 정렬하면
 * Postgres 가 enum 을 선언 순서로 견주므로(= 체크박스가 그려지는 순서), 그
 * 순서로 돌아온다.
 */
function filled(overrides: Partial<ServiceReportSaveValues> = {}): ServiceReportSaveValues {
  return {
    kind: "REPAIR",

    customerName: "ICD Co.,Ltd",
    issuedOn: "2096-11-20",
    reportNumberPrefix: "DSS",
    reportNumberMiddle: `Z${randomUUID().slice(0, 4)}`,
    reportNumberTail: "001",
    customer: "생산기술부",
    receivedOn: TEST_RECEIVED_AT,
    occurrencePlace: "천안 2공장",
    occurrencePlaceDetail: "3층 라인 B",
    occurredOnMode: "DATE",
    occurredOnDate: "2096-11-01",
    occurredOnText: "",
    productName: "13.56MHz 30kW",
    productCategory: "RF Generator",
    modelName: "RFK300FH-AD1",
    manufacturedYear: "2085",
    manufacturedMonth: "2",
    lotNumber: "WU8042",
    serialNumber: "8502021",
    usedYears: "11",
    usedMonths: "9",
    // 🔴 앞 공백이 글머리표다 — 저장이 다듬으면 문서의 모양이 달라진다.
    situationRequest: " ・ 수리의뢰",
    situationDetail: " ・ Bias Fwd Drop 발생",

    onSiteRepair: true,
    replacementDelivery: false,
    goodsReceiptChecked: true,
    goodsReceiptOn: "2096-11-06",
    goodsReceiptNumber: "GR-9611-06",
    completionChecked: true,
    completionOn: "2096-11-19",
    repairNumber: "R-9611-118",
    causes: ["PART_DEFECT", "AGING"],

    findingsIntro: SERVICE_REPORT_FINDINGS_INTRO,
    findings: "외관 확인\n\n내부 점검",
    actions: "바리콘 교환",
    summary: "정상 동작 확인",

    remark: "재발 시 연락 바랍니다.",
    ...overrides,
  };
}

async function create(overrides: Partial<ServiceReportSaveValues> = {}) {
  const result = await createServiceReport({
    repairCaseId,
    values: filled(overrides),
    actorUserId,
  });
  if (result.ok) createdReportIds.push(result.id);
  return result;
}

async function readReport(id: string) {
  const [row] = await db.select().from(serviceReports).where(eq(serviceReports.id, id));
  return row;
}

/** 그 장의 본문 줄을 **구역·차례대로**. 조회가 쓰는 것과 같은 순서다. */
async function readLines(serviceReportId: string) {
  return db
    .select({
      section: serviceReportLines.section,
      lineNo: serviceReportLines.lineNo,
      text: serviceReportLines.text,
    })
    .from(serviceReportLines)
    .where(eq(serviceReportLines.serviceReportId, serviceReportId))
    .orderBy(asc(serviceReportLines.section), asc(serviceReportLines.lineNo));
}

async function readCauses(serviceReportId: string) {
  const rows = await db
    .select({ cause: serviceReportCauses.cause })
    .from(serviceReportCauses)
    .where(eq(serviceReportCauses.serviceReportId, serviceReportId))
    .orderBy(asc(serviceReportCauses.cause));
  return rows.map((row) => row.cause);
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

before(async () => {
  const [engineer] = await db
    .select({ id: users.id })
    .from(users)
    .where(
      and(eq(users.role, "AS_ENGINEER"), eq(users.approvalStatus, "APPROVED"), eq(users.isDeleted, false))
    )
    .limit(1);
  assert.ok(engineer, "expected at least one approved AS_ENGINEER in the test DB");
  engineerId = engineer.id;
  // created_by/updated_by 는 users 를 RESTRICT 로 가리킨다 — 실재하는 계정이어야
  // 한다. 역할은 상관없다(인가는 부르는 쪽의 몫이다).
  actorUserId = engineer.id;

  const [customer] = await db
    .insert(customers)
    .values({ name: `${TEST_CUSTOMER_NAME_PREFIX}${randomUUID().slice(0, 8)}` })
    .returning({ id: customers.id });
  customerId = customer.id;

  const created = await createRepairCase(baseCreateRepairCaseInput());
  assert.equal(created.ok, true, `setup repair case failed: ${JSON.stringify(created)}`);
  if (created.ok) repairCaseId = created.id;
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

describe("createServiceReport", () => {
  test("새 장은 version 1로 시작하고 만든 사람이 기록된다", async () => {
    const result = await create();
    assert.equal(result.ok, true, JSON.stringify(result));
    if (!result.ok) return;
    assert.equal(result.version, 1);

    const row = await readReport(result.id);
    assert.equal(row.version, 1);
    assert.equal(row.repairCaseId, repairCaseId);
    assert.equal(row.createdBy, actorUserId);
    // 만든 사람이 곧 마지막으로 고친 사람이다.
    assert.equal(row.updatedBy, actorUserId);
    assert.equal(row.isDeleted, false);
  });

  test("🔴 만들고 다시 읽으면 폼 값이 그대로다 — 왕복", async () => {
    const values = filled();
    const result = await createServiceReport({ repairCaseId, values, actorUserId });
    assert.equal(result.ok, true, JSON.stringify(result));
    if (!result.ok) return;
    createdReportIds.push(result.id);

    const loaded = await getServiceReportForEdit(result.id);
    assert.ok(loaded, "방금 만든 장을 id 로 못 찾으면 안 된다");
    assert.equal(loaded.version, 1);
    assert.equal(loaded.repairCaseId, repairCaseId);
    assert.deepEqual(loaded.values, values);
  });

  test("🔴 본문 가운데 빈 줄이 살아남는다 — 문단 나누기가 사라지면 안 된다", async () => {
    const result = await create({ findings: "가\n\n나" });
    assert.ok(result.ok, JSON.stringify(result));

    assert.deepEqual(
      (await readLines(result.id)).filter((line) => line.section === "FINDINGS"),
      [
        { section: "FINDINGS", lineNo: 1, text: "가" },
        // 🔴 이 줄이 걸러지면 오류 없이 문서의 모양만 달라진다.
        { section: "FINDINGS", lineNo: 2, text: "" },
        { section: "FINDINGS", lineNo: 3, text: "나" },
      ]
    );

    const loaded = await getServiceReportForEdit(result.id);
    assert.equal(loaded?.values.findings, "가\n\n나");
  });

  test("🔴 findingsIntro 의 빈 글자가 빈 글자로 남는다 — NULL 이 되지 않는다", async () => {
    const result = await create({ findingsIntro: "" });
    assert.ok(result.ok, JSON.stringify(result));

    // 칸 자체가 빈 글자여야 한다. NULL 이면 채우개가 정형 문구를 되살려 넣는다.
    assert.equal((await readReport(result.id)).findingsIntro, "");

    const loaded = await getServiceReportForEdit(result.id);
    assert.ok(loaded);
    assert.equal(loaded.values.findingsIntro, "");
    // 화면에 부을 때도 지운 채로 남는다.
    assert.equal(
      serviceReportFormValues(loaded.values, SERVICE_REPORT_FINDINGS_INTRO).findingsIntro,
      ""
    );
  });

  test("고른 원인만 남는다 — 열 가지 중 체크한 것뿐", async () => {
    const result = await create({ causes: ["MANUFACTURING_DEFECT", "MISHANDLING", "OTHER"] });
    assert.ok(result.ok, JSON.stringify(result));
    assert.deepEqual(await readCauses(result.id), ["MANUFACTURING_DEFECT", "MISHANDLING", "OTHER"]);
  });

  test("원인을 하나도 안 골랐으면 한 줄도 없다", async () => {
    const result = await create({ causes: [] });
    assert.ok(result.ok, JSON.stringify(result));
    assert.deepEqual(await readCauses(result.id), []);
  });

  test("🔴 한 접수 건에 검사 한 장과 수리 한 장이 함께 붙는다", async () => {
    const inspection = await create({ kind: "INSPECTION", summary: "", completionChecked: false });
    const repair = await create({ kind: "REPAIR" });
    assert.ok(inspection.ok && repair.ok);
    if (!inspection.ok || !repair.ok) return;

    const rows = await db
      .select({ id: serviceReports.id, kind: serviceReports.kind })
      .from(serviceReports)
      .where(
        and(
          eq(serviceReports.repairCaseId, repairCaseId),
          inArray(serviceReports.id, [inspection.id, repair.id])
        )
      );
    assert.deepEqual(rows.map((row) => row.kind).sort(), ["INSPECTION", "REPAIR"]);
  });

  test("없는 접수 건을 가리키면 칸 오류로 답한다 — FK 오류는 아무것도 설명하지 못한다", async () => {
    const result = await createServiceReport({
      repairCaseId: randomUUID(),
      values: filled(),
      actorUserId,
    });
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.code, "VALIDATION_ERROR");
    assert.ok(result.fieldErrors?.repairCaseId);
  });

  test("발행일이 비어 있으면 저장 전에 칸 오류로 거절한다", async () => {
    const result = await createServiceReport({
      repairCaseId,
      values: filled({ issuedOn: "" }),
      actorUserId,
    });
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.code, "VALIDATION_ERROR");
    assert.ok(result.fieldErrors?.issuedOn);
  });
});

/**
 * 🔴 저장이 문서 생산을 깨뜨리지 않는다는 **유일한 자동 증거**다. 저장·불러오기
 * 사전이 값을 하나라도 흘리면 여기서 400 이 나야 할 값이 만들어지고, 그때
 * 사람에게 보이는 것은 "왜 안 되는지 모르겠는 내려받기 실패"다.
 */
describe("저장한 것으로 문서를 만들 수 있다", () => {
  test("불러온 값이 xlsx 요청 검증을 통과한다 — 수리 보고서", async () => {
    const result = await create();
    assert.ok(result.ok, JSON.stringify(result));

    const loaded = await getServiceReportForEdit(result.id);
    assert.ok(loaded);
    const body = buildServiceReportRequestBody(
      serviceReportFormValues(loaded.values, SERVICE_REPORT_FINDINGS_INTRO)
    );

    const validated = validateServiceReportFields(body);
    assert.equal(validated.ok, true, JSON.stringify(validated));
  });

  test("검사 보고서도 통과한다 — 「정리」·「조치 완료」를 적어 두었더라도", async () => {
    // 종류를 바꿔도 화면은 적어 둔 글을 지우지 않는다. 저장은 그것을 담아 두고,
    // 걸러 내는 일은 buildServiceReportRequestBody 가 한다.
    const result = await create({
      kind: "INSPECTION",
      summary: "지우면 안 되는 정리",
      completionChecked: true,
    });
    assert.ok(result.ok, JSON.stringify(result));

    const loaded = await getServiceReportForEdit(result.id);
    assert.ok(loaded);
    assert.equal(loaded.values.summary, "지우면 안 되는 정리", "적어 둔 글이 사라지면 안 된다");

    const validated = validateServiceReportFields(
      buildServiceReportRequestBody(
        serviceReportFormValues(loaded.values, SERVICE_REPORT_FINDINGS_INTRO)
      )
    );
    assert.equal(validated.ok, true, JSON.stringify(validated));
  });

  test("findingsIntro 를 지운 장도 통과하고, 지운 채로 나간다", async () => {
    const result = await create({ findingsIntro: "" });
    assert.ok(result.ok, JSON.stringify(result));

    const loaded = await getServiceReportForEdit(result.id);
    assert.ok(loaded);
    const body = buildServiceReportRequestBody(
      serviceReportFormValues(loaded.values, SERVICE_REPORT_FINDINGS_INTRO)
    );
    // 🔴 `""` 로 나가야 서버가 정형 문구를 되살리지 않는다.
    assert.equal((body.body as Record<string, unknown>).findingsIntro, "");
    assert.equal(validateServiceReportFields(body).ok, true);
  });
});

describe("updateServiceReport", () => {
  test("저장할 때마다 version 이 1씩 오른다", async () => {
    const created = await create();
    assert.ok(created.ok);
    if (!created.ok) return;

    const updated = await updateServiceReport({
      id: created.id,
      expectedVersion: 1,
      values: filled({ findings: "한 번 고침" }),
      actorUserId,
    });
    assert.equal(updated.ok, true, JSON.stringify(updated));
    if (!updated.ok) return;
    assert.equal(updated.version, 2);

    const loaded = await getServiceReportForEdit(created.id);
    assert.equal(loaded?.values.findings, "한 번 고침");
    assert.equal(loaded?.version, 2);
  });

  test("🔴 낡은 version 으로 온 저장은 CONFLICT — 본문 한 줄도 바뀌지 않는다", async () => {
    const created = await create({ findings: "원래 확인내용", causes: ["AGING"] });
    assert.ok(created.ok);
    if (!created.ok) return;

    const stale = await updateServiceReport({
      id: created.id,
      expectedVersion: 99,
      values: filled({ findings: "덮어쓰려던 확인내용", causes: ["OTHER"] }),
      actorUserId,
    });
    assert.equal(stale.ok, false);
    if (stale.ok) return;
    assert.equal(stale.code, "CONFLICT");

    assert.equal((await readReport(created.id)).version, 1, "version 도 오르면 안 된다");
    // 여기가 요점이다 — CONFLICT 로 끝난 저장이 본문을 먼저 지워 버리면, 실패한
    // 저장이 자료를 지우고 간 셈이 된다.
    const loaded = await getServiceReportForEdit(created.id);
    assert.equal(loaded?.values.findings, "원래 확인내용");
    assert.deepEqual(await readCauses(created.id), ["AGING"]);
  });

  test("🔴 본문 줄은 통째로 갈아 끼워진다 — 폼에서 지운 줄이 남지 않는다", async () => {
    const created = await create({ findings: "가\n나\n다", remark: "옛 비고" });
    assert.ok(created.ok);
    if (!created.ok) return;

    const updated = await updateServiceReport({
      id: created.id,
      expectedVersion: 1,
      values: filled({ findings: "다 만 남김", remark: "" }),
      actorUserId,
    });
    assert.equal(updated.ok, true, JSON.stringify(updated));

    const lines = await readLines(created.id);
    assert.deepEqual(
      lines.filter((line) => line.section === "FINDINGS").map((line) => [line.lineNo, line.text]),
      [[1, "다 만 남김"]],
      "차례도 1부터 다시 매겨진다"
    );
    assert.deepEqual(
      lines.filter((line) => line.section === "REMARK"),
      [],
      "비운 구역은 한 줄도 남지 않는다"
    );
  });

  test("🔴 고른 원인도 갈아 끼워진다 — 체크를 푼 원인이 남지 않는다", async () => {
    const created = await create({ causes: ["PART_DEFECT", "AGING", "MISHANDLING"] });
    assert.ok(created.ok);
    if (!created.ok) return;

    const updated = await updateServiceReport({
      id: created.id,
      expectedVersion: 1,
      values: filled({ causes: ["NOT_REPRODUCED"] }),
      actorUserId,
    });
    assert.equal(updated.ok, true, JSON.stringify(updated));
    assert.deepEqual(await readCauses(created.id), ["NOT_REPRODUCED"]);
  });

  test("지워진 장은 고칠 수 없다 — 수정이 되살리기를 겸하면 안 된다", async () => {
    const created = await create();
    assert.ok(created.ok);
    if (!created.ok) return;
    await softDeleteServiceReport({
      serviceReportId: created.id,
      expectedVersion: 1,
      actorUserId,
      reason: null,
    });

    const result = await updateServiceReport({
      id: created.id,
      expectedVersion: 2,
      values: filled(),
      actorUserId,
    });
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.code, "NOT_FOUND");
  });

  test("없는 장은 NOT_FOUND", async () => {
    const result = await updateServiceReport({
      id: randomUUID(),
      expectedVersion: 1,
      values: filled(),
      actorUserId,
    });
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.code, "NOT_FOUND");
  });
});

describe("휴지통", () => {
  test("지운 장은 id 로도 안 나온다 — 주소만으로 계속 뽑을 수 있으면 휴지통이 뜻을 잃는다", async () => {
    const created = await create();
    assert.ok(created.ok);
    if (!created.ok) return;

    const deleted = await softDeleteServiceReport({
      serviceReportId: created.id,
      expectedVersion: 1,
      actorUserId,
      reason: "번호를 잘못 적었다",
    });
    assert.equal(deleted.ok, true, JSON.stringify(deleted));

    assert.equal(await getServiceReportForEdit(created.id), null);

    const row = await readReport(created.id);
    assert.equal(row.isDeleted, true);
    assert.equal(row.deletedBy, actorUserId, "누가 지웠는지 남아야 한다");
    assert.equal(row.deleteReason, "번호를 잘못 적었다", "왜 지웠는지 남아야 한다");
    assert.ok(row.deletedAt, "언제 지웠는지 남아야 한다");
  });

  test("되살리면 본문도 함께 돌아온다 — 소프트 삭제는 CASCADE 를 돌리지 않는다", async () => {
    const created = await create({ findings: "지웠다 되살릴 확인내용" });
    assert.ok(created.ok);
    if (!created.ok) return;

    await softDeleteServiceReport({
      serviceReportId: created.id,
      expectedVersion: 1,
      actorUserId,
      reason: null,
    });
    const restored = await restoreServiceReport({
      serviceReportId: created.id,
      expectedVersion: 2,
      actorUserId,
    });
    assert.equal(restored.ok, true, JSON.stringify(restored));

    const loaded = await getServiceReportForEdit(created.id);
    assert.equal(loaded?.values.findings, "지웠다 되살릴 확인내용");
  });

  test("낡은 version 으로는 지울 수도 되살릴 수도 없다", async () => {
    const created = await create();
    assert.ok(created.ok);
    if (!created.ok) return;

    const stale = await softDeleteServiceReport({
      serviceReportId: created.id,
      expectedVersion: 99,
      actorUserId,
      reason: null,
    });
    assert.equal(stale.ok, false);
    if (stale.ok) return;
    assert.equal(stale.code, "CONFLICT");
    assert.equal((await readReport(created.id)).isDeleted, false);
  });

  test("이미 지운 장을 또 지울 수 없고, 살아 있는 장을 되살릴 수 없다", async () => {
    const created = await create();
    assert.ok(created.ok);
    if (!created.ok) return;

    const live = await restoreServiceReport({
      serviceReportId: created.id,
      expectedVersion: 1,
      actorUserId,
    });
    assert.equal(live.ok, false);
    if (!live.ok) assert.equal(live.code, "NOT_FOUND");

    await softDeleteServiceReport({
      serviceReportId: created.id,
      expectedVersion: 1,
      actorUserId,
      reason: null,
    });
    const twice = await softDeleteServiceReport({
      serviceReportId: created.id,
      expectedVersion: 2,
      actorUserId,
      reason: null,
    });
    assert.equal(twice.ok, false);
    if (!twice.ok) assert.equal(twice.code, "NOT_FOUND");
  });
});

/**
 * 🔴 접수 건을 영구 삭제하면 보고서도 함께 사라져야 한다. 보고서만 남으면 지웠어야
 * 할 고객사 이름·발생 장소가 **그 자리에만 살아남는다** — 정리가 끝났다고 믿는데
 * 실제로는 안 끝난 상태가 가장 나쁘다(`schema/service-reports.ts` 의 «판단 1»).
 */
test("🔴 접수 건을 지우면 보고서도 줄도 함께 사라진다 — CASCADE", async () => {
  const doomed = await createRepairCase(baseCreateRepairCaseInput());
  assert.ok(doomed.ok, JSON.stringify(doomed));
  if (!doomed.ok) return;

  const report = await createServiceReport({
    repairCaseId: doomed.id,
    values: filled({ findings: "함께 사라질 확인내용" }),
    actorUserId,
  });
  assert.ok(report.ok, JSON.stringify(report));
  if (!report.ok) return;
  assert.equal((await readLines(report.id)).length > 0, true);

  await db.delete(repairCases).where(eq(repairCases.id, doomed.id));

  assert.equal(await readReport(report.id), undefined, "부모가 사라지면 보고서도 사라진다");
  assert.deepEqual(await readLines(report.id), [], "딸린 줄도 함께 사라진다");
  assert.deepEqual(await readCauses(report.id), [], "고른 원인도 함께 사라진다");
});

/**
 * 🔴 감사 로그는 3년 보관 대상이다. 거기에 본문 사본을 한 벌 더 만들면 지워야 할
 * 자료가 두 곳이 되고, 확인내용·조치에는 고객사의 장비 사정이 그대로 섞인다.
 * 남기는 것은 **누가 언제 우리 이름으로 어느 문서를 만들고 고쳤나**뿐이다.
 */
describe("🔴 감사에는 본문이 담기지 않는다", () => {
  async function readAudit(targetRecordId: string) {
    return db
      .select({ actionType: auditLogs.actionType, newValue: auditLogs.newValue })
      .from(auditLogs)
      .where(
        and(eq(auditLogs.targetEntity, "service_reports"), eq(auditLogs.targetRecordId, targetRecordId))
      )
      .orderBy(desc(auditLogs.createdAt));
  }

  test("만들기 기록에 담기는 값은 넷뿐이다 — 고객사명도 확인내용도 없다", async () => {
    const created = await create({ findings: "감사에 새면 안 되는 확인내용" });
    assert.ok(created.ok);
    if (!created.ok) return;

    const rows = await readAudit(created.id);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].actionType, "CREATE");
    assert.deepEqual(
      Object.keys(rows[0].newValue as Record<string, unknown>).sort(),
      ["issuedOn", "kind", "reportNumber", "repairCaseId"].sort()
    );

    const serialized = JSON.stringify(rows[0].newValue);
    assert.ok(!serialized.includes("감사에 새면 안 되는"), "본문이 감사에 새어 나갔다");
    assert.ok(!serialized.includes("ICD Co.,Ltd"), "고객사명이 감사에 새어 나갔다");
  });

  test("고치기와 지우기도 남는다 — 무엇을 적었는지가 아니라 무엇을 했는지가 남는다", async () => {
    const created = await create();
    assert.ok(created.ok);
    if (!created.ok) return;

    await updateServiceReport({
      id: created.id,
      expectedVersion: 1,
      values: filled(),
      actorUserId,
    });
    await softDeleteServiceReport({
      serviceReportId: created.id,
      expectedVersion: 2,
      actorUserId,
      reason: null,
    });

    const actions = (await readAudit(created.id)).map((row) => row.actionType).sort();
    assert.deepEqual(actions, ["CREATE", "SOFT_DELETE", "UPDATE"]);
  });
});
