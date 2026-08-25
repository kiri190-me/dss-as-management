import "../../../../scripts/load-env";

import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { and, eq, inArray, like } from "drizzle-orm";

import { db, pgClient } from "../connection";
import {
  customers,
  domesticOrderDueDates,
  domesticOrders,
  products,
  repairCaseIntakeSequences,
  repairCases,
  users,
  weeklyReportDeliveries,
} from "../schema";
import { createRepairCase } from "../mutations/repair-cases";
import { createWeeklyReportDelivery } from "../mutations/weekly-report-deliveries";
import { listWeeklyReportDeliveries } from "./weekly-report-deliveries";
import type { ValidatedCreateRepairCaseInput } from "@/lib/validation/repair-case-input";

/**
 * ============================================================================
 * 주간보고 납입 예정 건 — 여덟 칸이 실제로 따라오고, 줄이 복제되지 않는가
 * ============================================================================
 * 이 조회의 값은 여섯 표를 가로지른다(납입 예정 줄 → 수리 건 → 고객사 · 제품 ·
 * 워크플로 종류, 그리고 따로 읽는 내자 정리 → 납기요청일). 조인 하나가 어긋나도
 * 타입은 통과하므로, 그것을 잡는 자리는 여기뿐이다.
 *
 * 지키는 것은 여섯이다.
 *
 *  1. **앞 다섯 칸의 재료가 전부 따라온다** — 인수번호·형식·S/N·L/N·고객사.
 *     저장돼 있지 않은 값이라 조인이 끊기면 화면의 줄이 통째로 빈다.
 *  2. **`납입 예정`은 수리 건의 사내 목표 출하일**이고, 없으면 빈칸이다.
 *  3. **`입고 요청일`은 납기요청일 중 가장 이른 하루**다 — 한 발주 줄 안에서도,
 *     **여러 발주 줄에 걸쳐서도** 통틀어 가장 이른 것이고, 하나도 없으면 빈칸,
 *     **지운 발주 줄의 날짜는 세지 않는다.**
 *  4. **조인 복제로 줄이 늘지 않는다** — 날짜가 셋인 건도 목록에는 한 줄이다.
 *     이 표에서 가장 조용히 깨지는 곳이라, 건수를 직접 못 박는다.
 *  5. **차례는 display_order, 같으면 적은 차례** — NULL 은 뒤로.
 *  6. **RFG/MB 는 수리 건의 종류가 정한다** — 저장하지 않는다.
 *
 * "**다른 이유로** 빠진다"를 보이려는 시험에는 반드시 **대조**를 함께 둔다 —
 * 지운 발주 줄 시험에 살아 있는 줄의 날짜를 나란히 두는 것이 그 때문이다.
 * 대조가 없으면 조회가 날짜를 통째로 못 읽어도 초록색인 시험이 된다.
 *
 * ── 격리 규약 ────────────────────────────────────────────────────────────
 * 이 디렉터리의 다른 통합 테스트와 같다 — 이 스위트만 쓰는 접수 월 "9605",
 * 고객사 접두사 "AS-TEST-WEEKLY-DELIVERY-Q-", 제품 모델 접두사
 * "WEEKLY-DELIVERY-QUERY-TEST-". 인수번호의 연월은 receivedAt 에서 나오므로
 * TEST_YEAR_MONTH 와 TEST_RECEIVED_AT 은 같은 달을 가리킨다.
 *
 * 주도 이 스위트만 쓴다(2096-05-07 · 05-14 · 05-21, 전부 월요일). 조회가
 * `week_start_date` 하나로 좁히므로 다른 스위트의 줄이 섞이지 않는다.
 *
 * after() 는 이 스위트가 만든 행만 FK 순서대로 지운다 — 납입 예정 줄 · 내자
 * 줄을 먼저 지운다(납기요청일은 내자 줄에 CASCADE 로 딸려 사라진다).
 * ============================================================================
 */

const TEST_CUSTOMER_NAME_PREFIX = "AS-TEST-WEEKLY-DELIVERY-Q-";
const TEST_MODEL_PREFIX = "WEEKLY-DELIVERY-QUERY-TEST-";
const TEST_YEAR_MONTH = "9605";
const TEST_RECEIVED_AT = "2096-05-07";
/** 전부 월요일이다 — 이 스위트만 쓰는 주. */
const WEEK_MAIN = "2096-05-07";
const WEEK_OTHER = "2096-05-14";
const WEEK_EMPTY = "2096-05-21";

/** 사내 목표 출하일이 적힌 건. `납입 예정` 칸에 그대로 나와야 한다. */
const TARGET_SHIPMENT_DATE = "2096-05-20";

let actorUserId: string;
let engineerId: string;
let customerId: string;
let customerName: string;

type CaseFacts = {
  id: string;
  intakeNumber: string;
  modelName: string;
  lotNumber: string;
  serialNumber: string;
};

/** 날짜가 셋 달린 건 — 조인 복제가 일어나면 여기서 줄이 셋으로 늘어난다. */
let caseThreeDates: CaseFacts;
/** 내자 줄이 둘이고 각각 날짜가 있는 건 — 통틀어 가장 이른 것을 골라야 한다. */
let caseTwoOrders: CaseFacts;
/** 내자 줄이 아예 없는 건 — 빈칸이다. */
let caseNoOrder: CaseFacts;
/** 지운 줄에 더 이른 날짜가 있는 건 — 그 날짜는 세지 않는다. */
let caseDeletedOrder: CaseFacts;
/** 지운 줄에만 날짜가 있는 건 — 빈칸이다. */
let caseOnlyDeletedOrder: CaseFacts;

const repairCaseIds: string[] = [];

function baseCreateRepairCaseInput(
  suffix: string,
  internalTargetShipmentDate: string | null
): ValidatedCreateRepairCaseInput {
  return {
    workflowType: "PAID_MATCHER",
    billingType: "PAID",
    customerId,
    endUserId: null,
    assignedEngineerId: engineerId,
    receivedAt: TEST_RECEIVED_AT,
    customerRequestedDueDate: null,
    internalTargetShipmentDate,
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

async function makeCase(internalTargetShipmentDate: string | null): Promise<CaseFacts> {
  const suffix = randomUUID().slice(0, 8);
  const input = baseCreateRepairCaseInput(suffix, internalTargetShipmentDate);
  const created = await createRepairCase(input);
  assert.equal(created.ok, true, `setup repair case failed: ${JSON.stringify(created)}`);
  if (!created.ok) throw new Error("unreachable");
  repairCaseIds.push(created.id);

  const [row] = await db
    .select({ intakeNumber: repairCases.intakeNumber })
    .from(repairCases)
    .where(eq(repairCases.id, created.id));

  return {
    id: created.id,
    intakeNumber: row.intakeNumber,
    modelName: input.modelName,
    lotNumber: input.lotNumber!,
    serialNumber: input.serialNumber!,
  };
}

/**
 * 내자 줄 하나와 거기 딸린 납기요청일들. 화면을 거치지 않고 바로 넣는다 —
 * 여기서 시험하는 것은 내자 정리의 저장 규칙이 아니라 **조회가 그 값을 어떻게
 * 걷어 오는가**다.
 */
async function addOrder(
  repairCaseId: string,
  dueDates: string[],
  options: { isDeleted?: boolean } = {}
): Promise<void> {
  const [order] = await db
    .insert(domesticOrders)
    .values({ repairCaseId, customerId, isDeleted: options.isDeleted ?? false })
    .returning({ id: domesticOrders.id });

  if (dueDates.length > 0) {
    await db.insert(domesticOrderDueDates).values(
      dueDates.map((dueDate, index) => ({
        domesticOrderId: order.id,
        dueDate,
        displayOrder: index + 1,
      }))
    );
  }
}

before(async () => {
  const [engineer] = await db
    .select({ id: users.id })
    .from(users)
    .where(
      and(
        eq(users.role, "AS_ENGINEER"),
        eq(users.approvalStatus, "APPROVED"),
        eq(users.isDeleted, false)
      )
    )
    .limit(1);
  assert.ok(engineer, "expected at least one approved AS_ENGINEER in the test DB");
  engineerId = engineer.id;
  actorUserId = engineer.id;

  customerName = `${TEST_CUSTOMER_NAME_PREFIX}${randomUUID().slice(0, 8)}`;
  const [customer] = await db
    .insert(customers)
    .values({ name: customerName })
    .returning({ id: customers.id });
  customerId = customer.id;

  caseThreeDates = await makeCase(TARGET_SHIPMENT_DATE);
  caseTwoOrders = await makeCase(null);
  caseNoOrder = await makeCase(null);
  caseDeletedOrder = await makeCase(null);
  caseOnlyDeletedOrder = await makeCase(null);

  // 한 발주 줄에 날짜 셋. 가장 이른 것은 2096-06-01 이고, 적어 넣은 차례와도
  // 화면 차례(display_order)와도 다르다 — min 이 아니라 '첫 줄'을 고르는
  // 구현이면 여기서 드러난다.
  await addOrder(caseThreeDates.id, ["2096-07-01", "2096-06-01", "2096-08-01"]);

  // 내자 줄 둘. 가장 이른 것(2096-07-15)은 **두 번째 줄**에 있다.
  await addOrder(caseTwoOrders.id, ["2096-09-10"]);
  await addOrder(caseTwoOrders.id, ["2096-12-01", "2096-07-15"]);

  // caseNoOrder 에는 내자 줄을 만들지 않는다.

  // 지운 줄에 훨씬 이른 날짜가 있다. 그것을 세면 2090-01-01 이 나온다.
  await addOrder(caseDeletedOrder.id, ["2090-01-01"], { isDeleted: true });
  await addOrder(caseDeletedOrder.id, ["2096-11-11"]);

  // 지운 줄에만 날짜가 있다.
  await addOrder(caseOnlyDeletedOrder.id, ["2090-02-02"], { isDeleted: true });

  // ── 주에 줄을 올린다 ──────────────────────────────────────────────────
  // WEEK_MAIN 에 셋: 차례를 2 · 1 · (없음) 로 두어 정렬을 함께 본다.
  await createWeeklyReportDelivery({
    fields: {
      weekStartDate: WEEK_MAIN,
      repairCaseId: caseThreeDates.id,
      note: "고객사 요청으로 연기",
      displayOrder: 2,
    },
    actorUserId,
  });
  await createWeeklyReportDelivery({
    fields: {
      weekStartDate: WEEK_MAIN,
      repairCaseId: caseTwoOrders.id,
      note: null,
      displayOrder: 1,
    },
    actorUserId,
  });
  await createWeeklyReportDelivery({
    fields: {
      weekStartDate: WEEK_MAIN,
      repairCaseId: caseNoOrder.id,
      note: null,
      displayOrder: null,
    },
    actorUserId,
  });

  // WEEK_OTHER 에 둘 — 지운 내자 줄을 보는 시험용이고, 동시에 "그 주의 줄만
  // 나온다"의 대조가 된다.
  await createWeeklyReportDelivery({
    fields: {
      weekStartDate: WEEK_OTHER,
      repairCaseId: caseDeletedOrder.id,
      note: null,
      displayOrder: 1,
    },
    actorUserId,
  });
  await createWeeklyReportDelivery({
    fields: {
      weekStartDate: WEEK_OTHER,
      repairCaseId: caseOnlyDeletedOrder.id,
      note: null,
      displayOrder: 2,
    },
    actorUserId,
  });
});

after(async () => {
  if (repairCaseIds.length > 0) {
    await db
      .delete(weeklyReportDeliveries)
      .where(inArray(weeklyReportDeliveries.repairCaseId, repairCaseIds));
    // 납기요청일은 내자 줄에 CASCADE 로 딸려 사라진다.
    await db.delete(domesticOrders).where(inArray(domesticOrders.repairCaseId, repairCaseIds));
  }
  await db.delete(repairCases).where(like(repairCases.intakeNumber, `D${TEST_YEAR_MONTH}%`));
  await db.delete(products).where(like(products.modelName, `${TEST_MODEL_PREFIX}%`));
  await db
    .delete(repairCaseIntakeSequences)
    .where(eq(repairCaseIntakeSequences.yearMonth, TEST_YEAR_MONTH));
  await db.delete(customers).where(like(customers.name, `${TEST_CUSTOMER_NAME_PREFIX}%`));
  await pgClient.end({ timeout: 5 });
});

describe("listWeeklyReportDeliveries", () => {
  test("그 주의 줄만 나온다", async () => {
    const rows = await listWeeklyReportDeliveries(WEEK_MAIN);
    assert.equal(rows.length, 3);
    for (const row of rows) assert.equal(row.weekStartDate, WEEK_MAIN);
  });

  test("줄이 없는 주는 빈 목록이다", async () => {
    assert.deepEqual(await listWeeklyReportDeliveries(WEEK_EMPTY), []);
  });

  test("조인 복제로 줄이 늘지 않는다 — 날짜가 셋인 건도 한 줄이다", async () => {
    const rows = await listWeeklyReportDeliveries(WEEK_MAIN);
    const mine = rows.filter((row) => row.repairCaseId === caseThreeDates.id);
    assert.equal(mine.length, 1, "날짜 수만큼 줄이 복제되면 안 된다");
    // 내자 줄이 둘이고 날짜가 셋인 건도 마찬가지다.
    assert.equal(rows.filter((row) => row.repairCaseId === caseTwoOrders.id).length, 1);
    // 그리고 그 결과 이 주의 총 줄 수는 올린 만큼(셋)이다.
    assert.equal(rows.length, 3);
  });

  test("앞 다섯 칸의 재료가 전부 따라온다 — 저장돼 있지 않은 값이다", async () => {
    const rows = await listWeeklyReportDeliveries(WEEK_MAIN);
    const row = rows.find((item) => item.repairCaseId === caseThreeDates.id);
    assert.ok(row);
    assert.equal(row.intakeNumber, caseThreeDates.intakeNumber);
    assert.equal(row.modelName, caseThreeDates.modelName);
    assert.equal(row.serialNumber, caseThreeDates.serialNumber);
    assert.equal(row.lotNumber, caseThreeDates.lotNumber);
    assert.equal(row.customerName, customerName);
  });

  test("비고는 사람이 적은 그대로 오고, 안 적은 줄은 빈칸이다", async () => {
    const rows = await listWeeklyReportDeliveries(WEEK_MAIN);
    const written = rows.find((item) => item.repairCaseId === caseThreeDates.id);
    const empty = rows.find((item) => item.repairCaseId === caseTwoOrders.id);
    assert.equal(written?.note, "고객사 요청으로 연기");
    assert.equal(empty?.note, null);
  });

  test("RFG/MB 는 수리 건의 워크플로 종류가 정한다 — 저장하지 않는다", async () => {
    const rows = await listWeeklyReportDeliveries(WEEK_MAIN);
    for (const row of rows) {
      assert.equal(row.workflowType, "PAID_MATCHER");
      assert.equal(row.kind, "MB", "Matcher 는 MB 표다");
    }
  });

  test("version 과 만든 시각이 함께 나온다 — 폼이 그대로 다시 실어 보낸다", async () => {
    const rows = await listWeeklyReportDeliveries(WEEK_MAIN);
    assert.equal(rows[0].version, 1);
    assert.ok(rows[0].createdAt instanceof Date);
  });

  test("차례대로 나오고, 차례를 정하지 않은 줄은 뒤로 간다", async () => {
    const rows = await listWeeklyReportDeliveries(WEEK_MAIN);
    assert.deepEqual(
      rows.map((row) => [row.displayOrder, row.repairCaseId]),
      [
        [1, caseTwoOrders.id],
        [2, caseThreeDates.id],
        [null, caseNoOrder.id],
      ]
    );
  });

  // ── 납입 예정 ──────────────────────────────────────────────────────────

  test("`납입 예정`은 수리 건의 사내 목표 출하일이다", async () => {
    const rows = await listWeeklyReportDeliveries(WEEK_MAIN);
    const row = rows.find((item) => item.repairCaseId === caseThreeDates.id);
    assert.equal(row?.internalTargetShipmentDate, TARGET_SHIPMENT_DATE);
  });

  test("사내 목표 출하일이 없으면 빈칸이다", async () => {
    const rows = await listWeeklyReportDeliveries(WEEK_MAIN);
    const row = rows.find((item) => item.repairCaseId === caseNoOrder.id);
    assert.equal(row?.internalTargetShipmentDate, null);
  });

  // ── 입고 요청일 ────────────────────────────────────────────────────────

  test("납기요청일이 여럿이면 가장 이른 하루가 나온다", async () => {
    const rows = await listWeeklyReportDeliveries(WEEK_MAIN);
    const row = rows.find((item) => item.repairCaseId === caseThreeDates.id);
    assert.equal(row?.earliestRequestedDueDate, "2096-06-01");
  });

  test("내자 줄이 여럿이어도 **전부를 통틀어** 가장 이른 하루다", async () => {
    const rows = await listWeeklyReportDeliveries(WEEK_MAIN);
    const row = rows.find((item) => item.repairCaseId === caseTwoOrders.id);
    // 둘째 줄에 있는 2096-07-15 다. 첫 줄만 보면 2096-09-10 이 나온다.
    assert.equal(row?.earliestRequestedDueDate, "2096-07-15");
  });

  test("납기요청일이 하나도 없으면 빈칸이다", async () => {
    const rows = await listWeeklyReportDeliveries(WEEK_MAIN);
    const row = rows.find((item) => item.repairCaseId === caseNoOrder.id);
    assert.equal(row?.earliestRequestedDueDate, null);
  });

  test("지운 내자 줄의 날짜는 세지 않는다 — 살아 있는 줄의 날짜가 나온다", async () => {
    const rows = await listWeeklyReportDeliveries(WEEK_OTHER);
    const row = rows.find((item) => item.repairCaseId === caseDeletedOrder.id);
    // 지운 줄에 2090-01-01 이 있지만 살아 있는 줄의 2096-11-11 이 나와야 한다.
    assert.equal(row?.earliestRequestedDueDate, "2096-11-11");
  });

  test("지운 줄에만 날짜가 있으면 빈칸이다", async () => {
    const rows = await listWeeklyReportDeliveries(WEEK_OTHER);
    const row = rows.find((item) => item.repairCaseId === caseOnlyDeletedOrder.id);
    assert.equal(row?.earliestRequestedDueDate, null);
  });

  test("휴지통에 든 수리 건의 줄도 그대로 남는다", async () => {
    // 지난주 표에 올려 둔 건이 이번 주에 휴지통으로 갔다고 해서, 지난주에 무슨
    // 계획이었는지가 달라지지는 않는다(조회 파일 헤더).
    await db
      .update(repairCases)
      .set({ isDeleted: true, deletedAt: new Date() })
      .where(eq(repairCases.id, caseOnlyDeletedOrder.id));
    try {
      const rows = await listWeeklyReportDeliveries(WEEK_OTHER);
      assert.ok(rows.some((row) => row.repairCaseId === caseOnlyDeletedOrder.id));
    } finally {
      await db
        .update(repairCases)
        .set({ isDeleted: false, deletedAt: null })
        .where(eq(repairCases.id, caseOnlyDeletedOrder.id));
    }
  });
});
