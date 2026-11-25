import "../../../../scripts/load-env";

import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { eq, inArray, like } from "drizzle-orm";

import { db, pgClient } from "../connection";
import {
  customers,
  domesticOrders,
  products,
  repairCaseIntakeSequences,
  repairCases,
  users,
} from "../schema";
import { createDomesticOrder, setDomesticOrderDueDateRowConfirmation } from "../mutations/domestic-orders";
import { createRepairCase } from "../mutations/repair-cases";
import { listDomesticOrdersWithDueDateNear } from "./domestic-order-due-date-near-notifications";
import { listMiscDomesticOrders } from "./domestic-orders";
import { listRepairCasesOverdue } from "./repair-case-overdue-notifications";
import { listRepairCasesWithDueDateNear } from "./repair-case-due-date-notifications";
import { listRepairCases } from "./repair-cases";
import { isMiscCaseDueDateNear, isRepairCaseDueDateNear } from "@/lib/domain/notifications";
import type { DomesticOrderFields } from "@/lib/validation/domestic-order-input";
import type { ValidatedCreateRepairCaseInput } from "@/lib/validation/repair-case-input";

/**
 * ============================================================================
 * 🔴 [납기일 확정]이 **종을 끄고 배지는 남기는가** — 진짜 DB 위에서 (2026-11-25)
 * ============================================================================
 * 사용자 요구 원문: 「납기 요청일 옆에 [납기일 확정] 버튼을 만들어줘 … 이 버튼을 누르면
 * 포털의 알림 중에 **[납기 임박] 알림이 뜨지 않도록** 해줘.」 확정 칸·단추·울타리는 앞
 * 조각 둘이 세웠고(커밋 18a4bdd0 · 9eb03da1), 이 파일은 **그 값을 읽는 쪽**을 잰다.
 *
 * 규칙 자체는 순수 함수 시험 둘이 쥐고 있다(domain/due-date-confirmation-silences-bell.ts
 * 와 domain/misc-case-due-date-near.test.ts). 🔴 **여기서만 잴 수 있는 것은 넷**이다:
 *
 *  ① 🔴 **끄는 길이 실제 단추와 같은 길인가** — 칸을 손으로 찍지 않고 **확정 통로를
 *     그대로 불러** 끈다(setDomesticOrderDueDateRowConfirmation). 통로가 다른 칸에
 *     찍고 조회가 다른 칸을 읽는 어긋남은 단위 시험으로는 영영 안 보인다.
 *  ② 🔴 **배지가 같은 줄에서 그대로 서는가** — 화면이 부르는 조회(listMiscDomesticOrders ·
 *     listRepairCases)에서 나온 **진짜 행**으로 잰다. 끄기와 남기기를 **한 표본에서
 *     함께** 보는 자리가 여기밖에 없다.
 *  ③ 🔴 **「전부 확정」이 DB 의 여러 줄에 걸쳐 재어지는가** — 한 수리 건에 내자 줄이
 *     여럿일 수 있다(분할 발주). 하나만 확정하면 종은 그대로 울려야 한다.
 *  ④ 🔴 **내자가 안 붙은 건의 종이 안 꺼지는가** — 회차가 **없을 때** 「전부 확정」을
 *     참으로 읽는 구현이면 A/S 의 대부분이 조용해지는데, 「확정하면 꺼진다」만 재는
 *     시험은 그래도 전부 초록이다.
 *
 * 🔵 그리고 **끄지 않을 것 둘**을 같은 표본으로 함께 잰다: 「납기 지연」은 확정해도
 * 그대로 뜨고(사용자 결정 2), 확정 **해제**하면 종이 다시 울린다(결정 4).
 *
 * ── 🔴 왜 **2095년**(먼 미래)인가 ────────────────────────────────────────
 * 세 조회가 모두 「오늘」을 인자로 받는다(`now`). 날짜를 실제 오늘에 맞추면 **시험이
 * 도는 날에 따라 결과가 달라진다.** 창을 박아 넣고 날짜를 그 둘레에 세운다 —
 * 2095-05-10 을 「오늘」로 잡으면 창은 05-10 … 05-17 이다.
 *
 * ── 격리 규약 ────────────────────────────────────────────────────────────
 * 이 스위트만 쓰는 접수 월 "9505"(2026-11-25 실측 — 쓰는 시험이 없다), 고객사 접두사
 * "AS-TEST-DUE-CONFIRM-BELL-", 제품 모델 접두사 "DUE-CONFIRM-BELL-TEST-".
 * 🔴 접수 건은 **다섯**이다 — 한 달에 인수번호가 99개까지라 넉넉히 쓰면 한참 뒤 남의
 * 시험이 까닭 없이 깨진다. 다섯이 저마다 다른 모양을 재고, 겹치는 것은 없다.
 *
 * after() 는 FK 차례대로 지운다 — domestic_orders 가 먼저다(repair_cases 와 customers 를
 * 가리킨다). 납기요청일 행은 그 줄을 지우면 CASCADE 로 함께 사라진다.
 *
 * 🔴 값은 전부 지어낸 것이다 — 실제 고객사·모델명은 한 글자도 쓰지 않는다.
 * ============================================================================
 */

const TEST_CUSTOMER_NAME_PREFIX = "AS-TEST-DUE-CONFIRM-BELL-";
const TEST_MODEL_PREFIX = "DUE-CONFIRM-BELL-TEST-";
const TEST_YEAR_MONTH = "9505";
const TEST_RECEIVED_AT = "2095-05-01";

/** 「오늘」 — 한국 시각 2095-05-10 14:00. 창은 05-10 … 05-17 이다. */
const NOW = new Date("2095-05-10T05:00:00.000Z");
/** 창 안. 모든 「뜬다/안 뜬다」가 이 날짜 하나에서 갈린다. */
const IN_WINDOW = "2095-05-12";
/** 창 안의 다른 하루 — 회차 둘을 가르는 데 쓴다. */
const LATER_IN_WINDOW = "2095-05-15";
/** 이미 지난 납기 — 「납기 임박」의 창 밖이고 「납기 지연」의 안이다. */
const PAST = "2095-05-05";

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

type DueDateInput = DomesticOrderFields["dueDates"][number];

function dueDateRow(dueDate: string, note: string | null = null): DueDateInput {
  return { dueDate, note, deliveredDate: null, deliveredBy: null };
}

/** 내자 줄 하나. `repairCaseId` 를 안 주면 그것이 곧 **기타건**이다. */
async function createOrder(
  modelName: string,
  dueDates: DueDateInput[],
  extra: Partial<DomesticOrderFields> = {}
): Promise<{ id: string; version: number }> {
  const result = await createDomesticOrder({
    fields: { ...emptyFields(), modelNameText: modelName, dueDates, ...extra },
    actorUserId,
  });
  assert.equal(result.ok, true, `내자 줄 만들기 실패: ${JSON.stringify(result)}`);
  if (!result.ok) throw new Error("unreachable");
  createdOrderIds.push(result.id);
  return { id: result.id, version: result.version };
}

/**
 * 🔴 **확정 통로를 그대로 부른다**(①). 칸을 UPDATE 로 찍으면 「통로가 찍는 칸」과
 * 「조회가 읽는 칸」이 어긋나도 이 파일이 아무 말을 못 한다.
 */
async function setConfirmation(
  order: { id: string; version: number },
  rowOrder: number,
  confirmed: boolean
): Promise<void> {
  const result = await setDomesticOrderDueDateRowConfirmation({
    id: order.id,
    expectedVersion: order.version,
    dueDateRowOrder: rowOrder,
    confirmed,
    actorUserId,
  });
  assert.equal(
    result.ok,
    true,
    `확정 ${confirmed ? "찍기" : "풀기"} 실패(${rowOrder}차): ${JSON.stringify(result)}`
  );
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

async function createCase(customerRequestedDueDate: string | null = null): Promise<string> {
  const created = await createRepairCase({ ...baseCreateRepairCaseInput(), customerRequestedDueDate });
  assert.equal(created.ok, true, `접수 건 만들기 실패: ${JSON.stringify(created)}`);
  if (!created.ok) throw new Error("unreachable");
  return created.id;
}

/* ── 기타건 넷 ──────────────────────────────────────────────────────────── */
/** 회차 하나가 창 안이고 **확정 안 함** — 대조군. 끝까지 울어야 한다. */
let miscOpenId: string;
/** 회차 하나가 창 안이고 **확정** — 종에서 빠지고 배지는 남는다. */
let miscConfirmedId: string;
/** 회차 둘이 창 안인데 **1차만 확정** — 종은 2차 하나만, 배지는 그대로. */
let miscPartialId: string;
/** 확정했다가 **해제** 한 줄 — 다시 울어야 한다(결정 4). */
let miscReleasedOrder: { id: string; version: number };

/* ── 수리 건 다섯 ───────────────────────────────────────────────────────── */
/** 빌려 온 날짜 · 내자 줄 하나 · 그 회차 확정 — 종에서 빠지고 배지는 남는다. */
let caseBorrowedConfirmedId: string;
/** 빌려 온 날짜 · 내자 줄 **둘** · 하나만 확정 — 그대로 울어야 한다(③). */
let casePartialId: string;
/** **제 칸에 날짜가 적힌** 건 · 내자 회차 확정 — 그래도 꺼진다(사용자 결정 3). */
let caseOwnDateConfirmedId: string;
/** 제 칸에 날짜가 있고 **내자 줄이 아예 없는** 건 — 꺼지면 안 된다(④). */
let caseNoDomesticId: string;
/** 지난 납기 · 회차 확정 — 「납기 지연」은 그대로 떠야 한다(결정 2). */
let caseOverdueConfirmedId: string;

before(async () => {
  const [engineer] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.role, "AS_ENGINEER"))
    .limit(1);
  assert.ok(engineer, "expected at least one AS_ENGINEER in the test DB");
  engineerId = engineer.id;
  // created_by/updated_by 는 users 를 RESTRICT 로 가리킨다 — 실재하는 계정이어야 한다.
  actorUserId = engineer.id;

  const [customer] = await db
    .insert(customers)
    .values({ name: `${TEST_CUSTOMER_NAME_PREFIX}${randomUUID().slice(0, 8)}` })
    .returning({ id: customers.id });
  customerId = customer.id;

  // ── 기타건 넷 ───────────────────────────────────────────────────────────
  miscOpenId = (await createOrder(`${TEST_MODEL_PREFIX}MISC-OPEN`, [dueDateRow(IN_WINDOW)])).id;

  const miscConfirmed = await createOrder(`${TEST_MODEL_PREFIX}MISC-CONFIRMED`, [
    dueDateRow(IN_WINDOW),
  ]);
  await setConfirmation(miscConfirmed, 1, true);
  miscConfirmedId = miscConfirmed.id;

  const miscPartial = await createOrder(`${TEST_MODEL_PREFIX}MISC-PARTIAL`, [
    dueDateRow(IN_WINDOW, "1차분"),
    dueDateRow(LATER_IN_WINDOW, "2차분"),
  ]);
  await setConfirmation(miscPartial, 1, true);
  miscPartialId = miscPartial.id;

  miscReleasedOrder = await createOrder(`${TEST_MODEL_PREFIX}MISC-RELEASED`, [
    dueDateRow(IN_WINDOW),
  ]);
  await setConfirmation(miscReleasedOrder, 1, true);

  // ── 수리 건 다섯 ────────────────────────────────────────────────────────
  caseBorrowedConfirmedId = await createCase();
  const borrowedLine = await createOrder(`${TEST_MODEL_PREFIX}CASE-BORROWED`, [dueDateRow(IN_WINDOW)], {
    repairCaseId: caseBorrowedConfirmedId,
  });
  await setConfirmation(borrowedLine, 1, true);

  // 🔴 **줄 둘**이다 — 수리 건이 붙은 줄에는 납기요청일을 하나만 둘 수 있어서
  //    (domain/domestic-order-due-date-rows.ts 의 둘째 울타리) 「회차가 여럿」은
  //    분할 발주로만 만들어진다. 확정은 **한 줄에만** 찍는다.
  casePartialId = await createCase();
  const partialLineA = await createOrder(`${TEST_MODEL_PREFIX}CASE-PARTIAL-A`, [dueDateRow(IN_WINDOW)], {
    repairCaseId: casePartialId,
  });
  await createOrder(`${TEST_MODEL_PREFIX}CASE-PARTIAL-B`, [dueDateRow(LATER_IN_WINDOW)], {
    repairCaseId: casePartialId,
  });
  await setConfirmation(partialLineA, 1, true);

  caseOwnDateConfirmedId = await createCase(IN_WINDOW);
  const ownDateLine = await createOrder(`${TEST_MODEL_PREFIX}CASE-OWN`, [dueDateRow(IN_WINDOW)], {
    repairCaseId: caseOwnDateConfirmedId,
  });
  await setConfirmation(ownDateLine, 1, true);

  caseNoDomesticId = await createCase(IN_WINDOW);

  caseOverdueConfirmedId = await createCase(PAST);
  const overdueLine = await createOrder(`${TEST_MODEL_PREFIX}CASE-OVERDUE`, [dueDateRow(PAST)], {
    repairCaseId: caseOverdueConfirmedId,
  });
  await setConfirmation(overdueLine, 1, true);
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

/** 이 스위트가 만든 기타건 줄만 본다 — 개발·시험 DB 의 다른 줄이 섞이지 않게. */
async function miscBellRows() {
  const rows = await listDomesticOrdersWithDueDateNear({ now: NOW });
  const mine = new Set(createdOrderIds);
  return rows.filter((row) => mine.has(row.domesticOrderId));
}

/** 그 기타건 줄에 **배지가 서는가** — 목록 화면이 부르는 그 조회와 그 함수로 잰다. */
async function miscBadgeOn(orderId: string): Promise<boolean> {
  const rows = await listMiscDomesticOrders();
  const row = rows.find((item) => item.id === orderId);
  assert.ok(row, "기타건 현황 목록에 그 줄이 없다 — 표본이 사라졌다");
  return isMiscCaseDueDateNear(row.dueDates, NOW);
}

/** 수리 건 종에 뜬 내 건들. */
async function caseBellIds(): Promise<Set<string>> {
  const rows = await listRepairCasesWithDueDateNear({ now: NOW });
  return new Set(rows.map((row) => row.repairCaseId));
}

/** 그 수리 건에 **배지가 서는가** — 전체 A/S 현황이 부르는 그 조회와 그 함수로 잰다. */
async function caseBadgeOn(caseId: string): Promise<boolean> {
  const rows = await listRepairCases();
  const row = rows.find((item) => item.id === caseId);
  assert.ok(row, "전체 A/S 현황 목록에 그 건이 없다 — 표본이 사라졌다");
  return isRepairCaseDueDateNear(row, NOW);
}

test("🔴 밑자락 점검 — 아홉 표본이 저마다 다른 줄·건으로 섰다", () => {
  // 이 못이 없으면 setup 이 조용히 틀어졌을 때(예: 확정이 안 찍혔을 때) 아래
  // 「안 뜬다」 단언들이 전부 공짜로 통과한다.
  const orderIds = [miscOpenId, miscConfirmedId, miscPartialId, miscReleasedOrder.id];
  const caseIds = [
    caseBorrowedConfirmedId,
    casePartialId,
    caseOwnDateConfirmedId,
    caseNoDomesticId,
    caseOverdueConfirmedId,
  ];
  for (const id of [...orderIds, ...caseIds]) assert.ok(id, "setup 이 표본을 못 만들었다");
  assert.equal(new Set([...orderIds, ...caseIds]).size, 9, "같은 표본을 두 번 쓰고 있다");
  // 창의 경계가 실제로 안팎을 가르는 값인가 — 날짜를 잘못 적으면 아래가 전부 뜻을 잃는다.
  assert.ok(PAST < IN_WINDOW && IN_WINDOW < LATER_IN_WINDOW);
  assert.ok(TEST_RECEIVED_AT < PAST, "인수일보다 이른 납기일은 저장 자체가 거절된다");
});

describe("기타건 — 확정하면 종만 꺼진다", () => {
  test("🔵 대조 — **확정 안 한** 줄은 지금처럼 운다", async () => {
    // 🔴 이 줄이 없으면 「전부 꺼 버린 구현」이 아래 전부를 통과한다.
    const rows = await miscBellRows();
    const mine = rows.filter((row) => row.domesticOrderId === miscOpenId);
    assert.equal(mine.length, 1, "확정하지도 않은 회차의 종이 꺼졌다");
    assert.equal(mine[0].dueDate, IN_WINDOW);
    assert.equal(await miscBadgeOn(miscOpenId), true, "배지도 안 선다 — 표본이 창 밖이다");
  });

  test("🔴 확정한 회차는 **종에서 빠지고 배지는 그대로 선다**", async () => {
    const rows = await miscBellRows();
    assert.equal(
      rows.some((row) => row.domesticOrderId === miscConfirmedId),
      false,
      "확정했는데 종이 그대로 운다"
    );
    // 🔴 짝이다 — 한쪽만 보면 「조용해졌다」와 「통째로 사라졌다」를 가를 수 없다.
    assert.equal(
      await miscBadgeOn(miscConfirmedId),
      true,
      "확정하자 배지까지 사라졌다 — 날짜가 다가온다는 사실은 확정으로 변하지 않는다"
    );
  });

  test("🔴 **1차만 확정**하면 2차는 그대로 운다 — 끄는 단위가 회차다", async () => {
    const mine = (await miscBellRows()).filter((row) => row.domesticOrderId === miscPartialId);
    assert.equal(mine.length, 1, "1차를 확정했더니 2차까지 꺼졌다(또는 1차가 아직 운다)");
    assert.equal(mine[0].dueDate, LATER_IN_WINDOW, "남은 줄이 2차가 아니다");
    // 🔴 회차 번호는 **거르기 전**에 매겨진다 — 1차가 빠져도 2차는 「2차」다.
    assert.equal(mine[0].dueDateRowOrder, 2, "1차가 빠지자 2차가 「1차」가 됐다");
    assert.ok(mine[0].dueDateRowLabel?.includes("2차분"), String(mine[0].dueDateRowLabel));
    assert.equal(await miscBadgeOn(miscPartialId), true);
  });

  test("🔴 **확정을 풀면 다시 운다** — 막다른 길이 아니다(결정 4)", async () => {
    // 지금은 확정 상태라 조용하다.
    assert.equal(
      (await miscBellRows()).some((row) => row.domesticOrderId === miscReleasedOrder.id),
      false,
      "확정한 줄이 아직 운다 — 이 시험이 아무것도 안 잰다"
    );

    await setConfirmation(miscReleasedOrder, 1, false);

    const after = (await miscBellRows()).filter(
      (row) => row.domesticOrderId === miscReleasedOrder.id
    );
    assert.equal(after.length, 1, "확정을 풀었는데 종이 안 돌아온다");
    assert.equal(after[0].dueDate, IN_WINDOW);
  });
});

describe("수리 건 — 붙어 있는 내자 회차가 전부 확정일 때만 꺼진다", () => {
  test("🔴 빌려 온 날짜의 회차를 확정하면 **종에서 빠지고 배지는 남는다**", async () => {
    assert.equal(
      (await caseBellIds()).has(caseBorrowedConfirmedId),
      false,
      "확정했는데 수리 건 종이 그대로 운다"
    );
    assert.equal(
      await caseBadgeOn(caseBorrowedConfirmedId),
      true,
      "확정하자 수리 건 배지까지 사라졌다 — 끄는 것은 종뿐이다"
    );
  });

  test("🔴 내자 줄이 **둘인데 하나만** 확정이면 그대로 운다 — 날짜가 아직 움직인다", async () => {
    const bell = await caseBellIds();
    assert.ok(
      bell.has(casePartialId),
      "일부만 확정인데 종이 꺼졌다 — 아직 안 잠긴 회차의 경보가 사라진다"
    );
  });

  test("🔴 **제 칸에 날짜가 적힌 건에서도** 꺼진다(사용자 결정 3)", async () => {
    // 그 줄의 확정은 수리 건 쪽 저장까지 막는다(mutations/repair-cases.ts) — 날짜가
    // 잠긴 것은 빌려 온 쪽이든 제 칸이든 같다. 그래서 어느 쪽인지 묻지 않는다.
    assert.equal(
      (await caseBellIds()).has(caseOwnDateConfirmedId),
      false,
      "제 날짜를 가진 건은 확정해도 종이 운다"
    );
    assert.equal(await caseBadgeOn(caseOwnDateConfirmedId), true);
  });

  test("🔴 **내자 줄이 없는 건은 안 꺼진다** — 빈 목록을 「전부 확정」으로 읽는 자리", async () => {
    // 🔴 `[].every(...)` 는 참이다. 그대로 쓰면 A/S 의 대부분이 조용해지는데,
    //    위 「확정하면 꺼진다」 셋은 그래도 전부 초록으로 남는다.
    assert.ok(
      (await caseBellIds()).has(caseNoDomesticId),
      "내자가 안 붙은 건의 종이 꺼졌다 — 「납기 임박」이 거의 전부 사라진 것이다"
    );
  });
});

describe("🔴 끄지 않는 것 — 「납기 지연」(사용자 결정 2)", () => {
  test("확정해도 지연은 그대로 뜬다 — 지난 날짜가 지났다는 사실은 안 변한다", async () => {
    const overdue = await listRepairCasesOverdue({ now: NOW });
    const row = overdue.find((item) => item.repairCaseId === caseOverdueConfirmedId);
    assert.ok(row, "확정했더니 「납기 지연」까지 꺼졌다 — 끄는 것은 「납기 임박」뿐이다");
    assert.equal(row.dueDate, PAST);
  });

  test("🔵 못 — 그 건은 애초에 「납기 임박」 쪽 창 밖이다(지연으로만 뜬다)", async () => {
    // 이 줄이 없으면 위 시험이 「임박에서 빠진 까닭이 확정 때문인지 창 때문인지」를
    // 가리지 못한 채 통과한다.
    assert.equal((await caseBellIds()).has(caseOverdueConfirmedId), false);
  });
});

test("🔴 이 스위트의 표본이 실제로 걸렸다 — 꺼진 줄과 우는 줄이 둘 다 있다", async () => {
  // 🔵 위 「안 뜬다」 단언들은 조회가 **아무것도 안 내놓아도** 전부 통과한다. 그래서
  //    마지막에 양쪽을 값으로 한 번 더 맞대어 본다(이때 miscReleased 는 이미 풀려 있다).
  const miscShown = new Set((await miscBellRows()).map((row) => row.domesticOrderId));
  assert.deepEqual(
    [...miscShown].sort(),
    [miscOpenId, miscPartialId, miscReleasedOrder.id].sort(),
    "기타건에서 울기로 한 줄과 실제로 운 줄이 다르다"
  );

  const bell = await caseBellIds();
  assert.deepEqual(
    [
      casePartialId,
      caseNoDomesticId,
      caseBorrowedConfirmedId,
      caseOwnDateConfirmedId,
      caseOverdueConfirmedId,
    ].map((id) => bell.has(id)),
    [true, true, false, false, false],
    "수리 건에서 울기로 한 건과 실제로 운 건이 다르다"
  );
});
