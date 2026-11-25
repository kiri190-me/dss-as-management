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
} from "../schema";
import { createRepairCase } from "../mutations/repair-cases";
import { createDomesticOrder } from "../mutations/domestic-orders";
import { listDomesticOrdersWithDueDateNear } from "./domestic-order-due-date-near-notifications";
import { listRepairCasesWithDueDateNear } from "./repair-case-due-date-notifications";
import type { DomesticOrderFields } from "@/lib/validation/domestic-order-input";
import type { ValidatedCreateRepairCaseInput } from "@/lib/validation/repair-case-input";

/**
 * ============================================================================
 * 🔴 「기타건 납기 임박」이 진짜 DB 위에서 **무엇을 세우고 무엇을 빼는가** (2026-11-25)
 * ============================================================================
 * 창 판정 자체는 순수 함수 시험이 전부 쥐고 있고(domain/notifications.test.ts 와
 * domain/domestic-order-due-date-near-notification.test.ts), **이 파일이 보는 것은 DB 에서
 * 재료가 정말로 그 판정까지 실려 오는가**다. 그리고 단위 시험으로는 잴 수 없는 넷이
 * 여기 있다:
 *
 *  ① 🔴 **`repair_case_id IS NULL`** — 수리 건이 붙은 줄은 이미 「납기 임박」이 그
 *     날짜를 **빌려 와서** 재고 있다. 안 걸면 같은 날짜가 종에 두 줄로 선다. 그래서
 *     「여기서 안 뜬다」와 「저기서는 뜬다」를 **같은 건에 대해 함께** 본다 — 한쪽만
 *     보면 「조용해졌다」와 「사라졌다」를 가를 수 없다.
 *  ② 🔴 **회차 번호가 거르기 전에 매겨진다** — 1차를 [완료 처리]한 줄에서 2차가
 *     「1차」로 불리면, 종에 뜬 회차와 화면의 회차가 어긋난다. SQL 로 끝난 회차를
 *     먼저 빼면 반드시 그렇게 된다.
 *  ③ 끝남 두 칸(`completed_at` · `delivered_date`)을 **둘 다** 본다.
 *  ④ 휴지통에 든 줄은 안 뜬다.
 *
 * ── 🔴 왜 **2094년**(먼 미래)인가 ────────────────────────────────────────
 * 이 조회는 「오늘」을 인자로 받는다(`now`). 그래서 날짜를 실제 오늘에 맞출 필요가
 * 없고, 오히려 맞추면 **시험이 도는 날에 따라 결과가 달라진다**. 창을 박아 넣고
 * 날짜를 그 둘레에 세운다 — 2094-08-10 을 「오늘」로 잡으면 창은 08-10 … 08-17 이다.
 * 🔵 「납기 지연」 통합 시험이 **먼 과거**(9109)를 쓴 것은 그쪽이 재는 길 셋 중 둘이
 *    「오늘」을 못 받아서였다. 여기는 길이 하나이고 그 하나가 「오늘」을 받는다.
 *
 * ── 격리 규약 ────────────────────────────────────────────────────────────
 * 이 스위트만 쓰는 접수 월 "9408"(2026-11-25 실측 — 쓰는 시험이 없다), 고객사 접두사
 * "AS-TEST-MISC-NEAR-", 제품 모델 접두사 "MISC-NEAR-TEST-".
 * 🔴 **접수 건은 하나만 만든다** — 필요한 것이 ① 의 대조 하나뿐이고, 한 달에 인수번호가
 * 99개까지라 넉넉히 쓰면 한참 뒤 남의 시험이 까닭 없이 깨진다.
 *
 * after() 는 FK 차례대로 지운다 — domestic_orders 가 먼저다(repair_cases 와 customers 를
 * 가리킨다). 납기요청일 행은 그 줄을 지우면 CASCADE 로 함께 사라진다.
 * ============================================================================
 */

const TEST_CUSTOMER_NAME_PREFIX = "AS-TEST-MISC-NEAR-";
const TEST_MODEL_PREFIX = "MISC-NEAR-TEST-";
const TEST_YEAR_MONTH = "9408";
const TEST_RECEIVED_AT = "2094-08-05";

/** 「오늘」 — 한국 시각 2094-08-10 14:00. 창은 08-10 … 08-17 이다. */
const NOW = new Date("2094-08-10T05:00:00.000Z");
/** 창의 **첫날**(오늘). 경계는 안쪽이다. */
const TODAY_DUE_DATE = "2094-08-10";
const IN_WINDOW_DUE_DATE = "2094-08-12";
const LATER_IN_WINDOW_DUE_DATE = "2094-08-15";
/** 창의 **마지막 날**(오늘 + 7일). 경계는 안쪽이다. */
const LAST_DAY_DUE_DATE = "2094-08-17";
/** 어제 — 이미 지난 납기라 창 밖이다(기타건에는 「지연」 알림이 없다). */
const PAST_DUE_DATE = "2094-08-09";
/** 오늘 + 8일 — 창 밖이다. */
const FAR_DUE_DATE = "2094-08-18";

type DueDateInput = DomesticOrderFields["dueDates"][number];

let actorUserId: string;
let engineerId: string;
let customerId: string;
const createdOrderIds: string[] = [];

/** 전부 비어 있는 한 줄. 이 표에는 필수 칸이 하나도 없다. */
function emptyFields(): DomesticOrderFields {
  return {
    repairCaseId: null,
    quoteId: null,
    intakeNumberText: null,
    customerId: null,
    modelNameText: null,
    lotNumberText: null,
    serialNumberText: null,
    faultDescriptionText: null,
    displayOrder: null,
    purchaseOrderNumber: null,
    projectName: null,
    orderIssuedDate: null,
    dueDates: [],
    quoteIssuedDate: null,
    quoteNumber: null,
    progressNote: null,
    deliveredDate: null,
    deliveredBy: null,
    taxInvoiceDate: null,
    amountExcludingVat: null,
    paymentCompleted: false,
    japanRemittanceNote: null,
    historyNote: null,
    etcNote: null,
  };
}

function dueDateRow(overrides: Partial<DueDateInput> & { dueDate: string }): DueDateInput {
  return { note: null, deliveredDate: null, deliveredBy: null, ...overrides };
}

/** 기타건 한 줄 — 수리 건을 붙이지 않는다. 그것이 「기타건」의 뜻이다. */
async function createMiscCase(
  modelName: string,
  dueDates: DueDateInput[],
  extra: Partial<DomesticOrderFields> = {}
): Promise<string> {
  const result = await createDomesticOrder({
    fields: { ...emptyFields(), modelNameText: modelName, dueDates, ...extra },
    actorUserId,
  });
  assert.equal(result.ok, true, `setup misc case failed: ${JSON.stringify(result)}`);
  if (!result.ok) throw new Error("unreachable");
  createdOrderIds.push(result.id);
  return result.id;
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

/** 창 안 날짜 하나짜리 기타건 — 뜨는 쪽의 기본 표본. */
let singleRowId: string;
/** 회차 둘이 **모두** 창 안인 줄 — 둘 다 뜨고 회차 이름표가 붙는다. */
let twoRowsId: string;
/** 1차를 [완료 처리]한 줄 — 2차만 뜨고, 그 번호가 **2** 여야 한다. */
let firstRowCompletedId: string;
/** 납품일이 찍힌 회차뿐인 줄 — 안 뜬다. */
let deliveredId: string;
/** 🔴 **수리 건이 붙은** 내자 줄 — 여기서는 안 뜨고 「납기 임박」에서 뜬다. */
let repairCaseLinkedOrderId: string;
let linkedRepairCaseId: string;
/** 휴지통에 든 기타건 — 안 뜬다. */
let deletedId: string;
/** 창의 두 경계(오늘 · 오늘+7일). 둘 다 안쪽이다. */
let todayBoundaryId: string;
let lastDayBoundaryId: string;
/** 창 밖 둘 — 이미 지난 납기와 너무 먼 납기. */
let pastId: string;
let farId: string;

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
  // created_by/updated_by 는 users 를 RESTRICT 로 가리킨다 — 실재하는 계정이어야 한다.
  actorUserId = engineer.id;

  const [customer] = await db
    .insert(customers)
    .values({ name: `${TEST_CUSTOMER_NAME_PREFIX}${randomUUID().slice(0, 8)}` })
    .returning({ id: customers.id });
  customerId = customer.id;

  singleRowId = await createMiscCase(`${TEST_MODEL_PREFIX}SINGLE`, [
    dueDateRow({ dueDate: IN_WINDOW_DUE_DATE }),
  ]);

  twoRowsId = await createMiscCase(`${TEST_MODEL_PREFIX}TWO`, [
    dueDateRow({ dueDate: IN_WINDOW_DUE_DATE, note: "1차분" }),
    dueDateRow({ dueDate: LAST_DAY_DUE_DATE, note: "2차분" }),
  ]);

  firstRowCompletedId = await createMiscCase(`${TEST_MODEL_PREFIX}COMPLETED`, [
    dueDateRow({ dueDate: IN_WINDOW_DUE_DATE, note: "1차분" }),
    dueDateRow({ dueDate: LATER_IN_WINDOW_DUE_DATE, note: "2차분" }),
  ]);
  // 🔴 완료 표시는 **폼이 보내는 값이 아니다**(그 표의 completed_at 주석 — 보내게 두면
  //    줄 수정 폼 하나로 승인 없이 완료를 찍을 수 있다). 그래서 이웃 통합 시험들이
  //    출하일에 쓰는 그 방법으로 칸을 직접 찍는다. 두 칸은 CHECK 으로 **언제나 함께**다.
  await db
    .update(domesticOrderDueDates)
    .set({ completedAt: new Date(), completedBy: actorUserId })
    .where(
      and(
        eq(domesticOrderDueDates.domesticOrderId, firstRowCompletedId),
        eq(domesticOrderDueDates.displayOrder, 1)
      )
    );

  deliveredId = await createMiscCase(`${TEST_MODEL_PREFIX}DELIVERED`, [
    dueDateRow({ dueDate: IN_WINDOW_DUE_DATE, deliveredDate: IN_WINDOW_DUE_DATE, deliveredBy: null }),
  ]);

  // 🔴 ① 의 대조 — 수리 건이 붙은 내자 줄. 접수 건은 이 하나뿐이다(파일 머리말).
  const created = await createRepairCase(baseCreateRepairCaseInput());
  assert.equal(created.ok, true, `setup repair case failed: ${JSON.stringify(created)}`);
  if (!created.ok) throw new Error("unreachable");
  linkedRepairCaseId = created.id;
  repairCaseLinkedOrderId = await createMiscCase(`${TEST_MODEL_PREFIX}LINKED`, [
    dueDateRow({ dueDate: IN_WINDOW_DUE_DATE }),
  ], { repairCaseId: linkedRepairCaseId });

  deletedId = await createMiscCase(`${TEST_MODEL_PREFIX}DELETED`, [
    dueDateRow({ dueDate: IN_WINDOW_DUE_DATE }),
  ]);
  // 화면에서 지우는 길은 소프트 삭제다 — 칸을 직접 찍어 그 상태를 만든다.
  await db.update(domesticOrders).set({ isDeleted: true }).where(eq(domesticOrders.id, deletedId));

  todayBoundaryId = await createMiscCase(`${TEST_MODEL_PREFIX}TODAY`, [
    dueDateRow({ dueDate: TODAY_DUE_DATE }),
  ]);
  lastDayBoundaryId = await createMiscCase(`${TEST_MODEL_PREFIX}LASTDAY`, [
    dueDateRow({ dueDate: LAST_DAY_DUE_DATE }),
  ]);
  pastId = await createMiscCase(`${TEST_MODEL_PREFIX}PAST`, [
    dueDateRow({ dueDate: PAST_DUE_DATE }),
  ]);
  farId = await createMiscCase(`${TEST_MODEL_PREFIX}FAR`, [dueDateRow({ dueDate: FAR_DUE_DATE })]);
});

after(async () => {
  if (createdOrderIds.length > 0) {
    await db.delete(domesticOrders).where(inArray(domesticOrders.id, createdOrderIds));
  }
  await db.delete(repairCases).where(like(repairCases.intakeNumber, `D${TEST_YEAR_MONTH}%`));
  await db.delete(products).where(like(products.modelName, `${TEST_MODEL_PREFIX}%`));
  await db
    .delete(repairCaseIntakeSequences)
    .where(eq(repairCaseIntakeSequences.yearMonth, TEST_YEAR_MONTH));
  await db.delete(customers).where(like(customers.name, `${TEST_CUSTOMER_NAME_PREFIX}%`));
  await pgClient.end({ timeout: 5 });
});

/** 이 스위트가 만든 줄만 본다 — 개발·시험 DB 의 다른 기타건이 섞이지 않게. */
async function mineOnly() {
  const rows = await listDomesticOrdersWithDueDateNear({ now: NOW });
  const mine = new Set(createdOrderIds);
  return rows.filter((row) => mine.has(row.domesticOrderId));
}

test("🔴 밑자락 점검 — 열 줄이 저마다 다른 모양으로 섰다", () => {
  // 이 못이 없으면 setup 이 조용히 틀어졌을 때(예: 납기요청일 행이 안 들어갔을 때)
  // 아래 「안 뜬다」 단언들이 전부 공짜로 통과한다.
  const ids = [
    singleRowId,
    twoRowsId,
    firstRowCompletedId,
    deliveredId,
    repairCaseLinkedOrderId,
    deletedId,
    todayBoundaryId,
    lastDayBoundaryId,
    pastId,
    farId,
  ];
  assert.equal(new Set(ids).size, 10, "같은 줄을 두 번 쓰고 있다");
  for (const id of ids) assert.ok(id, "setup 이 줄을 만들지 못했다");
  assert.ok(linkedRepairCaseId, "setup 이 접수 건을 만들지 못했다");
  // 창의 경계가 실제로 안팎을 가르는 값인가 — 날짜를 잘못 적으면 아래가 전부 뜻을 잃는다.
  assert.ok(PAST_DUE_DATE < TODAY_DUE_DATE && TODAY_DUE_DATE < IN_WINDOW_DUE_DATE);
  assert.ok(LATER_IN_WINDOW_DUE_DATE < LAST_DAY_DUE_DATE && LAST_DAY_DUE_DATE < FAR_DUE_DATE);
});

describe("뜨는 줄", () => {
  test("🔴 회차가 하나뿐인 기타건 — 뜨고, 회차 이름표가 **없다**", async () => {
    const rows = await mineOnly();
    const mine = rows.filter((row) => row.domesticOrderId === singleRowId);
    assert.equal(mine.length, 1, "회차 하나짜리 줄이 한 줄로 안 뜬다");
    assert.equal(mine[0].dueDate, IN_WINDOW_DUE_DATE);
    assert.equal(mine[0].dueDateRowOrder, 1);
    assert.equal(mine[0].dueDateRowLabel, null, "붙일 회차가 없는데 이름표가 붙었다");
    assert.equal(mine[0].modelName, `${TEST_MODEL_PREFIX}SINGLE`);
  });

  test("🔴 회차가 둘이면 **회차마다 한 줄**씩 뜨고, 줄마다 어느 회차인지 적힌다", async () => {
    const rows = await mineOnly();
    const mine = rows
      .filter((row) => row.domesticOrderId === twoRowsId)
      .sort((left, right) => left.dueDateRowOrder - right.dueDateRowOrder);
    assert.equal(mine.length, 2, "회차 둘이 한 줄로 접혔다 — 2차를 영영 모른다");

    assert.equal(mine[0].dueDateRowOrder, 1);
    assert.equal(mine[0].dueDate, IN_WINDOW_DUE_DATE);
    assert.ok(mine[0].dueDateRowLabel?.includes("1차"), String(mine[0].dueDateRowLabel));
    assert.ok(mine[0].dueDateRowLabel?.includes("1차분"), "회차를 가르는 메모가 빠졌다");

    assert.equal(mine[1].dueDateRowOrder, 2);
    assert.equal(mine[1].dueDate, LAST_DAY_DUE_DATE);
    assert.ok(mine[1].dueDateRowLabel?.includes("2차"), String(mine[1].dueDateRowLabel));
  });

  test("🔴 창의 두 경계(오늘 · 오늘+7일)가 **안쪽**이다", async () => {
    const ids = new Set((await mineOnly()).map((row) => row.domesticOrderId));
    assert.ok(ids.has(todayBoundaryId), "오늘이 납기인 줄이 안 뜬다");
    assert.ok(ids.has(lastDayBoundaryId), "창 마지막 날이 납기인 줄이 안 뜬다");
  });

  test("가장 급한 회차가 맨 위다 — 날짜 오름차순", async () => {
    const rows = await mineOnly();
    assert.ok(rows.length >= 2, "표본이 하나뿐이라 차례를 잴 수 없다");
    const dates = rows.map((row) => row.dueDate);
    assert.deepEqual([...dates].sort(), dates, `날짜 차례가 아니다: ${dates.join(" / ")}`);
  });
});

describe("안 뜨는 줄", () => {
  test("🔴 **수리 건이 붙은 내자 줄**은 여기서 안 뜬다 — 그런데 「납기 임박」에서는 뜬다", async () => {
    // 🔴 한쪽만 보면 「조용해졌다」와 「사라졌다」를 가를 수 없다. 두 조회에 **같은
    //    「오늘」**을 넘겨 같은 건을 함께 묻는다.
    const miscIds = new Set((await mineOnly()).map((row) => row.domesticOrderId));
    assert.equal(
      miscIds.has(repairCaseLinkedOrderId),
      false,
      "수리 건이 붙은 줄이 기타건 알림에도 떴다 — 같은 날짜가 종에 두 줄로 선다"
    );

    const nearCases = await listRepairCasesWithDueDateNear({ now: NOW });
    const linked = nearCases.find((row) => row.repairCaseId === linkedRepairCaseId);
    assert.ok(linked, "그 건이 「납기 임박」에서도 안 뜬다 — 알림이 통째로 사라졌다");
    assert.equal(linked.dueDate, IN_WINDOW_DUE_DATE);
  });

  test("🔴 **끝난 회차**는 빠진다 — [완료 처리]된 회차와 납품일이 찍힌 회차 둘 다", async () => {
    const rows = await mineOnly();

    // 납품일이 찍힌 회차뿐인 줄 — 통째로 안 뜬다.
    assert.equal(
      rows.some((row) => row.domesticOrderId === deliveredId),
      false,
      "납품이 끝난 회차에 임박 알림이 떴다"
    );

    // 1차가 [완료 처리]된 줄 — 2차만 뜬다.
    const completedLine = rows.filter((row) => row.domesticOrderId === firstRowCompletedId);
    assert.equal(completedLine.length, 1, "완료된 1차가 아직 뜨거나 2차까지 사라졌다");
    assert.equal(completedLine[0].dueDate, LATER_IN_WINDOW_DUE_DATE);
  });

  test("🔴 끝난 회차를 빼도 **번호가 밀리지 않는다** — 남은 줄은 여전히 「2차」다", async () => {
    // 🔴 끝난 회차를 SQL 로 먼저 빼면 2차가 「1차」로 불린다. 종에 뜬 회차와 화면의
    //    회차가 어긋나는 가장 조용한 방식이고, 승인 행이 가리키는 번호와도 갈라진다.
    const [remaining] = (await mineOnly()).filter(
      (row) => row.domesticOrderId === firstRowCompletedId
    );
    assert.ok(remaining, "남은 회차가 없다 — 이 시험이 아무것도 안 잰다");
    assert.equal(remaining.dueDateRowOrder, 2, "1차가 빠지자 2차가 「1차」가 됐다");
    // 🔵 회차 수도 **거르기 전**으로 센다 — 안 그러면 이름표가 통째로 사라진다.
    assert.ok(remaining.dueDateRowLabel?.includes("2차"), String(remaining.dueDateRowLabel));
    assert.ok(remaining.dueDateRowLabel?.includes("2차분"), String(remaining.dueDateRowLabel));
  });

  test("🔴 휴지통에 든 줄 · 창 밖 둘(지난 납기 · 먼 납기)은 안 뜬다", async () => {
    const ids = new Set((await mineOnly()).map((row) => row.domesticOrderId));
    assert.equal(ids.has(deletedId), false, "휴지통에 든 줄에 알림이 떴다 — 누르면 갈 화면이 없다");
    assert.equal(ids.has(pastId), false, "이미 지난 납기에 임박이 떴다");
    assert.equal(ids.has(farId), false, "창 밖(오늘+8일) 납기에 임박이 떴다");
  });
});

test("🔴 이 스위트의 표본이 실제로 걸렸다 — 뜬 줄과 안 뜬 줄이 둘 다 있다", async () => {
  // 🔵 위 「안 뜬다」 단언 넷은 조회가 **아무것도 안 내놓아도** 전부 통과한다.
  //    그래서 세운 줄과 빠진 줄을 여기서 한 번 더 값으로 맞대어 본다.
  const shown = new Set((await mineOnly()).map((row) => row.domesticOrderId));
  assert.deepEqual(
    [...shown].sort(),
    [singleRowId, twoRowsId, firstRowCompletedId, todayBoundaryId, lastDayBoundaryId].sort(),
    "뜨기로 한 줄과 실제로 뜬 줄이 다르다"
  );
  // 줄 수까지 못 박는다 — twoRowsId 가 두 줄이므로 여섯이다.
  assert.equal((await mineOnly()).length, 6, "회차 단위로 세어지지 않는다");
});
